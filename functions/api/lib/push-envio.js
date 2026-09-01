// functions/api/lib/push-envio.js
//
// Envío de Web Push AL CLIENTE — separado del push del Panel (que es sólo
// para avisarte a vos de pedidos nuevos, con sus propias claves VAPID y su
// propia tabla push_subscriptions). Usa @mmmike/web-push, la misma librería
// que ya usa el Panel — la libraría "web-push" oficial de npm no corre en el
// runtime de Workers (PROJECT_HANDOFF.md sección 3), esta sí.

import { sendPushNotification, WebPushError } from '@mmmike/web-push';

/**
 * Manda un push a TODAS las suscripciones activas de un user_id. Si alguna
 * suscripción ya no es válida (404/410 — el navegador la dio de baja del
 * lado del usuario), se borra sola de la tabla, mismo criterio que ya
 * documenta el Panel para push_subscriptions.
 *
 * @param {{ DB: D1Database, VAPID_PUBLIC_KEY_CLIENTE: string,
 *   VAPID_PRIVATE_KEY_CLIENTE: string, VAPID_SUBJECT_CLIENTE: string }} env
 * @param {string} userId
 * @param {{ titulo: string, cuerpo: string, url?: string }} datos
 */
export async function enviarPushCliente(env, userId, datos) {
  if (!env.VAPID_PRIVATE_KEY_CLIENTE || !env.VAPID_PUBLIC_KEY_CLIENTE) {
    console.error('[push-cliente] Claves VAPID de cliente no configuradas.');
    return { enviados: 0 };
  }
  const { results: subs } = await env.DB.prepare(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions_cliente WHERE user_id = ?'
  ).bind(userId).all();

  if (!subs.length) return { enviados: 0 };

  const vapid = {
    subject: env.VAPID_SUBJECT_CLIENTE || 'mailto:no-reply@app.99copias.com.ar',
    publicKey: env.VAPID_PUBLIC_KEY_CLIENTE,
    privateKey: env.VAPID_PRIVATE_KEY_CLIENTE,
  };
  const payload = JSON.stringify({
    title: datos.titulo,
    body: datos.cuerpo,
    url: datos.url || '/mis-pedidos/',
  });

  let enviados = 0;
  await Promise.all(subs.map(async (sub) => {
    const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    try {
      await sendPushNotification(subscription, payload, vapid);
      enviados++;
    } catch (err) {
      const status = err instanceof WebPushError ? err.statusCode : null;
      if (status === 404 || status === 410) {
        // La suscripción ya no existe del lado del navegador — se limpia sola.
        await env.DB.prepare('DELETE FROM push_subscriptions_cliente WHERE id = ?').bind(sub.id).run();
      } else {
        // No logueamos sub.endpoint: es una capability URL (cualquiera que
        // la tenga puede mandar push a ese dispositivo) — nota explícita de
        // la propia librería. Usamos el id interno para poder rastrear el
        // problema sin exponerla en los logs.
        console.error('[push-cliente] Error enviando a la suscripción id', sub.id, err.message || err);
      }
    }
  }));
  return { enviados };
}
