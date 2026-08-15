// functions/api/panel/comprobante-revisado.js
//
// Lo llama el PANEL cuando un operador aprueba o rechaza un comprobante de
// transferencia — dirección inversa a la que ya existe (trabajos.js ->
// notificar-pedido del Panel). Mismo patrón: secreto compartido en un header.
//
// CONTRATO para el Panel (documentar en CONTEXTO_PANEL_ADMIN.md):
//   POST https://app.99copias.com.ar/api/panel/comprobante-revisado
//   Headers: x-panel-secret: <PANEL_TO_WIZARD_SECRET>
//   Body: { "trabajo_id": <int>, "aprobado": true|false, "motivo_rechazo"?: string }

import { notificarEventoTrabajo } from '../lib/notificaciones.js';

export async function onRequestPost({ request, env }) {
  const secretRecibido = request.headers.get('x-panel-secret');
  if (!env.PANEL_TO_WIZARD_SECRET || secretRecibido !== env.PANEL_TO_WIZARD_SECRET) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }
  try {
    const { trabajo_id, aprobado, motivo_rechazo } = await request.json();
    if (!trabajo_id || typeof aprobado !== 'boolean') {
      return Response.json({ error: 'Body inválido — se esperaba { trabajo_id, aprobado }.' }, { status: 400 });
    }
    const db = env.DB;
    const pago = await db.prepare("SELECT id FROM pagos WHERE trabajo_id = ? AND medio = 'transferencia'").bind(trabajo_id).first();
    if (!pago) return Response.json({ error: 'No hay un pago por transferencia para ese trabajo.' }, { status: 404 });

    await db.prepare(
      `UPDATE pagos SET estado_revision = ?, motivo_rechazo = ?, revisado_en = datetime('now') WHERE id = ?`
    ).bind(aprobado ? 'aprobado' : 'rechazado', aprobado ? null : (motivo_rechazo || null), pago.id).run();

    if (aprobado) {
      // Mismo efecto que produce el webhook de Mercado Pago al aprobar un
      // pago — pagado=1 y pasa a en_proceso. No se toca nada del código de
      // MP, esto es una rama nueva y paralela.
      await db.prepare(
        "UPDATE trabajos SET pagado = 1, estado = CASE WHEN estado = 'pendiente' THEN 'en_proceso' ELSE estado END WHERE id = ?"
      ).bind(trabajo_id).run();
    }

    await notificarEventoTrabajo(env, trabajo_id, aprobado ? 'pago_aprobado' : 'pago_rechazado', { medioPago: 'transferencia' });

    return Response.json({ ok: true });
  } catch (err) {
    console.error('Error procesando revisión de comprobante:', err);
    return Response.json({ error: 'No se pudo procesar la revisión.' }, { status: 500 });
  }
}