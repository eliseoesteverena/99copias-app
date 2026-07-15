// Recibe las notificaciones de Mercado Pago (Checkout Pro).
//
// MODO DIAGNÓSTICO: mientras se termina de validar el flujo, esta versión registra
// en `webhook_logs` TODO lo que entra (URL completa, headers, body crudo) y todo lo
// que se calculó (manifest, hash calculado vs esperado, qué candidato de id matcheó),
// para poder confirmar con certeza dónde está el problema sin depender de logs en vivo.
// Correr migracion_webhook_logs.sql + migracion_webhook_logs_v2.sql antes de usar esto.
//
// Referencia oficial (doc de Webhooks de Mercado Pago):
//  - El x-signature header trae "ts=...,v1=..." donde ts es el timestamp (ms) y v1 el HMAC-SHA256.
//  - El manifiesto a firmar es: id:{data.id};request-id:{x-request-id};ts:{ts};
//  - El "data.id" del manifiesto es el que viene en el QUERY STRING de la notification_url
//    (?data.id=...&type=payment), no necesariamente el del body. Si es alfanumérico va en minúsculas.
//  - Para notificaciones "legacy" (topic=payment&resource=<id>), no hay data.id en query;
//    el id del pago es directamente el valor de "resource".

function parseXSignature(xSignature) {
  const parts = Object.fromEntries(
    (xSignature || '').split(',').map(p => {
      const i = p.indexOf('=');
      if (i === -1) return [p.trim(), ''];
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  return { ts: parts.ts || null, v1: parts.v1 || null };
}

async function hmacHex(secret, manifest) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest));
  return [...new Uint8Array(sigBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function log(env, data) {
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_logs
        (resultado, tipo, data_id, trabajo_id, x_signature, detalle, body_crudo,
         url, metodo, headers_json, ts, x_request_id, manifest_usado, hash_calculado, hash_esperado,
         candidatos_json, respondido_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      data.resultado, data.tipo || null, data.dataId ? String(data.dataId) : null,
      data.trabajoId ? String(data.trabajoId) : null, data.xSignature || null, data.detalle || null,
      data.bodyCrudo || null, data.url || null, data.metodo || null, data.headersJson || null,
      data.ts || null, data.xRequestId || null, data.manifestUsado || null,
      data.hashCalculado || null, data.hashEsperado || null, data.candidatosJson || null
    ).run();
  } catch (e) {
    console.error('No se pudo escribir webhook_logs (¿corriste las migraciones?):', e);
  }
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const headersObj = Object.fromEntries(request.headers.entries());
  const xSignature = request.headers.get('x-signature') || '';
  const xRequestId = request.headers.get('x-request-id') || '';
  const rawText = await request.text();

  const { ts, v1: hashEsperado } = parseXSignature(xSignature);

  let body = null;
  try { body = JSON.parse(rawText); } catch { /* algunos topics vienen sin body JSON válido */ }

  // Tipo de evento: soporta formato moderno (type/action + data.id) y legacy (topic + resource).
  const tipo = (body && (body.type || body.topic)) || url.searchParams.get('type') || url.searchParams.get('topic');

  // Reunimos TODOS los candidatos posibles de "data.id" para saber cuál firmó realmente MP.
  const candidatos = [];
  const qDataId = url.searchParams.get('data.id') || url.searchParams.get('id');
  if (qDataId) candidatos.push({ origen: 'query.data.id', id: qDataId });
  if (body && body.data && body.data.id) candidatos.push({ origen: 'body.data.id', id: String(body.data.id) });
  if (body && body.resource && tipo === 'payment') candidatos.push({ origen: 'body.resource', id: String(body.resource) });

  const esPayment = tipo === 'payment';
  const dataIdPrincipal = candidatos[0] ? candidatos[0].id : null;

  if (!esPayment) {
    await log(env, {
      resultado: 'ignorado_no_es_payment', tipo, dataId: dataIdPrincipal, xSignature, bodyCrudo: rawText,
      url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
      candidatosJson: JSON.stringify(candidatos),
    });
    return new Response('OK', { status: 200 });
  }

  if (!ts || !hashEsperado) {
    await log(env, {
      resultado: 'sin_header_x_signature_valido', tipo, dataId: dataIdPrincipal, xSignature, bodyCrudo: rawText,
      url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
      candidatosJson: JSON.stringify(candidatos),
    });
    return new Response('OK', { status: 200 });
  }

  if (!env.MP_WEBHOOK_SECRET) {
    await log(env, {
      resultado: 'sin_secreto_configurado', tipo, dataId: dataIdPrincipal, xSignature, bodyCrudo: rawText,
      url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
      candidatosJson: JSON.stringify(candidatos),
      detalle: 'MP_WEBHOOK_SECRET no está cargado — no se puede validar la firma, se continúa sin validar.',
    });
  } else {
    // Probamos la firma contra CADA candidato de id (con y sin minúsculas) para saber cuál matchea.
    let candidatoGanador = null;
    for (const c of candidatos) {
      for (const idVariante of new Set([c.id, c.id.toLowerCase()])) {
        const manifest = `id:${idVariante};request-id:${xRequestId};ts:${ts};`;
        const hashCalculado = await hmacHex(env.MP_WEBHOOK_SECRET, manifest);
        c.hashCalculado = c.hashCalculado || hashCalculado;
        c.manifest = c.manifest || manifest;
        if (hashCalculado === hashEsperado) {
          candidatoGanador = { ...c, manifest, hashCalculado };
          break;
        }
      }
      if (candidatoGanador) break;
    }

    if (!candidatoGanador) {
      await log(env, {
        resultado: 'firma_invalida', tipo, dataId: dataIdPrincipal, xSignature, bodyCrudo: rawText,
        url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
        manifestUsado: candidatos[0] ? candidatos[0].manifest : null,
        hashCalculado: candidatos[0] ? candidatos[0].hashCalculado : null,
        hashEsperado, candidatosJson: JSON.stringify(candidatos),
        detalle: 'Ningún candidato de data.id (query/body/resource, con y sin minúsculas) produjo un hash que matchee.',
      });
      return new Response('OK', { status: 200 });
    }

    // Firma válida: usamos el id que efectivamente ganó, sea cual sea su origen.
    candidatos.unshift(candidatoGanador);
  }

  const dataId = candidatos[0] ? candidatos[0].id : dataIdPrincipal;

  if (!env.MP_ACCESS_TOKEN) {
    await log(env, {
      resultado: 'sin_access_token', tipo, dataId, xSignature, bodyCrudo: rawText,
      url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
      candidatosJson: JSON.stringify(candidatos),
      detalle: 'MP_ACCESS_TOKEN no está cargado en este entorno (revisar Production vs Preview).',
    });
    return new Response('OK', { status: 200 });
  }

  try {
    const pagoRes = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { 'Authorization': 'Bearer ' + env.MP_ACCESS_TOKEN },
    });
    if (!pagoRes.ok) {
      const detalleTxt = await pagoRes.text();
      await log(env, {
        resultado: 'error_consultando_pago', tipo, dataId, xSignature, bodyCrudo: rawText,
        url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
        candidatosJson: JSON.stringify(candidatos),
        detalle: `HTTP ${pagoRes.status}: ${detalleTxt}`,
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
      await log(env, {
        resultado: 'pagos_sin_fila_para_ese_trabajo_id', tipo, dataId, trabajoId, xSignature, bodyCrudo: rawText,
        url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
        candidatosJson: JSON.stringify(candidatos),
        detalle: `external_reference recibido: "${trabajoId}" — no matcheó ninguna fila en pagos.trabajo_id`,
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
      resultado: 'actualizado_ok', tipo, dataId, trabajoId, xSignature, bodyCrudo: rawText,
      url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
      candidatosJson: JSON.stringify(candidatos), detalle: `status=${pago.status} (live_mode del pago: ${pago.live_mode})`,
    });
    return new Response('OK', { status: 200 });
  } catch (err) {
    await log(env, {
      resultado: 'excepcion', tipo, dataId, xSignature, bodyCrudo: rawText,
      url: url.toString(), metodo: 'POST', headersJson: JSON.stringify(headersObj), ts, xRequestId,
      candidatosJson: JSON.stringify(candidatos), detalle: String((err && err.message) || err),
    });
    return new Response('OK', { status: 200 });
  }
}
