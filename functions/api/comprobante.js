// functions/api/comprobante.js
//
// Sube el comprobante de transferencia a R2, en un namespace propio
// (comprobantes/{trabajo_id}/...) separado de staging/ y trabajos/ — nunca
// se debe poder borrar vía DELETE /api/archivos (ese endpoint sólo permite
// borrar bajo staging/, ver r2.js/archivos.js, así que ya queda afuera de
// su alcance por diseño, sin tocar nada ahí).

import { sanitizarNombreArchivo, TAMANO_MAXIMO_BYTES } from './lib/r2.js';
import { createAuth } from './lib/auth.js';

const TIPOS_PERMITIDOS_COMPROBANTE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export async function onRequestPost({ request, env }) {
  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json({ error: 'Sesión inválida.' }, { status: 401 });
    }

    const url = new URL(request.url);
    const trabajoId = url.searchParams.get('trabajo_id');
    const nombreOriginal = url.searchParams.get('nombre') || 'comprobante';
    if (!trabajoId) return Response.json({ error: 'Falta trabajo_id.' }, { status: 400 });

    const db = env.DB;
    const trabajo = await db.prepare('SELECT id, user_id FROM trabajos WHERE id = ?').bind(trabajoId).first();
    if (!trabajo) return Response.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    if (trabajo.user_id !== sessionData.user.id) {
      return Response.json({ error: 'Este pedido no pertenece a tu cuenta.' }, { status: 403 });
    }
    const pago = await db.prepare("SELECT id FROM pagos WHERE trabajo_id = ? AND medio = 'transferencia'").bind(trabajoId).first();
    if (!pago) {
      return Response.json({ error: 'Este pedido no tiene un pago por transferencia iniciado.' }, { status: 409 });
    }

    const contentType = request.headers.get('content-type') || 'application/octet-stream';
    if (!TIPOS_PERMITIDOS_COMPROBANTE.includes(contentType)) {
      return Response.json({ error: `Tipo de archivo no permitido: ${contentType}. Subí una foto o PDF del comprobante.` }, { status: 415 });
    }
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > TAMANO_MAXIMO_BYTES) {
      return Response.json({ error: `El archivo supera el máximo permitido de ${TAMANO_MAXIMO_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
    }
    if (!contentLength) {
      return Response.json({ error: 'No se pudo determinar el tamaño del archivo.' }, { status: 400 });
    }

    const nombreSanitizado = sanitizarNombreArchivo(nombreOriginal);
    const key = `comprobantes/${trabajoId}/${Date.now()}-${nombreSanitizado}`;

    // Si ya había un comprobante subido antes (el cliente lo reemplaza),
    // borramos el viejo después de que el nuevo se suba bien — mismo
    // criterio que ya usa fotos/app.js al re-subir una foto editada.
    const pagoActual = await db.prepare('SELECT comprobante_r2_key FROM pagos WHERE id = ?').bind(pago.id).first();
    const keyPrevia = pagoActual && pagoActual.comprobante_r2_key;

    await env.BUCKET.put(key, request.body, {
      httpMetadata: { contentType },
      customMetadata: { nombreOriginal, trabajoId: String(trabajoId) },
    });
    await db.prepare(
      "UPDATE pagos SET comprobante_r2_key = ?, estado_revision = 'pendiente', motivo_rechazo = NULL, revisado_en = NULL WHERE id = ?"
    ).bind(key, pago.id).run();

    if (keyPrevia && keyPrevia !== key) {
      env.BUCKET.delete(keyPrevia).catch(() => {});
    }

    return Response.json({ ok: true, key });
  } catch (err) {
    console.error('Error subiendo comprobante:', err);
    return Response.json({ error: 'No se pudo subir el comprobante. Probá de nuevo.' }, { status: 500 });
  }
}