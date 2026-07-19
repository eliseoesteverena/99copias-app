import { calcularPrecio } from './lib/precio.js';
import { sanitizarNombreArchivo } from './lib/r2.js';
import { horasMinimasRequeridas, cumpleAnticipacion } from './lib/produccion.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { cliente, zona_id, turno_entrega_id, fecha_entrega, direccion_entrega, archivos, categoria } = body;

    if (!categoria) {
      return Response.json({ error: 'Falta la categoría del pedido.' }, { status: 400 });
    }
    if (!cliente || !cliente.nombre || !cliente.apellido || !cliente.documento_numero) {
      return Response.json({ error: 'Faltan datos del cliente.' }, { status: 400 });
    }
    if (!zona_id || !turno_entrega_id || !fecha_entrega || !direccion_entrega) {
      return Response.json({ error: 'Faltan datos de entrega.' }, { status: 400 });
    }
    if (!Array.isArray(archivos) || archivos.length === 0) {
      return Response.json({ error: 'El pedido no tiene archivos.' }, { status: 400 });
    }

    const db = env.DB;

    // Los archivos ya se subieron a R2 (staging) durante el Paso 2. Acá confirmamos que
    // cada uno realmente esté ahí antes de cobrar nada — si falta alguno (subida incompleta,
    // o expiró por la regla de ciclo de vida de staging/), se corta el pedido.
    const objetosStaging = [];
    for (const a of archivos) {
      if (!a.r2_key) {
        return Response.json({ error: `El archivo "${a.nombre || ''}" todavía no terminó de subirse. Esperá a que termine e intentá de nuevo.` }, { status: 400 });
      }
      const obj = await env.BUCKET.get(a.r2_key);
      if (!obj) {
        return Response.json({ error: `No encontramos el archivo "${a.nombre || ''}" subido. Volvé al paso de archivos y volvé a cargarlo.` }, { status: 410 });
      }
      objetosStaging.push(obj);
    }

    // Precio recalculado en servidor — nunca se confía en el total del cliente.
    // Lo hacemos acá (antes de validar el turno) porque necesitamos el total de
    // carillas del pedido para saber cuántas horas de anticipación requiere.
    const { items, total } = await calcularPrecio(db, archivos, categoria);
    const carillasTotal = items.reduce((acc, it) => acc + it.carillas, 0);

    // Turno: existencia, excepciones, cupo y — lo nuevo — tiempo mínimo de producción.
    const turno = await db.prepare(
      'SELECT hora_inicio, capacidad_maxima FROM turnos_entrega WHERE id = ?'
    ).bind(turno_entrega_id).first();
    if (!turno) return Response.json({ error: 'El turno elegido ya no existe.' }, { status: 409 });

    const excepcion = await db.prepare(
      'SELECT * FROM turnos_excepciones WHERE turno_entrega_id = ? AND fecha = ?'
    ).bind(turno_entrega_id, fecha_entrega).first();
    if (excepcion && excepcion.tipo === 'cancelado') {
      return Response.json({ error: 'Ese turno fue cancelado para la fecha elegida.' }, { status: 409 });
    }
    const horaInicio = (excepcion && excepcion.tipo === 'horario_modificado' && excepcion.hora_inicio)
      ? excepcion.hora_inicio
      : turno.hora_inicio;
    const capacidadMaxima = (excepcion && excepcion.tipo === 'capacidad_modificada')
      ? excepcion.capacidad_maxima
      : turno.capacidad_maxima;

    if (capacidadMaxima != null) {
      const ocupadosRow = await db.prepare(
        'SELECT COUNT(*) as n FROM trabajos WHERE turno_entrega_id = ? AND fecha_entrega = ?'
      ).bind(turno_entrega_id, fecha_entrega).first();
      if (ocupadosRow.n >= capacidadMaxima) {
        return Response.json({ error: 'Ese turno ya no tiene cupo disponible.' }, { status: 409 });
      }
    }

    const horasMinimas = await horasMinimasRequeridas(db, categoria, carillasTotal);
    if (!cumpleAnticipacion(fecha_entrega, horaInicio, horasMinimas)) {
      return Response.json({
        error: `Este pedido (${carillasTotal} carillas) necesita al menos ${horasMinimas}hs de anticipación — elegí un turno más adelante.`,
      }, { status: 409 });
    }

    // Upsert de cliente por (documento_tipo, documento_numero).
    const docTipo = cliente.documento_tipo === 'cuit' ? 'cuit' : 'dni';
    let clienteRow = await db.prepare(
      'SELECT id FROM clientes WHERE documento_tipo = ? AND documento_numero = ?'
    ).bind(docTipo, cliente.documento_numero).first();

    let clienteId;
    if (clienteRow) {
      clienteId = clienteRow.id;
      await db.prepare(
        `UPDATE clientes SET nombre = ?, apellido = ?, email = ?, celular = ?, direccion = ? WHERE id = ?`
      ).bind(cliente.nombre, cliente.apellido, cliente.email || null, cliente.celular || null, cliente.direccion || null, clienteId).run();
    } else {
      const insert = await db.prepare(
        `INSERT INTO clientes (nombre, apellido, documento_tipo, documento_numero, email, celular, direccion)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(cliente.nombre, cliente.apellido, docTipo, cliente.documento_numero, cliente.email || null, cliente.celular || null, cliente.direccion || null).run();
      clienteId = insert.meta.last_row_id;
    }

    const categoriaRow = await db.prepare('SELECT id FROM categorias WHERE codigo = ?').bind(categoria).first();
    const categoriaId = categoriaRow ? categoriaRow.id : null;

    const configuracionInicial = JSON.stringify({ archivos, items });

    const insertTrabajo = await db.prepare(
      `INSERT INTO trabajos (cliente_id, configuracion, estado, total, direccion_entrega, fecha_entrega, zona_id, turno_entrega_id, categoria_id, pagado)
       VALUES (?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, 0)`
    ).bind(clienteId, configuracionInicial, total, direccion_entrega, fecha_entrega, zona_id, turno_entrega_id, categoriaId).run();

    const trabajoId = insertTrabajo.meta.last_row_id;

    // Confirmamos cada archivo: lo copiamos de staging/ a trabajos/{id}/ (server-side,
    // sin pasar por el navegador) y borramos el original de staging. Si algo falla acá,
    // el trabajo ya existe igual — dejamos constancia del error en la configuración
    // en vez de perder el pedido ya pagado/por pagar.
    const archivosConfirmados = [];
    for (let i = 0; i < archivos.length; i++) {
      const a = archivos[i];
      const obj = objetosStaging[i];
      const nombreSanitizado = sanitizarNombreArchivo(a.nombre || `archivo-${i + 1}`);
      const keyFinal = `trabajos/${trabajoId}/${i + 1}-${nombreSanitizado}`;
      try {
        await env.BUCKET.put(keyFinal, obj.body, {
          httpMetadata: obj.httpMetadata,
          customMetadata: obj.customMetadata,
        });
        await env.BUCKET.delete(a.r2_key);
        archivosConfirmados.push({ ...a, r2_key: keyFinal });
      } catch (err) {
        console.error(`Error confirmando archivo ${a.r2_key} -> ${keyFinal}:`, err);
        archivosConfirmados.push({ ...a, r2_key: a.r2_key, error_confirmacion: String((err && err.message) || err) });
      }
    }

    await db.prepare('UPDATE trabajos SET configuracion = ? WHERE id = ?')
      .bind(JSON.stringify({ archivos: archivosConfirmados, items }), trabajoId)
      .run();

    return Response.json({ trabajo_id: trabajoId, total, items });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message || 'No se pudo crear el trabajo.' }, { status: 500 });
  }
}
