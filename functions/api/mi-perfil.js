// functions/api/mi-perfil.js
//
// Sólo lectura — alimenta el pre-fill de Fase 1 (Caso C: cliente logueado
// recurrente, sección 5 de HANDOFF_AUTENTICACION_Y_FLUJO.md):
//   - perfil_fiscal para colapsar el paso de Datos con "editar".
//   - la zona/turno del último pedido, para pre-seleccionar (no ocultar) el
//     paso de Entrega.
// Invitados y usuarios sin pedidos previos reciben { perfil: null,
// ultima_entrega: null } — nunca un error, así el frontend no necesita un
// caso especial para "todavía no hay nada que precargar".

import { createAuth } from './lib/auth.js';

export async function onRequestGet({ request, env }) {
  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json({ perfil: null, ultima_entrega: null });
    }

    const userId = sessionData.user.id;
    const db = env.DB;

    const perfil = await db.prepare(
      `SELECT nombre, apellido, documento_tipo, documento_numero, celular, email_contacto
       FROM perfil_fiscal WHERE user_id = ?`
    ).bind(userId).first();

    const ultimoTrabajo = await db.prepare(
      'SELECT zona_id, turno_entrega_id FROM trabajos WHERE user_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(userId).first();

    return Response.json({
      perfil: perfil || null,
      ultima_entrega: ultimoTrabajo
        ? { zona_id: ultimoTrabajo.zona_id, turno_entrega_id: ultimoTrabajo.turno_entrega_id }
        : null,
    });
  } catch (err) {
    console.error(err);
    // No bloqueamos el wizard por esto — sin pre-fill, el flujo de invitado
    // sigue funcionando igual.
    return Response.json({ perfil: null, ultima_entrega: null });
  }
}
