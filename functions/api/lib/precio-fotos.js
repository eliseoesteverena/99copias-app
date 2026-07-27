// functions/api/lib/precio-fotos.js
//
// Única fuente de verdad del cálculo de precio para la categoría "fotos".
// Deliberadamente separado de functions/api/lib/precio.js: ese archivo calcula
// por "carillas" (páginas × copias ÷ páginas_por_carilla), un modelo pensado
// para impresión de documentos que no aplica a fotos.
//
// Modelo de fotos: un tamaño = un producto = un precio unitario fijo.
// Precio de cada foto = precio_unitario(tamaño) × copias. No hay carillas,
// no hay acabado, no hay imposición.
//
// Espejo en el frontend: fotos/app.js, función calcularFoto(). Si se cambia
// algo acá, cambiarlo también ahí, o el precio en pantalla no va a coincidir
// con lo cobrado (mismo riesgo documentado para lib/precio.js en el handoff).

/**
 * Devuelve el catálogo de productos habilitados para la categoría "fotos"
 * (productos con categoria_id = la fila de categorias.codigo = 'fotos').
 * Igual criterio que catalogoDeCategoria() en lib/precio.js: incluye
 * transversales (categoria_id NULL) además de los propios de la categoría,
 * aunque en la práctica "fotos" no debería tener productos transversales
 * compartidos con "impresion-rapida" (son catálogos distintos por diseño,
 * ver DEC-01 en el handoff).
 */
async function catalogoDeCategoriaFotos(db) {
  const categoria = await db
    .prepare('SELECT id FROM categorias WHERE codigo = ? AND activa = 1')
    .bind('fotos')
    .first();
  if (!categoria) return [];

  const { results } = await db
    .prepare(
      `SELECT id, descripcion, unidad_medida, precio, codigo, categoria_id, jerarquia
       FROM productos
       WHERE habilitado = 1 AND (categoria_id = ? OR categoria_id IS NULL)
       ORDER BY id`
    )
    .bind(categoria.id)
    .all();
  return results || [];
}

/**
 * Calcula el precio de una foto individual.
 * @param {Object} item - { primario: codigo del producto de tamaño, copias: number }
 * @param {Array} catalogo - resultado de catalogoDeCategoriaFotos()
 * @returns {{ codigo: string, precioUnitario: number, copias: number, total: number }}
 */
function calcularPrecioFoto(item, catalogo) {
  const copias = Math.max(1, parseInt(item.copias, 10) || 1);
  const producto = catalogo.find(p => p.codigo === item.primario);
  if (!producto) {
    throw new Error(`Tamaño de foto no reconocido: "${item.primario}"`);
  }
  const precioUnitario = producto.precio;
  return {
    codigo: producto.codigo,
    precioUnitario,
    copias,
    total: precioUnitario * copias,
  };
}

/**
 * Calcula el subtotal (sin envío) de un pedido completo de fotos.
 * @param {Array} archivos - array de { primario, copias } tal como llega en
 *   el body de POST /api/trabajos cuando categoria === 'fotos'.
 * @param {Array} catalogo - resultado de catalogoDeCategoriaFotos()
 * @returns {{ items: Array, subtotal: number, unidadesTotal: number }}
 */
function calcularPedidoFotos(archivos, catalogo) {
  const items = archivos.map(a => calcularPrecioFoto(a, catalogo));
  const subtotal = items.reduce((acc, it) => acc + it.total, 0);
  // "unidadesTotal" es el equivalente de "carillas" para fotos: se usa para
  // filtrar turnos por cupo/anticipación y para el cálculo de envío por
  // volumen, reusando lib/produccion.js y lib/envio.js tal cual están —
  // ambos ya reciben un número de "carillas" genérico, no específico de PDF.
  const unidadesTotal = items.reduce((acc, it) => acc + it.copias, 0);
  return { items, subtotal, unidadesTotal };
}

module.exports = {
  catalogoDeCategoriaFotos,
  calcularPrecioFoto,
  calcularPedidoFotos,
};
