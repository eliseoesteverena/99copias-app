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

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('media').filter((f) => f && f.size > 0);
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';

    if (files.length === 0) {
      return Response.redirect('/?share-error=no-files', 303);
    }

    const cache = await caches.open(SHARE_CACHE);

    // Limpiamos restos de un share anterior no consumido.
    const keys = await cache.keys();
    await Promise.all(keys.map((k) => cache.delete(k)));

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

    await cache.put(
      'shared-files-index',
      new Response(JSON.stringify({ title, text, files: index }), {
        headers: { 'content-type': 'application/json' },
      })
    );

    return Response.redirect('/?from=share-target', 303);
  } catch (err) {
    return Response.redirect('/?share-error=1', 303);
  }
}
