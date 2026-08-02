
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
  activePhotoId: null, // id de la foto mostrada actualmente en el editor full-size del Paso 2
  checkoutConfirmado: false, // true una vez que /api/trabajos + /api/checkout responden OK — oculta "Atrás" para siempre en esta sesión
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

// Valores por defecto para una foto recién agregada. Ya no hay UI de
// "ajustes para todas las fotos" — cada foto se configura individualmente
// desde el editor (tamaño/copias en pe-specs-row, B&N en la barra de
// iconos), así que acá solo definimos con qué arranca antes de que el
// usuario la toque.
function valoresPorDefectoFoto() {
  return {
    copias: 1,
    tamano: (state.productos[0] || {}).codigo,
    byn: false,
  };
}

function setModoEditorFotos(activo) {
  document.documentElement.classList.toggle('is-photo-editor', activo);
  document.body.classList.toggle('is-photo-editor', activo);
}

function estadoEdicionInicial() {
  return {
    scale: 1,
    // panFracX/Y: desplazamiento como fracción del margen disponible
    // (currW-frameW)/2, rango [-1,1], 0=centrado. Independiente de resolución
    // a propósito: el mismo estado sirve para dibujar el preview a cualquier
    // tamaño de pantalla Y para exportar en base al tamaño natural de la
    // foto, sin que dependan una de la otra.
    panFracX: 0, panFracY: 0,
    rotated: false,   // gira el MARCO de recorte 90° (no la imagen) — ej. papel
                       // vertical con una foto horizontal adentro, o viceversa
    flipH: false,      // espejo horizontal de la imagen
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

// Relación de ancho/alto del marco de recorte para el tamaño elegido de una
// foto, considerando el flag "rotated" (invierte ancho/alto del producto).
function targetRatioDe(entry) {
  const dims = String(entry.settings.tamano).match(/^(\d+)x(\d+)/i);
  let ratio = dims ? (parseFloat(dims[1]) / parseFloat(dims[2])) : 1;
  if (entry.editState.rotated) ratio = 1 / ratio;
  return ratio;
}

// Dado un frame de ancho×alto (en cualquier unidad: px de pantalla o px
// naturales — la fórmula es la misma) y el estado de edición, devuelve el
// tamaño base de la imagen (la escala mínima que cubre el frame, "cover")
// más los límites de paneo en esa misma unidad.
function geometriaEncuadre(entry, frameW, frameH, natW, natH) {
  let baseW, baseH;
  if ((natW / natH) > (frameW / frameH)) { baseH = frameH; baseW = frameH * (natW / natH); }
  else { baseW = frameW; baseH = frameW / (natW / natH); }

  const st = entry.editState;
  const currW = baseW * st.scale, currH = baseH * st.scale;
  const maxPanX = Math.max(0, (currW - frameW) / 2);
  const maxPanY = Math.max(0, (currH - frameH) / 2);
  const panX = st.panFracX * maxPanX;
  const panY = st.panFracY * maxPanY;

  return { baseW, baseH, currW, currH, maxPanX, maxPanY, panX, panY };
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

  const g = valoresPorDefectoFoto();
  const newIds = [];
  accepted.forEach(f => {
    const id = 'f' + (++fileIdCounter);
    const thumbUrl = URL.createObjectURL(f);
    // Imagen cargada en memoria, independiente del <img> visible en el stage
    // (que solo existe para la foto activa) — permite exportar cualquier
    // foto (incluida una que no se esté viendo) al confirmar el Paso 2.
    const imgOffscreen = new Image();
    imgOffscreen.src = thumbUrl;
    const entry = {
      file: f, thumbUrl, imgOffscreen, naturalW: 0, naturalH: 0,
      thumbSmallUrl: null, // se completa async abajo — el filmstrip usa thumbUrl como fallback mientras tanto
      settings: { copias: g.copias, tamano: g.tamano },
      editState: { ...estadoEdicionInicial(), byn: g.byn },
      // La subida a R2 ya no ocurre por edición — se sube una única vez cuando
      // el usuario confirma el Paso 2 tocando "Continuar" (ver subirTodasLasFotos()).
      r2Key: null, subiendo: false, errorSubida: null,
    };
    files.set(id, entry);
    newIds.push(id);

    // El filmstrip no necesita la resolución completa — generamos una
    // versión reducida una sola vez (no depende del recorte/filtros, que
    // pueden cambiar después) para no forzar al navegador a decodificar y
    // reescalar el original en cada miniatura visible.
    imgOffscreen.addEventListener('load', () => {
      generarThumbnailPequeno(imgOffscreen).then(url => {
        if (!url || !files.has(id)) return;
        entry.thumbSmallUrl = url;
        if (peEls.filmstrip) renderFilmstrip();
      });
    }, { once: true });
  });

  if (accepted.length) {
    setModoEditorFotos(true);
    if (!state.activePhotoId || !files.has(state.activePhotoId)) {
      state.activePhotoId = newIds[0];
    }
    renderEditor();
  }
  updateNavState();
}

// Genera una versión reducida (máx. 160px en el lado más largo) de una
// imagen ya cargada, para usar como miniatura del filmstrip sin decodificar
// el archivo original a tamaño completo en cada una.
function generarThumbnailPequeno(imgEl, maxDim = 160) {
  return new Promise(resolve => {
    const natW = imgEl.naturalWidth, natH = imgEl.naturalHeight;
    if (!natW || !natH) return resolve(null);
    const scale = Math.min(1, maxDim / Math.max(natW, natH));
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, w, h);
    canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), 'image/jpeg', 0.72);
  });
}

