/* =========================================================
   ESTADO GLOBAL
   ========================================================= */
const LS_ZONA = 'fotos.zona';
const LS_CLIENTE = 'fotos.cliente';
const LS_DIRECCION = 'fotos.direccion';

const state = {
  step: 1,
  zona: JSON.parse(localStorage.getItem(LS_ZONA) || 'null'), // {id, nombre}
  productos: [],           // catálogo desde /api/productos?categoria=fotos — un producto por tamaño
  fecha: null,              // 'YYYY-MM-DD' elegida
  turno: null,              // objeto turno elegido
  cliente: JSON.parse(localStorage.getItem(LS_CLIENTE) || 'null'),
  // Todas las fotos de este pedido suben bajo la misma carpeta de staging en R2
  // (staging/{sesionSubida}/...) — se confirman o se limpian juntos.
  sesionSubida: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
  diasConTurno: null, // array de dia_semana (0-6) con turnos activos en la zona elegida, o null = sin filtrar
};

let fileIdCounter = 0;
// id -> { file, thumbUrl(original), naturalW, naturalH, settings:{...}, editState:{...},
//         r2Key, subiendo, errorSubida, subidaBlob(último jpg exportado que corresponde al r2Key actual) }
const files = new Map();

// Cada proyecto/formulario "es" una categoría — esto es lo único que identifica cuál.
// Un tamaño de foto = un producto = un código de catálogo (ej. "10x15_comun").
const CATEGORIA = 'fotos';

/* =========================================================
   CÁLCULO DE PRECIO
   ========================================================= */
// Precio simple: un producto por tamaño, se cobra por copia (no hay "carillas" en fotos).
function productoPorCodigo(codigo) {
  return state.productos.find(p => p.codigo === codigo);
}
function precioPorCodigo(codigo) {
  const p = productoPorCodigo(codigo);
  return p ? p.precio : 0;
}
// "10x15_comun" -> "10 x 15 cm". Si el patrón no matchea, se muestra la descripción del catálogo.
function labelTamano(p) {
  const m = p.codigo.match(/^(\d+)x(\d+)/i);
  return m ? `${m[1]} x ${m[2]} cm` : p.descripcion;
}

function calcularFoto(entry) {
  const copias = entry.settings.copias || 1;
  const precioUnidad = precioPorCodigo(entry.settings.tamano);
  const total = copias * precioUnidad;
  return { copias, precioUnidad, total };
}

function calcularTotalPedido() {
  let total = 0;
  files.forEach(entry => { total += calcularFoto(entry).total; });
  return total;
}

function money(n) {
  n = Number(n);
  if (!Number.isFinite(n)) n = 0; // defensa: nunca mostrar $NaN si algún dato viene incompleto
  return '$' + Math.round(n).toLocaleString('es-AR');
}

/* =========================================================
   API
   ========================================================= */
async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Error de red (' + res.status + ')');
  return res.json();
}
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || ('Error de red (' + res.status + ')'));
  }
  return res.json();
}

async function loadProductos() {
  try {
    const catalogoCrudo = await apiGet('/api/productos?categoria=' + encodeURIComponent(CATEGORIA));
    // El endpoint devuelve también productos transversales (categoria_id NULL,
    // ej. "Anillado", "Suelto", "Abrochado" — acabados del catálogo de
    // impresión). Fotos no tiene acabados: nos quedamos solo con productos
    // cuyo código matchea el patrón de tamaño ("10x15_comun", "13x18_mate", etc).
    state.productos = catalogoCrudo.filter(p => /^\d+x\d+/i.test(p.codigo));
    // Ordenamos por área (ancho×alto) para que el selector quede de menor a mayor.
    state.productos.sort((a, b) => {
      const da = (a.codigo.match(/^(\d+)x(\d+)/i) || []).slice(1).map(Number);
      const db = (b.codigo.match(/^(\d+)x(\d+)/i) || []).slice(1).map(Number);
      const areaA = da.length === 2 ? da[0] * da[1] : 0;
      const areaB = db.length === 2 ? db[0] * db[1] : 0;
      return areaA - areaB;
    });
    if (!state.productos.length) {
      console.error('No hay ningún producto de tamaño habilitado para la categoría', CATEGORIA);
    }
    renderTamanoGlobalOptions();
  } catch (err) {
    console.error('No se pudo cargar el catálogo de productos:', err);
    document.getElementById('rejectedAlert').textContent =
      'No pudimos cargar los precios en este momento. Probá recargar la página.';
    document.getElementById('rejectedAlert').style.display = 'flex';
  }
}

async function loadZonas() {
  const grid = document.getElementById('zoneGrid');
  try {
    const zonas = await apiGet('/api/zonas');
    if (!zonas.length) {
      grid.innerHTML = '<div class="empty">No hay zonas de entrega habilitadas por el momento.</div>';
      return;
    }
    grid.innerHTML = '';
    zonas.forEach(z => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'zone-card' + (z.es_retiro ? ' is-retiro' : '') + (state.zona && state.zona.id === z.id ? ' is-selected' : '');
      const envioLabel = z.es_retiro ? 'Sin costo' : money(z.precio_envio);
      card.innerHTML = `
        <span class="zn mono">${z.es_retiro ? 'RETIRO' : 'ZONA ' + String(z.id).padStart(2, '0')}</span>
        <div class="name">${z.nombre}</div>
        <div class="zn mono" style="margin-top:.4rem;">Envío: ${envioLabel}</div>`;
      card.addEventListener('click', () => selectZona(z));
      grid.appendChild(card);
    });

    if (state.zona) {
      const wrapDireccion = document.getElementById('wrapDireccion');
      wrapDireccion.style.display = state.zona.es_retiro ? 'none' : 'block';
      if (!state.zona.es_retiro) {
        document.getElementById('direccionEntrega').value = localStorage.getItem(LS_DIRECCION) || '';
      }
    }
  } catch (err) {
    console.error(err);
    document.getElementById('zoneAlert').textContent = 'No pudimos cargar las zonas de entrega. Probá recargar la página.';
    document.getElementById('zoneAlert').style.display = 'flex';
    grid.innerHTML = '';
  }
}

