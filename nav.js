// nav.js — header de navegación reutilizable, pensado para "cualquier
// página" del sitio (no solo este wizard). Genera el <header class="nav">
// completo (markup + comportamiento del menú mobile) por JavaScript en vez
// de tenerlo pegado como HTML estático en cada página — para agregar/quitar
// un link, o cambiar el CTA, alcanza con tocar este único archivo.
//
// Requiere el CSS de .nav/.nav-inner/.logo/.nav-links/.nav-cta/.burger/.wrap
// (ya definido en fotos.css) cargado en la página que lo use.
//
// Uso básico (usa toda la configuración por default):
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
    links: [
      { label: 'Cómo funciona', href: 'https://99copias.com.ar/#como' },
      { label: 'Ventajas', href: 'https://99copias.com.ar/#ventajas' },
      { label: 'Precios', href: 'https://99copias.com.ar/#precios' },
      { label: 'Preguntas', href: 'https://99copias.com.ar/#faq' },
    ],
    cta: { label: 'Subir archivo', href: 'https://app.99copias.com.ar', className: 'btn btn-mustard' },
  }, opts || {});

  const linksHtml = cfg.links
    .map(l => `<a href="${l.href}">${l.label}</a>`)
    .join('');

  const ctaHtml = cfg.cta
    ? `<a href="${cfg.cta.href}" class="${cfg.cta.className || 'btn btn-mustard'}" style="padding:10px 20px">${cfg.cta.label}</a>`
    : '';

  const html = `
    <header class="nav">
      <div class="wrap nav-inner">
        <a href="${cfg.logoHref}" class="logo" aria-label="${cfg.logoAlt} inicio">
          <img src="${cfg.logoSrc}" alt="${cfg.logoAlt}">
        </a>
        <nav class="nav-links" id="navLinks" aria-label="Principal">${linksHtml}</nav>
        <div class="nav-cta">
          ${ctaHtml}
          <button class="burger" id="burger" aria-label="Abrir menú" aria-expanded="false">
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>
    </header>`;

  const mountEl = typeof cfg.mount === 'string' ? document.querySelector(cfg.mount) : cfg.mount;
  if (!mountEl) { console.error('renderNav: no se encontró el punto de montaje', cfg.mount); return; }
  mountEl.insertAdjacentHTML('afterbegin', html);

  // Comportamiento del menú mobile — vive acá adentro para que cualquier
  // página que llame a renderNav() lo obtenga automático, sin tener que
  // cablear el burger/navLinks aparte en el JS de cada página.
  const burger = document.getElementById('burger');
  const navLinks = document.getElementById('navLinks');
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
