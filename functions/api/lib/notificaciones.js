// functions/api/lib/notificaciones.js
//
// Motor de despacho de notificaciones al CLIENTE (no al Panel — esa
// notificación es otra, ver trabajos.js). Implementa la matriz acordada:
//
//   Con push activado:
//     - push: TODOS los eventos (creado, pago_aprobado, pago_rechazado,
//       listo, entregado, mensaje_nuevo)
//     - email: sólo pago_aprobado si medio==='mercadopago', y entregado
//       (refuerzo puntual en los dos hitos de "esto es dinero" / "esto es
//       el objeto físico")
//   Sin push activado:
//     - email: TODOS los eventos
//
// Idempotente vía notificaciones_enviadas para los 5 eventos de estado del
// pedido — no reenvía si (trabajo_id, tipo_evento, canal) ya se mandó antes
// (protege contra reintentos de webhooks de Mercado Pago). `mensaje_nuevo`
// queda AFUERA de esa idempotencia a propósito: cada mensaje es un evento
// distinto con el mismo trabajo_id, así que la clave (trabajo_id,
// tipo_evento, canal) bloquearía cualquier mensaje después del primero si
// se usara ahí — ver nota en notificarEventoTrabajo().
//
// Textos específicos por evento — CONTRATO_ENDPOINTS_PANEL_A_WIZARD.md pidió
// reemplazar los genéricos ("Tenés novedades de tu pedido") por texto
// puntual por evento, con el número de pedido y el motivo cuando aplica.

import { enviarEmail, plantillaBase } from './email.js';
import { enviarPushCliente } from './push-envio.js';

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function textosEvento(tipoEvento, trabajoId, contexto) {
  switch (tipoEvento) {
    case 'creado':
      return {
        push: { titulo: '¡Pedido recibido!', cuerpo: `Ya tenemos tu pedido #${trabajoId} — te avisamos cuando avance.` },
        email: {
          subject: 'Recibimos tu pedido — 99copias',
          cuerpo: `<p>Recibimos tu pedido #${trabajoId} y ya lo tenemos en cola. Te vamos a avisar apenas se confirme el pago y cuando esté listo.</p>`,
        },
      };
    case 'pago_aprobado':
      return {
        push: { titulo: '¡Pago confirmado!', cuerpo: `Tu pedido #${trabajoId} ya está en proceso.` },
        email: {
          subject: 'Pago confirmado — 99copias',
          cuerpo: `<p>¡Tu comprobante fue aprobado! Confirmamos tu pago${contexto.medioPago === 'transferencia' ? ' por transferencia' : ''} y tu pedido #${trabajoId} ya está en proceso.</p>`,
        },
      };
    case 'pago_rechazado':
      return {
        push: {
          titulo: 'No pudimos confirmar el pago',
          cuerpo: contexto.motivoRechazo ? `Pedido #${trabajoId} — motivo: ${contexto.motivoRechazo}` : `Revisá el estado de tu pedido #${trabajoId}.`,
        },
        email: {
          subject: 'No pudimos confirmar tu pago — 99copias',
          cuerpo: `<p>${contexto.motivoRechazo ? `Tu comprobante fue rechazado: ${escapeHtml(contexto.motivoRechazo)}.` : 'No pudimos confirmar el pago de tu pedido.'} Podés volver a subirlo desde "Mis pedidos".</p>`,
        },
      };
    case 'listo':
      return {
        push: { titulo: '¡Tu pedido está listo!', cuerpo: `El pedido #${trabajoId} ya está listo.` },
        email: {
          subject: 'Tu pedido está listo — 99copias',
          cuerpo: `<p>¡Tu pedido #${trabajoId} ya está listo! Si elegiste retiro, ya lo podés pasar a buscar. Si es envío, coordinamos la entrega.</p>`,
        },
      };
    case 'entregado':
      return {
        push: { titulo: '¡Pedido entregado!', cuerpo: `Tu pedido #${trabajoId} fue entregado. ¡Gracias!` },
        email: {
          subject: 'Tu pedido fue entregado — 99copias',
          cuerpo: `<p>Tu pedido #${trabajoId} fue entregado. ¡Gracias por elegir 99copias!</p>`,
        },
      };
    case 'mensaje_nuevo': {
      const textoCorto = (contexto.mensaje || '').slice(0, 100);
      return {
        push: { titulo: `Nuevo mensaje sobre tu pedido #${trabajoId}`, cuerpo: textoCorto },
        email: {
          subject: `Nuevo mensaje sobre tu pedido #${trabajoId} — 99copias`,
          cuerpo: `<p>${escapeHtml(contexto.mensaje || '')}</p>`,
        },
      };
    }
    default:
      return null;
  }
}

