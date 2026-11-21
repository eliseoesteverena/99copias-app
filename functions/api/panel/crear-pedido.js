// functions/api/panel/crear-pedido.js
//
// Lo llama el PANEL para cargar a mano un pedido que no pasó por el wizard
// (típicamente: entró por WhatsApp). Mismo patrón de seguridad que el resto de
// /api/panel/: secreto compartido en x-panel-secret.
//
// POR QUÉ ESTÁ EN EL WIZARD Y NO EN EL PANEL: el precio sale de calcularPrecio()
// y calcularEnvio(), la única fuente de verdad. Si el Panel tuviera su propia
// cuenta, los reportes podrían contradecirse con los pedidos web.
//
// QUÉ SE GUARDA (pensado para reportes a futuro):
//   trabajos.configuracion = { archivos: [...], items: [...], origen: 'manual', ajuste? }
//     · archivos[i] → la configuración pedida: producto, acabado, páginas, copias,
//       rango, faz, páginas por carilla. Si no hay archivo físico: r2_key null y
//       sin_archivo: true (el pedido se cargó igual, con su configuración).
//     · items[i]    → salida de calcularPrecio, IDÉNTICA a la de un pedido web: copias,
//       carillas, producto_primario, producto_secundario, subtotales y total.
//     Se consulta igual para web y manual, por ejemplo:
//       SELECT json_extract(i.value,'$.producto_primario') AS producto,
//              SUM(json_extract(i.value,'$.carillas'))     AS carillas,
//              SUM(json_extract(i.value,'$.copias'))       AS copias
//         FROM trabajos t, json_each(t.configuracion, '$.items') i
//        GROUP BY producto;
//   Columnas propias (ver migracion_pedidos_manuales.sql): origen, creado_por,
//   medio_pago, cliente_* (contacto congelado, porque puede no haber cuenta).
//   Si el pedido ya está pagado, además se registra una fila en `pagos`
//   (medio, monto = lo efectivamente cobrado, estado_revision = 'aprobado'), en la
//   MISMA transacción que el pedido: así los reportes de caja salen de una sola tabla,
//   la misma que usan Mercado Pago y las transferencias.
//
// BODY:
//   {
//     categoria_id | categoria,            // una de las dos (id numérico o código)
//     lineas: [{ nombre?, paginas, copias, rango?, faz?, paginas_por_carilla?,
//                producto_primario_id | primario, acabado_id | acabado? }],
//     cliente: { nombre, apellido?, documento_tipo?, documento_numero?, celular?, email? },
//     origen?: 'whatsapp'|'mostrador'|'telefono'|'otro',
//     zona_id?, turno_entrega_id?, fecha_entrega?, direccion_entrega?,
//     pagado?: boolean, medio_pago?: 'efectivo'|'transferencia'|'mercadopago'|'otro',
//     estado?: 'pendiente'|'en_proceso'|'listo'|'entregado',
//     total_final?: number, motivo_ajuste?: string,   // precio acordado distinto al calculado
//     costo_envio?: number,                           // pisa el envío calculado
//     fecha_pedido?: 'YYYY-MM-DD',                    // para cargar un pedido de otro día
//     observaciones?: string,
//     creado_por?: string                             // lo agrega el Panel (email del operador)
//   }
//
// Respuestas: 200 { ok, trabajo_id, total, ... } | 400 | 401 | 409 | 500
//
// Decisiones:
//   - NO valida cupo ni anticipación del turno: es una carga del operador, que sabe
//     lo que está haciendo. Si se asigna turno, el pedido cuenta para el cupo.
//   - NO notifica al cliente (ni push ni mail de "recibimos tu pedido").
//   - Si el DNI/CUIT ya pertenece a una cuenta, el pedido se asocia a esa cuenta
//     (aparece en su "Mis pedidos" y sus reportes se unifican). Si no, user_id queda NULL.

import { calcularPrecio } from '../lib/precio.js';
import { calcularEnvio } from '../lib/envio.js';

