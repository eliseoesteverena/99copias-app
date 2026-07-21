// Cálculo de precio — única fuente de verdad, corre en el servidor.
//
// Reglas:
//  - 1 página = 1 carilla, siempre (el faz simple/doble no cambia el conteo de carillas,
//    es un dato operativo para el taller).
//  - "Páginas por carilla" (1/2/4/6) es imposición: cuántas páginas lógicas entran en una
//    hoja física. hojas_fisicas = ceil(páginas_del_rango / páginas_por_carilla) — es lo que
//    efectivamente se imprime y se factura por copia. carillas = hojas_fisicas × copias.
//  - Cada archivo elige UN producto "primario" (jerarquia='primario') — ej. ByN o Color —
//    y se cobra por carilla × copias. Puede haber más de un primario habilitado a la vez
//    dentro de una categoría; el archivo tiene que indicar cuál eligió (a.primario, un código).
//  - Cada archivo elige UN acabado (Suelto / Abrochado / Anillado / Clip), producto
//    "secundario", independiente del primario. Se cobra 1 vez por cada copia del archivo.
//    El mínimo de páginas de un acabado (ej. Anillado) se compara contra las HOJAS FÍSICAS
//    por copia, no contra las páginas lógicas — lo que se anilla son hojas, no páginas.
//  - Los productos se identifican por `codigo` (estable), nunca por `descripcion` (editable).
//  - El precio final SIEMPRE se recalcula acá, nunca se confía en el total que manda el cliente.

const PAGINAS_POR_CARILLA_VALIDAS = [1, 2, 4, 6];

function contarPaginasEnRango(rango, totalPaginas) {
  totalPaginas = totalPaginas || 1;
  if (!rango || !String(rango).trim()) return totalPaginas;
  const set = new Set();
  String(rango).split(',').forEach(part => {
    part = part.trim();
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p++) if (p >= 1 && p <= totalPaginas) set.add(p);
    } else if (/^\d+$/.test(part)) {
      const p = parseInt(part, 10);
      if (p >= 1 && p <= totalPaginas) set.add(p);
    }
  });
  return set.size || totalPaginas;
}

// Trae el catálogo utilizable por una categoría: los productos propios de esa categoría
// + los transversales (categoria_id NULL, ej. los acabados). Indexado por `codigo`.
export async function catalogoDeCategoria(db, categoriaCodigo) {
  const { results: productos } = await db.prepare(
    `SELECT p.id, p.descripcion, p.precio, p.jerarquia, p.codigo, p.paginas_minimas
       FROM productos p
       LEFT JOIN categorias c ON c.id = p.categoria_id
      WHERE p.habilitado = 1
        AND (c.codigo = ? OR p.categoria_id IS NULL)`
  ).bind(categoriaCodigo).all();

  const porCodigo = Object.fromEntries(productos.filter(p => p.codigo).map(p => [p.codigo, p]));
  const primarios = productos.filter(p => p.jerarquia === 'primario');
  const secundarios = productos.filter(p => p.jerarquia === 'secundario');
  return { productos, porCodigo, primarios, secundarios };
}

// archivos: [{ paginas, copias, rango, primario, acabado, paginas_por_carilla }]
// primario / acabado son códigos de producto (ej. 'byn_a4', 'anillado').
export async function calcularPrecio(db, archivos, categoriaCodigo) {
  const { porCodigo, primarios } = await catalogoDeCategoria(db, categoriaCodigo);

  if (!primarios.length) {
    throw new Error(`No hay ningún producto primario habilitado para la categoría "${categoriaCodigo}".`);
  }

  const items = [];
  let total = 0;

  for (const a of archivos) {
    const totalPaginas = Math.max(1, parseInt(a.paginas, 10) || 1);
    const copias = Math.max(1, parseInt(a.copias, 10) || 1);
    const paginasSeleccionadas = contarPaginasEnRango(a.rango, totalPaginas);

    const paginasPorCarilla = parseInt(a.paginas_por_carilla, 10) || 1;
    if (!PAGINAS_POR_CARILLA_VALIDAS.includes(paginasPorCarilla)) {
      throw new Error(`Páginas por carilla inválido: "${a.paginas_por_carilla || ''}" (válidos: ${PAGINAS_POR_CARILLA_VALIDAS.join(', ')})`);
    }
    const hojasFisicas = Math.ceil(paginasSeleccionadas / paginasPorCarilla);
    const carillas = hojasFisicas * copias;

    const primario = porCodigo[a.primario];
    if (!primario || primario.jerarquia !== 'primario') {
      throw new Error(`Producto primario inválido o no disponible: "${a.primario || ''}"`);
    }
    const subtotalPrimario = carillas * primario.precio;

    const secundario = porCodigo[a.acabado];
    if (!secundario || secundario.jerarquia !== 'secundario') {
      throw new Error(`Acabado inválido o no disponible: "${a.acabado || ''}"`);
    }
    if (secundario.paginas_minimas && hojasFisicas < secundario.paginas_minimas) {
      throw new Error(
        `"${a.nombre || 'Un archivo'}" tiene ${hojasFisicas} hoja(s) física(s) por copia, ` +
        `pero "${secundario.descripcion}" requiere un mínimo de ${secundario.paginas_minimas}.`
      );
    }
    const subtotalSecundario = copias * secundario.precio;

    const totalArchivo = subtotalPrimario + subtotalSecundario;
    total += totalArchivo;

    items.push({
      nombre: a.nombre || null,
      paginas: paginasSeleccionadas,
      paginas_por_carilla: paginasPorCarilla,
      hojas_fisicas: hojasFisicas,
      copias,
      carillas,
      producto_primario_id: primario.id,
      producto_primario: primario.codigo,
      subtotal_primario: subtotalPrimario,
      producto_secundario_id: secundario.id,
      producto_secundario: secundario.codigo,
      subtotal_secundario: subtotalSecundario,
      total: totalArchivo,
    });
  }

  return { items, total };
}
