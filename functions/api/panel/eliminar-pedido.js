// functions/api/panel/eliminar-pedido.js
//
// Lo llama el PANEL cuando un operador elimina un pedido. Borrado DEFINITIVO y
// SILENCIOSO: no se le avisa al cliente. Mismo patrón que los otros endpoints
// de /api/panel/: secreto compartido en un header.
//
// CONTRATO para el Panel:
//   POST https://app.99copias.com.ar/api/panel/eliminar-pedido
//   Headers: x-panel-secret: <PANEL_TO_WIZARD_SECRET>
//   Body: { "trabajo_id": <int>, "confirmar_pagado"?: true }
//
//   - Si el pedido está PAGADO, hay que mandar "confirmar_pagado": true; sin eso
//     responde 409. Es una segunda barrera por si la UI del Panel falla: borrar un
//     pedido pagado deja un cobro (Mercado Pago o transferencia) sin pedido, y el
//     reembolso es manual.
//   - Respuestas: 200 { ok, ... } | 401 | 400 | 404 (ya no existe) | 409 | 500
//
// Qué borra:
//   D1: el trabajo y todo lo que lo referencia (pagos, notificaciones_enviadas,
//       mensajes_trabajo, y cualquier otra tabla con FK a trabajos — se detectan
//       solas), en UNA sola transacción (db.batch): o se borra todo o nada.
//   R2: trabajos/{id}/*, y el comprobante de transferencia si existe.
//   Mercado Pago: si había un checkout sin pagar, se intenta vencerlo (mejor
//       esfuerzo) para que un link o QR viejo no pueda cobrar un pedido inexistente.
//
// Qué NO borra a propósito:
//   - webhook_logs: tabla de diagnóstico sin FK. Si llega tarde un aviso de pago
//     de un pedido ya borrado, ahí queda el rastro del cobro.
//   - El usuario ni su perfil_fiscal: la cuenta del cliente sigue existiendo.
//
// El cupo de los turnos se libera solo: se calcula contando pedidos existentes.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Tablas hijas que conocemos. Se usan solo si existen en la D1 real, y se suman
// a las que se descubran por claves foráneas.
const HIJAS_CONOCIDAS = [
  { tabla: 'pagos', columna: 'trabajo_id' },
  { tabla: 'notificaciones_enviadas', columna: 'trabajo_id' },
  { tabla: 'mensajes_trabajo', columna: 'trabajo_id' },
];

async function descubrirTablasHijas(db) {
  const mapa = new Map();
  const agregar = (tabla, columna) => {
    if (IDENT.test(tabla) && IDENT.test(columna)) mapa.set(`${tabla}.${columna}`, { tabla, columna });
  };

  // 1) Las conocidas, solo si la tabla y la columna existen de verdad.
  for (const { tabla, columna } of HIJAS_CONOCIDAS) {
    try {
      const col = await db.prepare('SELECT 1 AS ok FROM pragma_table_info(?) WHERE name = ?').bind(tabla, columna).first();
      if (col) agregar(tabla, columna);
    } catch {
      agregar(tabla, columna); // si el PRAGMA no está disponible, confiar en la lista
    }
  }

  // 2) Cualquier otra tabla con FK a trabajos (para no chocar con una restricción
  //    que no conocíamos).
  try {
    const { results } = await db.prepare(
      `SELECT m.name AS tabla, f."from" AS columna
         FROM sqlite_master m, pragma_foreign_key_list(m.name) f
        WHERE m.type = 'table' AND f."table" = 'trabajos'`
    ).all();
    for (const r of results || []) agregar(r.tabla, r.columna);
  } catch (err) {
    console.error('[eliminar-pedido] No se pudieron descubrir FKs, se usa la lista conocida', err);
  }
  return [...mapa.values()];
}

