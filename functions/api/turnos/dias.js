export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const zonaId = url.searchParams.get('zona_id');

  if (!zonaId) {
    return Response.json({ error: 'Falta zona_id.' }, { status: 400 });
  }

  try {
    const { results } = await env.DB
      .prepare('SELECT DISTINCT dia_semana FROM turnos_entrega WHERE zona_id = ? AND activo = 1')
      .bind(zonaId)
      .all();
    return Response.json(results.map(r => r.dia_semana));
  } catch (err) {
    return Response.json({ error: 'No se pudieron leer los días disponibles.' }, { status: 500 });
  }
}