async function yaEnviado(db, trabajoId, tipoEvento, canal) {
  const row = await db.prepare(
    'SELECT 1 FROM notificaciones_enviadas WHERE trabajo_id = ? AND tipo_evento = ? AND canal = ?'
  ).bind(trabajoId, tipoEvento, canal).first();
  return !!row;
}
async function marcarEnviado(db, trabajoId, tipoEvento, canal) {
  await db.prepare(
    'INSERT OR IGNORE INTO notificaciones_enviadas (trabajo_id, tipo_evento, canal) VALUES (?, ?, ?)'
  ).bind(trabajoId, tipoEvento, canal).run();
}

/**
 * Punto de entrada único — se llama desde trabajos.js, webhooks/mercadopago.js,
 * y los tres endpoints que llama el Panel (comprobante revisado, estado
 * actualizado, mensaje nuevo). No lanza si algo falla — un mail/push que no
 * sale no debe romper el flujo de negocio que lo disparó.
 *
 * @param {string} tipoEvento 'creado'|'pago_aprobado'|'pago_rechazado'|'listo'|'entregado'|'mensaje_nuevo'
 * @param {{ medioPago?: 'mercadopago'|'transferencia', motivoRechazo?: string, mensaje?: string }} contexto
 */
export async function notificarEventoTrabajo(env, trabajoId, tipoEvento, contexto = {}) {
  const db = env.DB;
  // mensaje_nuevo no usa la tabla de idempotencia — cada mensaje es un
  // evento distinto con el mismo trabajo_id, y la clave (trabajo_id,
  // tipo_evento, canal) de esa tabla bloquearía cualquier mensaje después
  // del primero si se la usara acá tal cual.
  const usaIdempotencia = tipoEvento !== 'mensaje_nuevo';

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

    const textos = textosEvento(tipoEvento, trabajoId, contexto);
    if (!textos) { console.error('[notificaciones] tipo_evento desconocido:', tipoEvento); return; }

    // --- Push: siempre que haya suscripción, para TODOS los eventos ---
    if (tienePush && (!usaIdempotencia || !(await yaEnviado(db, trabajoId, tipoEvento, 'push')))) {
      const { enviados } = await enviarPushCliente(env, userId, {
        titulo: textos.push.titulo,
        cuerpo: textos.push.cuerpo,
        url: '/mis-pedidos/?trabajo=' + trabajoId,
      });
      if (enviados > 0 && usaIdempotencia) await marcarEnviado(db, trabajoId, tipoEvento, 'push');
    }

    // --- Email: todos los eventos si NO hay push; sólo pago_aprobado
    //     (mercadopago) + entregado si SÍ hay push (mensaje_nuevo nunca
    //     entra acá con push activado — el push ya alcanza) ---
    const emailAplicaConPush = tipoEvento === 'entregado'
      || (tipoEvento === 'pago_aprobado' && contexto.medioPago === 'mercadopago');
    const debeMandarEmail = tienePush ? emailAplicaConPush : true;

    if (debeMandarEmail && emailDestino && (!usaIdempotencia || !(await yaEnviado(db, trabajoId, tipoEvento, 'email')))) {
      const html = plantillaBase({
        titulo: textos.email.subject,
        cuerpoHtml: textos.email.cuerpo,
        trabajoId,
      });
      const resultado = await enviarEmail(env, { to: emailDestino, subject: textos.email.subject, html });
      if (resultado.ok && usaIdempotencia) await marcarEnviado(db, trabajoId, tipoEvento, 'email');
    }
  } catch (err) {
    console.error('[notificaciones] Error notificando evento', tipoEvento, 'trabajo', trabajoId, err);
  }
}