const ESTADOS = ['pendiente', 'en_proceso', 'listo', 'entregado'];
const MEDIOS = ['efectivo', 'transferencia', 'mercadopago', 'otro'];
const ORIGENES = ['whatsapp', 'mostrador', 'telefono', 'otro'];
const MAX_LINEAS = 100;
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

class ErrorDeValidacion extends Error {}
const invalido = (msg) => new ErrorDeValidacion(msg);

const texto = (v, max = 200) => {
  const s = String(v == null ? '' : v).trim();
  return s ? s.slice(0, max) : null;
};
const numeroNoNegativo = (v, campo) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw invalido(`${campo} inválido.`);
  return Math.round(n * 100) / 100;
};

// id numérico -> código, para los productos que el Panel manda por id.
async function codigosPorId(db, ids) {
  const lista = [...new Set(ids.filter((x) => Number.isInteger(x)))];
  if (!lista.length) return {};
  const marcas = lista.map(() => '?').join(',');
  const { results } = await db.prepare(`SELECT id, codigo FROM productos WHERE id IN (${marcas})`).bind(...lista).all();
  return Object.fromEntries((results || []).map((r) => [r.id, r.codigo]));
}

export async function onRequestPost({ request, env }) {
  const secretRecibido = request.headers.get('x-panel-secret');
  if (!env.PANEL_TO_WIZARD_SECRET || secretRecibido !== env.PANEL_TO_WIZARD_SECRET) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw invalido('Body inválido.');
    const db = env.DB;

    // ---- Categoría -----------------------------------------------------
    const categoriaRow = body.categoria_id != null
      ? await db.prepare('SELECT id, codigo FROM categorias WHERE id = ?').bind(Number(body.categoria_id)).first()
      : body.categoria
        ? await db.prepare('SELECT id, codigo FROM categorias WHERE codigo = ?').bind(String(body.categoria)).first()
        : null;
    if (!categoriaRow) throw invalido('Elegí una categoría válida.');

    // ---- Líneas (cada una = un "archivo" del pedido, con o sin archivo real) ----
    const lineas = Array.isArray(body.lineas) ? body.lineas : [];
    if (!lineas.length) throw invalido('Agregá al menos un producto al pedido.');
    if (lineas.length > MAX_LINEAS) throw invalido(`Máximo ${MAX_LINEAS} productos por pedido.`);

    const idsProductos = lineas.flatMap((l) => [Number(l.producto_primario_id), Number(l.acabado_id)]);
    const codigos = await codigosPorId(db, idsProductos);

    const archivos = lineas.map((l, i) => {
      const n = i + 1;
      const paginas = parseInt(l.paginas, 10);
      const copias = parseInt(l.copias, 10);
      if (!Number.isInteger(paginas) || paginas < 1) throw invalido(`Producto ${n}: indicá la cantidad de páginas (mínimo 1).`);
      if (!Number.isInteger(copias) || copias < 1) throw invalido(`Producto ${n}: indicá la cantidad de copias (mínimo 1).`);
      const primario = l.primario || codigos[Number(l.producto_primario_id)];
      if (!primario) throw invalido(`Producto ${n}: elegí el tipo de impresión.`);
      const acabado = l.acabado || codigos[Number(l.acabado_id)] || 'suelto';
      return {
        // Nombre distinto por línea: el Panel empareja archivo<->item por nombre.
        nombre: texto(l.nombre, 150) || `Sin archivo (${n})`,
        paginas,
        copias,
        rango: texto(l.rango, 100) || '',
        faz: l.faz === 'doble' ? 'doble' : 'simple',
        paginas_por_carilla: parseInt(l.paginas_por_carilla, 10) || 1,
        primario,
        acabado,
      };
    });

    // ---- Precio: la misma función que usa el wizard ---------------------
    let calculo;
    try {
      calculo = await calcularPrecio(db, archivos, categoriaRow.codigo);
    } catch (err) {
      throw invalido(String((err && err.message) || err)); // mensajes de calcularPrecio ya son para humanos
    }
    const { items, total: totalImpresion } = calculo;
    const carillasTotal = items.reduce((acc, it) => acc + it.carillas, 0);

    // ---- Entrega (todo opcional) ---------------------------------------
    let zona = null;
    if (body.zona_id != null && body.zona_id !== '') {
      zona = await db.prepare('SELECT id, es_retiro FROM zonas WHERE id = ?').bind(Number(body.zona_id)).first();
      if (!zona) throw invalido('La zona elegida no existe.');
    }
    let turnoId = null;
    if (body.turno_entrega_id != null && body.turno_entrega_id !== '') {
      if (!zona) throw invalido('Para asignar un turno hay que elegir primero la zona.');
      const turno = await db.prepare('SELECT id, zona_id FROM turnos_entrega WHERE id = ?').bind(Number(body.turno_entrega_id)).first();
      if (!turno || turno.zona_id !== zona.id) throw invalido('El turno no pertenece a la zona elegida.');
      turnoId = turno.id;
    }
    const fechaEntrega = texto(body.fecha_entrega, 10);
    if (fechaEntrega && !REGEX_FECHA.test(fechaEntrega)) throw invalido('Fecha de entrega inválida.');
    if (turnoId && !fechaEntrega) throw invalido('Para asignar un turno hay que indicar la fecha.');
    const direccion = texto(body.direccion_entrega, 300) || (zona && zona.es_retiro ? 'Retiro en local' : null);

    let conEnvio = 0;
    let costoEnvio = 0;
    if (zona) {
      const env_ = await calcularEnvio(db, zona.id, categoriaRow.codigo, carillasTotal);
      conEnvio = env_.con_envio ? 1 : 0;
      costoEnvio = Number(env_.costo_envio) || 0;
    }
    if (body.costo_envio != null && body.costo_envio !== '') {
      costoEnvio = numeroNoNegativo(body.costo_envio, 'El costo de envío');
      conEnvio = zona && !zona.es_retiro ? 1 : 0;
    }

    // ---- Total: calculado, o el precio acordado con el cliente -------------
    const totalCalculado = totalImpresion + costoEnvio;
    let totalFinal = totalCalculado;
    let ajuste = null;
    if (body.total_final != null && body.total_final !== '') {
      totalFinal = numeroNoNegativo(body.total_final, 'El total acordado');
      if (totalFinal !== totalCalculado) {
        ajuste = { total_calculado: totalCalculado, total_final: totalFinal, motivo: texto(body.motivo_ajuste, 300) };
      }
    }

    // ---- Cliente ---------------------------------------------------------
    const c = body.cliente || {};
    const nombre = texto(c.nombre, 100);
    if (!nombre) throw invalido('Indicá el nombre del cliente.');
    const apellido = texto(c.apellido, 100);
    const docNumero = texto(c.documento_numero, 20);
    const docTipo = docNumero ? (c.documento_tipo === 'cuit' ? 'cuit' : 'dni') : null;
    const celular = texto(c.celular, 40);
    const email = texto(c.email, 150);

    // Si ese documento ya tiene cuenta, el pedido se vincula a ella.
    let userId = null;
    if (docNumero) {
      const perfil = await db.prepare(
        'SELECT user_id FROM perfil_fiscal WHERE documento_tipo = ? AND documento_numero = ?'
      ).bind(docTipo, docNumero).first();
      userId = perfil ? perfil.user_id : null;
    }

    // ---- Pago y estado ----------------------------------------------------
    const pagado = body.pagado === true || body.pagado === 1;
    const medioPago = texto(body.medio_pago, 20);
    if (medioPago && !MEDIOS.includes(medioPago)) throw invalido('Medio de pago inválido.');
    if (pagado && !medioPago) throw invalido('Si el pedido está pagado, indicá con qué medio.');
    const estado = body.estado ? String(body.estado) : (pagado ? 'en_proceso' : 'pendiente');
    if (!ESTADOS.includes(estado)) throw invalido('Estado inválido.');
    const origen = ORIGENES.includes(body.origen) ? body.origen : 'otro';

    let creadoEn = null; // NULL => datetime('now')
    const fechaPedido = texto(body.fecha_pedido, 10);
    if (fechaPedido) {
      if (!REGEX_FECHA.test(fechaPedido)) throw invalido('Fecha del pedido inválida.');
      creadoEn = `${fechaPedido} 12:00:00`;
    }

    // ---- Guardar ----------------------------------------------------------
    const archivosGuardados = archivos.map((a) => ({ ...a, r2_key: null, sin_archivo: true }));
    const configuracion = JSON.stringify({
      archivos: archivosGuardados,
      items,
      origen: 'manual',
      ...(ajuste ? { ajuste } : {}),
    });

    const stmtTrabajo = db.prepare(
      `INSERT INTO trabajos
         (user_id, configuracion, estado, total, direccion_entrega, fecha_entrega, zona_id, turno_entrega_id,
          categoria_id, con_envio, costo_envio, pagado, observaciones, origen, creado_por, medio_pago,
          cliente_nombre, cliente_apellido, cliente_documento_tipo, cliente_documento_numero,
          cliente_celular, cliente_email, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    ).bind(
      userId, configuracion, estado, totalFinal, direccion, fechaEntrega, zona ? zona.id : null, turnoId,
      categoriaRow.id, conEnvio, costoEnvio, pagado ? 1 : 0, texto(body.observaciones, 1000), origen,
      texto(body.creado_por, 150), medioPago,
      nombre, apellido, docTipo, docNumero, celular, email, creadoEn
    );

    // Fila de pago (solo si ya está cobrado). last_insert_rowid() apunta al trabajo
    // recién insertado porque el batch corre en orden y en una sola transacción.
    // NOTA: si la tabla `pagos` tuviera un CHECK que no admite 'efectivo'/'otro' en
    // `medio`, el batch entero falla; en ese caso se guarda el pedido igual (el medio
    // queda en trabajos.medio_pago) y se avisa en la respuesta con pago_registrado:false.
    const stmtPago = pagado
      ? db.prepare(
          `INSERT INTO pagos (trabajo_id, medio, estado_revision, monto, moneda, external_reference, revisado_en)
           VALUES (last_insert_rowid(), ?, 'aprobado', ?, 'ARS', CAST(last_insert_rowid() AS TEXT), datetime('now'))`
        ).bind(medioPago, totalFinal)
      : null;

    let resultados;
    let pagoRegistrado = false;
    if (stmtPago) {
      try {
        resultados = await db.batch([stmtTrabajo, stmtPago]);
        pagoRegistrado = true;
      } catch (err) {
        if (!/constraint/i.test(String((err && err.message) || err))) throw err;
        console.error('[crear-pedido] pagos rechazó la fila (¿CHECK en medio?); se guarda el pedido sin fila de pago', err);
        resultados = await db.batch([stmtTrabajo]);
      }
    } else {
      resultados = await db.batch([stmtTrabajo]);
    }

    const trabajoId = resultados[0].meta.last_row_id;
    console.log('[crear-pedido] Pedido manual creado', { trabajoId, origen, total: totalFinal, lineas: items.length, vinculadoACuenta: !!userId, pagoRegistrado });

    return Response.json({
      ok: true,
      trabajo_id: trabajoId,
      total: totalFinal,
      total_calculado: totalCalculado,
      lineas: items.length,
      vinculado_a_cuenta: !!userId,
      // true: se registró en `pagos`; false: estaba pagado pero la tabla rechazó la fila
      // (ver arriba); null: el pedido no está pagado, no corresponde.
      pago_registrado: pagado ? pagoRegistrado : null,
    });
  } catch (err) {
    if (err instanceof ErrorDeValidacion) return Response.json({ error: err.message }, { status: 400 });
    console.error('[crear-pedido] Error creando pedido manual:', err);
    const detalle = String((err && err.message) || err);
    const faltaMigracion = /no column named|no such column/i.test(detalle);
    return Response.json({
      error: faltaMigracion
        ? 'Falta correr migracion_pedidos_manuales.sql en la base de datos.'
        : 'No se pudo crear el pedido.',
    }, { status: 500 });
  }
}