// Exporta el recorte + ajustes actuales de una foto a un Blob JPEG. Usa el
// tamaño ORIGINAL de la imagen como referencia del encuadre (no el tamaño en
// pantalla) — así el resultado es siempre a la máxima resolución disponible
// de la foto, sea o no la que se está mostrando en el editor en ese momento.
function exportarFotoBlob(id) {
  return new Promise(resolve => {
    const entry = files.get(id);
    const img = entry && entry.imgOffscreen;
    if (!entry || !img || !img.naturalWidth) return resolve(null);

    const natW = img.naturalWidth, natH = img.naturalHeight;

    // El "frame" de referencia es el propio tamaño natural de la imagen,
    // recortado a la relación de aspecto del producto elegido (respetando
    // rotated). Como frameW×frameH y natW×natH comparten la misma escala de
    // base (ambos definidos en píxeles naturales), geometriaEncuadre() cubre
    // exactamente ese frame sin ningún factor de conversión con pantalla.
    const targetRatio = targetRatioDe(entry);
    let frameW, frameH;
    if (targetRatio > (natW / natH)) { frameW = natW; frameH = natW / targetRatio; }
    else { frameH = natH; frameW = natH * targetRatio; }

    const { baseW, baseH, panX, panY } = geometriaEncuadre(entry, frameW, frameH, natW, natH);
    const st = entry.editState;
    const scX = natW / (baseW * st.scale);
    const scY = natH / (baseH * st.scale);

    const srcX = (baseW * st.scale / 2 - frameW / 2 - panX) * scX;
    const srcY = (baseH * st.scale / 2 - frameH / 2 - panY) * scY;
    const srcW = frameW * scX, srcH = frameH * scY;

    // Tope de resolución de exportación: 300 DPI cubre incluso el tamaño más
    // grande del catálogo (20x25cm ≈ 2360x2950px), así que 3000px de lado
    // mayor es un techo generoso. Sin esto, una foto de cámara de 48MP se
    // exportaba y subía igual de "grande" que si fuera a imprimirse en un
    // póster — pesando varios MB más de lo necesario y haciendo mucho más
    // lento tanto el drawImage/filtro (que procesa por píxel de SALIDA, no
    // de entrada) como la subida por red.
    const MAX_EXPORT_DIM = 3000;
    let outW = Math.max(1, Math.round(srcW));
    let outH = Math.max(1, Math.round(srcH));
    if (Math.max(outW, outH) > MAX_EXPORT_DIM) {
      const factor = MAX_EXPORT_DIM / Math.max(outW, outH);
      outW = Math.max(1, Math.round(outW * factor));
      outH = Math.max(1, Math.round(outH * factor));
    }

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.filter = construirFiltroCss(st);

    if (st.flipH) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    // drawImage lee el recorte a resolución original (srcW/srcH) pero lo
    // dibuja ya reducido al tamaño final (canvas.width/height) — el
    // remuestreo queda a cargo del propio drawImage en un solo paso.
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

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
    throw err; // re-lanzamos para que el orquestador (subirTodasLasFotos) lleve la cuenta de errores
  } finally {
    actualizarEstadoSubida(id);
    updateNavState();
  }
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

/* ---------- Overlay de subida ---------- */
const overlayEl = document.getElementById('uploadOverlay');
const overlayTitle = document.getElementById('uploadOverlayTitle');
const overlaySub = document.getElementById('uploadOverlaySub');
const overlayFill = document.getElementById('uploadOverlayFill');
const overlayHint = document.getElementById('uploadOverlayHint');

function abrirOverlay(total) {
  overlayEl.classList.remove('has-error');
  overlayEl.classList.add('is-active');
  overlayEl.setAttribute('aria-hidden', 'false');
  overlayHint.textContent = 'No cierres ni recargues esta pantalla';
  actualizarOverlay(0, total, '');
  // Evita que se cierre/recargue la pestaña sin querer a mitad de una subida
  // que puede tardar (fotos grandes, muchas fotos, equipo lento) — perder el
  // progreso acá obligaría a re-procesar todo desde cero.
  window.addEventListener('beforeunload', prevenirCierreDurantesubida);
}

function cerrarOverlay() {
  overlayEl.classList.remove('is-active', 'has-error');
  overlayEl.setAttribute('aria-hidden', 'true');
  window.removeEventListener('beforeunload', prevenirCierreDurantesubida);
}

function actualizarOverlay(hechas, total, nombreActual) {
  overlayTitle.textContent = `Subiendo fotos ${hechas} de ${total}`;
  overlaySub.textContent = nombreActual ? `Procesando "${truncarNombre(nombreActual, 28)}"` : 'Preparando…';
  overlayFill.style.width = total ? Math.round((hechas / total) * 100) + '%' : '0%';
}

function prevenirCierreDurantesubida(e) {
  e.preventDefault();
  e.returnValue = '';
}

// Sube en tandas de a `concurrencia` para no saturar el navegador procesando
// varios canvas pesados a la vez (lo que además haría que el contador de
// progreso salte de golpe en vez de avanzar de forma legible).
async function subirConProgreso(ids, concurrencia = 3) {
  const total = ids.length;
  let hechas = 0;
  let huboError = false;
  const cola = [...ids];

  actualizarOverlay(0, total, files.get(cola[0])?.file.name);

  async function worker() {
    while (cola.length) {
      const id = cola.shift();
      const entry = files.get(id);
      actualizarOverlay(hechas, total, entry ? entry.file.name : '');
      try {
        await subirFotoEditada(id);
      } catch {
        huboError = true;
      }
      hechas++;
      actualizarOverlay(hechas, total, cola.length ? files.get(cola[0])?.file.name : '');
    }
  }

  const workers = Array.from({ length: Math.min(concurrencia, total) }, worker);
  await Promise.all(workers);
  return !huboError;
}

// Se llama al tocar "Continuar" en el Paso 2. Sube todas las fotos que todavía
// no tengan r2Key (nuevas o editadas desde la última subida). Muestra el
// overlay de progreso mientras dura, y lo deja abierto con detalle de error
// si algo falló, para que el usuario decida cómo seguir sin perder de vista
// que quedó algo pendiente.
async function subirTodasLasFotos() {
  const pendientes = [...files.entries()].filter(([, entry]) => !entry.r2Key).map(([id]) => id);
  if (!pendientes.length) return true;

  abrirOverlay(pendientes.length);
  // El export de cada foto (drawImage + filtro por canvas) es trabajo
  // sincrónico que bloquea el hilo principal — sin este yield, el navegador
  // nunca llega a pintar el fade-in del overlay antes de que arranque ese
  // trabajo, y la pantalla se siente "colgada" un instante justo después de
  // tocar Continuar. Un doble rAF espera a que el frame ya se haya pintado.
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const ok = await subirConProgreso(pendientes);

  if (ok) {
    cerrarOverlay();
    return true;
  }

  const conError = [...files.values()].filter(e => e.errorSubida).length;
  overlayEl.classList.add('has-error');
  overlayTitle.textContent = conError === 1 ? 'Una foto no se pudo subir' : `${conError} fotos no se pudieron subir`;
  overlaySub.textContent = 'Revisá cuál es en la lista, o reintentá todo de nuevo.';
  overlayHint.textContent = '';
  window.removeEventListener('beforeunload', prevenirCierreDurantesubida);
  return false;
}

document.getElementById('btnOverlayRevisar').addEventListener('click', () => {
  cerrarOverlay();
  const [idConError] = [...files.entries()].find(([, e]) => e.errorSubida) || [];
  if (idConError) irAFoto(idConError);
});
document.getElementById('btnOverlayReintentar').addEventListener('click', async () => {
  const conError = [...files.entries()].filter(([, e]) => e.errorSubida).map(([id]) => id);
  if (!conError.length) { cerrarOverlay(); return; }
  overlayEl.classList.remove('has-error');
  overlayHint.textContent = 'No cierres ni recargues esta pantalla';
  window.addEventListener('beforeunload', prevenirCierreDurantesubida);
  const ok = await subirConProgreso(conError);
  if (ok) {
    cerrarOverlay();
    updateNavState();
    // El usuario ya había tocado "Continuar" antes de este reintento — si
    // ahora quedó todo subido y sigue en el Paso 2, completamos la acción
    // que había pedido en vez de dejarlo varado con todo listo pero quieto.
    if (state.step === 2 && stepValido(2)) goToStep(3);
  } else {
    const restantes = [...files.values()].filter(e => e.errorSubida).length;
    overlayEl.classList.add('has-error');
    overlayTitle.textContent = restantes === 1 ? 'Una foto no se pudo subir' : `${restantes} fotos no se pudieron subir`;
    overlaySub.textContent = 'Revisá cuál es en la lista, o reintentá todo de nuevo.';
    overlayHint.textContent = '';
    window.removeEventListener('beforeunload', prevenirCierreDurantesubida);
  }
});

// Refleja el estado de subida de una foto tanto en su miniatura del
// filmstrip (badge) como, si es la foto que se está mostrando en ese
// momento, en el aviso de error debajo del editor.
function actualizarEstadoSubida(id) {
  const entry = files.get(id);
  if (!entry) return;

  if (peEls.filmstrip) {
    const ids = ordenFotos();
    const idx = ids.indexOf(id);
    const thumb = peEls.filmstrip.querySelectorAll('.pe-thumb')[idx];
    if (thumb) {
      const statusEl = thumb.querySelector('.pe-thumb-status');
      if (statusEl) statusEl.remove();
      let html = '';
      if (entry.subiendo) html = '<span class="pe-thumb-status is-pending">⟳</span>';
      else if (entry.errorSubida) html = '<span class="pe-thumb-status is-error">!</span>';
      if (html) thumb.insertAdjacentHTML('beforeend', html);
    }
  }

  const alertEl = document.getElementById('rejectedAlertEditor');
  if (alertEl && id === state.activePhotoId) {
    if (entry.errorSubida) {
      alertEl.textContent = entry.errorSubida;
      alertEl.style.display = 'flex';
    } else {
      alertEl.style.display = 'none';
    }
  }
}



/* =========================================================
   EDITOR FULL-SIZE — una foto a la vez, tipo editor de WhatsApp.
   renderEditor() dibuja/actualiza todo el bloque (barra de iconos, foto
   grande, zoom, specs, filmstrip) en función de state.activePhotoId.
   ========================================================= */

// Refs de nodos que no cambian (se resuelven una sola vez).
const peEls = {
  toolbar: null, img: null, container: null, movable: null,
  zoom: null, tamano: null, copias: null, price: null, cropLabelVal: null, filmstrip: null,
  adjustPanel: null, zoomPanel: null, tamanoPanel: null, copiasPanel: null,
  brightness: null, contrast: null, saturate: null,
  bynBtn: null, removeBtn: null, stage: null,
  applyAllRow: null, applyAllCheck: null, applyAllConfirm: null,
};
function resolvePeEls() {
  peEls.toolbar = document.getElementById('peToolbar');
  peEls.img = document.getElementById('peImg');
  peEls.container = document.getElementById('peCropContainer');
  peEls.movable = document.getElementById('peImageMovable');
  peEls.zoom = document.getElementById('peZoom');
  peEls.tamano = document.getElementById('peTamano');
  peEls.copias = document.getElementById('peCopias');
  peEls.price = document.getElementById('pePrice');
  peEls.cropLabelVal = document.getElementById('peCropLabelVal');
  peEls.filmstrip = document.getElementById('peFilmstrip');
  peEls.adjustPanel = document.getElementById('peAdjustPanel');
  peEls.zoomPanel = document.getElementById('peZoomPanel');
  peEls.tamanoPanel = document.getElementById('peTamanoPanel');
  peEls.copiasPanel = document.getElementById('peCopiasPanel');
  peEls.brightness = document.getElementById('peBrightness');
  peEls.contrast = document.getElementById('peContrast');
  peEls.saturate = document.getElementById('peSaturate');
  peEls.bynBtn = document.getElementById('peBynBtn');
  peEls.removeBtn = document.getElementById('peRemoveBtn');
  peEls.stage = document.getElementById('peStage');
  peEls.applyAllRow = document.getElementById('peApplyAllRow');
  peEls.applyAllCheck = document.getElementById('peApplyAllCheck');
  peEls.applyAllConfirm = document.getElementById('peApplyAllConfirm');
}

function ordenFotos() {
  return [...files.keys()];
}

function activeEntry() {
  return files.get(state.activePhotoId);
}

// Recalcula el layout del stage (marco + imagen) para la foto activa y
// vuelve a pintar el <img> visible. Se llama en resize, cambio de foto,
// cambio de tamaño/rotación, zoom y arrastre.
function actualizarStage() {
  const entry = activeEntry();
  if (!entry || !peEls.stage) return;

  const availW = peEls.stage.clientWidth - 20;
  const availH = peEls.stage.clientHeight - 20;
  if (availW <= 0 || availH <= 0) return;

  const targetRatio = targetRatioDe(entry);
  let frameW, frameH;
  if (targetRatio > (availW / availH)) { frameW = availW; frameH = availW / targetRatio; }
  else { frameH = availH; frameW = availH * targetRatio; }

  peEls.container.style.width = `${frameW}px`;
  peEls.container.style.height = `${frameH}px`;

  const natW = peEls.img.naturalWidth, natH = peEls.img.naturalHeight;
  if (!natW) return;

  const { baseW, baseH, maxPanX, maxPanY, panX, panY } = geometriaEncuadre(entry, frameW, frameH, natW, natH);

  // Clampeamos la fracción guardada (por si cambió el tamaño/rotación y el
  // pan anterior ya no entra en el nuevo margen disponible).
  const st = entry.editState;
  if (maxPanX === 0) st.panFracX = 0; else st.panFracX = Math.max(-1, Math.min(1, panX / maxPanX));
  if (maxPanY === 0) st.panFracY = 0; else st.panFracY = Math.max(-1, Math.min(1, panY / maxPanY));

  const flip = st.flipH ? -1 : 1;
  peEls.movable.style.width = `${baseW}px`;
  peEls.movable.style.height = `${baseH}px`;
  peEls.movable.style.transform =
    `translate(calc(-50% + ${panX}px), calc(-50% + ${panY}px)) scale(${st.scale * flip}, ${st.scale})`;

  peEls.img.style.filter = construirFiltroCss(st);
}

function actualizarSpecsRow() {
  const entry = activeEntry();
  if (!entry) return;
  peEls.tamano.querySelectorAll('button').forEach(b => {
    b.classList.toggle('is-on', b.dataset.value === entry.settings.tamano);
  });
  peEls.copias.value = entry.settings.copias;
  const calc = calcularFoto(entry);
  peEls.price.textContent = money(calc.total);
  const producto = productoPorCodigo(entry.settings.tamano);
  peEls.cropLabelVal.textContent = producto ? labelTamano(producto) : entry.settings.tamano;
  peEls.zoom.value = entry.editState.scale;
  peEls.brightness.value = entry.editState.brightness;
  peEls.contrast.value = entry.editState.contrast;
  peEls.saturate.value = entry.editState.saturate;
  peEls.saturate.disabled = entry.editState.byn;
  peEls.bynBtn.classList.toggle('is-on', entry.editState.byn);
}

function renderFilmstrip() {
  const ids = ordenFotos();
  peEls.filmstrip.innerHTML = '';
  ids.forEach(id => {
    const entry = files.get(id);
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'pe-thumb' + (id === state.activePhotoId ? ' is-active' : '');
    let statusHtml = '';
    if (entry.subiendo) statusHtml = '<span class="pe-thumb-status is-pending">⟳</span>';
    else if (entry.errorSubida) statusHtml = '<span class="pe-thumb-status is-error">!</span>';
    thumb.innerHTML = `<img src="${entry.thumbSmallUrl || entry.thumbUrl}" alt="">${statusHtml}`;
    thumb.addEventListener('click', () => irAFoto(id));
    peEls.filmstrip.appendChild(thumb);
  });
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'pe-thumb-add';
  addBtn.title = 'Agregar más fotos';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => document.getElementById('fileInputMore').click());
  peEls.filmstrip.appendChild(addBtn);

  const activeThumb = peEls.filmstrip.querySelector('.pe-thumb.is-active');
  if (activeThumb) activeThumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

function irAFoto(id) {
  if (!files.has(id)) return;
  state.activePhotoId = id;
  cerrarTodosLosDropdowns();
  renderEditor();
}

// Punto de entrada: (re)dibuja todo el editor para la foto activa. Se llama
// al agregar/quitar fotos, cambiar de foto, o tras cualquier edición.
function renderEditor() {
  if (!peEls.toolbar) resolvePeEls();
  const entry = activeEntry();
  if (!entry) return;

  peEls.img.src = entry.thumbUrl;
  const pintar = () => { actualizarStage(); };
  if (peEls.img.complete && peEls.img.naturalWidth) pintar();
  peEls.img.onload = pintar;

  actualizarSpecsRow();
  renderFilmstrip();
  renderTamanoOptionsInto(peEls.tamano, entry.settings.tamano);
  updateNavState();
}

function renderTamanoOptionsInto(container, selectedCodigo) {
  container.innerHTML = state.productos.map(p =>
    `<button type="button" data-value="${p.codigo}" class="${p.codigo === selectedCodigo ? 'is-on' : ''}">${labelTamano(p)}</button>`
  ).join('');
}

/* ---------- interacción: arrastre del encuadre (mouse + touch) ---------- */
(function initStageDrag() {
  let isDown = false, sX, sY, iFracX, iFracY, frameW, frameH, maxPanX, maxPanY;

  function onDown(x, y) {
    const entry = activeEntry();
    if (!entry) return;
    isDown = true; sX = x; sY = y;
    iFracX = entry.editState.panFracX; iFracY = entry.editState.panFracY;
    frameW = peEls.container.clientWidth; frameH = peEls.container.clientHeight;
    const natW = peEls.img.naturalWidth, natH = peEls.img.naturalHeight;
    const g = geometriaEncuadre(entry, frameW, frameH, natW, natH);
    maxPanX = g.maxPanX; maxPanY = g.maxPanY;
  }
  function onMove(x, y) {
    if (!isDown) return;
    const entry = activeEntry();
    if (!entry) return;
    const dx = x - sX, dy = y - sY;
    const flip = entry.editState.flipH ? -1 : 1;
    entry.editState.panFracX = maxPanX ? Math.max(-1, Math.min(1, iFracX + (dx * flip) / maxPanX)) : 0;
    entry.editState.panFracY = maxPanY ? Math.max(-1, Math.min(1, iFracY + dy / maxPanY)) : 0;
    actualizarStage();
  }
  function onUp() {
    if (!isDown) return;
    isDown = false;
    if (state.activePhotoId) marcarPendienteDeSubir(state.activePhotoId);
  }

  document.getElementById('peCropContainer').addEventListener('mousedown', e => onDown(e.clientX, e.clientY));
  window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', onUp);

  // ---------- gestos táctiles: un dedo arrastra, dos dedos hacen zoom (pellizco) ----------
  let isPinching = false, pinchStartDist = 0, pinchStartScale = 1;
  function distanciaEntreDedos(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  document.getElementById('peCropContainer').addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isPinching = false;
      onDown(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      isDown = false; // dos dedos: dejamos de considerar esto un arrastre de un dedo
      const entry = activeEntry();
      if (!entry) return;
      isPinching = true;
      pinchStartDist = distanciaEntreDedos(e.touches);
      pinchStartScale = entry.editState.scale;
    }
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    if (isPinching && e.touches.length === 2) {
      e.preventDefault();
      const entry = activeEntry();
      if (!entry || !pinchStartDist) return;
      const distActual = distanciaEntreDedos(e.touches);
      const factor = distActual / pinchStartDist;
      const nuevaEscala = Math.max(1, Math.min(3, pinchStartScale * factor));
      entry.editState.scale = nuevaEscala;
      peEls.zoom.value = nuevaEscala;
      actualizarStage();
    } else if (isDown && e.touches.length === 1) {
      e.preventDefault();
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  window.addEventListener('touchend', e => {
    if (isPinching && e.touches.length < 2) {
      isPinching = false;
      if (state.activePhotoId) marcarPendienteDeSubir(state.activePhotoId);
    }
    onUp();
  });

  new ResizeObserver(() => actualizarStage()).observe(document.getElementById('peStage'));
})();

/* ---------- barra de iconos ---------- */
// Los 4 paneles flotantes (ajustes, zoom, tamaño, copias) se abren de a
// uno — abrir uno cierra cualquier otro que estuviera abierto.
function togglePeDropdown(nombre) {
  const panel = { adjust: peEls.adjustPanel, zoom: peEls.zoomPanel, tamano: peEls.tamanoPanel, copias: peEls.copiasPanel }[nombre];
  if (!panel) return;
  const yaAbierto = panel.classList.contains('is-open');
  cerrarTodosLosDropdowns();
  if (!yaAbierto) panel.classList.add('is-open');
}
function cerrarTodosLosDropdowns() {
  [peEls.adjustPanel, peEls.zoomPanel, peEls.tamanoPanel, peEls.copiasPanel].forEach(p => p && p.classList.remove('is-open'));
  // El check de "aplicar a todas" no debería quedar marcado de una vista a
  // otra — cada vez que el panel se cierra, arranca limpio la próxima vez.
  if (peEls.applyAllCheck) peEls.applyAllCheck.checked = false;
  if (peEls.applyAllRow) peEls.applyAllRow.classList.remove('is-checked');
}

document.getElementById('peToolbar').addEventListener('click', e => {
  const btn = e.target.closest('.pe-icon-btn');
  if (!btn) return;
  const entry = activeEntry();
  if (!entry) return;
  const action = btn.dataset.action;

  if (action === 'rotate') {
    entry.editState.rotated = !entry.editState.rotated;
    actualizarStage();
    marcarPendienteDeSubir(state.activePhotoId);
  } else if (action === 'flip-h') {
    entry.editState.flipH = !entry.editState.flipH;
    actualizarStage();
    marcarPendienteDeSubir(state.activePhotoId);
  } else if (action === 'byn') {
    entry.editState.byn = !entry.editState.byn;
    peEls.saturate.disabled = entry.editState.byn;
    peEls.bynBtn.classList.toggle('is-on', entry.editState.byn);
    actualizarStage();
    marcarPendienteDeSubir(state.activePhotoId);
  } else if (action === 'adjust' || action === 'zoom' || action === 'tamano' || action === 'copias') {
    togglePeDropdown(action);
  }
});

// Tocar la foto (fuera de un arrastre) cierra cualquier panel abierto —
// el usuario está claramente volviendo a mirar/editar el encuadre.
document.getElementById('peCropContainer').addEventListener('pointerdown', () => cerrarTodosLosDropdowns());

document.getElementById('peRemoveBtn').addEventListener('click', () => {
  const id = state.activePhotoId;
  const entry = files.get(id);
  if (!entry) return;
  if (entry.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
  if (entry.thumbSmallUrl) URL.revokeObjectURL(entry.thumbSmallUrl);
  if (entry.r2Key) fetch('/api/archivos?key=' + encodeURIComponent(entry.r2Key), { method: 'DELETE' }).catch(() => {});
  files.delete(id);

  if (files.size === 0) {
    setModoEditorFotos(false);
    state.activePhotoId = null;
  } else {
    const ids = ordenFotos();
    state.activePhotoId = ids[0];
    cerrarTodosLosDropdowns();
    renderEditor();
  }
  updateNavState();
});

/* ---------- zoom ---------- */
document.getElementById('peZoom').addEventListener('input', e => {
  const entry = activeEntry();
  if (!entry) return;
  entry.editState.scale = parseFloat(e.target.value);
  actualizarStage();
  marcarPendienteDeSubir(state.activePhotoId);
});
document.querySelector('.pe-zoom-row [data-action="zoom-in"]').addEventListener('click', () => {
  const entry = activeEntry();
  if (!entry) return;
  entry.editState.scale = Math.min(3, entry.editState.scale + 0.1);
  peEls.zoom.value = entry.editState.scale;
  actualizarStage();
  marcarPendienteDeSubir(state.activePhotoId);
});
document.querySelector('.pe-zoom-row [data-action="zoom-out"]').addEventListener('click', () => {
  const entry = activeEntry();
  if (!entry) return;
  entry.editState.scale = Math.max(1, entry.editState.scale - 0.1);
  peEls.zoom.value = entry.editState.scale;
  actualizarStage();
  marcarPendienteDeSubir(state.activePhotoId);
});

/* ---------- panel de ajustes finos ---------- */
['peBrightness', 'peContrast', 'peSaturate'].forEach(elId => {
  document.getElementById(elId).addEventListener('input', e => {
    const entry = activeEntry();
    if (!entry) return;
    const key = elId === 'peBrightness' ? 'brightness' : elId === 'peContrast' ? 'contrast' : 'saturate';
    entry.editState[key] = parseFloat(e.target.value);
    peEls.img.style.filter = construirFiltroCss(entry.editState);
    marcarPendienteDeSubir(state.activePhotoId);
  });
});

/* ---------- tamaño / copias de la foto activa ---------- */
document.getElementById('peTamano').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const entry = activeEntry();
  if (!entry) return;
  entry.settings.tamano = btn.dataset.value;
  entry.editState.scale = 1; entry.editState.panFracX = 0; entry.editState.panFracY = 0;
  actualizarStage();
  actualizarSpecsRow();
  renderFilmstrip();
  marcarPendienteDeSubir(state.activePhotoId);
});

document.getElementById('peApplyAllCheck').addEventListener('change', e => {
  peEls.applyAllRow.classList.toggle('is-checked', e.target.checked);
});
document.getElementById('peApplyAllConfirm').addEventListener('click', () => {
  const activo = peEls.tamano.querySelector('button.is-on');
  if (!activo) return;
  const tamano = activo.dataset.value;
  files.forEach(entry => {
    entry.settings.tamano = tamano;
    // El encuadre depende de la relación de aspecto del tamaño — al cambiar
    // el tamaño de una foto que no es la activa, reseteamos su zoom/paneo
    // igual que se hace con la foto activa en el cambio individual de arriba.
    entry.editState.scale = 1; entry.editState.panFracX = 0; entry.editState.panFracY = 0;
    entry.r2Key = null; entry.errorSubida = null; entry.subiendo = false; // vuelven a "pendiente" para todas
  });
  actualizarStage();
  actualizarSpecsRow();
  renderFilmstrip();
  cerrarTodosLosDropdowns();
  updateNavState();
});

document.getElementById('peCopias').addEventListener('input', e => {
  const entry = activeEntry();
  if (!entry) return;
  entry.settings.copias = Math.max(1, parseInt(e.target.value, 10) || 1);
  actualizarSpecsRow();
  updateNavState();
});

function ajustarCopias(delta) {
  const entry = activeEntry();
  if (!entry) return;
  entry.settings.copias = Math.max(1, entry.settings.copias + delta);
  actualizarSpecsRow(); // refresca el valor mostrado en el input
  updateNavState();
}
document.querySelector('.pe-stepper [data-action="copias-out"]').addEventListener('click', () => ajustarCopias(-1));
document.querySelector('.pe-stepper [data-action="copias-in"]').addEventListener('click', () => ajustarCopias(1));

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

    // El pedido y el checkout ya existen del lado del servidor — volver
    // "atrás" a editar pasos previos ya no tiene sentido en este punto.
    state.checkoutConfirmado = true;
    updateNavState();

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
  document.getElementById('btnBack').style.visibility = (state.step === 1 || state.checkoutConfirmado) ? 'hidden' : 'visible';
  const btnNext = document.getElementById('btnNext');
  const isLast = state.step === 5;
  btnNext.style.display = isLast ? 'none' : 'inline-flex';
  btnNext.disabled = !stepValido(state.step);

  // "OK" reemplaza a la flecha únicamente dentro del editor de fotos (Paso 2
  // con fotos cargadas) — se controla acá explícitamente en vez de dejarlo
  // solo en manos de la cascada CSS (body.is-photo-editor), para blindar
  // contra cualquier desajuste de orden/timing con setModoEditorFotos().
  const enEditorDeFotos = state.step === 2 && files.size > 0;
  const navArrow = btnNext.querySelector('.nav-arrow');
  const navOk = btnNext.querySelector('.nav-ok');
  if (navArrow) navArrow.style.display = enEditorDeFotos ? 'none' : '';
  if (navOk) navOk.style.display = enEditorDeFotos ? 'inline-flex' : 'none';

  // Atrás/Continuar quedan solo con la flecha (sin texto) en el editor de
  // fotos y también en los Pasos 3 y 4 — el resto de los pasos conserva el
  // texto completo.
  const soloFlecha = enEditorDeFotos || state.step === 3 || state.step === 4;
  document.querySelectorAll('.wizard-nav .nav-label').forEach(el => {
    el.style.display = soloFlecha ? 'none' : '';
  });

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

  // El modo "editor full-size" (chrome compacto, sin stepline/título) sólo
  // aplica mientras se está en el Paso 2 con fotos cargadas — en cualquier
  // otro paso el wizard vuelve a verse con su nav completa normal.
  setModoEditorFotos(n === 2 && files.size > 0);

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
    const ok = await subirTodasLasFotos();
    btnNext.disabled = !stepValido(state.step);
    if (!ok) return; // el overlay queda abierto mostrando el error; la tarjeta con problema también lo señala
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


/* ---------------------------------------------------------
   SHARE TARGET — recibir archivos compartidos desde el hub
   --------------------------------------------------------- */
const SHARE_CACHE = 'share-target-temp';

// addFiles() calcula el precio usando state.productos (cargado por
// loadProductos() dentro de init(), en paralelo). Si se llama a addFiles
// antes de que ese fetch termine, el precio sale $0 porque no hay catálogo
// todavía. Esperamos acá a que esté listo, con un límite por las dudas de
// que el fetch falle y nunca resuelva.
async function esperarProductos(maxEsperaMs = 8000) {
  const inicio = Date.now();
  while (state.productos.length === 0 && Date.now() - inicio < maxEsperaMs) {
    await new Promise(r => setTimeout(r, 50));
  }
}

// addFiles() activa setModoEditorFotos(true) sin importar el paso actual —
// con carga manual nunca pasa porque solo se puede agregar una foto estando
// ya en el Paso 2. Acá las fotos pueden llegar con el usuario todavía en el
// Paso 1 (eligiendo zona), así que las dejamos en espera y las soltamos
// recién cuando efectivamente entra al Paso 2 — enganchando goToStep sin
// tocar su implementación original.
let pendingSharedFiles = null;

const _goToStepOriginal = goToStep;
goToStep = function (n) {
  _goToStepOriginal(n);
  if (n === 2 && pendingSharedFiles) {
    const f = pendingSharedFiles;
    pendingSharedFiles = null;
    addFiles(f);
  }
};

async function loadSharedFilesIfAny() {
  const params = new URLSearchParams(location.search);
  if (params.get('share-target') !== '1') return;
  if (!('caches' in window)) return;
  
  const cache = await caches.open(SHARE_CACHE);
  const indexRes = await cache.match('/shared-files-index');
  if (!indexRes) return;
  
  const shared = await indexRes.json();
  const entries = shared.files || [];
  const files = [];
  
  for (const item of entries) {
    const res = await cache.match(item.key);
    if (!res) continue;
    const blob = await res.blob();
    files.push(new File([blob], item.name, {
      type: item.type,
      lastModified: item.lastModified,
    }));
  }
  
  // Limpiamos el cache temporal una sola vez que ya los tenemos en memoria.
  await caches.delete(SHARE_CACHE);
  
  if (files.length === 0) return;
  
  // Sacamos el query param de la URL para no volver a disparar esto si el
  // usuario refresca la página.
  const url = new URL(location.href);
  url.searchParams.delete('share-target');
  history.replaceState(null, '', url.toString());
  
  await esperarProductos();

  // Si por algún motivo ya estamos en el Paso 2 (poco probable en un
  // arranque fresco, pero por las dudas), disparamos directo. Si no, queda
  // en espera hasta que goToStep(2) lo suelte.
  if (state.step === 2) {
    handleIncomingFiles(files);
  } else {
    pendingSharedFiles = files;
  }
}

function handleIncomingFiles(files) {
  addFiles(files);
}

window.addEventListener('load', loadSharedFilesIfAny);