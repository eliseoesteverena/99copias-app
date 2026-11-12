// functions/api/turnos/proximos.js  ->  GET /api/turnos/proximos?categoria=...&carillas=...
//
// Devuelve, en UNA llamada, el próximo turno disponible de cada zona activa
// (envíos y puntos de retiro). Aplica las mismas reglas que /api/turnos:
// excepciones (cancelado / horario_modificado / capacidad_modificada), cupo por
// turno y mínimo de producción según categoría y carillas. Además descarta los
// turnos de hoy que ya empezaron, aunque no haya regla de producción para la categoría.
//
// En vez de hacer 2 consultas por turno (como /api/turnos), hace 5 consultas en total,
// sin importar cuántas zonas ni días haya, y cachea el resultado 60 s en Cloudflare.

import { horasMinimasRequeridas, turnoAInstante, cumpleAnticipacion } from '../lib/produccion.js';

const VENTANA_DIAS = 14;          // misma ventana que el selector de la app
const TTL_SEGUNDOS = 60;
const AR_MS = 3 * 3600 * 1000;    // Argentina = UTC-3 (igual que lib/produccion.js)

// Fecha (YYYY-MM-DD) de hoy + i días, en hora argentina.
function fechaAR(ahora, i) {
  return new Date(ahora.getTime() - AR_MS + i * 86400000).toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const categoria = url.searchParams.get('categoria') || '';
  const carillas = Math.min(Math.max(parseInt(url.searchParams.get('carillas') || '0', 10) || 0, 0), 100000);

  if (categoria && !/^[a-z0-9_-]{1,50}$/i.test(categoria)) {
    return Response.json({ error: 'categoria inválida.' }, { status: 400 });
  }

  // Caché de Cloudflare: la clave solo depende de lo que cambia el resultado.
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(
    `${url.origin}${url.pathname}?categoria=${encodeURIComponent(categoria)}&carillas=${carillas}`
  );
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }

  try {
    const ahora = new Date();
    const fechas = Array.from({ length: VENTANA_DIAS }, (_, i) => fechaAR(ahora, i));
    const desde = fechas[0];
    const hasta = fechas[fechas.length - 1];

    const horasMinimas = categoria ? await horasMinimasRequeridas(env.DB, categoria, carillas) : 0;

    const [zonasQ, turnosQ, excepcionesQ, ocupadosQ] = await Promise.all([
      env.DB.prepare(
        'SELECT id, nombre, precio_envio, es_retiro FROM zonas WHERE activa = 1 ORDER BY es_retiro, nombre'
      ).all(),
      env.DB.prepare(
        'SELECT id, zona_id, dia_semana, hora_inicio, hora_fin, capacidad_maxima FROM turnos_entrega WHERE activo = 1'
      ).all(),
      env.DB.prepare(
        'SELECT turno_entrega_id, fecha, tipo, hora_inicio, hora_fin, capacidad_maxima FROM turnos_excepciones WHERE fecha BETWEEN ? AND ?'
      ).bind(desde, hasta).all(),
      env.DB.prepare(
        'SELECT turno_entrega_id, fecha_entrega, COUNT(*) AS n FROM trabajos WHERE fecha_entrega BETWEEN ? AND ? GROUP BY turno_entrega_id, fecha_entrega'
      ).bind(desde, hasta).all(),
    ]);

    // Índices en memoria
    const turnosPorZonaDia = new Map();
    for (const t of turnosQ.results) {
      const k = `${t.zona_id}|${t.dia_semana}`;
      if (!turnosPorZonaDia.has(k)) turnosPorZonaDia.set(k, []);
      turnosPorZonaDia.get(k).push(t);
    }
    const excepciones = new Map();
    for (const e of excepcionesQ.results) {
      const k = `${e.turno_entrega_id}|${e.fecha}`;
      if (!excepciones.has(k)) excepciones.set(k, e); // como .first() en /api/turnos
    }
    const ocupados = new Map();
    for (const o of ocupadosQ.results) ocupados.set(`${o.turno_entrega_id}|${o.fecha_entrega}`, o.n);

    const salida = zonasQ.results.map((z) => {
      let proximo = null;

      for (const fecha of fechas) {
        const dow = new Date(fecha + 'T00:00:00Z').getUTCDay(); // 0 = domingo
        const candidatos = [];

        for (const t of turnosPorZonaDia.get(`${z.id}|${dow}`) || []) {
          const ex = excepciones.get(`${t.id}|${fecha}`);
          if (ex && ex.tipo === 'cancelado') continue;

          let horaInicio = t.hora_inicio, horaFin = t.hora_fin, capacidad = t.capacidad_maxima;
          if (ex && ex.tipo === 'horario_modificado') {
            horaInicio = ex.hora_inicio || horaInicio;
            horaFin = ex.hora_fin || horaFin;
          }
          if (ex && ex.tipo === 'capacidad_modificada') capacidad = ex.capacidad_maxima;

          const n = ocupados.get(`${t.id}|${fecha}`) || 0;
          const hayCupo = capacidad == null || n < capacidad;
          const llegaAProducir = cumpleAnticipacion(fecha, horaInicio, horasMinimas, ahora);
          const noEmpezo = turnoAInstante(fecha, horaInicio) > ahora;

          if (hayCupo && llegaAProducir && noEmpezo) {
            candidatos.push({
              turno_entrega_id: t.id,
              hora_inicio: horaInicio,
              hora_fin: horaFin,
              capacidad_maxima: capacidad,
              ocupados: n,
            });
          }
        }

        if (candidatos.length) {
          candidatos.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
          proximo = { fecha, turno: candidatos[0] };
          break;
        }
      }

      return {
        zona_id: z.id,
        nombre: z.nombre,
        es_retiro: z.es_retiro,
        precio_envio: z.precio_envio,
        proximo,
      };
    });

    const respuesta = Response.json(
      { generado: ahora.toISOString(), zonas: salida },
      { headers: { 'Cache-Control': `public, max-age=${TTL_SEGUNDOS}` } }
    );
    if (cache) {
      const guardar = cache.put(cacheKey, respuesta.clone());
      if (waitUntil) waitUntil(guardar); else await guardar;
    }
    return respuesta;
  } catch (err) {
    return Response.json({ error: 'No se pudieron leer los próximos turnos.' }, { status: 500 });
  }
}
