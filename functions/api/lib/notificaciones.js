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
// se usara ahí.
//
// ─────────────────────────────────────────────────────────────────────────
// DE DÓNDE SALE CADA DATO DEL MAIL (verificado contra trabajos.js + app.js)
//
//   trabajos.configuracion = { archivos: [...], items: [...] }
//     · archivos[i]  = lo que manda el frontend (armarPayloadTrabajo):
//         nombre, paginas, copias, rango, faz, paginas_por_carilla,
//         primario (CÓDIGO de producto), acabado (CÓDIGO), r2_key
//     · items[i]     = salida de calcularPrecio() — mismo orden que archivos[].
//         Se usa para el subtotal por archivo: items[i].total (verificado).
//   trabajos.total / costo_envio / con_envio / direccion_entrega / fecha_entrega
//   zonas.nombre / es_retiro        (vía trabajos.zona_id)
//   turnos_entrega + turnos_excepciones (horario real de ESA fecha)
//   productos.descripcion           (vía codigo — nombre legible del producto)
//   perfil_fiscal.nombre / email_contacto, "user".email (fallback)
//   contexto.medioPago / motivoRechazo / mensaje  → los pasa quien dispara el evento
// ─────────────────────────────────────────────────────────────────────────

import {
  enviarEmail, plantillaBase, escapeHtml, formatoPesos,
  aviso, seccion, filasDetalle, trackerEstado, APP_URL,
} from './email.js';
import { enviarPushCliente } from './push-envio.js';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** 'YYYY-MM-DD' -> 'martes 12 de noviembre' (sin Intl, a prueba de runtime). */
function fechaLarga(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const dia = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return `${DIAS[dia]} ${d} de ${MESES[m - 1]}`;
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// El plugin `anonymous` de Better Auth le asigna a cada invitado un email
// descartable (tipo "temp-<id>@<dominio>"). Mandarle un mail a esa dirección
// rebota y daña la reputación del dominio en Resend. [VERIFICAR en lib/auth.js
// el formato exacto que genera tu configuración.]
function esEmailTemporal(email) {
  return /^temp[-_@]/i.test(email || '');
}

function emailUsable(email) {
  return !!email && REGEX_EMAIL.test(email) && !esEmailTemporal(email);
}

// Motivos de rechazo de Mercado Pago (campo status_detail) -> texto para el
// cliente. Si llega un código que no conocemos NO se muestra crudo
// ("cc_rejected_xyz" no le dice nada a nadie): se omite el motivo.
const MOTIVOS_MP = {
  cc_rejected_insufficient_amount: 'la tarjeta no tiene fondos suficientes',
  cc_rejected_bad_filled_security_code: 'el código de seguridad es incorrecto',
  cc_rejected_bad_filled_date: 'la fecha de vencimiento es incorrecta',
  cc_rejected_bad_filled_other: 'algún dato de la tarjeta es incorrecto',
  cc_rejected_call_for_authorize: 'tu banco necesita que autorices el pago',
  cc_rejected_card_disabled: 'la tarjeta está inhabilitada',
  cc_rejected_max_attempts: 'superaste el máximo de intentos',
  cc_rejected_high_risk: 'el pago fue rechazado por seguridad',
  cc_rejected_duplicated_payment: 'ya realizaste un pago igual',
  cc_rejected_other_reason: 'tu banco no procesó el pago',
};

/** Texto legible del motivo, o null si no hay uno presentable. */
function humanizarMotivo(m) {
  if (!m) return null;
  const s = String(m).trim();
  if (MOTIVOS_MP[s]) return MOTIVOS_MP[s];
  if (/^[a-z0-9_]+$/.test(s)) return null; // código técnico desconocido
  return s; // texto libre (ej. motivo escrito por el operador al rechazar un comprobante)
}

function prettyCodigo(c) { return String(c || '').replace(/_/g, ' '); }

// "Impresión ByN A4 (carilla)" -> "Impresión ByN A4"
function limpiarDescripcion(d) {
  return String(d || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function nombreDeKey(key) {
  if (!key) return null;
  return String(key).split('/').pop().replace(/^\d+-/, '');
}

// ---------------------------------------------------------------------------
// Lectura del pedido
// ---------------------------------------------------------------------------

function parseConfiguracion(raw) {
  try {
    const cfg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      archivos: Array.isArray(cfg && cfg.archivos) ? cfg.archivos : [],
      items: Array.isArray(cfg && cfg.items) ? cfg.items : [],
    };
  } catch {
    return { archivos: [], items: [] };
  }
}

async function cargarDescripciones(db, codigos) {
  const lista = [...new Set(codigos.filter(Boolean))];
  if (!lista.length) return {};
  try {
    const marcas = lista.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT codigo, descripcion FROM productos WHERE codigo IN (${marcas})`
    ).bind(...lista).all();
    const mapa = {};
    for (const r of results || []) mapa[r.codigo] = limpiarDescripcion(r.descripcion);
    return mapa;
  } catch (err) {
    console.error('[notificaciones] No se pudieron leer descripciones de productos', err);
    return {};
  }
}

/**
 * Carga todo lo necesario para el detalle del mail. Nunca lanza: devuelve null
 * si algo falla, y el mail sale igual sin detalle.
 */
async function cargarPedido(db, trabajoId) {
  try {
    const t = await db.prepare(
      `SELECT t.total, t.pagado, t.costo_envio, t.direccion_entrega, t.fecha_entrega,
              t.configuracion,
              z.nombre AS zona_nombre, z.es_retiro,
              te.hora_inicio, te.hora_fin,
              tx.tipo AS exc_tipo, tx.hora_inicio AS exc_inicio, tx.hora_fin AS exc_fin
         FROM trabajos t
         LEFT JOIN zonas z ON z.id = t.zona_id
         LEFT JOIN turnos_entrega te ON te.id = t.turno_entrega_id
         LEFT JOIN turnos_excepciones tx
                ON tx.turno_entrega_id = t.turno_entrega_id AND tx.fecha = t.fecha_entrega
        WHERE t.id = ?`
    ).bind(trabajoId).first();
    if (!t) return null;

    // Mismo criterio que trabajos.js al validar el turno: una excepción
    // 'horario_modificado' pisa el horario recurrente de ESA fecha.
    const modificado = t.exc_tipo === 'horario_modificado';
    const ini = (modificado && t.exc_inicio) || t.hora_inicio;
    const fin = (modificado && t.exc_fin) || t.hora_fin;

    const { archivos, items } = parseConfiguracion(t.configuracion);
    const desc = await cargarDescripciones(db, archivos.flatMap((a) => [a.primario, a.acabado]));

    return {
      total: Number(t.total) || 0,
      pagado: !!t.pagado,
      costoEnvio: Number(t.costo_envio) || 0,
      esRetiro: !!t.es_retiro,
      zona: t.zona_nombre || null,
      direccion: t.direccion_entrega || null,
      fecha: fechaLarga(t.fecha_entrega),
      horario: ini && fin ? `${String(ini).slice(0, 5)} a ${String(fin).slice(0, 5)} hs` : null,
      archivos: armarArchivos(archivos, items, desc),
    };
  } catch (err) {
    console.error('[notificaciones] No se pudo cargar el detalle del pedido', trabajoId, err);
    return null;
  }
}

/**
 * Une archivos[i] (datos del cliente) con items[i] (cálculo del servidor,
 * lib/precio.js — mismo orden). Subtotal por archivo = items[i].total
 * (verificado contra calcularPrecio). Sirve igual para fotos: trabajos.js
 * usa calcularPrecio para las dos categorías.
 */
function armarArchivos(archivos, items, desc) {
  return archivos.map((a, i) => {
    const it = items[i] || {};
    const primario = desc[a.primario] || (a.primario ? prettyCodigo(a.primario) : null);
    const acabado = a.acabado && a.acabado !== 'suelto' ? (desc[a.acabado] || prettyCodigo(a.acabado)) : null;
    const copias = Number(a.copias) || null;
    const paginas = Number(a.paginas) || null;
    const partes = [
      primario,
      acabado,
      copias ? `${copias} ${copias === 1 ? 'copia' : 'copias'}` : null,
      paginas && paginas > 1 ? `${paginas} págs.` : null,
      a.faz && String(a.faz).toLowerCase().includes('doble') ? 'doble faz' : null,
    ].filter(Boolean);
    const sub = it.total ?? null;
    return {
      nombre: a.nombre || it.nombre || nombreDeKey(a.r2_key) || `Archivo ${i + 1}`,
      detalle: partes.join(' · '),
      subtotal: sub != null && Number.isFinite(Number(sub)) ? Number(sub) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Bloques de detalle
// ---------------------------------------------------------------------------

const MAX_ARCHIVOS_VISIBLES = 8;

function bloqueArchivos(p) {
  if (!p.archivos.length) return '';
  const visibles = p.archivos.slice(0, MAX_ARCHIVOS_VISIBLES);
  const filas = visibles.map((a) => ({
    etiqueta: a.nombre,
    sub: a.detalle || null,
    valor: a.subtotal != null ? formatoPesos(a.subtotal) : '',
  }));
  const resto = p.archivos.length - visibles.length;
  if (resto > 0) filas.push({ etiqueta: `… y ${resto} ${resto === 1 ? 'archivo más' : 'archivos más'}`, valor: '' });
  return seccion(p.archivos.length === 1 ? 'Tu archivo' : `Tus archivos (${p.archivos.length})`, filasDetalle(filas));
}

function bloqueEntrega(p) {
  const filas = [];
  if (p.esRetiro) {
    filas.push({ etiqueta: 'Retiro en', valor: p.zona || 'Local' });
  } else {
    filas.push({ etiqueta: 'Envío a', valor: p.direccion || p.zona || '—', sub: p.direccion && p.zona ? p.zona : null });
  }
  if (p.fecha) filas.push({ etiqueta: 'Día', valor: p.fecha });
  if (p.horario) filas.push({ etiqueta: 'Horario', valor: p.horario });
  return seccion(p.esRetiro ? 'Retiro' : 'Entrega', filasDetalle(filas));
}

function bloqueTotales(p) {
  const subtotal = Math.max(p.total - p.costoEnvio, 0);
  const filas = [
    { etiqueta: 'Impresión', valor: formatoPesos(subtotal) },
    { etiqueta: 'Envío', valor: p.costoEnvio > 0 ? formatoPesos(p.costoEnvio) : 'Sin cargo' },
    { etiqueta: 'Total', valor: formatoPesos(p.total), destacada: true },
  ];
  return seccion('Total', filasDetalle(filas));
}

function bloqueDetalle(modo, p) {
  if (!p || !modo) return '';
  if (modo === 'entrega') return bloqueEntrega(p);
  return bloqueArchivos(p) + bloqueEntrega(p) + bloqueTotales(p);
}

/**
 * Datos para pagar por transferencia. Salen de variables de entorno (hoy no
 * hay otro lugar server-side donde vivan): TRANSFERENCIA_TITULAR,
 * TRANSFERENCIA_BANCO, TRANSFERENCIA_ALIAS, TRANSFERENCIA_CVU (todas
 * opcionales — se muestra lo que esté cargado).
 */
function bloqueDatosTransferencia(env, pedido) {
  const filas = [];
  if (pedido) filas.push({ etiqueta: 'Monto a transferir', valor: formatoPesos(pedido.total), destacada: true });
  if (env.TRANSFERENCIA_TITULAR) filas.push({ etiqueta: 'Titular', valor: env.TRANSFERENCIA_TITULAR });
  if (env.TRANSFERENCIA_BANCO) filas.push({ etiqueta: 'Banco', valor: env.TRANSFERENCIA_BANCO });
  if (env.TRANSFERENCIA_ALIAS) filas.push({ etiqueta: 'Alias', valor: env.TRANSFERENCIA_ALIAS });
  if (env.TRANSFERENCIA_CVU) filas.push({ etiqueta: 'CVU', valor: env.TRANSFERENCIA_CVU });
  return filas.length ? seccion('Datos para transferir', filasDetalle(filas)) : '';
}

// ---------------------------------------------------------------------------
// Textos por evento
// ---------------------------------------------------------------------------

function textosEvento(tipoEvento, trabajoId, contexto, pedido, env) {
  const id = escapeHtml(trabajoId);
  const urlPedido = `${APP_URL}/mis-pedidos/?trabajo=${encodeURIComponent(trabajoId)}`;
  const ctaVer = { label: 'Ver mi pedido', url: urlPedido };
  const medio = contexto.medioPago;

  switch (tipoEvento) {
    case 'creado': {
      let intro;
      let cta = ctaVer;
      let bloquesExtra = '';
      if (medio === 'transferencia') {
        intro = `Registramos tu pedido #${id}. Para que empecemos a prepararlo, hacé la transferencia y, si todavía no lo hiciste, subí el comprobante desde “Mis pedidos”.`;
        cta = { label: 'Subir comprobante', url: urlPedido };
        bloquesExtra = bloqueDatosTransferencia(env, pedido);
      } else if (medio === 'mercadopago' && !(pedido && pedido.pagado)) {
        intro = `Registramos tu pedido #${id}. Falta completar el pago en Mercado Pago: apenas se acredite empezamos a prepararlo y te avisamos.`;
      } else {
        intro = `Tu pedido #${id} ya está registrado. Te avisamos en cada paso.`;
      }
      return {
        push: { titulo: '¡Pedido recibido!', cuerpo: `Ya tenemos tu pedido #${trabajoId} — te avisamos cuando avance.` },
        email: {
          subject: `Recibimos tu pedido #${trabajoId} — 99copias`,
          preheader: medio === 'transferencia' ? 'Falta tu transferencia y el comprobante para empezar.' : 'Ya está registrado. Te avisamos en cada paso.',
          titulo: '¡Recibimos tu pedido!',
          intro, bloquesExtra, paso: 0, detalle: 'completo', cta,
        },
      };
    }
    case 'pago_aprobado':
      return {
        push: { titulo: '¡Pago confirmado!', cuerpo: `Tu pedido #${trabajoId} ya está en proceso.` },
        email: {
          subject: `Pago confirmado — pedido #${trabajoId} — 99copias`,
          preheader: 'Ya estamos preparando tu pedido.',
          titulo: '¡Pago confirmado!',
          intro: medio === 'transferencia'
            ? `Revisamos tu comprobante y confirmamos tu pago por transferencia. Tu pedido #${id} ya está en proceso.`
            : `Recibimos tu pago. Tu pedido #${id} ya está en proceso.`,
          paso: 1, detalle: 'completo', cta: ctaVer,
        },
      };
    case 'comprobante_recibido':
      return {
        push: { titulo: 'Recibimos tu comprobante', cuerpo: `Estamos revisando el pago del pedido #${trabajoId}.` },
        email: {
          subject: `Recibimos tu comprobante — pedido #${trabajoId} — 99copias`,
          preheader: 'Lo estamos revisando. Te avisamos apenas esté confirmado.',
          titulo: 'Recibimos tu comprobante',
          intro: `Recibimos el comprobante de tu pedido #${id}. Lo estamos revisando y te avisamos apenas confirmemos el pago.`,
          paso: 0, detalle: 'completo', cta: ctaVer,
        },
      };
    case 'pago_rechazado': {
      const motivo = humanizarMotivo(contexto.motivoRechazo);
      const esMP = medio === 'mercadopago';
      return {
        push: {
          titulo: 'No pudimos confirmar el pago',
          cuerpo: motivo ? `Pedido #${trabajoId} — ${motivo}` : `Revisá el estado de tu pedido #${trabajoId}.`,
        },
        email: {
          subject: `No pudimos confirmar tu pago — pedido #${trabajoId} — 99copias`,
          preheader: 'Necesitamos que revises el pago para poder avanzar con tu pedido.',
          titulo: 'No pudimos confirmar tu pago',
          intro: `No pudimos confirmar el pago del pedido #${id}, así que todavía no empezamos a prepararlo.`,
          aviso: motivo
            ? { tipo: 'error', html: `<strong>Motivo:</strong> ${escapeHtml(motivo.charAt(0).toUpperCase() + motivo.slice(1))}.` }
            : null,
          // Mercado Pago no tiene "re-subir comprobante": el mensaje cambia según el medio.
          extra: esMP
            ? '<p style="margin:12px 0 0;">Podés intentar de nuevo con otro medio de pago desde un nuevo pedido, o escribinos y lo vemos juntos.</p>'
            : '<p style="margin:12px 0 0;">Podés volver a subir el comprobante desde “Mis pedidos”.</p>',
          paso: null, detalle: null,
          cta: { label: esMP ? 'Ver mi pedido' : 'Subir otro comprobante', url: urlPedido },
        },
      };
    }
    case 'listo': {
      const retiro = pedido ? pedido.esRetiro : null;
      return {
        push: { titulo: '¡Tu pedido está listo!', cuerpo: `El pedido #${trabajoId} ya está listo.` },
        email: {
          subject: `Tu pedido #${trabajoId} está listo — 99copias`,
          preheader: retiro === false ? 'Lo entregamos en el día y horario que elegiste.' : 'Ya lo podés pasar a buscar.',
          titulo: '¡Tu pedido está listo!',
          intro: retiro === true
            ? `Tu pedido #${id} ya está listo. Ya lo podés pasar a buscar:`
            : retiro === false
              ? `Tu pedido #${id} ya está listo. Lo vamos a entregar en el día y horario que elegiste:`
              : `Tu pedido #${id} ya está listo. Si elegiste retiro, ya lo podés pasar a buscar. Si es envío, coordinamos la entrega.`,
          paso: 2, detalle: 'entrega', cta: ctaVer,
        },
      };
    }
    case 'entregado':
      return {
        push: { titulo: '¡Pedido entregado!', cuerpo: `Tu pedido #${trabajoId} fue entregado. ¡Gracias!` },
        email: {
          subject: `Tu pedido #${trabajoId} fue entregado — 99copias`,
          preheader: '¡Gracias por elegir 99copias!',
          titulo: '¡Pedido entregado!',
          intro: `Tu pedido #${id} fue entregado. ¡Gracias por elegir 99copias!`,
          paso: 3, detalle: null, cta: { label: 'Ver el detalle', url: urlPedido },
        },
      };
    case 'mensaje_nuevo': {
      const textoCorto = (contexto.mensaje || '').slice(0, 100);
      return {
        push: { titulo: `Nuevo mensaje sobre tu pedido #${trabajoId}`, cuerpo: textoCorto },
        email: {
          subject: `Nuevo mensaje sobre tu pedido #${trabajoId} — 99copias`,
          preheader: textoCorto,
          titulo: 'Tenés un mensaje nuevo',
          intro: `Sobre tu pedido #${id}:`,
          aviso: { tipo: 'info', html: escapeHtml(contexto.mensaje || '').replace(/\n/g, '<br>') },
          paso: null, detalle: null,
          cta: { label: 'Responder desde Mis pedidos', url: urlPedido },
        },
      };
    }
    default:
      return null;
  }
}

