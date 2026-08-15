// functions/api/push/suscribir.js
//
// El cliente (no el operador — eso es el Panel) da permiso de notificaciones
// en su navegador y el frontend (push-client.js) manda acá la suscripción
// resultante para guardarla contra su user_id (sesión de Better Auth).

import { createAuth } from '../lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json({ error: 'Sesión inválida.' }, { status: 401 });
    }
    const body = await request.json();
    const { endpoint, keys } = body || {};
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return Response.json({ error: 'Suscripción incompleta.' }, { status: 400 });
    }
    // Una misma suscripción (mismo endpoint = mismo navegador/dispositivo)
    // puede volver a mandarse (ej. el usuario cerró y volvió a abrir la
    // app) — se actualiza en vez de duplicar, gracias al UNIQUE(endpoint).
    await env.DB.prepare(
      `INSERT INTO push_subscriptions_cliente (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
    ).bind(sessionData.user.id, endpoint, keys.p256dh, keys.auth).run();

    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'No se pudo guardar la suscripción.' }, { status: 500 });
  }
}