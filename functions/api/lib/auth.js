// functions/api/lib/auth.js
//
// Factory de la instancia de Better Auth. Se construye POR REQUEST (nunca a
// nivel de módulo) porque en Cloudflare Pages Functions los bindings (env.DB,
// env.KV) sólo existen dentro del handler — no hay "top-level env" como en
// Node. Cualquier endpoint que necesite leer la sesión (trabajos.js incluido)
// importa `createAuth` y la llama con el `env` de su propio request.
//
// Rutas reales expuestas bajo basePath "/api/auth" (confirmadas corriendo
// better-auth 1.6.26 localmente, no adivinadas):
//   POST /api/auth/sign-in/anonymous
//   POST /api/auth/sign-up/email
//   POST /api/auth/sign-in/email
//   POST /api/auth/sign-in/social        body: { provider: "google", callbackURL }
//   GET  /api/auth/callback/google       (redirect de Google, no se llama a mano)
//   GET  /api/auth/get-session
//   POST /api/auth/sign-out
//
// DEC-F (HANDOFF_AUTENTICACION_Y_FLUJO.md): la cookie de sesión vive sólo en
// app.99copias.com.ar — no hay cookies cross-subdominio ni se comparte con la
// Landing.

import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';

// --- secondaryStorage sobre KV, para el rate limiter ---------------------
// Better Auth soporta get/set/delete e, idealmente, un increment atómico
// para el rate limiter. Cloudflare KV NO tiene incremento atómico — esta
// implementación hace get+put, que tiene una ventana de carrera bajo
// concurrencia real (dos requests casi simultáneos podrían pisarse el
// contador). Es una limitación conocida y aceptada: el rate limiter deja de
// ser 100% preciso bajo carga concurrente alta, pero sigue siendo muchísimo
// mejor que el default en memoria (que en Workers no persiste ni un ratio
// razonable entre requests, porque cada isolate es efectivamente nuevo).
// KV además exige un TTL mínimo de 60s — si Better Auth pide un TTL menor,
// se redondea para arriba.
function createKvSecondaryStorage(kv) {
  const TTL_MINIMO_KV = 60;
  return {
    async get(key) {
      return await kv.get(key);
    },
    async set(key, value, ttl) {
      const opts = ttl ? { expirationTtl: Math.max(TTL_MINIMO_KV, Math.ceil(ttl)) } : {};
      await kv.put(key, value, opts);
    },
    async delete(key) {
      await kv.delete(key);
    },
    // Best-effort, no atómico — ver nota arriba.
    async increment(key, ttl) {
      const actual = await kv.get(key);
      const siguiente = (actual ? parseInt(actual, 10) : 0) + 1;
      await kv.put(key, String(siguiente), {
        expirationTtl: Math.max(TTL_MINIMO_KV, Math.ceil(ttl || TTL_MINIMO_KV)),
      });
      return siguiente;
    },
  };
}

/**
 * @param {{ DB: D1Database, KV: KVNamespace, GOOGLE_CLIENT_ID: string,
 *   GOOGLE_CLIENT_SECRET: string, BETTER_AUTH_SECRET: string }} env
 */
export function createAuth(env) {
  return betterAuth({
    database: env.DB,
    secondaryStorage: env.KV ? createKvSecondaryStorage(env.KV) : undefined,

    secret: env.BETTER_AUTH_SECRET,

    // Dominio único (DEC-F). allowedHosts cubre prod + preview deploys de
    // Cloudflare Pages (*.pages.dev) para poder probar el flujo de
    // email/contraseña ahí — el login con Google en preview NO va a andar
    // hasta que se agregue ese origin también en Google Cloud Console
    // (hoy sólo está autorizado https://app.99copias.com.ar).
    baseURL: {
      allowedHosts: ['app.99copias.com.ar', '*.pages.dev'],
      fallback: 'https://app.99copias.com.ar',
    },
    trustedOrigins: ['https://app.99copias.com.ar'],

    emailAndPassword: {
      enabled: true,
    },

    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },

    // Sesión anónima automática al entrar al wizard (sección 5 del handoff
    // de auth) — el plugin expone el endpoint /sign-in/anonymous, pero quien
    // decide llamarlo al cargar la página es el frontend (auth-client.js).
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          // Nada que migrar acá a propósito: los archivos en staging/ viven
          // en una sesión de subida propia (UUID en localStorage, sección 5
          // del handoff), no atada al user_id anónimo, y el pedido recién se
          // crea al confirmar el pago — no hay ningún dato en D1 colgado del
          // user_id anónimo que haga falta transferir al pasar a cuenta real.
          console.log(
            `[auth] cuenta anónima ${anonymousUser.user.id} vinculada a cuenta real ${newUser.user.id}`
          );
        },
      }),
    ],

    // El rate limiter sólo corre en producción por default en Better Auth;
    // acá lo dejamos explícito y sobre KV (secondaryStorage), no en memoria,
    // que es el pendiente que dejó marcado HANDOFF_AUTENTICACION_Y_FLUJO.md
    // sección 4.
    rateLimit: {
      storage: env.KV ? 'secondary-storage' : 'memory',
    },

    // D1 no soporta transacciones interactivas — Better Auth ya usa batch()
    // automáticamente vía el dialect de D1 (ver @better-auth/kysely-adapter),
    // sin que haga falta ninguna config acá. Tampoco se toca
    // advanced.database.generateId: el schema generado usa "id" TEXT sin
    // default, así que hace falta el generador de IDs propio de Better Auth
    // (el comportamiento por default) — ponerlo en `false` asumiría un
    // autogenerado de la base que no existe y rompería los inserts.
  });
}
