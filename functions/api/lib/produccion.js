// Tiempo mínimo de producción: cuántas horas corridas de anticipación necesita
// un pedido de X carillas antes de que un turno se pueda ofrecer/confirmar.
// Horas corridas (no hábiles) — así lo definimos: 24hs = 24hs reales.

// Busca el tramo que corresponde a `carillas` dentro de la categoría dada.
// Sin regla configurada para esa categoría/rango => 0 (sin restricción extra).
export async function horasMinimasRequeridas(db, categoriaCodigo, carillas) {
  const row = await db.prepare(
    `SELECT r.horas_minimas
       FROM reglas_produccion r
       JOIN categorias c ON c.id = r.categoria_id
      WHERE c.codigo = ? AND r.activa = 1
        AND r.carillas_desde <= ?
        AND (r.carillas_hasta IS NULL OR r.carillas_hasta >= ?)
      ORDER BY r.carillas_desde DESC
      LIMIT 1`
  ).bind(categoriaCodigo, carillas, carillas).first();
  return row ? row.horas_minimas : 0;
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