async function listarArchivosR2(bucket, trabajoId) {
  const prefijo = `trabajos/${trabajoId}/`; // la barra final evita confundir 2 con 26
  const claves = [];
  let cursor;
  do {
    const res = await bucket.list({ prefix: prefijo, cursor });
    for (const o of res.objects || []) claves.push(o.key);
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return claves;
}

async function borrarDeR2(bucket, claves) {
  let borrados = 0;
  let fallidos = 0;
  for (let i = 0; i < claves.length; i += 1000) {
    const lote = claves.slice(i, i + 1000);
    try {
      await bucket.delete(lote);
      borrados += lote.length;
    } catch (err) {
      fallidos += lote.length;
      console.error('[eliminar-pedido] Falló el borrado de un lote de R2', err);
    }
  }
  return { borrados, fallidos };
}

// Mejor esfuerzo: vence la preference para que no se pueda pagar un pedido que ya
// no existe. [NO VERIFICADO contra la API real de MP — si falla, el pedido se borra igual.]
async function vencerPreferenceMP(env, preferenceId) {
  if (!env.MP_ACCESS_TOKEN || !preferenceId) return false;
  try {
    const ahora = new Date().toISOString();
    const res = await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(preferenceId)}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires: true, expiration_date_from: ahora, expiration_date_to: ahora }),
    });
    if (!res.ok) console.error('[eliminar-pedido] MP no pudo vencer la preference', res.status);
    return res.ok;
  } catch (err) {
    console.error('[eliminar-pedido] Error vencendo preference de MP', err);
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  const secretRecibido = request.headers.get('x-panel-secret');
  if (!env.PANEL_TO_WIZARD_SECRET || secretRecibido !== env.PANEL_TO_WIZARD_SECRET) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const trabajoId = Number(body.trabajo_id);
    if (!Number.isInteger(trabajoId) || trabajoId <= 0) {
      return Response.json({ error: 'Body inválido — se esperaba { trabajo_id }.' }, { status: 400 });
    }
    const db = env.DB;

    const trabajo = await db.prepare('SELECT id, pagado, configuracion FROM trabajos WHERE id = ?').bind(trabajoId).first();
    if (!trabajo) return Response.json({ error: 'El pedido no existe (¿ya fue eliminado?).' }, { status: 404 });

    if (trabajo.pagado && body.confirmar_pagado !== true) {
      return Response.json({
        error: 'El pedido está pagado. Para eliminarlo hay que confirmarlo explícitamente (confirmar_pagado: true).',
        pagado: true,
      }, { status: 409 });
    }

    // ---- 1) Juntar TODO lo que hay que limpiar, antes de borrar nada ----
    const claves = new Set(await listarArchivosR2(env.BUCKET, trabajoId));
    try {
      const cfg = JSON.parse(trabajo.configuracion || '{}');
      for (const a of cfg.archivos || []) {
        if (a && typeof a.r2_key === 'string' && a.r2_key.startsWith(`trabajos/${trabajoId}/`)) claves.add(a.r2_key);
      }
    } catch { /* configuracion ilegible: el listado por prefijo ya cubre los archivos */ }

    let preferencesSinPagar = [];
    try {
      const { results } = await db.prepare(
        'SELECT comprobante_r2_key, mp_preference_id, mp_status FROM pagos WHERE trabajo_id = ?'
      ).bind(trabajoId).all();
      for (const p of results || []) {
        if (p.comprobante_r2_key) claves.add(p.comprobante_r2_key);
        if (p.mp_preference_id && p.mp_status !== 'approved') preferencesSinPagar.push(p.mp_preference_id);
      }
    } catch (err) {
      console.error('[eliminar-pedido] No se pudieron leer los pagos del pedido', trabajoId, err);
    }

    // ---- 2) D1: hijas primero, el trabajo al final, todo en una transacción ----
    const hijas = await descubrirTablasHijas(db);
    const sentencias = hijas.map(({ tabla, columna }) =>
      db.prepare(`DELETE FROM ${tabla} WHERE ${columna} = ?`).bind(trabajoId)
    );
    sentencias.push(db.prepare('DELETE FROM trabajos WHERE id = ?').bind(trabajoId));
    await db.batch(sentencias);

    // ---- 3) Ya borrado de la base: limpiar archivos y vencer checkouts ----
    // (en este orden, un fallo acá deja archivos huérfanos, nunca un pedido
    // apuntando a archivos que ya no están)
    const r2 = await borrarDeR2(env.BUCKET, [...claves]);
    let checkoutsVencidos = 0;
    for (const id of preferencesSinPagar) if (await vencerPreferenceMP(env, id)) checkoutsVencidos++;

    console.log('[eliminar-pedido] Pedido eliminado', { trabajoId, pagado: !!trabajo.pagado, tablas: hijas.map((h) => h.tabla), r2 });

    return Response.json({
      ok: true,
      trabajo_id: trabajoId,
      tablas_limpiadas: hijas.map((h) => h.tabla),
      archivos_borrados: r2.borrados,
      archivos_con_error: r2.fallidos, // > 0: quedaron archivos huérfanos en R2, revisar en el dashboard
      checkouts_vencidos: checkoutsVencidos,
    });
  } catch (err) {
    console.error('[eliminar-pedido] Error eliminando pedido:', err);
    return Response.json({ error: 'No se pudo eliminar el pedido.' }, { status: 500 });
  }
}
