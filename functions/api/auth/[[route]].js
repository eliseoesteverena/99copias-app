// functions/api/auth/[[route]].js
//
// Catch-all de Pages Functions: cualquier request a /api/auth/* (sign-up,
// sign-in, callback de Google, get-session, sign-out, etc.) llega acá y se
// la pasamos entera al handler de Better Auth, que resuelve la ruta interna.
//
// A diferencia de trabajos.js (que no recibe `ctx` en su firma — ver
// PROJECT_HANDOFF.md sección 8), acá no hace falta `ctx.waitUntil`: Better
// Auth resuelve todo dentro del mismo request/response, sin trabajo en
// segundo plano que valga la pena no bloquear.

import { createAuth } from '../lib/auth.js';

export async function onRequest({ request, env }) {
  const auth = createAuth(env);
  return auth.handler(request);
}
