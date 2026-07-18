/* =========================================================
   ESTADO GLOBAL
   ========================================================= */
const LS_ZONA = 'imprenta.zona';
const LS_CLIENTE = 'imprenta.cliente';

const state = {
  step: 1,
  zona: JSON.parse(localStorage.getItem(LS_ZONA) || 'null'), // {id, nombre}
  productos: [],           // catálogo desde /api/productos
  fecha: null,              // 'YYYY-MM-DD' elegida
  turno: null,              // objeto turno elegido
  cliente: JSON.parse(localStorage.getItem(LS_CLIENTE) || 'null'),
  direccionDistinta: false,
  // Todos los archivos de este pedido suben bajo la misma carpeta de staging en R2
  // (staging/{sesionSubida}/...) — se confirman o se limpian juntos.
  sesionSubida: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
};

let fileIdCounter = 0;
const files = new Map(); // id -> { file, isImage, thumbUrl, numPages, settings:{...}, r2Key, subiendo, errorSubida }

const PRODUCTO_PRIMARIO_DESC = 'Impresión ByN A4 (carilla)';
const ACABADO_A_PRODUCTO = {
  suelto:    'Sueltas',
  abrochado: 'Abrochadas',
  anillado:  'Anillados A4',
  clip:      'Clip',
};

/* =========================================================
   UTILIDADES DE CÁLCULO (espejo del cálculo server-side)
   ========================================================= */

// Parsea un rango tipo "1-5,8,10-12" contra un total de páginas.
// Vacío => todas las páginas. Devuelve la cantidad de páginas seleccionadas.
function contarPaginasEnRango(rango, totalPaginas) {
  totalPaginas = totalPaginas || 1;
  if (!rango || !rango.trim()) return totalPaginas;
  const set = new Set();
  rango.split(',').forEach(part => {
    part = part.trim();
    if (!part) return;
    const m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let p = a; p <= b; p++) if (p >= 1 && p <= totalPaginas) set.add(p);
    } else if (/^\d+$/.test(part)) {
      const p = parseInt(part, 10);
      if (p >= 1 && p <= totalPaginas) set.add(p);
    }
  });
  return set.size || totalPaginas;
}

function precioProducto(descripcion) {
  const p = state.productos.find(p => p.descripcion === descripcion);
  return p ? p.precio : 0;
}

// Calcula el detalle y total de un archivo (estimación en cliente).
function calcularArchivo(entry) {
  const paginas = entry.isImage ? 1 : contarPaginasEnRango(entry.settings.rango, entry.numPages || 1);
  const copias = entry.settings.copias || 1;
  const carillas = paginas * copias;

  const precioPrimario = precioProducto(PRODUCTO_PRIMARIO_DESC);
  const subtotalPrimario = carillas * precioPrimario;

  const descSecundario = ACABADO_A_PRODUCTO[entry.settings.acabado] || ACABADO_A_PRODUCTO.suelto;
  const precioSecundario = precioProducto(descSecundario);
  const subtotalSecundario = copias * precioSecundario;

  return {
    paginas, copias, carillas,
    subtotalPrimario, subtotalSecundario,
    total: subtotalPrimario + subtotalSecundario,
    descSecundario,
  };
}

function calcularTotalPedido() {
  let total = 0;
  files.forEach(entry => { total += calcularArchivo(entry).total; });
  return total;
}

function money(n) {
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
  if (!res.ok) throw new Error('Error de red (' + res.status + ')');
  return res.json();
}

async function loadProductos() {
  try {
    state.productos = await apiGet('/api/productos');
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
      card.className = 'zone-card' + (state.zona && state.zona.id === z.id ? ' is-selected' : '');
      card.innerHTML = `<span class="zn mono">ZONA ${String(z.id).padStart(2, '0')}</span><div class="name">${z.nombre}</div>`;
      card.addEventListener('click', () => selectZona(z));
      grid.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    document.getElementById('zoneAlert').textContent = 'No pudimos cargar las zonas de entrega. Probá recargar la página.';
    document.getElementById('zoneAlert').style.display = 'flex';
    grid.innerHTML = '';
  }
}

function selectZona(z) {
  state.zona = { id: z.id, nombre: z.nombre };
  localStorage.setItem(LS_ZONA, JSON.stringify(state.zona));
  document.querySelectorAll('.zone-card').forEach(c => c.classList.remove('is-selected'));
  document.getElementById('zoneGrid').querySelectorAll('.zone-card').forEach(c => {
    if (c.querySelector('.name').textContent === z.nombre) c.classList.add('is-selected');
  });
  updateNavState();
}