function selectZona(z) {
  state.zona = { id: z.id, nombre: z.nombre, precio_envio: z.precio_envio, es_retiro: !!z.es_retiro };
  localStorage.setItem(LS_ZONA, JSON.stringify(state.zona));
  document.querySelectorAll('.zone-card').forEach(c => c.classList.remove('is-selected'));
  document.getElementById('zoneGrid').querySelectorAll('.zone-card').forEach(c => {
    if (c.querySelector('.name').textContent === z.nombre) c.classList.add('is-selected');
  });

  const wrapDireccion = document.getElementById('wrapDireccion');
  wrapDireccion.style.display = z.es_retiro ? 'none' : 'block';
  if (!z.es_retiro && !document.getElementById('direccionEntrega').value) {
    document.getElementById('direccionEntrega').value = localStorage.getItem(LS_DIRECCION) || '';
  }
  updateNavState();
}

function truncarNombre(nombre, max) {
  if (nombre.length <= max) return nombre;
  return nombre.slice(0, max - 1) + '…';
}

function formatearFechaDDMMAAAA(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/* ---------- Turnos ---------- */
async function cargarDiasConTurno() {
  try {
    state.diasConTurno = await apiGet('/api/turnos/dias?zona_id=' + state.zona.id);
  } catch (err) {
    console.error('No se pudieron cargar los días con turnos, se muestran todos:', err);
    state.diasConTurno = null; // null = no pudimos filtrar, mostramos los 14 días igual
  }
}

function buildDatePicker() {
  const wrap = document.getElementById('datePicker');
  const diasConTurno = state.diasConTurno;

  wrap.innerHTML = '';
  const dows = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
  const hoy = new Date();
  let algunDiaMostrado = false;
  for (let i = 0; i < 14; i++) {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() + i);
    if (diasConTurno && !diasConTurno.includes(d.getDay())) continue;
    algunDiaMostrado = true;
    const iso = d.toISOString().slice(0, 10);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'date-chip' + (state.fecha === iso ? ' is-selected' : '');
    chip.innerHTML = `<span class="dow">${dows[d.getDay()]}</span><span class="dnum">${d.getDate()}</span>`;
    chip.addEventListener('click', () => selectFecha(iso));
    wrap.appendChild(chip);
  }
  if (!algunDiaMostrado) {
    wrap.innerHTML = '<div class="empty">No hay turnos configurados para esta zona en los próximos días.</div>';
  }
}

