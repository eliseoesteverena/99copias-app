// functions/api/panel/mensaje-nuevo.js
//
// Lo llama el PANEL después de guardar un mensaje de operador en
// mensajes_trabajo (esa escritura ya la hace directo contra la D1
// compartida, sin pasar por acá — ver CONTRATO_ENDPOINTS_PANEL_A_WIZARD.md).
// Este endpoint SÓLO dispara la notificación al cliente, no escribe nada.
//
// CONTRATO (ya confirmado con la conversación del Panel):
//   POST https://app.99copias.com.ar/api/panel/mensaje-nuevo
//   Headers: x-panel-secret: <PANEL_TO_WIZARD_SECRET>
//   Body: { "trabajo_id": <int>, "mensaje": "<texto del mensaje>" }
//
// Si este endpoint no existe o falla, el mensaje ya quedó guardado en
// mensajes_trabajo igual — el Panel no depende de esta llamada para nada
// más que la notificación en sí (mismo criterio que los otros dos).

import { notificarEventoTrabajo } from '../lib/notificaciones.js';

export async function onRequestPost({ request, env }) {
  const secretRecibido = request.headers.get('x-panel-secret');
  if (!env.PANEL_TO_WIZARD_SECRET || secretRecibido !== env.PANEL_TO_WIZARD_SECRET) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }
  try {
    const { trabajo_id, mensaje } = await request.json();
    if (!trabajo_id || !mensaje) {
      return Response.json({ error: 'Body inválido — se esperaba { trabajo_id, mensaje }.' }, { status: 400 });
    }
    await notificarEventoTrabajo(env, trabajo_id, 'mensaje_nuevo', { mensaje });
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Error procesando aviso de mensaje nuevo:', err);
    return Response.json({ error: 'No se pudo procesar el aviso.' }, { status: 500 });
  }
}