function armarCuerpoEmail(e, nombre, pedido) {
  const saludo = nombre ? `<p style="margin:0 0 12px;">Hola ${escapeHtml(nombre)},</p>` : '';
  return [
    e.paso != null ? trackerEstado(e.paso) : '',
    saludo,
    `<p style="margin:0 0 4px;">${e.intro}</p>`,
    e.aviso ? aviso(e.aviso.html, e.aviso.tipo) : '',
    e.extra || '',
    e.bloquesExtra || '',
    bloqueDetalle(e.detalle, pedido),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Medio de pago
// ---------------------------------------------------------------------------

/**
 * Respaldo: si quien dispara el evento no pasó contexto.medioPago (ej. un
 * endpoint del Panel), se lee de pagos.medio — la fila la crea
 * pago-transferencia.js ('transferencia') o checkout.js. Cualquier valor que
 * no sea 'transferencia' se trata como Mercado Pago; sin fila => null (desconocido).
 */
async function leerMedioPago(db, trabajoId) {
  try {
    const row = await db.prepare('SELECT medio FROM pagos WHERE trabajo_id = ?').bind(trabajoId).first();
    if (!row) return null; // todavía no se eligió medio (ej. evento 'creado'): no adivinar
    return row.medio === 'transferencia' ? 'transferencia' : 'mercadopago';
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Punto de entrada
// ---------------------------------------------------------------------------

/**
 * Punto de entrada único — se llama desde trabajos.js, webhooks/mercadopago.js,
 * y los endpoints que llama el Panel (comprobante revisado, estado
 * actualizado, mensaje nuevo). No lanza si algo falla — un mail/push que no
 * sale no debe romper el flujo de negocio que lo disparó.
 *
 * @param {string} tipoEvento 'creado'|'pago_aprobado'|'pago_rechazado'|'comprobante_recibido'|'listo'|'entregado'|'mensaje_nuevo'
 * @param {{ medioPago?: 'mercadopago'|'transferencia', motivoRechazo?: string, mensaje?: string }} contexto
 *   medioPago: opcional — si no viene se lee de pagos.medio. Condiciona el texto
 *   de 'creado' y 'pago_rechazado', y la matriz push/email de 'pago_aprobado'.
 */
export async function notificarEventoTrabajo(env, trabajoId, tipoEvento, contexto = {}) {
  const db = env.DB;
  // Los llamadores pasan el id como número (trabajos.js, Panel) o como string
  // (webhook de MP, query strings): se normaliza para que la clave de
  // idempotencia sea siempre la misma.
  trabajoId = Number(trabajoId);

  // mensaje_nuevo y comprobante_recibido quedan fuera de la idempotencia: cada
  // uno es un evento distinto sobre el mismo pedido (el cliente puede subir un
  // comprobante nuevo después de un rechazo y debe recibir su confirmación).
  // pago_rechazado depende del medio y se define más abajo, cuando ya se conoce.
  let usaIdempotencia = tipoEvento !== 'mensaje_nuevo' && tipoEvento !== 'comprobante_recibido';

  try {
    const trabajo = await db.prepare(
      'SELECT user_id FROM trabajos WHERE id = ?'
    ).bind(trabajoId).first();
    if (!trabajo) {
      console.error('[notificaciones] trabajo inexistente, no se notifica:', trabajoId, tipoEvento);
      return;
    }
    // Pedido cargado a mano desde el Panel sin cuenta de cliente (user_id NULL):
    // no hay a quién notificar. No es un error.
    if (!trabajo.user_id) return;
    const userId = trabajo.user_id;

    // Normalizamos el medio de pago una sola vez: de acá en más
    // contexto.medioPago siempre está definido.
    contexto = { ...contexto, medioPago: contexto.medioPago || await leerMedioPago(db, trabajoId) };

    // Rechazo por transferencia: cada rechazo es una decisión puntual de un
    // operador, y el cliente puede subir un comprobante nuevo y volver a ser
    // rechazado (comprobante.js resetea el estado de revisión al re-subir). Con
    // idempotencia, el segundo rechazo no avisaría nunca. En Mercado Pago, en
    // cambio, la idempotencia sí hace falta: el webhook se reintenta.
    if (tipoEvento === 'pago_rechazado' && contexto.medioPago === 'transferencia') usaIdempotencia = false;

    // Rechazo de comprobante: si el endpoint del Panel no pasó el motivo, se
    // toma de pagos.motivo_rechazo (la columna que ya usan comprobante.js y
    // pago-transferencia.js).
    if (tipoEvento === 'pago_rechazado' && !contexto.motivoRechazo && contexto.medioPago === 'transferencia') {
      try {
        const r = await db.prepare('SELECT motivo_rechazo FROM pagos WHERE trabajo_id = ?').bind(trabajoId).first();
        if (r && r.motivo_rechazo) contexto = { ...contexto, motivoRechazo: r.motivo_rechazo };
      } catch { /* sin motivo: el mail sale igual */ }
    }

    const perfil = await db.prepare(
      'SELECT nombre, email_contacto FROM perfil_fiscal WHERE user_id = ?'
    ).bind(userId).first();
    // isAnonymous: columna confirmada (la usa el Panel en sus listados). El email de
    // una cuenta anónima es un descartable inventado por Better Auth: nunca se usa.
    const usuario = await db.prepare('SELECT email, isAnonymous FROM "user" WHERE id = ?').bind(userId).first();

    // Primero el email que el cliente cargó en el pedido; el del login sólo
    // como respaldo, y nunca si es el descartable de una sesión anónima.
    const candidatos = [
      perfil && perfil.email_contacto,
      usuario && !usuario.isAnonymous ? usuario.email : null,
    ];
    const emailDestino = candidatos.find(emailUsable) || null;

    const { results: subs } = await db.prepare(
      'SELECT id FROM push_subscriptions_cliente WHERE user_id = ?'
    ).bind(userId).all();
    const tienePush = subs.length > 0;

    const emailAplicaConPush = tipoEvento === 'entregado'
      || (tipoEvento === 'pago_aprobado' && contexto.medioPago === 'mercadopago');
    const debeMandarEmail = tienePush ? emailAplicaConPush : true;

    if (debeMandarEmail && !emailDestino) {
      // Antes esto fallaba en silencio. Si aparece seguido, hay un hueco en la
      // captura del email (ver validación en trabajos.js).
      console.error('[notificaciones] Sin email utilizable para', tipoEvento, 'trabajo', trabajoId);
    }

    // El detalle sólo se lee si realmente se va a armar un mail.
    const pedido = debeMandarEmail && emailDestino ? await cargarPedido(db, trabajoId) : null;

    const textos = textosEvento(tipoEvento, trabajoId, contexto, pedido, env);
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

    // --- Email ---
    if (debeMandarEmail && emailDestino && (!usaIdempotencia || !(await yaEnviado(db, trabajoId, tipoEvento, 'email')))) {
      const e = textos.email;
      const html = plantillaBase({
        titulo: e.titulo,
        preheader: e.preheader,
        cuerpoHtml: armarCuerpoEmail(e, perfil && perfil.nombre, pedido),
        trabajoId,
        cta: e.cta,
      });
      const resultado = await enviarEmail(env, { to: emailDestino, subject: e.subject, html });
      if (resultado.ok && usaIdempotencia) await marcarEnviado(db, trabajoId, tipoEvento, 'email');
    }
  } catch (err) {
    console.error('[notificaciones] Error notificando evento', tipoEvento, 'trabajo', trabajoId, err);
  }
}