async function selectFecha(iso) {
  state.fecha = iso;
  state.turno = null;
  document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('is-selected'));
  buildDatePicker();
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '<div class="empty">Buscando turnos…</div>';
  try {
    // Para fotos no hay "carillas" — usamos cantidad total de copias como medida de volumen.
    let unidadesTotal = 0;
    files.forEach(entry => { unidadesTotal += calcularFoto(entry).copias; });
    const qs = new URLSearchParams({ zona_id: state.zona.id, fecha: iso, categoria: CATEGORIA, carillas: unidadesTotal });
    const turnos = await apiGet(`/api/turnos?${qs.toString()}`);
    if (!turnos.length) {
      grid.innerHTML = '<div class="empty">No hay turnos disponibles para esta fecha. Probá con otro día.</div>';
      updateNavState();
      return;
    }
    grid.innerHTML = '';
    turnos.forEach(t => {
      const full = !t.disponible;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'slot-card' + (full ? ' is-full' : '');
      card.disabled = full;
      card.innerHTML = `
        <span class="day mono">${formatearFechaDDMMAAAA(iso)}</span>
        <div class="range">${t.hora_inicio} – ${t.hora_fin}</div>
        <div class="cap">${full ? 'NO DISPONIBLE' : (t.capacidad_maxima ? (t.capacidad_maxima - t.ocupados) + ' cupos' : 'cupo abierto')}</div>`;
      if (!full) card.addEventListener('click', () => selectTurno(t, card));
      grid.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    grid.innerHTML = '<div class="empty">No pudimos cargar los turnos. Probá de nuevo.</div>';
  }
  updateNavState();
}

function selectTurno(t, cardEl) {
  state.turno = t;
  document.querySelectorAll('.slot-card').forEach(c => c.classList.remove('is-selected'));
  cardEl.classList.add('is-selected');
  updateNavState();
}
/* =========================================================
   FOTOS — carga, edición (crop/zoom/B&N) y subida a R2
   ========================================================= */
const TAMANO_MAXIMO_BYTES = 50 * 1024 * 1024; // 50 MB — debe coincidir con functions/api/lib/r2.js

function renderTamanoGlobalOptions() {
  const sel = document.getElementById('gTamano');
  if (!sel) return;
  sel.innerHTML = state.productos.map(p => `<option value="${p.codigo}">${labelTamano(p)}</option>`).join('');
}

function readGlobalSettings() {
  const bynBtn = document.querySelector('#gByn button.is-on');
  return {
    copias: parseInt(document.getElementById('gCopias').value, 10) || 1,
    tamano: document.getElementById('gTamano').value || (state.productos[0] || {}).codigo,
    byn: bynBtn ? bynBtn.dataset.value === '1' : false,
  };
}

function estadoEdicionInicial() {
  return {
    scale: 1, panX: 0, panY: 0,
    brightness: 1, contrast: 1, saturate: 1,
    byn: false,
  };
}

// Filtro CSS/canvas compartido entre el preview en vivo y la exportación final.
// El "Blanco y negro" del prototipo no es solo desaturar: es un look de foto
// en B&N con más contraste y un leve empujón de brillo (ver fotos_final.html,
// updateVisuals()) — grayscale(100%) se agrega ENCIMA de brillo/contraste/
// saturación base, no los reemplaza.
function construirFiltroCss(st) {
  let filt = `brightness(${st.brightness}) contrast(${st.contrast}) saturate(${st.saturate})`;
  if (st.byn) filt += ` grayscale(100%) contrast(1.5) brightness(1.05)`;
  return filt;
}

function addFiles(fileListObj) {
  const accepted = [], rejected = [], demasiadoGrandes = [];
  Array.from(fileListObj).forEach(f => {
    if (!f.type.startsWith('image/')) { rejected.push(f); return; }
    if (f.size > TAMANO_MAXIMO_BYTES) { demasiadoGrandes.push(f); return; }
    accepted.push(f);
  });

  const alertEl = document.getElementById('rejectedAlert');
  const motivos = [];
  if (rejected.length) motivos.push(`${rejected.length === 1 ? 'este archivo no es una imagen válida' : 'estos archivos no son imágenes válidas'}: ${rejected.map(f => f.name).join(', ')}`);
  if (demasiadoGrandes.length) motivos.push(`${demasiadoGrandes.length === 1 ? 'esta foto supera' : 'estas fotos superan'} los 50 MB: ${demasiadoGrandes.map(f => f.name).join(', ')}`);
  if (motivos.length) {
    alertEl.textContent = 'No pudimos cargar ' + motivos.join(' · ');
    alertEl.style.display = 'flex';
  } else {
    alertEl.style.display = 'none';
  }

  if (!state.productos.length) return; // sin catálogo no podemos asignar tamaño/precio

  const g = readGlobalSettings();
  const newIds = [];
  accepted.forEach(f => {
    const id = 'f' + (++fileIdCounter);
    const thumbUrl = URL.createObjectURL(f);
    files.set(id, {
      file: f, thumbUrl, naturalW: 0, naturalH: 0,
      settings: { copias: g.copias, tamano: g.tamano },
      editState: { ...estadoEdicionInicial(), byn: g.byn },
      // La subida a R2 ya no ocurre por edición — se sube una única vez cuando
      // el usuario confirma el Paso 2 tocando "Continuar" (ver subirTodasLasFotos()).
      r2Key: null, subiendo: false, errorSubida: null,
    });
    newIds.push(id);
  });

  if (accepted.length) {
    document.getElementById('dzWrap').style.display = 'none';
    document.getElementById('loadedWrap').style.display = 'block';
    renderFileList();
  }
  updateNavState();
}

// Exporta el recorte + ajustes actuales de una tarjeta a un Blob JPEG, usando su
// <canvas> de trabajo. Devuelve null si la imagen todavía no cargó.
function exportarFotoBlob(id) {
  return new Promise(resolve => {
    const entry = files.get(id);
    const card = document.getElementById('card-' + id);
    if (!entry || !card) return resolve(null);
    const imgEl = card.querySelector('.crop-source-img');
    const cropContainer = card.querySelector('.crop-container');
    if (!imgEl || !imgEl.naturalWidth || !cropContainer) return resolve(null);

    const st = entry.editState;
    const natW = imgEl.naturalWidth, natH = imgEl.naturalHeight;
    const fW = cropContainer.clientWidth, fH = cropContainer.clientHeight;
    if (!fW || !fH) return resolve(null);

    let bW = fW, bH = fW / (natW / natH);
    if ((natW / natH) > (fW / fH)) { bH = fH; bW = fH * (natW / natH); }

    const cW = bW * st.scale, cH = bH * st.scale;
    const scX = natW / cW, scY = natH / cH;
    const srcX = (cW / 2 - fW / 2 - st.panX) * scX;
    const srcY = (cH / 2 - fH / 2 - st.panY) * scY;
    const srcW = fW * scX, srcH = fH * scY;

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(srcW));
    canvas.height = Math.max(1, Math.round(srcH));
    const ctx = canvas.getContext('2d');

    let cssFilt = construirFiltroCss(st);
    ctx.filter = cssFilt;
    ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.92);
  });
}

