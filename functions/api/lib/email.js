// functions/api/lib/email.js
//
// Envío de mail vía Resend, por fetch directo — sin el SDK oficial. En
// Workers no hay sockets SMTP; toda la industria (Resend, Postmark, etc.)
// expone una API HTTP para esto, así que un solo POST alcanza, sin agregar
// una dependencia npm más para algo que es una sola llamada.
//
// Remitente fijo: "99copias <no-reply@app.99copias.com.ar>" — dominio
// verificado en Resend (SPF/DKIM/DMARC), ver instrucciones de deploy.

const REMITENTE = '99copias <no-reply@app.99copias.com.ar>';

/**
 * @param {{ RESEND_API_KEY: string }} env
 * @param {{ to: string, subject: string, html: string }} opts
 */
export async function enviarEmail(env, { to, subject, html }) {
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
      body: JSON.stringify({ from: REMITENTE, to: [to], subject, html }),
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

// Envoltorio HTML común a todos los mails — pie con cómo contactar (no-reply
// no lee respuestas) y nombre reconocible, por higiene anti-spam (ver
// instrucciones de deploy).
export function plantillaBase({ titulo, cuerpoHtml, trabajoId }) {
  return `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background:#f4f1ea;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:480px;background:#fffdf8;border:1px solid #e5e0d3;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#141312;color:#fffdf8;padding:20px 28px;font-size:1.1rem;font-weight:700;">99copias</td></tr>
        <tr><td style="padding:28px;color:#141312;">
          <h1 style="font-size:1.25rem;margin:0 0 16px;">${titulo}</h1>
          ${cuerpoHtml}
          ${trabajoId ? `<p style="font-size:.78rem;color:#8a8378;font-family:monospace;margin-top:24px;">PEDIDO #${trabajoId}</p>` : ''}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#f4f1ea;font-size:.78rem;color:#8a8378;">
          Este casillero no recibe respuestas. Si necesitás ayuda, escribinos por WhatsApp o los medios de contacto habituales de 99copias.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}