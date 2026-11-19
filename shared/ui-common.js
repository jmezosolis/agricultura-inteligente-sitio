// =====================================================================
// Piezas de interfaz compartidas por LAS 2 apps (ganadero/,
// administracion/), aunque tengan temas visuales distintos: ganadero usa
// el tema claro de ganadero/styles.css, administracion el tema oscuro
// de shared/styles.css. Ambas hojas de estilo definen las MISMAS clases
// (.card, .pill, .btn, .small, .muted) y las mismas variables de color
// semántico (--red, --red-soft-bg, --red-soft-border, --red-card-border)
// con valores distintos — por eso el mismo HTML generado acá se ve bien
// en cualquiera de los dos temas, sin tener que duplicar el JS.
//
// Requiere que shared/data.js ya esté cargado, y que la página defina
// "const APP_SCOPE = '...'" antes de cargar este archivo.
// =====================================================================

// Envoltorio seguro para document.startViewTransition() — la usan
// ganadero/app.js y shared/view-generic.js en cada renderApp(). Con la
// pestaña en segundo plano (celular con la pantalla apagada, o la app
// cambiada de plano) startViewTransition() TIRA una excepción en vez de
// simplemente no animar ("InvalidStateError: Document hidden") — y como
// nadie la atrapaba, "pintar" (que adentro tiene la lógica real: pintar la
// pantalla, o decidir si hay que redirigir por falta de sesión) nunca
// llegaba a ejecutarse. Acá se chequea "document.hidden" antes de
// intentarlo, y por las dudas también con try/catch — sea cual sea el
// motivo, "pintar" tiene que correr siempre, con o sin animación.
function transicionSegura(pintar){
  if (document.startViewTransition && !document.hidden) {
    try { document.startViewTransition(pintar); return; }
    catch (err) { /* cae al llamado directo de abajo */ }
  }
  pintar();
}

// Redirección entre las 3 páginas de entrada (index.html <-> ganadero/ <->
// administracion/) según el estado de sesión — la usan inicio.js,
// ganadero/app.js y shared/view-generic.js en vez de "location.href ="
// directo. Con conexión inestable (celular, señal débil) la sesión puede
// leerse distinto entre una carga de página y la siguiente — la app
// redirige a un lado, esa página no confirma la sesión a tiempo, redirige
// de vuelta, y así sin parar. Esto no arregla la causa (una consulta lenta
// o que falla intermitente), pero corta el bucle: si la MISMA URL se pide
// 3 veces en menos de 8 segundos, se detiene y muestra un botón de
// reintentar en vez de seguir rebotando para siempre.
// Guarda en memoria (no sessionStorage — a propósito: tiene que resetearse
// solo con cada carga de página nueva) la última URL a la que esta MISMA
// instancia de página ya mandó redirigir. Supabase dispara su evento de
// "sesión confirmada" más de una vez seguida al cargar (normal en su
// librería — INITIAL_SESSION, y a veces uno más detrás) y cada uno
// llamaba a renderApp() de nuevo — sin este freno, la misma redirección
// se disparaba 2-3 veces en milisegundos, ANTES de que la navegación
// anterior llegara a completarse, y esas 3 veces por sí solas ya
// activaban el freno de bucle de más abajo aunque nunca hubiera un
// verdadero rebote entre páginas.
let _ultimaRedirigidaA = null;
let _ultimaRedirigidaEn = 0;

function redirigirSeguro(url){
  const ahora = Date.now();
  if (_ultimaRedirigidaA === url && ahora - _ultimaRedirigidaEn < 1500) return;
  _ultimaRedirigidaA = url;
  _ultimaRedirigidaEn = ahora;

  const CLAVE = 'ggRedirectLog';
  let historial = [];
  try { historial = JSON.parse(sessionStorage.getItem(CLAVE) || '[]'); } catch (err) { historial = []; }
  historial = historial.filter((h) => ahora - h.t < 8000);
  historial.push({ url, t: ahora });
  try { sessionStorage.setItem(CLAVE, JSON.stringify(historial)); } catch (err) { /* no crítico */ }

  if (historial.filter((h) => h.url === url).length >= 3) {
    const root = document.getElementById('app');
    if (root) root.innerHTML = `
      <div class="wrap"><div class="card" style="text-align:center;">
        <div style="font-size:34px;">📶</div>
        <h3 style="margin-top:8px;">No se pudo confirmar tu sesión</h3>
        <p class="small muted" style="margin-top:6px;">Probablemente sea la conexión — probá de nuevo.</p>
        <button class="btn btn-primary btn-block" id="btnReintentarSesion" type="button">Reintentar</button>
      </div></div>`;
    const btn = document.getElementById('btnReintentarSesion');
    if (btn) btn.onclick = () => { sessionStorage.removeItem(CLAVE); location.reload(); };
    return;
  }
  // "replace", no "href": esta redirección es automática (según el rol),
  // no una navegación real que el usuario haya elegido — no tiene que
  // quedar en el historial. Si quedara, el botón de atrás llevaría a esta
  // misma página de tránsito (index.html, ganadero/, administracion/) en
  // el momento exacto en que decidió irse de acá — y como index.html no
  // tiene caché offline propia, sin señal esa vuelta atrás no cargaba
  // nada: la app "se salía" para el usuario. Con replace(), atrás va
  // directo a lo que había ANTES de entrar a la app.
  location.replace(url);
}