// Sube (o re-sube, si ya se había subido antes) el JPEG final de una foto a
// staging/. Ya no se llama en cada edición — se llama una sola vez por foto
// cuando el usuario confirma el Paso 2 (ver subirTodasLasFotos()).
async function subirFotoEditada(id) {
  const entry = files.get(id);
  if (!entry) return;
  entry.subiendo = true;
  entry.errorSubida = null;
  actualizarEstadoSubida(id);

  try {
    const blob = await exportarFotoBlob(id);
    if (!blob) throw new Error('No se pudo procesar la foto. Probá de nuevo.');

    // Si ya había una versión subida (de un "Continuar" anterior seguido de un
    // "Atrás" para seguir editando), la borramos después de subir la nueva.
    const keyPrevia = entry.r2Key;

    const nombreExport = entry.file.name.replace(/\.[^/.]+$/, '') + '.jpg';
    const qs = new URLSearchParams({ nombre: nombreExport, sesion: state.sesionSubida });
    const res = await fetch('/api/archivos?' + qs.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al subir la foto.');
    }
    const data = await res.json();
    const current = files.get(id);
    if (!current) return; // se borró mientras subía
    current.r2Key = data.key;
    current.subiendo = false;

    if (keyPrevia && keyPrevia !== data.key) {
      fetch('/api/archivos?key=' + encodeURIComponent(keyPrevia), { method: 'DELETE' }).catch(() => {});
    }
  } catch (err) {
    console.error('Error subiendo foto:', err);
    const current = files.get(id);
    if (!current) return;
    current.subiendo = false;
    current.errorSubida = err.message || 'No se pudo subir. Probá de nuevo.';
  }
  actualizarEstadoSubida(id);
  updateNavState();
}

// Cualquier cambio de encuadre/color invalida la última subida (si la había)
// y vuelve a marcar la foto como "pendiente" — no dispara red. La subida real
// ocurre recién al tocar "Continuar" (ver subirTodasLasFotos()).
function marcarPendienteDeSubir(id) {
  const entry = files.get(id);
  if (!entry) return;
  entry.r2Key = null;
  entry.errorSubida = null;
  entry.subiendo = false;
  actualizarEstadoSubida(id);
  updateNavState();
}

// Se llama al tocar "Continuar" en el Paso 2. Sube todas las fotos que todavía
// no tengan r2Key (nuevas o editadas desde la última subida), en paralelo.
// Devuelve true si todas terminaron OK.
async function subirTodasLasFotos() {
  const pendientes = [...files.entries()].filter(([, entry]) => !entry.r2Key);
  if (!pendientes.length) return true;
  await Promise.all(pendientes.map(([id]) => subirFotoEditada(id)));
  return [...files.values()].every(entry => entry.r2Key && !entry.errorSubida);
}

function actualizarEstadoSubida(id) {
  const el = document.getElementById('upload-' + id);
  if (!el) return;
  const entry = files.get(id);
  if (!entry) return;
  el.innerHTML = estadoSubidaHtml(id, entry);
  const retryBtn = el.querySelector('[data-retry]');
  if (retryBtn) retryBtn.addEventListener('click', () => subirFotoEditada(retryBtn.dataset.retry));
}

function estadoSubidaHtml(id, entry) {
  if (entry.subiendo) return `<span class="upload-status is-uploading">⟳ Subiendo…</span>`;
  if (entry.errorSubida) return `<span class="upload-status is-error">⚠ ${entry.errorSubida} <button type="button" class="btn btn-sm btn-outline" data-retry="${id}">Reintentar</button></span>`;
  if (entry.r2Key) return `<span class="upload-status is-ok">✓ Lista</span>`;
  return `<span class="upload-status is-pending">Pendiente</span>`;
}

