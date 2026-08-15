// functions/api/pago-transferencia.js
//
// Equivalente a checkout.js pero para transferencia en vez de Mercado Pago:
// crea la fila en `pagos` (medio='transferencia', estado_revision='pendiente')
// sin llamar a ninguna API externa. El comprobante se sube aparte (ver
// comprobante.js) — desde acá sólo se arma el registro de que existe un pago
// pendiente de revisión.

import { createAuth } from './lib/auth.js';

export async function onRequestPost({ request, env }) {
  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json({ error: 'Sesión inválida.' }, { status: 401 });
    }
    const { trabajo_id } = await request.json();
    if (!trabajo_id) return Response.json({ error: 'Falta trabajo_id.' }, { status: 400 });

    const db = env.DB;
    const trabajo = await db.prepare('SELECT id, user_id, total FROM trabajos WHERE id = ?').bind(trabajo_id).first();
    if (!trabajo) return Response.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    // Mismo criterio de pertenencia que el resto de los endpoints nuevos de
    // Fase 2/3/4 — nadie puede iniciar un pago sobre un pedido ajeno.
    if (trabajo.user_id !== sessionData.user.id) {
      return Response.json({ error: 'Este pedido no pertenece a tu cuenta.' }, { status: 403 });
    }

    // Si ya había una fila de pago para este trabajo (ej. el cliente volvió
    // atrás y cambió de medio de pago), la reemplazamos en vez de acumular
    // filas huérfanas — un trabajo tiene un solo intento de pago "activo".
    const existente = await db.prepare('SELECT id FROM pagos WHERE trabajo_id = ?').bind(trabajo_id).first();
    if (existente) {
      await db.prepare(
        `UPDATE pagos SET medio = 'transferencia', estado_revision = 'pendiente',
         comprobante_r2_key = NULL, motivo_rechazo = NULL, revisado_en = NULL,
         monto = ?, moneda = 'ARS'
         WHERE id = ?`
      ).bind(trabajo.total, existente.id).run();
    } else {
      await db.prepare(
        `INSERT INTO pagos (trabajo_id, medio, estado_revision, monto, moneda, external_reference)
         VALUES (?, 'transferencia', 'pendiente', ?, 'ARS', ?)`
      ).bind(trabajo_id, trabajo.total, String(trabajo_id)).run();
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'No se pudo iniciar el pago por transferencia.' }, { status: 500 });
  }
}