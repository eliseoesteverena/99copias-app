// entrega.js — paso "Entrega" (zona/punto + turno fusionados), compartido
// por impresion-rapida/ y fotos/. Antes eran dos pasos separados (Paso 1
// Zona/Dirección y Paso 3 Turno) con su lógica metida adentro de cada
// app.js; la sección 5 de HANDOFF_AUTENTICACION_Y_FLUJO.md los fusiona en
// uno. Se centraliza acá en vez de duplicar la lógica en los dos app.js —
// mismo criterio que nav.js/auth-client.js.
//
// [Rediseño de estados de selección] Un solo lenguaje visual para
// zona/fecha/turno/"todos los turnos": sin seleccionar = borde fino;
// seleccionado = borde grueso + tinte sutil + check en la esquina — ver
// entrega.css. Sin amarillo ni rojo (no forman parte del sistema de
// estados) — sólo --ink/--paper, la misma escala que ya usa el resto del
// sitio. Las tabs Envío/Retiro (decisión primaria) usan subrayado; el
// toggle Por-zona/Todos (una preferencia de vista, menor jerarquía) usa un
// contorno más liviano — a propósito distintos entre sí, para que la
// jerarquía de importancia también se note a simple vista.
//
// Uso (ver impresion-rapida/app.js y fotos/app.js para el caso real):
//
//   const entrega = createEntregaStep({
//     mount: document.getElementById('entregaMount'),
//     categoria: CATEGORIA,
//     carillasProvider: () => calcularTotalCarillas(),
//     onValidChange: (valido) => updateNavState(),
//   });
//   entrega.activar();                                   // al entrar al paso
//   entrega.setUltimaEntrega({ zona_id, turno_entrega_id }); // Caso C, opcional
//   entrega.esValido();
//   entrega.getResultado(); // { zona, fecha, turno, direccion } | null

