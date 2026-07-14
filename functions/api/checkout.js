// NOTA: este endpoint queda funcional en su estructura, pero necesita:
//   1) La variable de entorno MP_ACCESS_TOKEN cargada en Cloudflare Pages (Settings > Environment variables).
//   2) Definir back_urls (success/failure/pending) con el dominio final.
//   3) Configurar el webhook de Mercado Pago apuntando a /api/webhooks/mercadopago (a construir en la
//      siguiente etapa), que es el que va a actualizar `pagos` y `trabajos.pagado`.
// Hasta que eso esté cargado, este endpoint responde con un error claro en vez de fallar en silencio.

export async function onRequestPost({ request, env }) {
  try {
    const { trabajo_id } = await request.json();
    if (!trabajo_id) return Response.json({ error: 'Falta trabajo_id.' }, { status: 400 });

    const db = env.DB;
    const trabajo = await db.prepare('SELECT * FROM trabajos WHERE id = ?').bind(trabajo_id).first();
    if (!trabajo) return Response.json({ error: 'El trabajo no existe.' }, { status: 404 });

    if (!env.MP_ACCESS_TOKEN) {
      return Response.json({
        error: 'Mercado Pago todavía no está configurado (falta MP_ACCESS_TOKEN). El trabajo #' + trabajo_id + ' quedó guardado como pendiente de pago.',
      }, { status: 501 });
    }

    const origin = new URL(request.url).origin;
    const preference = {
      items: [{
        title: 'Pedido de impresión #' + trabajo_id,
        quantity: 1,
        unit_price: trabajo.total,
        currency_id: 'ARS',
      }],
      external_reference: String(trabajo_id),
      back_urls: {
        success: origin + '/pedido/gracias?trabajo=' + trabajo_id,
        failure: origin + '/pedido/error?trabajo=' + trabajo_id,
        pending: origin + '/pedido/pendiente?trabajo=' + trabajo_id,
      },
      auto_return: 'approved',
      notification_url: origin + '/api/webhooks/mercadopago',
    };

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.MP_ACCESS_TOKEN,
      },
      body: JSON.stringify(preference),
    });

    if (!mpRes.ok) {
      const detail = await mpRes.text();
      console.error('Error de Mercado Pago:', detail);
      return Response.json({ error: 'Mercado Pago rechazó la creación del checkout.' }, { status: 502 });
    }

    const mpData = await mpRes.json();

    await db.prepare(
      `INSERT INTO pagos (trabajo_id, mp_preference_id, monto, moneda, external_reference)
       VALUES (?, ?, ?, 'ARS', ?)`
    ).bind(trabajo_id, mpData.id, trabajo.total, String(trabajo_id)).run();

    return Response.json({ init_point: mpData.init_point });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message || 'No se pudo generar el checkout.' }, { status: 500 });
  }
}
