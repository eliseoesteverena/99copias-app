// functions/api/push/desuscribir.js — el cliente desactiva notificaciones.
import { createAuth } from '../lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json({ error: 'Sesión inválida.' }, { status: 401 });
    }
    const { endpoint } = await request.json();
    if (!endpoint) return Response.json({ error: 'Falta endpoint.' }, { status: 400 });
    // Sólo se borra si pertenece al usuario de la sesión actual — evita que
    // alguien borre la suscripción de otra persona adivinando un endpoint.
    await env.DB.prepare(
      'DELETE FROM push_subscriptions_cliente WHERE endpoint = ? AND user_id = ?'
    ).bind(endpoint, sessionData.user.id).run();
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'No se pudo dar de baja la suscripción.' }, { status: 500 });
  }
}