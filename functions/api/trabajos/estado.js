export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const trabajoId = url.searchParams.get('trabajo_id');
  if (!trabajoId) {
    return Response.json({ error: 'Falta trabajo_id.' }, { status: 400 });
  }

  try {
    const trabajo = await env.DB
      .prepare('SELECT id, estado, pagado FROM trabajos WHERE id = ?')
      .bind(trabajoId)
      .first();

    if (!trabajo) return Response.json({ error: 'El trabajo no existe.' }, { status: 404 });

    return Response.json({
      trabajo_id: trabajo.id,
      pagado: !!trabajo.pagado,
      estado: trabajo.estado,
    });
  } catch (err) {
    return Response.json({ error: 'No se pudo consultar el estado del trabajo.' }, { status: 500 });
  }
}
