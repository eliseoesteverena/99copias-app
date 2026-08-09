import { calcularPrecio } from './lib/precio.js';
import { sanitizarNombreArchivo } from './lib/r2.js';
import { horasMinimasRequeridas, cumpleAnticipacion } from './lib/produccion.js';
import { calcularEnvio } from './lib/envio.js';
import { createAuth } from './lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    // --- Sesión (Better Auth) --------------------------------------------
    // A partir de Fase 1, todo pedido cuelga de un user_id — anónimo o
    // logueado, nunca de un `clientes.id` propio (esa tabla ya no existe,
    // ver migracion_trabajos_user_id.sql). El frontend siempre debería tener
    // una sesión anónima creada al cargar el wizard (auth-client.js); si acá
    // no hay sesión, algo falló antes (cookie bloqueada, sesión expirada) —
    // se lo pedimos de vuelta al cliente en vez de crear un usuario server-side
    // por afuera del flujo normal de auth.
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json(
        { error: 'Tu sesión expiró o no se pudo verificar. Recargá la página e intentá de nuevo.' },
        { status: 401 }
      );
    }
    const userId = sessionData.user.id;

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

    // Los archivos ya se subieron a R2 (staging) durante el paso de archivos. Acá
    // confirmamos que cada uno realmente esté ahí antes de cobrar nada — si falta
    // alguno (subida incompleta, o expiró por la regla de ciclo de vida de
    // staging/), se corta el pedido.
    const objetosStaging = [];
    for (const a of archivos) {
      if (!a.r2_key) {
        return Response.json(
          { error: `El archivo "${a.nombre || ''}" todavía no terminó de subirse. Esperá a que termine e intentá de nuevo.` },
          { status: 400 }
        );
      }
      const obj = await env.BUCKET.get(a.r2_key);
      if (!obj) {
        return Response.json(
          { error: `No encontramos el archivo "${a.nombre || ''}" subido. Volvé al paso de archivos y volvé a cargarlo.` },
          { status: 410 }
        );
      }
      objetosStaging.push(obj);
    }

    // Precio recalculado en servidor — nunca se confía en el total del cliente.
    // Lo hacemos acá (antes de validar el turno) porque necesitamos el total de
    // carillas del pedido para saber cuántas horas de anticipación requiere.
    const { items, total } = await calcularPrecio(db, archivos, categoria);
    const carillasTotal = items.reduce((acc, it) => acc + it.carillas, 0);

    // Turno: existencia, excepciones, cupo y tiempo mínimo de producción.
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

    // --- Upsert de perfil_fiscal por user_id (1:1 con la sesión) ----------
    // Reemplaza el upsert anterior de `clientes` por (documento_tipo,
    // documento_numero). Ahora la fila siempre existe o se crea atada al
    // user_id de la sesión (DEC-A/DEC-E, HANDOFF_AUTENTICACION_Y_FLUJO.md).
    // El UNIQUE(documento_tipo, documento_numero) de la tabla sigue siendo
    // la defensa contra duplicar un mismo DNI/CUIT — si ese documento ya
    // está asociado a OTRO user_id, el INSERT/UPDATE falla acá y se lo
    // comunicamos con claridad en vez de dejar pasar un error 500 genérico.
    const docTipo = cliente.documento_tipo === 'cuit' ? 'cuit' : 'dni';
    try {
      const perfilExistente = await db.prepare(
        'SELECT user_id FROM perfil_fiscal WHERE user_id = ?'
      ).bind(userId).first();

      if (perfilExistente) {
        await db.prepare(
          `UPDATE perfil_fiscal
           SET nombre = ?, apellido = ?, documento_tipo = ?, documento_numero = ?, celular = ?, email_contacto = ?
           WHERE user_id = ?`
        ).bind(cliente.nombre, cliente.apellido, docTipo, cliente.documento_numero, cliente.celular || null, cliente.email || null, userId).run();
      } else {
        await db.prepare(
          `INSERT INTO perfil_fiscal (user_id, nombre, apellido, documento_tipo, documento_numero, celular, email_contacto)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(userId, cliente.nombre, cliente.apellido, docTipo, cliente.documento_numero, cliente.celular || null, cliente.email || null).run();
      }
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (msg.includes('UNIQUE')) {
        return Response.json({
          error: `Ese ${docTipo.toUpperCase()} ya está asociado a otra cuenta. Iniciá sesión con esa cuenta para continuar, o contactanos si te parece un error.`,
        }, { status: 409 });
      }
      throw err;
    }

    const categoriaRow = await db.prepare('SELECT id FROM categorias WHERE codigo = ?').bind(categoria).first();
    const categoriaId = categoriaRow ? categoriaRow.id : null;

    // Envío: precio de la zona con el descuento por volumen que corresponda —
    // o $0 si la zona es "retiro en local". Se recalcula acá, nunca se confía en
    // lo que mande el cliente, y queda congelado en el pedido.
    const { con_envio, costo_envio } = await calcularEnvio(db, zona_id, categoria, carillasTotal);
    const totalConEnvio = total + costo_envio;
    const configuracionInicial = JSON.stringify({ archivos, items });

    const insertTrabajo = await db.prepare(
      `INSERT INTO trabajos (user_id, configuracion, estado, total, direccion_entrega, fecha_entrega, zona_id, turno_entrega_id, categoria_id, con_envio, costo_envio, pagado)
       VALUES (?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(userId, configuracionInicial, totalConEnvio, direccion_entrega, fecha_entrega, zona_id, turno_entrega_id, categoriaId, con_envio ? 1 : 0, costo_envio).run();
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

    // Notificación al Panel — sin cambios respecto al código actual (ver
    // PROJECT_HANDOFF.md sección 8): sigue siendo un `await` simple sin
    // `ctx.waitUntil` (bloqueante) con catch silencioso. No se toca acá para
    // no mezclar ese pendiente ya conocido con el cambio de Fase 1.
    try {
      await fetch('https://99copias-panel.pages.dev/api/push/notificar-pedido', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-webhook-secret': env.PANEL_WEBHOOK_SECRET },
        body: JSON.stringify({ trabajo_id: trabajoId }),
      });
    } catch {
      // silencioso, igual que antes — ver deuda documentada en PROJECT_HANDOFF.md
    }

    return Response.json({ trabajo_id: trabajoId, total: totalConEnvio, subtotal_impresion: total, con_envio, costo_envio, items });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message || 'No se pudo crear el trabajo.' }, { status: 500 });
  }
}