function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  let i = 0;
  files.forEach((entry, id) => {
    i++;
    const calc = calcularFoto(entry);
    const card = document.createElement('article');
    card.className = 'photo-card';
    card.id = 'card-' + id;
    card.innerHTML = `
      <div class="photo-card-head">
        <div class="fname-wrap">
          <div class="idx">FOTO ${i}/${files.size}</div>
          <div class="fname" title="${entry.file.name}">${entry.file.name}</div>
        </div>
        <div id="upload-${id}">${estadoSubidaHtml(id, entry)}</div>
      </div>

      <div class="photo-preview">
        <div class="crop-container">
          <div class="image-movable"><img class="crop-source-img" src="${entry.thumbUrl}"></div>
          <div class="crop-frame"></div>
        </div>
      </div>

      <div class="photo-edit-controls">
        <button type="button" class="btn-icon" data-action="zoom-out" title="Alejar">−</button>
        <input type="range" class="zoom-slider" min="1" max="3" step="0.01" value="${entry.editState.scale}" data-id="${id}">
        <button type="button" class="btn-icon" data-action="zoom-in" title="Acercar">+</button>
        <span class="zoom-label">Arrastrá la foto para moverla</span>
      </div>

      <div class="byn-toggle">
        <label>Blanco y negro</label>
        <div class="segmented local-byn" data-id="${id}">
          <button type="button" data-value="0" class="${entry.editState.byn ? '' : 'is-on'}">Color</button>
          <button type="button" data-value="1" class="${entry.editState.byn ? 'is-on' : ''}">B&amp;N</button>
        </div>
      </div>

      <details class="photo-color-panel">
        <summary>Ajustes opcionales</summary>
        <div class="photo-color-panel-content">
          <div class="color-row"><label>Brillo</label><input type="range" data-key="brightness" data-id="${id}" min="0.6" max="1.4" step="0.02" value="${entry.editState.brightness}"></div>
          <div class="color-row"><label>Contraste</label><input type="range" data-key="contrast" data-id="${id}" min="0.6" max="1.4" step="0.02" value="${entry.editState.contrast}"></div>
          <div class="color-row"><label>Saturación</label><input type="range" data-key="saturate" data-id="${id}" min="0" max="2" step="0.1" value="${entry.editState.saturate}" ${entry.editState.byn ? 'disabled' : ''}></div>
        </div>
      </details>

      <div class="photo-card-foot">
        <div class="field">
          <label>Tamaño</label>
          <select class="select local-tamano" data-id="${id}">
            ${state.productos.map(p => `<option value="${p.codigo}" ${entry.settings.tamano === p.codigo ? 'selected' : ''}>${labelTamano(p)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Copias</label>
          <input class="input" type="number" min="1" value="${entry.settings.copias}" data-id="${id}" data-field="copias">
        </div>
        <button type="button" class="photo-remove" data-remove="${id}" aria-label="Quitar">✕</button>
      </div>

      <div class="dim-line" id="dim-${id}">
        <span>${labelTamano(productoPorCodigo(entry.settings.tamano) || { codigo: entry.settings.tamano, descripcion: '' })} × ${calc.copias} ${calc.copias === 1 ? 'copia' : 'copias'}</span>
        <span class="result"><span class="amt">${money(calc.total)}</span></span>
      </div>
    `;
    list.appendChild(card);
    initPhotoCard(id, card, entry);
  });

  updateNavState();
}

// Inicializa el encuadre interactivo (crop/zoom/pan) y los listeners de una tarjeta
// recién insertada en el DOM. Separado de renderFileList para no reconstruir el
// estado de recorte cada vez que se re-renderiza la lista completa.
function initPhotoCard(id, card, entry) {
  const previewArea = card.querySelector('.photo-preview');
  const cropContainer = card.querySelector('.crop-container');
  const imageMovable = card.querySelector('.image-movable');
  const imgEl = card.querySelector('.crop-source-img');
  const slider = card.querySelector('.zoom-slider');
  const tamanoSelect = card.querySelector('.local-tamano');

  const updateView = () => {
    const availW = previewArea.clientWidth - 16;
    const availH = previewArea.clientHeight - 16;
    if (availW <= 0) return;

    const producto = productoPorCodigo(entry.settings.tamano);
    const dims = (producto ? producto.codigo : entry.settings.tamano).match(/^(\d+)x(\d+)/i);
    const targetRatio = dims ? (parseFloat(dims[1]) / parseFloat(dims[2])) : 1;

    let frameW, frameH;
    if (targetRatio > (availW / availH)) { frameW = availW; frameH = availW / targetRatio; }
    else { frameH = availH; frameW = availH * targetRatio; }

    cropContainer.style.width = `${frameW}px`;
    cropContainer.style.height = `${frameH}px`;

    const natW = imgEl.naturalWidth, natH = imgEl.naturalHeight;
    if (!natW) return;

    let baseW, baseH;
    if ((natW / natH) > (frameW / frameH)) { baseH = frameH; baseW = frameH * (natW / natH); }
    else { baseW = frameW; baseH = frameW / (natW / natH); }

    const st = entry.editState;
    const currW = baseW * st.scale, currH = baseH * st.scale;
    const maxPanX = Math.max(0, (currW - frameW) / 2);
    const maxPanY = Math.max(0, (currH - frameH) / 2);
    st.panX = Math.max(-maxPanX, Math.min(maxPanX, st.panX));
    st.panY = Math.max(-maxPanY, Math.min(maxPanY, st.panY));

    imageMovable.style.width = `${baseW}px`;
    imageMovable.style.height = `${baseH}px`;
    imageMovable.style.transform = `translate(calc(-50% + ${st.panX}px), calc(-50% + ${st.panY}px)) scale(${st.scale})`;

    applyFilters();
  };

  const applyFilters = () => {
    imgEl.style.filter = construirFiltroCss(entry.editState);
  };

  imgEl.onload = () => {
    entry.naturalW = imgEl.naturalWidth;
    entry.naturalH = imgEl.naturalHeight;
    updateView();
  };
  if (imgEl.complete && imgEl.naturalWidth) imgEl.onload();

  new ResizeObserver(updateView).observe(previewArea);

  // Cambiar tamaño: resetea encuadre (relación de aspecto distinta) y re-sube.
  tamanoSelect.addEventListener('change', () => {
    entry.settings.tamano = tamanoSelect.value;
    entry.editState.scale = 1; entry.editState.panX = 0; entry.editState.panY = 0;
    slider.value = 1;
    updateView();
    updateDim(id);
    marcarPendienteDeSubir(id);
  });

  slider.addEventListener('input', e => {
    entry.editState.scale = parseFloat(e.target.value);
    updateView();
    marcarPendienteDeSubir(id);
  });
  card.querySelector('[data-action="zoom-in"]').addEventListener('click', () => {
    slider.value = Math.min(3, parseFloat(slider.value) + 0.1);
    entry.editState.scale = parseFloat(slider.value);
    updateView();
    marcarPendienteDeSubir(id);
  });
  card.querySelector('[data-action="zoom-out"]').addEventListener('click', () => {
    slider.value = Math.max(1, parseFloat(slider.value) - 0.1);
    entry.editState.scale = parseFloat(slider.value);
    updateView();
    marcarPendienteDeSubir(id);
  });

  // Arrastre del encuadre (mouse + touch)
  let isDown = false, sX, sY, iX, iY;
  cropContainer.addEventListener('mousedown', e => { isDown = true; sX = e.clientX; sY = e.clientY; iX = entry.editState.panX; iY = entry.editState.panY; });
  window.addEventListener('mousemove', e => { if (isDown) { entry.editState.panX = iX + (e.clientX - sX); entry.editState.panY = iY + (e.clientY - sY); updateView(); } });
  window.addEventListener('mouseup', () => { if (isDown) { isDown = false; marcarPendienteDeSubir(id); } });

  cropContainer.addEventListener('touchstart', e => { if (e.touches.length === 1) { isDown = true; sX = e.touches[0].clientX; sY = e.touches[0].clientY; iX = entry.editState.panX; iY = entry.editState.panY; } }, { passive: false });
  window.addEventListener('touchmove', e => { if (isDown && e.touches.length === 1) { e.preventDefault(); entry.editState.panX = iX + (e.touches[0].clientX - sX); entry.editState.panY = iY + (e.touches[0].clientY - sY); updateView(); } }, { passive: false });
  window.addEventListener('touchend', () => { if (isDown) { isDown = false; marcarPendienteDeSubir(id); } });

  // Toggle Blanco y negro
  const bynGroup = card.querySelector('.local-byn');
  bynGroup.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const val = btn.dataset.value === '1';
    entry.editState.byn = val;
    bynGroup.querySelectorAll('button').forEach(b => b.classList.remove('is-on'));
    btn.classList.add('is-on');
    const satInput = card.querySelector('[data-key="saturate"]');
    if (satInput) satInput.disabled = val;
    applyFilters();
    marcarPendienteDeSubir(id);
  });

  // Sliders de ajustes opcionales (brillo/contraste/saturación)
  card.querySelectorAll('[data-key]').forEach(input => {
    input.addEventListener('input', () => {
      entry.editState[input.dataset.key] = parseFloat(input.value);
      applyFilters();
      marcarPendienteDeSubir(id);
    });
  });

  // Copias
  card.querySelector('[data-field="copias"]').addEventListener('input', e => {
    entry.settings.copias = parseInt(e.target.value, 10) || 1;
    updateDim(id);
  });

  // Quitar foto
  card.querySelector('[data-remove]').addEventListener('click', () => {
    if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
    if (entry.r2Key) fetch('/api/archivos?key=' + encodeURIComponent(entry.r2Key), { method: 'DELETE' }).catch(() => {});
    files.delete(id);
    if (files.size === 0) {
      document.getElementById('dzWrap').style.display = 'block';
      document.getElementById('loadedWrap').style.display = 'none';
    } else {
      renderFileList();
    }
    updateNavState();
  });
}

function updateDim(id) {
  const entry = files.get(id);
  if (!entry) return;
  const calc = calcularFoto(entry);
  const el = document.getElementById('dim-' + id);
  if (!el) return;
  const p = productoPorCodigo(entry.settings.tamano);
  el.querySelector('span:first-child').textContent = `${labelTamano(p || { codigo: entry.settings.tamano, descripcion: '' })} × ${calc.copias} ${calc.copias === 1 ? 'copia' : 'copias'}`;
  el.querySelector('.result').innerHTML = `<span class="amt">${money(calc.total)}</span>`;
  updateNavState();
}

document.getElementById('btnApplyAll').addEventListener('click', () => {
  const g = readGlobalSettings();
  files.forEach((entry, id) => {
    entry.settings.tamano = g.tamano;
    entry.settings.copias = g.copias;
    entry.editState.byn = g.byn;
  });
  renderFileList();
});

document.querySelectorAll('#gByn').forEach(group => {
  group.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach(b => b.classList.remove('is-on'));
    btn.classList.add('is-on');
  });
});

/* Carga por dropzone + input "agregar más" */
const dropzone = document.getElementById('dropzone');
document.getElementById('fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
document.getElementById('fileInputMore').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
['dragover', 'dragleave', 'drop'].forEach(evt => {
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.toggle('is-active', evt === 'dragover');
    if (evt === 'drop') addFiles(e.dataTransfer.files);
  });
});
const dropzoneMore = document.getElementById('dropzoneMore');
['dragover', 'dragleave', 'drop'].forEach(evt => {
  dropzoneMore.addEventListener(evt, e => {
    e.preventDefault();
    dropzoneMore.classList.toggle('is-active', evt === 'dragover');
    if (evt === 'drop') addFiles(e.dataTransfer.files);
  });
});


/* =========================================================
   PASO 4 — datos del cliente
   ========================================================= */
function prefillCliente() {
  if (!state.cliente) return;
  const c = state.cliente;
  document.getElementById('cNombre').value = c.nombre || '';
  document.getElementById('cApellido').value = c.apellido || '';
  document.getElementById('cDocTipo').value = c.documento_tipo || 'dni';
  document.getElementById('cDocNumero').value = c.documento_numero || '';
  document.getElementById('cEmail').value = c.email || '';
  document.getElementById('cCelular').value = c.celular || '';
  updateNavState(); // el prefill no dispara "input" — hay que revalidar el botón a mano
}

document.getElementById('panel-4').addEventListener('input', updateNavState);
document.getElementById('direccionEntrega').addEventListener('input', updateNavState);

function readClienteForm() {
  return {
    nombre: document.getElementById('cNombre').value.trim(),
    apellido: document.getElementById('cApellido').value.trim(),
    documento_tipo: document.getElementById('cDocTipo').value,
    documento_numero: document.getElementById('cDocNumero').value.trim(),
    email: document.getElementById('cEmail').value.trim(),
    celular: document.getElementById('cCelular').value.trim(),
  };
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clienteFormValido() {
  const c = readClienteForm();
  if (!c.nombre || !c.apellido) return false;

  const soloDigitos = c.documento_numero.replace(/\D/g, '');
  const docValido = c.documento_tipo === 'cuit'
    ? soloDigitos.length === 11
    : soloDigitos.length >= 7 && soloDigitos.length <= 8;
  if (!docValido) return false;

  if (!REGEX_EMAIL.test(c.email)) return false;

  const celularDigitos = c.celular.replace(/\D/g, '');
  if (celularDigitos.length < 8) return false;

  return true;
}

function direccionEntregaFinal() {
  if (state.zona && state.zona.es_retiro) return 'Retiro en local';
  return document.getElementById('direccionEntrega').value.trim();
}

/* =========================================================
   PASO 5 — resumen y pago
   ========================================================= */
async function renderResumenFinal() {
  const body = document.getElementById('finalBody');
  body.innerHTML = '';
  let unidadesTotal = 0;
  files.forEach(entry => {
    const calc = calcularFoto(entry);
    unidadesTotal += calc.copias;
    const p = productoPorCodigo(entry.settings.tamano);
    const row = document.createElement('div');
    row.className = 'receipt-row';
    row.innerHTML = `
      <div>
        <div class="name" title="${entry.file.name}">${truncarNombre(entry.file.name, 20)}</div>
        <div class="spec">${labelTamano(p || { codigo: entry.settings.tamano, descripcion: '' })} · ${calc.copias} ${calc.copias === 1 ? 'copia' : 'copias'}${entry.editState.byn ? ' · Blanco y negro' : ''}</div>
      </div>
      <div class="val">${money(calc.total)}</div>`;
    body.appendChild(row);
  });
  document.getElementById('finalCount').textContent = files.size + (files.size === 1 ? ' foto' : ' fotos');

  const subtotalFotos = calcularTotalPedido();
  document.getElementById('finalTotal').textContent = money(subtotalFotos); // valor provisorio mientras llega el envío

  try {
    const qs = new URLSearchParams({ zona_id: state.zona.id, categoria: CATEGORIA, carillas: unidadesTotal });
    const envio = await apiGet('/api/envio?' + qs.toString());

    const rowEnvio = document.createElement('div');
    rowEnvio.className = 'receipt-row';
    const etiquetaEnvio = envio.con_envio
      ? `Envío a ${state.zona.nombre}${envio.descuento_porcentaje ? ` (−${envio.descuento_porcentaje}% por volumen)` : ''}`
      : 'Retiro en local';
    rowEnvio.innerHTML = `<div><div class="name">${etiquetaEnvio}</div></div><div class="val">${money(envio.costo_envio)}</div>`;
    body.appendChild(rowEnvio);

    document.getElementById('finalTotal').textContent = money(subtotalFotos + envio.costo_envio);
  } catch (err) {
    console.error('No se pudo calcular el envío:', err);
  }
}

document.getElementById('btnPagar').addEventListener('click', async () => {
  const btn = document.getElementById('btnPagar');
  const errEl = document.getElementById('payError');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Generando checkout…';

  try {
    const payload = {
      categoria: CATEGORIA,
      cliente: readClienteForm(),
      zona_id: state.zona.id,
      turno_entrega_id: state.turno.turno_entrega_id,
      fecha_entrega: state.fecha,
      direccion_entrega: direccionEntregaFinal(),
      archivos: [...files.values()].map(entry => ({
        nombre: entry.file.name,
        copias: entry.settings.copias,
        primario: entry.settings.tamano,
        acabado: 'suelto',
        r2_key: entry.r2Key,
      })),
    };

    const { trabajo_id } = await apiPost('/api/trabajos', payload);
    const { init_point } = await apiPost('/api/checkout', { trabajo_id });

    localStorage.setItem(LS_CLIENTE, JSON.stringify(payload.cliente));
    if (!state.zona.es_retiro) localStorage.setItem(LS_DIRECCION, payload.direccion_entrega);
    state.trabajoIdPago = trabajo_id;

    const esDesktop = window.innerWidth > 640;
    document.getElementById('payQrBlock').style.display = esDesktop ? 'block' : 'none';
    if (esDesktop) {
      document.getElementById('payQr').src =
        'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(init_point);
    }
    document.getElementById('payLink').href = init_point;
    document.getElementById('payLaunch').style.display = 'block';
    btn.style.display = 'none';

    iniciarPollingPago(trabajo_id);
  } catch (err) {
    console.error(err);
    errEl.textContent = err.message || 'No pudimos generar el checkout. Intentá de nuevo en unos segundos.';
    errEl.style.display = 'flex';
    btn.disabled = false;
    btn.textContent = 'Ir a pagar con Mercado Pago →';
  }
});

/* =========================================================
   NAVEGACIÓN DEL WIZARD
   ========================================================= */
function stepValido(n) {
  switch (n) {
    case 1:
      if (!state.zona) return false;
      if (state.zona.es_retiro) return true;
      return !!document.getElementById('direccionEntrega').value.trim();
    case 2: return files.size > 0 && [...files.values()].every(e => !e.subiendo && !e.errorSubida);
    case 3: return !!(state.fecha && state.turno);
    case 4: return clienteFormValido();
    default: return true;
  }
}

function updateStepline() {
  document.querySelectorAll('.stepline .tick').forEach(tick => {
    const n = parseInt(tick.dataset.step, 10);
    tick.classList.toggle('is-active', n === state.step);
    tick.classList.toggle('is-done', n < state.step);
  });
}

function updateNavState() {
  document.getElementById('btnBack').style.visibility = state.step === 1 ? 'hidden' : 'visible';
  const btnNext = document.getElementById('btnNext');
  const isLast = state.step === 5;
  btnNext.style.display = isLast ? 'none' : 'inline-flex';
  btnNext.disabled = !stepValido(state.step);
  btnNext.textContent = 'Continuar →';

  const peek = document.getElementById('pricePeek');
  if (files.size > 0) {
    peek.innerHTML = '<span class="amt">' + money(calcularTotalPedido()) + '</span>';
  } else {
    peek.textContent = '';
  }
}

function goToStep(n) {
  document.getElementById('panel-' + state.step).classList.remove('is-active');
  state.step = n;
  document.getElementById('panel-' + state.step).classList.add('is-active');
  updateStepline();
  updateNavState();

  if (n === 3) {
    document.getElementById('turnoZonaLabel').textContent = `Turnos disponibles para ${state.zona ? state.zona.nombre : 'tu zona'}.`;
    document.getElementById('datePicker').innerHTML = '<div class="empty">Cargando días disponibles…</div>';
    cargarDiasConTurno().then(buildDatePicker);
  }
  if (n === 4) prefillCliente();
  if (n === 5) renderResumenFinal();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('btnNext').addEventListener('click', async () => {
  if (!stepValido(state.step)) return;

  if (state.step === 2) {
    const btnNext = document.getElementById('btnNext');
    btnNext.disabled = true;
    btnNext.textContent = 'Subiendo fotos…';
    const ok = await subirTodasLasFotos();
    btnNext.textContent = 'Continuar →';
    if (!ok) { updateNavState(); return; } // alguna quedó con error — se muestra en su tarjeta, con botón de reintentar
  }

  if (state.step < 5) goToStep(state.step + 1);
});
document.getElementById('btnBack').addEventListener('click', () => {
  if (state.step > 1) goToStep(state.step - 1);
});

/* =========================================================
   RESULTADO DEL PAGO (vuelta desde Mercado Pago, mismo index.html)
   ========================================================= */
const RESULTADOS = {
  aprobado: {
    eyebrow: 'PAGO APROBADO',
    titulo: '¡Listo! Tu pedido está confirmado',
    texto: 'Ya registramos el pago y tu pedido pasó a producción. Te vamos a avisar cuando esté en camino.',
    color: '#0a7a3d',
  },
  rechazado: {
    eyebrow: 'PAGO RECHAZADO',
    titulo: 'No pudimos procesar el pago',
    texto: 'Mercado Pago rechazó el pago. Podés intentar de nuevo con otro medio de pago desde un nuevo pedido.',
    color: '#c0392b',
  },
  pendiente: {
    eyebrow: 'PAGO PENDIENTE',
    titulo: 'Tu pago está en revisión',
    texto: 'Esto puede pasar con algunos medios de pago (ej. efectivo o transferencia). Te confirmamos por mail o WhatsApp apenas se acredite.',
    color: '#b8860b',
  },
};

function mostrarResultado(estadoKey, trabajoId) {
  const r = RESULTADOS[estadoKey];
  if (!r) return;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('is-active'));
  document.getElementById('stepline').style.display = 'none';
  document.querySelector('.wizard-nav').style.display = 'none';

  document.getElementById('resultadoDoodle').style.color = r.color;
  document.getElementById('resultadoEyebrow').textContent = r.eyebrow;
  document.getElementById('resultadoTitulo').textContent = r.titulo;
  document.getElementById('resultadoTexto').textContent = r.texto;
  document.getElementById('resultadoTrabajo').textContent = trabajoId ? 'PEDIDO #' + trabajoId : '';
  document.getElementById('panel-resultado').classList.add('is-active');
}

function mostrarResultadoSiCorresponde() {
  const params = new URLSearchParams(window.location.search);
  const estado = params.get('estado');
  if (!estado || !RESULTADOS[estado]) return false;
  mostrarResultado(estado, params.get('trabajo'));
  return true;
}

let pollingPagoId = null;
function iniciarPollingPago(trabajoId) {
  if (pollingPagoId) clearInterval(pollingPagoId);
  const inicio = Date.now();
  const LIMITE_MS = 10 * 60 * 1000;

  pollingPagoId = setInterval(async () => {
    if (Date.now() - inicio > LIMITE_MS) {
      clearInterval(pollingPagoId);
      return;
    }
    try {
      const data = await apiGet('/api/trabajos/estado?trabajo_id=' + trabajoId);
      if (data.pagado) {
        clearInterval(pollingPagoId);
        mostrarResultado('aprobado', trabajoId);
      }
    } catch (err) {
      console.error('Error consultando estado del pago:', err);
    }
  }, 4000);
}

document.getElementById('btnNuevoPedido').addEventListener('click', () => {
  window.location.href = window.location.origin + window.location.pathname;
});

/* =========================================================
   INIT
   ========================================================= */
(async function init() {
  if (mostrarResultadoSiCorresponde()) return;

  await loadProductos();
  await loadZonas();
  updateStepline();
  updateNavState();
})();
