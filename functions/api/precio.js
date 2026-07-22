import { calcularPrecio } from './lib/precio.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    if (!body.categoria) {
      return Response.json({ error: 'Falta la categoría.' }, { status: 400 });
    }
    if (!Array.isArray(body.archivos) || body.archivos.length === 0) {
      return Response.json({ error: 'Se requiere al menos un archivo.' }, { status: 400 });
    }
    const resultado = await calcularPrecio(env.DB, body.archivos, body.categoria);
    return Response.json(resultado);
  } catch (err) {
    return Response.json({ error: err.message || 'No se pudo calcular el precio.' }, { status: 500 });
  }
}
