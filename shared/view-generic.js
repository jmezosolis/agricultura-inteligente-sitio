// =====================================================================
// Presentación genérica por pestañas — la usa administracion/ (panel
// interno de Administración). Requiere que shared/data.js y
// shared/ui-common.js ya estén cargados antes que este archivo.
//
// La app de Ganadero NO usa esto — tiene su propia interfaz
// (ganadero/app.js), con navegación inferior tipo app nativa. Las piezas
// que sí comparten las dos interfaces (verificación de chip, pantalla de
// acceso restringido, selector de municipio, SCOPE_ROLES) viven en
// shared/ui-common.js, no acá — evitá duplicarlas de nuevo si agregás
// algo nuevo.
// =====================================================================

let activeTab = null;

async function renderApp(){
  const session = mockApi.sesionActual();
  // Sin sesión (recién entrado sin login guardado, o justo después de un
  // logout) — la puerta única de acceso es "../index.html" (ver
  // frontend/inicio.js): un solo formulario, sin el tema propio de esta
  // app. Sin este redirect, cerrar sesión desde acá dejaba viendo el
  // login (negro) de Administración en vez de volver a la pantalla neutra.
  if (!session) { redirigirSeguro('../index.html'); return; }
  const root = document.getElementById('app');
  const pintar = async () => {
    root.innerHTML = !rolPermitidoEnApp(session.rol) ? viewAccesoRestringido(session) : await viewShell(session);
    bindEvents();
  };
  // Transición suave al cambiar de pestaña (Resumen/Mapa/Monitoreo/
  // ...) en vez del "parpadeo" seco de reemplazar innerHTML de golpe —
  // mismo criterio que ganadero/app.js, ver el comentario en
  // transicionSegura() (shared/ui-common.js).
  transicionSegura(pintar);
}

function defaultTabFor(rol){
  return rol === 'admin' ? 'resumen' : 'consulta';
}

// Cuántos elementos mostrar por lista antes de pedir "cargar más" — no
// hay una cifra pública de cuántos animales existen por estado (ni INEGI
// ni SIAP la publican desagregada), así que el panel se diseña para
// aguantar bien tanto si son cientos como miles: nunca se renderiza la
// lista completa de una, se pagina.
let mostrarLimite = { usuarios: 20, clientes: 20, auditoria: 20 };

// Filtro de rol en la pestaña "Usuarios" — 'todos' | 'ganadero' | 'admin'.
let filtroUsuarios = 'todos';

// Sin rol técnico en esta copia: el único staff posible es admin. Un
// ganadero que entrara acá por error solo ve "Consultar chip" (no
// debería pasar — rolPermitidoEnApp ya lo bloquea antes, esto es una
// segunda red de contención).
function tabsFor(rol){
  if (rol === 'admin') {
    return [
      { id:'resumen', label:'Resumen' },
      { id:'mapa', label:'Mapa' },
      { id:'productividad', label:'Productividad' },
      { id:'monitoreo', label:'Monitoreo' },
      { id:'inventario', label:'Inventario de chips' },
      { id:'pedidos_ganaid', label:'Pedidos Gana ID' },
      { id:'usuarios', label:'Usuarios' },
      { id:'clientes', label:'Clientes' },
      { id:'auditoria', label:'Auditoría' },
      { id:'consulta', label:'Consultar chip' },
    ];
  }
  return [{ id:'consulta', label:'Consultar chip' }];
}

