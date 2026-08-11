// nav.js — header de navegación reutilizable, pensado para "cualquier
// página" del sitio (no solo este wizard). Genera el <header class="nav">
// completo (markup + comportamiento del menú mobile) por JavaScript en vez
// de tenerlo pegado como HTML estático en cada página — para agregar/quitar
// un link, o cambiar el CTA, alcanza con tocar este único archivo.
//
// Requiere el CSS de .nav/.nav-inner/.logo/.nav-links/.nav-cta/.burger/.wrap
// (ya definido en fotos.css) cargado en la página que lo use, más
// auth-client.css/.js si se quiere el control de cuenta (login/logout) —
// ver DEC-G, HANDOFF_AUTENTICACION_Y_FLUJO.md: los dos wizards comparten
// login, así que el control vive acá (nav.js), no en el hub, que tiene su
// propio header aparte y no llama a renderNav().
//
// [Rediseño] Dentro de los wizards ya no tiene sentido mostrar los links de
// la landing (Cómo funciona/Ventajas/Precios/Preguntas) ni el CTA "Subir
// archivo" — el cliente ya está adentro del formulario. El default ahora es
// "sólo logo + cuenta"; los links/cta siguen existiendo como opción por si
// nav.js se reusa en otra página que sí los necesite.
//
// Uso básico (el real, en los dos wizards — usa el default: sin links/cta):
//   <script src="../auth-client.js"></script>
//   <script src="../nav.js"></script>
//   <script>renderNav();</script>
//
// Uso con configuración propia (para reusar esto en otra página con otros
// links/CTA, sin tocar este archivo):
//   <script>
//     renderNav({
//       links: [{ label: 'Precios', href: '/#precios' }],
//       cta: { label: 'Comprar', href: '/comprar' },
//     });
//   </script>

function renderNav(opts) {
  const cfg = Object.assign({
    mount: 'body', // selector o elemento donde insertar el header (se inserta como primer hijo)
    logoHref: 'https://99copias.com.ar',
    logoSrc: '../logo.svg',
    logoAlt: '99copias',
    links: [],  // sin links por default dentro del wizard — ver nota de rediseño arriba
    cta: null,  // sin CTA por default — "Subir archivo" no aplica estando ya en el wizard
  }, opts || {});

  const linksHtml = cfg.links
    .map(l => `<a href="${l.href}">${l.label}</a>`)
    .join('');

  const ctaHtml = cfg.cta
    ? `<a href="${cfg.cta.href}" class="${cfg.cta.className || 'btn btn-mustard'}" style="padding:10px 20px">${cfg.cta.label}</a>`
    : '';

  // El burger sólo tiene sentido si hay links para colapsar en mobile — sin
  // links (caso real de los wizards hoy) no se renderiza ni se cablea.
  const mostrarLinks = cfg.links.length > 0;
  const mostrarBurger = mostrarLinks;

  const html = `
    <header class="nav">
      <div class="wrap nav-inner">
        <a href="${cfg.logoHref}" class="logo" aria-label="${cfg.logoAlt} inicio">
          <img src="${cfg.logoSrc}" alt="${cfg.logoAlt}">
        </a>
        ${mostrarLinks ? `<nav class="nav-links" id="navLinks" aria-label="Principal">${linksHtml}</nav>` : ''}
        <div class="nav-cta">
          ${ctaHtml}
          <div class="nav-account" data-auth-mount></div>
          ${mostrarBurger ? `<button class="burger" id="burger" aria-label="Abrir menú" aria-expanded="false"><span></span><span></span><span></span></button>` : ''}
        </div>
      </div>
    </header>`;

  const mountEl = typeof cfg.mount === 'string' ? document.querySelector(cfg.mount) : cfg.mount;
  if (!mountEl) { console.error('renderNav: no se encontró el punto de montaje', cfg.mount); return; }
  mountEl.insertAdjacentHTML('afterbegin', html);

  // Comportamiento del menú mobile — sólo si efectivamente hay burger/links
  // (guard explícito: con el default nuevo, sin links, estos elementos ni
  // existen en el DOM).
  const burger = document.getElementById('burger');
  const navLinks = document.getElementById('navLinks');
  if (burger && navLinks) {
    burger.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    navLinks.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        navLinks.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Control de cuenta (login/logout) — si auth-client.js está cargado antes
  // que nav.js, lo montamos ya mismo en vez de esperar al DOMContentLoaded
  // propio de auth-client.js (que puede haber corrido antes de que este
  // header existiera en el DOM, si renderNav() se llama de forma diferida
  // en algún caso futuro).
  const navAccount = document.querySelector('.nav-account');
  if (navAccount && window.AuthClient && window.AuthUI) {
    window.AuthClient.getSession().then(sesion => window.AuthUI.mount(navAccount, sesion));
  }
}
