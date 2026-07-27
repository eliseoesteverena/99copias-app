// functions/api/lib/precio-fotos.js
//
// Cálculo de precio para la categoría "fotos". Vive separado de
// functions/api/lib/precio.js (que calcula por "carillas" = páginas × copias
// ÷ páginas_por_carilla, un modelo pensado para impresión de documentos que
// no aplica acá) para no arriesgar el flujo de impresión, que ya está en
// producción funcionando.
//
// Modelo de fotos: un tamaño = un producto = un precio unitario fijo.
// Precio de cada foto = precio_unitario(tamaño) × copias. No hay acabado,
// no hay imposición, no hay páginas.
//
// trabajos.js sólo conoce la forma { items, total }, con
// items[].carillas usado para: (a) sumar el volumen total del pedido y
// pasárselo a horasMinimasRequeridas()/calcularEnvio(), que ya reciben ese
// número como una cantidad genérica, no específica de páginas. Para fotos,
// "carillas" son las copias de cada foto — es la unidad de volumen
// equivalente.
//
// Espejo en el frontend: fotos/app.js, función calcularFoto(). Si se cambia
// algo acá, cambiarlo también ahí, o el precio en pantalla no va a coincidir
// con lo cobrado (mismo riesgo ya documentado para lib/precio.js).

/**
 * Catálogo de productos de tamaño habilitados para la categoría "fotos".
 * Se filtra también por patrón de código ({ancho}x{alto}_variante) para
 * excluir productos transversales (categoria_id NULL) que pertenecen al
 * catálogo de otra categoría, como acabados de impresión ("Anillado",
 * "Suelto", "Abrochado") — esos no tienen sentido para fotos.
 */
export async function catalogoFotos(db) {
  const categoria = await db
    .prepare('SELECT id FROM categorias WHERE codigo = ? AND activa = 1')
    .bind('fotos')
    .first();
  if (!categoria) return [];

  const { results } = await db
    .prepare(
      `SELECT id, descripcion, unidad_medida, precio, codigo, categoria_id, jerarquia
       FROM productos
       WHERE habilitado = 1 AND categoria_id = ?`
    )
    .bind(categoria.id)
    .all();

  return (results || []).filter(p => /^\d+x\d+/i.test(p.codigo));
}

/**
 * Calcula el precio de un pedido de fotos completo.
 * @param {import('@cloudflare/workers-types').D1Database} db
 * @param {Array} archivos - [{ primario: codigo de tamaño, copias }], tal
 *   como llega en el body de POST /api/trabajos.
 * @param {string} categoria - se recibe por firma-espejo con calcularPrecio()
 *   de lib/precio.js, aunque acá siempre va a ser 'fotos' (el caller ya
 *   hizo el branch antes de llamar a esta función).
 * @returns {{ items: Array<{codigo:string, precioUnitario:number, copias:number, carillas:number, total:number}>, total: number }}
 */
export async function calcularPrecioFotos(db, archivos, categoria) {
  if (!Array.isArray(archivos) || archivos.length === 0) {
    throw new Error('El pedido de fotos no tiene archivos.');
  }

  const catalogo = await catalogoFotos(db);
  if (!catalogo.length) {
    throw new Error('No hay tamaños de fotos habilitados en este momento.');
  }

  const items = archivos.map(a => {
    const copias = Math.max(1, parseInt(a.copias, 10) || 1);
    const producto = catalogo.find(p => p.codigo === a.primario);
    if (!producto) {
      throw new Error(`Tamaño de foto no reconocido: "${a.primario}".`);
    }
    const precioUnitario = producto.precio;
    return {
      codigo: producto.codigo,
      descripcion: producto.descripcion,
      precioUnitario,
      copias,
      // "carillas" es el nombre de campo que trabajos.js ya conoce y suma
      // para calcular el volumen total del pedido (turnos/envío) — para
      // fotos equivale simplemente a la cantidad de copias de esa foto.
      carillas: copias,
      total: precioUnitario * copias,
    };
  });

  const total = items.reduce((acc, it) => acc + it.total, 0);
  return { items, total };
}
