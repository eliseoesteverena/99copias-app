// functions/api/push/vapid-public-key.js
// Endpoint público (sin sesión) — sirve la clave pública VAPID de cliente
// desde la variable de entorno real, para que push-client.js no dependa de
// un valor hardcodeado en un archivo estático que se puede desincronizar de
// lo que realmente está cargado en Cloudflare.
export async function onRequestGet({ env }) {
  return Response.json({ publicKey: env.VAPID_PUBLIC_KEY_CLIENTE || null });
}