// Recibe las notificaciones de Mercado Pago (Checkout Pro).
// Configurar como notification_url al crear la preferencia (ver checkout.js).
//
// Flujo:
//  1) MP hace POST acá con { type/action: "payment...", data: { id } }.
//  2) (Opcional pero recomendado) Validamos el header x-signature con MP_WEBHOOK_SECRET.
//  3) Buscamos el pago real con GET /v1/payments/{id} — nunca confiamos en el status
//     que venga en el body de la notificación.
//  4) Actualizamos `pagos` y, si está aprobado, `trabajos.pagado` + `trabajos.estado`.
//  5) Respondemos 200 siempre que hayamos podido procesar (o descartar) el evento,
//     para que MP no reintente indefinidamente.

async function validarFirma(request, env, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return true; // sin secreto configurado, no se valida (ver README)

  const xSignature = request.headers.get('x-signature') || '';
  const xRequestId = request.headers.get('x-request-id') || '';
  if (!xSignature) return false;

  const parts = Object.fromEntries(
    xSignature.split(',').map(p => {
      const [k, v] = p.split('=');
      return [k.trim(), (v || '').trim()];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.MP_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const hex = [...new Uint8Array(sigBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');

  return hex === v1;
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('OK', { status: 200 }); // body inválido: no reintentar, no hay nada que procesar
  }

  const tipo = body.type || body.topic;
  const dataId = body.data && body.data.id;

  // Solo nos interesan las notificaciones de pagos.
  if (tipo !== 'payment' || !dataId) {
    return new Response('OK', { status: 200 });
  }

  const firmaValida = await validarFirma(request, env, dataId);
  if (!firmaValida) {
    console.error('Firma de webhook inválida, se descarta la notificación.');
    return new Response('OK', { status: 200 }); // no reintentar: probablemente no es de MP
  }

  if (!env.MP_ACCESS_TOKEN) {
    console.error('MP_ACCESS_TOKEN no configurado, no se puede verificar el pago', dataId);
    return new Response('OK', { status: 200 });
  }

  try {
    const pagoRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { 'Authorization': 'Bearer ' + env.MP_ACCESS_TOKEN },
    });
    if (!pagoRes.ok) {
      console.error('No se pudo obtener el pago', dataId, await pagoRes.text());
      return new Response('OK', { status: 200 });
    }
    const pago = await pagoRes.json();
    const trabajoId = pago.external_reference;
    const db = env.DB;

    await db.prepare(
      `UPDATE pagos SET mp_payment_id = ?, mp_status = ?, mp_status_detail = ?, mp_payment_type = ?,
              raw_response = ?, actualizado_en = datetime('now')
       WHERE trabajo_id = ?`
    ).bind(
      String(pago.id), pago.status, pago.status_detail || null, pago.payment_type_id || null,
      JSON.stringify(pago), trabajoId
    ).run();

    if (pago.status === 'approved') {
      await db.prepare(
        `UPDATE trabajos SET pagado = 1, estado = CASE WHEN estado = 'pendiente' THEN 'en_proceso' ELSE estado END
         WHERE id = ?`
      ).bind(trabajoId).run();
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Error procesando webhook de Mercado Pago:', err);
    // Devolvemos 200 igual: si es un error transitorio nuestro, MP reintentará solo
    // si respondemos distinto de 200/201, pero preferimos loguear y revisar manualmente
    // antes que generar reintentos descontrolados. Ajustar si se prefiere lo contrario.
    return new Response('OK', { status: 200 });
  }
}
