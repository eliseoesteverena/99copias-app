// auth-client.js — cliente de Better Auth para las 3 apps (hub, impresion-rapida,
// fotos). Sin SDK oficial: el proyecto no tiene build step (ver
// FILE_INVENTORY.md), así que en vez de bundlear @better-auth/client hacemos
// fetch directo a los endpoints REST, que son estables y ya confirmados
// corriendo la librería real:
//   POST /api/auth/sign-in/anonymous
//   GET  /api/auth/get-session
//   POST /api/auth/sign-up/email   { email, password, name }
//   POST /api/auth/sign-in/email   { email, password }
//   POST /api/auth/sign-in/social  { provider: 'google', callbackURL } -> { url, redirect: true }
//   POST /api/auth/sign-out
//
// Uso: cargar este script ANTES de nav.js (en los wizards) o antes del
// script inline del hub. Se auto-inicializa al DOMContentLoaded: asegura una
// sesión (anónima si no hay ninguna) y monta el control de cuenta en
// cualquier elemento con [data-auth-mount].

(function () {
  const BASE = '/api/auth';

  // Better Auth devuelve todos sus mensajes en inglés — no hay opción de
  // idioma en la config del servidor. Se traduce acá, en un solo lugar, en
  // vez de dejar pasar el inglés crudo a la UI. Cubre tanto los códigos que
  // vuelven en la URL al fallar un login social (?error=...) como los
  // mensajes directos de /sign-up/email y /sign-in/email.
  const MENSAJES_ERROR_OAUTH = {
    // 'account not linked' con espacios (el mensaje real, ver
    // oauth2/link-account.mjs) se convierte a snake_case en la URL del
    // lado del servidor antes de llegar acá.
    account_not_linked: 'Ya existe una cuenta con este email creada con usuario y contraseña. Iniciá sesión con tu contraseña — más adelante vas a poder vincular Google desde tu cuenta.',
    unable_to_link_account: 'No pudimos vincular tu cuenta de Google. Probá de nuevo en un momento.',
    unable_to_get_user_info: 'Google no nos devolvió tus datos. Probá de nuevo.',
    invalid_code: 'El enlace de Google expiró o ya se usó. Iniciá sesión de nuevo.',
    oauth_provider_not_found: 'Hubo un problema con el login de Google. Probá de nuevo en un momento.',
    no_code: 'No pudimos completar el login con Google. Probá de nuevo.',
    no_callback_url: 'Hubo un problema técnico al volver de Google. Probá de nuevo.',
    email_not_found: 'Tu cuenta de Google no tiene un email público — no podemos usarla para iniciar sesión acá.',
    invalid_callback_request: 'Hubo un problema al volver de Google. Probá de nuevo.',
    signup_disabled: 'El registro con Google no está disponible en este momento.',
    unable_to_create_user: 'No pudimos crear tu cuenta. Probá de nuevo.',
    unable_to_create_session: 'No pudimos iniciar tu sesión. Probá de nuevo.',
    "email_doesn't_match": 'Ese email no coincide con tu cuenta actual.',
    account_already_linked_to_different_user: 'Esa cuenta de Google ya está vinculada a otro usuario.',
  };
  const MENSAJES_ERROR_API = {
    'User already exists. Use another email.': 'Ya existe una cuenta con ese email. Iniciá sesión, o usá otro email.',
    'User already exists.': 'Ya existe una cuenta con ese email.',
    'Invalid email or password': 'Email o contraseña incorrectos.',
    'User not found': 'No encontramos ninguna cuenta con ese email.',
  };
  function mensajeAmigable(crudo) {
    if (!crudo) return 'Ocurrió un error inesperado. Probá de nuevo.';
    return MENSAJES_ERROR_OAUTH[crudo] || MENSAJES_ERROR_API[crudo] || crudo; // si no lo conocemos, mostramos el original — mejor que nada
  }

  async function req(path, opts) {
    const config = {
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      ...opts,
    };
    // Better Auth intenta parsear el body como JSON en cualquier request que
    // no sea GET, incluso en endpoints que no esperan ningún campo
    // (sign-in/anonymous, sign-out). Si mandamos el header content-type:
    // application/json sin body, el fetch manda un body vacío y el parseo
    // falla con 400 "Invalid JSON in request body". Por eso: si es un
    // método con body y no se pasó ninguno, mandamos '{}' explícito.
    if (config.method && config.method !== 'GET' && config.body === undefined) {
      config.body = '{}';
    }
    const res = await fetch(BASE + path, config);
    let data = null;
    try { data = await res.json(); } catch { /* respuestas sin body, ej. sign-out */ }
    if (!res.ok) {
      const msg = (data && (data.message || data.error)) || `Error ${res.status}`;
      throw new Error(mensajeAmigable(msg));
    }
    return data;
  }

  async function getSession() {
    try {
      const data = await req('/get-session', { method: 'GET' });
      return data && data.user ? data : null;
    } catch {
      return null;
    }
  }

  async function signInAnonymous() {
    const data = await req('/sign-in/anonymous', { method: 'POST' });
    return data && data.user ? data : null;
  }

  // Se llama al cargar cualquier página del wizard (sección 5 del handoff de
  // auth: "una sesión anónima se crea automática e invisiblemente"). Si ya
  // hay sesión (anónima o real), no hace nada más que devolverla.
  async function ensureSession() {
    const existente = await getSession();
    if (existente) return existente;
    try {
      return await signInAnonymous();
    } catch (err) {
      console.error('[auth] no se pudo crear sesión anónima:', err);
      return null;
    }
  }

  async function signInEmail(email, password) {
    return req('/sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  async function signUpEmail(email, password, name) {
    return req('/sign-up/email', { method: 'POST', body: JSON.stringify({ email, password, name }) });
  }

  async function signInGoogle(callbackURL) {
    // errorCallbackURL: si el login social falla (ej. account_not_linked),
    // Better Auth redirige acá con ?error=<código> en vez de mostrar su
    // propia pantalla de error default — lo leemos en el DOMContentLoaded
    // de más abajo y lo mostramos traducido en el mismo modal.
    const urlLimpia = window.location.origin + window.location.pathname;
    const data = await req('/sign-in/social', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'google',
        callbackURL: callbackURL || window.location.href,
        errorCallbackURL: urlLimpia,
      }),
    });
    if (data && data.url) {
      window.location.href = data.url;
    } else {
      throw new Error('No se pudo iniciar el login con Google.');
    }
  }

  async function signOut() {
    try { await req('/sign-out', { method: 'POST' }); } catch { /* igual seguimos */ }
    // Después de cerrar sesión siempre queremos volver a tener ALGUNA sesión
    // (anónima) — el resto del wizard (trabajos.js) asume que siempre hay
    // un user_id disponible.
    return ensureSession();
  }

  // ------------------------------------------------------------------
  // UI — control de cuenta en el header + modal de login/registro.
  // Estilos con clases ya existentes en el proyecto (.btn, .field, .input,
  // .alert, .plate — ver impresion-rapida/index.html) más un puñado de
  // clases nuevas con prefijo "au-" para el layout propio del modal, usando
  // las custom properties de color/radio ya definidas en styles.css.
  // ------------------------------------------------------------------

  let modalEl = null;

  // Estado de "cargando" para botones — spinner + disabled + opacidad
  // reducida (vía .is-loading en auth-client.css). Guarda el texto
  // original en un data-attribute para poder restaurarlo tal cual estaba,
  // sin asumir cuál era.
  function setCargando(btn, cargando, textoCargando) {
    if (!btn) return;
    if (cargando) {
      if (btn.dataset.textoOriginal === undefined) btn.dataset.textoOriginal = btn.textContent;
      btn.disabled = true;
      btn.classList.add('is-loading');
      btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>' + (textoCargando || btn.dataset.textoOriginal);
    } else {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.textContent = btn.dataset.textoOriginal !== undefined ? btn.dataset.textoOriginal : btn.textContent;
    }
  }

  function crearModal() {
    if (modalEl) return modalEl;
    const dialog = document.createElement('dialog');
    dialog.className = 'au-modal plate';
    dialog.innerHTML = `
      <form method="dialog" class="au-modal-close-form">
        <button type="submit" class="btn btn-ghost btn-sm au-modal-close" aria-label="Cerrar">✕</button>
      </form>
      <div class="au-modal-tabs" role="tablist">
        <button type="button" class="au-tab is-active" data-tab="login" role="tab">Iniciar sesión</button>
        <button type="button" class="au-tab" data-tab="signup" role="tab">Crear cuenta</button>
      </div>
      <div class="au-modal-body">
        <button type="button" class="btn btn-outline btn-block au-google-btn">Continuar con Google</button>
        <div class="au-divider"><span>o con tu email</span></div>
        <div class="alert alert-error au-error" hidden></div>
        <form class="au-form" data-mode="login">
          <div class="field">
            <label for="au-email-login">Email</label>
            <input class="input" type="email" id="au-email-login" name="email" required autocomplete="email">
          </div>
          <div class="field">
            <label for="au-password-login">Contraseña</label>
            <input class="input" type="password" id="au-password-login" name="password" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary btn-block">Iniciar sesión</button>
        </form>
        <form class="au-form" data-mode="signup" hidden>
          <div class="field">
            <label for="au-name-signup">Nombre</label>
            <input class="input" type="text" id="au-name-signup" name="name" required autocomplete="name">
          </div>
          <div class="field">
            <label for="au-email-signup">Email</label>
            <input class="input" type="email" id="au-email-signup" name="email" required autocomplete="email">
          </div>
          <div class="field">
            <label for="au-password-signup">Contraseña</label>
            <input class="input" type="password" id="au-password-signup" name="password" required minlength="8" autocomplete="new-password">
          </div>
          <button type="submit" class="btn btn-primary btn-block">Crear cuenta</button>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);

    const errorBox = dialog.querySelector('.au-error');
    const mostrarError = (msg) => { errorBox.textContent = msg; errorBox.hidden = false; };
    const limpiarError = () => { errorBox.hidden = true; errorBox.textContent = ''; };

    dialog.querySelectorAll('.au-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        dialog.querySelectorAll('.au-tab').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        limpiarError();
        dialog.querySelectorAll('.au-form').forEach((f) => {
          f.hidden = f.dataset.mode !== tab.dataset.tab;
        });
      });
    });

    dialog.querySelector('.au-google-btn').addEventListener('click', () => {
      limpiarError();
      signInGoogle().catch((err) => mostrarError(err.message));
    });

    dialog.querySelector('form[data-mode="login"]').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      limpiarError();
      const submitBtn = ev.target.querySelector('button[type="submit"]');
      const fd = new FormData(ev.target);
      setCargando(submitBtn, true, 'Iniciando sesión…');
      try {
        await signInEmail(fd.get('email'), fd.get('password'));
        dialog.close();
        await refrescarMontajes();
      } catch (err) {
        mostrarError(err.message || 'No pudimos iniciar sesión. Revisá tus datos.');
      } finally {
        setCargando(submitBtn, false);
      }
    });

    dialog.querySelector('form[data-mode="signup"]').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      limpiarError();
      const submitBtn = ev.target.querySelector('button[type="submit"]');
      const fd = new FormData(ev.target);
      setCargando(submitBtn, true, 'Creando cuenta…');
      try {
        await signUpEmail(fd.get('email'), fd.get('password'), fd.get('name'));
        dialog.close();
        await refrescarMontajes();
      } catch (err) {
        mostrarError(err.message || 'No pudimos crear la cuenta.');
      } finally {
        setCargando(submitBtn, false);
      }
    });

    modalEl = dialog;
    return dialog;
  }

  function primerNombre(nombreCompleto) {
    return (nombreCompleto || '').trim().split(/\s+/)[0] || 'Cuenta';
  }

  function abrirModal(tabInicial) {
    const dialog = crearModal();
    if (tabInicial) {
      const tabBtn = dialog.querySelector(`.au-tab[data-tab="${tabInicial}"]`);
      if (tabBtn && !tabBtn.classList.contains('is-active')) tabBtn.click();
    }
    dialog.showModal();
    return dialog;
  }

  function render(container, sesion) {
    const esInvitado = !sesion || !sesion.user || sesion.user.isAnonymous;

    if (esInvitado) {
      container.innerHTML = `<button type="button" class="btn btn-sm au-login-btn">Iniciar sesión</button>`;
      container.querySelector('.au-login-btn').addEventListener('click', () => abrirModal('login'));
      return;
    }

    const nombre = primerNombre(sesion.user.name);
    container.innerHTML = `
      <div class="au-account">
        <button type="button" class="btn btn-sm btn-outline au-account-btn">${nombre}</button>
        <div class="au-account-menu" hidden>
          <button type="button" class="au-account-menu-item" disabled title="Todavía no está disponible">
            Mis pedidos <span class="au-soon">Próximamente</span>
          </button>
          <button type="button" class="au-account-menu-item" disabled title="Todavía no está disponible">
            Mis opciones de entrega <span class="au-soon">Próximamente</span>
          </button>
          <div class="au-account-menu-sep"></div>
          <button type="button" class="au-account-menu-item au-logout">Cerrar sesión</button>
        </div>
      </div>`;

    const btn = container.querySelector('.au-account-btn');
    const menu = container.querySelector('.au-account-menu');
    btn.addEventListener('click', () => { menu.hidden = !menu.hidden; });
    container.querySelector('.au-logout').addEventListener('click', async () => {
      menu.hidden = true;
      await signOut();
      await refrescarMontajes();
    });
  }

  // Un único listener global (no uno por render — si no, se acumulan cada
  // vez que el chip se re-renderiza tras login/logout) que cierra cualquier
  // menú de cuenta abierto al clickear afuera.
  document.addEventListener('click', (ev) => {
    document.querySelectorAll('.au-account').forEach((acc) => {
      if (!acc.contains(ev.target)) {
        const menu = acc.querySelector('.au-account-menu');
        if (menu) menu.hidden = true;
      }
    });
  });

  async function refrescarMontajes() {
    const sesion = await getSession();
    document.querySelectorAll('[data-auth-mount]').forEach((el) => render(el, sesion));
    // Cualquier página puede escuchar esto para reaccionar a un cambio de
    // sesión sin recargar (ej. esconder el CTA de "creá una cuenta" del
    // paso de Datos apenas alguien se loguea — Caso B, sección 5 del
    // handoff de auth).
    window.dispatchEvent(new CustomEvent('authchange', { detail: sesion }));
    return sesion;
  }

  // `open('signup' | 'login')` — usado por el CTA no-bloqueante del paso de
  // Datos ("Creá una cuenta para hacer seguimiento de tu pedido", Caso B de
  // HANDOFF_AUTENTICACION_Y_FLUJO.md sección 5).
  window.AuthUI = { mount: render, refresh: refrescarMontajes, open: abrirModal };

  window.AuthClient = { getSession, ensureSession, signInEmail, signUpEmail, signInGoogle, signOut, setCargando };

  // Si volvimos de /api/auth/callback/google con un error (ej.
  // account_not_linked), errorCallbackURL nos trajo de vuelta acá con
  // ?error=<código> en vez de la pantalla default de Better Auth. Se
  // muestra traducido, en el mismo modal, con la pestaña de login activa
  // (la salida más probable: "iniciá sesión con tu contraseña").
  function manejarErrorDeOAuthSiVuelveDeGoogle() {
    const params = new URLSearchParams(window.location.search);
    const codigo = params.get('error');
    if (!codigo) return;
    params.delete('error');
    params.delete('error_description');
    const qs = params.toString();
    const urlLimpia = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    history.replaceState(null, '', urlLimpia);
    const dialog = abrirModal('login');
    const errorBox = dialog.querySelector('.au-error');
    if (errorBox) { errorBox.textContent = mensajeAmigable(codigo); errorBox.hidden = false; }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const sesion = await ensureSession();
    document.querySelectorAll('[data-auth-mount]').forEach((el) => render(el, sesion));
    window.dispatchEvent(new CustomEvent('authchange', { detail: sesion }));
    manejarErrorDeOAuthSiVuelveDeGoogle();
  });
})();
