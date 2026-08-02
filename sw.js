// sw.js — Service Worker de 99copias.
//
// Hoy tiene un único trabajo: interceptar el POST que el sistema operativo
// manda a /share-handler cuando alguien comparte archivos hacia la PWA
// instalada (Web Share Target API), guardarlos temporalmente, y mandar al
// usuario al hub (/) para que elija a qué wizard van.
//
// No hace precache ni maneja modo offline — si eso se necesita más
// adelante, agregar un 'install'/'activate' con cache de assets estáticos
// por separado de esto.

const SHARE_CACHE = 'share-target-temp';

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/share-handler') {
    event.respondWith(handleShareTarget(event.request));
  }
});

// DEBUG TEMPORAL — guarda un paso a paso de lo que pasó adentro del SW en el
// propio Cache API, para poder verlo desde el hub sin necesitar consola.
// Sacar esto (y el bloque correspondiente en index.html) una vez confirmado
// que el flujo funciona de punta a punta.
async function logDebug(steps) {
  try {
    const cache = await caches.open(SHARE_CACHE);
    await cache.put(
      'share-target-debug',
      new Response(JSON.stringify({ ts: Date.now(), steps }), {
        headers: { 'content-type': 'application/json' },
      })
    );
  } catch (e) {
    // si ni esto funciona, no hay mucho más que hacer sin consola
  }
}

async function handleShareTarget(request) {
  const steps = [];
  try {
    steps.push('handleShareTarget: arrancó');
    steps.push(`request.url = ${request.url}`);
    steps.push(`request.method = ${request.method}`);

    const formData = await request.formData();
    steps.push('formData leído OK');

    const formKeys = Array.from(formData.keys());
    steps.push(`keys en formData: [${formKeys.join(', ')}]`);

    const allMedia = formData.getAll('media');
    steps.push(`formData.getAll('media').length = ${allMedia.length}`);
    allMedia.forEach((f, i) => {
      steps.push(`  media[${i}]: name=${f && f.name}, type=${f && f.type}, size=${f && f.size}`);
    });

    const files = allMedia.filter((f) => f && f.size > 0);
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';

    if (files.length === 0) {
      steps.push('ABORTA: 0 archivos válidos después del filtro');
      await logDebug(steps);
      return Response.redirect('/?share-error=no-files', 303);
    }

    const cache = await caches.open(SHARE_CACHE);
    steps.push('cache share-target-temp abierta');

    // Limpiamos restos de un share anterior no consumido (pero conservamos
    // el debug log hasta el final, por eso no usamos cache.keys() genérico).
    const keys = await cache.keys();
    await Promise.all(
      keys
        .filter((k) => !k.url.endsWith('share-target-debug'))
        .map((k) => cache.delete(k))
    );
    steps.push('cache anterior limpiada');

    const index = await Promise.all(
      files.map(async (file, i) => {
        const key = `file-${i}-${encodeURIComponent(file.name || 'archivo')}`;
        await cache.put(key, new Response(file));
        return {
          key,
          name: file.name || `archivo-${i + 1}`,
          type: file.type || '',
          size: file.size,
          lastModified: file.lastModified || Date.now(),
        };
      })
    );
    steps.push(`${index.length} archivo(s) guardados en cache`);

    await cache.put(
      'shared-files-index',
      new Response(JSON.stringify({ title, text, files: index }), {
        headers: { 'content-type': 'application/json' },
      })
    );
    steps.push('shared-files-index escrito OK');
    steps.push('REDIRIGIENDO a /?from=share-target');

    await logDebug(steps);
    return Response.redirect('/?from=share-target', 303);
  } catch (err) {
    steps.push(`ERROR ATRAPADO: ${err && err.message}`);
    steps.push(`stack: ${err && err.stack}`);
    await logDebug(steps);
    return Response.redirect('/?share-error=1', 303);
  }
}
