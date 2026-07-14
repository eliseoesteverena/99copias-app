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
//
// DEBUG: cada notificación que llega queda registrada en `webhook_logs`
// (ver migracion_webhook_logs.sql) con el motivo exacto de qué pasó. Sirve para
// diagnosticar sin depender de los logs en vivo de Cloudflare. Se puede sacar
// más adelante una vez que el flujo esté estable, no es necesario para producción.

async function log(env, { resultado, tipo, dataId, trabajoId, xSignature, detalle, bodyCrudo }) {
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_logs (resultado, tipo, data_id, trabajo_id, x_signature, detalle, body_crudo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      resultado, tipo || null, dataId ? String(dataId) : null, trabajoId ? String(trabajoId) : null,
      xSignature || null, detalle || null, bodyCrudo || null
    ).run();
  } catch (e) {
    console.error('No se pudo escribir webhook_logs (¿corriste la migración?):', e);
  }
}

async function validarFirma(request, env, dataId) {
  if (!env.MP_WEBHOOK_SECRET) return { valida: true, motivo: 'sin_secreto_configurado' };

  const xSignature = request.headers.get('x-signature') || '';
  const xRequestId = request.headers.get('x-request-id') || '';
  if (!xSignature) return { valida: false, motivo: 'sin_header_x_signature' };

  const parts = Object.fromEntries(
    xSignature.split(',').map(p => {
      const [k, v] = p.split('=');
      return [k.trim(), (v || '').trim()];
    })
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return { valida: false, motivo: 'header_x_signature_mal_formado' };

  // 1. Convertir dataId a minúsculas de forma segura si tiene letras (Regla de la Doc oficial)
  const safeDataId = dataId ? String(dataId).toLowerCase() : '';

  // 2. Construcción dinámica del manifest omitiendo campos vacíos (Regla de la Doc oficial)
  let manifest = '';
  if (safeDataId) {
    manifest += `id:${safeDataId};`;
  }
  if (xRequestId) {
    manifest += `request-id:${xRequestId};`;
  }
  manifest += `ts:${ts};`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.MP_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  const hex = [...new Uint8Array(sigBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');

  return { valida: hex === v1, motivo: hex === v1 ? 'firma_ok' : 'firma_no_coincide' };
}

export async function onRequestPost({ request, env }) {
  const xSignatureHeader = request.headers.get('x-signature') || '';
  const rawText = await request.text();

  let body;
  try {
    body = JSON.parse(rawText);
  } catch {
    await log(env, { resultado: 'body_invalido', xSignature: xSignatureHeader, bodyCrudo: rawText });
    return new Response('OK', { status: 200 });
  }

  const tipo = body.type || body.topic;
  
  // 3. Extraer el dataId de forma segura si viene en formato antiguo (topic/resource) o nuevo (action/data.id)
  let dataId = null;
  if (body.data && body.data.id) {
    dataId = body.data.id;
  } else if (body.resource) {
    // Si resource es una URL (ej: https://api.mercadolibre.com/payments/168800204850), extraemos el ID
    const match = String(body.resource).match(/\d+/);
    dataId = match ? match[0] : null;
  }

  // Aceptamos tanto "payment" como "payment.created"
  if ((tipo !== 'payment' && tipo !== 'payment.created') || !dataId) {
    await log(env, { resultado: 'ignorado_no_es_payment', tipo, dataId, xSignature: xSignatureHeader, bodyCrudo: rawText });
    return new Response('OK', { status: 200 });
  }

  const { valida: firmaValida, motivo: motivoFirma } = await validarFirma(request, env, dataId);
  if (!firmaValida) {
    await log(env, {
      resultado: 'firma_invalida', tipo, dataId, xSignature: xSignatureHeader,
      detalle: motivoFirma, bodyCrudo: rawText,
    });
    return new Response('OK', { status: 200 });
  }

  if (!env.MP_ACCESS_TOKEN) {
    await log(env, {
      resultado: 'sin_access_token', tipo, dataId, xSignature: xSignatureHeader,
      detalle: 'MP_ACCESS_TOKEN no está cargado', bodyCrudo: rawText,
    });
    return new Response('OK', { status: 200 });
  }

  try {
    const pagoRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { 'Authorization': 'Bearer ' + env.MP_ACCESS_TOKEN },
    });
    if (!pagoRes.ok) {
      const detalle = await pagoRes.text();
      await log(env, {
        resultado: 'error_consultando_pago', tipo, dataId, xSignature: xSignatureHeader,
        detalle: `HTTP ${pagoRes.status}: ${detalle}`, bodyCrudo: rawText,
      });
      return new Response('OK', { status: 200 });
    }
    const pago = await pagoRes.json();
    const trabajoId = pago.external_reference;
    const db = env.DB;

    const update = await db.prepare(
      `UPDATE pagos SET mp_payment_id = ?, mp_status = ?, mp_status_detail = ?, mp_payment_type = ?,
              raw_response = ?, actualizado_en = datetime('now')
       WHERE trabajo_id = ?`
    ).bind(
      String(pago.id), pago.status, pago.status_detail || null, pago.payment_type_id || null,
      JSON.stringify(pago), trabajoId
    ).run();

    if (update.meta.changes === 0) {
      // El pago se pudo consultar, pero no hay ninguna fila en `pagos` con ese trabajo_id.
      await log(env, {
        resultado: 'pagos_sin_fila_para_ese_trabajo_id', tipo, dataId, trabajoId, xSignature: xSignatureHeader,
        detalle: `external_reference recibido: "${trabajoId}" — no matcheó ninguna fila en pagos.trabajo_id`,
        bodyCrudo: rawText,
      });
      return new Response('OK', { status: 200 });
    }

    if (pago.status === 'approved') {
      await db.prepare(
        `UPDATE trabajos SET pagado = 1, estado = CASE WHEN estado = 'pendiente' THEN 'en_proceso' ELSE estado END
         WHERE id = ?`
      ).bind(trabajoId).run();
    }

    await log(env, {
      resultado: 'actualizado_ok', tipo, dataId, trabajoId, xSignature: xSignatureHeader,
      detalle: `status=${pago.status}`, bodyCrudo: rawText,
    });
    return new Response('OK', { status: 200 });
  } catch (err) {
    await log(env, {
      resultado: 'excepcion', tipo, dataId, xSignature: xSignatureHeader,
      detalle: String(err && err.message || err), bodyCrudo: rawText,
    });
    return new Response('OK', { status: 200 });
  }
}