// Cada app instalable ("puerta de entrada") solo deja pasar a los roles
// que le corresponden — "administracion" es el panel único de staff. Esto es
// un control de UX (evita confusión: un ganadero no debería terminar en
// el panel de administración), NO el control de seguridad real — eso lo
// hacen las políticas de RLS del servidor, sin importar desde qué app
// llegue el pedido. Pero como localStorage es compartido entre las 2
// apps (mismo origen), una sesión abierta en una puede "colarse" a otra
// si no se valida acá — por eso esto bloquea de verdad, no solo avisa.
const SCOPE_ROLES = {
  ganadero: ['ganadero'],
  administracion: ['admin'],
};
// El admin es superusuario: entra a cualquiera de las apps sin bloqueo,
// porque necesita poder supervisar/dar soporte en todas.
function rolPermitidoEnApp(rol){ return rol === 'admin' || (SCOPE_ROLES[APP_SCOPE] || []).includes(rol); }
// Las apps se quedaron sin emoji propio a pedido — sigue devolviendo ''
// (no un emoji fijo) para cualquier scope, así que el brand/sidebar que
// leen esto (ver view-generic.js/ganadero/app.js) ya saben no dibujar nada.
function emojiScope(s){ return { ganadero:'', administracion:'' }[s] ?? ''; }
function tituloScope(s){
  return {
    ganadero:'Gana ID — Ganadero',
    administracion:'Gana ID — Administración',
  }[s] || 'Gana ID';
}
function etiquetaScope(s){ return { ganadero:'Ganadero', administracion:'la Administración' }[s] || s; }

// Pantalla de bloqueo cuando la cuenta autenticada no tiene el rol que le
// corresponde a esta app (ver rolPermitidoEnApp) — sin salida más que
// cambiar de cuenta o ir a la app correcta.
function viewAccesoRestringido(session){
  return `
  <div class="wrap">
    <div class="card" style="text-align:center;">
      <div style="font-size:34px;">🚫</div>
      <h3 style="margin-top:8px;">No tenés acceso a esta app</h3>
      <p class="small muted" style="margin-top:6px;">
        Iniciaste sesión como <b>${esc(session.nombre)}</b>, cuenta de <b>${etiquetaRol(session.rol)}</b> —
        esta es la app de <b>${etiquetaScope(APP_SCOPE)}</b>, no le corresponde.
      </p>
      <a class="btn btn-primary btn-block" href="../index.html">Ir a la app correcta</a>
      <button class="btn btn-ghost btn-block" data-logout="1">Cambiar de cuenta</button>
    </div>
  </div>`;
}

// Verificación pública de un chip — el mismo bloque se usa en la pantalla
// de login (sin sesión) y dentro de la app ya autenticado. "suffix" evita
// colisión de ids cuando aparece más de una vez en la misma página.
// "autoFocoEscaner" es para el bastón lector Bluetooth (modo HID/teclado,
// ver README sección 3): en la pantalla dedicada a escanear (la pestaña
// "Consultar chip" del panel de Administración) conviene que el campo ya tenga el
// foco al entrar, porque ahí no hay otra cosa que hacer. En pantallas con
// más contenido (login, inicio del ganadero) NO se fuerza el foco para no
// robárselo a otros campos — igual el lector funciona con un clic previo.
function blockConsultarChip(suffix, { autoFocoEscaner = false } = {}){
  return `
    <div class="row" style="margin-top:8px;">
      <input id="chipInput_${suffix}" data-autofoco-escaner="${autoFocoEscaner ? '1' : ''}" placeholder="Número del chip — o escaneá con el lector" style="flex:1;">
      <button class="btn btn-primary" data-consultar="${suffix}">Consultar</button>
    </div>
    <div id="resultado_${suffix}" style="margin-top:10px;"></div>
  `;
}

// Cablea todos los bloques blockConsultarChip() que haya dentro de "root".
// El bastón Bluetooth escribe el número como si alguien lo tipeara y
// remata con Enter — por eso el Enter tiene que disparar lo mismo que el
// botón "Consultar" (un click solo no le sirve al lector). Después de cada
// consulta se limpia y se reenfoca el campo, para escanear el chip
// siguiente sin tocar nada más — pensado para recorrer varios animales
// seguidos sin soltar el lector.
function bindConsultarChip(root = document){
  root.querySelectorAll('[data-consultar]').forEach(boton => {
    const suffix = boton.dataset.consultar;
    const input = document.getElementById('chipInput_' + suffix);
    if (!input) return;
    boton.onclick = () => handleConsultar(suffix);
    input.onkeydown = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      handleConsultar(suffix);
    };
    if (input.dataset.autofocoEscaner === '1') input.focus();
  });
}

