// Sube archivos a R2 en dos etapas:
//  1) Acá (staging/{sesion}/{nombre}) apenas el usuario los carga en el Paso 2 del wizard.
//  2) /api/trabajos.js los "confirma" copiándolos a trabajos/{trabajo_id}/... recién cuando
//     el pedido se paga, y borra el original de staging.
//
// Los objetos que quedan en staging/ sin confirmar (carritos abandonados) hay que limpiarlos
// con una regla de ciclo de vida en el bucket (ver README) — acá no se borran solos.

import { sanitizarNombreArchivo, TAMANO_MAXIMO_BYTES, TIPOS_PERMITIDOS } from './lib/r2.js';

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const nombreOriginal = url.searchParams.get('nombre') || 'archivo';
  const sesion = url.searchParams.get('sesion');

  if (!sesion || !/^[a-zA-Z0-9-]{8,80}$/.test(sesion)) {
    return Response.json({ error: 'Falta un identificador de sesión válido.' }, { status: 400 });
  }

  const contentType = request.headers.get('content-type') || 'application/octet-stream';
  if (!TIPOS_PERMITIDOS.includes(contentType)) {
    return Response.json({ error: `Tipo de archivo no permitido: ${contentType}` }, { status: 415 });
  }

  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > TAMANO_MAXIMO_BYTES) {
    return Response.json({ error: `El archivo supera el máximo permitido de ${TAMANO_MAXIMO_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  }
  if (!contentLength) {
    return Response.json({ error: 'No se pudo determinar el tamaño del archivo.' }, { status: 400 });
  }

  const nombreSanitizado = sanitizarNombreArchivo(nombreOriginal);
  const key = `staging/${sesion}/${Date.now()}-${nombreSanitizado}`;

  try {
    await env.BUCKET.put(key, request.body, {
      httpMetadata: { contentType },
      customMetadata: { nombreOriginal },
    });
    return Response.json({ key });
  } catch (err) {
    console.error('Error subiendo archivo a R2:', err);
    return Response.json({ error: 'No se pudo subir el archivo. Probá de nuevo.' }, { status: 500 });
  }
}

export async function onRequestDelete({ request, env }) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  // Por seguridad, este endpoint solo puede borrar objetos de staging —
  // nunca archivos ya confirmados de un trabajo (trabajos/...).
  if (!key || !key.startsWith('staging/')) {
    return Response.json({ error: 'Key inválida.' }, { status: 400 });
  }

  try {
    await env.BUCKET.delete(key);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('Error borrando archivo de staging:', err);
    return Response.json({ error: 'No se pudo borrar el archivo.' }, { status: 500 });
  }
}
