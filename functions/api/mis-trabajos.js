// functions/api/mis-trabajos.js — Fase 2.
//
// GET  /api/mis-trabajos              -> lista los pedidos del user_id de la sesión
// GET  /api/mis-trabajos?id=<id>      -> detalle de un pedido puntual (con dueño verificado)

import { createAuth } from './lib/auth.js';

export async function onRequestGet({ request, env }) {
  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json({ error: 'Sesión inválida.' }, { status: 401 });
    }
    const userId = sessionData.user.id;
    const db = env.DB;
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    if (id) {
      const trabajo = await db.prepare(
        `SELECT t.id, t.configuracion, t.estado, t.total, t.direccion_entrega, t.fecha_entrega,
                t.pagado, t.creado_en, t.con_envio, t.costo_envio,
                c.codigo as categoria, c.nombre as categoria_nombre,
                z.nombre as zona_nombre, te.hora_inicio, te.hora_fin,
                p.medio as pago_medio, p.estado_revision as pago_estado_revision,
                p.motivo_rechazo as pago_motivo_rechazo, p.mp_status
         FROM trabajos t
         LEFT JOIN categorias c ON c.id = t.categoria_id
         LEFT JOIN zonas z ON z.id = t.zona_id
         LEFT JOIN turnos_entrega te ON te.id = t.turno_entrega_id
         LEFT JOIN pagos p ON p.trabajo_id = t.id
         WHERE t.id = ? AND t.user_id = ?`
      ).bind(id, userId).first();
      if (!trabajo) return Response.json({ error: 'Pedido no encontrado.' }, { status: 404 });
      let configuracion = {};
      try { configuracion = JSON.parse(trabajo.configuracion || '{}'); } catch { /* queda vacío si el JSON está corrupto */ }
      return Response.json({ ...trabajo, configuracion });
    }

    const { results } = await db.prepare(
      `SELECT t.id, t.estado, t.total, t.pagado, t.creado_en, t.fecha_entrega,
              c.codigo as categoria, c.nombre as categoria_nombre,
              p.medio as pago_medio, p.estado_revision as pago_estado_revision
       FROM trabajos t
       LEFT JOIN categorias c ON c.id = t.categoria_id
       LEFT JOIN pagos p ON p.trabajo_id = t.id
       WHERE t.user_id = ?
       ORDER BY t.id DESC`
    ).bind(userId).all();
    return Response.json(results);
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'No se pudieron cargar tus pedidos.' }, { status: 500 });
  }
}