function renderResultadoChip(r){
  if (!r.existe) {
    return `<div class="card" style="border-color:var(--red-card-border);">
      <span class="pill pill-rechazada">⚠️ No reconocido</span>
      <p class="small" style="margin-top:8px;">${r.advertencia}</p>
    </div>`;
  }
  return `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:center;">
      <span class="pill pill-${r.estado}">${etiquetaEstadoChip(r.estado)}</span>
      ${r.precio_oficial != null ? `<span class="small muted">Precio oficial: $${Number(r.precio_oficial).toLocaleString('es-MX')} MXN</span>` : ''}
    </div>
    ${r.proveedor ? `<p class="small muted" style="margin-top:6px;">Proveedor: ${esc(r.proveedor)}</p>` : ''}
    ${r.animal ? `<p class="small" style="margin-top:6px;">Animal: <b>${esc(r.animal.raza) || 'Raza no especificada'}</b> — estado: ${etiquetaEstadoAnimal(r.animal.estado)}</p>` : ''}
  </div>`;
}

async function handleConsultar(suffix){
  const input = document.getElementById('chipInput_' + suffix);
  const uidChip = input.value.trim();
  if (!uidChip) return;
  const destino = document.getElementById('resultado_' + suffix);
  try {
    destino.innerHTML = renderResultadoChip(await mockApi.consultarChip(uidChip));
  } catch (err) { toast(err.message, '⚠️'); return; }
  input.value = '';
  input.focus();
}

// Bloque de instalar la app — mismo criterio en las 2 apps (ganadero/,
// administracion/), por eso vive acá y no en cada app.js. Se pinta
// en viewLogin() de cada una (bien arriba, antes de iniciar sesión) y
// también en la pantalla ya logueada, para quien no lo instaló al entrar.
// Es el único lugar de la app para instalar — la landing (../index.html)
// solo elige el rol y entra, no tiene un botón de descarga aparte. Nada
// visible salvo que corresponda: si ya está instalada (modo standalone),
// nada; en iOS (Safari no tiene "beforeinstallprompt"), una tarjeta fija
// con los pasos manuales; en cualquier otro navegador, solo si YA llegó el
// evento "beforeinstallprompt" (shared/instalar.js lo deja en
// window.__deferredInstallPrompt) aparece el botón real.
function bloqueInstalarApp(){
  if (window.__yaInstalada) return '';
  if (window.__esIOS) {
    return `
      <div class="card" style="font-size:12.5px;line-height:1.6;">
        <b style="color:var(--primary);">📲 Instalar en iPhone/iPad</b>
        <p class="section-sub" style="margin-top:6px;">1. Tocá <b>Compartir</b> en la barra de Safari.<br>2. Elegí <b>"Agregar a pantalla de inicio"</b>.</p>
      </div>`;
  }
  if (!window.__deferredInstallPrompt) return '';
  return `<button class="btn btn-ghost btn-block" id="btnInstalarApp" type="button">📲 Instalar app</button>`;
}

// La acción real de instalar — la llama el click del botón "📲 Instalar
// app" que pinta bloqueInstalarApp() (ver bindInstalarApp() acá abajo).
async function intentarInstalarApp(){
  if (!window.__deferredInstallPrompt) return;
  window.__deferredInstallPrompt.prompt();
  await window.__deferredInstallPrompt.userChoice;
  window.__deferredInstallPrompt = null;
  if (typeof renderApp === 'function') renderApp();
}

// Handler del botón que pinta bloqueInstalarApp() — lo llaman tanto
// ganadero/app.js como shared/view-generic.js desde su propio
// bindEvents(), así el flujo de instalación no se escribe dos veces.
function bindInstalarApp(){
  const btn = document.getElementById('btnInstalarApp');
  if (!btn) return;
  btn.onclick = intentarInstalarApp;
}

// shared/instalar.js dispara esto cuando "beforeinstallprompt" llega (o
// cuando "appinstalled" confirma que ya quedó instalada) — hay que volver
// a renderizar para que bloqueInstalarApp() muestre u oculte el botón
// según corresponda. Cada app (ganadero/app.js, shared/view-generic.js)
// define su propio "renderApp" global, así que alcanza con este único
// listener acá.
// "beforeinstallprompt" puede llegar en cualquier momento después de
// cargar la página — Chrome decide solo, con su propia heurística, y a
// veces dispara CASI DE INMEDIATO, antes incluso de que se confirme si
// hay sesión o no. Sin el chequeo de _sesionListo, ese renderApp() de acá
// leía la sesión como "no hay" (todavía no se sabía, no es que no
// hubiera) y con el redirect de puerta única (ver redirigirSeguro(),
// arriba) eso significaba irse de la página de una — justo la causa real
// del rebote entre index.html y ganadero/administracion que veníamos
// persiguiendo.
window.addEventListener('ganado-instalable', () => {
  if (typeof renderApp === 'function' && typeof _sesionListo !== 'undefined' && _sesionListo) renderApp();
});

