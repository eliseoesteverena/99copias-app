import { calcularPrecio } from './lib/precio.js';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { cliente, zona_id, turno_entrega_id, fecha_entrega, direccion_entrega, archivos } = body;

    if (!cliente || !cliente.nombre || !cliente.apellido || !cliente.documento_numero) {
      return Response.json({ error: 'Faltan datos del cliente.' }, { status: 400 });
    }
    if (!zona_id || !turno_entrega_id || !fecha_entrega || !direccion_entrega) {
      return Response.json({ error: 'Faltan datos de entrega.' }, { status: 400 });
    }
    if (!Array.isArray(archivos) || archivos.length === 0) {
      return Response.json({ error: 'El pedido no tiene archivos.' }, { status: 400 });
    }

    const db = env.DB;

    // Chequeo de cupo antes de confirmar (protección básica contra sobreventa).
    const turno = await db.prepare('SELECT capacidad_maxima FROM turnos_entrega WHERE id = ?').bind(turno_entrega_id).first();
    if (!turno) return Response.json({ error: 'El turno elegido ya no existe.' }, { status: 409 });

    const excepcion = await db.prepare(
      'SELECT * FROM turnos_excepciones WHERE turno_entrega_id = ? AND fecha = ?'
    ).bind(turno_entrega_id, fecha_entrega).first();
    if (excepcion && excepcion.tipo === 'cancelado') {
      return Response.json({ error: 'Ese turno fue cancelado para la fecha elegida.' }, { status: 409 });
    }
    const capacidadMaxima = (excepcion && excepcion.tipo === 'capacidad_modificada')
      ? excepcion.capacidad_maxima
      : turno.capacidad_maxima;

    if (capacidadMaxima != null) {
      const ocupadosRow = await db.prepare(
        'SELECT COUNT(*) as n FROM trabajos WHERE turno_entrega_id = ? AND fecha_entrega = ?'
      ).bind(turno_entrega_id, fecha_entrega).first();
      if (ocupadosRow.n >= capacidadMaxima) {
        return Response.json({ error: 'Ese turno ya no tiene cupo disponible.' }, { status: 409 });
      }
    }

    // Upsert de cliente por (documento_tipo, documento_numero).
    const docTipo = cliente.documento_tipo === 'cuit' ? 'cuit' : 'dni';
    let clienteRow = await db.prepare(
      'SELECT id FROM clientes WHERE documento_tipo = ? AND documento_numero = ?'
    ).bind(docTipo, cliente.documento_numero).first();

    let clienteId;
    if (clienteRow) {
      clienteId = clienteRow.id;
      await db.prepare(
        `UPDATE clientes SET nombre = ?, apellido = ?, email = ?, celular = ?, direccion = ? WHERE id = ?`
      ).bind(cliente.nombre, cliente.apellido, cliente.email || null, cliente.celular || null, cliente.direccion || null, clienteId).run();
    } else {
      const insert = await db.prepare(
        `INSERT INTO clientes (nombre, apellido, documento_tipo, documento_numero, email, celular, direccion)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(cliente.nombre, cliente.apellido, docTipo, cliente.documento_numero, cliente.email || null, cliente.celular || null, cliente.direccion || null).run();
      clienteId = insert.meta.last_row_id;
    }

    // Precio recalculado en servidor — nunca se confía en el total del cliente.
    const { items, total } = await calcularPrecio(db, archivos);

    const configuracion = JSON.stringify({ archivos, items });

    const insertTrabajo = await db.prepare(
      `INSERT INTO trabajos (cliente_id, configuracion, estado, total, direccion_entrega, fecha_entrega, zona_id, turno_entrega_id, pagado)
       VALUES (?, ?, 'pendiente', ?, ?, ?, ?, ?, 0)`
    ).bind(clienteId, configuracion, total, direccion_entrega, fecha_entrega, zona_id, turno_entrega_id).run();

    return Response.json({ trabajo_id: insertTrabajo.meta.last_row_id, total, items });
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message || 'No se pudo crear el trabajo.' }, { status: 500 });
  }
}
