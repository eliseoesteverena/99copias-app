// functions/api/_middleware.js  (en el proyecto de Pages de app.99copias.com.ar)
//
// Habilita CORS solo para el sitio público y solo en los endpoints de lectura
// que usa el widget de turnos. El resto de /api (login, mi-perfil, pedidos…)
// queda igual que hoy: sin CORS.

const ORIGENES_PERMITIDOS = [
  'https://99copias.com.ar',
  'https://www.99copias.com.ar',
  // 'https://tu-proyecto.pages.dev', // descomentá para probar en un preview
];

const RUTAS_PUBLICAS = ['/api/zonas', '/api/turnos', '/api/turnos/dias'];

function cabecerasCors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export async function onRequest(context) {
  const { request } = context;
  const origin = request.headers.get('Origin');
  const ruta = new URL(request.url).pathname.replace(/\/$/, '');
  const permitido = !!origin && ORIGENES_PERMITIDOS.includes(origin) && RUTAS_PUBLICAS.includes(ruta);

  // Preflight (el widget no lo dispara, pero conviene responderlo bien)
  if (request.method === 'OPTIONS' && permitido) {
    return new Response(null, { status: 204, headers: cabecerasCors(origin) });
  }

  const response = await context.next();

  if (!permitido || (request.method !== 'GET' && request.method !== 'HEAD')) {
    return response;
  }

  // La respuesta de next() puede ser inmutable: se copia antes de tocar headers.
  const conCors = new Response(response.body, response);
  for (const [k, v] of Object.entries(cabecerasCors(origin))) {
    if (k === 'Vary') conCors.headers.append(k, v);
    else conCors.headers.set(k, v);
  }
  return conCors;
}