// Antes había acá una franja fija arriba de todo avisando "sin conexión" /
// "sincronizando N cambios" — se sacó a pedido: el objetivo explícito de
// todo el trabajo offline-first (shared/data.js) es que el ganadero NO
// tenga que darse cuenta de si hay señal o no, y ese aviso permanente iba
// justo en contra de eso. La app sigue guardando y sincronizando todo
// igual (ver shared/data.js) — simplemente no lo anuncia.

// Campo de municipio — mismo en cualquier formulario que lo necesite
// (alta de ganadero, alta de staff, etc.). Esta copia opera en TODO
// México, no en un solo estado — un <select> con los ~2,469 municipios
// del país sería inmanejable, así que es texto libre con sugerencias
// (<datalist>) en vez de una lista cerrada: cualquier nombre se acepta,
// las sugerencias son solo para tipear más rápido. La lista sale de la
// propia administración (municipiosDeLaSesion(), resuelta en
// auth-supabase.js junto con el resto del perfil) — MUNICIPIOS_RESPALDO
// queda como respaldo para el instante antes de que esa consulta
// resuelva, o si por lo que sea falla (sin conexión, etc.).
// "Usuarios por municipio" en el dashboard sigue funcionando igual,
// nomás que ahora puede haber variantes de escritura del mismo
// municipio — es el costo de no forzar una lista cerrada.
function selectMunicipios(nombreCampo, valorActual = '', requerido = false){
  const municipios = (typeof municipiosDeLaSesion === 'function' && municipiosDeLaSesion()) || MUNICIPIOS_RESPALDO;
  const datalistId = `datalist-${nombreCampo}`;
  return `
    <input name="${nombreCampo}" list="${datalistId}" ${requerido ? 'required' : ''} placeholder="Escribí el municipio" value="${esc(valorActual)}" autocomplete="off">
    <datalist id="${datalistId}">
      ${municipios.map(m => `<option value="${m}"></option>`).join('')}
    </datalist>`;
}

// Categoría de un lote (ver viewLotes() en ganadero/app.js) — mismo
// criterio que el municipio de arriba: texto libre con sugerencias, no
// una lista cerrada. Cada rancho maneja sus propias categorías, y a
// veces ni eso (algunos solo quieren juntar animales sin categorizarlos
// "de verdad") — por eso ni siquiera es obligatorio.
const CATEGORIAS_LOTE_SUGERIDAS = ['Cría', 'Engorda', 'Recría', 'Reproductoras', 'Destete', 'Vacas paridas', 'Descarte'];
function selectCategoriaLote(nombreCampo, valorActual = ''){
  const datalistId = `datalist-${nombreCampo}`;
  return `
    <input name="${nombreCampo}" list="${datalistId}" placeholder="Opcional — p. ej. Engorda" value="${esc(valorActual)}" autocomplete="off">
    <datalist id="${datalistId}">
      ${CATEGORIAS_LOTE_SUGERIDAS.map(c => `<option value="${c}"></option>`).join('')}
    </datalist>`;
}

// =====================================================================
// Acceso (login + autorregistro) — UNA sola pantalla, compartida por las
// 2 apps: no existe una puerta de entrada distinta para "admin" y otra
// para "ganadero". Cualquiera que se registra acá queda 'ganadero' sin
// excepción — handle_new_user() lo decide del lado del servidor (ver
// supabase/migrations/20260821090000_sin_arranque_en_frio.sql) y NUNCA
// según algo elegido en este formulario. El rol de admin se otorga a
// mano desde Supabase (ver supabase/NUEVO_CLIENTE.md), nunca por acá —
// por eso administracion ya no tiene su propio formulario de acceso
// aparte: sería una puerta redundante a la misma cuenta.
// =====================================================================
// Un solo formulario a la vez (antes los 2 quedaban siempre apilados,
// obligando a scrollear el registro entero incluso para alguien que solo
// quería entrar) — "login" es el default porque la mayoría de las
// visitas son de cuentas que ya existen, no altas nuevas. El de registro
// además quedó más corto: rancho/teléfono se completan después, desde
// "✏️ Editar perfil" en el menú de usuario (ver abrirMenuUsuario() más
// abajo) — no hacen falta para poder empezar a usar la cuenta.
let _accesoVista = 'login'; // 'login' | 'registro'