async function viewShell(session){
  if (!activeTab) activeTab = defaultTabFor(session.rol);
  const tabs = tabsFor(session.rol);
  const rolPill = session.rol === 'admin' ? 'aprobada' : 'pendiente';
  const contenidoTab = await renderTab(activeTab, session);
  return `
  <div class="wrap wrap-ancho">
    <div class="app-layout">
      <aside class="sidebar">
        <div class="row" style="align-items:center;justify-content:space-between;">
          <div class="who">${emojiScope(APP_SCOPE) ? emojiScope(APP_SCOPE) + ' ' : ''}Sesión: <b>${esc(session.nombre)}</b></div>
          ${iconoMenuUsuario()}
        </div>
        <span class="pill pill-${rolPill}" style="width:fit-content;">${etiquetaRol(session.rol)}</span>
        <nav class="tabs">
          ${tabs.map(t => `<div class="tab ${activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>`).join('')}
        </nav>
      </aside>
      <main class="main-content">
        <div id="tabContent">${contenidoTab}</div>
      </main>
    </div>
  </div>`;
}

async function renderTab(tab, session){
  switch (tab) {
    case 'resumen': return viewResumen();
    case 'mapa': return viewMapa();
    case 'productividad': return viewProductividad();
    case 'monitoreo': return viewMonitoreo();
    case 'inventario': return viewInventario(session);
    case 'pedidos_ganaid': return viewPedidosGanaID();
    case 'usuarios': return viewUsuarios(session);
    case 'clientes': return viewClientes();
    case 'auditoria': return viewAuditoria();
    case 'consulta': return `<div class="card"><h3>🔎 Verificar un chip</h3>${blockConsultarChip('tab', { autoFocoEscaner: true })}</div>`;
    default: return '';
  }
}

// Panel de arranque — exclusivo de admin. No existe una cifra pública de
// "ganado" por estado (INEGI/SIAP/SINIIGA no la publican desagregada) —
// este resumen muestra los datos reales que carga la propia
// Administración, no una proyección externa. Pensado para aguantar bien
// el volumen que sea: son agregados (conteos), nunca listas completas.
// Resumen del admin — a diferencia del resto de las vistas, no hay una
// sola función de mockApi que devuelva todo esto junto (es un cruce de
// varias tablas para un dashboard, no una operación de negocio puntual),
// así que se piden en paralelo las tablas que hacen falta — RLS ya deja
// ver todo esto a admin (ver supabase/migrations/20260807120100_rls.sql),
// así que son selects directos, sin necesitar una función RPC dedicada.
async function datosResumenAdmin(){
  const [animales, perfiles, inventarioChips, lotesChips] = await Promise.all([
    supabaseClient.from('animales').select('estado, raza, sexo, fecha_nacimiento'),
    supabaseClient.from('perfiles').select('rol, activo, municipio'),
    supabaseClient.from('inventario_chips').select('estado'),
    supabaseClient.from('lotes_chips').select('id'),
  ]);
  for (const r of [animales, perfiles, inventarioChips, lotesChips]) {
    if (r.error) throw new Error(r.error.message);
  }
  return {
    animales: animales.data, perfiles: perfiles.data, inventarioChips: inventarioChips.data,
    lotesChips: lotesChips.data,
  };
}

async function viewResumen(){
  const { animales, perfiles, inventarioChips, lotesChips } = await datosResumenAdmin();
  const porEstado = { vivo:0, vendido:0, sacrificado:0, baja:0 };
  animales.forEach(a => { porEstado[a.estado] = (porEstado[a.estado] || 0) + 1; });

  const porRaza = {};
  animales.forEach(a => { const r = a.raza || 'Sin especificar'; porRaza[r] = (porRaza[r] || 0) + 1; });
  const razasOrdenadas = Object.entries(porRaza).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxRaza = razasOrdenadas.length ? razasOrdenadas[0][1] : 1;

  // Categoría por edad + sexo (becerro/a, novillo/a, toro/vaca — ver
  // categoriaBovino() en shared/data.js) sobre el rebaño VIVO — vendidos/
  // sacrificados/baja no aportan nada a "cómo está compuesto mi rebaño hoy".
  // "En general" acá son los totales de machos/hembras sin desglosar por
  // edad, al lado del desglose fino por categoría.
  const vivos = animales.filter(a => a.estado === 'vivo');
  const porCategoria = { Becerro:0, Becerra:0, Novillo:0, Novilla:0, Toro:0, Vaca:0, 'Sin clasificar':0 };
  let machos = 0, hembras = 0;
  vivos.forEach(a => {
    porCategoria[categoriaBovino(a.sexo, a.fecha_nacimiento)]++;
    if (a.sexo === 'macho') machos++;
    else if (a.sexo === 'hembra') hembras++;
  });
  const categoriasConDatos = Object.entries(porCategoria).filter(([, n]) => n > 0);
  const maxCategoria = categoriasConDatos.length ? Math.max(...categoriasConDatos.map(([, n]) => n)) : 1;

  const ganaderosPerfiles = perfiles.filter(p => p.rol === 'ganadero' && p.activo !== false);
  const porMunicipio = {};
  ganaderosPerfiles.forEach(p => { const m = p.municipio || 'Sin especificar'; porMunicipio[m] = (porMunicipio[m] || 0) + 1; });
  const municipiosOrdenados = Object.entries(porMunicipio).sort((a, b) => b[1] - a[1]);

  const ganaderos = ganaderosPerfiles.length;
  const enStock = inventarioChips.filter(c => c.estado === 'en_stock').length;
  const asignados = inventarioChips.filter(c => c.estado === 'asignado').length;

  const statBox = (label, value, color) => `
    <div class="card" style="flex:1;min-width:130px;text-align:center;">
      <div style="font-size:1.5rem;font-weight:900;color:${color};">${value}</div>
      <div class="small muted" style="margin-top:4px;">${label}</div>
    </div>`;

  return `
    <div class="row" style="gap:10px;column-span:all;">
      ${statBox('Animales vivos', porEstado.vivo, 'var(--verde)')}
      ${statBox('Ganaderos', ganaderos, 'var(--dorado)')}
      ${statBox('Chips en stock', enStock, 'var(--dorado)')}
    </div>
    <div class="card">
      <h3>Inventario de chips</h3>
      <p class="small muted" style="margin-top:8px;">
        En stock: <b style="color:var(--texto);">${enStock}</b> ·
        Asignados: <b style="color:var(--texto);">${asignados}</b> ·
        Lotes cargados: <b style="color:var(--texto);">${lotesChips.length}</b>
      </p>
    </div>
    <div class="card">
      <h3>Animales por raza</h3>
      ${razasOrdenadas.length ? razasOrdenadas.map(([raza, n]) => `
        <div style="margin-top:10px;">
          <div class="row" style="justify-content:space-between;font-size:14px;"><span>${esc(raza)}</span><b style="color:var(--texto);">${n}</b></div>
          <div style="height:8px;border-radius:4px;background:var(--barra-track);margin-top:4px;overflow:hidden;">
            <div style="height:100%;width:${((n / maxRaza) * 100).toFixed(0)}%;background:var(--dorado);"></div>
          </div>
        </div>`).join('') : `<div class="empty">Todavía no hay animales identificados.</div>`}
    </div>
    <div class="card">
      <h3>Animales por categoría</h3>
      <p class="small muted" style="margin-top:2px;margin-bottom:8px;">Sobre los ${vivos.length} animales vivos — en general: ${machos} macho${machos === 1 ? '' : 's'} · ${hembras} hembra${hembras === 1 ? '' : 's'}.</p>
      ${categoriasConDatos.length ? categoriasConDatos.map(([cat, n]) => `
        <div style="margin-top:10px;">
          <div class="row" style="justify-content:space-between;font-size:14px;"><span>${cat}</span><b style="color:var(--texto);">${n}</b></div>
          <div style="height:8px;border-radius:4px;background:var(--barra-track);margin-top:4px;overflow:hidden;">
            <div style="height:100%;width:${((n / maxCategoria) * 100).toFixed(0)}%;background:var(--dorado);"></div>
          </div>
        </div>`).join('') : `<div class="empty">Todavía no hay animales vivos identificados.</div>`}
    </div>
    <div class="card">
      <h3>🗺️ Usuarios por municipio</h3>
      ${bloqueTablaBuscable({
        inputId: 'buscarMunicipioResumen', cuerpoId: 'cuerpoMunicipioResumen', sinResultadosId: 'sinResultadosMunicipio',
        columnas: ['Municipio', 'Ganaderos'], placeholder: 'Buscar municipio…', vacio: 'Todavía no hay ganaderos registrados con municipio.',
        filas: municipiosOrdenados.map(([municipio, n]) => `
          <tr data-buscar="${municipio.toLowerCase()}" data-ver-municipio="${municipio}" style="cursor:pointer;">
            <td>${municipio}</td>
            <td style="text-align:right;font-weight:800;">${n}</td>
          </tr>`).join(''),
      })}
    </div>
    <div class="card">
      <h3>Estado de los animales</h3>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px;">
        <span class="pill pill-vivo">Vivos: ${porEstado.vivo}</span>
        <span class="pill pill-aprobada">Vendidos: ${porEstado.vendido}</span>
        <span class="pill pill-asignado">Sacrificados: ${porEstado.sacrificado}</span>
        <span class="pill pill-baja">Baja: ${porEstado.baja}</span>
      </div>
    </div>
    <div class="card">
      <h3>📊 Respaldo</h3>
      <button class="btn btn-primary btn-block" id="btnExportarRespaldo" type="button" style="margin-top:8px;">⬇️ Exportar toda la información (Excel)</button>
    </div>
  `;
}

// ===== Mapa (Ganaderos por municipio) — exclusivo de admin =====
// municipio ya es un campo controlado (se ELIGE de una lista, no se
// escribe libre — ver shared/data.js), así que se puede ubicar en un
// mapa real sin depender de que nadie cargue coordenadas a mano. Sirve
// para ver de un vistazo dónde se concentra el rebaño de la
// administración.

// Mismos datos que datosResumenAdmin() (ganaderos), agregados en
// {municipio: cantidad} para plotear.
async function datosMapaAdmin(){
  const { data, error } = await supabaseClient.from('perfiles').select('rol, activo, municipio');
  if (error) throw new Error(error.message);

  const ganaderosPorMunicipio = {};
  data.filter(p => p.rol === 'ganadero' && p.activo !== false && p.municipio).forEach(p => {
    ganaderosPorMunicipio[p.municipio] = (ganaderosPorMunicipio[p.municipio] || 0) + 1;
  });

  return { ganaderosPorMunicipio };
}

// Leaflet (~40KB) tampoco se carga fijo — mismo criterio que SheetJS acá
// abajo: se inyecta recién la primera vez que alguien abre la pestaña
// Mapa, CSS + JS desde un CDN público (unpkg), sin necesitar API key
// porque los tiles son de OpenStreetMap.
let _leafletPromise = null;
function cargarLeaflet(){
  if (typeof L !== 'undefined') return Promise.resolve();
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    // Overrides propios DESPUÉS del <link> de Leaflet (así ganan en el
    // cascade sin necesitar !important) — cuadro de capas más compacto:
    // menos padding, letra un poco más chica, menos aire entre ítems.
    const ajustes = document.createElement('style');
    ajustes.textContent = `
      .leaflet-control-layers{ font-size:11.5px; }
      .leaflet-control-layers-expanded{ padding:6px 10px 6px 8px; }
      .leaflet-control-layers-list label{ margin-bottom:3px; }
      .leaflet-control-layers-toggle{ width:30px; height:30px; }
    `;
    document.head.appendChild(ajustes);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = resolve;
    script.onerror = () => { _leafletPromise = null; reject(new Error('No se pudo cargar la librería del mapa')); };
    document.head.appendChild(script);
  });
  return _leafletPromise;
}

// Geocodifica un municipio con Nominatim (buscador de OpenStreetMap) —
// gratis y sin API key, tal como pedía la propuesta, pero su política de
// uso pide no golpearlo seguido y cachear lo que se pueda: localStorage lo
// guarda para siempre entre sesiones (el nombre de un municipio no cambia
// nunca), así que en la práctica cada municipio se geocodifica una única
// vez en la vida de este navegador. Devuelve null (en vez de tirar error)
// si no lo encuentra o si no hay conexión — un municipio de menos en el
// mapa no debería tumbar el resto. El estado sale de estadoDeLaSesion()
// (shared/auth-supabase.js) — nunca hardcodeado, cada instalación busca
// dentro del estado real de su propia administración.
async function coordenadasMunicipio(municipio){
  const clave = 'coords_municipio_' + municipio;
  const cacheado = localStorage.getItem(clave);
  if (cacheado) {
    try { return JSON.parse(cacheado); } catch { /* cache corrupto — re-geocodificar abajo */ }
  }
  try {
    const estado = (typeof estadoDeLaSesion === 'function' && estadoDeLaSesion()) || '';
    const consulta = [municipio, estado, 'México'].filter(Boolean).join(', ');
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(consulta)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    const coords = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    localStorage.setItem(clave, JSON.stringify(coords));
    return coords;
  } catch { return null; }
}

// Arma el mapa dentro de #mapaAdministracion (ver viewMapa()) — lo llama
// bindEvents() cuando la pestaña activa es "mapa", porque necesita el
// contenedor ya insertado en el DOM.
let _mapaAdminInstance = null;
async function iniciarMapaAdmin(){
  const contenedor = document.getElementById('mapaAdministracion');
  if (!contenedor) return;
  let ganaderosPorMunicipio;
  try {
    ({ ganaderosPorMunicipio } = await datosMapaAdmin());
  } catch (err) { contenedor.innerHTML = `<p class="small muted">${esc(err.message)}</p>`; return; }

  const municipiosConDatos = Object.keys(ganaderosPorMunicipio);
  if (!municipiosConDatos.length) {
    contenedor.innerHTML = `<div class="empty">Todavía no hay ganaderos con municipio cargado.</div>`;
    return;
  }

  try { await cargarLeaflet(); }
  catch (err) { contenedor.innerHTML = `<p class="small muted">${esc(err.message)}</p>`; return; }

  contenedor.innerHTML = `<p class="small muted" style="padding:12px;">Ubicando ${municipiosConDatos.length} municipio${municipiosConDatos.length === 1 ? '' : 's'}…</p>`;

  // Geocodifica los que hagan falta (la mayoría va a venir de localStorage
  // después de la primera vez) y arma un punto por municipio.
  const puntos = [];
  for (const municipio of municipiosConDatos) {
    const coords = await coordenadasMunicipio(municipio);
    if (coords) puntos.push({ municipio, coords, ganaderos: ganaderosPorMunicipio[municipio] || 0 });
  }

  // Cápsula flotante SOBRE el mapa (no una franja fija que le come alto)
  // — semitransparente, siempre visible sin tapar casi nada de abajo.
  // Reemplaza al control flotante de Leaflet, que quedaba escondido
  // (colapsado) o con fondo sólido tapando una esquina (expandido).
  const franja = document.createElement('div');
  franja.className = 'mapa-leyenda';
  franja.innerHTML = `
    <label class="mapa-leyenda-item">
      <input type="checkbox" id="capaGanaderosToggle" checked>
      <img src="../animales.png" alt="" style="width:15px;height:15px;">
      <span>Ganaderos por municipio</span>
    </label>
  `;

  const mapaDiv = document.createElement('div');
  mapaDiv.id = 'mapaAdministracionLeaflet';
  mapaDiv.style.cssText = 'height:min(75vh,760px);border-radius:12px;overflow:hidden;';
  contenedor.innerHTML = '';
  contenedor.style.position = 'relative';
  contenedor.appendChild(mapaDiv);
  contenedor.appendChild(franja);

  if (!puntos.length) {
    contenedor.innerHTML = `<p class="small muted">No se pudo ubicar ningún municipio — revisá la conexión e intentá de nuevo entrando a esta pestaña otra vez.</p>`;
    return;
  }

  if (_mapaAdminInstance) { _mapaAdminInstance.remove(); _mapaAdminInstance = null; }
  const mapa = L.map(mapaDiv.id);
  _mapaAdminInstance = mapa;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(mapa);

  // Marcas discretas a propósito: opacidad baja y sin borde grueso, para
  // que se lean como una capa de datos sobre el mapa y no tapen la
  // geografía de abajo (nombres de municipios, límites, etc.).
  const maxGanaderos = Math.max(1, ...puntos.map(p => p.ganaderos));
  const capaGanaderos = L.layerGroup();
  puntos.forEach(p => {
    if (p.ganaderos) {
      L.circleMarker(p.coords, {
        radius: 5 + (p.ganaderos / maxGanaderos) * 13,
        color: '#0F2A4A', weight: 1, opacity: 0.55, fillColor: '#0F2A4A', fillOpacity: 0.22,
      }).bindPopup(`<b>${esc(p.municipio)}</b><br>${p.ganaderos} ganadero${p.ganaderos === 1 ? '' : 's'}`).addTo(capaGanaderos);
    }
  });
  capaGanaderos.addTo(mapa);
  document.getElementById('capaGanaderosToggle').onchange = (e) => {
    if (e.target.checked) capaGanaderos.addTo(mapa); else mapa.removeLayer(capaGanaderos);
  };

  // Vista inicial ajustada a los municipios con datos — se calcula del
  // lado del cliente a partir de "puntos" (ya georreferenciados arriba),
  // así funciona igual de bien sin importar en qué estado esté esta
  // administración. Con un padding chico para que ningún marcador quede
  // pegado al borde.
  mapa.fitBounds(L.latLngBounds(puntos.map(p => p.coords)), { padding: [24, 24] });
}

async function viewMapa(){
  return `
    <div class="card" style="column-span:all;">
      <h3>Mapa</h3>
      <p class="small muted" style="margin-top:4px;">Ganaderos activos, ubicados por municipio.</p>
      <div id="mapaAdministracion" style="margin-top:10px;">
        <p class="small muted" style="padding:12px;">Cargando mapa…</p>
      </div>
    </div>`;
}

// Comparativa de productividad (GDP promedio, kg/día) por raza y por
// municipio — benchmark_productividad() cruza TODA la administración del lado
// del servidor. Convierte los números sueltos de cada animal en algo
// accionable: "tu raza rinde menos que el promedio" es información que
// antes no existía en ningún lado del sistema.
function barraProductividad(items, maxGdp){
  if (!items.length) return `<div class="empty">Todavía no hay suficientes pesajes cargados para calcular esto.</div>`;
  return items.map(x => `
    <div style="margin-top:10px;">
      <div class="row" style="justify-content:space-between;font-size:14px;">
        <span>${esc(x.etiqueta)} <span class="muted">(${x.animales} animal${x.animales === 1 ? '' : 'es'})</span></span>
        <b style="color:var(--texto);">${x.gdp_promedio} kg/día</b>
      </div>
      <div style="height:8px;border-radius:4px;background:var(--barra-track);margin-top:4px;overflow:hidden;">
        <div style="height:100%;width:${maxGdp > 0 ? ((x.gdp_promedio / maxGdp) * 100).toFixed(0) : 0}%;background:var(--dorado);"></div>
      </div>
    </div>`).join('');
}

async function viewProductividad(){
  let datos;
  try { datos = await mockApi.benchmarkProductividad(); }
  catch (err) { return `<div class="card"><p class="small muted">${esc(err.message)}</p></div>`; }
  const maxRaza = datos.por_raza.length ? Math.max(...datos.por_raza.map(x => x.gdp_promedio)) : 0;
  const maxMunicipio = datos.por_municipio.length ? Math.max(...datos.por_municipio.map(x => x.gdp_promedio)) : 0;
  return `
    <div class="card">
      <h3>Productividad</h3>
      <p class="small muted" style="margin-top:4px;">Ganancia diaria promedio (GDP, kg/día) de los animales identificados.</p>
    </div>
    <div class="card">
      <h3>Por raza</h3>
      ${barraProductividad(datos.por_raza, maxRaza)}
    </div>
    <div class="card">
      <h3>Por municipio</h3>
      ${barraProductividad(datos.por_municipio, maxMunicipio)}
    </div>
  `;
}

// cargarSheetJS()/armarLibroExcel() ahora viven en shared/ui-common.js —
// también los usa cada ganadero para exportar su propio rebaño desde su
// Inicio (ver ganadero/app.js), no solo Administración.

// Arma el .xlsx en el propio navegador y dispara la descarga.
// mockApi.datosRespaldoCompleto() ya devuelve cada hoja con encabezado en
// español, lista para volcarse tal cual — acá solo se elige el orden de
// las pestañas. Sin backend de por medio, así que este archivo nunca pasa
// por ningún servidor — sale directo de Supabase al Excel.
async function exportarRespaldoExcel(){
  let datos;
  try { datos = await mockApi.datosRespaldoCompleto(); }
  catch (err) { toast(err.message, '⚠️'); return; }
  if (Object.values(datos).every(hoja => !hoja.length)) {
    toast('Todavía no hay información guardada para exportar', '⚠️');
    return;
  }
  if (typeof XLSX === 'undefined') toast('Preparando el Excel…', '⏳');
  try { await cargarSheetJS(); }
  catch (err) { toast(err.message + ' — revisá la conexión', '⚠️'); return; }

  const wb = armarLibroExcel(datos, [
    ['animales', 'Animales'],
    ['pesajes', 'Pesajes'],
    ['sanidad', 'Sanidad'],
    ['reproduccion', 'Reproducción'],
    ['otros_eventos', 'Altas, traslados y bajas'],
    ['sacrificios', 'Sacrificios'],
    ['guias_movilizacion', 'Guías de movilización'],
    ['usuarios', 'Usuarios'],
    ['inventario_chips', 'Inventario de chips'],
    ['lotes_chips', 'Lotes de chips'],
  ]);
  XLSX.writeFile(wb, `respaldo-completo-${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Excel descargado', '⬇️');
}

// Botón "cargar más" genérico — nunca se vuelca la lista completa de una,
// sin importar si son 10 o 10,000 registros.
function botonCargarMas(clave, totalReal, mostrados){
  if (mostrados >= totalReal) return '';
  return `<button class="btn btn-ghost btn-block" data-cargar-mas="${clave}">Cargar más (${totalReal - mostrados} restantes)</button>`;
}

// nombrePerfil(id) (data.js) leía loadDB().perfiles — servía cuando los
// perfiles vivían en el mismo localStorage. Ahora que están en Supabase,
// resolver "de quién es este id" en cada fila necesitaría una consulta
// por fila; en vez de eso, se trae la tabla completa UNA vez (RLS ya deja
// verla entera a admin) y se arma un mapa id→nombre para usar
// sincrónico dentro del .map() de cada lista — mismo criterio que
// listar_auditoria() en el RPC, que resuelve el nombre con un JOIN.
async function mapaNombresPerfiles(){
  const { data, error } = await supabaseClient.from('perfiles').select('id, nombre');
  if (error) throw new Error(error.message);
  return new Map(data.map(p => [p.id, p.nombre]));
}

// Guarda qué se buscó por última vez en Monitoreo, para poder refrescar el
// resultado sin perder la búsqueda ni tener que releer el input.
let monitoreoQueryActual = '';

// Pensada para el técnico que llega a un rancho: buscar (o escanear con el
// lector Bluetooth) un animal por chip o N° interno y ver de un vistazo
// toda su historia — altas, traslados, sanidad, pesajes — sin cruzar nada
// a mano. Sanidad/pesaje siguen siendo de solo lectura acá (son datos del
// día a día que carga el propio ganadero desde su app —
// registrarPesaje()/registrarSanidad() ya exigen rol 'ganadero'. Es la
// forma de "llegar al rancho de tal ganadero y ver los datos de sus
// animales" sin necesitar entrar a la cuenta de nadie: ya sabés quién es
// el dueño en cuanto encontrás el animal. mockApi.buscarAnimalMonitoreo()
// exige admin, así que un ganadero no llega a esta pantalla ni
// manipulando la función a mano.
function viewMonitoreo(){
  return `
    <div class="card">
      <h3>🔎 Monitoreo</h3>
      <p class="small muted" style="margin-top:4px;">Buscá un animal por chip o N° interno — o escaneá el chip con el lector — y mirá su historia completa: altas, traslados, sanidad y evolución de peso.</p>
      <div class="row" style="margin-top:8px;">
        <input id="monitoreoInput" placeholder="Chip o N° interno — o escaneá con el lector" style="flex:1;">
        <button class="btn btn-primary" id="btnBuscarMonitoreo">Buscar</button>
      </div>
    </div>
    <div id="resultadoMonitoreo"></div>
  `;
}

// Las 2 secciones de abajo (sacrificio, guía de movilización) son
// EXCLUSIVAS de admin.
async function renderResultadoMonitoreo(r, query){
  if (!r) {
    return `<div class="card" style="border-color:var(--red-card-border);">
      <span class="pill pill-rechazada">⚠️ No encontrado</span>
      <p class="small" style="margin-top:8px;">Ningún animal identificado tiene "${esc(query)}" como chip o N° interno.</p>
    </div>`;
  }
  const { animal: a, dueño, eventos } = r;
  const fila = (k, v) => v ? `<p class="small muted" style="margin-top:4px;">${k}: <b style="color:var(--texto);">${esc(v)}</b></p>` : '';
  const pesajes = eventos.filter(e => e.tipo === 'pesaje').slice().reverse(); // eventos ya viene ordenado desc; para la barra conviene cronológico
  const maxPeso = pesajes.length ? Math.max(...pesajes.map(p => p.peso_kg)) : 1;
  const retiro = retiroActivoHoy(eventos);

  const rolActual = mockApi.sesionActual()?.rol;
  const esAdmin = rolActual === 'admin';
  let hist = null, rastros = [];
  if (esAdmin) {
    try {
      [hist, rastros] = await Promise.all([
        mockApi.historialAdministrativo(a.id), mockApi.listarRastros(),
      ]);
    } catch (err) { toast(err.message, '⚠️'); }
  }

  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h3>${esc(etiquetaAnimal(a))} — ${esc(a.raza) || 'Raza no especificada'}</h3>
        <span class="pill pill-${a.estado}">${etiquetaEstadoAnimal(a.estado)}</span>
      </div>
      ${fila('Chip', a.chip_uid)}
      ${fila('Sexo', a.sexo === 'macho' ? 'Macho' : 'Hembra')}
      ${fila('Categoría', categoriaBovino(a.sexo, a.fecha_nacimiento))}
      ${fila('Dueño actual', dueño ? `${dueño.nombre}${dueño.municipio ? ' · ' + dueño.municipio : ''}` : null)}
      ${fila('Teléfono', dueño ? dueño.telefono : null)}
    </div>
    ${retiro ? `
    <div class="card" style="border-color:var(--red-card-border);background:var(--red-soft-bg);">
      <b style="color:var(--red);">⚠️ En período de retiro hasta ${retiro.retiro_hasta}</b>
      <p class="small muted" style="margin-top:4px;">No debería venderse ni sacrificarse todavía — ${esc(retiro.descripcion)}${retiro.producto ? ' (' + esc(retiro.producto) + ')' : ''}.</p>
    </div>` : ''}
    <div class="card">
      <h3>⚖️ Peso</h3>
      ${fila('Al nacer', a.peso_nacimiento_kg ? a.peso_nacimiento_kg + ' kg' : null)}
      ${pesajes.length ? pesajes.map(p => `
        <div style="margin-top:10px;">
          <div class="row" style="justify-content:space-between;font-size:14px;"><span>${fmtFechaEvento(p.fecha)}${p.condicion_corporal ? ' · ' + etiquetaCondicionCorporal(p.condicion_corporal) : ''}</span><b style="color:var(--texto);">${p.peso_kg} kg</b></div>
          <div style="height:8px;border-radius:4px;background:var(--barra-track);margin-top:4px;overflow:hidden;">
            <div style="height:100%;width:${((p.peso_kg / maxPeso) * 100).toFixed(0)}%;background:var(--dorado);"></div>
          </div>
        </div>`).join('') : `<p class="small muted" style="margin-top:8px;">Todavía no hay pesajes cargados.</p>`}
    </div>
    <div class="card">
      <h3>📜 Historial</h3>
      <p class="small muted" style="margin-top:2px;margin-bottom:8px;">Sanidad y pesajes los carga el propio ganadero desde su app — acá solo se consultan.</p>
      ${eventos.length ? eventos.map(e => `
        <p class="small muted" style="margin-top:4px;">${fmtFechaEvento(e.fecha)} — <b style="color:var(--texto);">${etiquetaTipoEvento(e.tipo)}</b>${e.tipo === 'pesaje' ? ` (${e.peso_kg} kg${e.condicion_corporal ? ', ' + etiquetaCondicionCorporal(e.condicion_corporal) : ''})` : ''}${e.tipo === 'sanidad' && e.descripcion ? ` (${esc(e.descripcion)}${e.producto ? ' · ' + esc(e.producto) : ''}${e.lote_producto ? ' · lote ' + esc(e.lote_producto) : ''})` : ''}${e.notas ? ` · ${esc(e.notas)}` : ''}${e.retiro_hasta ? ` · retiro hasta ${e.retiro_hasta}` : ''}</p>
      `).join('') : `<div class="empty">Todavía no hay eventos registrados.</div>`}
    </div>
    ${esAdmin && hist ? `
    <div class="card">
      <h3>🥩 Sacrificio</h3>
      ${hist.sacrificio ? `
        ${fila('Fecha', fmtFechaEvento(hist.sacrificio.fecha))}
        ${fila('Rastro', hist.sacrificio.rastro + (hist.sacrificio.numero_tif ? ` (TIF ${hist.sacrificio.numero_tif})` : ''))}
        ${fila('Folio oficial', hist.sacrificio.folio_oficial)}
        ${fila('Peso en canal', hist.sacrificio.peso_canal_kg ? hist.sacrificio.peso_canal_kg + ' kg' : null)}
      ` : (a.estado === 'sacrificado' ? `<p class="small muted" style="margin-top:4px;">Marcado como sacrificado, sin detalle de rastro cargado.</p>` : `
      <form id="formSacrificioMonitoreo" style="margin-top:8px;">
        <label>Rastro</label>
        <select name="rastro_id">
          <option value="">Elegir uno ya cargado…</option>
          ${rastros.map(rr => `<option value="${rr.id}">${esc(rr.nombre)}${rr.numero_tif ? ' (TIF ' + esc(rr.numero_tif) + ')' : ''}</option>`).join('')}
        </select>
        <div class="form-section-title" style="font-size:12.5px;">o cargá uno nuevo</div>
        <div class="row" style="gap:8px;margin-top:8px;">
          <input name="rastro_nombre" placeholder="Nombre del rastro" style="flex:2;">
          <input name="rastro_tif" placeholder="N° TIF (opcional)" style="flex:1;">
        </div>
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="folio_oficial" placeholder="Folio oficial (opcional)" style="flex:1;">
          <input name="peso_canal_kg" type="number" step="0.1" min="0" placeholder="Peso en canal (kg)" style="flex:1;">
        </div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Registrar sacrificio</button>
      </form>`)}
    </div>
    <div class="card">
      <h3>🚚 Guía de movilización</h3>
      ${hist.guias.length ? hist.guias.map(g => `
        <p class="small muted" style="margin-top:4px;">${fmtFechaEvento(g.fecha)} — <b style="color:var(--texto);">${esc(g.folio)}</b>: ${esc(g.origen)} → ${esc(g.destino)}${g.transportista ? ' · ' + esc(g.transportista) : ''}${g.motivo ? ' · ' + esc(g.motivo) : ''}</p>
      `).join('') : `<p class="small muted" style="margin-top:4px;">Sin guías emitidas.</p>`}
      ${a.estado === 'vivo' || a.estado === 'vendido' ? `
      <form id="formGuiaMonitoreo" style="margin-top:12px;">
        <div class="row" style="gap:8px;">
          <input name="origen" placeholder="Origen${a.ubicacion_actual ? ' (' + esc(a.ubicacion_actual) + ')' : ''}" style="flex:1;">
          <input name="destino" required placeholder="Destino" style="flex:1;">
        </div>
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="transportista" placeholder="Transportista (opcional)" style="flex:1;">
          <input name="folio" placeholder="N° de folio (opcional)" style="flex:1;">
        </div>
        <input name="motivo" placeholder="Motivo (opcional)" style="margin-top:9px;">
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Emitir guía</button>
      </form>` : ''}
    </div>
    ` : ''}
  `;
}

// Cablea los formularios de admin que arma renderResultadoMonitoreo()
// (sacrificio/guía) — separado de bindEvents() porque este contenido se
// inserta a mano (ejecutarBusquedaMonitoreo() parchea solo
// #resultadoMonitoreo, sin pasar por un renderApp() completo). Todos
// reejecutan la búsqueda al terminar para refrescar el resto de las
// tarjetas con el estado nuevo del animal (dueño, estado, historial).
function bindAccionesMonitoreoStaff(animalId){
  const formSacrificio = document.getElementById('formSacrificioMonitoreo');
  if (formSacrificio) formSacrificio.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formSacrificio);
    try {
      let rastroId = fd.get('rastro_id') ? Number(fd.get('rastro_id')) : null;
      const nombreNuevo = fd.get('rastro_nombre').trim();
      if (nombreNuevo) {
        const nuevo = await mockApi.crearRastro({ nombre: nombreNuevo, numero_tif: fd.get('rastro_tif').trim() || null });
        rastroId = nuevo.id;
      }
      if (!rastroId) throw new Error('Elegí un rastro ya cargado o completá el nombre de uno nuevo');
      await mockApi.registrarSacrificio({
        animal_id: animalId, rastro_id: rastroId,
        folio_oficial: fd.get('folio_oficial').trim() || null, peso_canal_kg: fd.get('peso_canal_kg') || null,
      });
      toast('Sacrificio registrado', '🥩');
      ejecutarBusquedaMonitoreo();
    } catch (err) { toast(err.message, '⚠️'); }
  };

  const formGuia = document.getElementById('formGuiaMonitoreo');
  if (formGuia) formGuia.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formGuia);
    try {
      await mockApi.registrarGuiaMovilizacion({
        animal_id: animalId, destino: fd.get('destino').trim(), origen: fd.get('origen').trim() || null,
        transportista: fd.get('transportista').trim() || null, folio: fd.get('folio').trim() || null,
        motivo: fd.get('motivo').trim() || null,
      });
      toast('Guía emitida', '🚚');
      ejecutarBusquedaMonitoreo();
    } catch (err) { toast(err.message, '⚠️'); }
  };
}

// Ejecuta (o reejecuta, p. ej. después de guardar un pesaje) la búsqueda y
// parchea solo el resultado — a propósito NO llama a renderApp(), así no
// se pierde el foco ni lo que haya tipeado/escaneado en el input.
async function ejecutarBusquedaMonitoreo(){
  const input = document.getElementById('monitoreoInput');
  const destino = document.getElementById('resultadoMonitoreo');
  if (!input || !destino) return;
  const query = input.value.trim();
  if (!query) { destino.innerHTML = ''; return; }
  let r;
  try { r = await mockApi.buscarAnimalMonitoreo(query); }
  catch (err) { toast(err.message, '⚠️'); return; }
  monitoreoQueryActual = query;
  destino.innerHTML = await renderResultadoMonitoreo(r, query);
  if (r) bindAccionesMonitoreoStaff(r.animal.id);
}

// Cargar chips nuevos es una decisión de compra/presupuesto — solo el
// admin la ve (y mockApi.registrarLoteChips() la exige aparte, así que
// esto no es solo "ocultar el botón").
// Cuántos chips de cada lote siguen en stock vs ya se asignaron — la
// misma pregunta que "aretes revendidos a sobreprecio por fuera del canal
// oficial" (README, sección 5) necesita para auditar: de qué proveedor
// vino cada chip y qué pasó con el lote completo, no solo el total global.
function distribucionChipsPorLote(db){
  return db.lotes_chips.map(lote => {
    const chips = db.inventario_chips.filter(c => c.lote_id === lote.id);
    return {
      lote, cantidad: chips.length,
      enStock: chips.filter(c => c.estado === 'en_stock').length,
      asignados: chips.filter(c => c.estado === 'asignado').length,
    };
  }).sort((a, b) => b.cantidad - a.cantidad);
}

// Dónde terminaron los chips YA asignados — se arma desde `animales`
// (cada animal certificado = un chip asignado) siguiendo al propietario
// actual hasta su municipio. Los "en stock" no tienen dueño todavía, así
// que no entran acá — esto es distribución geográfica de lo YA repartido.
function distribucionChipsPorMunicipio(db){
  const porMunicipio = {};
  db.animales.forEach(a => {
    const dueño = db.perfiles.find(p => p.id === a.propietario_actual_id);
    const m = (dueño && dueño.municipio) || 'Sin especificar';
    porMunicipio[m] = (porMunicipio[m] || 0) + 1;
  });
  return Object.entries(porMunicipio).sort((a, b) => b[1] - a[1]);
}

// Tabla compacta con buscador — mismo patrón que "Usuarios por municipio" en
// el Resumen: evita que la vista crezca sin límite con muchos lotes o
// muchos municipios, y el buscador filtra en el propio JS (ver
// bindEvents), no perdiendo el foco en cada tecla.
function bloqueTablaBuscable({ inputId, cuerpoId, sinResultadosId, columnas, filas, placeholder = 'Buscar…', vacio = 'Todavía no hay datos para mostrar acá.' }){
  if (!filas.length) return `<div class="empty">${vacio}</div>`;
  return `
    <input id="${inputId}" placeholder="${placeholder}" style="margin-top:10px;">
    <div class="tabla-scroll" style="margin-top:8px;">
      <table class="tabla-simple">
        <thead><tr>${columnas.map((c, i) => `<th ${i > 0 ? 'style="text-align:right;"' : ''}>${c}</th>`).join('')}</tr></thead>
        <tbody id="${cuerpoId}">${filas}</tbody>
      </table>
    </div>
    <p id="${sinResultadosId}" class="small muted" style="display:none;margin-top:8px;text-align:center;">Sin resultados.</p>`;
}

// Genera la lista secuencial de chips entre dos números (ambos incluidos),
// para no tener que tipear a mano cada uno de un lote de cientos. Usa
// BigInt porque el código ISO 11784/85 tiene 15 dígitos y el padding con
// ceros a la izquierda se conserva igual que en el campo "Desde" (p. ej.
// 484000000000001 → 484000000000050 = 50 chips, no 4.8e14). Devuelve null
// si no se completó el intervalo, para que el caller caiga a la lista
// manual del textarea.
function chipsDelIntervalo(desde, hasta){
  if (!desde && !hasta) return null;
  if (!desde || !hasta) throw new Error('Para cargar por intervalo hay que completar "Desde" y "Hasta"');
  if (!/^\d+$/.test(desde) || !/^\d+$/.test(hasta)) throw new Error('El intervalo de chips debe ser numérico');
  const ini = BigInt(desde), fin = BigInt(hasta);
  if (fin < ini) throw new Error('El chip "Hasta" no puede ser menor que el chip "Desde"');
  const cantidad = fin - ini + 1n;
  if (cantidad > 5000n) throw new Error('El intervalo es demasiado grande (máximo 5000 chips por lote)');
  const largo = desde.length;
  const chips = [];
  for (let n = ini; n <= fin; n++) chips.push(n.toString().padStart(largo, '0'));
  return chips;
}

async function viewInventario(session){
  // distribucionChipsPorLote()/distribucionChipsPorMunicipio() (más
  // arriba) son puras — siguen recibiendo el mismo "db" de siempre, solo
  // que ahora se arma con lo que llega de Supabase en vez de leerse de
  // loadDB(). RLS ya deja ver todo esto a admin.
  const [inventarioChips, lotesChips, animales, perfiles] = await Promise.all([
    supabaseClient.from('inventario_chips').select('*'),
    supabaseClient.from('lotes_chips').select('*'),
    supabaseClient.from('animales').select('id, propietario_actual_id'),
    supabaseClient.from('perfiles').select('id, municipio'),
  ]);
  for (const r of [inventarioChips, lotesChips, animales, perfiles]) {
    if (r.error) throw new Error(r.error.message);
  }
  const db = { inventario_chips: inventarioChips.data, lotes_chips: lotesChips.data, animales: animales.data, perfiles: perfiles.data };
  const enStock = db.inventario_chips.filter(c => c.estado === 'en_stock').length;
  const asignados = db.inventario_chips.filter(c => c.estado === 'asignado').length;
  const invalidados = db.inventario_chips.filter(c => c.estado === 'invalidado').length;

  const filasLote = distribucionChipsPorLote(db).map(({ lote, cantidad, enStock: es, asignados: as }) => `
    <tr data-buscar="${esc((lote.proveedor + ' ' + (lote.numero_lote || '')).toLowerCase())}">
      <td>${esc(lote.proveedor)}${lote.numero_lote ? ` <span class="small muted">· ${esc(lote.numero_lote)}</span>` : ''}</td>
      <td style="text-align:right;">${cantidad}</td>
      <td style="text-align:right;">${es}</td>
      <td style="text-align:right;font-weight:800;">${as}</td>
    </tr>`).join('');

  const filasMunicipioChips = distribucionChipsPorMunicipio(db).map(([municipio, n]) => `
    <tr data-buscar="${municipio.toLowerCase()}" data-ver-municipio="${municipio}" style="cursor:pointer;">
      <td>${municipio}</td>
      <td style="text-align:right;font-weight:800;">${n}</td>
    </tr>`).join('');

  const bloqueLote = session.rol === 'admin' ? `
    <div class="card">
      <h3>Cargar lote nuevo</h3>
      <form id="formLote">
        <label>Proveedor</label>
        <input name="proveedor" required placeholder="p. ej. Datamars México">
        <label>Número de lote</label>
        <input name="numero_lote" placeholder="Opcional">
        <label>Precio oficial por chip (MXN)</label>
        <input name="precio_oficial" type="number" step="0.01" required>
        <label>Intervalo de chips</label>
        <div class="row" style="gap:8px;">
          <input name="chip_inicial" placeholder="Desde — p. ej. 484000000000001" style="flex:1;">
          <input name="chip_final" placeholder="Hasta — p. ej. 484000000000050" style="flex:1;">
        </div>
        <label>Números de chip (uno por línea)</label>
        <textarea name="chip_uids" placeholder="484000000000001&#10;484000000000002"></textarea>
        <button class="btn btn-primary btn-block" type="submit">Cargar lote</button>
      </form>
    </div>` : `
    <div class="card">
      <p class="small muted">Solo un admin puede cargar lotes nuevos de chips. Si hace falta stock, avisale a Administración.</p>
    </div>`;
  return `
    <div class="card">
      <div class="row" style="justify-content:space-around;text-align:center;">
        <div><b style="font-size:1.3rem;">${enStock}</b><div class="small muted">En stock</div></div>
        <div><b style="font-size:1.3rem;">${asignados}</b><div class="small muted">Asignados</div></div>
        ${invalidados ? `<div><b style="font-size:1.3rem;">${invalidados}</b><div class="small muted">Invalidados</div></div>` : ''}
        <div><b style="font-size:1.3rem;">${db.lotes_chips.length}</b><div class="small muted">Lotes cargados</div></div>
      </div>
    </div>
    <div class="card">
      <h3>📦 Distribución por lote</h3>
      <p class="small muted" style="margin-top:4px;">De qué proveedor vino cada chip y cuántos de ese lote ya se asignaron — clave para auditar si algo se está revendiendo por fuera del canal oficial.</p>
      ${bloqueTablaBuscable({
        inputId: 'buscarLoteInventario', cuerpoId: 'cuerpoLoteInventario', sinResultadosId: 'sinResultadosLoteInventario',
        columnas: ['Proveedor / lote', 'Cargados', 'En stock', 'Asignados'], filas: filasLote,
        placeholder: 'Buscar proveedor o N° de lote…', vacio: 'Todavía no se cargó ningún lote de chips.',
      })}
    </div>
    <div class="card">
      <h3>🗺️ Chips asignados por municipio</h3>
      ${bloqueTablaBuscable({
        inputId: 'buscarMunicipioChips', cuerpoId: 'cuerpoMunicipioChips', sinResultadosId: 'sinResultadosMunicipioChips',
        columnas: ['Municipio', 'Chips asignados'], filas: filasMunicipioChips,
        placeholder: 'Buscar municipio…', vacio: 'Todavía no hay ningún chip asignado.',
      })}
    </div>
    ${bloqueLote}`;
}

// Tarjeta de una cuenta — la usa "Usuarios" (ganadero/admin): promover de
// rol, eliminar/reactivar.
function tarjetaCuenta(p, session){
  const desactivada = p.activo === false;
  const rolPill = desactivada ? 'baja' : p.rol === 'admin' ? 'aprobada' : 'pendiente';
  const esUnoMismo = p.id === session.id;
  const accionesCuenta = desactivada
    ? `<button class="btn btn-ghost" data-reactivar-btn="${p.id}" style="margin-top:8px;">♻️ Reactivar cuenta</button>`
    : (esUnoMismo ? '' : `<button class="btn btn-danger" data-eliminar-btn="${p.id}" style="margin-top:8px;">🗑️ Eliminar cuenta</button>`);
  return `
    <div class="card" style="${desactivada ? 'opacity:.6;' : ''}">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div><b>${esc(p.nombre)}</b>${esUnoMismo ? ' <span class="small muted">(vos)</span>' : ''}<div class="small muted">${esc(p.rancho_o_empresa) || '—'}${p.municipio ? ' · ' + esc(p.municipio) : ''}</div></div>
        <span class="pill pill-${rolPill}">${desactivada ? 'Desactivada' : etiquetaRol(p.rol)}</span>
      </div>
      ${!desactivada ? `
      <div class="row" style="margin-top:10px;">
        <select data-promover-select="${p.id}" style="flex:1;">
          <option value="ganadero" ${p.rol === 'ganadero' ? 'selected' : ''}>Ganadero</option>
          <option value="admin" ${p.rol === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
        <button class="btn btn-ghost" data-promover-btn="${p.id}">Guardar</button>
      </div>` : ''}
      ${accionesCuenta}
    </div>`;
}

// Pedidos Gana ID — ver el comentario grande en
// supabase/migrations/20260915120000_pedidos_externos_ganaid.sql. Los
// pendientes van primero y quedan siempre visibles (son los que hay que
// resolver); aplicados/descartados quedan colapsados abajo, mismo
// criterio que "chips reservados" en tarjetaCliente() — es historial, no
// algo que compita por atención con lo urgente.
async function viewPedidosGanaID(){
  const [pedidos, clientes, codigos] = await Promise.all([
    mockApi.listarPedidosExternos(),
    mockApi.listarClientes(),
    mockApi.listarCodigosPromocionales(),
  ]);

  const nombrePorPerfil = new Map(clientes.map(c => [c.id, c.nombre]));
  const pendientes = pedidos.filter(p => p.estado === 'pendiente');
  const resueltos = pedidos.filter(p => p.estado !== 'pendiente');

  const bloquePendientes = pendientes.length
    ? pendientes.map(p => tarjetaPedidoExterno(p, nombrePorPerfil)).join('')
    : `<div class="empty">No hay pedidos pendientes por resolver.</div>`;

  const bloqueResueltos = resueltos.length ? `
    <details style="margin-top:14px;">
      <summary class="small muted" style="cursor:pointer;">Ver ${resueltos.length} pedido${resueltos.length === 1 ? '' : 's'} ya resuelto${resueltos.length === 1 ? '' : 's'}</summary>
      <div style="margin-top:10px;">${resueltos.map(p => tarjetaPedidoExterno(p, nombrePorPerfil)).join('')}</div>
    </details>` : '';

  return bloqueCodigosPromocionales(codigos) + `<div class="form-section-title">Pedidos</div>` + bloquePendientes + bloqueResueltos;
}

// Códigos de promoción — canje único por cuenta (lo valida el servidor),
// pensado para campañas de marketing/lanzamiento en vez de una compra
// puntual (eso ya lo cubren los pedidos de más abajo). Ver
// supabase/migrations/20260924090000_reactivar_limite_y_codigos_promo.sql.
function bloqueCodigosPromocionales(codigos){
  const activos = codigos.filter(c => c.activo);
  const inactivos = codigos.filter(c => !c.activo);
  return `
    <div class="card">
      <h3 class="section-title">🎟️ Códigos de promoción</h3>
      <form id="formCrearCodigoPromo" style="margin-top:8px;">
        <div class="row" style="gap:8px;">
          <input name="codigo" placeholder="Código — p. ej. LANZAMIENTO2026" style="flex:2;text-transform:uppercase;" required>
          <select name="meses" style="flex:1;">
            <option value="3">3 meses</option>
            <option value="6" selected>6 meses</option>
            <option value="9">9 meses</option>
          </select>
        </div>
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="descripcion" placeholder="Descripción (opcional)" style="flex:1;">
          <input name="max_usos" type="number" min="1" placeholder="Tope de usos (opcional)" style="flex:1;">
          <input name="vence" type="date" title="Vence (opcional)" style="flex:1;">
        </div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:9px;">➕ Crear código</button>
      </form>
      ${activos.length ? `
      <div style="margin-top:14px;">
        ${activos.map(tarjetaCodigoPromocional).join('')}
      </div>` : ''}
      ${inactivos.length ? `
      <details style="margin-top:10px;">
        <summary class="small muted" style="cursor:pointer;">Ver ${inactivos.length} código${inactivos.length === 1 ? '' : 's'} desactivado${inactivos.length === 1 ? '' : 's'}</summary>
        <div style="margin-top:10px;">${inactivos.map(tarjetaCodigoPromocional).join('')}</div>
      </details>` : ''}
    </div>`;
}

function tarjetaCodigoPromocional(c){
  const usosTexto = c.max_usos ? `${c.usos_actuales}/${c.max_usos} uso(s)` : `${c.usos_actuales} uso(s)`;
  return `
    <div class="card-flat" style="margin-top:8px;${c.activo ? '' : 'opacity:.6;'}">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <b>${esc(c.codigo)}</b>
        <span class="pill pill-${c.activo ? 'aprobada' : 'rechazada'}">${c.activo ? 'Activo' : 'Desactivado'}</span>
      </div>
      <div class="small muted" style="margin-top:2px;">${c.meses} mes(es) · ${usosTexto}${c.vence ? ' · vence ' + fmtFecha(c.vence) : ''}</div>
      ${c.descripcion ? `<div class="small muted">${esc(c.descripcion)}</div>` : ''}
      ${c.activo ? `<button class="btn btn-ghost" data-desactivar-codigo="${c.id}" style="margin-top:8px;padding:5px 10px;font-size:11px;">Desactivar</button>` : ''}
    </div>`;
}

function tarjetaPedidoExterno(p, nombrePorPerfil){
  const esChip = p.tipo === 'chip_lote';
  const pendiente = p.estado === 'pendiente';
  const pillEstado = p.estado === 'pendiente' ? 'pendiente' : p.estado === 'aplicado' ? 'aprobada' : 'rechazada';
  const etiquetaEstado = p.estado === 'pendiente' ? 'Pendiente' : p.estado === 'aplicado' ? 'Aplicado' : 'Descartado';
  const nombreGanadero = p.perfil_id ? (nombrePorPerfil.get(p.perfil_id) || '(cuenta sin nombre)') : null;

  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <b>${esChip ? '📦 Lote de chips' : '💳 Crédito de suscripción'}</b>
        <span class="pill pill-${pillEstado}">${etiquetaEstado}</span>
      </div>
      <div class="small muted" style="margin-top:6px;">
        ${esc(p.comprador_nombre) || '(sin nombre)'} ${p.comprador_email ? '· 📧 ' + esc(p.comprador_email) : ''}
      </div>
      <div class="small muted">
        ${esChip ? `${p.cantidad || '?'} chip(s)` : `${p.meses || '?'} mes(es)`} · SKU: ${esc(p.sku) || '—'} · Pago MP #${esc(p.mp_payment_id)}
      </div>
      <div class="small muted">${fmtFecha(p.created_at)}</div>
      ${!pendiente ? `<div class="small muted" style="margin-top:4px;">${p.lote_id ? `Vinculado al lote #${p.lote_id}` : nombreGanadero ? `Aplicado a ${esc(nombreGanadero)}` : ''}</div>` : ''}

      ${pendiente && esChip ? `
      <div class="row" style="margin-top:10px;">
        <input type="number" min="1" placeholder="ID del lote ya cargado (opcional)" data-pedido-lote="${p.id}" style="flex:1;">
        <button class="btn btn-ghost" data-pedido-aplicar-chip="${p.id}">Marcar aplicado</button>
        <button class="btn btn-ghost" data-pedido-descartar="${p.id}">Descartar</button>
      </div>
      <p class="small muted" style="margin-top:4px;">Primero cargá el lote real en "Inventario de chips" (con los UID físicos) — acá solo queda anotado cuál, si querés.</p>
      ` : ''}

      ${pendiente && !esChip ? `
      <div class="row" style="margin-top:10px;">
        ${p.perfil_id
          ? `<button class="btn btn-ghost" style="flex:1;" data-pedido-aplicar-credito="${p.id}" data-pedido-credito-perfil="${p.perfil_id}">Aplicar a ${esc(nombreGanadero)}</button>`
          : `<input placeholder="Email del ganadero ya registrado" data-pedido-credito-email="${p.id}" style="flex:1;">
             <button class="btn btn-ghost" data-pedido-buscar-y-aplicar-credito="${p.id}">Aplicar crédito</button>`}
        <button class="btn btn-ghost" data-pedido-descartar="${p.id}">Descartar</button>
      </div>
      ` : ''}
    </div>`;
}

// Ganadero y admin acá.
async function viewUsuarios(session){
  const perfilesTodos = await mockApi.listarUsuarios();

  const formAlta = `
    <div class="card">
      <h3>Invitar una cuenta directo</h3>
      <form id="formCrearStaff">
        <label>Email</label>
        <input name="email" type="email" required placeholder="email@ejemplo.com">
        <label>Nombre (sugerido)</label>
        <input name="nombre" required placeholder="Nombre completo">
        <label>Rol</label>
        <select name="rol" required>
          <option value="ganadero">Ganadero</option>
          <option value="admin">Admin</option>
        </select>
        <label>Municipio</label>
        ${selectMunicipios('municipio')}
        <label>Rancho / empresa</label>
        <input name="rancho_o_empresa" placeholder="Opcional">
        <button class="btn btn-primary btn-block" type="submit">Invitar</button>
      </form>
    </div>`;
  const conteoPorRol = { todos: perfilesTodos.length, ganadero: 0, admin: 0 };
  perfilesTodos.forEach(p => { conteoPorRol[p.rol] = (conteoPorRol[p.rol] || 0) + 1; });
  const chipsFiltro = [
    ['todos', 'Todos'], ['ganadero', 'Ganaderos'], ['admin', 'Admins'],
  ].map(([valor, etiqueta]) => `
    <button class="btn ${filtroUsuarios === valor ? 'btn-primary' : 'btn-ghost'}" data-filtro-usuarios="${valor}" style="padding:6px 12px;font-size:13.5px;">
      ${etiqueta} (${conteoPorRol[valor] || 0})
    </button>`).join('');
  const bloqueFiltro = `<div class="row" style="gap:6px;flex-wrap:wrap;margin:4px 0 10px;column-span:all;">${chipsFiltro}</div>`;

  const perfilesCompletos = filtroUsuarios === 'todos' ? perfilesTodos : perfilesTodos.filter(p => p.rol === filtroUsuarios);
  const perfiles = perfilesCompletos.slice(0, mostrarLimite.usuarios);
  const lista = perfiles.map(p => tarjetaCuenta(p, session)).join('');
  const listaVacia = filtroUsuarios === 'todos'
    ? `<div class="empty">Todavía no hay ninguna cuenta.</div>`
    : `<div class="empty">No hay cuentas de ${etiquetaRol(filtroUsuarios).toLowerCase()}.</div>`;
  return formAlta + bloqueFiltro + (lista || listaVacia) + botonCargarMas('usuarios', perfilesCompletos.length, perfiles.length);
}

// "Clientes" — vista de negocio, separada de "Usuarios" (que es
// roles/altas): quién te paga, si está al día, y cuántos chips lleva
// comprados (= sus animales registrados, cada uno salió de un chip del
// inventario oficial — no hace falta llevar esa cuenta aparte). No hay
// "dar de alta" acá: un cliente nuevo se registra solo desde la app de
// Ganadero (autorregistro abierto), como cualquier ganadero — esta
// pestaña es nomás para ver y marcar el estado de pago.
async function viewClientes(){
  const clientesCompletos = await mockApi.listarClientes();
  const clientes = clientesCompletos.slice(0, mostrarLimite.clientes);
  const lista = clientes.map(tarjetaCliente).join('');
  const listaVacia = `<div class="empty">Todavía no hay ningún cliente registrado.</div>`;
  return (lista || listaVacia) + botonCargarMas('clientes', clientesCompletos.length, clientes.length);
}

function tarjetaCliente(c){
  const alDia = c.plan_estado === 'al_dia';
  const etiquetaPlan = c.plan_tipo === 'gratis' ? '🌱 Gratis' : c.plan_tipo === 'anual' ? '💳 Anual' : '💳 Mensual';
  return `
    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <div>
          <b>${esc(c.nombre)}</b>${c.activo === false ? ' <span class="small muted">(cuenta desactivada)</span>' : ''}
          <div class="small muted">${esc(c.rancho_o_empresa) || '—'}</div>
        </div>
        <div style="text-align:right;">
          <span class="pill pill-${c.plan_tipo === 'gratis' ? 'invalidado' : (alDia ? 'aprobada' : 'rechazada')}">${c.plan_tipo === 'gratis' ? etiquetaPlan : (alDia ? 'Al día' : 'Vencido')}</span>
          ${c.plan_tipo !== 'gratis' ? `<div class="small muted" style="margin-top:2px;">${etiquetaPlan}</div>` : ''}
        </div>
      </div>
      <div class="small muted" style="margin-top:6px;">
        📧 ${esc(c.correo) || '—'} ${c.telefono ? '· 📱 ' + esc(c.telefono) : ''}
      </div>
      <div class="small muted">🪪 ${c.total_chips} chip${c.total_chips === 1 ? '' : 's'} comprado${c.total_chips === 1 ? '' : 's'} · 🏡 ${c.total_ranchos} rancho${c.total_ranchos === 1 ? '' : 's'}</div>
      <div class="row" style="margin-top:10px;">
        <select data-plan-select="${c.id}" style="flex:1;">
          <option value="al_dia" ${alDia ? 'selected' : ''}>Al día</option>
          <option value="vencido" ${!alDia ? 'selected' : ''}>Vencido</option>
        </select>
        <input type="date" data-plan-fecha="${c.id}" value="${c.fecha_proximo_pago || ''}" title="Próximo pago" style="flex:1;">
        <button class="btn btn-ghost" data-plan-btn="${c.id}">Guardar</button>
      </div>
      <details style="margin-top:10px;">
        <summary class="small muted" style="cursor:pointer;">
          📴 ${c.chips_reservados} chip${c.chips_reservados === 1 ? '' : 's'} listo${c.chips_reservados === 1 ? '' : 's'} para usar sin señal
        </summary>
        <p class="small muted" style="margin-top:6px;">
          Reservale un lotecito de chips — su celular los descarga para poder identificar animales nuevos aunque no tenga señal en el momento.
        </p>
        <div class="row" style="margin-top:6px;">
          <input type="number" min="1" data-reservar-cantidad="${c.id}" placeholder="Cantidad" style="flex:1;">
          <button class="btn btn-ghost" data-reservar-btn="${c.id}">Reservar</button>
          ${c.chips_reservados > 0 ? `<button class="btn btn-ghost" data-liberar-btn="${c.id}">Liberar todos</button>` : ''}
        </div>
      </details>
    </div>`;
}

function etiquetaAccionAuditoria(accion){
  return {
    bootstrap_admin: '👤 Arranque de admin',
    crear_cuenta: '➕ Cuenta creada',
    promover_usuario: '🔄 Rol actualizado',
    cargar_lote: '📦 Lote de chips cargado',
    registrar_animal_directo: '🪪 Animal identificado',
    dar_de_baja_animal: '☠️ Animal dado de baja',
    eliminar_usuario: '🗑️ Cuenta eliminada',
    desactivar_usuario: '🚫 Cuenta desactivada',
    reactivar_usuario: '♻️ Cuenta reactivada',
    actualizar_plan_cliente: '💳 Plan actualizado',
    reservar_chips: '📴 Chips reservados para uso sin señal',
    marcar_pedido_externo_aplicado: '📦 Pedido de Gana ID aplicado',
    descartar_pedido_externo: '🗑️ Pedido de Gana ID descartado',
    aplicar_credito_suscripcion: '💳 Crédito de suscripción aplicado',
    crear_codigo_promocional: '🎟️ Código de promoción creado',
    desactivar_codigo_promocional: '🎟️ Código de promoción desactivado',
    canjear_codigo_promocional: '🎟️ Código de promoción canjeado',
  }[accion] || accion;
}

// Exclusiva de admin — es el registro de lo que hace TODO el staff.
// Estado del filtro de fecha de Auditoría — mismo criterio que
// filtroUsuarios: variable de módulo, se aplica ANTES de mostrarLimite
// (pagina sobre lo ya filtrado, no filtra solo lo que ya se cargó en
// pantalla).
let filtroFechaAuditoriaDesde = '';
let filtroFechaAuditoriaHasta = '';

async function viewAuditoria(){
  const todaLaAuditoria = await mockApi.listarAuditoria();
  if (!todaLaAuditoria.length) return `<div class="empty">Todavía no hay actividad registrada.</div>`;

  const hayFiltroFecha = filtroFechaAuditoriaDesde || filtroFechaAuditoriaHasta;
  const bloqueFiltro = `
    <div class="card">
      <h3>📅 Filtrar por fecha</h3>
      <div class="row" style="gap:8px;margin-top:8px;">
        <div style="flex:1;min-width:130px;">
          <label style="margin:0 0 4px;">Desde</label>
          <input type="date" id="filtroFechaAuditoriaDesde" value="${filtroFechaAuditoriaDesde}">
        </div>
        <div style="flex:1;min-width:130px;">
          <label style="margin:0 0 4px;">Hasta</label>
          <input type="date" id="filtroFechaAuditoriaHasta" value="${filtroFechaAuditoriaHasta}">
        </div>
      </div>
      ${hayFiltroFecha ? `<button class="btn btn-ghost btn-block" id="btnLimpiarFiltroFechaAuditoria" type="button" style="margin-top:8px;">✕ Limpiar filtro</button>` : ''}
    </div>`;

  const listaCompleta = todaLaAuditoria
    .filter(a => !filtroFechaAuditoriaDesde || a.created_at.slice(0, 10) >= filtroFechaAuditoriaDesde)
    .filter(a => !filtroFechaAuditoriaHasta || a.created_at.slice(0, 10) <= filtroFechaAuditoriaHasta);

  if (!listaCompleta.length) return bloqueFiltro + `<div class="empty">Nada registrado en ese rango de fechas.</div>`;

  const lista = listaCompleta.slice(0, mostrarLimite.auditoria);
  const tarjetas = lista.map(a => `
    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <b>${etiquetaAccionAuditoria(a.accion)}</b>
        <span class="small muted">${fmtFecha(a.created_at)}</span>
      </div>
      <p class="small muted" style="margin-top:4px;">${esc(a.detalle)}</p>
      <p class="small muted" style="margin-top:2px;">Por: ${esc(a.actor_nombre)}</p>
    </div>`).join('');
  return bloqueFiltro + tarjetas + botonCargarMas('auditoria', listaCompleta.length, lista.length);
}

// El código de invitación solo se muestra UNA vez, recién generado — no
// queda visible en ningún lado después. Por eso es un modal que hay que
// cerrar a propósito, no un toast que desaparece solo en 3 segundos.
// Acepta uno o varios {nombre, codigo} — sirve tanto para el caso de "un
// solo ganadero" como para cargar la lista completa de una asamblea de
// una sola vez. "Copiar todo" arma un bloque de texto listo para pegar en
// un WhatsApp (uno por línea, "Nombre: CÓDIGO").
// "Hoja" de un municipio — se abre al tocar cualquier fila de las tablas
// de municipio (Resumen y Inventario). Junta lo que mockApi.
// resumenMunicipio() ya cruzó: quiénes son los ganaderos ahí, cómo está
// compuesto su ganado (razas, estados), y los últimos movimientos —
// mismo criterio de "solo admin" que el resto del panel, la función ya
// lo exige del lado de los datos.
async function abrirModalMunicipio(municipio){
  let r;
  try { r = await mockApi.resumenMunicipio(municipio); }
  catch (err) { toast(err.message, '⚠️'); return; }

  const filaGanadero = (g) => `
    <tr>
      <td>${esc(g.nombre)}</td>
      <td>${esc(g.rancho_o_empresa) || '—'}</td>
      <td>${esc(g.telefono) || '—'}</td>
    </tr>`;

  const razaMax = r.animales.porRaza.length ? r.animales.porRaza[0][1] : 1;
  const filaRaza = ([raza, n]) => `
    <div style="margin-top:8px;">
      <div class="row" style="justify-content:space-between;font-size:13.5px;"><span>${esc(raza)}</span><b>${n}</b></div>
      <div style="height:6px;border-radius:3px;background:var(--barra-track);margin-top:3px;overflow:hidden;">
        <div style="height:100%;width:${((n / razaMax) * 100).toFixed(0)}%;background:var(--dorado);"></div>
      </div>
    </div>`;

  // resumen_municipio() (RPC) devuelve "subtipo" crudo, no una etiqueta
  // ya armada como antes — se resuelve acá con la misma función que usa
  // el resto de la app para lo mismo.
  const etiquetaMovimiento = (m) => etiquetaTipoEvento(m.subtipo);
  const filaMovimiento = (m) => `
    <div class="row" style="justify-content:space-between;margin-top:6px;">
      <span class="small">${etiquetaMovimiento(m)} <span class="muted">— ${esc(m.detalle)}</span></span>
      <span class="small muted" style="white-space:nowrap;">${fmtFecha(m.fecha)}</span>
    </div>`;

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h3 style="margin:0;">🗺️ ${r.municipio}</h3>
        <span class="pill pill-vivo">${r.ganaderos.length} ganadero${r.ganaderos.length === 1 ? '' : 's'}</span>
      </div>

      <div class="row" style="gap:8px;margin-top:12px;">
        <div class="card" style="flex:1;text-align:center;padding:10px;margin:0;"><b style="font-size:1.2rem;">${r.animales.total}</b><div class="small muted">Animales</div></div>
        <div class="card" style="flex:1;text-align:center;padding:10px;margin:0;"><b style="font-size:1.2rem;">${r.animales.porEstado.vivo || 0}</b><div class="small muted">Vivos</div></div>
        <div class="card" style="flex:1;text-align:center;padding:10px;margin:0;"><b style="font-size:1.2rem;">${r.animales.porEstado.baja || 0}</b><div class="small muted">Baja</div></div>
      </div>

      <div class="form-section-title">👤 Ganaderos</div>
      ${r.ganaderos.length ? `
      <div class="tabla-scroll" style="max-height:160px;">
        <table class="tabla-simple">
          <thead><tr><th>Nombre</th><th>Rancho / empresa</th><th>Teléfono</th></tr></thead>
          <tbody>${r.ganaderos.map(filaGanadero).join('')}</tbody>
        </table>
      </div>` : `<div class="empty">Sin ganaderos activos acá.</div>`}

      <div class="form-section-title">Animales por raza</div>
      ${r.animales.porRaza.length ? r.animales.porRaza.map(filaRaza).join('') : `<div class="empty">Todavía no hay animales identificados.</div>`}

      <div class="form-section-title">📋 Movimientos recientes</div>
      ${r.movimientos.length ? `<div style="max-height:180px;overflow-y:auto;">${r.movimientos.map(filaMovimiento).join('')}</div>` : `<div class="empty">Sin movimientos todavía.</div>`}

      <button class="btn btn-ghost btn-block" id="btnCerrarModalMunicipio" style="margin-top:14px;">Cerrar</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('btnCerrarModalMunicipio').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

function bindEvents(){
  const app = document.getElementById('app');

  const btnLogout = app.querySelector('[data-logout]');
  // No hace falta renderApp() acá — onAuthStateChange (shared/
  // auth-supabase.js) se entera solo del logout y ya vuelve a pintar.
  if (btnLogout) btnLogout.onclick = () => {
    activeTab = null; filtroUsuarios = 'todos'; filtroFechaAuditoriaDesde = ''; filtroFechaAuditoriaHasta = '';
    mockApi.logout();
  };

  // "Reiniciar simulación" ahora vive en el menú de usuario (ver
  // abrirMenuUsuario(), shared/ui-common.js) — ya no hay un [data-reset]
  // suelto en la barra lateral para cablear.
  bindInstalarApp();
  bindIconoMenuUsuario();

  const btnExportarRespaldo = document.getElementById('btnExportarRespaldo');
  if (btnExportarRespaldo) btnExportarRespaldo.onclick = exportarRespaldoExcel;

  app.querySelectorAll('[data-tab]').forEach(t => t.onclick = () => { activeTab = t.dataset.tab; renderApp(); });
  // El contenedor del mapa (#mapaAdministracion) recién existe en el DOM
  // después de este innerHTML — por eso se dispara acá, no desde viewMapa()
  // (que solo arma el HTML). No se espera la promesa: es una carga en
  // segundo plano (geocodificación + Leaflet) que va actualizando el
  // contenedor sola a medida que consigue datos.
  if (activeTab === 'mapa') iniciarMapaAdmin();
  app.querySelectorAll('[data-filtro-usuarios]').forEach(b => b.onclick = () => {
    filtroUsuarios = b.dataset.filtroUsuarios;
    mostrarLimite.usuarios = 20;
    renderApp();
  });

  const filtroFechaAuditoriaDesdeInput = document.getElementById('filtroFechaAuditoriaDesde');
  if (filtroFechaAuditoriaDesdeInput) filtroFechaAuditoriaDesdeInput.onchange = () => {
    filtroFechaAuditoriaDesde = filtroFechaAuditoriaDesdeInput.value;
    mostrarLimite.auditoria = 20;
    renderApp();
  };
  const filtroFechaAuditoriaHastaInput = document.getElementById('filtroFechaAuditoriaHasta');
  if (filtroFechaAuditoriaHastaInput) filtroFechaAuditoriaHastaInput.onchange = () => {
    filtroFechaAuditoriaHasta = filtroFechaAuditoriaHastaInput.value;
    mostrarLimite.auditoria = 20;
    renderApp();
  };
  const btnLimpiarFiltroFechaAuditoria = document.getElementById('btnLimpiarFiltroFechaAuditoria');
  if (btnLimpiarFiltroFechaAuditoria) btnLimpiarFiltroFechaAuditoria.onclick = () => {
    filtroFechaAuditoriaDesde = '';
    filtroFechaAuditoriaHasta = '';
    mostrarLimite.auditoria = 20;
    renderApp();
  };
  // Buscador en vivo de cualquier tabla armada con bloqueTablaBuscable():
  // filtra las filas a mano (con display:none) en vez de llamar a
  // renderApp() en cada tecla — si reemplazáramos el innerHTML en cada
  // tecla, el input perdería el foco y habría que hacer clic de nuevo para
  // seguir escribiendo.
  function bindBuscadorTabla(inputId, cuerpoId, sinResultadosId){
    const input = document.getElementById(inputId);
    if (!input) return;
    input.oninput = () => {
      const q = input.value.trim().toLowerCase();
      let visibles = 0;
      document.querySelectorAll(`#${cuerpoId} tr`).forEach(fila => {
        const coincide = (fila.dataset.buscar || '').includes(q);
        fila.style.display = coincide ? '' : 'none';
        if (coincide) visibles++;
      });
      const sinResultados = document.getElementById(sinResultadosId);
      if (sinResultados) sinResultados.style.display = visibles === 0 ? '' : 'none';
    };
  }
  bindBuscadorTabla('buscarMunicipioResumen', 'cuerpoMunicipioResumen', 'sinResultadosMunicipio');
  bindBuscadorTabla('buscarLoteInventario', 'cuerpoLoteInventario', 'sinResultadosLoteInventario');
  bindBuscadorTabla('buscarMunicipioChips', 'cuerpoMunicipioChips', 'sinResultadosMunicipioChips');

  // Tocar cualquier fila de municipio (en Resumen o en Inventario) abre su
  // "hoja" — ganaderos, animales por raza y últimos movimientos.
  app.querySelectorAll('[data-ver-municipio]').forEach(fila => fila.onclick = () => abrirModalMunicipio(fila.dataset.verMunicipio));

  bindConsultarChip(app);

  // Monitoreo: Enter dispara la búsqueda igual que el botón (el lector
  // Bluetooth "tipea" el chip y remata con Enter), y el campo arranca
  // enfocado porque en esta pestaña no hay otra cosa que hacer más que
  // buscar/escanear.
  const monitoreoInput = document.getElementById('monitoreoInput');
  if (monitoreoInput) {
    monitoreoInput.value = monitoreoQueryActual;
    monitoreoInput.focus();
    monitoreoInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); ejecutarBusquedaMonitoreo(); } };
    if (monitoreoQueryActual) ejecutarBusquedaMonitoreo();
  }
  const btnBuscarMonitoreo = document.getElementById('btnBuscarMonitoreo');
  if (btnBuscarMonitoreo) btnBuscarMonitoreo.onclick = ejecutarBusquedaMonitoreo;
  app.querySelectorAll('[data-cargar-mas]').forEach(b => b.onclick = () => {
    mostrarLimite[b.dataset.cargarMas] += 20;
    renderApp();
  });

  const formCrearStaff = document.getElementById('formCrearStaff');
  if (formCrearStaff) formCrearStaff.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formCrearStaff);
    try {
      await mockApi.crearCuentaStaff({
        email: fd.get('email').trim(), rol: fd.get('rol'), nombre_sugerido: fd.get('nombre').trim(),
        rancho_sugerido: fd.get('rancho_o_empresa').trim(), municipio_sugerido: fd.get('municipio') || null,
      });
      toast('Invitación enviada — queda pendiente hasta que se registre con ese email', '✅');
      formCrearStaff.reset();
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };

  const formLote = document.getElementById('formLote');
  if (formLote) formLote.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formLote);
    try {
      const chipUids = chipsDelIntervalo(fd.get('chip_inicial').trim(), fd.get('chip_final').trim())
        || (fd.get('chip_uids') || '').split('\n').map(s => s.trim()).filter(Boolean);
      const r = await mockApi.registrarLoteChips(fd.get('proveedor').trim(), fd.get('numero_lote').trim() || null, parseFloat(fd.get('precio_oficial')), null, chipUids);
      toast(`Lote cargado: ${r.chips_cargados} chips`, '📦');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };

  app.querySelectorAll('[data-promover-btn]').forEach(b => b.onclick = async () => {
    const id = b.dataset.promoverBtn;
    const sel = app.querySelector(`[data-promover-select="${id}"]`);
    try {
      await mockApi.promoverUsuario(id, sel.value);
      toast('Rol actualizado', '✅');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-eliminar-btn]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar esta cuenta? Si tiene animales o eventos a su nombre, se desactiva en vez de borrarse (para no perder la trazabilidad).')) return;
    try {
      const r = await mockApi.eliminarUsuario(b.dataset.eliminarBtn);
      toast(r.eliminado ? 'Cuenta eliminada' : 'Tenía historial asociado — se desactivó en vez de borrarse', r.eliminado ? '🗑️' : '🚫');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-reactivar-btn]').forEach(b => b.onclick = async () => {
    try {
      await mockApi.reactivarUsuario(b.dataset.reactivarBtn);
      toast('Cuenta reactivada', '♻️');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-plan-btn]').forEach(b => b.onclick = async () => {
    const id = b.dataset.planBtn;
    const sel = app.querySelector(`[data-plan-select="${id}"]`);
    const fecha = app.querySelector(`[data-plan-fecha="${id}"]`);
    try {
      await mockApi.actualizarPlanCliente(id, sel.value, fecha.value);
      toast('Plan actualizado', '✅');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-reservar-btn]').forEach(b => b.onclick = async () => {
    const id = b.dataset.reservarBtn;
    const input = app.querySelector(`[data-reservar-cantidad="${id}"]`);
    const cantidad = parseInt(input.value, 10);
    if (!cantidad || cantidad <= 0) { toast('Escribí una cantidad válida', '⚠️'); return; }
    try {
      const r = await mockApi.reservarChipsCliente(id, cantidad);
      toast(`Reservados — ahora tiene ${r.reservados} chip(s) listos para usar sin señal`, '📴');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-liberar-btn]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Liberar todos los chips reservados de este cliente? Vuelven al pool general.')) return;
    try {
      await mockApi.liberarChipsCliente(b.dataset.liberarBtn);
      toast('Chips liberados', '♻️');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  const formCrearCodigoPromo = document.getElementById('formCrearCodigoPromo');
  if (formCrearCodigoPromo) formCrearCodigoPromo.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formCrearCodigoPromo);
    try {
      await mockApi.crearCodigoPromocional({
        codigo: fd.get('codigo').trim(), meses: parseInt(fd.get('meses'), 10),
        descripcion: fd.get('descripcion').trim() || null,
        maxUsos: fd.get('max_usos') ? parseInt(fd.get('max_usos'), 10) : null,
        vence: fd.get('vence') || null,
      });
      toast('Código creado', '🎟️');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };

  app.querySelectorAll('[data-desactivar-codigo]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Desactivar este código? Nadie más va a poder canjearlo.')) return;
    try {
      await mockApi.desactivarCodigoPromocional(Number(b.dataset.desactivarCodigo));
      toast('Código desactivado', '✅');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-pedido-aplicar-chip]').forEach(b => b.onclick = async () => {
    const id = Number(b.dataset.pedidoAplicarChip);
    const input = app.querySelector(`[data-pedido-lote="${id}"]`);
    const loteId = input && input.value ? Number(input.value) : null;
    try {
      await mockApi.marcarPedidoExternoAplicado(id, loteId);
      toast('Pedido marcado como aplicado', '✅');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-pedido-descartar]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Descartar este pedido? No se puede deshacer.')) return;
    try {
      await mockApi.descartarPedidoExterno(Number(b.dataset.pedidoDescartar));
      toast('Pedido descartado', '🗑️');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-pedido-aplicar-credito]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Aplicar este crédito de suscripción a esa cuenta?')) return;
    try {
      await mockApi.aplicarCreditoSuscripcion(Number(b.dataset.pedidoAplicarCredito), b.dataset.pedidoCreditoPerfil);
      toast('Crédito aplicado', '💳');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });

  app.querySelectorAll('[data-pedido-buscar-y-aplicar-credito]').forEach(b => b.onclick = async () => {
    const id = Number(b.dataset.pedidoBuscarYAplicarCredito);
    const input = app.querySelector(`[data-pedido-credito-email="${id}"]`);
    const email = (input ? input.value : '').trim();
    if (!email) { toast('Escribí el email del ganadero', '⚠️'); return; }
    try {
      const ganaderoId = await mockApi.buscarPerfilPorEmail(email);
      if (!ganaderoId) { toast('No hay ninguna cuenta de ganadero registrada con ese email todavía', '⚠️'); return; }
      if (!confirm('¿Aplicar este crédito de suscripción a esa cuenta?')) return;
      await mockApi.aplicarCreditoSuscripcion(id, ganaderoId);
      toast('Crédito aplicado', '💳');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });
}

// El primer renderApp() espera a que shared/auth-supabase.js confirme si
// hay sesión o no (puede que ya lo haya resuelto incluso antes de que este
// archivo termine de cargar — esperarSesionInicial() cubre los dos
// órdenes posibles) — así nunca arranca mostrando "sin sesión" un
// instante para después saltar a la app si en realidad sí la había.
esperarSesionInicial().then(renderApp);
