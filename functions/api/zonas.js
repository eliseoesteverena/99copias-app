export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const tipo = url.searchParams.get('tipo'); // 'envio' | 'retiro' | null (sin filtrar — comportamiento original)

    let sql = 'SELECT id, nombre, precio_envio, es_retiro FROM zonas WHERE activa = 1';
    if (tipo === 'envio') sql += ' AND es_retiro = 0';
    else if (tipo === 'retiro') sql += ' AND es_retiro = 1';
    sql += ' ORDER BY es_retiro DESC, nombre';

    const { results } = await env.DB.prepare(sql).all();
    return Response.json(results);
  } catch (err) {
    return Response.json({ error: 'No se pudieron leer las zonas.' }, { status: 500 });
  }
}