function bloqueAccesoCuenta(){
  if (_accesoVista === 'registro') {
    return `
      <div class="card">
        <h3 class="section-title">Crear mi cuenta</h3>
        <form id="formRegistro">
          <label>Nombre</label>
          <input name="nombre" required placeholder="Tu nombre">
          <label>Email</label>
          <input name="email" type="email" required placeholder="tu@email.com" autocomplete="email">
          <label>Contraseña</label>
          <input name="password" type="password" required minlength="6" placeholder="Al menos 6 caracteres" autocomplete="new-password">
          <label>Municipio</label>
          ${selectMunicipios('municipio', '', true)}
          <button class="btn btn-primary btn-block" type="submit">Crear cuenta y entrar</button>
        </form>
        <button class="btn btn-ghost btn-block" type="button" id="btnIrALogin" style="margin-top:10px;">Ya tengo cuenta</button>
      </div>`;
  }
  return `
    <div class="card">
      <h3 class="section-title">Entrar</h3>
      <form id="formLoginGanadero">
        <label>Email</label>
        <input name="email" type="email" required placeholder="tu@email.com" autocomplete="email">
        <label>Contraseña</label>
        <input name="password" type="password" required placeholder="Contraseña" autocomplete="current-password">
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
      </form>
      <button class="btn btn-ghost btn-block" type="button" id="btnIrARegistro" style="margin-top:10px;">Crear cuenta nueva</button>
    </div>`;
}

// Cablea el formulario que esté visible — llamarlo desde bindEvents() de
// cualquiera de las 2 apps, apenas se pinte viewLogin().
function bindAccesoCuenta(){
  const btnIrARegistro = document.getElementById('btnIrARegistro');
  if (btnIrARegistro) btnIrARegistro.onclick = () => { _accesoVista = 'registro'; renderApp(); };
  const btnIrALogin = document.getElementById('btnIrALogin');
  if (btnIrALogin) btnIrALogin.onclick = () => { _accesoVista = 'login'; renderApp(); };

  const formLoginGanadero = document.getElementById('formLoginGanadero');
  if (formLoginGanadero) formLoginGanadero.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formLoginGanadero);
    try {
      await mockApi.loginConPassword(fd.get('email'), fd.get('password'));
      // No hace falta renderApp() acá — onAuthStateChange (shared/
      // auth-supabase.js) se entera solo del login y ya vuelve a pintar.
    } catch (err) { toast(err.message, '⚠️'); }
  };

  const formRegistro = document.getElementById('formRegistro');
  if (formRegistro) formRegistro.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formRegistro);
    const boton = formRegistro.querySelector('button[type="submit"]');
    boton.disabled = true;
    try {
      const resultado = await mockApi.registrarGanadero({
        email: fd.get('email').trim(), password: fd.get('password'),
        nombre: fd.get('nombre').trim(), municipio: fd.get('municipio') || null,
        rancho_o_empresa: '', telefono: '',
      });
      if (resultado.confirmacionPendiente) {
        toast('Cuenta creada — revisá tu email para confirmarla antes de entrar', '📩');
      } else {
        toast('Cuenta creada', '✅');
        // No hace falta renderApp() acá si ya hay sesión — onAuthStateChange
        // (shared/auth-supabase.js) se entera sola y vuelve a pintar.
      }
    } catch (err) { toast(err.message, '⚠️'); }
    finally { boton.disabled = false; }
  };
}

// =====================================================================
// Menú de usuario — un solo lugar para "quién soy", editar perfil,
// instalar app y cerrar sesión. Antes estaban repartidos por la app
// (Cuenta en ganadero; sidebar en administracion) — ahora las 2 apps
// cuelgan del ícono 👤 del header. Reusa a propósito el mismo patrón de
// modal que ya usa el resto de la app (abrirFichaAnimal): cero CSS nuevo
// para el panel en sí, ya está en las dos hojas de estilo con los colores
// de cada tema
// (.modal-backdrop/.modal). Lo único nuevo es el botón-ícono en sí
// (".avatar-btn", agregado a ambos styles.css).
// =====================================================================

function iconoMenuUsuario(){
  // En la app de Administración, el ícono de usuario muestra el logo de
  // la Administración — es la única cuenta que entra ahí (admin), así
  // que tiene sentido que la identifique la marca. Ganadero muestra
  // "ganadero.png" (el ícono minimalista navy — mismo trazo que el
  // logo del login, antes el 👤 genérico).
  // Tamaño en el propio <img> (no solo en ".avatar-btn img" del CSS) —
  // así queda contenido igual aunque, por lo que sea, esa regla no llegue
  // a aplicarse a tiempo (ícono real grande, se ve gigante un instante
  // si el navegador lo pinta antes de que el ancho:100% le pegue).
  // "ganadero.png" es trazo fino con mucho margen transparente alrededor
  // (no ilustración de borde a borde como administrador.png) — "cover"
  // ahí adentro recortaría parte del dibujo, así que ese usa "contain".
  const contenido = (typeof APP_SCOPE !== 'undefined' && APP_SCOPE === 'administracion')
    ? `<img src="../administrador.png" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">`
    : `<img src="../ganadero.png" alt="" style="width:100%;height:100%;object-fit:contain;display:block;">`;
  return `<button class="avatar-btn" id="btnMenuUsuario" type="button" aria-label="Cuenta">${contenido}</button>`;
}

