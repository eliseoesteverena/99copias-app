import { catalogoDeCategoria } from './lib/precio.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const categoria = url.searchParams.get('categoria');

  try {
    if (categoria) {
      // Catálogo utilizable por esa categoría: sus productos propios + los transversales
      // (ej. los acabados, que no pertenecen a ninguna categoría en particular).
      const { productos } = await catalogoDeCategoria(env.DB, categoria);
      productos.sort((a, b) => (a.jerarquia > b.jerarquia ? 1 : -1) || a.id - b.id);
      return Response.json(productos);
    }

    // Sin filtro: catálogo completo habilitado (uso administrativo).
    const { results } = await env.DB
      .prepare('SELECT id, descripcion, unidad_medida, precio, jerarquia, codigo, categoria_id FROM productos WHERE habilitado = 1 ORDER BY jerarquia, id')
      .all();
    return Response.json(results);
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'No se pudo leer el catálogo de productos.' }, { status: 500 });
  }
}