function createEntregaStep({ mount, categoria, carillasProvider, onValidChange }) {
  const LS_ZONA_ID = 'wizard.entrega.zonaId';
  const VENTANA_DIAS_INICIAL = 7;

  const state = {
    tab: 'envio', // 'envio' | 'retiro'
    vista: 'zona', // 'zona' | 'todos'
    zonasPorTipo: { envio: null, retiro: null }, // null = todavía no cargado
    zona: null,
    fecha: null,
    turno: null,
    diasConTurno: null,
    ventanaTodos: VENTANA_DIAS_INICIAL,
    ultimaEntregaPendiente: null, // { zona_id, turno_entrega_id } de /api/mi-perfil, aplicado apenas se puede
    activado: false,
  };

  async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Error de red (' + res.status + ')');
    return res.json();
  }

  function money(n) {
    n = Number(n);
    if (!Number.isFinite(n)) n = 0;
    return '$' + Math.round(n).toLocaleString('es-AR');
  }

  // Mueve suavemente la sección recién revelada a la vista — evita que el
  // cliente tenga que ir a buscarla scrolleando a mano cada vez que aparece
  // un paso nuevo (zona -> turno -> dirección). Respeta prefers-reduced-motion.
  function scrollIntoViewSoon(selector) {
    requestAnimationFrame(() => {
      const el = mount.querySelector(selector);
      if (!el) return;
      const prefiereMenosMovimiento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: prefiereMenosMovimiento ? 'auto' : 'smooth', block: 'start' });
    });
  }

  function esValido() {
    if (!state.zona || !state.fecha || !state.turno) return false;
    if (!state.zona.es_retiro) {
      const el = mount.querySelector('#entregaDireccion');
      if (!el || !el.value.trim()) return false;
    }
    return true;
  }

  function direccionFinal() {
    if (state.zona && state.zona.es_retiro) return 'Retiro en local';
    const el = mount.querySelector('#entregaDireccion');
    return el ? el.value.trim() : '';
  }

  function getResultado() {
    if (!esValido()) return null;
    return { zona: state.zona, fecha: state.fecha, turno: state.turno, direccion: direccionFinal() };
  }

  function notificarValidez() {
    if (typeof onValidChange === 'function') onValidChange(esValido());
  }

  function render() {
    mount.innerHTML = `
      <div class="ent-tabs" id="entregaTabs" role="tablist">
        <button type="button" data-tab="envio" class="${state.tab === 'envio' ? 'is-on' : ''}" role="tab">Envío a domicilio</button>
        <button type="button" data-tab="retiro" class="${state.tab === 'retiro' ? 'is-on' : ''}" role="tab">Retiro</button>
      </div>
      <div class="ent-toggle" id="entregaToggle">
        <button type="button" data-vista="zona" class="${state.vista === 'zona' ? 'is-on' : ''}">Por zona/punto</button>
        <button type="button" data-vista="todos" class="${state.vista === 'todos' ? 'is-on' : ''}">Todos los turnos</button>
      </div>
      <div class="alert alert-error" id="entregaAlert" hidden></div>

      <div class="entrega-vista-zona" id="entregaVistaZona" ${state.vista === 'zona' ? '' : 'hidden'}>
        <div class="ent-summary" id="entregaZonaSummary" hidden>
          <div><span class="ent-summary-label">Zona/punto</span><div class="ent-summary-value" id="entregaZonaSummaryValue"></div></div>
          <button type="button" class="btn btn-sm btn-ghost" id="entregaZonaCambiar">Cambiar</button>
        </div>
        <div class="ent-opt-list" id="entregaZonaGrid"><div class="empty">Cargando…</div></div>

        <div class="entrega-turno-block" id="entregaTurnoBlock" hidden>
          <div class="ent-summary" id="entregaFechaSummary" hidden>
            <div><span class="ent-summary-label">Día</span><div class="ent-summary-value" id="entregaFechaSummaryValue"></div></div>
            <button type="button" class="btn btn-sm btn-ghost" id="entregaFechaCambiar">Cambiar</button>
          </div>
          <p class="ent-subhead" id="entregaFechaSubhead">Elegí el día</p>
          <div class="ent-opt-row" id="entregaDatePicker"></div>

          <div class="ent-summary" id="entregaSlotSummary" hidden>
            <div><span class="ent-summary-label">Horario</span><div class="ent-summary-value" id="entregaSlotSummaryValue"></div></div>
            <button type="button" class="btn btn-sm btn-ghost" id="entregaSlotCambiar">Cambiar</button>
          </div>
          <p class="ent-subhead" id="entregaSlotSubhead" hidden>Elegí el horario</p>
          <div class="ent-opt-row" id="entregaSlotGrid"></div>
        </div>
        <div class="field entrega-direccion" id="entregaDireccionWrap" hidden>
          <label for="entregaDireccion">Dirección de entrega</label>
          <input class="input" type="text" id="entregaDireccion" placeholder="Calle, número, piso/depto">
        </div>
      </div>

      <div class="entrega-vista-todos" id="entregaVistaTodos" ${state.vista === 'todos' ? '' : 'hidden'}>
        <div class="entrega-todos-list" id="entregaTodosList"><div class="empty">Cargando…</div></div>
        <button type="button" class="btn btn-outline btn-sm" id="entregaVerMas">Ver más fechas</button>
      </div>
    `;

    mount.querySelectorAll('#entregaTabs button').forEach((btn) => {
      btn.addEventListener('click', () => cambiarTab(btn.dataset.tab));
    });
    mount.querySelectorAll('#entregaToggle button').forEach((btn) => {
      btn.addEventListener('click', () => cambiarVista(btn.dataset.vista));
    });
    mount.querySelector('#entregaZonaCambiar')?.addEventListener('click', expandirZona);
    mount.querySelector('#entregaFechaCambiar')?.addEventListener('click', expandirFecha);
    mount.querySelector('#entregaSlotCambiar')?.addEventListener('click', expandirSlot);
    mount.querySelector('#entregaDireccion')?.addEventListener('input', notificarValidez);
    mount.querySelector('#entregaVerMas')?.addEventListener('click', () => {
      state.ventanaTodos += VENTANA_DIAS_INICIAL;
      cargarVistaTodos();
    });
  }

  function mostrarError(msg) {
    const el = mount.querySelector('#entregaAlert');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  async function cambiarTab(tab) {
    if (state.tab === tab) return;
    state.tab = tab;
    state.zona = null;
    state.fecha = null;
    state.turno = null;
    mount.querySelectorAll('#entregaTabs button').forEach((b) => b.classList.toggle('is-on', b.dataset.tab === tab));
    const turnoBlock = mount.querySelector('#entregaTurnoBlock');
    if (turnoBlock) turnoBlock.hidden = true;
    const direccionWrap = mount.querySelector('#entregaDireccionWrap');
    if (direccionWrap) direccionWrap.hidden = true;
    // Volver a expandir todo lo que pudiera haber quedado colapsado de la
    // zona/tab anterior (secciones tipo "details" — ver colapsar*/expandir*).
    ['Zona', 'Fecha', 'Slot'].forEach((seccion) => {
      const summary = mount.querySelector('#entrega' + seccion + 'Summary');
      if (summary) summary.hidden = true;
    });
    const grid = mount.querySelector('#entregaZonaGrid');
    if (grid) grid.hidden = false;
    const fechaSubhead = mount.querySelector('#entregaFechaSubhead');
    if (fechaSubhead) fechaSubhead.hidden = false;
    const datePicker = mount.querySelector('#entregaDatePicker');
    if (datePicker) datePicker.hidden = false;
    const slotGrid = mount.querySelector('#entregaSlotGrid');
    if (slotGrid) slotGrid.hidden = false;
    const slotSubhead = mount.querySelector('#entregaSlotSubhead');
    if (slotSubhead) slotSubhead.hidden = true;
    notificarValidez();
    if (state.vista === 'zona') await cargarZonasDeLaTab();
    else await cargarVistaTodos();
  }

  function cambiarVista(vista) {
    if (state.vista === vista) return;
    state.vista = vista;
    mount.querySelectorAll('#entregaToggle button').forEach((b) => b.classList.toggle('is-on', b.dataset.vista === vista));
    mount.querySelector('#entregaVistaZona').hidden = vista !== 'zona';
    mount.querySelector('#entregaVistaTodos').hidden = vista !== 'todos';
    if (vista === 'todos') cargarVistaTodos();
  }

  // ---------------------------------------------------------------
  // Colapso tipo <details> de cada sub-sección (zona -> día -> horario):
  // apenas se elige algo, esa lista se reemplaza por un resumen de una
  // línea + "Cambiar", y el foco pasa a la siguiente. "Cambiar" reabre la
  // lista Y invalida todo lo que dependía de esa elección (igual que
  // cambiarTab). Esto, sumado al auto-scroll, evita tener las tres listas
  // completas abiertas a la vez en una pantalla chica.
  // ---------------------------------------------------------------
  function colapsarZona(z) {
    const envioLabel = z.es_retiro ? 'Sin costo' : money(z.precio_envio);
    const valueEl = mount.querySelector('#entregaZonaSummaryValue');
    if (valueEl) valueEl.textContent = `${z.nombre} · Envío: ${envioLabel}`;
    const summary = mount.querySelector('#entregaZonaSummary');
    const grid = mount.querySelector('#entregaZonaGrid');
    if (summary) summary.hidden = false;
    if (grid) grid.hidden = true;
  }
  function expandirZona() {
    const summary = mount.querySelector('#entregaZonaSummary');
    const grid = mount.querySelector('#entregaZonaGrid');
    if (summary) summary.hidden = true;
    if (grid) grid.hidden = false;
    state.zona = null;
    state.fecha = null;
    state.turno = null;
    const turnoBlock = mount.querySelector('#entregaTurnoBlock');
    if (turnoBlock) turnoBlock.hidden = true;
    const direccionWrap = mount.querySelector('#entregaDireccionWrap');
    if (direccionWrap) direccionWrap.hidden = true;
    notificarValidez();
  }

  function colapsarFecha(iso) {
    const [y, m, d] = iso.split('-');
    const valueEl = mount.querySelector('#entregaFechaSummaryValue');
    if (valueEl) valueEl.textContent = `${d}-${m}-${y}`;
    const summary = mount.querySelector('#entregaFechaSummary');
    const subhead = mount.querySelector('#entregaFechaSubhead');
    const picker = mount.querySelector('#entregaDatePicker');
    if (summary) summary.hidden = false;
    if (subhead) subhead.hidden = true;
    if (picker) picker.hidden = true;
  }
  function expandirFecha() {
    const summary = mount.querySelector('#entregaFechaSummary');
    const subhead = mount.querySelector('#entregaFechaSubhead');
    const picker = mount.querySelector('#entregaDatePicker');
    if (summary) summary.hidden = true;
    if (subhead) subhead.hidden = false;
    if (picker) picker.hidden = false;
    state.fecha = null;
    state.turno = null;
    expandirSlotInterno();
    const direccionWrap = mount.querySelector('#entregaDireccionWrap');
    if (direccionWrap) direccionWrap.hidden = true;
    notificarValidez();
  }

  function colapsarSlot(t) {
    const valueEl = mount.querySelector('#entregaSlotSummaryValue');
    if (valueEl) valueEl.textContent = `${t.hora_inicio}–${t.hora_fin}`;
    const summary = mount.querySelector('#entregaSlotSummary');
    const subhead = mount.querySelector('#entregaSlotSubhead');
    const grid = mount.querySelector('#entregaSlotGrid');
    if (summary) summary.hidden = false;
    if (subhead) subhead.hidden = true;
    if (grid) grid.hidden = true;
  }
  // Reset "silencioso" del bloque de horario, sin tocar state.turno de
  // nuevo ni disparar notificarValidez — lo usa expandirFecha() (que ya se
  // encarga de eso) para no duplicar trabajo.
  function expandirSlotInterno() {
    const summary = mount.querySelector('#entregaSlotSummary');
    const subhead = mount.querySelector('#entregaSlotSubhead');
    const grid = mount.querySelector('#entregaSlotGrid');
    if (summary) summary.hidden = true;
    if (subhead) subhead.hidden = true; // recién se muestra cuando hay turnos cargados (seleccionarFecha)
    if (grid) { grid.hidden = false; grid.innerHTML = ''; }
  }
  function expandirSlot() {
    expandirSlotInterno();
    mount.querySelector('#entregaSlotSubhead').hidden = false; // acá sí, ya había fecha elegida
    state.turno = null;
    const direccionWrap = mount.querySelector('#entregaDireccionWrap');
    if (direccionWrap) direccionWrap.hidden = true;
    notificarValidez();
  }

  // ---------------------------------------------------------------
  // Vista "Por zona/punto"
  // ---------------------------------------------------------------
  async function cargarZonasDeLaTab() {
    const grid = mount.querySelector('#entregaZonaGrid');
    if (!grid) return;
    try {
      if (!state.zonasPorTipo[state.tab]) {
        state.zonasPorTipo[state.tab] = await apiGet('/api/zonas?tipo=' + state.tab);
      }
      const zonas = state.zonasPorTipo[state.tab];
      if (!zonas.length) {
        grid.innerHTML = `<div class="empty">No hay ${state.tab === 'envio' ? 'zonas de envío' : 'puntos de retiro'} habilitados por el momento.</div>`;
        return;
      }
      grid.innerHTML = '';
      zonas.forEach((z) => {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'ent-opt ent-opt--row' + (state.zona && state.zona.id === z.id ? ' is-selected' : '');
        card.dataset.zonaId = z.id;
        const envioLabel = z.es_retiro ? 'Sin costo' : money(z.precio_envio);
        card.innerHTML = `
          <span class="ent-opt-check">✓</span>
          <span class="zn mono">${z.es_retiro ? 'RETIRO' : 'ZONA ' + String(z.id).padStart(2, '0')}</span>
          <div class="name">${z.nombre}</div>
          <div class="zn mono" style="margin-top:.4rem;">Envío: ${envioLabel}</div>`;
        card.addEventListener('click', () => seleccionarZona(z));
        grid.appendChild(card);
      });
      aplicarUltimaEntregaPendienteSiCorresponde();
    } catch (err) {
      console.error(err);
      grid.innerHTML = '<div class="empty">No pudimos cargar las zonas. Probá recargar la página.</div>';
    }
  }

  async function seleccionarZona(z) {
    state.zona = { id: z.id, nombre: z.nombre, precio_envio: z.precio_envio, es_retiro: !!z.es_retiro };
    state.fecha = null;
    state.turno = null;
    localStorage.setItem(LS_ZONA_ID, String(z.id));
    mount.querySelectorAll('#entregaZonaGrid .ent-opt').forEach((c) => {
      c.classList.toggle('is-selected', Number(c.dataset.zonaId) === z.id);
    });
    mount.querySelector('#entregaTurnoBlock').hidden = false;
    mount.querySelector('#entregaDireccionWrap').hidden = true; // se muestra recién con turno elegido
    mount.querySelector('#entregaSlotSubhead').hidden = true;
    mount.querySelector('#entregaDatePicker').innerHTML = '<div class="empty">Cargando días disponibles…</div>';
    mount.querySelector('#entregaSlotGrid').innerHTML = '';
    colapsarZona(z);
    notificarValidez();
    scrollIntoViewSoon('#entregaTurnoBlock');
    try {
      state.diasConTurno = await apiGet('/api/turnos/dias?zona_id=' + z.id);
    } catch (err) {
      console.error('No se pudieron cargar los días con turno:', err);
      state.diasConTurno = null;
    }
    buildDatePicker();
    // Si venimos de setUltimaEntrega() con un turno puntual, no sabemos su
    // fecha (sólo el id de turno recurrente) — no lo pre-seleccionamos acá,
    // el cliente elige fecha de nuevo. Ver nota en setUltimaEntrega().
  }

  function buildDatePicker() {
    const wrap = mount.querySelector('#entregaDatePicker');
    if (!wrap) return;
    const dows = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
    const hoy = new Date();
    wrap.innerHTML = '';
    let algunDiaMostrado = false;
    for (let i = 0; i < 14; i++) {
      const d = new Date(hoy);
      d.setDate(hoy.getDate() + i);
      if (state.diasConTurno && !state.diasConTurno.includes(d.getDay())) continue;
      algunDiaMostrado = true;
      const iso = d.toISOString().slice(0, 10);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ent-opt ent-opt--chip' + (state.fecha === iso ? ' is-selected' : '');
      chip.innerHTML = `<span class="ent-opt-check">✓</span><span class="dow">${dows[d.getDay()]}</span><span class="dnum">${d.getDate()}</span>`;
      chip.addEventListener('click', () => seleccionarFecha(iso));
      wrap.appendChild(chip);
    }
    if (!algunDiaMostrado) {
      wrap.innerHTML = '<div class="empty">No hay turnos configurados para esta zona en los próximos días.</div>';
    }
  }

  async function seleccionarFecha(iso) {
    state.fecha = iso;
    state.turno = null;
    mount.querySelector('#entregaDireccionWrap').hidden = true;
    notificarValidez();
    buildDatePicker();
    colapsarFecha(iso);
    const subhead = mount.querySelector('#entregaSlotSubhead');
    const grid = mount.querySelector('#entregaSlotGrid');
    subhead.hidden = false;
    grid.innerHTML = '<div class="empty">Buscando turnos…</div>';
    scrollIntoViewSoon('#entregaSlotSubhead');
    try {
      const carillas = typeof carillasProvider === 'function' ? carillasProvider() : 0;
      const qs = new URLSearchParams({ zona_id: state.zona.id, fecha: iso, categoria, carillas });
      const turnos = await apiGet('/api/turnos?' + qs.toString());
      if (!turnos.length) {
        grid.innerHTML = '<div class="empty">No hay turnos disponibles para esta fecha. Probá con otro día.</div>';
        return;
      }
      grid.innerHTML = '';
      turnos.forEach((t) => {
        const full = !t.disponible;
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'ent-opt ent-opt--slot' + (full ? ' is-full' : '');
        card.disabled = full;
        card.innerHTML = `
          <span class="ent-opt-check">✓</span>
          <div class="range">${t.hora_inicio} – ${t.hora_fin}</div>
          <div class="cap">${full ? 'NO DISPONIBLE' : (t.capacidad_maxima ? (t.capacidad_maxima - t.ocupados) + ' cupos' : 'cupo abierto')}</div>`;
        if (!full) card.addEventListener('click', () => seleccionarTurno(t, card));
        grid.appendChild(card);
      });
      scrollIntoViewSoon('#entregaSlotGrid');
    } catch (err) {
      console.error(err);
      grid.innerHTML = '<div class="empty">No pudimos cargar los turnos. Probá de nuevo.</div>';
    }
  }

  function seleccionarTurno(t, cardEl) {
    state.turno = t;
    mount.querySelectorAll('#entregaSlotGrid .ent-opt').forEach((c) => c.classList.remove('is-selected'));
    if (cardEl) cardEl.classList.add('is-selected');
    colapsarSlot(t);
    // Progressive disclosure (sección 5 del handoff): la dirección recién
    // se pide después de elegir zona Y turno.
    if (state.zona && !state.zona.es_retiro) {
      mount.querySelector('#entregaDireccionWrap').hidden = false;
      scrollIntoViewSoon('#entregaDireccionWrap');
    }
    notificarValidez();
  }

  // ---------------------------------------------------------------
  // Vista "Todos los turnos" — agregado simple client-side (sección 6 del
  // handoff: "sin endpoint de agregación server-side por ahora"). Llama
  // /api/turnos una vez por cada combinación (zona, fecha) que realmente
  // tiene turno ese día de la semana, dentro de la ventana de días actual.
  // ---------------------------------------------------------------
  async function cargarVistaTodos() {
    const cont = mount.querySelector('#entregaTodosList');
    if (!cont) return;
    cont.innerHTML = '<div class="empty">Buscando turnos…</div>';
    try {
      if (!state.zonasPorTipo[state.tab]) {
        state.zonasPorTipo[state.tab] = await apiGet('/api/zonas?tipo=' + state.tab);
      }
      const zonas = state.zonasPorTipo[state.tab];
      if (!zonas.length) {
        cont.innerHTML = `<div class="empty">No hay ${state.tab === 'envio' ? 'zonas de envío' : 'puntos de retiro'} habilitados.</div>`;
        return;
      }

      const carillas = typeof carillasProvider === 'function' ? carillasProvider() : 0;
      const hoy = new Date();
      const filas = [];

      await Promise.all(zonas.map(async (z) => {
        let dias;
        try {
          dias = await apiGet('/api/turnos/dias?zona_id=' + z.id);
        } catch {
          return; // si una zona falla, seguimos con las demás
        }
        const fechasAConsultar = [];
        for (let i = 0; i < state.ventanaTodos; i++) {
          const d = new Date(hoy);
          d.setDate(hoy.getDate() + i);
          if (dias.includes(d.getDay())) fechasAConsultar.push(d.toISOString().slice(0, 10));
        }
        await Promise.all(fechasAConsultar.map(async (iso) => {
          try {
            const qs = new URLSearchParams({ zona_id: z.id, fecha: iso, categoria, carillas });
            const turnos = await apiGet('/api/turnos?' + qs.toString());
            turnos.filter((t) => t.disponible).forEach((t) => {
              filas.push({ zona: z, fecha: iso, turno: t });
            });
          } catch {
            /* se omite esa combinación puntual, no bloquea el resto */
          }
        }));
      }));

      if (!filas.length) {
        cont.innerHTML = '<div class="empty">No encontramos turnos disponibles en los próximos días. Probá "Ver más fechas".</div>';
        return;
      }

      filas.sort((a, b) => (a.fecha + a.turno.hora_inicio).localeCompare(b.fecha + b.turno.hora_inicio));
      cont.innerHTML = '';
      filas.forEach((fila) => {
        const [y, m, d] = fila.fecha.split('-');
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ent-opt ent-opt--row entrega-todos-row';
        row.innerHTML = `
          <span class="ent-opt-check">✓</span>
          <span class="mono">${d}-${m}-${y}</span>
          <span>${fila.turno.hora_inicio}–${fila.turno.hora_fin}</span>
          <span class="entrega-todos-zona">${fila.zona.nombre}</span>`;
        row.addEventListener('click', () => seleccionarDesdeTodos(fila, row));
        cont.appendChild(row);
      });
    } catch (err) {
      console.error(err);
      cont.innerHTML = '<div class="empty">No pudimos cargar los turnos. Probá de nuevo.</div>';
    }
  }

  function seleccionarDesdeTodos(fila, rowEl) {
    state.zona = { id: fila.zona.id, nombre: fila.zona.nombre, precio_envio: fila.zona.precio_envio, es_retiro: !!fila.zona.es_retiro };
    state.fecha = fila.fecha;
    state.turno = fila.turno;
    localStorage.setItem(LS_ZONA_ID, String(fila.zona.id));
    mount.querySelectorAll('.entrega-todos-row').forEach((r) => r.classList.remove('is-selected'));
    if (rowEl) rowEl.classList.add('is-selected');
    if (!state.zona.es_retiro) {
      mount.querySelector('#entregaDireccionWrap').hidden = false;
      scrollIntoViewSoon('#entregaDireccionWrap');
    }
    notificarValidez();
  }

  // ---------------------------------------------------------------
  // Pre-selección — Caso C (cliente logueado recurrente) y visitante que ya
  // había elegido zona antes (localStorage, comportamiento heredado).
  // ---------------------------------------------------------------
  function setUltimaEntrega(ultimaEntrega) {
    // Se puede llamar ANTES de activar() (ni bien vuelve /api/mi-perfil, que
    // corre en paralelo con el resto del init) — se guarda y se aplica en
    // cuanto haya zonas cargadas para aplicarla.
    state.ultimaEntregaPendiente = ultimaEntrega || null;
    if (state.activado) aplicarUltimaEntregaPendienteSiCorresponde();
  }

  function aplicarUltimaEntregaPendienteSiCorresponde() {
    if (!state.ultimaEntregaPendiente || state.zona) return; // ya hay algo elegido, no pisamos
    const zonaId = state.ultimaEntregaPendiente.zona_id;
    if (!zonaId) return;
    const zonas = state.zonasPorTipo[state.tab];
    if (!zonas) return;
    const z = zonas.find((zz) => zz.id === zonaId);
    if (!z) return; // la última zona no es del tipo de la tab activa — no forzamos cambio de tab
    // Pre-seleccionamos la ZONA (sección 5: "pre-seleccionada, no oculta" —
    // el cliente la ve marcada pero puede cambiarla con un toque). El turno
    // puntual del pedido anterior no se pre-selecciona: era para una fecha
    // pasada, así que no tiene sentido reproducirlo — el cliente elige
    // fecha/turno de nuevo, ya con la zona correcta puesta.
    state.ultimaEntregaPendiente = null; // aplicar una sola vez
    seleccionarZona(z);
  }

  async function activar() {
    if (state.activado) return;
    state.activado = true;
    render();
    const zonaGuardadaId = localStorage.getItem(LS_ZONA_ID);
    await cargarZonasDeLaTab();
    if (zonaGuardadaId && !state.zona && !state.ultimaEntregaPendiente) {
      const zonas = state.zonasPorTipo[state.tab] || [];
      const z = zonas.find((zz) => String(zz.id) === zonaGuardadaId);
      if (z) await seleccionarZona(z);
    }
  }

  return { activar, esValido, getResultado, setUltimaEntrega, mostrarError };
}
