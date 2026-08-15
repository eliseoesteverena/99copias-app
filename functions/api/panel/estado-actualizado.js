// functions/api/panel/estado-actualizado.js
//
// Lo llama el PANEL cuando un operador cambia el estado de un trabajo a
// 'listo' o 'entregado' (esas dos transiciones son manuales, ver
// PROJECT_HANDOFF.md sección 9 — "no hay ninguna UI en el Wizard para
// setearlos"). Dispara la notificación al cliente correspondiente.
//
// CONTRATO para el Panel:
//   POST https://app.99copias.com.ar/api/panel/estado-actualizado
//   Headers: x-panel-secret: <PANEL_TO_WIZARD_SECRET>
//   Body: { "trabajo_id": <int>, "estado": "listo" | "entregado" }
//
// El Panel sigue siendo dueño de escribir trabajos.estado directamente en la
// D1 compartida, como ya hace hoy — este endpoint NO escribe estado, sólo
// dispara el aviso. Si en algún momento el Panel deja de escribir estado
// directo y prefiere que este endpoint lo haga, hay que coordinarlo aparte
// para no tener dos caminos escribiendo la misma columna.

import { notificarEventoTrabajo } from '../lib/notificaciones.js';

export async function onRequestPost({ request, env }) {
  const secretRecibido = request.headers.get('x-panel-secret');
  if (!env.PANEL_TO_WIZARD_SECRET || secretRecibido !== env.PANEL_TO_WIZARD_SECRET) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }
  try {
    const { trabajo_id, estado } = await request.json();
    if (!trabajo_id || !['listo', 'entregado'].includes(estado)) {
      return Response.json({ error: "Body inválido — estado debe ser 'listo' o 'entregado'." }, { status: 400 });
    }
    await notificarEventoTrabajo(env, trabajo_id, estado, {});
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Error procesando actualización de estado:', err);
    return Response.json({ error: 'No se pudo procesar la actualización.' }, { status: 500 });
  }
}