// functions/api/lib/email.js
//
// Envío de mail vía Resend, por fetch directo — sin el SDK oficial. En
// Workers no hay sockets SMTP; toda la industria (Resend, Postmark, etc.)
// expone una API HTTP para esto, así que un solo POST alcanza, sin agregar
// una dependencia npm más para algo que es una sola llamada.
//
// Remitente fijo: "99copias <no-reply@app.99copias.com.ar>" — dominio
// verificado en Resend (SPF/DKIM/DMARC), ver instrucciones de deploy.
//
// Este archivo tiene dos responsabilidades:
//   1. enviarEmail()    — transporte (Resend).
//   2. plantillaBase()  — envoltorio visual + componentes reutilizables
//      (boton, aviso, filas de detalle, tracker de estado). Los textos y los
//      datos de cada evento viven en notificaciones.js, no acá.
//
// Reglas de HTML de email (por qué el markup es "feo"): se usan <table> y
// estilos inline porque Outlook/Gmail ignoran gran parte de CSS moderno
// (flex, grid, <style> externos, SVG, fuentes web). Por eso el logo tiene que
// ser PNG/JPG, no el logo.svg del sitio.

const REMITENTE = '99copias <no-reply@app.99copias.com.ar>';

export const APP_URL = 'https://app.99copias.com.ar';

// Logo para el header. Tiene que ser PNG (Gmail/Outlook no renderizan SVG),
// con URL ABSOLUTA y pública, ~2x de resolución (ej. 560x120 px mostrado a
// 140 px de ancho) para que se vea nítido en pantallas retina.
// Subir el archivo a la raíz del proyecto como `email-logo.png`.
// Si no existe todavía, el mail igual se ve bien: se muestra el texto "99copias".
const LOGO_URL = `${APP_URL}/email-logo.png`;

// Paleta (aproximada a la del sitio — ajustar `accent` al hex real de
// var(--yellow) de styles.css).
const C = {
  paper: '#f4f1ea',
  card: '#fffdf8',
  ink: '#141312',
  muted: '#6b655a',
  line: '#e5e0d3',
  accent: '#f2b705',
};

