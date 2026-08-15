// functions/api/mensajes.js — Fase 4 (hilo de mensajes por pedido).
//
// GET  /api/mensajes?trabajo_id=X   -> historial del pedido (dueño verificado)
// POST /api/mensajes                -> el cliente escribe un mensaje nuevo
//
// El lado "operador" (leer/escribir desde el Panel) no se implementa acá —
// es responsabilidad de la conversación del Panel, documentado como
// contrato: misma tabla `mensajes_trabajo`, columna `autor` distingue
// 'cliente'/'operador'. Ver nota de contrato al final del archivo.

import { createAuth } from './lib/auth.js';

async function verificarDueno(db, trabajoId, userId) {
  const trabajo = await db.prepare('SELECT user_id FROM trabajos WHERE id = ?').bind(trabajoId).first();
  return trabajo && trabajo.user_id === userId;
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json({ error: 'Sesión inválida.' }, { status: 401 });
    }
    const url = new URL(request.url);
    const trabajoId = url.searchParams.get('trabajo_id');
    if (!trabajoId) return Response.json({ error: 'Falta trabajo_id.' }, { status: 400 });

    const db = env.DB;
    if (!(await verificarDueno(db, trabajoId, sessionData.user.id))) {
      return Response.json({ error: 'Este pedido no pertenece a tu cuenta.' }, { status: 403 });
    }

    const { results } = await db.prepare(
      'SELECT id, autor, mensaje, creado_en FROM mensajes_trabajo WHERE trabajo_id = ? ORDER BY id ASC'
    ).bind(trabajoId).all();

    // Al entrar a ver el hilo, se marcan como leídos los mensajes del
    // operador — así "Mis pedidos" puede mostrar un indicador de "sin leer"
    // sin necesitar push en tiempo real.
    await db.prepare(
      "UPDATE mensajes_trabajo SET leido_cliente = 1 WHERE trabajo_id = ? AND autor = 'operador' AND leido_cliente = 0"
    ).bind(trabajoId).run();

    return Response.json(results);
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'No se pudieron cargar los mensajes.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = createAuth(env);
    const sessionData = await auth.api.getSession({ headers: request.headers });
    if (!sessionData || !sessionData.user) {
      return Response.json({ error: 'Sesión inválida.' }, { status: 401 });
    }
    const { trabajo_id, mensaje } = await request.json();
    const texto = (mensaje || '').trim();
    if (!trabajo_id || !texto) return Response.json({ error: 'Falta trabajo_id o mensaje.' }, { status: 400 });
    if (texto.length > 2000) return Response.json({ error: 'El mensaje es demasiado largo.' }, { status: 400 });

    const db = env.DB;
    if (!(await verificarDueno(db, trabajo_id, sessionData.user.id))) {
      return Response.json({ error: 'Este pedido no pertenece a tu cuenta.' }, { status: 403 });
    }

    await db.prepare(
      "INSERT INTO mensajes_trabajo (trabajo_id, autor, mensaje, leido_operador) VALUES (?, 'cliente', ?, 0)"
    ).bind(trabajo_id, texto).run();

    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'No se pudo enviar el mensaje.' }, { status: 500 });
  }
}

// --- CONTRATO PARA EL PANEL (documentar en CONTEXTO_PANEL_ADMIN.md) ---
// Tabla compartida `mensajes_trabajo` (misma D1). El Panel puede leer/
// escribir directo contra ella sin pasar por este endpoint (tiene acceso
// directo a la D1, igual que con `trabajos`/`pagos`):
//   INSERT INTO mensajes_trabajo (trabajo_id, autor, mensaje, leido_cliente)
//   VALUES (?, 'operador', ?, 0);
// `leido_cliente` en 0 es lo que hace que el cliente vea el mensaje como
// "nuevo" la próxima vez que entra a "Mis pedidos" (no hay push para esto,
// ver diseño de Fase 4 — es intencional, no una omisión).