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
// Recibe las notificaciones de Mercado Pago (Checkout Pro).

async function log(env, { resultado, tipo, dataId, trabajoId, xSignature, detalle, bodyCrudo }) {
  try {
    await env.DB.prepare(
      `INSERT INTO webhook_logs
        (resultado, tipo, data_id, trabajo_id, x_signature, detalle, body_crudo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      resultado,
      tipo || null,
      dataId ? String(dataId) : null,
      trabajoId ? String(trabajoId) : null,
      xSignature || null,
      detalle || null,
      bodyCrudo || null
    ).run();
  } catch (e) {
    console.error(e);
  }
}

async function validarFirma(request, env, dataId) {

  if (!env.MP_WEBHOOK_SECRET) {
    return {
      valida: true,
      motivo: 'sin_secreto_configurado',
      debug: {}
    };
  }

  const xSignature = request.headers.get('x-signature') || '';
  const xRequestId = request.headers.get('x-request-id') || '';

  if (!xSignature) {
    return {
      valida: false,
      motivo: 'sin_header_x_signature',
      debug: {
        xSignature,
        xRequestId
      }
    };
  }

  const parts = Object.fromEntries(
    xSignature.split(',').map(p => {
      const [k, v] = p.split('=');
      return [k.trim(), (v || '').trim()];
    })
  );

  const ts = parts.ts;
  const v1 = parts.v1;

  if (!ts || !v1) {
    return {
      valida: false,
      motivo: 'header_x_signature_mal_formado',
      debug: {
        xSignature,
        parts
      }
    };
  }

  const manifest = id:${dataId};request-id:${xRequestId};ts:${ts};;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.MP_WEBHOOK_SECRET),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  const sigBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(manifest)
  );

  const calculada = [...new Uint8Array(sigBuffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    valida: calculada === v1,
    motivo: calculada === v1 ? 'firma_ok' : 'firma_no_coincide',
    debug: {
      manifest,
      calculada,
      recibida: v1,
      ts,
      xRequestId,
      xSignature,
      dataId
    }
  };

}

export async function onRequestPost({ request, env }) {

  const xSignatureHeader = request.headers.get('x-signature') || '';

  const rawText = await request.text();

  let body;

  try {
    body = JSON.parse(rawText);
  } catch {

    await log(env,{
      resultado:'body_invalido',
      xSignature:xSignatureHeader,
      bodyCrudo:rawText
    });

    return new Response('OK',{status:200});
  }

  const tipo = body.type || body.topic;

  // soporta formato nuevo y viejo
  const dataId =
      body.data?.id ??
      body.resource?.split('/').pop() ??
      body.resource ??
      null;

  await log(env,{
      resultado:'01_webhook_recibido',
      tipo,
      dataId,
      xSignature:xSignatureHeader,
      detalle:JSON.stringify({
          headers:{
              "x-request-id":request.headers.get("x-request-id"),
              "x-signature":request.headers.get("x-signature")
          },
          body
      }),
      bodyCrudo:rawText
  });

  if (tipo !== 'payment' || !dataId) {

      await log(env,{
          resultado:'ignorado_no_es_payment',
          tipo,
          dataId,
          xSignature:xSignatureHeader,
          bodyCrudo:rawText
      });

      return new Response('OK',{status:200});
  }

  const {valida:firmaValida,motivo:motivoFirma}=await validarFirma(request,env,dataId);

  if(!firmaValida){

      await log(env,{
          resultado:'firma_invalida',
          tipo,
          dataId,
          xSignature:xSignatureHeader,
          detalle:motivoFirma,
          bodyCrudo:rawText
      });

      return new Response('OK',{status:200});
  }

  await log(env,{
      resultado:'02_firma_ok',
      tipo,
      dataId
  });

  if(!env.MP_ACCESS_TOKEN){

      await log(env,{
          resultado:'sin_access_token',
          tipo,
          dataId,
          detalle:'MP_ACCESS_TOKEN no configurado'
      });

      return new Response('OK',{status:200});
  }

  try{

      await log(env,{
          resultado:'03_consultando_payment',
          tipo,
          dataId
      });

      const pagoRes=await fetch(
          `https://api.mercadopago.com/v1/payments/${dataId}`,
          {
              headers:{
                  Authorization:'Bearer '+env.MP_ACCESS_TOKEN
              }
          }
      );

      if(!pagoRes.ok){

          const txt=await pagoRes.text();

          await log(env,{
              resultado:'error_consultando_pago',
              tipo,
              dataId,
              detalle:`HTTP ${pagoRes.status}: ${txt}`
          });

          return new Response('OK',{status:200});
      }

      const pago=await pagoRes.json();

      await log(env,{
          resultado:'04_payment_obtenido',
          tipo,
          dataId,
          trabajoId:pago.external_reference,
          detalle:JSON.stringify({
              id:pago.id,
              status:pago.status,
              status_detail:pago.status_detail,
              payment_type_id:pago.payment_type_id,
              external_reference:pago.external_reference
          })
      });

      const trabajoId=pago.external_reference;

      const db=env.DB;

      const update=await db.prepare(`
          UPDATE pagos
          SET
              mp_payment_id=?,
              mp_status=?,
              mp_status_detail=?,
              mp_payment_type=?,
              raw_response=?,
              actualizado_en=datetime('now')
          WHERE trabajo_id=?
      `).bind(
          String(pago.id),
          pago.status,
          pago.status_detail||null,
          pago.payment_type_id||null,
          JSON.stringify(pago),
          trabajoId
      ).run();

      await log(env,{
          resultado:'05_update_ejecutado',
          tipo,
          dataId,
          trabajoId,
          detalle:`changes=${update.meta.changes}`
      });

      if(update.meta.changes===0){

          await log(env,{
              resultado:'pagos_sin_fila_para_ese_trabajo_id',
              tipo,
              dataId,
              trabajoId,
              detalle:`external_reference="${trabajoId}"`
          });

          return new Response('OK',{status:200});
      }

      if(pago.status==="approved"){

          await db.prepare(`
              UPDATE trabajos
              SET
                  pagado=1,
                  estado=CASE
                      WHEN estado='pendiente'
                      THEN 'en_proceso'
                      ELSE estado
                  END
              WHERE id=?
          `).bind(trabajoId).run();

          await log(env,{
              resultado:'06_trabajo_actualizado',
              tipo,
              dataId,
              trabajoId
          });

      }

      await log(env,{
          resultado:'actualizado_ok',
          tipo,
          dataId,
          trabajoId,
          detalle:`status=${pago.status}`
      });

      return new Response('OK',{status:200});

  }catch(err){

      await log(env,{
          resultado:'excepcion',
          tipo,
          dataId,
          detalle:String(err?.stack || err?.message || err)
      });

      return new Response('OK',{status:200});

  }

}