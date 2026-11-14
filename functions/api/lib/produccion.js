// Tiempo mínimo de producción: cuántas horas corridas de anticipación necesita
// un pedido antes de que un turno se pueda ofrecer/confirmar.
// Horas corridas (no hábiles) — así lo definimos: 24hs = 24hs reales.
//
// Dos tipos de regla conviven en `reglas_produccion`:
//  - Regla de CATEGORÍA (producto_id NULL): tramos de carillas sobre el TOTAL del pedido.
//  - Regla de PRODUCTO (producto_id = N): tramos sobre la cantidad total de ESE producto
//    en el pedido (carillas para un primario, copias para un acabado).
// El pedido necesita el MÁXIMO de horas entre todas las que apliquen: si un producto lleva
// más tiempo, ese manda — no se puede entregar un pedido si uno de sus productos no está listo.

// Regla de categoría: busca el tramo que corresponde a `carillas` totales.
// Sin regla configurada para esa categoría/rango => 0 (sin restricción extra).
export async function horasMinimasRequeridas(db, categoriaCodigo, carillas) {
  const row = await db.prepare(
    `SELECT r.horas_minimas
       FROM reglas_produccion r
       JOIN categorias c ON c.id = r.categoria_id
      WHERE c.codigo = ? AND r.activa = 1
        AND r.producto_id IS NULL
        AND r.carillas_desde <= ?
        AND (r.carillas_hasta IS NULL OR r.carillas_hasta >= ?)
      ORDER BY r.carillas_desde DESC
      LIMIT 1`
  ).bind(categoriaCodigo, carillas, carillas).first();
  return row ? row.horas_minimas : 0;
}

// Cantidad total por producto, a partir de los items que devuelve calcularPrecio().
// Primario => carillas (hojas físicas × copias). Acabado => copias.
// Devuelve { [codigoProducto]: cantidad }.
export function cargaDesdeItems(items) {
  const carga = {};
  for (const it of items || []) {
    if (it.producto_primario) {
      carga[it.producto_primario] = (carga[it.producto_primario] || 0) + (it.carillas || 0);
    }
    if (it.producto_secundario) {
      carga[it.producto_secundario] = (carga[it.producto_secundario] || 0) + (it.copias || 0);
    }
  }
  return carga;
}

// Parsea el query param `carga` de GET /api/turnos: "byn_a4:120,color_a4:30".
// Entradas mal formadas se ignoran en silencio (es solo para ofrecer turnos; la validación
// real se rehace en POST /api/trabajos con los items calculados en servidor).
export function parseCarga(texto) {
  const carga = {};
  if (!texto) return carga;
  for (const parte of String(texto).split(',')) {
    const [codigo, cant] = parte.split(':');
    const n = parseInt(cant, 10);
    if (codigo && /^[a-z0-9_-]+$/i.test(codigo) && Number.isInteger(n) && n > 0) {
      carga[codigo] = (carga[codigo] || 0) + n;
    }
  }
  return carga;
}

// Horas mínimas del pedido completo: máximo entre la regla de categoría (sobre el total)
// y las reglas de cada producto (sobre su propia cantidad).
// Devuelve { horas, origen } — `origen` es null si manda la regla de categoría (o no hay
// ninguna), o { codigo, descripcion, cantidad } del producto que determinó el plazo.
export async function horasMinimasPedido(db, categoriaCodigo, carillasTotal, carga = {}) {
  let resultado = {
    horas: await horasMinimasRequeridas(db, categoriaCodigo, carillasTotal),
    origen: null,
  };

  const hayCarga = Object.values(carga).some((n) => n > 0);
  if (!hayCarga) return resultado;

  const { results: reglas } = await db.prepare(
    `SELECT p.codigo, p.descripcion, r.carillas_desde, r.carillas_hasta, r.horas_minimas
       FROM reglas_produccion r
       JOIN categorias c ON c.id = r.categoria_id
       JOIN productos p ON p.id = r.producto_id
      WHERE c.codigo = ? AND r.activa = 1`
  ).bind(categoriaCodigo).all();

  // Por producto, el tramo más específico (mayor carillas_desde) que contenga su cantidad —
  // mismo criterio de desempate que la regla de categoría.
  const elegidas = {};
  for (const r of reglas) {
    const cantidad = carga[r.codigo];
    if (!cantidad || cantidad < r.carillas_desde) continue;
    if (r.carillas_hasta != null && cantidad > r.carillas_hasta) continue;
    const previa = elegidas[r.codigo];
    if (!previa || r.carillas_desde > previa.carillas_desde) elegidas[r.codigo] = r;
  }

  for (const [codigo, r] of Object.entries(elegidas)) {
    if (r.horas_minimas > resultado.horas) {
      resultado = {
        horas: r.horas_minimas,
        origen: { codigo, descripcion: r.descripcion, cantidad: carga[codigo] },
      };
    }
  }
  return resultado;
}

// Instante real (Date, en UTC internamente) de un turno puntual.
// Asume Argentina (UTC-3, sin horario de verano vigente) — si eso cambiara
// algún día, este es el único lugar que habría que tocar.
export function turnoAInstante(fecha, horaInicio) {
  const [h, m] = (horaInicio || '00:00').split(':').map(Number);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return new Date(`${fecha}T${hh}:${mm}:00-03:00`);
}

// ¿Este turno puntual cumple el mínimo de anticipación requerido, contado desde ahora?
export function cumpleAnticipacion(fecha, horaInicio, horasMinimas, ahora = new Date()) {
  if (!horasMinimas) return true;
  const instanteTurno = turnoAInstante(fecha, horaInicio);
  const limite = new Date(ahora.getTime() + horasMinimas * 3600 * 1000);
  return instanteTurno >= limite;
}
