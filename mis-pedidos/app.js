/* mis-pedidos/app.js — Fase 2 (lista/detalle) + Fase 3 (comprobante,
   fusionado dentro de la tab Detalles) + Fase 4 (mensajes, tab aparte). */

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || ('Error de red (' + res.status + ')'));
  }
  return res.json();
}
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('Error de red (' + res.status + ')'));
  return data;
}

function money(n) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0;
  return '$' + Math.round(n).toLocaleString('es-AR');
}
function fechaCorta(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function horaCorta(iso) {
  const d = new Date(iso.replace(' ', 'T') + (iso.includes('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}
function truncarTexto(s, max) {
  s = s || '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

const ESTADO_LABEL = { pendiente: 'Pendiente', en_proceso: 'En proceso', listo: 'Listo', entregado: 'Entregado' };

function badgeEstado(trabajo) {
  if (trabajo.pago_medio === 'transferencia' && trabajo.pago_estado_revision === 'pendiente') {
    return '<span class="mp-badge">Comprobante en revisión</span>';
  }
  if (trabajo.pago_medio === 'transferencia' && trabajo.pago_estado_revision === 'rechazado') {
    return '<span class="mp-badge">Comprobante rechazado</span>';
  }
  if (!trabajo.pagado) return '<span class="mp-badge">Pago pendiente</span>';
  return `<span class="mp-badge ${trabajo.estado === 'entregado' ? 'is-ok' : ''}">${ESTADO_LABEL[trabajo.estado] || trabajo.estado}</span>`;
}

/* ================= VISTA LISTA ================= */
async function cargarLista() {
  const wrap = document.getElementById('mpListaWrap');
  try {
    const sesion = window.AuthClient ? await window.AuthClient.getSession() : null;
    const esInvitado = !sesion || !sesion.user || sesion.user.isAnonymous;
    document.getElementById('mpInvitado').hidden = !esInvitado;

    const trabajos = await apiGet('/api/mis-trabajos');
    if (!trabajos.length) {
      wrap.innerHTML = '<div class="empty">Todavía no hiciste ningún pedido.</div>';
      return;
    }
    wrap.innerHTML = '<div class="mp-lista"></div>';
    const lista = wrap.querySelector('.mp-lista');
    trabajos.forEach((t) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mp-card';
      card.innerHTML = `
        <div class="mp-card-top">
          <span class="mp-card-id mono">PEDIDO #${t.id}</span>
          <span class="mp-card-total">${money(t.total)}</span>
        </div>
        <div class="mp-card-cat">${t.categoria_nombre || t.categoria || 'Pedido'}</div>
        <div class="mp-card-bottom">
          <span class="mp-card-fecha">${fechaCorta(t.creado_en)}</span>
          ${badgeEstado(t)}
        </div>`;
      card.addEventListener('click', () => abrirDetalle(t.id));
      lista.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML = `<div class="empty">No pudimos cargar tus pedidos. ${err.message || ''}</div>`;
  }
}
document.getElementById('mpLinkLogin').addEventListener('click', (e) => {
  e.preventDefault();
  if (window.AuthUI) window.AuthUI.open('login');
});

/* ================= VISTA DETALLE ================= */
let trabajoActualId = null;
let tabActiva = 'detalles';

document.querySelectorAll('.mp-detalle-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => cambiarTab(btn.dataset.tab));
});
function cambiarTab(tab) {
  tabActiva = tab;
  document.querySelectorAll('.mp-detalle-tabs button').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
  document.getElementById('tabPanelDetalles').hidden = tab !== 'detalles';
  document.getElementById('tabPanelMensajes').hidden = tab !== 'mensajes';
  if (tab === 'mensajes') {
    const cont = document.getElementById('detMensajes');
    cont.scrollTop = cont.scrollHeight;
  }
}

async function abrirDetalle(id) {
  trabajoActualId = id;
  document.getElementById('vistaLista').hidden = true;
  document.getElementById('vistaDetalle').hidden = false;
  cambiarTab('detalles');
  const url = new URL(location.href);
  url.searchParams.set('trabajo', id);
  history.replaceState(null, '', url.toString());

  document.getElementById('detResumen').innerHTML = '<div class="empty">Cargando…</div>';
  document.getElementById('detTransferenciaWrap').hidden = true;
  await Promise.all([cargarDetalleTrabajo(id), cargarMensajes(id)]);
}

async function cargarDetalleTrabajo(id) {
  try {
    const t = await apiGet('/api/mis-trabajos?id=' + id);
    document.getElementById('detTitulo').textContent = `Pedido #${t.id}`;
    document.getElementById('detSubtitulo').textContent = `${t.categoria_nombre || t.categoria || ''} · ${fechaCorta(t.creado_en)}`;

    const filas = [
      ['Estado', ESTADO_LABEL[t.estado] || t.estado],
      ['Total', money(t.total)],
      ['Entrega', t.zona_nombre ? `${t.zona_nombre}${t.hora_inicio ? ' · ' + t.hora_inicio + '–' + t.hora_fin : ''}` : (t.direccion_entrega || '—')],
      ['Fecha de entrega', t.fecha_entrega || '—'],
      ['Medio de pago', t.pago_medio === 'transferencia' ? 'Transferencia' : 'Mercado Pago'],
    ];
    document.getElementById('detResumen').innerHTML = filas
      .map(([k, v]) => `<div class="fila"><span class="k">${k}</span><span>${v}</span></div>`)
      .join('');

    renderArchivos(t);

    // Comprobante fusionado dentro de la misma tab Detalles (no una tarjeta
    // aparte flotando) — sólo visible si el medio es transferencia.
    const wrapTransferencia = document.getElementById('detTransferenciaWrap');
    if (t.pago_medio === 'transferencia' && t.pago_estado_revision !== 'aprobado') {
      wrapTransferencia.hidden = false;
      const estadoEl = document.getElementById('detTransferenciaEstado');
      if (t.pago_estado_revision === 'rechazado') {
        estadoEl.innerHTML = `<div class="alert alert-error">Tu comprobante fue rechazado${t.pago_motivo_rechazo ? ': ' + t.pago_motivo_rechazo : ''}. Subí uno nuevo.</div>`;
      } else {
        estadoEl.innerHTML = `<div class="alert alert-info">Comprobante en revisión — te avisamos apenas se confirme.</div>`;
      }
    } else {
      wrapTransferencia.hidden = true;
    }
  } catch (err) {
    console.error(err);
    document.getElementById('detResumen').innerHTML = `<div class="empty">No pudimos cargar el pedido. ${err.message || ''}</div>`;
  }
}

function renderArchivos(t) {
  const cont = document.getElementById('detArchivos');
  const archivos = (t.configuracion && t.configuracion.archivos) || [];
  if (!archivos.length) {
    cont.innerHTML = '<div class="empty">Sin archivos.</div>';
    return;
  }
  cont.innerHTML = archivos.map((a) => {
    const detalles = [];
    if (a.copias) detalles.push(`${a.copias} ${a.copias === 1 ? 'copia' : 'copias'}`);
    if (a.rango) detalles.push(`pág. ${a.rango}`);
    if (a.faz) detalles.push(a.faz === 'doble' ? 'doble faz' : 'simple faz');
    if (a.paginas_por_carilla > 1) detalles.push(`${a.paginas_por_carilla} pág/carilla`);
    if (a.acabado && a.acabado !== 'suelto') detalles.push(a.acabado);
    return `<div class="mp-archivo-row">
      <span class="mp-archivo-nombre" title="${(a.nombre || '').replace(/"/g, '&quot;')}">${truncarTexto(a.nombre || '—', 26)}</span>
      <span class="mp-archivo-detalle">${detalles.join(' · ')}</span>
    </div>`;
  }).join('');
}

document.getElementById('detComprobanteInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !trabajoActualId) return;
  const errEl = document.getElementById('detComprobanteError');
  errEl.hidden = true;
  try {
    const qs = new URLSearchParams({ trabajo_id: trabajoActualId, nombre: file.name });
    const res = await fetch('/api/comprobante?' + qs.toString(), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo subir el comprobante.');
    await cargarDetalleTrabajo(trabajoActualId);
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo subir el comprobante.';
    errEl.hidden = false;
  }
});

/* ---------- mensajes ---------- */
async function cargarMensajes(id) {
  const cont = document.getElementById('detMensajes');
  try {
    const mensajes = await apiGet('/api/mensajes?trabajo_id=' + id);
    if (!mensajes.length) {
      cont.innerHTML = '<div class="empty">Todavía no hay mensajes en este pedido.</div>';
      return;
    }
    cont.innerHTML = mensajes.map((m) => `
      <div class="mp-msg is-${m.autor}">
        ${m.mensaje.replace(/</g, '&lt;')}
        <span class="hora">${fechaCorta(m.creado_en)} ${horaCorta(m.creado_en)}</span>
      </div>`).join('');
    cont.scrollTop = cont.scrollHeight;
  } catch (err) {
    console.error(err);
    cont.innerHTML = `<div class="empty">No pudimos cargar los mensajes.</div>`;
  }
}

const inputMensaje = document.getElementById('detMensajeInput');
const formMensaje = document.getElementById('detMensajeForm');

// Enter envía, Shift+Enter agrega un salto de línea — mismo criterio que
// Slack/WhatsApp Web. El textarea tiene alto fijo con scroll propio (ver
// CSS), no crece con el texto.
inputMensaje.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    formMensaje.requestSubmit();
  }
});

formMensaje.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = inputMensaje.value.trim();
  if (!texto || !trabajoActualId) return;
  const btn = formMensaje.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await apiPost('/api/mensajes', { trabajo_id: trabajoActualId, mensaje: texto });
    inputMensaje.value = '';
    await cargarMensajes(trabajoActualId);
  } catch (err) {
    alert(err.message || 'No se pudo enviar el mensaje.');
  } finally {
    btn.disabled = false;
    // El foco no debe perderse después de enviar — se puede seguir
    // escribiendo el próximo mensaje sin volver a tocar el campo a mano.
    inputMensaje.focus();
  }
});

document.getElementById('btnVolverLista').addEventListener('click', () => {
  document.getElementById('vistaDetalle').hidden = true;
  document.getElementById('vistaLista').hidden = false;
  trabajoActualId = null;
  const url = new URL(location.href);
  url.searchParams.delete('trabajo');
  history.replaceState(null, '', url.toString());
  cargarLista(); // por si algo cambió (ej. se aprobó el comprobante mientras estaba en el detalle)
});

/* ================= INIT ================= */
(async function init() {
  await cargarLista();
  const params = new URLSearchParams(location.search);
  const trabajoParam = params.get('trabajo');
  if (trabajoParam) await abrirDetalle(trabajoParam);
})();
