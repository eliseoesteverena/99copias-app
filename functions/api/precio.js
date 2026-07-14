// Cálculo de precio — única fuente de verdad, corre en el servidor.
// Reglas (confirmadas con el cliente):
//  - 1 página = 1 carilla, siempre (el faz simple/doble no cambia el conteo de carillas,
//    es un dato operativo para el taller).
//  - El producto "primario" (jerarquia = 'primario') se cobra por carilla × copias.
//  - Cada archivo tiene UN acabado (Suelto / Abrochado / Anillado / Clip), que es un
//    producto "secundario" independiente. Se cobra 1 vez por cada copia del archivo.
//  - El precio final SIEMPRE se recalcula acá, nunca se confía en el total que manda el cliente.

const ACABADO_A_DESCRIPCION = {
  suelto: 'Sueltas',
  abrochado: 'Abrochadas',
  anillado: 'Anillados A4',
  clip: 'Clip',
};
const DESCRIPCION_PRIMARIO = 'Impresión ByN A4 (carilla)';

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

// archivos: [{ paginas, copias, rango, acabado }]
export async function calcularPrecio(db, archivos) {
  const { results: productos } = await db
    .prepare('SELECT id, descripcion, precio, jerarquia FROM productos WHERE habilitado = 1')
    .all();

  const porDescripcion = Object.fromEntries(productos.map(p => [p.descripcion, p]));
  const primario = porDescripcion[DESCRIPCION_PRIMARIO];
  if (!primario) throw new Error('Producto primario no configurado (' + DESCRIPCION_PRIMARIO + ')');

  const items = [];
  let total = 0;

  for (const a of archivos) {
    const totalPaginas = Math.max(1, parseInt(a.paginas, 10) || 1);
    const copias = Math.max(1, parseInt(a.copias, 10) || 1);
    const paginasSeleccionadas = contarPaginasEnRango(a.rango, totalPaginas);
    const carillas = paginasSeleccionadas * copias;

    const subtotalPrimario = carillas * primario.precio;

    const descSecundario = ACABADO_A_DESCRIPCION[a.acabado] || ACABADO_A_DESCRIPCION.suelto;
    const secundario = porDescripcion[descSecundario];
    if (!secundario) throw new Error('Producto secundario no configurado (' + descSecundario + ')');
    const subtotalSecundario = copias * secundario.precio;

    const totalArchivo = subtotalPrimario + subtotalSecundario;
    total += totalArchivo;

    items.push({
      nombre: a.nombre || null,
      paginas: paginasSeleccionadas,
      copias,
      carillas,
      producto_primario_id: primario.id,
      subtotal_primario: subtotalPrimario,
      producto_secundario_id: secundario.id,
      producto_secundario: descSecundario,
      subtotal_secundario: subtotalSecundario,
      total: totalArchivo,
    });
  }

  return { items, total };
}
