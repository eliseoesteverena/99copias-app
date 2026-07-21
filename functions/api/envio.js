import { calcularEnvio } from './lib/envio.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const zonaId = url.searchParams.get('zona_id');
  const categoria = url.searchParams.get('categoria');
  const carillas = parseInt(url.searchParams.get('carillas') || '0', 10) || 0;

  if (!zonaId || !categoria) {
    return Response.json({ error: 'Faltan parámetros zona_id y/o categoria.' }, { status: 400 });
  }

  try {
    const resultado = await calcularEnvio(env.DB, zonaId, categoria, carillas);
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo calcular el envío.' }, { status: 500 });
  }
}
