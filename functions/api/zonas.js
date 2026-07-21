export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB
      .prepare('SELECT id, nombre, precio_envio, es_retiro FROM zonas WHERE activa = 1 ORDER BY es_retiro DESC, nombre')
      .all();
    return Response.json(results);
  } catch (err) {
    return Response.json({ error: 'No se pudieron leer las zonas.' }, { status: 500 });
  }
}
