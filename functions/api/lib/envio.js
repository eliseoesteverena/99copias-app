// Costo de envío: precio base de la zona, con un descuento por volumen (tramos de
// carillas totales del pedido, por categoría) — o $0 si la zona es "retiro en local".
// El resultado de esto SIEMPRE se recalcula server-side al confirmar el pedido y
// queda congelado en trabajos.costo_envio — nunca se confía en lo que mande el cliente.

export async function calcularEnvio(db, zonaId, categoriaCodigo, carillasTotal) {
  const zona = await db.prepare('SELECT id, nombre, precio_envio, es_retiro FROM zonas WHERE id = ?')
    .bind(zonaId).first();
  if (!zona) throw new Error('La zona elegida no existe.');

  if (zona.es_retiro) {
    return { con_envio: false, costo_envio: 0, precio_base: 0, descuento_porcentaje: 0, zona_nombre: zona.nombre };
  }

  const tramo = await db.prepare(
    `SELECT de.porcentaje_descuento
       FROM descuentos_envio de
       JOIN categorias c ON c.id = de.categoria_id
      WHERE c.codigo = ? AND de.activa = 1
        AND de.carillas_desde <= ?
        AND (de.carillas_hasta IS NULL OR de.carillas_hasta >= ?)
      ORDER BY de.carillas_desde DESC
      LIMIT 1`
  ).bind(categoriaCodigo, carillasTotal, carillasTotal).first();

  const descuentoPorcentaje = tramo ? tramo.porcentaje_descuento : 0;
  const costoEnvio = Math.round(zona.precio_envio * (1 - descuentoPorcentaje / 100));

  return {
    con_envio: true, costo_envio: costoEnvio, precio_base: zona.precio_envio,
    descuento_porcentaje: descuentoPorcentaje, zona_nombre: zona.nombre,
  };
}
