/* =========================================================
   HEADER / FOOTER DINÁMICO
   ========================================================= */
//
// Uso: incluir este archivo antes de app.js, y en cada página invocar:
//
//   renderHeader('#site-header', {
//     items: [
//       { label: 'Precios', href: '/precios' },
//       { label: 'Preguntas Frecuentes', href: '/preguntas-frecuentes' },
//       // hasta 2 niveles:
//       { label: 'Servicios', children: [
//         { label: 'Impresión rápida', href: '/' },
//         { label: 'Fotocopias', href: '/fotocopias' },
//       ]},
//     ],
//     cta: { label: 'Imprimir', href: '/', ocultarEnUrls: ['/'] },
//   });
//
//   renderFooter('#site-footer', {
//     blocks: [
//       [ { label: 'Cursos', href: '/cursos' }, { label: 'Blog', href: '/blog' } ], // hasta 5 c/u
//       [ { label: 'Precios', href: '/precios' } ],
//     ],
//   });
//
// Si una página no necesita footer (ej. el wizard), simplemente no se llama a renderFooter.

function crearEnlace(item, claseExtra) {
  const a = document.createElement('a');
  a.href = item.href || '#';
  a.textContent = item.label;
  if (claseExtra) a.className = claseExtra;
  if (item.badge) {
    const b = document.createElement('span');
    b.className = 'site-header-badge';
    b.textContent = item.badge;
    a.appendChild(b);
  }
  return a;
}

function ctaOculto(cta) {
  if (!cta || !Array.isArray(cta.ocultarEnUrls)) return false;
  return cta.ocultarEnUrls.includes(window.location.pathname);
}

function renderHeader(selector, config) {
  const cont = document.querySelector(selector);
  if (!cont) return;
  const items = config.items || [];
  const cta = config.cta;
  const mostrarCta = cta && !ctaOculto(cta);

  cont.innerHTML = `
    <div class="site-header">
      <a class="site-header-logo" href="99copias.com.ar"><img src="logo.svg" alt="Imprenta" class="brand-logo"></a>
      <nav class="site-header-nav">
        <ul class="site-header-links"></ul>
        ${mostrarCta ? `<a class="btn btn-primary site-header-cta"></a>` : ''}
        <button type="button" class="site-header-toggle" aria-label="Abrir menú" aria-expanded="false">
          Menú <span class="site-header-toggle-icon">☰</span>
        </button>
      </nav>
      <div class="site-header-drawer"></div>
    </div>
  `;

  const listaDesktop = cont.querySelector('.site-header-links');
  const drawer = cont.querySelector('.site-header-drawer');

  items.forEach(item => {
    // Versión desktop (fila horizontal)
    const li = document.createElement('li');
    if (item.children && item.children.length) {
      li.className = 'has-children';
      const trigger = document.createElement('span');
      trigger.className = 'site-header-parent';
      trigger.textContent = item.label;
      const sub = document.createElement('ul');
      sub.className = 'site-header-submenu';
      item.children.forEach(child => {
        const subLi = document.createElement('li');
        subLi.appendChild(crearEnlace(child));
        sub.appendChild(subLi);
      });
      li.appendChild(trigger);
      li.appendChild(sub);
    } else {
      li.appendChild(crearEnlace(item));
    }
    listaDesktop.appendChild(li);

    // Versión drawer (mobile)
    if (item.children && item.children.length) {
      const grupo = document.createElement('div');
      grupo.className = 'site-header-drawer-group';
      const titulo = document.createElement('span');
      titulo.className = 'site-header-drawer-parent';
      titulo.textContent = item.label;
      grupo.appendChild(titulo);
      item.children.forEach(child => {
        grupo.appendChild(crearEnlace(child, 'site-header-drawer-link site-header-drawer-sublink'));
      });
      drawer.appendChild(grupo);
    } else {
      drawer.appendChild(crearEnlace(item, 'site-header-drawer-link'));
    }
  });

  if (mostrarCta) {
    const ctaDesktop = cont.querySelector('.site-header-cta');
    ctaDesktop.href = cta.href || '#';
    ctaDesktop.textContent = cta.label;

    const ctaMobile = crearEnlace(cta, 'btn btn-primary site-header-drawer-cta');
    drawer.appendChild(ctaMobile);
  }

  const toggle = cont.querySelector('.site-header-toggle');
  toggle.addEventListener('click', () => {
    const abierto = drawer.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(abierto));
    toggle.classList.toggle('is-active', abierto);
  });
}

function renderFooter(selector, config) {
  const cont = document.querySelector(selector);
  if (!cont) return;
  const blocks = config.blocks || [];

  cont.innerHTML = `<div class="site-footer"><div class="site-footer-blocks"></div></div>`;
  const wrap = cont.querySelector('.site-footer-blocks');

  blocks.forEach(bloque => {
    const col = document.createElement('div');
    col.className = 'site-footer-block';
    bloque.slice(0, 5).forEach(item => {
      col.appendChild(crearEnlace(item, 'site-footer-link'));
    });
    wrap.appendChild(col);
  });
}
