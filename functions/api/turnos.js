export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const zonaId = url.searchParams.get('zona_id');
  const fecha = url.searchParams.get('fecha'); // YYYY-MM-DD

  if (!zonaId || !fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return Response.json({ error: 'Faltan parámetros zona_id y/o fecha (YYYY-MM-DD).' }, { status: 400 });
  }

  try {
    // 0 = domingo ... 6 = sábado, igual que en el schema.
    const diaSemana = new Date(fecha + 'T00:00:00Z').getUTCDay();

    const { results: turnos } = await env.DB
      .prepare('SELECT * FROM turnos_entrega WHERE zona_id = ? AND dia_semana = ? AND activo = 1 ORDER BY hora_inicio')
      .bind(zonaId, diaSemana)
      .all();

    const salida = [];
    for (const t of turnos) {
      const excepcion = await env.DB
        .prepare('SELECT * FROM turnos_excepciones WHERE turno_entrega_id = ? AND fecha = ?')
        .bind(t.id, fecha)
        .first();

      if (excepcion && excepcion.tipo === 'cancelado') continue;

      let horaInicio = t.hora_inicio, horaFin = t.hora_fin, capacidadMaxima = t.capacidad_maxima;
      if (excepcion && excepcion.tipo === 'horario_modificado') {
        horaInicio = excepcion.hora_inicio || horaInicio;
        horaFin = excepcion.hora_fin || horaFin;
      }
      if (excepcion && excepcion.tipo === 'capacidad_modificada') {
        capacidadMaxima = excepcion.capacidad_maxima;
      }

      const ocupadosRow = await env.DB
        .prepare('SELECT COUNT(*) as n FROM trabajos WHERE turno_entrega_id = ? AND fecha_entrega = ?')
        .bind(t.id, fecha)
        .first();
      const ocupados = ocupadosRow ? ocupadosRow.n : 0;
      const disponible = capacidadMaxima == null || ocupados < capacidadMaxima;

      salida.push({
        turno_entrega_id: t.id,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        capacidad_maxima: capacidadMaxima,
        ocupados,
        disponible,
      });
    }

    return Response.json(salida);
  } catch (err) {
    return Response.json({ error: 'No se pudieron leer los turnos.' }, { status: 500 });
  }
}