const FUENTE = "Georgia,'Times New Roman',serif";

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 12500 -> "$ 12.500" ; 12500.5 -> "$ 12.500,50" */
export function formatoPesos(n) {
  const num = Math.round((Number(n) || 0) * 100) / 100;
  const [ent, dec] = num.toFixed(2).split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$ ${miles}${dec === '00' ? '' : ',' + dec}`;
}

// Versión texto plano a partir del HTML. Resend la manda como parte
// alternativa del mail: mejora entregabilidad (anti-spam) y es lo que ven
// clientes que no renderizan HTML.
function htmlATexto(html) {
  return String(html)
    .replace(/<(style|head|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/gi, '') // preheader oculto
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|div|tr|h1|h2|h3|table)>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// Transporte
// ---------------------------------------------------------------------------

/**
 * @param {{ RESEND_API_KEY: string }} env
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 */
export async function enviarEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    console.error('[email] RESEND_API_KEY no configurada — no se envía nada.');
    return { ok: false, error: 'RESEND_API_KEY no configurada' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: REMITENTE,
        to: [to],
        subject,
        html,
        text: text || htmlATexto(html),
      }),
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => '');
      console.error('[email] Resend respondió', res.status, detalle);
      return { ok: false, error: `Resend ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error('[email] Error de red enviando mail:', err);
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// ---------------------------------------------------------------------------
// Componentes reutilizables (devuelven HTML listo para insertar)
// ---------------------------------------------------------------------------

/** Botón "a prueba de Outlook" (tabla, no <button>). */
export function boton(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;">
  <tr><td align="center" bgcolor="${C.accent}" style="background:${C.accent};border:2px solid ${C.ink};border-radius:10px;">
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 26px;font-family:${FUENTE};font-size:16px;font-weight:700;color:${C.ink};text-decoration:none;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

/** Recuadro destacado. tipo: 'info' | 'error' | 'ok' */
export function aviso(html, tipo = 'info') {
  const colores = {
    info: { bg: '#f4f1ea', borde: C.line },
    ok: { bg: '#eaf5ea', borde: '#b9dcb9' },
    error: { bg: '#fbecec', borde: '#e8b9b9' },
  }[tipo] || { bg: '#f4f1ea', borde: C.line };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr><td style="background:${colores.bg};border:1px solid ${colores.borde};border-radius:10px;padding:14px 16px;font-size:15px;line-height:1.5;color:${C.ink};">${html}</td></tr>
</table>`;
}

/** Título de sección dentro del cuerpo (ej. "Archivos", "Entrega"). */
export function seccion(titulo, contenidoHtml) {
  return `<div style="margin:26px 0 0;">
  <div style="font-family:monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};padding-bottom:8px;border-bottom:2px solid ${C.ink};">${escapeHtml(titulo)}</div>
  ${contenidoHtml}
</div>`;
}

/**
 * Filas etiqueta/valor. `filas` = [{ etiqueta, valor, sub?, destacada? }]
 * Los valores se escapan acá — pasar texto plano, no HTML.
 */
export function filasDetalle(filas) {
  const trs = filas.map((f) => `<tr>
    <td valign="top" style="padding:10px 0;border-bottom:1px solid ${C.line};font-size:15px;color:${f.destacada ? C.ink : C.muted};${f.destacada ? 'font-weight:700;' : ''}">${escapeHtml(f.etiqueta)}${f.sub ? `<div style="font-size:13px;color:${C.muted};font-weight:400;margin-top:2px;">${escapeHtml(f.sub)}</div>` : ''}</td>
    <td valign="top" align="right" style="padding:10px 0 10px 16px;border-bottom:1px solid ${C.line};font-size:15px;color:${C.ink};white-space:nowrap;${f.destacada ? 'font-weight:700;font-size:17px;' : ''}">${escapeHtml(f.valor)}</td>
  </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trs}</table>`;
}

/**
 * Barra de progreso del pedido. pasoActual: índice (0-based) del paso en curso;
 * los pasos <= pasoActual se pintan de color.
 */
export function trackerEstado(pasoActual, pasos = ['Recibido', 'Pago', 'Listo', 'Entregado']) {
  const ancho = Math.floor(100 / pasos.length);
  const tds = pasos.map((p, i) => {
    const activo = i <= pasoActual;
    return `<td width="${ancho}%" valign="top" style="padding:0 3px;">
      <div style="height:5px;background:${activo ? C.accent : C.line};border-radius:3px;font-size:0;line-height:0;">&nbsp;</div>
      <div style="font-size:12px;color:${activo ? C.ink : C.muted};${i === pasoActual ? 'font-weight:700;' : ''}padding-top:6px;text-align:center;">${escapeHtml(p)}</div>
    </td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;"><tr>${tds}</tr></table>`;
}

// ---------------------------------------------------------------------------
// Plantilla base
// ---------------------------------------------------------------------------

/**
 * @param {{
 *   titulo: string,          // H1 del cuerpo (NO el subject)
 *   cuerpoHtml: string,      // HTML ya armado (los textos dinámicos, escapados por quien llama)
 *   trabajoId?: number|string,
 *   preheader?: string,      // texto de vista previa en la bandeja de entrada
 *   cta?: { label: string, url: string },
 * }} p
 */
export function plantillaBase({ titulo, cuerpoHtml, trabajoId, preheader, cta }) {
  const urlPedidos = `${APP_URL}/mis-pedidos/${trabajoId ? '?trabajo=' + encodeURIComponent(trabajoId) : ''}`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${C.paper};font-family:${FUENTE};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader)}${'&nbsp;&zwnj;'.repeat(40)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.paper}" style="background:${C.paper};padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.card};border:1px solid ${C.line};border-radius:14px;overflow:hidden;">
        <tr><td bgcolor="${C.ink}" style="background:${C.ink};padding:18px 28px;">
          <a href="${APP_URL}" style="text-decoration:none;">
            <img src="${LOGO_URL}" width="140" alt="99copias" style="display:block;border:0;outline:none;height:auto;max-width:140px;font-family:${FUENTE};font-size:22px;font-weight:700;color:${C.card};">
          </a>
        </td></tr>
        <tr><td height="4" bgcolor="${C.accent}" style="background:${C.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr><td style="padding:30px 28px 26px;color:${C.ink};font-size:16px;line-height:1.55;">
          <h1 style="font-size:22px;line-height:1.25;margin:0 0 16px;font-weight:700;">${escapeHtml(titulo)}</h1>
          ${cuerpoHtml}
          ${cta ? boton(cta.label, cta.url) : ''}
          ${trabajoId ? `<p style="font-size:12px;color:${C.muted};font-family:monospace;margin:22px 0 0;letter-spacing:.06em;">PEDIDO #${escapeHtml(trabajoId)}</p>` : ''}
        </td></tr>
        <tr><td bgcolor="${C.paper}" style="background:${C.paper};padding:18px 28px;font-size:13px;line-height:1.5;color:${C.muted};border-top:1px solid ${C.line};">
          Podés ver el estado de todos tus pedidos en <a href="${urlPedidos}" style="color:${C.ink};">Mis pedidos</a>.<br>
          Este casillero no recibe respuestas. Si necesitás ayuda, escribinos por WhatsApp o los medios de contacto habituales de 99copias.
        </td></tr>
      </table>
      <p style="font-size:12px;color:${C.muted};margin:16px 0 0;">99copias · <a href="${APP_URL}" style="color:${C.muted};">app.99copias.com.ar</a></p>
    </td></tr>
  </table>
</body>
</html>`;
}