function bindIconoMenuUsuario(){
  const btn = document.getElementById('btnMenuUsuario');
  if (!btn) return;
  // Ganadero: "Editar perfil"/"Instalar app"/"Cerrar sesión" ya viven en
  // Configuración (ver ganadero/app.js) — el ícono deja de abrir este
  // menú (duplicaría las mismas 3 acciones en 2 lugares) y pasa a ser un
  // atajo directo a esa pantalla. Administración no tiene una pantalla
  // de Configuración propia, así que ahí el ícono sigue abriendo el menú
  // de siempre.
  const esGanadero = typeof APP_SCOPE !== 'undefined' && APP_SCOPE !== 'administracion';
  btn.onclick = (esGanadero && typeof currentScreen !== 'undefined')
    ? () => {
        // Mismo empuje al historial que "[data-nav]" (ver ganadero/app.js)
        // — así el botón "atrás" también funciona viniendo de acá.
        if (currentScreen !== 'configuracion') history.pushState({ pantalla: currentScreen }, '', location.href);
        currentScreen = 'configuracion';
        if (typeof resetearSubvistas === 'function') resetearSubvistas();
        renderApp();
      }
    : abrirMenuUsuario;
}

function formEditarPerfil(perfil){
  return `
    <form id="formEditarPerfil" style="margin-top:8px;">
      <label>Nombre</label>
      <input name="nombre" required value="${esc(perfil.nombre)}">
      <label>Rancho / empresa</label>
      <input name="rancho_o_empresa" value="${esc(perfil.rancho_o_empresa)}">
      <label>Teléfono</label>
      <input name="telefono" value="${esc(perfil.telefono)}">
      ${perfil.rol === 'ganadero' ? `<label>Municipio</label>${selectMunicipios('municipio', perfil.municipio || '')}` : ''}
      <button class="btn btn-primary btn-block" type="submit">Guardar cambios</button>
    </form>`;
}