/* ---------- Turnos ---------- */
function buildDatePicker() {
  const wrap = document.getElementById('datePicker');
  wrap.innerHTML = '';
  const dows = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'];
  const hoy = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'date-chip' + (state.fecha === iso ? ' is-selected' : '');
    chip.innerHTML = `<span class="dow">${dows[d.getDay()]}</span><span class="dnum">${d.getDate()}</span>`;
    chip.addEventListener('click', () => selectFecha(iso));
    wrap.appendChild(chip);
  }
}

async function selectFecha(iso) {
  state.fecha = iso;
  state.turno = null;
  document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('is-selected'));
  buildDatePicker(); // re-render para marcar selección
  const grid = document.getElementById('slotGrid');
  grid.innerHTML = '<div class="empty">Buscando turnos…</div>';
  try {
    const turnos = await apiGet(`/api/turnos?zona_id=${state.zona.id}&fecha=${iso}`);
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
        <span class="day mono">${iso}</span>
        <div class="range">${t.hora_inicio} – ${t.hora_fin}</div>
        <div class="cap">${full ? 'SIN CUPO' : (t.capacidad_maxima ? (t.capacidad_maxima - t.ocupados) + ' cupos' : 'cupo abierto')}</div>`;
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
   ARCHIVOS
   ========================================================= */
function readGlobalSettings() {
  return {
    copias: parseInt(document.getElementById('gCopias').value, 10) || 1,
    faz: document.querySelector('#gFaz button.is-on').dataset.value,
    acabado: document.querySelector('#gAcabado button.is-on').dataset.value,
    rango: '',
  };
}

const TAMANO_MAXIMO_BYTES = 50 * 1024 * 1024; // 50 MB — debe coincidir con functions/api/lib/r2.js

function addFiles(fileListObj) {
  const accepted = [], rejected = [], demasiadoGrandes = [];
  Array.from(fileListObj).forEach(f => {
    const tipoOk = f.type === 'application/pdf' || f.type.startsWith('image/');
    if (!tipoOk) { rejected.push(f); return; }
    if (f.size > TAMANO_MAXIMO_BYTES) { demasiadoGrandes.push(f); return; }
    accepted.push(f);
  });

  const alertEl = document.getElementById('rejectedAlert');
  const motivos = [];
  if (rejected.length) motivos.push(`${rejected.length === 1 ? 'este archivo no es válido' : 'estos archivos no son válidos'} (solo PDF e imágenes): ${rejected.map(f => f.name).join(', ')}`);
  if (demasiadoGrandes.length) motivos.push(`${demasiadoGrandes.length === 1 ? 'este archivo supera' : 'estos archivos superan'} los 50 MB: ${demasiadoGrandes.map(f => f.name).join(', ')}`);
  if (motivos.length) {
    alertEl.textContent = 'No pudimos cargar ' + motivos.join(' · ');
    alertEl.style.display = 'flex';
  } else {
    alertEl.style.display = 'none';
  }

  const g = readGlobalSettings();
  const newIds = [];
  accepted.forEach(f => {
    const id = 'f' + (++fileIdCounter);
    const isImage = f.type.startsWith('image/');
    const thumbUrl = isImage ? URL.createObjectURL(f) : null;
    files.set(id, {
      file: f, isImage, thumbUrl, numPages: 1, settings: { ...g },
      r2Key: null, subiendo: false, errorSubida: null,
    });
    newIds.push(id);
  });

  if (accepted.length) {
    document.getElementById('dzWrap').style.display = 'none';
    document.getElementById('loadedWrap').style.display = 'block';
    renderFileList();
    newIds.forEach(id => {
      const entry = files.get(id);
      if (!entry.isImage) readPdfMeta(id);
      subirArchivo(id);
    });
  }
  updateNavState();
}

async function subirArchivo(id) {
  const entry = files.get(id);
  if (!entry) return;
  entry.subiendo = true;
  entry.errorSubida = null;
  actualizarEstadoSubida(id);

  try {
    const qs = new URLSearchParams({ nombre: entry.file.name, sesion: state.sesionSubida });
    const res = await fetch('/api/archivos?' + qs.toString(), {
      method: 'POST',
      headers: { 'Content-Type': entry.file.type || 'application/octet-stream' },
      body: entry.file,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al subir el archivo.');
    }
    const data = await res.json();
    const current = files.get(id);
    if (!current) return; // se borró mientras subía
    current.r2Key = data.key;
    current.subiendo = false;
  } catch (err) {
    console.error('Error subiendo archivo:', err);
    const current = files.get(id);
    if (!current) return;
    current.subiendo = false;
    current.errorSubida = err.message || 'No se pudo subir. Probá de nuevo.';
  }
  actualizarEstadoSubida(id);
  updateNavState();
}

function actualizarEstadoSubida(id) {
  const el = document.getElementById('upload-' + id);
  if (!el) { renderFileList(); return; }
  const entry = files.get(id);
  if (!entry) return;
  el.innerHTML = estadoSubidaHtml(id, entry);
}

function estadoSubidaHtml(id, entry) {
  if (entry.subiendo) return `<span class="upload-status is-uploading">⟳ Subiendo…</span>`;
  if (entry.errorSubida) return `<span class="upload-status is-error">⚠ ${entry.errorSubida} <button type="button" class="btn btn-sm btn-outline" data-retry="${id}">Reintentar</button></span>`;
  if (entry.r2Key) return `<span class="upload-status is-ok">✓ Subido</span>`;
  return '';
}

async function readPdfMeta(id) {
  if (!window.pdfjsLib) return;
  const entry = files.get(id);
  if (!entry) return;
  try {
    const buffer = await entry.file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const scale = 128 / Math.max(viewport.width, viewport.height);
    const scaledViewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaledViewport }).promise;

    const current = files.get(id);
    if (!current) return;
    current.numPages = pdf.numPages;
    current.thumbUrl = canvas.toDataURL('image/png');
    renderFileList();
  } catch (err) {
    console.error('No se pudo leer el PDF:', err);
  }
}

function labelFaz(v) { return v === 'doble' ? 'Doble faz' : 'Simple faz'; }
function labelAcabado(v) {
  return { suelto: 'Suelto', abrochado: 'Abrochado', anillado: 'Anillado', clip: 'Clip' }[v] || 'Suelto';
}

function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = '';
  let i = 0;
  files.forEach((entry, id) => {
    i++;
    const calc = calcularArchivo(entry);
    const card = document.createElement('article');
    card.className = 'file-card';
    card.id = 'card-' + id;
    card.innerHTML = `
      <div class="file-card-head">
        <div class="file-thumb">${entry.thumbUrl ? `<img src="${entry.thumbUrl}" alt="">` : (entry.isImage ? '🖼️' : '📄')}</div>
        <div class="file-meta">
          <div class="idx">ARCHIVO ${i}/${files.size}${entry.isImage ? '' : ' · ' + entry.numPages + ' pág.'}</div>
          <div class="fname">${entry.file.name}</div>
          <div class="fsub">${entry.isImage ? 'IMAGEN' : 'PDF'} · ${(entry.file.size / 1024).toFixed(0)} KB</div>
          <div id="upload-${id}">${estadoSubidaHtml(id, entry)}</div>
        </div>
        <button type="button" class="file-remove" data-remove="${id}" aria-label="Quitar">✕</button>
      </div>
      <div class="form-grid">
        <div class="field">
          <label>Copias</label>
          <input class="input" type="number" min="1" value="${entry.settings.copias}" data-id="${id}" data-field="copias">
        </div>
        ${entry.isImage ? '' : `
        <div class="field">
          <label>Rango de páginas</label>
          <input class="input" type="text" placeholder="ej. 1-5,8" value="${entry.settings.rango || ''}" data-id="${id}" data-field="rango">
        </div>
        <div class="field">
          <label>Faz</label>
          <div class="segmented" data-id="${id}" data-field="faz">
            <button type="button" data-value="simple" class="${entry.settings.faz === 'simple' ? 'is-on' : ''}">Simple</button>
            <button type="button" data-value="doble" class="${entry.settings.faz === 'doble' ? 'is-on' : ''}">Doble</button>
          </div>
        </div>`}
        <div class="field span-2">
          <label>Acabado</label>
          <div class="segmented accent" data-id="${id}" data-field="acabado">
            <button type="button" data-value="suelto" class="${entry.settings.acabado === 'suelto' ? 'is-on' : ''}">Suelto</button>
            <button type="button" data-value="abrochado" class="${entry.settings.acabado === 'abrochado' ? 'is-on' : ''}">Abrochado</button>
            <button type="button" data-value="anillado" class="${entry.settings.acabado === 'anillado' ? 'is-on' : ''}">Anillado</button>
            <button type="button" data-value="clip" class="${entry.settings.acabado === 'clip' ? 'is-on' : ''}">Clip</button>
          </div>
        </div>
      </div>
      <div class="dim-line" id="dim-${id}">
        <span class="tickmark">⊢</span>
        <span>${calc.paginas} pág. × ${calc.copias} = ${calc.carillas} carillas</span>
        <span class="tickmark">⊣</span>
        <span class="result">${labelFaz(entry.settings.faz)} · ${labelAcabado(entry.settings.acabado)} <span class="amt">${money(calc.total)}</span></span>
      </div>
    `;
    list.appendChild(card);
  });

  // listeners
  list.querySelectorAll('input[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      const entry = files.get(el.dataset.id);
      const field = el.dataset.field;
      entry.settings[field] = field === 'copias' ? (parseInt(el.value, 10) || 1) : el.value;
      updateDim(el.dataset.id);
    });
  });
  list.querySelectorAll('.segmented[data-field]').forEach(group => {
    group.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      group.querySelectorAll('button').forEach(b => b.classList.remove('is-on'));
      btn.classList.add('is-on');
      files.get(group.dataset.id).settings[group.dataset.field] = btn.dataset.value;
      updateDim(group.dataset.id);
    });
  });
  list.querySelectorAll('[data-retry]').forEach(btn => {
    btn.addEventListener('click', () => subirArchivo(btn.dataset.retry));
  });
  list.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.remove;
      const entry = files.get(id);
      if (entry) {
        if (entry.isImage && entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
        // Si ya se había subido (o está subiendo) a staging, lo borramos de R2 también.
        if (entry.r2Key) {
          fetch('/api/archivos?key=' + encodeURIComponent(entry.r2Key), { method: 'DELETE' }).catch(() => {});
        }
      }
      files.delete(id);
      if (files.size === 0) {
        document.getElementById('dzWrap').style.display = 'block';
        document.getElementById('loadedWrap').style.display = 'none';
      } else {
        renderFileList();
      }
      updateNavState();
    });
  });

  updateNavState();
}

function updateDim(id) {
  const entry = files.get(id);
  const calc = calcularArchivo(entry);
  const el = document.getElementById('dim-' + id);
  if (el) {
    el.querySelector('span:nth-child(2)').textContent = `${calc.paginas} pág. × ${calc.copias} = ${calc.carillas} carillas`;
    el.querySelector('.result').innerHTML = `${labelFaz(entry.settings.faz)} · ${labelAcabado(entry.settings.acabado)} <span class="amt">${money(calc.total)}</span>`;
  }
  updateNavState();
}

// Los segmented de la configuración global (arriba de la lista de archivos) necesitan
// su propio listener para togglear is-on — son distintos de los de cada tarjeta.
document.querySelectorAll('#gAcabado, #gFaz').forEach(group => {
  group.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach(b => b.classList.remove('is-on'));
    btn.classList.add('is-on');
  });
});

document.getElementById('btnApplyAll').addEventListener('click', () => {
  const g = readGlobalSettings();
  files.forEach(entry => { entry.settings = { ...entry.settings, copias: g.copias, faz: g.faz, acabado: g.acabado }; });
  renderFileList();
});

/* Carga por dropzone + input "agregar más" */
const dropzone = document.getElementById('dropzone');
document.getElementById('fileInput').addEventListener('change', e => addFiles(e.target.files));
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
  document.getElementById('cDireccion').value = c.direccion || '';
}

document.getElementById('cDireccionDistinta').addEventListener('change', e => {
  state.direccionDistinta = e.target.checked;
  document.getElementById('wrapDireccionEntrega').style.display = e.target.checked ? 'flex' : 'none';
  document.getElementById('lblDireccion').textContent = e.target.checked ? 'Dirección (tu domicilio)' : 'Dirección';
  updateNavState();
});

// El botón "Continuar" depende de que el formulario esté completo — hay que
// revalidarlo en cada tecleo, no solo cuando se toca el checkbox de dirección.
document.getElementById('panel-4').addEventListener('input', updateNavState);

function readClienteForm() {
  return {
    nombre: document.getElementById('cNombre').value.trim(),
    apellido: document.getElementById('cApellido').value.trim(),
    documento_tipo: document.getElementById('cDocTipo').value,
    documento_numero: document.getElementById('cDocNumero').value.trim(),
    email: document.getElementById('cEmail').value.trim(),
    celular: document.getElementById('cCelular').value.trim(),
    direccion: document.getElementById('cDireccion').value.trim(),
  };
}

function clienteFormValido() {
  const c = readClienteForm();
  const base = c.nombre && c.apellido && c.documento_numero && c.direccion;
  if (!base) return false;
  if (state.direccionDistinta) {
    return !!document.getElementById('cDireccionEntrega').value.trim();
  }
  return true;
}

function direccionEntregaFinal() {
  const c = readClienteForm();
  return state.direccionDistinta
    ? document.getElementById('cDireccionEntrega').value.trim()
    : c.direccion;
}

/* =========================================================
   PASO 5 — resumen y pago
   ========================================================= */
function renderResumenFinal() {
  const body = document.getElementById('finalBody');
  body.innerHTML = '';
  files.forEach(entry => {
    const calc = calcularArchivo(entry);
    const row = document.createElement('div');
    row.className = 'receipt-row';
    row.innerHTML = `
      <div>
        <div class="name">${entry.file.name}</div>
        <div class="spec">${calc.carillas} carillas · ${labelFaz(entry.settings.faz)} · ${labelAcabado(entry.settings.acabado)}</div>
      </div>
      <div class="val">${money(calc.total)}</div>`;
    body.appendChild(row);
  });
  document.getElementById('finalCount').textContent = files.size + (files.size === 1 ? ' archivo' : ' archivos');
  document.getElementById('finalTotal').textContent = money(calcularTotalPedido());
}

document.getElementById('btnPagar').addEventListener('click', async () => {
  const btn = document.getElementById('btnPagar');
  const errEl = document.getElementById('payError');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Generando checkout…';

  try {
    const payload = {
      cliente: readClienteForm(),
      zona_id: state.zona.id,
      turno_entrega_id: state.turno.turno_entrega_id,
      fecha_entrega: state.fecha,
      direccion_entrega: direccionEntregaFinal(),
      archivos: [...files.values()].map(entry => ({
        nombre: entry.file.name,
        paginas: entry.isImage ? 1 : (entry.numPages || 1),
        copias: entry.settings.copias,
        rango: entry.isImage ? '' : (entry.settings.rango || ''),
        faz: entry.isImage ? 'simple' : entry.settings.faz,
        acabado: entry.settings.acabado,
        r2_key: entry.r2Key,
      })),
    };

    const { trabajo_id } = await apiPost('/api/trabajos', payload);
    const { init_point } = await apiPost('/api/checkout', { trabajo_id });

    localStorage.setItem(LS_CLIENTE, JSON.stringify(payload.cliente));
    state.trabajoIdPago = trabajo_id;

    // No redirigimos directo: en desktop es común no estar logueado en MP.
    // Mostramos QR (para pagar desde el celular) + link para seguir en la misma pestaña.
    document.getElementById('payQr').src =
      'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(init_point);
    document.getElementById('payLink').href = init_point;
    document.getElementById('payLaunch').style.display = 'block';
    btn.style.display = 'none';

    // Si se paga escaneando el QR con la app de Mercado Pago, el pago se completa
    // en el celular y esta pestaña de escritorio nunca recibe ningún back_url de vuelta
    // (no hay redirect posible entre dispositivos distintos). Por eso preguntamos
    // nosotros mismos, cada pocos segundos, si ya se acreditó.
    iniciarPollingPago(trabajo_id);
  } catch (err) {
    console.error(err);
    errEl.textContent = 'No pudimos generar el checkout. Intentá de nuevo en unos segundos.';
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
    case 1: return !!state.zona;
    case 2: return files.size > 0 && [...files.values()].every(e => e.r2Key && !e.subiendo && !e.errorSubida);
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

  const peek = document.getElementById('pricePeek');
  peek.textContent = files.size > 0 ? 'Total estimado: ' : '';
  if (files.size > 0) {
    peek.innerHTML = 'Estimado: <span class="amt">' + money(calcularTotalPedido()) + '</span>';
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
    buildDatePicker();
  }
  if (n === 4) prefillCliente();
  if (n === 5) renderResumenFinal();

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('btnNext').addEventListener('click', () => {
  if (!stepValido(state.step)) return;
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

// Polling de respaldo: cubre el caso de pago por QR (escaneado con la app de MP),
// donde nunca hay un back_url de vuelta a esta pestaña. Se corta solo al confirmar
// el pago, al fallar repetidamente, o después de 10 minutos para no dejarlo colgado.
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
      console.error('Error consultando estado del pago:', err); // se sigue reintentando solo
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
  if (mostrarResultadoSiCorresponde()) return; // no inicializamos el wizard en esta vista

  await loadProductos();
  await loadZonas();
  updateStepline();
  updateNavState();
})();
