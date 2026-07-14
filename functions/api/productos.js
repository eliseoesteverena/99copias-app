export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB
      .prepare('SELECT id, descripcion, unidad_medida, precio, jerarquia FROM productos WHERE habilitado = 1 ORDER BY jerarquia, id')
      .all();
    return Response.json(results);
  } catch (err) {
    return Response.json({ error: 'No se pudo leer el catálogo de productos.' }, { status: 500 });
  }
}
