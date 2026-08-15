// functions/api/lib/notificaciones.js
//
// Motor de despacho de notificaciones al CLIENTE (no al Panel — esa
// notificación es otra, ver trabajos.js). Implementa la matriz acordada:
//
//   Con push activado:
//     - push: TODOS los eventos (creado, pago_aprobado, pago_rechazado,
//       listo, entregado)
//     - email: sólo pago_aprobado si medio==='mercadopago', y entregado
//       (refuerzo puntual en los dos hitos de "esto es dinero" / "esto es
//       el objeto físico" — no en transferencia aprobada ni en "listo")
//   Sin push activado:
//     - email: TODOS los eventos
//
// Idempotente vía notificaciones_enviadas — no reenvía si (trabajo_id,
// tipo_evento, canal) ya se mandó antes (protege contra reintentos de
// webhooks de Mercado Pago, ver PROJECT_HANDOFF.md sección 10).

import { enviarEmail, plantillaBase } from './email.js';
import { enviarPushCliente } from './push-cliente.js';

const TEXTOS = {
  creado: {
    push: { titulo: '¡Pedido recibido!', cuerpo: 'Ya tenemos tu pedido — te avisamos cuando avance.' },
    email: {
      subject: 'Recibimos tu pedido — 99copias',
      cuerpo: (t) => `<p>Recibimos tu pedido y ya lo tenemos en cola. Te vamos a avisar apenas se confirme el pago y cuando esté listo.</p>`,
    },
  },
  pago_aprobado: {
    push: { titulo: '¡Pago confirmado!', cuerpo: 'Tu pedido pasó a producción.' },
    email: {
      subject: 'Pago confirmado — 99copias',
      cuerpo: (t) => `<p>Confirmamos tu pago${t.medioPago === 'transferencia' ? ' por transferencia' : ''} y tu pedido ya pasó a producción.</p>`,
    },
  },
  pago_rechazado: {
    push: { titulo: 'No pudimos confirmar el pago', cuerpo: 'Revisá el estado de tu pedido.' },
    email: {
      subject: 'No pudimos confirmar tu pago — 99copias',
      cuerpo: () => `<p>No pudimos confirmar el pago de tu pedido. Podés intentar de nuevo desde "Mis pedidos", o escribirnos si tenés dudas.</p>`,
    },
  },
  listo: {
    push: { titulo: '¡Tu pedido está listo!', cuerpo: 'Ya podés coordinarlo / te lo llevamos.' },
    email: {
      subject: 'Tu pedido está listo — 99copias',
      cuerpo: () => `<p>¡Tu pedido ya está listo! Si elegiste retiro, ya lo podés pasar a buscar. Si es envío, coordinamos la entrega.</p>`,
    },
  },
  entregado: {
    push: { titulo: '¡Pedido entregado!', cuerpo: 'Gracias por elegirnos.' },
    email: {
      subject: 'Tu pedido fue entregado — 99copias',
      cuerpo: () => `<p>Tu pedido ya fue entregado. ¡Gracias por elegir 99copias!</p>`,
    },
  },
};

async function yaEnviado(db, trabajoId, tipoEvento, canal) {
  const row = await db.prepare(
    'SELECT 1 FROM notificaciones_enviadas WHERE trabajo_id = ? AND tipo_evento = ? AND canal = ?'
  ).bind(trabajoId, tipoEvento, canal).first();
  return !!row;
}
async function marcarEnviado(db, trabajoId, tipoEvento, canal) {
  // INSERT OR IGNORE: si dos requests concurrentes llegan a la vez, el
  // UNIQUE(trabajo_id, tipo_evento, canal) de la tabla evita duplicar la fila
  // — la segunda simplemente no inserta nada, sin error.
  await db.prepare(
    'INSERT OR IGNORE INTO notificaciones_enviadas (trabajo_id, tipo_evento, canal) VALUES (?, ?, ?)'
  ).bind(trabajoId, tipoEvento, canal).run();
}

/**
 * Punto de entrada único — se llama desde trabajos.js, webhooks/mercadopago.js,
 * y los endpoints nuevos que llama el Panel (comprobante revisado, estado
 * actualizado). No lanza si algo falla — un mail/push que no sale no debe
 * romper el flujo de negocio que lo disparó.
 *
 * @param {string} tipoEvento 'creado'|'pago_aprobado'|'pago_rechazado'|'listo'|'entregado'
 * @param {{ medioPago?: 'mercadopago'|'transferencia' }} contexto
 */
export async function notificarEventoTrabajo(env, trabajoId, tipoEvento, contexto = {}) {
  const db = env.DB;
  try {
    const trabajo = await db.prepare(
      'SELECT user_id FROM trabajos WHERE id = ?'
    ).bind(trabajoId).first();
    if (!trabajo || !trabajo.user_id) return;
    const userId = trabajo.user_id;

    const perfil = await db.prepare(
      'SELECT nombre, email_contacto FROM perfil_fiscal WHERE user_id = ?'
    ).bind(userId).first();
    const usuario = await db.prepare('SELECT email FROM "user" WHERE id = ?').bind(userId).first();
    const emailDestino = (perfil && perfil.email_contacto) || (usuario && usuario.email) || null;

    const { results: subs } = await db.prepare(
      'SELECT id FROM push_subscriptions_cliente WHERE user_id = ?'
    ).bind(userId).all();
    const tienePush = subs.length > 0;

    const textos = TEXTOS[tipoEvento];
    if (!textos) { console.error('[notificaciones] tipo_evento desconocido:', tipoEvento); return; }

    // --- Push: siempre que haya suscripción, para TODOS los eventos ---
    if (tienePush && !(await yaEnviado(db, trabajoId, tipoEvento, 'push'))) {
      const { enviados } = await enviarPushCliente(env, userId, {
        titulo: textos.push.titulo,
        cuerpo: textos.push.cuerpo,
        url: '/mis-pedidos/?trabajo=' + trabajoId,
      });
      if (enviados > 0) await marcarEnviado(db, trabajoId, tipoEvento, 'push');
    }

    // --- Email: todos los eventos si NO hay push; sólo pago_aprobado
    //     (mercadopago) + entregado si SÍ hay push ---
    const emailAplicaConPush = tipoEvento === 'entregado'
      || (tipoEvento === 'pago_aprobado' && contexto.medioPago === 'mercadopago');
    const debeMandarEmail = tienePush ? emailAplicaConPush : true;

    if (debeMandarEmail && emailDestino && !(await yaEnviado(db, trabajoId, tipoEvento, 'email'))) {
      const html = plantillaBase({
        titulo: textos.email.subject,
        cuerpoHtml: textos.email.cuerpo({ medioPago: contexto.medioPago }),
        trabajoId,
      });
      const resultado = await enviarEmail(env, { to: emailDestino, subject: textos.email.subject, html });
      if (resultado.ok) await marcarEnviado(db, trabajoId, tipoEvento, 'email');
    }
  } catch (err) {
    // Nunca dejamos que un fallo acá tumbe el flujo que la llamó (creación
    // de pedido, webhook de MP, etc.) — mismo criterio que ya usa este
    // proyecto para la notificación al Panel.
    console.error('[notificaciones] Error notificando evento', tipoEvento, 'trabajo', trabajoId, err);
  }
}