async function abrirMenuUsuario(){
  const session = mockApi.sesionActual();
  if (!session) return;
  // _sesionCache (shared/auth-supabase.js) solo trae id/nombre/rol/email —
  // acá hace falta el perfil completo (rancho, teléfono, municipio) para
  // precargar "Editar perfil" con lo que ya hay cargado, no en blanco.
  const { data: perfilCompleto } = await supabaseClient.from('perfiles').select('*').eq('id', session.id).single();
  const perfil = perfilCompleto || session;
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="section-title" style="margin-bottom:2px;">👤 ${esc(perfil.nombre)}</h3>
      <p class="small muted" style="margin-bottom:14px;">${etiquetaRol(perfil.rol)}${perfil.municipio ? ' · ' + esc(perfil.municipio) : ''}</p>
      <button class="btn btn-ghost btn-block" id="btnMostrarEditarPerfil" type="button">✏️ Editar perfil</button>
      <div id="menuUsuarioEdicion"></div>
      <div style="margin-top:10px;">${bloqueInstalarApp()}</div>
      <button class="btn btn-ghost btn-block" id="btnCerrarSesionMenu" type="button" style="margin-top:8px;">🚪 Cerrar sesión</button>
    </div>`;
  document.body.appendChild(overlay);
  // Sin botón "Cerrar" propio — tocar afuera del modal ya lo cierra
  // (mismo mecanismo que el resto de los modales de la app).
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  bindInstalarApp();

  document.getElementById('btnMostrarEditarPerfil').onclick = (e) => {
    e.target.style.display = 'none';
    document.getElementById('menuUsuarioEdicion').innerHTML = formEditarPerfil(perfil);
    document.getElementById('formEditarPerfil').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await mockApi.actualizarMiPerfil({
          nombre: fd.get('nombre'), rancho_o_empresa: fd.get('rancho_o_empresa'),
          telefono: fd.get('telefono'), municipio: fd.get('municipio') || null,
        });
        toast('Perfil actualizado', '✅');
        overlay.remove();
        if (typeof renderApp === 'function') renderApp();
      } catch (err) { toast(err.message, '⚠️'); }
    };
  };

  // mockApi.logout() no se espera acá (no hace falta) — onAuthStateChange
  // (shared/auth-supabase.js) se entera solo apenas Supabase confirma el
  // signOut y vuelve a pintar. Este handler solo deja cada variable de
  // pantalla/pestaña en su valor inicial ANTES de eso, para que el
  // próximo render arranque limpio.
  document.getElementById('btnCerrarSesionMenu').onclick = () => {
    mockApi.logout();
    // Cada app guarda en qué pantalla/pestaña estaba en una variable propia
    // (currentScreen en ganadero; activeTab/filtroUsuarios en
    // administracion) — typeof la protege sin que este archivo
    // compartido necesite saber cuál de las dos existe.
    if (typeof currentScreen !== 'undefined') currentScreen = 'inicio';
    if (typeof activeTab !== 'undefined') activeTab = null;
    if (typeof filtroUsuarios !== 'undefined') filtroUsuarios = 'todos';
    if (typeof filtroFechaAuditoriaDesde !== 'undefined') filtroFechaAuditoriaDesde = '';
    if (typeof filtroFechaAuditoriaHasta !== 'undefined') filtroFechaAuditoriaHasta = '';
    overlay.remove();
  };
}

// =====================================================================
// Formulario de datos de un animal — antes vivía solo en ganadero/app.js,
// se movió acá junto con el resto de las piezas compartidas: "si algo se
// necesita en más de una app, va en shared/", como ya dice el resto del
// proyecto.
// =====================================================================

function seccionForm(icono, titulo){
  return `<div class="form-section-title">${icono ? icono + ' ' : ''}${titulo}</div>`;
}

// "Brahman x Angus" (un solo campo `raza`, como lo guarda el resto del
// sistema) <-> {base:'Brahman',
// cruzada:'Angus'} (dos campos separados en el formulario). splitRaza()
// hace el camino inverso al precargar, para que el checkbox "Es cruza" y el
// segundo campo aparezcan ya marcados si la raza guardada trae una cruza.
function splitRaza(razaCombinada){
  const partes = (razaCombinada || '').split(/\s+x\s+/i);
  return partes.length === 2 ? { base: partes[0], cruzada: partes[1] } : { base: razaCombinada || '', cruzada: '' };
}

// Campos del formulario "Registrar animal" (identificación, peso,
// ubicación). Identificación son 2 opciones, no una sola — chip y N°
// interno — con al menos una obligatoria (lo valida el servidor, ver
// registrar_animal_directo() en
// supabase/migrations/20260917140000_chip_opcional_temporal.sql):
// mientras no haya inventario oficial cargado con normalidad, un chip
// tipeado a mano que no coincida con ninguno "en_stock" se guarda igual,
// como referencia propia (sin la trazabilidad completa de un chip
// oficial, pero sin bloquear el alta — ni siquiera hace falta señal para
// esto, ver registrarAnimalDirecto() en shared/data.js). Si
// "chipEscaneado" viene con valor (ver chipEscaneadoParaRegistro en
// ganadero/app.js), el campo de chip queda de solo lectura — ya se
// escaneó, no tiene sentido volver a tipearlo a mano (esté o no
// confirmado contra el servidor todavía, si no hay señal en el momento).
// "datos" precarga valores si hace falta; vacío por defecto.
async function camposDatosAnimal(datos = {}, { chipEscaneado = null } = {}){
  const v = (k) => datos[k] != null ? datos[k] : '';
  const { base: razaBase, cruzada: razaCruzada } = splitRaza(datos.raza);
  return `
    ${seccionForm('', 'Identificación')}
    <label>Chip${chipEscaneado ? ' (escaneado)' : ''}</label>
    ${chipEscaneado ? `
    <input value="${esc(chipEscaneado)}" name="chip_uid" readonly style="background:transparent;font-weight:600;">
    ` : `
    <input name="chip_uid" placeholder="Opcional" value="${v('chip_uid')}">
    `}
    <label>N° interno (tu propia numeración de rancho)</label>
    <input name="numero_interno" placeholder="Opcional" value="${v('numero_interno')}">
    <div class="row">
      <div style="flex:1;min-width:140px;">
        <label>Raza *</label>
        <input name="raza" placeholder="p. ej. Brahman" value="${razaBase}">
      </div>
      <div style="flex:1;min-width:140px;">
        <label>Sexo *</label>
        <select name="sexo">
          <option value="">Elegir…</option>
          <option value="macho" ${datos.sexo === 'macho' ? 'selected' : ''}>Macho</option>
          <option value="hembra" ${datos.sexo === 'hembra' ? 'selected' : ''}>Hembra</option>
        </select>
      </div>
    </div>
    <div class="check-row">
      <input type="checkbox" id="chkEsCruza" name="es_cruza" ${razaCruzada ? 'checked' : ''}>
      <label style="margin:0;" for="chkEsCruza">Es cruza de razas distintas</label>
    </div>
    <div id="wrapRazaCruzada" style="${razaCruzada ? '' : 'display:none;'}">
      <label>Raza cruzada</label>
      <input name="raza_cruzada" placeholder="p. ej. Angus" value="${razaCruzada}">
    </div>
    <div class="row">
      <div style="flex:1;min-width:140px;">
        <label>Color / pelaje</label>
        <input name="color" placeholder="p. ej. Colorado" value="${v('color')}">
      </div>
      <div style="flex:1;min-width:140px;">
        <label>Fecha de nacimiento</label>
        <input type="date" name="fecha_nacimiento" value="${v('fecha_nacimiento')}">
      </div>
    </div>
    <label>Hierro / marca de herrar</label>
    <input name="marca_hierro" placeholder="Opcional" value="${v('marca_hierro')}">

    ${seccionForm('', 'Peso')}
    <div class="row">
      <div style="flex:1;min-width:140px;">
        <label>Peso al nacer (kg)</label>
        <input name="peso_nacimiento_kg" type="number" step="0.1" min="0" placeholder="Opcional" value="${v('peso_nacimiento_kg')}">
      </div>
      <div style="flex:1;min-width:140px;">
        <label>Peso actual (kg)</label>
        <input name="peso_actual_kg" type="number" step="0.1" min="0" placeholder="Opcional" value="${v('peso_actual_kg')}">
      </div>
    </div>
    <label>Fecha del pesaje actual</label>
    <input type="date" name="peso_actual_fecha" value="${v('peso_actual_fecha')}">

    ${seccionForm('', 'Ubicación y notas')}
    <label>Rancho / predio</label>
    <input name="ubicacion" placeholder="p. ej. Rancho El Progreso, Villaflores" value="${v('ubicacion')}">
    <label>Observaciones</label>
    <textarea name="notas" placeholder="Cualquier dato adicional">${v('notas')}</textarea>
  `;
}

// Lee los mismos campos que pinta camposDatosAnimal() — separado en su
// propia función para no repetir el mapeo de FormData en cada lugar que
// use ese formulario.
function leerDatosAnimalDeFormulario(fd){
  const txt = (campo) => (fd.get(campo) || '').trim() || null;
  const razaBase = fd.get('raza').trim();
  const razaCruzada = (fd.get('raza_cruzada') || '').trim();
  const esCruza = fd.get('es_cruza') === 'on';
  return {
    // Presente solo si venía de un escaneo (ver chipEscaneadoParaRegistro
    // en ganadero/app.js) — registrar_animal_directo() lo usa si viene,
    // si no cae al inventario por orden como siempre.
    chip_uid: txt('chip_uid'),
    numero_interno: txt('numero_interno'),
    raza: (esCruza && razaCruzada) ? `${razaBase} x ${razaCruzada}` : razaBase,
    sexo: fd.get('sexo'),
    color: txt('color'),
    marca_hierro: txt('marca_hierro'),
    fecha_nacimiento: fd.get('fecha_nacimiento') || null,
    peso_nacimiento_kg: fd.get('peso_nacimiento_kg') || null,
    peso_actual_kg: fd.get('peso_actual_kg') || null,
    peso_actual_fecha: fd.get('peso_actual_fecha') || null,
    ubicacion: txt('ubicacion'),
    notas: txt('notas'),
  };
}

// =====================================================================
// Exportar a Excel (SheetJS) — lo usan tanto Administración (todo el
// sistema, botón en Resumen) como cada ganadero (su propio rebaño, botón
// en Inicio), por eso vive acá y no en shared/view-generic.js (exclusivo
// del panel de Administración). Las funciones RPC del servidor
// (datos_respaldo_completo()/mi_respaldo_excel(), ver
// supabase/migrations/20260819100000_sin_solicitudes_mas_reproduccion_y_reportes.sql)
// ya devuelven cada hoja con encabezado en español, lista para volcarse
// tal cual — acá solo se arma el libro y se dispara la descarga. Sin
// backend propio de por medio: el archivo nunca pasa por ningún
// servidor, sale directo de Supabase al Excel dentro del navegador.
// =====================================================================

// SheetJS (~1MB) no se carga siempre por <script> fijo en el <head> —
// solo lo usa quien toca "Exportar Excel", y no siempre. Se inyecta
// recién ahí, la primera vez; la promesa queda cacheada para no insertar
// el <script> de nuevo si lo tocan varias veces (y para que un segundo
// clic mientras carga espere la misma carga en vez de arrancar otra).
let _sheetJsPromise = null;
function cargarSheetJS(){
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  if (_sheetJsPromise) return _sheetJsPromise;
  _sheetJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
    script.onload = resolve;
    script.onerror = () => { _sheetJsPromise = null; reject(new Error('No se pudo cargar la librería de Excel')); };
    document.head.appendChild(script);
  });
  return _sheetJsPromise;
}

// Arma el libro de Excel a partir de "datos" ({clave: filas[]}, tal como
// devuelven las RPC de respaldo) y "hojas" (lista de [clave, nombre
// visible de la pestaña], en el orden que se quiere que aparezcan). Si
// una hoja no tiene filas, igual se agrega (con una fila en blanco) para
// que el archivo siempre tenga las mismas pestañas, sin importar cuánta
// información haya cargada todavía. No escribe el archivo — eso queda a
// cargo de quien llama, con el nombre que corresponda.
function armarLibroExcel(datos, hojas){
  const wb = XLSX.utils.book_new();
  for (const [clave, nombreHoja] of hojas) {
    const filas = datos[clave] || [];
    const columnas = filas.length ? Object.keys(filas[0]) : ['(sin datos todavía)'];
    const hoja = XLSX.utils.json_to_sheet(filas.length ? filas : [columnas.reduce((o, c) => ({ ...o, [c]: '' }), {})]);
    hoja['!cols'] = columnas.map(c => ({ wch: Math.min(Math.max(c.length + 4, 12), 32) }));
    XLSX.utils.book_append_sheet(wb, hoja, nombreHoja);
  }
  return wb;
}
