// =====================================================================
// Interfaz de la app de Ganadero — navegación inferior fija (estilo app
// nativa), tema claro inspirado en el lenguaje visual de GanaData/
// AgriTraz: tarjetas de estadística, avatares circulares, colores
// semánticos, tipografía en negrita. Ninguna lógica de datos vive acá —
// todo pasa por "mockApi" de ../shared/data.js. Las piezas que comparte
// con administracion (verificación de chip, pantalla de acceso
// restringido, selector de municipio) vienen de ../shared/ui-common.js —
// ambos archivos se asumen ya cargados antes que este.
// =====================================================================

let currentScreen = 'inicio';
let animalesSubview = 'lista'; // 'lista' | 'form' — solo dentro de la pantalla "animales"
let reproduccionSubview = 'registrar'; // 'registrar' | 'alertas' | 'historial' — solo dentro de "Reproducción"
let sanidadSubview = 'registrar'; // 'registrar' | 'alertas' | 'historial' — solo dentro de "Sanidad"

// Pantalla "Lote" (ver viewLotes()/viewLoteDetalle()) — un solo modelo
// de lote para cualquier uso (manejo, protocolo reproductivo, campaña
// sanitaria, otro — ver supabase/migrations/20260918090000_unificar_lotes.sql).
// No es una pantalla de una sola pasada: se crea una vez y se le va
// sumando (o sacando) animales con el tiempo, tanto guardados como
// nuevos, y tanto el nombre como la función se pueden editar después.
let loteScreenSubview = 'lista'; // 'lista' (todos mis lotes) | 'form' (nuevo lote) | 'detalle' (dentro de uno puntual)
let loteSeleccionadoId = null;
let loteOrdenRanking = 'desc'; // 'desc' = mejor ganancia de peso primero | 'asc' = peor primero
// Solo 2 pestañas arriba de todo — "Grupo" (cómo le va al lote en
// conjunto y a cada animal adentro, lo primero que hay que ver) y
// "Tareas" (sumar animales, protocolo, sanidad — colapsadas dentro
// suyo, ver loteTareaAbierta más abajo, en vez de 4 pestañas separadas
// compitiendo arriba de todo).
let loteDetalleSubview = 'grupo'; // 'grupo' | 'tareas'
let loteTareaAbierta = null; // null | 'sumar' | 'reproduccion' | 'sanidad' — cuál tarea está desplegada dentro de "Tareas"

// Configuración: lista de opciones, un solo panel desplegado a la vez —
// mismo patrón que loteTareaAbierta.
let configuracionAbierta = null; // null | 'perfil' | 'plan' | 'notificaciones' | 'privacidad'

// Calendario: qué mes se está mirando + qué día está expandido (si hay
// uno). No se resetea en resetearSubvistas() a propósito — si entrás,
// mirás otro mes, y salís a hacer otra cosa, al volver seguís donde
// estabas en vez de arrancar de cero cada vez.
let calendarioAnio = new Date().getFullYear();
let calendarioMes = new Date().getMonth(); // 0-11
let calendarioDiaSeleccionado = null; // 'YYYY-MM-DD' | null
let calendarioFormAbierto = false; // "Nuevo recordatorio" — escondido salvo que se pida, mismo criterio que el resto de los formularios de esta app

// Animales nuevos (todavía sin registrar) que se van juntando dentro del
// detalle de un lote (viewLoteDetalle()) antes de guardarlos — cada fila
// es { chip_uid: string|null, sexo, numero_interno, peso_actual_kg }.
// chip_uid es null si se agregó con los botones "+ Macho/Hembra sin
// escanear" (se le asigna uno del inventario por orden, como el registro
// individual normal); si viene de un escaneo, es el chip puntual que se
// va a usar para ESE animal (mismo criterio que chipEscaneadoParaRegistro
// en el registro de a uno). Al guardar, cada uno se registra Y se suma al
// lote actual en el mismo paso.
let loteAnimales = [];

// Se llama cada vez que se deja una pantalla de la barra inferior (clic
// en "[data-nav]" o botón de atrás del teléfono/navegador — ver
// bindEvents()/el "popstate" al final del archivo) — así entrar de
// nuevo a "Lote" o "Reproducción" siempre aterriza en su vista por
// defecto (lista / "Registrar evento"), igual que "Animales" ya hacía
// con animalesSubview, en vez de quedar pegado adentro del último lote
// o de la última pestaña que se hubiera dejado abierta. No se pierde
// ningún borrador: loteAnimales (animales nuevos sin guardar de un
// lote) no se toca acá, así que si se vuelve a abrir ESE MISMO lote
// sigue estando.
function resetearSubvistas(){
  animalesSubview = 'lista';
  reproduccionSubview = 'registrar';
  sanidadSubview = 'registrar';
  loteScreenSubview = 'lista';
  loteSeleccionadoId = null;
  loteDetalleSubview = 'grupo';
  loteTareaAbierta = null;
  configuracionAbierta = null;
}

// Escaneo global (ver bindEscaneoGlobal()): buffer de teclas que va
// llenando el lector Bluetooth cuando NO hay ningún campo enfocado.
let scanBuffer = '';
let scanTimer = null;

// Chip que quedó pendiente de un escaneo (procesarChipEscaneado(), caso
// "en_stock") — viewNuevoAnimalRegistro() lo muestra de solo lectura para
// que se vea CUÁL chip se va a asignar (el mismo que está físicamente en
// el animal, no cualquiera del inventario). Se limpia al entrar al
// formulario de forma manual (FAB), al volver a la lista sin guardar, o
// al guardar con éxito — así nunca queda un chip viejo mostrado por error.
let chipEscaneadoParaRegistro = null;

// Ver el uso en renderApp() más abajo.
let _yaSincronizoChipsReservados = false;

function initials(nombre){
  return (nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

function saludo(){
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

async function renderApp(){
  const session = mockApi.sesionActual();
  // Sin sesión (recién entrado sin login guardado, o justo después de un
  // logout) — la puerta única de acceso es "../index.html" (ver
  // frontend/inicio.js): un solo formulario, sin el tema propio de esta
  // app. Sin este redirect, cerrar sesión desde acá dejaba viendo el
  // login (dorado) de Ganadero en vez de volver a la pantalla neutra.
  if (!session) { redirigirSeguro('../index.html'); return; }
  // Una vez por carga de página: baja el pool de chips reservados para
  // uso sin señal (ver shared/data.js) — después de esto, el evento
  // "online"/"ganado-cola-cambio" (shared/data.js) lo mantiene al día
  // solo, no hace falta llamarlo de nuevo en cada render.
  if (!_yaSincronizoChipsReservados) { _yaSincronizoChipsReservados = true; sincronizarChipsReservados(); }
  const root = document.getElementById('app');
  const pintar = async () => {
    // root.innerHTML se reemplaza ENTERO en cada render (más abajo) — no
    // solo al navegar entre Inicio/Animales/etc., sino cada vez que algo
    // DENTRO de una pantalla llama a renderApp() (cambiar de sub-pestaña
    // en Sanidad/Reproducción, guardar un formulario, tocar un toggle...).
    // Sin esto, ".bottom-nav" (que en mobile se desliza horizontal, ver
    // "overflow-x:auto" en styles.css) volvía sola al principio del
    // scroll en CADA uno de esos repintados, aunque quien la usaba nunca
    // tocó la barra de navegación — se sentía como que "se actualizaba
    // sola" en medio de cualquier otra acción. Guardar y restaurar el
    // scroll acá alcanza para que quede quieta salvo que se la toque de
    // verdad.
    const navPrevio = root.querySelector('.bottom-nav');
    const scrollNavPrevio = navPrevio ? { left: navPrevio.scrollLeft, top: navPrevio.scrollTop } : null;
    // localStorage es compartido entre las 3 apps (mismo origen) — si una
    // sesión de otro rol quedó abierta y se entra acá, se bloquea en vez de
    // mostrar el contenido de ganadero. rolPermitidoEnApp() ya deja pasar
    // al admin como superusuario (shared/ui-common.js).
    try {
      root.innerHTML = !rolPermitidoEnApp(session.rol) ? viewAccesoRestringido(session) : await viewShell(session);
      bindEvents();
      const navNuevo = root.querySelector('.bottom-nav');
      if (navNuevo && scrollNavPrevio) { navNuevo.scrollLeft = scrollNavPrevio.left; navNuevo.scrollTop = scrollNavPrevio.top; }
    } catch (err) {
      // Sin este catch, un error acá (una consulta que falla por RLS/
      // permisos, una pantalla con un bug) dejaba la pantalla ANTERIOR
      // congelada sin ningún aviso — root.innerHTML nunca llegaba a
      // reemplazarse porque la excepción cortaba la función a mitad de
      // camino. Mejor mostrar el error y que se pueda reintentar tocando
      // el mismo ícono, que quedarse pegado sin ninguna pista.
      console.error('Error al pintar la pantalla:', err);
      toast(err.message || 'No se pudo cargar esta pantalla — probá de nuevo', '⚠️');
    }
  };
  // Transición suave al cambiar de pantalla (Inicio/Animales/Sanidad/
  // ...) en vez del "parpadeo" seco de reemplazar innerHTML de golpe — la
  // View Transitions API la da gratis (un fundido corto) en los
  // navegadores que la soportan (Chrome/Edge de escritorio y Android). Sin
  // soporte, o con la pestaña en segundo plano, transicionSegura()
  // (shared/ui-common.js) cae sola a pintar directo, sin animar.
  transicionSegura(pintar);
}

const NAV_ITEMS = [
  { id:'inicio', label:'Inicio', img:'../inicio.png' },
  { id:'animales', label:'Animales', img:'../animales.png' },
  { id:'lote', label:'Lote', img:'../lote.png' },
  { id:'sanidad', label:'Sanidad', img:'../sanidad.png' },
  { id:'calendario', label:'Calendario', emoji:'📅' }, // sin PNG propio todavía — mismo criterio que "Lote"/"Config" (emoji directo)
  { id:'pesaje', label:'Pesaje', img:'../pesaje.png' },
  { id:'leche', label:'Leche', img:'../leche.png' },
  { id:'reproduccion', label:'Repro', full:'Reproducción', img:'../reproduccion.png' }, // "Reproducción" completo no entra en la barra inferior de mobile sin desalinear el resto de las pestañas — en la columna lateral de escritorio sí hay lugar (ver .nav-label-completo en styles.css), ahí se usa el nombre entero
  { id:'excel', label:'Excel', img:'../excel.png' },
  { id:'tienda', label:'Tienda', emoji:'🛒' },
  { id:'configuracion', label:'Config', full:'Configuración', emoji:'⚙️' },
];

async function viewShell(session){
  // El selector de rancho (ver abrirSelectorRancho() más abajo) solo
  // aplica a cuentas de ganadero — separar información por rancho no
  // tiene sentido para un admin/staff, que ya ve todo desde su propio
  // panel. Un solo fetch acá, se re-pinta con cada cambio de pantalla
  // igual que el resto del topbar — misRanchos() ya cachea sola (ver
  // shared/data.js), pero esto se llama en TODA pantalla, así que un
  // try/catch de más no está de más — sin él, la primerísima vez que se
  // abre la app sin señal (caché de ranchos todavía vacía) tiraba y
  // dejaba de poder navegar a cualquier lado, no solo el nombre del
  // rancho quedaba mal.
  let ranchos = [];
  if (session.rol === 'ganadero') {
    try { ranchos = await mockApi.misRanchos(); } catch (err) { /* sin nada mejor que mostrar todavía — sigue con [] */ }
  }
  const ranchoActual = ranchos.find(r => r.id === session.rancho_actual_id);

  const contenidoScreen = await renderScreen(currentScreen, session);
  return `
  <div class="mobile-shell">
    <div class="mobile-topbar">
      <div>
        <div class="topbar-greeting-row">
          <div class="greeting">${saludo()}, ${esc(session.nombre.split(' ')[0])}</div>
        </div>
        ${session.rol === 'ganadero'
          ? `<button type="button" class="rancho-switch" id="btnCambiarRancho"><img src="../inicio.png" alt="" style="width:15px;height:15px;vertical-align:-2px;"> ${esc(ranchoActual ? ranchoActual.nombre : 'Mi rancho')} <span style="opacity:.6;">▾</span></button>`
          : `<div class="sub">${etiquetaRol(session.rol)}</div>`}
        ${window.GanaIDConnectionStatus ? window.GanaIDConnectionStatus.markup() : ''}
      </div>
      <div class="mobile-topbar-actions">
        ${window.GanaIDStore ? window.GanaIDStore.cartButtonMarkup() : ''}
        ${iconoMenuUsuario()}
      </div>
    </div>
    <div class="screen" id="screenContent">${contenidoScreen}</div>
    <nav class="bottom-nav">
      ${NAV_ITEMS.map(n => `
        <button class="nav-item ${currentScreen === n.id ? 'active' : ''}" data-nav="${n.id}">
          <span class="ico">${n.img ? `<img src="${n.img}" alt="">` : n.emoji}</span><span class="nav-label-corto">${n.label}</span><span class="nav-label-completo">${n.full || n.label}</span>
        </button>`).join('')}
    </nav>
  </div>`;
}

// Selector de rancho — mismo patrón de overlay que abrirMenuUsuario()/
// abrirFichaAnimal(). Elegir uno lo pone como "actual" (mockApi.cambiarRanchoActual(),
// re-pinta toda la app); archivar uno solo se ofrece si queda al menos
// otro (mismo criterio que archivar_rancho() del lado del servidor,
// repetido acá nomás para no mostrar un botón que sabemos que va a
// fallar). Crear uno nuevo pasa por crear_rancho(), que ya devuelve el
// error claro de la versión gratis si corresponde — no se duplica esa
// regla en el cliente.
//
// El formulario de abajo hace doble función — "Nuevo rancho" o "Editar
// rancho puntual", según si se tocó el ✏️ de alguna fila (editandoId,
// cerrado sobre esta llamada — no hace falta una variable de módulo,
// el selector siempre se cierra y se vuelve a abrir de cero). Evita
// duplicar el formulario entero para algo que ya tiene los mismos 3
// campos (nombre/ubicación/municipio) en los dos casos.
async function abrirSelectorRancho(){
  const session = mockApi.sesionActual();
  let ranchos;
  try { ranchos = await mockApi.misRanchos(); }
  catch (err) { toast(err.message, '⚠️'); return; }
  let editandoId = null;

  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';

  const pintarFormulario = () => {
    const editando = editandoId ? ranchos.find(r => r.id === editandoId) : null;
    const form = overlay.querySelector('#formRancho');
    if (!form) return;
    form.innerHTML = `
      <label>${editando ? `Editando "${esc(editando.nombre)}"` : 'Nuevo rancho'}</label>
      <input name="nombre" placeholder="Nombre — p. ej. Rancho El Progreso" value="${editando ? esc(editando.nombre) : ''}">
      <div class="row" style="gap:8px;margin-top:9px;">
        <input name="municipio" placeholder="Municipio (opcional)" value="${editando ? esc(editando.municipio || '') : ''}" style="flex:1;">
        <input name="ubicacion" placeholder="Ubicación (opcional)" value="${editando ? esc(editando.ubicacion || '') : ''}" style="flex:1;">
      </div>
      <div class="row" style="gap:8px;margin-top:8px;">
        ${editando ? `<button class="btn btn-ghost" type="button" id="btnCancelarEdicionRancho" style="flex:1;">Cancelar</button>` : ''}
        <button class="btn btn-primary" type="submit" style="flex:1;">${editando ? 'Guardar cambios' : '➕ Agregar rancho'}</button>
      </div>`;
    const btnCancelar = form.querySelector('#btnCancelarEdicionRancho');
    if (btnCancelar) btnCancelar.onclick = () => { editandoId = null; pintarFormulario(); };
  };

  overlay.innerHTML = `
    <div class="modal">
      <h3 class="section-title" style="margin-bottom:14px;">Tus ranchos</h3>
      <div style="max-height:40vh;overflow-y:auto;">
        ${ranchos.map(r => `
        <div class="list-item" data-elegir-rancho="${r.id}" style="${r.id === session.rancho_actual_id ? 'background:var(--primary-soft);' : ''}">
          <div class="list-avatar" style="background:rgba(15,42,74,0.14);"><img src="../inicio.png" alt="" style="width:20px;height:20px;object-fit:contain;"></div>
          <div style="flex:1;min-width:0;">
            <div class="list-title">${esc(r.nombre)}${r.id === session.rancho_actual_id ? ' (actual)' : ''}</div>
            <div class="list-sub">${r.municipio ? esc(r.municipio) : (r.ubicacion ? esc(r.ubicacion) : 'Sin ubicación')}</div>
          </div>
          <button type="button" class="btn btn-ghost" data-editar-rancho="${r.id}" style="padding:4px 8px;font-size:11px;margin-top:0;">✏️</button>
          ${ranchos.length > 1 ? `<button type="button" class="btn btn-ghost" data-archivar-rancho="${r.id}" style="padding:4px 8px;font-size:11px;margin-top:0;margin-left:4px;">🗄️</button>` : ''}
          ${ranchos.length > 1 ? `<button type="button" class="btn btn-ghost" data-eliminar-rancho="${r.id}" style="padding:4px 8px;font-size:11px;margin-top:0;margin-left:4px;">🗑️</button>` : ''}
        </div>`).join('')}
      </div>
      <form id="formRancho" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px;"></form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  pintarFormulario();

  overlay.querySelectorAll('[data-elegir-rancho]').forEach(el => el.onclick = async () => {
    const id = Number(el.dataset.elegirRancho);
    if (id === session.rancho_actual_id) { overlay.remove(); return; }
    try {
      await mockApi.cambiarRanchoActual(id);
      overlay.remove();
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });
  overlay.querySelectorAll('[data-editar-rancho]').forEach(el => el.onclick = (e) => {
    e.stopPropagation();
    editandoId = Number(el.dataset.editarRancho);
    pintarFormulario();
    overlay.querySelector('#formRancho').scrollIntoView({ block: 'nearest' });
  });
  overlay.querySelectorAll('[data-archivar-rancho]').forEach(el => el.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('¿Archivar este rancho? Sus animales y lotes quedan igual, solo deja de aparecer en la lista.')) return;
    try {
      await mockApi.archivarRancho(Number(el.dataset.archivarRancho));
      overlay.remove();
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });
  overlay.querySelectorAll('[data-eliminar-rancho]').forEach(el => el.onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar este rancho para siempre? Solo se puede si no tiene ningún animal ni lote cargado — si tiene datos, mejor archivalo con 🗄️.')) return;
    try {
      await mockApi.eliminarRancho(Number(el.dataset.eliminarRancho));
      overlay.remove();
      toast('Rancho eliminado', '🗑️');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });
  const formRancho = overlay.querySelector('#formRancho');
  if (formRancho) formRancho.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formRancho);
    const datos = { nombre: fd.get('nombre'), ubicacion: fd.get('ubicacion'), municipio: fd.get('municipio') };
    try {
      if (editandoId) {
        await mockApi.editarRancho(editandoId, datos);
        toast('Rancho actualizado', '🏡');
      } else {
        await mockApi.crearRancho(datos);
        toast('Rancho creado', '🏡');
      }
      overlay.remove();
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
}

async function renderScreen(screen, session){
  switch (screen) {
    case 'inicio': return viewInicio();
    case 'animales':
      return animalesSubview === 'form' ? viewNuevoAnimalRegistro() : viewAnimales();
    case 'lote':
      if (loteScreenSubview === 'detalle') return viewLoteDetalle();
      if (loteScreenSubview === 'form') return viewNuevoLoteForm();
      return viewLotes();
    case 'sanidad': return viewSanidad();
    case 'calendario': return viewCalendario();
    case 'pesaje': return viewPesaje();
    case 'leche': return viewLeche();
    case 'reproduccion': return viewReproduccion();
    case 'tienda': return window.GanaIDStore.render();
    case 'excel': return viewExcel();
    case 'configuracion': return viewConfiguracion();
    default: return '';
  }
}

function statCard(icon, label, value, color, bg){
  return `
    <div class="stat-card">
      <div class="stat-top">
        <div class="stat-icon" style="background:${bg};color:${color};">${icon}</div>
        <div class="stat-value">${value}</div>
      </div>
      <div class="stat-label">${label}</div>
    </div>`;
}

// A pedido, no queda NINGÚN aviso de "sincronizando"/"todo al día" — el
// vaciado de la cola es automático solo (cada 20 segundos, y al toque
// apenas vuelve la señal — ver el "online"/setInterval en shared/data.js,
// no hace falta que el ganadero vea nada de eso pasar). Lo ÚNICO que
// sigue mostrando algo acá es un fallo real: una acción que de verdad no
// se pudo subir (no un problema de señal, esos se reintentan solos) y
// necesita que el ganadero haga algo — volver a identificar un animal
// con otro chip, por ejemplo. Sin eso, esa acción se perdía en silencio
// sin que nadie se enterara.
function bloqueSincronizacion(fallos){
  if (!fallos.length) return '';
  return `
    <div class="card" style="border-color:var(--red);">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <h3 class="section-title">🔄 Sincronización</h3>
        <button class="btn btn-ghost" id="btnSincronizarAhora" style="padding:6px 10px;font-size:11px;" type="button">Sincronizar ahora</button>
      </div>
      <p class="small" style="margin-top:6px;color:var(--red);"><b>⚠️ ${fallos.length} no se pudo${fallos.length === 1 ? '' : 'eron'} completar:</b></p>
      ${fallos.map((f) => `
        <div class="card-flat" style="border-color:var(--red);background:rgba(192,57,43,0.06);margin-top:6px;">
          <b>${esc(f.descripcion)}</b>
          <p class="small muted" style="margin-top:2px;">${esc(f.motivo)}</p>
          <button class="btn btn-ghost" data-descartar-fallo="${f.id}" style="margin-top:6px;padding:5px 10px;font-size:11px;" type="button">Entendido</button>
        </div>`).join('')}
    </div>`;
}

function botonesElegirPlan(){
  return `
    <div class="row" style="gap:8px;margin-top:10px;">
      <button class="btn btn-primary" data-suscribirme="mensual" type="button" style="flex:1;">Mensual — $169/mes</button>
      <button class="btn btn-primary" data-suscribirme="anual" type="button" style="flex:1;">Anual — $1299/año</button>
    </div>`;
}
// Reactivado (ver supabase/migrations/20260924090000_reactivar_limite_y_codigos_promo.sql,
// que hace lo mismo del lado del servidor) — "tiene acceso completo" ya
// no es solo "pagó una suscripción real": una cuenta con crédito de
// hardware (compró chip/bastón) o que canjeó un código de promoción
// también tiene fecha_proximo_pago en el futuro, con el mismo efecto
// (sin tope de 50 animales/1 rancho). Por eso el chequeo es sobre esa
// fecha, no sobre plan_tipo/plan_estado — esos 2 solo importan para el
// TEXTO que se muestra (si es una suscripción de verdad o no). Devuelve
// solo el CONTENIDO (sin tarjeta propia) — vive dentro del panel
// "Suscripción" de Configuración, ver contenidoOpcionConfig().
function contenidoMiPlan(session){
  const hoy = new Date().toISOString().slice(0, 10);
  const tieneAccesoCompleto = session.fecha_proximo_pago && session.fecha_proximo_pago >= hoy;
  const esSuscripcionReal = session.plan_tipo === 'mensual' || session.plan_tipo === 'anual';
  // "al_dia" == Mercado Pago YA confirmó al menos un cobro autorizado —
  // si tocaste "Suscribirme" pero no llegaste a terminar el pago en
  // Mercado Pago (volviste atrás, cerraste esa pestaña), plan_tipo ya
  // queda anotado igual (ver crear-suscripcion) pero plan_estado sigue en
  // 'vencido' hasta que se confirme de verdad. Sin este chequeo, ese caso
  // mostraba "Cancelar suscripción" para una suscripción que Mercado Pago
  // nunca llegó a autorizar — cancelarla y volver a intentar quedaba en
  // loop, porque cada intento nuevo repetía lo mismo.
  const tieneSuscripcionConfirmada = esSuscripcionReal && session.plan_estado === 'al_dia';
  const estaCancelada = !!session.suscripcion_cancelada;

  if (tieneAccesoCompleto) {
    if (tieneSuscripcionConfirmada && estaCancelada) {
      // Ya pidió cancelar — sigue con acceso hasta la fecha que ya pagó,
      // pero no se le va a volver a cobrar. Se le deja igual la opción
      // de volver a suscribirse (por si se arrepiente o quiere cambiar
      // de plan mensual/anual).
      return `
        <p class="small muted">Suscripción ${session.plan_tipo} cancelada — tenés acceso completo hasta ${fmtFecha(session.fecha_proximo_pago)}, después no se te va a volver a cobrar.</p>
        ${botonesElegirPlan()}`;
    }
    return `
      <p class="small muted">
        ${tieneSuscripcionConfirmada ? `Suscripción ${session.plan_tipo} al día — próximo cobro ${fmtFecha(session.fecha_proximo_pago)}.` : `✅ Acceso completo vigente hasta ${fmtFecha(session.fecha_proximo_pago)} — sin tope de animales ni ranchos mientras tanto.`}
      </p>
      ${tieneSuscripcionConfirmada ? `<button class="btn btn-ghost btn-block" id="btnCancelarSuscripcion" type="button" style="margin-top:8px;color:var(--red);">Cancelar suscripción</button>` : ''}
      ${!tieneSuscripcionConfirmada ? botonesElegirPlan() : ''}`;
  }
  return `
    <p class="small muted">🌱 Versión gratis — hasta 50 animales y 1 rancho. Canjeá un código de promoción o suscribite para levantar el tope.</p>
    <form id="formCanjearCodigo" style="margin-top:10px;">
      <div class="row" style="gap:8px;">
        <input name="codigo" placeholder="Código de promoción" style="flex:1;text-transform:uppercase;" autocomplete="off">
        <button class="btn btn-ghost" type="submit">Canjear</button>
      </div>
    </form>
    ${botonesElegirPlan()}`;
}

// Aviso de privacidad — texto de referencia, no reemplaza una revisión
// legal (Ley Federal de Protección de Datos Personales en Posesión de
// los Particulares). El correo de contacto es un placeholder — hay que
// cambiarlo por el real antes de mostrarlo a un cliente de verdad.
function contenidoPoliticaPrivacidad(){
  return `
    <div class="small muted" style="line-height:1.6;">
      <p><b>¿Qué datos recopilamos?</b><br>
      Tus datos de contacto (nombre, correo, teléfono, municipio) y los datos de tu operación: ranchos, animales (identificación, raza, peso, sanidad, reproducción, producción de leche) y su historial.</p>
      <p><b>¿Para qué los usamos?</b><br>
      Para que puedas registrar y consultar la información de tu rebaño, para contactarte sobre tu cuenta o soporte técnico, y para generar reportes agregados (sin identificarte a vos ni a tu rancho) que ayuden a mejorar el servicio.</p>
      <p><b>¿Los compartimos?</b><br>
      No vendemos tus datos a terceros. Solo los compartimos cuando la ley lo exige, o con proveedores que nos ayudan a operar el servicio (por ejemplo, el hosting de la base de datos), bajo la misma obligación de confidencialidad.</p>
      <p><b>Tus derechos</b><br>
      Podés pedir en cualquier momento que corrijamos o eliminemos tus datos, escribiéndonos a <b>[tu correo de contacto acá]</b>.</p>
    </div>`;
}

// Todo lo de "cuenta" en un solo lugar (pedido explícito: no mezclarlo
// con Inicio), como una lista de opciones — un solo panel desplegado a
// la vez (configuracionAbierta), mismo patrón que "Tareas" en el detalle
// de un lote. "Editar rancho" es la excepción: abre el selector de
// siempre (abrirSelectorRancho()) en vez de desplegar acá — ya maneja
// varios ranchos (cambiar/editar/archivar/eliminar/crear), meterlo
// entero dentro de un panel sería reconstruir algo que ya funciona bien.
// "contenido" ya viene resuelto por quien llama (necesita perfil/session,
// que opcionConfig() no tiene por qué conocer) — solo arma la fila fija
// (ícono/label/flecha) y, si está abierta, el panel debajo.
function opcionConfig(id, icono, label, contenido){
  const abierta = configuracionAbierta === id;
  return `
    <div class="list-item" data-config-toggle="${id}" style="cursor:pointer;">
      <div style="flex:1;"><b>${icono} ${label}</b></div>
      <span class="list-chevron">${abierta ? '⌄' : '›'}</span>
    </div>
    ${abierta ? `<div class="card-flat" style="margin-top:-4px;">${contenido}</div>` : ''}`;
}

// Solo el botón correspondiente — "activas" lo resuelve viewConfiguracion()
// una vez (tengoNotificacionesActivas()), no en cada tecla. El aviso
// real (CUÁNDO se manda un push) todavía no existe del lado del
// servidor — esto solo dice si ESTE dispositivo quedó listo para
// recibirlos, ver supabase/migrations/20260926090000_notificaciones_push.sql.
function contenidoNotificacionesPush(activas){
  return `
    <p class="small muted">Avisos de parto próximo y recordatorios de vacunación vencidos — directo al celular, todos los días a las 7 AM, aunque no tengas la app abierta.</p>
    ${activas
      ? `<button class="btn btn-ghost btn-block" id="btnDesactivarPush" type="button" style="margin-top:8px;">Desactivar en este dispositivo</button>`
      : `<button class="btn btn-primary btn-block" id="btnActivarPush" type="button" style="margin-top:8px;">Activar notificaciones</button>`}
  `;
}

async function viewConfiguracion(){
  const session = mockApi.sesionActual();
  const [{ data: perfilCompleto }, notifActivas] = await Promise.all([
    supabaseClient.from('perfiles').select('*').eq('id', session.id).single(),
    mockApi.tengoNotificacionesActivas().catch(() => false),
  ]);
  const perfil = perfilCompleto || session;

  return `
    <h3 class="section-title" style="margin-bottom:14px;">Configuración</h3>

    ${opcionConfig('perfil', '👤', 'Editar perfil', formEditarPerfil(perfil))}
    <div class="list-item" id="btnAbrirRanchosConfig" style="cursor:pointer;">
      <div style="flex:1;"><b>🏡 Editar rancho</b></div>
      <span class="list-chevron">›</span>
    </div>
    ${opcionConfig('plan', '💳', 'Suscripción', contenidoMiPlan(session))}
    ${opcionConfig('notificaciones', '🔔', 'Notificaciones', contenidoNotificacionesPush(notifActivas))}
    ${opcionConfig('privacidad', '📄', 'Política de privacidad', contenidoPoliticaPrivacidad())}

    ${bloqueInstalarApp()}
    <button class="btn btn-ghost btn-block" id="btnCerrarSesionConfig" type="button" style="margin-top:8px;color:var(--red);">🚪 Cerrar sesión</button>
  `;
}

async function viewInicio(){
  const session = mockApi.sesionActual();
  const [animales, sanidadEventos, reproduccionEventos, fallos] = await Promise.all([
    mockApi.misAnimales(),
    mockApi.misEventosAnimal('sanidad', 500), mockApi.misEventosAnimal('reproduccion', 500),
    mockApi.listarFallosSincronizacion(),
  ]);
  const vivos = animales.filter(a => a.estado === 'vivo');
  const machos = vivos.filter(a => a.sexo === 'macho').length;
  const hembras = vivos.filter(a => a.sexo === 'hembra').length;
  const prenadas = contarPrenadas(animales, reproduccionEventos);
  // Sementales: machos vivos en edad reproductiva — mismo corte que ya
  // usa categoriaBovino() para clasificar a un macho como "Toro" (24
  // meses o más), no una marca aparte que alguien tenga que ir a tildar.
  const sementales = vivos.filter(a => a.sexo === 'macho' && categoriaBovino(a.sexo, a.fecha_nacimiento) === 'Toro').length;
  // Bajas: estado propio ('baja' — murió/se perdió), distinto de
  // vendido/sacrificado — esos son salidas "normales" del rebaño, esto
  // es lo que un productor de verdad llama "una baja".
  const bajas = animales.filter(a => a.estado === 'baja').length;

  // Alertas médicas: mismo cálculo que usa la pestaña Sanidad (ver
  // viewSanidad()) — cualquier animal con un período de retiro todavía
  // vigente.
  const alertasMedicas = animales
    .map(a => ({ a, retiro: retiroActivoHoy(sanidadEventos.filter(e => e.animal_id === a.id)) }))
    .filter(x => x.retiro);

  const alertasReproduccion = calcularAlertasReproduccion(animales, reproduccionEventos);
  const totalAlertas = alertasMedicas.length + alertasReproduccion.length;
  // "Próximas a parir": hembras con parto esperado dentro de 30 días (o
  // ya atrasado) — mismo cálculo que ya arma la alerta de tipo 'parto'
  // (ver calcularAlertasReproduccion()), solo contado acá para el stat.
  const proximasAParir = alertasReproduccion.filter(al => al.tipo === 'parto').length;

  // Combina medicas + reproducción en una sola lista, urgentes primero,
  // recortada para no ocupar todo Inicio — el detalle completo vive en
  // Sanidad/Reproducción, acá es solo un vistazo.
  const alertasParaMostrar = [
    ...alertasMedicas.map(x => ({ tipo: 'medica', urgente: true, animal: x.a, mensaje: `En período de retiro hasta ${x.retiro.retiro_hasta} — no debería venderse ni sacrificarse todavía` })),
    ...alertasReproduccion,
  ].sort((x, y) => (y.urgente - x.urgente)).slice(0, 5);

  return `
    <div class="stats-grid stats-inicio">
      ${statCard('<img src="../icono.png" alt="" style="width:22px;height:22px;">', 'Animales vivos', vivos.length, 'var(--primary)', 'var(--primary-soft)')}
      ${statCard('♂️', 'Machos', machos, 'var(--blue)', 'rgba(41,128,185,0.12)')}
      ${statCard('♀️', 'Hembras', hembras, 'var(--pink)', 'rgba(194,24,91,0.1)')}
      ${statCard('<img src="../embrion.png" alt="" style="width:22px;height:22px;">', 'Gestantes', prenadas, '#8E44AD', 'rgba(142,68,173,0.12)')}
      ${statCard('<img src="../prenadas.png" alt="" style="width:26px;height:26px;">', 'Próximas a parir', proximasAParir, '#C0392B', 'rgba(192,57,43,0.08)')}
      ${statCard('<img src="../sementales.png" alt="" style="width:22px;height:22px;object-fit:contain;">', 'Sementales', sementales, 'var(--blue)', 'rgba(41,128,185,0.12)')}
      ${statCard('<img src="../bajas.png" alt="" style="width:22px;height:22px;object-fit:contain;">', 'Bajas', bajas, '#6B6B6B', 'rgba(107,107,107,0.12)')}
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:2px;">
        <h3 class="section-title">⚠️ Alertas de salud y reproducción</h3>
        ${totalAlertas ? `<span class="pill pill-pendiente">${totalAlertas}</span>` : ''}
      </div>
      ${alertasParaMostrar.length ? alertasParaMostrar.map(al => al.tipo === 'medica'
        ? `<div class="card-flat" style="border-color:var(--red);background:rgba(192,57,43,0.06);margin-top:8px;">
             <b style="color:var(--red);">💉 ${esc(etiquetaAnimal(al.animal))}</b>
             <p class="small muted" style="margin-top:2px;">${esc(al.mensaje)}</p>
           </div>`
        : filaAlertaReproduccion(al)).join('') : `<div class="empty">Sin alertas por ahora.</div>`}
      ${totalAlertas > alertasParaMostrar.length ? `<p class="small muted" style="margin-top:8px;">Y ${totalAlertas - alertasParaMostrar.length} más — revisá Sanidad y Reproducción.</p>` : ''}
    </div>

    ${bloqueSincronizacion(fallos)}
  `;
}

// Nombre de archivo seguro a partir de un texto libre (nombre de rancho
// o de lote) — sin espacios ni acentos, para que no se rompa en ningún
// sistema de archivos.
function slugArchivo(texto){
  return (texto || 'sin-nombre').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Botón "⬇️ Exportar Excel" de Inicio — cargarSheetJS()/armarLibroExcel()
// viven en shared/ui-common.js (las comparte con Administración, ver
// exportarRespaldoExcel() en shared/view-generic.js).
async function exportarMiInformacion(todosLosRanchos = false){
  let respuesta;
  try { respuesta = await mockApi.miRespaldoExcel(todosLosRanchos); }
  catch (err) { toast(err.message, '⚠️'); return; }
  const { rancho_nombre, hojas } = respuesta;
  if (Object.values(hojas).every(hoja => !hoja.length)) {
    toast('Todavía no hay información guardada para exportar', '⚠️');
    return;
  }
  if (typeof XLSX === 'undefined') toast('Preparando el Excel…', '⏳');
  try { await cargarSheetJS(); }
  catch (err) { toast(err.message + ' — revisá la conexión', '⚠️'); return; }

  const wb = armarLibroExcel(hojas, [
    ['animales', 'Animales'],
    ['pesajes', 'Pesajes'],
    ['sanidad', 'Sanidad'],
    ['reproduccion', 'Reproducción'],
    ['otros_eventos', 'Altas, traslados y bajas'],
    ['sacrificios', 'Sacrificios'],
    ['guias_movilizacion', 'Guías de movilización'],
  ]);
  const sufijo = todosLosRanchos ? 'todos-mis-ranchos' : slugArchivo(rancho_nombre || 'mi-rancho');
  XLSX.writeFile(wb, `${sufijo}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Excel descargado', '⬇️');
}

// Botón "⬇️ Exportar Excel" del detalle de un lote — mismo mecanismo que
// exportarMiInformacion(), recortado a los animales de ESE lote (ver
// mockApi.miRespaldoExcelLote()).
async function exportarExcelLote(loteId){
  let respuesta;
  try { respuesta = await mockApi.miRespaldoExcelLote(loteId); }
  catch (err) { toast(err.message, '⚠️'); return; }
  const { lote_nombre, hojas } = respuesta;
  if (Object.values(hojas).every(hoja => !hoja.length)) {
    toast('Todavía no hay información guardada para exportar', '⚠️');
    return;
  }
  if (typeof XLSX === 'undefined') toast('Preparando el Excel…', '⏳');
  try { await cargarSheetJS(); }
  catch (err) { toast(err.message + ' — revisá la conexión', '⚠️'); return; }

  const wb = armarLibroExcel(hojas, [
    ['animales', 'Animales'],
    ['pesajes', 'Pesajes'],
    ['sanidad', 'Sanidad'],
    ['reproduccion', 'Reproducción'],
    ['otros_eventos', 'Altas, traslados y bajas'],
    ['sacrificios', 'Sacrificios'],
    ['guias_movilizacion', 'Guías de movilización'],
  ]);
  XLSX.writeFile(wb, `lote-${slugArchivo(lote_nombre)}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast('Excel descargado', '⬇️');
}

// Mismo patrón exacto que las demás pantallas (viewPesaje(), viewLeche()):
// devuelve HTML, sin overlay propio — bindEvents() (ver "app.js" más
// abajo) cablea sus botones en cada render, igual que el resto. Todo en
// UNA sola lista (ranchos + lotes, cada fila su propio ícono real, sin
// texto explicativo aparte) en vez de tarjetas separadas para lo mismo —
// tocar una fila descarga ese Excel directo. "Todos mis ranchos" solo
// aparece si hay más de uno — con uno solo, "rancho actual" ya es todo.
async function viewExcel(){
  const session = mockApi.sesionActual();
  let ranchos = [], lotes = [];
  try {
    [ranchos, lotes] = await Promise.all([mockApi.misRanchos(), mockApi.misLotes()]);
  } catch (err) { /* sin nada mejor que mostrar todavía — sigue con [] */ }
  const ranchoActual = ranchos.find(r => r.id === session.rancho_actual_id);

  const filaExportar = (attr, valor, src, titulo, sub) => `
    <div class="list-item" data-${attr}="${valor}" style="cursor:pointer;">
      <div class="list-avatar" style="background:rgba(15,42,74,0.14);">${src}</div>
      <div style="flex:1;min-width:0;">
        <div class="list-title">${esc(titulo)}</div>
        ${sub ? `<div class="list-sub">${esc(sub)}</div>` : ''}
      </div>
      <span class="list-chevron">›</span>
    </div>`;

  const iconoRancho = `<img src="../inicio.png" alt="" style="width:20px;height:20px;object-fit:contain;">`;
  const filas = [
    filaExportar('exportar-rancho-actual', '1', iconoRancho, ranchoActual ? ranchoActual.nombre : 'Mi rancho'),
    ranchos.length > 1 ? filaExportar('exportar-todos-ranchos', '1', iconoRancho, 'Todos mis ranchos') : '',
    ...lotes.map(l => filaExportar('exportar-lote', l.id, iconoTipoLote(l.tipo), l.nombre, etiquetaTipoLote(l.tipo))),
  ].join('');

  return `
    <h3 class="section-title" style="margin-bottom:14px;">Exportar a Excel</h3>
    ${filas}
  `;
}

// seccionForm()/splitRaza()/camposDatosAnimal() se mudaron a
// shared/ui-common.js — ahora también los usa Administración
// (shared/view-generic.js) para ver la ficha de un animal puntual.

// Registro directo: identificación (chip y/o N° interno — ver
// camposDatosAnimal()) + raza/sexo/color/peso/ubicación, y al guardar
// registrarAnimalDirecto() (data.js) resuelve el chip en el mismo paso:
// si escaneaste uno, ese; si tipeaste uno que coincide con el inventario
// oficial, se asigna igual; si no coincide (o no pusiste chip), se
// registra igual con lo que haya — ver el comentario largo en
// supabase/migrations/20260917140000_chip_opcional_temporal.sql.
async function viewNuevoAnimalRegistro(){
  const chip = chipEscaneadoParaRegistro;
  return `
    <div class="back-row">
      <button class="back-btn" data-volver-animales="1">←</button>
      <h3 class="section-title">Registrar un animal</h3>
    </div>
    <form id="formAnimalRegistro">
      ${await camposDatosAnimal({}, { chipEscaneado: chip })}
      <button class="btn btn-primary btn-block" type="submit">Registrar</button>
    </form>
  `;
}

async function viewAnimales(){
  const animales = await mockApi.misAnimales();
  return `
    <h3 class="section-title" style="margin-bottom:14px;">Mis animales</h3>
    <div class="list-with-fab">
      ${animales.length ? `
      <input id="buscarMisAnimales" placeholder="Chip o N° interno — escaneá para abrir la ficha" style="margin-bottom:14px;">
      <div id="listaAnimalesCertificados" class="grid-cards">
        ${animales.map(a => `
        <div class="list-item" data-ver-animal="${a.id}" data-buscar="${esc(((a.chip_uid || '') + ' ' + (a.numero_interno || '')).toLowerCase())}">
          <div class="list-avatar" style="background:${a.sexo === 'macho' ? 'rgba(41,128,185,0.1)' : 'rgba(194,24,91,0.1)'};">${a.sexo === 'macho' ? '♂️' : '♀️'}</div>
          <div style="flex:1;min-width:0;">
            <div class="list-title">${esc(etiquetaAnimal(a))} — ${esc(a.raza)}</div>
            <div class="list-sub">${a.chip_uid ? 'Chip: ' + esc(a.chip_uid) : 'Sin chip oficial todavía'}</div>
          </div>
          <span class="pill pill-${a.estado}">${etiquetaEstadoAnimal(a.estado)}</span>
        </div>`).join('')}
      </div>
      <p id="sinResultadosMisAnimales" class="small muted" style="display:none;text-align:center;margin-top:8px;">Sin resultados.</p>
      ` : `<div class="empty">Todavía no tenés ningún animal registrado.<br>Tocá el botón "+" para registrar el primero.</div>`}
    </div>
    <button class="fab" id="fabRegistrarAnimal" aria-label="Registrar animal">+</button>
  `;
}

// =====================================================================
// "Lote": un solo modelo para cualquier uso — manejo (Cría, Engorda…),
// protocolo reproductivo, campaña sanitaria u otro. Ver el comentario
// largo en supabase/migrations/20260918090000_unificar_lotes.sql: la
// "función" (tipo) y el nombre se pueden editar después de creado (ver
// abrirEditorLote()), y un animal puede estar en varios lotes a la vez
// (el servidor solo se encarga de que no esté en dos de tipo "manejo"
// juntos — ver agregar_animales_a_lote()). Dos formas de sumar animales,
// combinables:
//   - Animales YA guardados: un selector con checklist (ver
//     abrirSelectorAnimalesGuardados()).
//   - Animales escaneados: si el chip ya es de un animal propio, se suma
//     directo (sin pasos extra); si es un chip nuevo disponible en
//     inventario, queda pendiente de registrar ahí mismo (ver
//     agregarChipALote()/filaLoteHtml() más abajo) — al guardar, se
//     registra Y se suma al lote en el mismo paso.
// viewLoteDetalle() también deja aplicar un protocolo reproductivo o una
// intervención de sanidad al grupo entero de una, y muestra ganancia de
// peso + % de preñez con resumenLote() — disponible para cualquier tipo
// de lote, no solo los pensados para eso.
// =====================================================================
const TIPOS_LOTE = [
  { value: 'manejo', label: 'Manejo (Cría, Engorda…)' },
  { value: 'protocolo_reproductivo', label: 'Protocolo reproductivo' },
  { value: 'campaña_sanitaria', label: 'Campaña sanitaria' },
  { value: 'otro', label: 'Otro' },
];
function selectTipoLote(valorActual = 'manejo'){
  return `<select name="tipo">
    ${TIPOS_LOTE.map(t => `<option value="${t.value}" ${t.value === valorActual ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
  </select>`;
}
function etiquetaTipoLote(tipo){
  return (TIPOS_LOTE.find(t => t.value === tipo) || {}).label || tipo;
}
// Mismos íconos que ya usa cada sección propia (Animales/Reproducción/
// Sanidad) en vez de emojis genéricos — así un lote de manejo, de
// protocolo o de campaña se reconoce de un vistazo por el mismo ícono
// que ya asociás a esa función en el resto de la app. "Otro" cae en el
// ícono de Lote en sí (no hay uno más específico para ese caso).
function iconoTipoLote(tipo){
  const src = tipo === 'manejo' ? '../animales.png'
    : tipo === 'protocolo_reproductivo' ? '../reproduccion.png'
    : tipo === 'campaña_sanitaria' ? '../sanidad.png'
    : '../lote.png';
  return `<img src="${src}" alt="" style="width:20px;height:20px;object-fit:contain;">`;
}

async function viewLotes(){
  const lotes = await mockApi.misLotes();
  return `
    <h3 class="section-title" style="margin-bottom:4px;">Lotes</h3>
    <div class="list-with-fab">
      ${lotes.length ? lotes.map(l => `
      <div class="list-item" data-ver-lote="${l.id}">
        <div class="list-avatar" style="background:rgba(15,42,74,0.14);">${iconoTipoLote(l.tipo)}</div>
        <div style="flex:1;min-width:0;">
          <div class="list-title">${esc(l.nombre)}</div>
          <div class="list-sub">${esc(etiquetaTipoLote(l.tipo))}${l.categoria ? ' · ' + esc(l.categoria) : ''}</div>
        </div>
        <span class="list-chevron">›</span>
      </div>`).join('') : `<div class="empty">Todavía no armaste ningún lote.<br>Tocá el botón "+" para crear el primero.</div>`}
    </div>
    <button class="fab" id="fabNuevoLote" aria-label="Nuevo lote">+</button>
  `;
}

async function viewNuevoLoteForm(){
  return `
    <div class="back-row">
      <button class="back-btn" data-volver-lotes="1">←</button>
      <h3 class="section-title">Nuevo lote</h3>
    </div>
    <form id="formNuevoLote">
      <label>Nombre *</label>
      <input name="nombre" placeholder="p. ej. Engorda Verano 2026" required>
      <label>Función</label>
      ${selectTipoLote()}
      <label>Categoría</label>
      ${selectCategoriaLote('categoria')}
      <label>Notas</label>
      <textarea name="notas" placeholder="Opcional"></textarea>
      <button class="btn btn-primary btn-block" type="submit">Crear lote</button>
    </form>
  `;
}

async function viewLoteDetalle(){
  const lotes = await mockApi.misLotes();
  const lote = lotes.find(l => l.id === loteSeleccionadoId);
  if (!lote) {
    // Se archivó (o dejó de existir) desde otro lado mientras se estaba
    // viendo — vuelve a la lista en vez de romper con un lote fantasma.
    loteScreenSubview = 'lista';
    return await viewLotes();
  }

  let resumen;
  try { resumen = await mockApi.resumenLote(lote.id); }
  catch (err) {
    // Lote nunca visto en este celular + sin conexión ahora — no hay
    // nada mejor que mostrar (ver el comentario de resumenLote() en
    // shared/data.js). Mismo criterio que arriba: vuelve a la lista en
    // vez de romper toda la pantalla.
    toast(err.message, '⚠️');
    loteScreenSubview = 'lista';
    return await viewLotes();
  }
  // Sin datos suficientes (nunca se pesó antes de entrar, o no hay
  // pesaje posterior) siempre al final, sea cual sea el orden elegido —
  // "no sé" no es ni lo mejor ni lo peor.
  const animales = [...resumen.animales].sort((a, b) => {
    if (a.ganancia_diaria_kg == null && b.ganancia_diaria_kg == null) return 0;
    if (a.ganancia_diaria_kg == null) return 1;
    if (b.ganancia_diaria_kg == null) return -1;
    return loteOrdenRanking === 'desc'
      ? b.ganancia_diaria_kg - a.ganancia_diaria_kg
      : a.ganancia_diaria_kg - b.ganancia_diaria_kg;
  });

  const rep = resumen.reproduccion;
  const diagnosticadas = rep.preñadas + rep.vacias;
  const pctPrenez = diagnosticadas > 0 ? Math.round((rep.preñadas / diagnosticadas) * 100) : null;

  // Estadística agregada del lote — lo primero que hay que ver al abrir
  // uno, antes que ningún formulario: cuánto pesa el grupo en conjunto y
  // cómo va el protocolo reproductivo, no solo el detalle animal por
  // animal (eso queda en la lista de abajo).
  const conDatosPeso = animales.filter(a => a.ganancia_diaria_kg != null);
  const promedioGanancia = conDatosPeso.length
    ? conDatosPeso.reduce((s, a) => s + a.ganancia_diaria_kg, 0) / conDatosPeso.length
    : null;
  const mejor = conDatosPeso.length ? conDatosPeso.reduce((m, a) => a.ganancia_diaria_kg > m.ganancia_diaria_kg ? a : m) : null;
  const peor = conDatosPeso.length ? conDatosPeso.reduce((m, a) => a.ganancia_diaria_kg < m.ganancia_diaria_kg ? a : m) : null;

  // Peso actual del grupo — distinto de "ganancia" de arriba (esa es
  // ritmo, kg/día; esto es cuánto pesa cada uno HOY). Se arma también el
  // gráfico de barras acá mismo (reusa ".barra", el mismo componente que
  // ya usa filaPesaje() para el historial individual de un animal, así
  // no queda un estilo de gráfica distinto por pantalla).
  const conPesoActual = animales.filter(a => a.peso_actual_kg != null).sort((a, b) => b.peso_actual_kg - a.peso_actual_kg);
  const pesoPromedio = conPesoActual.length
    ? Math.round(conPesoActual.reduce((s, a) => s + Number(a.peso_actual_kg), 0) / conPesoActual.length)
    : null;
  const maxPesoGrupo = conPesoActual.length ? conPesoActual[0].peso_actual_kg : 0;
  const graficoPesos = conPesoActual.length ? `
    <div style="margin-top:12px;max-height:220px;overflow-y:auto;">
      ${conPesoActual.map(a => `
        <div style="margin-top:8px;">
          <div class="row" style="justify-content:space-between;font-size:12px;">
            <span class="muted">${esc(a.numero_interno || a.chip_uid || '(sin identificar)')}</span>
            <b>${a.peso_actual_kg} kg</b>
          </div>
          <div class="barra"><div style="width:${maxPesoGrupo ? ((a.peso_actual_kg / maxPesoGrupo) * 100).toFixed(0) : 0}%;"></div></div>
        </div>`).join('')}
    </div>` : '';

  // Proporciones reproductivas como una sola barra apilada (verde/rojo/
  // gris) — mismo dato que ya muestran las 3 tarjetas de abajo, pero de
  // un vistazo se lee mejor una proporción que 3 números sueltos.
  const totalRep = rep.preñadas + rep.vacias + rep.pendientes;
  const graficoReproduccion = totalRep > 0 ? `
    <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;margin-top:10px;">
      ${rep.preñadas ? `<div style="width:${(rep.preñadas / totalRep) * 100}%;background:#2E7D32;" title="Preñadas: ${rep.preñadas}"></div>` : ''}
      ${rep.vacias ? `<div style="width:${(rep.vacias / totalRep) * 100}%;background:#C0392B;" title="Vacías: ${rep.vacias}"></div>` : ''}
      ${rep.pendientes ? `<div style="width:${(rep.pendientes / totalRep) * 100}%;background:#8FA0B8;" title="Pendientes: ${rep.pendientes}"></div>` : ''}
    </div>` : '';

  // Si hay un borrador de animales nuevos sin guardar, "Sumar animal"
  // cuenta como abierta aunque loteTareaAbierta no lo diga — para no
  // esconder un borrador a medio llenar detrás de una pestaña que ni
  // siquiera se ve mientras se está en "Grupo".
  const sumarAbierto = loteTareaAbierta === 'sumar' || loteAnimales.length > 0;

  return `
    <div class="back-row" style="justify-content:space-between;">
      <div class="row" style="align-items:center;gap:6px;min-width:0;">
        <button class="back-btn" data-volver-lotes="1">←</button>
        <h3 class="section-title" style="margin-bottom:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(lote.nombre)}</h3>
        <button class="btn btn-ghost" type="button" id="btnEditarLote" style="padding:3px 8px;font-size:13px;flex-shrink:0;">✏️</button>
      </div>
      <button class="btn btn-ghost" type="button" id="btnMasOpcionesLote" style="padding:3px 10px;font-size:16px;flex-shrink:0;">⋮</button>
    </div>
    <p class="section-sub">${esc(etiquetaTipoLote(lote.tipo))}${lote.categoria ? ' · ' + esc(lote.categoria) : ''}${lote.notas ? ' · ' + esc(lote.notas) : ''}</p>

    <div class="ficha-tabs">
      <button type="button" class="ficha-tab ${loteDetalleSubview === 'grupo' ? 'active' : ''}" data-lote-detalle-tab="grupo">Grupo</button>
      <button type="button" class="ficha-tab ${loteDetalleSubview === 'tareas' ? 'active' : ''}" data-lote-detalle-tab="tareas">✅ Tareas${loteAnimales.length ? ` (${loteAnimales.length})` : ''}</button>
    </div>

    ${loteDetalleSubview === 'grupo' ? `
    <div class="card">
      <h4 class="section-title" style="font-size:14px;">Cómo va el grupo</h4>
      <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);margin-top:8px;">
        ${statCard('<img src="../animales.png" alt="" style="width:22px;height:22px;object-fit:contain;">', 'Animales', resumen.total_animales, '#0F2A4A', 'rgba(15,42,74,0.14)')}
        ${statCard('⚖️', 'Peso promedio', pesoPromedio != null ? `${pesoPromedio} kg` : '—', '#8E44AD', 'rgba(142,68,173,0.1)')}
      </div>
      ${promedioGanancia != null ? `
      <p style="margin-top:10px;font-weight:800;font-size:15px;">Ganancia promedio: ${promedioGanancia.toFixed(3)} kg/día</p>
      <p class="small muted" style="margin-top:2px;">Mejor: ${esc(mejor.numero_interno || mejor.chip_uid || '(sin identificar)')} (${mejor.ganancia_diaria_kg} kg/día) · Peor: ${esc(peor.numero_interno || peor.chip_uid || '(sin identificar)')} (${peor.ganancia_diaria_kg} kg/día)</p>
      ` : ''}
      ${graficoPesos}

      ${rep.con_protocolo > 0 ? `
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin-top:12px;">
        ${statCard('<img src="../prenadas.png" alt="" style="width:22px;height:22px;">', 'Preñadas', rep.preñadas, '#2E7D32', 'rgba(46,125,50,0.1)')}
        ${statCard('🔴', 'Vacías', rep.vacias, '#C0392B', 'rgba(192,57,43,0.08)')}
        ${statCard('⏳', 'Pendientes', rep.pendientes, '#8FA0B8', 'rgba(143,160,184,0.12)')}
      </div>
      ${graficoReproduccion}
      ${pctPrenez !== null ? `<p style="margin-top:10px;font-weight:800;font-size:15px;">% de preñez (sobre diagnosticadas): ${pctPrenez}%</p>` : ''}
      ` : ''}
    </div>

    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <h4 class="section-title" style="font-size:14px;margin-bottom:0;">Cada animal en el grupo (${resumen.total_animales})</h4>
        ${animales.length ? `
        <button type="button" class="btn btn-ghost" id="btnOrdenRankingLote" style="padding:4px 10px;font-size:11px;margin-top:0;white-space:nowrap;">
          ${loteOrdenRanking === 'desc' ? '⬇️ Mejores primero' : '⬆️ Peores primero'}
        </button>` : ''}
      </div>
      ${animales.length ? `
      <div style="margin-top:8px;">
        ${animales.map(a => `
        <div class="list-item" style="cursor:default;">
          <div style="flex:1;min-width:0;cursor:pointer;" data-ver-animal="${a.animal_id}">
            <div class="list-title">${esc(a.numero_interno || a.chip_uid || '(sin identificar)')}</div>
            <div class="list-sub">
              ${a.peso_entrada_kg != null ? `Entrada: ${a.peso_entrada_kg} kg` : 'Sin pesaje previo'} → Actual: ${a.peso_actual_kg != null ? `${a.peso_actual_kg} kg` : 'sin dato'}
              ${a.resultado_reproductivo ? ` · ${esc(a.resultado_reproductivo)}` : ''}
            </div>
          </div>
          <div style="text-align:right;font-weight:800;font-size:13px;${a.ganancia_diaria_kg == null ? 'color:var(--text-3);' : a.ganancia_diaria_kg >= 0 ? 'color:#2E7D32;' : 'color:#C0392B;'}">
            ${a.ganancia_diaria_kg != null ? `${a.ganancia_diaria_kg} kg/día` : 'Sin datos'}
          </div>
          <button type="button" class="btn btn-ghost" data-quitar-de-lote="${a.animal_id}" style="padding:4px 8px;font-size:11px;margin-top:0;margin-left:6px;">✕</button>
        </div>`).join('')}
      </div>` : `<div class="empty">Todavía no hay ningún animal en este lote — sumalo desde la pestaña "Tareas".</div>`}
    </div>
    ` : ''}

    ${loteDetalleSubview === 'tareas' ? `
    <div class="row scroll-row" style="margin-top:0;margin-bottom:14px;">
      <button class="btn ${sumarAbierto ? 'btn-primary' : 'btn-ghost'}" type="button" data-lote-tarea="sumar" style="font-size:11px;padding:4px 10px;"><span class="btn-ico">➕</span> Sumar animal</button>
      <button class="btn ${loteTareaAbierta === 'reproduccion' ? 'btn-primary' : 'btn-ghost'}" type="button" data-lote-tarea="reproduccion" style="font-size:11px;padding:4px 10px;"><span class="btn-ico"><img src="../reproduccion.png" alt="" style="width:13px;height:13px;object-fit:contain;vertical-align:-2px;"></span> Reproducción</button>
      <button class="btn ${loteTareaAbierta === 'sanidad' ? 'btn-primary' : 'btn-ghost'}" type="button" data-lote-tarea="sanidad" style="font-size:11px;padding:4px 10px;"><span class="btn-ico"><img src="../sanidad.png" alt="" style="width:13px;height:13px;object-fit:contain;vertical-align:-2px;"></span> Sanidad</button>
    </div>

    ${sumarAbierto ? `
    <div class="card">
      <h4 class="section-title" style="font-size:14px;">Sumar animales</h4>
      <label>Escaneá el chip de cada animal</label>
      <input id="loteEscaner" placeholder="Chip ya registrado o disponible — se agrega solo">
      <button class="btn btn-ghost btn-block" type="button" id="btnAbrirSeleccionGuardados" style="margin-top:10px;">📋 Elegir de mis animales guardados</button>
      <div class="row" style="gap:8px;margin-top:10px;">
        <button class="btn btn-ghost" type="button" id="btnLoteAgregarMacho" style="flex:1;">♂️ Macho sin chip</button>
        <button class="btn btn-ghost" type="button" id="btnLoteAgregarHembra" style="flex:1;">♀️ Hembra sin chip</button>
      </div>
    </div>

    <div class="card" id="loteDatosNuevos" style="${loteAnimales.length ? '' : 'display:none;'}">
      <h4 class="section-title" style="font-size:14px;">Datos de los animales nuevos que vas a sumar</h4>
      <label>Raza *</label>
      <input id="loteRaza" placeholder="p. ej. Brahman">
      <div class="row">
        <div style="flex:1;min-width:140px;">
          <label>Color / pelaje</label>
          <input id="loteColor" placeholder="Opcional">
        </div>
        <div style="flex:1;min-width:140px;">
          <label>Fecha de nacimiento</label>
          <input type="date" id="loteFechaNacimiento">
        </div>
      </div>
      <label>Hierro / marca de herrar</label>
      <input id="loteMarcaHierro" placeholder="Opcional">
      <label>Rancho / predio</label>
      <input id="loteUbicacion" placeholder="p. ej. Rancho El Progreso, Villaflores">
      <label>Observaciones</label>
      <textarea id="loteNotas" placeholder="p. ej. Compra a Rancho Los Álamos, 17/08/2026"></textarea>
      <div id="loteFilas">${loteAnimales.map((f, idx) => filaLoteHtml(f, idx)).join('')}</div>
      <button class="btn btn-primary btn-block" type="button" id="btnGuardarLote">Registrar y sumar al lote (<span id="loteContador">${loteAnimales.length}</span>)</button>
    </div>
    ` : ''}

    ${loteTareaAbierta === 'reproduccion' ? `
    <div class="card">
      <h4 class="section-title" style="font-size:14px;">Aplicar protocolo reproductivo al grupo</h4>
      <form id="formReproduccionLote">
        <label>Tipo de evento</label>
        <select name="tipo" required>
          <option value="Monta natural">Monta natural</option>
          <option value="Inseminación artificial">Inseminación artificial</option>
          <option value="Otro">Otro</option>
        </select>
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="semental" placeholder="Semental / pajilla (opcional)" style="flex:1;">
          <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
        </div>
        <label>Veterinario responsable</label>
        <input name="veterinario" placeholder="Opcional, si no sos vos">
        <label>Notas</label>
        <input name="notas" placeholder="Opcional">
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Aplicar a ${resumen.total_animales} animal(es)</button>
      </form>
    </div>
    ` : ''}

    ${loteTareaAbierta === 'sanidad' ? `
    <div class="card">
      <h4 class="section-title" style="font-size:14px;">Aplicar sanidad al grupo</h4>
      <form id="formSanidadLote">
        <label>Tipo de intervención</label>
        <select name="tipo" required>
          <option value="Vacuna">Vacuna</option>
          <option value="Desparasitación">Desparasitación</option>
          <option value="Tratamiento">Tratamiento</option>
          <option value="Revisión veterinaria">Revisión veterinaria</option>
          <option value="Otro">Otro</option>
        </select>
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="notas" placeholder="Notas (opcional)" style="flex:2;">
          <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
        </div>
        <label>Producto / marca</label>
        <input name="producto" placeholder="Opcional">
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="lote_producto" placeholder="N° de lote (opcional)" style="flex:1;">
          <input name="dosis" placeholder="Dosis (opcional)" style="flex:1;">
        </div>
        <label>Veterinario responsable</label>
        <input name="veterinario" placeholder="Opcional, si no sos vos">
        <label>Días de retiro</label>
        <input name="dias_retiro" type="number" min="0" placeholder="Antes de vender o sacrificar (opcional)">
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Aplicar a ${resumen.total_animales} animal(es)</button>
      </form>
    </div>
    ` : ''}
    ` : ''}
  `;
}

// "Más opciones" (⋮) — junta editar/archivar/eliminar/exportar en un
// solo lugar en vez de una fila de botones siempre visible arriba del
// lote (eran 4 antes, competían con las pestañas de abajo). Editar
// quedó afuera de este menú, al lado del nombre, por ser la acción más
// frecuente de las 4.
function abrirMasOpcionesLote(lote){
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="section-title" style="margin-bottom:14px;">${esc(lote.nombre)}</h3>
      <button class="btn btn-ghost btn-block" type="button" id="btnExportarExcelLote">⬇️ Exportar Excel</button>
      <button class="btn btn-ghost btn-block" type="button" id="btnArchivarLote" style="margin-top:8px;">🗄️ Archivar lote</button>
      <button class="btn btn-ghost btn-block" type="button" id="btnEliminarLote" style="margin-top:8px;color:var(--red);">🗑️ Eliminar lote</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('btnExportarExcelLote').onclick = () => { overlay.remove(); exportarExcelLote(lote.id); };
  document.getElementById('btnArchivarLote').onclick = async () => {
    if (!confirm('¿Archivar este lote? Los animales que tiene adentro no se tocan, solo deja de aparecer en la lista.')) return;
    try {
      await mockApi.archivarLote(lote.id);
      toast('Lote archivado', '🗄️');
      overlay.remove();
      loteAnimales = [];
      loteSeleccionadoId = null;
      loteScreenSubview = 'lista';
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  document.getElementById('btnEliminarLote').onclick = async () => {
    if (!confirm('¿Eliminar este lote? A diferencia de archivar, esto NO se puede deshacer — el lote desaparece del todo (los animales y su historial de eventos no se tocan, solo pierden la referencia a este lote).')) return;
    try {
      await mockApi.eliminarLote(lote.id);
      toast('Lote eliminado', '🗑️');
      overlay.remove();
      loteAnimales = [];
      loteSeleccionadoId = null;
      loteScreenSubview = 'lista';
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
}

// Overlay para renombrar/cambiar la función de un lote ya creado — lo
// que pedía el usuario: "un solo lote con la posibilidad de ir editando
// el nombre y función". Mismo patrón que abrirSelectorRancho()/
// abrirFichaAnimal(), sin CSS nuevo.
function abrirEditorLote(lote){
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="section-title" style="margin-bottom:14px;">Editar lote</h3>
      <form id="formEditarLote">
        <label>Nombre *</label>
        <input name="nombre" value="${esc(lote.nombre)}" required>
        <label>Función</label>
        ${selectTipoLote(lote.tipo)}
        <label>Categoría</label>
        ${selectCategoriaLote('categoria', lote.categoria || '')}
        <label>Notas</label>
        <textarea name="notas" placeholder="Opcional">${lote.notas ? esc(lote.notas) : ''}</textarea>
        <button class="btn btn-primary btn-block" type="submit">Guardar cambios</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const form = document.getElementById('formEditarLote');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    try {
      await mockApi.editarLote(lote.id, { nombre: fd.get('nombre'), tipo: fd.get('tipo'), categoria: fd.get('categoria'), notas: fd.get('notas') });
      toast('Lote actualizado', '✏️');
      overlay.remove();
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
}

// Checklist para sumar animales que ya estaban registrados (sin escanear
// ni tipear nada) — mismo patrón de overlay que abrirFichaAnimal()/
// abrirMenuUsuario(), sin CSS nuevo.
function abrirSelectorAnimalesGuardados(lote, disponibles){
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="section-title" style="margin-bottom:2px;">Sumar animales</h3>
      <p class="small muted" style="margin-bottom:14px;">Elegí cuáles sumar a "${esc(lote.nombre)}".</p>
      ${disponibles.length ? `
      <div style="max-height:50vh;overflow-y:auto;">
        ${disponibles.map(a => `
        <label class="check-row" style="padding:8px 0;border-bottom:1px solid var(--border);">
          <input type="checkbox" value="${a.id}" data-check-animal="${a.id}">
          <span style="flex:1;">${esc(etiquetaAnimal(a))} — ${esc(a.raza)}</span>
        </label>`).join('')}
      </div>
      <button class="btn btn-primary btn-block" type="button" id="btnConfirmarSeleccionGuardados">Sumar seleccionados</button>
      ` : `<div class="empty">No tenés otros animales guardados para sumar.</div>`}
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const btnConfirmar = document.getElementById('btnConfirmarSeleccionGuardados');
  if (btnConfirmar) btnConfirmar.onclick = async () => {
    const ids = Array.from(overlay.querySelectorAll('[data-check-animal]:checked')).map(chk => idPropio(chk.value));
    if (!ids.length) { toast('No seleccionaste ningún animal', '⚠️'); return; }
    try {
      await mockApi.agregarAnimalesALote(lote.id, ids);
      toast(`${ids.length} animal(es) sumado(s) al lote`, '✅');
      overlay.remove();
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
}

// Una fila del lote (ver arriba) — sexo/N° interno/peso se editan acá
// mismo, delegado por bindEvents() sobre #loteFilas (data-lote-campo +
// data-lote-idx) para no tener que re-cablear cada fila una por una.
function filaLoteHtml(fila, idx){
  return `
    <div class="card-flat" data-lote-fila="${idx}">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <b class="small">Animal nuevo</b>
        <button type="button" class="btn btn-ghost" data-lote-quitar="${idx}" style="padding:4px 10px;font-size:11px;margin-top:0;">Quitar</button>
      </div>
      ${fila.chip_uid ? `
      <label style="margin-top:6px;">Chip</label>
      <input value="${esc(fila.chip_uid)}" readonly style="background:transparent;font-weight:600;">
      ` : ''}
      <div class="row" style="margin-top:6px;">
        <div style="flex:1;min-width:100px;">
          <label style="margin-top:0;">Sexo</label>
          <select data-lote-campo="sexo" data-lote-idx="${idx}">
            <option value="macho" ${fila.sexo === 'macho' ? 'selected' : ''}>Macho</option>
            <option value="hembra" ${fila.sexo === 'hembra' ? 'selected' : ''}>Hembra</option>
          </select>
        </div>
        <div style="flex:1;min-width:100px;">
          <label style="margin-top:0;">N° interno</label>
          <input data-lote-campo="numero_interno" data-lote-idx="${idx}" value="${esc(fila.numero_interno || '')}" placeholder="${fila.chip_uid ? 'Opcional' : 'Obligatorio — no tiene chip'}">
        </div>
        <div style="flex:1;min-width:100px;">
          <label style="margin-top:0;">Peso (kg)</label>
          <input data-lote-campo="peso_actual_kg" data-lote-idx="${idx}" type="number" step="0.1" min="0" value="${esc(fila.peso_actual_kg || '')}" placeholder="Opcional">
        </div>
      </div>
    </div>`;
}

// Redibuja SOLO #loteFilas/#loteDatosNuevos (no toda la pantalla vía
// renderApp()) — así lo que ya se cargó en "Datos de los animales
// nuevos" no se pierde cada vez que se agrega o quita uno.
function renderFilasLote(){
  const cont = document.getElementById('loteFilas');
  if (!cont) return;
  cont.innerHTML = loteAnimales.map((f, idx) => filaLoteHtml(f, idx)).join('');
  const wrap = document.getElementById('loteDatosNuevos');
  const contador = document.getElementById('loteContador');
  if (contador) contador.textContent = String(loteAnimales.length);
  if (wrap) wrap.style.display = loteAnimales.length ? '' : 'none';
}

// Agrega un chip escaneado al lote (o avisa por qué no) — usado tanto por
// el campo "loteEscaner" de esta pantalla como por procesarChipEscaneado()
// cuando el escaneo global ocurre estando en modo lote.
async function agregarChipALote(identificador){
  const q = (identificador || '').trim();
  if (!q) return;
  if (loteAnimales.some(f => f.chip_uid === q)) { toast('Ese chip ya está en la lista del lote', '⚠️'); return; }

  let info;
  try {
    info = await mockApi.consultarChip(q);
  } catch (err) {
    // Mismo criterio que procesarChipEscaneado(): sin conexión no se
    // puede confirmar el chip contra el inventario en el momento, pero
    // eso ya no bloquea sumarlo — se deja pasar igual, se confirma solo
    // cuando el alta sincronice de verdad (registrarAnimalDirecto() ya
    // acepta cualquier chip sin señal).
    if (!_pareceErrorDeConexion(err)) { toast(err.message, '⚠️'); return; }
    loteAnimales.push({ chip_uid: q, sexo: 'macho', numero_interno: '', peso_actual_kg: '' });
    renderFilasLote();
    const inputOffline = document.getElementById('loteEscaner');
    if (inputOffline) { inputOffline.value = ''; inputOffline.focus(); }
    toast('Sin conexión — el chip se agrega igual, se confirma cuando vuelva la señal', '📴');
    return;
  }

  if (!info.existe) { toast(info.advertencia || 'Ese número no está en el inventario', '⚠️'); return; }
  if (info.estado !== 'en_stock') {
    toast(
      info.estado === 'invalidado' ? 'Ese chip está invalidado — no se puede usar' : 'Ese chip ya está asignado a un animal',
      '⚠️'
    );
    return;
  }

  loteAnimales.push({ chip_uid: q, sexo: 'macho', numero_interno: '', peso_actual_kg: '' });
  renderFilasLote();
  const input = document.getElementById('loteEscaner');
  if (input) { input.value = ''; input.focus(); }
  toast('Animal agregado al lote', '➕');
}

// Resuelve lo que se tipeó (o escaneó con el lector) en "Sanidad"/"Pesaje"
// contra los animales del propio ganadero — acepta N° interno o chip,
// como buscarAnimalMonitoreo() del lado del admin. Devuelve null si no
// coincide con nada propio (mockApi.registrarPesaje()/registrarSanidad()
// igual lo volverían a rechazar por dueño, pero conviene el mensaje claro
// acá antes de intentar).
async function buscarMiAnimalPorIdentificador(identificador){
  const q = (identificador || '').trim().toLowerCase();
  if (!q) return null;
  const animales = await mockApi.misAnimales();
  return animales.find(a => (a.chip_uid || '').toLowerCase() === q || (a.numero_interno || '').toLowerCase() === q) || null;
}

// Mini-dashboard del animal — MISMA pinta visual que ya usa la ficha
// (abrirFichaAnimal(): barras de peso doradas, condición corporal,
// bitácora de sanidad con aviso de retiro), para no tener una versión
// "pobre" en texto plano acá y otra con gráfico allá. La usan tanto la
// vista previa en vivo de "Sanidad"/"Pesaje" (bindLookupAnimalRapido)
// como cualquier otro lugar que en el futuro necesite mostrar esto mismo.
async function dashboardAnimalHtml(animal){
  const eventos = await mockApi.eventosDeAnimal(animal.id);
  const pesajes = eventos
    .filter(e => e.tipo === 'pesaje')
    .sort((x, y) => x.fecha.localeCompare(y.fecha)); // cronológico: se lee como curva de crecimiento
  const maxPeso = pesajes.length ? Math.max(...pesajes.map(p => p.peso_kg)) : 1;
  const sanidad = eventos
    .filter(e => e.tipo === 'sanidad')
    .sort((x, y) => y.fecha.localeCompare(x.fecha)); // bitácora: más reciente primero
  const retiro = retiroActivoHoy(sanidad);

  return `
    <div class="card" style="margin-top:10px;">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <b>${esc(etiquetaAnimal(animal))}</b>
        <span class="pill pill-${animal.estado}">${etiquetaEstadoAnimal(animal.estado)}</span>
      </div>
      <div class="small muted" style="margin-top:2px;">${animal.chip_uid ? 'Chip: ' + esc(animal.chip_uid) : 'Sin chip oficial todavía'}</div>
      ${retiro ? `
      <div style="margin-top:8px;padding:8px 10px;background:rgba(192,57,43,0.08);border-radius:10px;">
        <b style="color:var(--red);font-size:12.5px;">⚠️ En período de retiro hasta ${retiro.retiro_hasta}</b>
      </div>` : ''}
      <div class="form-section-title">Peso</div>
      ${pesajes.length ? `<div class="timeline">${pesajes.map(p => filaPesaje(p, maxPeso)).join('')}</div>` : `<p class="small muted" style="margin-top:8px;">Todavía no hay pesajes cargados.</p>`}
      <div class="form-section-title">Sanidad</div>
      ${sanidad.length ? `<div class="timeline">${sanidad.map(filaSanidad).join('')}</div>` : `<p class="small muted" style="margin-top:8px;">Todavía no hay sanidad cargada.</p>`}
    </div>`;
}

// Vista previa en vivo dentro de "Sanidad"/"Pesaje": apenas el
// identificador tipeado (o escaneado con el lector) matchea uno de tus
// animales, despliega su dashboard completo ahí mismo (peso + sanidad
// juntos, no solo el tipo de la pantalla en la que estás) — sin tener que
// guardar primero para enterarte qué tiene cargado.
function bindLookupAnimalRapido(inputId, destinoId){
  const input = document.getElementById(inputId);
  const destino = document.getElementById(destinoId);
  if (!input || !destino) return;
  const actualizar = async () => {
    const animal = await buscarMiAnimalPorIdentificador(input.value);
    destino.innerHTML = animal ? await dashboardAnimalHtml(animal) : '';
  };
  input.oninput = actualizar;
  actualizar();
}

// ===== Genealogía con abuelos (pedigrí) =====
// padre_id/madre_id/padre_texto/madre_texto (animales) — ver
// supabase/migrations/20260923090000_leche_y_genealogia.sql. Sin
// búsqueda cruzada entre ganaderos (esta versión no certifica genealogía,
// solo la muestra): el padre/madre se elige del propio rebaño, ya
// cargado en "animales" (mismo datalist que Sanidad/Pesaje/Reproducción),
// o se escribe como texto libre si el animal real no está en el sistema.
// Los "abuelos" no son una columna aparte — se resuelven encadenando un
// nivel más: el padre_id/madre_id DEL padre y DE la madre.
// Reusa ".pedigree"/".pedigree-branch"/".pedigree-grands"/".pedigree-cel"
// (ver ganadero/styles.css) — ya estaba armado en el CSS para esto mismo
// desde una versión anterior de la app, solo faltaba el HTML que lo llenara.
function animalPorId(animales, id){
  return id ? animales.find(x => String(x.id) === String(id)) : null;
}
function celdaGenealogia(animalRef, texto, extraClass){
  const valor = animalRef ? etiquetaAnimal(animalRef) : (texto || null);
  const clase = 'pedigree-cel' + (extraClass ? ' ' + extraClass : '') + (valor ? '' : ' pedigree-cel-vacio');
  return `<div class="${clase}">${valor ? esc(valor) : 'Sin cargar'}</div>`;
}
function genealogiaHtml(a, animales){
  const padre = animalPorId(animales, a.padre_id);
  const madre = animalPorId(animales, a.madre_id);
  const abueloPaterno = padre ? animalPorId(animales, padre.padre_id) : null;
  const abuelaPaterna = padre ? animalPorId(animales, padre.madre_id) : null;
  const abueloMaterno = madre ? animalPorId(animales, madre.padre_id) : null;
  const abuelaMaterna = madre ? animalPorId(animales, madre.madre_id) : null;
  return `
    <div class="pedigree">
      <div>
        <div class="pedigree-label">Rama paterna</div>
        <div class="pedigree-branch">
          <div class="pedigree-grands">
            ${celdaGenealogia(abueloPaterno, padre ? padre.padre_texto : null)}
            ${celdaGenealogia(abuelaPaterna, padre ? padre.madre_texto : null)}
          </div>
          ${celdaGenealogia(padre, a.padre_texto, 'pedigree-cel-padre')}
        </div>
      </div>
      <div>
        <div class="pedigree-label">Rama materna</div>
        <div class="pedigree-branch">
          <div class="pedigree-grands">
            ${celdaGenealogia(abueloMaterno, madre ? madre.padre_texto : null)}
            ${celdaGenealogia(abuelaMaterna, madre ? madre.madre_texto : null)}
          </div>
          ${celdaGenealogia(madre, a.madre_texto, 'pedigree-cel-padre')}
        </div>
      </div>
    </div>`;
}
// ===== Resumen (productividad) =====
// Productividad: peso al nacer/actual, ganancia total y ganancia diaria
// promedio (GDP en kg/día, la métrica estándar de engorde) — todo
// resuelto sobre la misma serie de pesajes que ya arma la ficha, sin
// pedir nada nuevo al servidor.
function resumenProductividadHtml(a, pesajes, leche, sanidad){
  const pesoNacimiento = a.peso_nacimiento_kg ? parseFloat(a.peso_nacimiento_kg) : null;
  const ultimoPesaje = pesajes.length ? pesajes[pesajes.length - 1] : null;
  const pesoActual = ultimoPesaje ? ultimoPesaje.peso_kg : (a.peso_actual_kg ? parseFloat(a.peso_actual_kg) : null);
  let ganancia = null, gdp = null;
  if (pesoNacimiento != null && pesoActual != null && a.fecha_nacimiento) {
    const fechaFinal = ultimoPesaje ? ultimoPesaje.fecha : (a.peso_actual_fecha || new Date().toISOString().slice(0, 10));
    const dias = Math.max(1, Math.round((new Date(fechaFinal) - new Date(a.fecha_nacimiento)) / 86400000));
    ganancia = pesoActual - pesoNacimiento;
    gdp = ganancia / dias;
  }

  // Ganancia RECIENTE (últimos 30 días) — a diferencia de la de arriba
  // (promedio de TODA la vida del animal), esta dice cómo viene
  // ÚLTIMAMENTE, que es lo que más le sirve a un productor para decidir
  // algo hoy. Compara el último pesaje contra el pesaje más antiguo que
  // caiga dentro de esa ventana (no siempre hay uno justo a los 30 días).
  let gdpReciente = null;
  if (pesajes.length >= 2 && ultimoPesaje) {
    const haceUnMes = new Date(ultimoPesaje.fecha);
    haceUnMes.setDate(haceUnMes.getDate() - 30);
    const previo = [...pesajes].reverse().find(p => p !== ultimoPesaje && new Date(p.fecha) <= haceUnMes) || pesajes[0];
    const dias = Math.round((new Date(ultimoPesaje.fecha) - new Date(previo.fecha)) / 86400000);
    if (previo !== ultimoPesaje && dias > 0) gdpReciente = (ultimoPesaje.peso_kg - previo.peso_kg) / dias;
  }

  const edadDias = a.fecha_nacimiento ? Math.max(0, Math.round((new Date() - new Date(a.fecha_nacimiento)) / 86400000)) : null;
  const edad = edadDias == null ? null
    : edadDias < 60 ? `${edadDias} día${edadDias === 1 ? '' : 's'}`
    : edadDias < 730 ? `${Math.floor(edadDias / 30)} mes${Math.floor(edadDias / 30) === 1 ? '' : 'es'}`
    : `${(edadDias / 365).toFixed(1)} años`;

  const condicionActual = ultimoPesaje && ultimoPesaje.condicion_corporal ? etiquetaCondicionCorporal(ultimoPesaje.condicion_corporal) : null;

  const totalLeche = (leche || []).reduce((s, e) => s + (parseFloat(e.litros_leche) || 0), 0);
  const promedioLeche = leche && leche.length ? totalLeche / leche.length : null;

  const dato = (label, value) => value == null ? '' : `
    <div class="card-flat" style="text-align:center;flex:1;min-width:110px;">
      <div style="font-size:1.1rem;font-weight:800;color:var(--primary);">${value}</div>
      <div class="small muted" style="margin-top:2px;">${label}</div>
    </div>`;
  const datos = [
    dato('Edad', edad),
    dato('Peso al nacer', pesoNacimiento != null ? pesoNacimiento + ' kg' : null),
    dato('Peso actual', pesoActual != null ? pesoActual + ' kg' : null),
    dato('Ganancia total', ganancia != null ? ganancia.toFixed(1) + ' kg' : null),
    dato('Ganancia diaria (histórica)', gdp != null ? gdp.toFixed(2) + ' kg/día' : null),
    dato('Ganancia diaria (últimos 30 días)', gdpReciente != null ? gdpReciente.toFixed(2) + ' kg/día' : null),
    dato('Pesajes cargados', pesajes.length ? String(pesajes.length) : null),
    dato('Condición actual', condicionActual),
    dato('Intervenciones de sanidad', sanidad && sanidad.length ? String(sanidad.length) : null),
    dato('Total de leche', leche && leche.length ? totalLeche.toFixed(1) + ' L' : null),
    dato('Promedio por ordeña', promedioLeche != null ? promedioLeche.toFixed(1) + ' L' : null),
  ].join('');
  return `
    <div class="form-section-title" style="margin-top:0;">Productividad</div>
    ${datos ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px;">${datos}</div>` : `<p class="small muted" style="margin-top:8px;">Todavía no hay suficientes datos de peso para calcular productividad.</p>`}
  `;
}

// ===== Formulario de un evento de reproducción — se repite en 2 lugares
// (ficha del animal, pantalla "Reproducción"), factorizado acá para no
// duplicar los campos. "sufijo" evita ids duplicados si las dos
// instancias conviven en el DOM a la vez (una ficha abierta arriba de la
// pantalla "Reproducción" de atrás). =====
// Sugerencias para "Resultado / observación" — datalist, no <select>: se
// puede elegir una (evita errores de ortografía — calcularAlertasReproduccion()
// todavía depende de que un diagnóstico NEGATIVO diga justo "vac"/
// "negativ" para avisar celo; "gestante"/"próxima a parir" ya no
// dependen de este texto, ver calcularGestantes()) pero sigue admitiendo
// texto libre para un caso que no entre en la lista.
const SUGERENCIAS_RESULTADO_REPRODUCCION = ['Preñada', 'Vacía', 'Positivo', 'Negativo', 'Aborto espontáneo'];

function camposReproduccion(sufijo){
  return `
    <label>Tipo de evento</label>
    <select name="tipo" class="selectTipoReproduccion" data-sufijo="${sufijo}" required>
      <option value="Monta natural">Monta natural</option>
      <option value="Inseminación artificial">Inseminación artificial</option>
      <option value="Diagnóstico de gestación">Diagnóstico de gestación</option>
      <option value="Parto">Parto</option>
      <option value="Aborto">Aborto</option>
      <option value="Destete">Destete</option>
      <option value="Otro">Otro</option>
    </select>
    <div class="row" style="gap:8px;margin-top:9px;">
      <input name="semental" placeholder="Semental / pajilla (opcional)" style="flex:1;">
      <input name="fecha" type="date" class="inputFechaReproduccion" data-sufijo="${sufijo}" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
    </div>
    <label>Veterinario responsable</label>
    <input name="veterinario" placeholder="Opcional, si no sos vos">
    <label>Resultado / observación</label>
    <input name="resultado" list="datalist-resultado-${sufijo}" placeholder="Opcional" autocomplete="off">
    <datalist id="datalist-resultado-${sufijo}">
      ${SUGERENCIAS_RESULTADO_REPRODUCCION.map(r => `<option value="${r}"></option>`).join('')}
    </datalist>
    <div id="wrapParto_${sufijo}" style="display:none;">
      <label>Fecha probable de parto</label>
      <input name="fecha_probable_parto" type="date">
    </div>
    <div id="wrapCria_${sufijo}" style="display:none;">
      <div class="form-section-title" style="font-size:11px;">Datos de la cría</div>
      <div class="row" style="gap:8px;margin-top:8px;">
        <select name="sexo_cria" style="flex:1;">
          <option value="">Sexo — sin especificar</option>
          <option value="macho">Macho</option>
          <option value="hembra">Hembra</option>
        </select>
        <input name="peso_cria_kg" type="number" step="0.1" min="0" placeholder="Peso al nacer (kg)" style="flex:1;">
      </div>
    </div>
    <label>Notas</label>
    <input name="notas" placeholder="Opcional">`;
}

// Muestra/oculta "Fecha probable de parto" (monta/inseminación o
// diagnóstico de gestación — cualquier evento que pueda dejar a la
// hembra preñada) y "Datos de la cría" (solo para 'Parto') según el tipo
// elegido, y sugiere la fecha probable de parto sumando ~283 días
// (gestación promedio de un bovino) a la fecha de una monta/inseminación
// — sin pisar lo que el ganadero haya tipeado a mano ahí. Cargar bien
// esta fecha es lo que después permite avisar de partos próximos/
// atrasados (ver calcularAlertasReproduccion() en viewInicio()).
function bindCamposReproduccion(sufijo){
  const select = document.querySelector(`.selectTipoReproduccion[data-sufijo="${sufijo}"]`);
  if (!select) return;
  const inputFecha = document.querySelector(`.inputFechaReproduccion[data-sufijo="${sufijo}"]`);
  const wrapParto = document.getElementById(`wrapParto_${sufijo}`);
  const wrapCria = document.getElementById(`wrapCria_${sufijo}`);
  const inputProbableParto = wrapParto ? wrapParto.querySelector('input[name="fecha_probable_parto"]') : null;
  let probableEditadaAMano = false;
  if (inputProbableParto) inputProbableParto.oninput = () => { probableEditadaAMano = true; };
  const actualizar = () => {
    const esMontaOInseminacion = select.value === 'Monta natural' || select.value === 'Inseminación artificial';
    const podriaEstarPrenada = esMontaOInseminacion || select.value === 'Diagnóstico de gestación';
    if (wrapParto) wrapParto.style.display = podriaEstarPrenada ? '' : 'none';
    if (wrapCria) wrapCria.style.display = select.value === 'Parto' ? '' : 'none';
    if (esMontaOInseminacion && inputProbableParto && !probableEditadaAMano && inputFecha && inputFecha.value) {
      const base = new Date(inputFecha.value + 'T00:00:00');
      base.setDate(base.getDate() + 283);
      inputProbableParto.value = base.toISOString().slice(0, 10);
    }
  };
  select.onchange = actualizar;
  if (inputFecha) inputFecha.oninput = actualizar;
  actualizar();
}

// Lee los mismos campos que pinta camposReproduccion() — separado en su
// propia función para no repetir el mapeo de FormData en los 3 lugares
// que envían este formulario.
function leerDatosReproduccionDeFormulario(fd){
  return {
    tipo: fd.get('tipo'), semental: fd.get('semental').trim() || null,
    veterinario: fd.get('veterinario').trim() || null, fecha: fd.get('fecha') || null,
    resultado: fd.get('resultado').trim() || null,
    fecha_probable_parto: fd.get('fecha_probable_parto') || null,
    sexo_cria: fd.get('sexo_cria') || null,
    peso_cria_kg: fd.get('peso_cria_kg') || null,
    notas: fd.get('notas').trim() || null,
  };
}

// ===== Línea de tiempo — historial de pesajes/sanidad/reproducción
// dentro de la ficha de un animal. Un puntito conectado por una línea
// (ver .timeline en ganadero/styles.css) en vez de filas de texto plano:
// se lee de un vistazo como una secuencia, no hay que descifrar cada
// renglón. "detalle" ya viene armado en HTML (join de esc()) por quien
// llama — filaLineaDeTiempo() no vuelve a escapar nada. =====
function filaLineaDeTiempo(fecha, titulo, detalle){
  return `
    <div class="timeline-item">
      <div class="fecha">${fmtFechaEvento(fecha)}</div>
      <div class="titulo">${esc(titulo)}</div>
      ${detalle ? `<div class="detalle">${detalle}</div>` : ''}
    </div>`;
}

// Pesaje: el título es el peso en sí (lo que más importa de un vistazo),
// la barra de abajo lo compara contra el pesaje más alto del animal —
// mismo criterio que ya usaba esta pantalla, solo que ahora dentro de la
// línea de tiempo en vez de aparte.
function filaPesaje(p, maxPeso){
  const detalle = `
    ${p.condicion_corporal ? `<div style="margin-bottom:4px;">${etiquetaCondicionCorporal(p.condicion_corporal)}</div>` : ''}
    <div class="barra"><div style="width:${((p.peso_kg / maxPeso) * 100).toFixed(0)}%;"></div></div>`;
  return filaLineaDeTiempo(p.fecha, `${p.peso_kg} kg`, detalle);
}

// Leche: el título son los litros (lo que más importa de un vistazo),
// igual que el peso en filaPesaje() — sin barra comparativa (a
// diferencia del peso, dos ordeñas no son directamente comparables entre
// sí sin saber el turno, así que no aporta lo mismo).
function filaLeche(p){
  const detalle = p.notas ? esc(p.notas) : '';
  return filaLineaDeTiempo(p.fecha, `${p.litros_leche} L${p.descripcion ? ' · ' + esc(p.descripcion) : ''}`, detalle);
}

// Detalle de una intervención de sanidad (producto, lote, retiro, notas)
// — todo lo que haya cargado, unido en una sola línea.
function detalleSanidad(s){
  return [
    s.producto ? `Producto: ${esc(s.producto)}` : null,
    s.lote_producto ? `Lote ${esc(s.lote_producto)}` : null,
    s.retiro_hasta ? `Retiro hasta ${fmtFechaEvento(s.retiro_hasta)}` : null,
    s.notas ? esc(s.notas) : null,
  ].filter(Boolean).join(' · ');
}
function filaSanidad(s){
  return filaLineaDeTiempo(s.fecha, s.descripcion, detalleSanidad(s));
}

// Detalle de un evento de reproducción (semental, veterinario, resultado,
// fecha probable de parto, datos de la cría, notas) — todo lo que haya
// cargado, unido en una sola línea. Compartido entre filaReproduccion()
// (fichas, un animal ya sabido) y la pantalla "Reproducción" (todo el
// rebaño, necesita anteponer de quién es cada fila).
function detalleReproduccion(r){
  return [
    r.producto, r.veterinario, r.resultado,
    r.fecha_probable_parto ? `parto probable ${fmtFechaEvento(r.fecha_probable_parto)}` : null,
    r.sexo_cria ? `cría ${r.sexo_cria === 'macho' ? 'macho' : 'hembra'}` : null,
    r.peso_cria_kg ? `${r.peso_cria_kg} kg al nacer` : null,
    r.notas,
  ].filter(Boolean).map(esc).join(' · ');
}

// Línea de historial de un evento de reproducción — la usa la ficha del
// animal (abrirFichaAnimal()), donde ya se sabe de qué animal se trata.
function filaReproduccion(r){
  return filaLineaDeTiempo(r.fecha, r.descripcion, detalleReproduccion(r));
}

// ===== Alertas de reproducción — heurísticas sobre lo que ya se guardó
// (fecha, tipo, resultado, fecha probable de parto). No reemplazan el
// criterio de un veterinario, son un recordatorio para no perderse
// fechas — por eso conviene cargar bien "Resultado" y "Fecha probable de
// parto" en cada evento (ver camposReproduccion()):
//   • Parto: el último evento de una hembra trae fecha probable de parto
//     cargada (todavía sin su 'Parto' registrado) — avisa si faltan 30
//     días o menos, o si ya se pasó la fecha.
//   • Celo: una vaca vuelve a estar en celo ~21 días después de una
//     monta/inseminación/diagnóstico que no prendió (ciclo estral
//     promedio de un bovino), o retoma su ciclo ~45 días después de un
//     parto/destete si no se la volvió a servir (anestro posparto
//     promedio) — valores de referencia, no una regla fija por raza o
//     condición corporal. =====
const DIAS_CICLO_ESTRAL_BOVINO = 21;
const DIAS_ANESTRO_POSPARTO_BOVINO = 45;

// Último evento de reproducción de cada hembra VIVA — decide tanto si
// está gestante (calcularGestantes(), acá abajo) como las alertas de
// celo/parto (calcularAlertasReproduccion()): si hay una monta más
// reciente que un diagnóstico negativo, por ejemplo, esa monta manda.
// Un solo lugar arma este mapa, reusado por las dos — así "gestante"
// significa EXACTAMENTE lo mismo en cualquier parte de la app que lo
// muestre, en vez de que cada una calcule "la última" por su cuenta.
function ultimoEventoReproduccionPorHembra(animales, eventosReproduccion){
  const nombrePorAnimal = new Map(animales.map(a => [a.id, a]));
  const ultimoPorHembra = new Map();
  eventosReproduccion.forEach(e => {
    const animal = nombrePorAnimal.get(e.animal_id);
    if (!animal || animal.sexo !== 'hembra' || animal.estado !== 'vivo') return; // solo aplica a hembras vivas
    const actual = ultimoPorHembra.get(e.animal_id);
    if (!actual || e.fecha > actual.evento.fecha) ultimoPorHembra.set(e.animal_id, { animal, evento: e });
  });
  return ultimoPorHembra;
}

// Gestante AHORA MISMO según fechas cargadas de verdad — no un texto
// suelto en "Resultado" (dependía de que alguien escribiera justo
// "preñada"/"positivo", y podía quedar inconsistente con "Próximas a
// parir", que ya usaba la fecha probable de parto). La referencia real
// es esa: un diagnóstico con fecha probable de parto cargada, sin un
// parto posterior que lo cierre. Se autocorrige sola con el tiempo — en
// cuanto se registra el "Parto", esa pasa a ser la última y deja de
// contar, sin ningún estado aparte que alguien tenga que ir a cambiar a
// mano.
function calcularGestantes(animales, eventosReproduccion){
  const ultimoPorHembra = ultimoEventoReproduccionPorHembra(animales, eventosReproduccion);
  const gestantes = [];
  ultimoPorHembra.forEach(({ animal, evento }) => {
    const tipo = (evento.descripcion || '').toLowerCase();
    if (evento.fecha_probable_parto && tipo !== 'parto') gestantes.push({ animal, evento });
  });
  return gestantes;
}

// Mismo criterio, solo el total — lo usa el stat "Gestantes" de Inicio.
function contarPrenadas(animales, eventosReproduccion){
  return calcularGestantes(animales, eventosReproduccion).length;
}

function calcularAlertasReproduccion(animales, eventosReproduccion){
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0); // medianoche local — para contar días de calendario, no horas exactas
  const diasEntre = (desde, hasta) => Math.round((hasta - desde) / 86400000);
  const ultimoPorHembra = ultimoEventoReproduccionPorHembra(animales, eventosReproduccion);

  const alertas = [];
  ultimoPorHembra.forEach(({ animal, evento }) => {
    const dias = diasEntre(new Date(evento.fecha), hoy);
    const tipo = (evento.descripcion || '').toLowerCase();
    const resultado = (evento.resultado || '').toLowerCase();

    // Parto próximo/atrasado: el último evento ya trae una fecha probable
    // de parto cargada, y ese parto todavía no se registró.
    if (evento.fecha_probable_parto && tipo !== 'parto') {
      // "T00:00:00" fuerza a interpretar la fecha en hora LOCAL — sin
      // esto, un string de solo fecha ("2026-05-20") se toma como
      // medianoche UTC, y en México eso cae en el día anterior (mismo
      // criterio que fmtFechaEvento() en shared/data.js).
      const diasParaParto = diasEntre(hoy, new Date(evento.fecha_probable_parto + 'T00:00:00'));
      if (diasParaParto <= 30) {
        alertas.push({
          animal, tipo: 'parto', urgente: diasParaParto <= 0,
          mensaje: diasParaParto > 0
            ? `Parto esperado en ${diasParaParto} día${diasParaParto === 1 ? '' : 's'} (${fmtFechaEvento(evento.fecha_probable_parto)})`
            : `Parto atrasado por ${Math.abs(diasParaParto)} día${Math.abs(diasParaParto) === 1 ? '' : 's'} — esperado el ${fmtFechaEvento(evento.fecha_probable_parto)}`,
        });
      }
      return; // en seguimiento de una posible preñez — no evaluar celo a la vez
    }

    // Posible celo / repetición.
    const esMontaOInseminacion = tipo === 'monta natural' || tipo === 'inseminación artificial';
    const diagnosticoNegativo = tipo === 'diagnóstico de gestación' && (resultado.includes('vac') || resultado.includes('negativ'));
    // Un aborto (tipo de evento propio, ver camposReproduccion()) termina
    // la gestación igual que un diagnóstico negativo — mismo criterio de
    // aviso, antes no disparaba ninguna alerta.
    const aborto = tipo === 'aborto';
    const posparto = tipo === 'parto' || tipo === 'destete';

    if (esMontaOInseminacion && dias >= DIAS_CICLO_ESTRAL_BOVINO - 3) {
      alertas.push({ animal, tipo: 'celo', urgente: false,
        mensaje: `Podría estar en celo de nuevo — pasaron ${dias} días de su última monta/inseminación sin diagnóstico cargado` });
    } else if ((diagnosticoNegativo || aborto) && dias >= DIAS_CICLO_ESTRAL_BOVINO - 5) {
      alertas.push({ animal, tipo: 'celo', urgente: false,
        mensaje: aborto
          ? `Aborto hace ${dias} días — podría estar volviendo a estar en celo`
          : `Diagnóstico negativo hace ${dias} días — podría estar volviendo a estar en celo` });
    } else if (posparto && dias >= DIAS_ANESTRO_POSPARTO_BOVINO) {
      alertas.push({ animal, tipo: 'celo', urgente: false,
        mensaje: `Pasaron ${dias} días desde su ${tipo} sin una nueva monta — podría estar ciclando de nuevo` });
    }
  });

  // Atrasados/urgentes primero, después por animal para que quede estable.
  return alertas.sort((a, b) => (b.urgente - a.urgente) || esc(etiquetaAnimal(a.animal)).localeCompare(esc(etiquetaAnimal(b.animal))));
}

// Línea de una alerta de reproducción — la usan tanto Inicio (resumen)
// como la pantalla "Reproducción" (lista completa).
function filaAlertaReproduccion(al){
  return `
    <div class="card-flat" style="${al.urgente ? 'border-color:var(--red);background:rgba(192,57,43,0.06);' : ''}margin-top:8px;">
      <b style="${al.urgente ? 'color:var(--red);' : ''}">${al.tipo === 'parto' ? '🐣' : '🔁'} ${esc(etiquetaAnimal(al.animal))}</b>
      <p class="small muted" style="margin-top:2px;">${esc(al.mensaje)}</p>
    </div>`;
}

async function abrirFichaAnimal(animalId){
  let a, eventos, animales;
  try {
    [a, eventos, animales] = await Promise.all([mockApi.obtenerAnimal(animalId), mockApi.eventosDeAnimal(animalId), mockApi.misAnimales()]);
  } catch (err) { toast(err.message, '⚠️'); return; }
  if (!a) return;
  const fila = (k, v) => v ? `<div class="ficha-row"><span class="k">${k}</span><span class="v">${esc(v)}</span></div>` : '';
  // Cronológico (viejo → nuevo) para que la barra de abajo se lea como una
  // curva de crecimiento, no al revés.
  const pesajes = eventos
    .filter(e => e.tipo === 'pesaje')
    .sort((x, y) => x.fecha.localeCompare(y.fecha));
  const maxPeso = pesajes.length ? Math.max(...pesajes.map(p => p.peso_kg)) : 1;
  // Más reciente primero acá — a diferencia de los pesajes, leche/sanidad/
  // reproducción son bitácoras, no una serie que se grafique.
  const leche = eventos
    .filter(e => e.tipo === 'produccion_leche')
    .sort((x, y) => y.fecha.localeCompare(x.fecha));
  const sanidad = eventos
    .filter(e => e.tipo === 'sanidad')
    .sort((x, y) => y.fecha.localeCompare(x.fecha));
  const reproduccion = eventos
    .filter(e => e.tipo === 'reproduccion')
    .sort((x, y) => y.fecha.localeCompare(x.fecha));
  const retiro = retiroActivoHoy(sanidad);
  // Genealogía — resuelta contra "animales" (todo el rebaño, ya en
  // caché por mockApi.misAnimales() de arriba), no hace falta pedir nada
  // aparte para encontrar padre/madre/abuelos.
  const padreGenealogia = animalPorId(animales, a.padre_id);
  const madreGenealogia = animalPorId(animales, a.madre_id);
  const textoBotonGenealogia = (padreGenealogia || madreGenealogia || a.padre_texto || a.madre_texto) ? '✏️ Editar genealogía' : '➕ Agregar genealogía';
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop modal-backdrop-full';
  overlay.innerHTML = `
    <div class="modal modal-full">
      <div class="back-row" style="justify-content:space-between;">
        <div class="row" style="align-items:center;gap:8px;">
          <button class="back-btn" id="btnCerrarFicha">←</button>
          <h3 class="section-title" style="margin-bottom:0;">${esc(etiquetaAnimal(a))}</h3>
        </div>
        <span class="pill pill-${a.estado}">${etiquetaEstadoAnimal(a.estado)}</span>
      </div>
      ${retiro ? `
      <div class="card-flat" style="background:rgba(192,57,43,0.08);">
        <b style="color:var(--red);">⚠️ En período de retiro hasta ${retiro.retiro_hasta}</b>
        <p class="small muted" style="margin-top:4px;">No debería venderse ni sacrificarse todavía.</p>
      </div>` : ''}

      <!-- Historial primero — es lo que más se consulta día a día, no
           hace falta pasar por los datos fijos del animal para verlo. -->
      <div class="ficha-tabs">
        <button type="button" class="ficha-tab active" data-ficha-tab="resumen">Resumen</button>
        <button type="button" class="ficha-tab" data-ficha-tab="pesajes">Pesajes</button>
        <button type="button" class="ficha-tab" data-ficha-tab="leche">Leche</button>
        <button type="button" class="ficha-tab" data-ficha-tab="sanidad">Sanidad</button>
        <button type="button" class="ficha-tab" data-ficha-tab="genealogia">Genealogía</button>
        <button type="button" class="ficha-tab" data-ficha-tab="reproduccion">Reproducción</button>
      </div>

      <div class="card-flat ficha-tab-panel" data-ficha-panel="resumen">
        ${resumenProductividadHtml(a, pesajes, leche, sanidad)}
        <div class="form-section-title">Identificación</div>
        ${fila('Chip', a.chip_uid)}
        ${fila('N° interno', a.numero_interno)}
        ${fila('Raza', a.raza)}
        ${fila('Color', a.color)}
        ${fila('Sexo', a.sexo === 'macho' ? 'Macho' : 'Hembra')}
        ${fila('Categoría', categoriaBovino(a.sexo, a.fecha_nacimiento))}
        ${fila('Fecha de nacimiento', a.fecha_nacimiento)}
        ${fila('Hierro / marca', a.marca_hierro)}
        <div class="form-section-title">Ubicación</div>
        ${fila('Rancho / predio', a.ubicacion_actual)}
        ${fila('Notas', a.notas)}
      </div>

      <div class="card-flat ficha-tab-panel" data-ficha-panel="pesajes" style="display:none;">
        ${fila('Al nacer', a.peso_nacimiento_kg ? a.peso_nacimiento_kg + ' kg' : null)}
        ${pesajes.length ? `<div class="timeline">${pesajes.map(p => filaPesaje(p, maxPeso)).join('')}</div>` : `<p class="small muted" style="margin-top:8px;">Todavía no hay pesajes cargados.</p>`}
        <button class="btn btn-ghost btn-block" type="button" id="btnToggleFormPesajeFicha" style="margin-top:12px;">➕ Registrar pesaje</button>
        <form id="formPesajeFicha" style="margin-top:12px;display:none;">
          <div class="row" style="gap:8px;">
            <input name="peso_kg" type="number" step="0.1" min="0" required placeholder="Peso (kg)" style="flex:1;">
            <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
          </div>
          <select name="condicion_corporal" style="margin-top:9px;">
            <option value="">Condición corporal — sin evaluar (opcional)</option>
            <option value="1">1 · Muy flaco</option>
            <option value="2">2 · Flaco</option>
            <option value="3">3 · Óptimo</option>
            <option value="4">4 · Gordo</option>
            <option value="5">5 · Muy gordo</option>
          </select>
          <input name="notas" placeholder="Notas (opcional)" style="margin-top:9px;">
          <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Registrar pesaje</button>
        </form>
      </div>

      <div class="card-flat ficha-tab-panel" data-ficha-panel="leche" style="display:none;">
        ${leche.length ? `<div class="timeline">${leche.map(filaLeche).join('')}</div>` : `<p class="small muted" style="margin-top:8px;">Todavía no hay ordeñas cargadas.</p>`}
        <button class="btn btn-ghost btn-block" type="button" id="btnToggleFormLecheFicha" style="margin-top:12px;">➕ Registrar ordeña</button>
        <form id="formLecheFicha" style="margin-top:12px;display:none;">
          <div class="row" style="gap:8px;">
            <input name="litros" type="number" step="0.1" min="0" required placeholder="Litros" style="flex:1;">
            <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
          </div>
          <select name="turno" style="margin-top:9px;">
            <option value="">Turno — sin especificar (opcional)</option>
            <option value="Mañana">Mañana</option>
            <option value="Tarde">Tarde</option>
          </select>
          <input name="notas" placeholder="Notas (opcional)" style="margin-top:9px;">
          <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Registrar ordeña</button>
        </form>
      </div>

      <div class="card-flat ficha-tab-panel" data-ficha-panel="sanidad" style="display:none;">
        ${sanidad.length ? `<div class="timeline">${sanidad.map(filaSanidad).join('')}</div>` : `<p class="small muted" style="margin-top:8px;">Todavía no hay sanidad cargada.</p>`}
        <button class="btn btn-ghost btn-block" type="button" id="btnToggleFormSanidadFicha" style="margin-top:12px;">➕ Registrar sanidad</button>
        <form id="formSanidadFicha" style="margin-top:12px;display:none;">
          <label>Tipo de intervención</label>
          <select name="tipo" required>
            <option value="Vacuna">Vacuna</option>
            <option value="Desparasitación">Desparasitación</option>
            <option value="Tratamiento">Tratamiento</option>
            <option value="Revisión veterinaria">Revisión veterinaria</option>
            <option value="Otro">Otro</option>
          </select>
          <div class="row" style="gap:8px;margin-top:9px;">
            <input name="notas" placeholder="Notas (opcional)" style="flex:2;">
            <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
          </div>
          <div style="margin-top:8px;">
            <label>Producto / marca</label>
            <input name="producto" placeholder="Opcional">
            <div class="row" style="gap:8px;margin-top:9px;">
              <input name="lote_producto" placeholder="N° de lote (opcional)" style="flex:1;">
              <input name="dosis" placeholder="Dosis (opcional)" style="flex:1;">
            </div>
            <label>Veterinario responsable</label>
            <input name="veterinario" placeholder="Opcional, si no sos vos">
            <label>Días de retiro</label>
            <input name="dias_retiro" type="number" min="0" placeholder="Antes de vender o sacrificar (opcional)">
          </div>
          <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Registrar sanidad</button>
        </form>
      </div>

      <div class="card-flat ficha-tab-panel" data-ficha-panel="genealogia" style="display:none;">
        ${genealogiaHtml(a, animales)}
        <button class="btn btn-ghost btn-block" type="button" id="btnToggleFormGenealogiaFicha" style="margin-top:12px;">${textoBotonGenealogia}</button>
        <form id="formGenealogiaFicha" style="margin-top:12px;display:none;">
          <label>Padre — N° interno/chip del propio rebaño, o un nombre si no está en el sistema</label>
          <input name="padre" placeholder="Buscá por N° interno o chip, o escribí un nombre" list="sugerenciasPadreFicha" autocomplete="off" value="${padreGenealogia ? esc(etiquetaAnimal(padreGenealogia)) : esc(a.padre_texto || '')}">
          <datalist id="sugerenciasPadreFicha">${opcionesIdentificadorAnimales(animales.filter(x => x.sexo === 'macho' && x.id !== a.id))}</datalist>
          <label>Madre — N° interno/chip del propio rebaño, o un nombre si no está en el sistema</label>
          <input name="madre" placeholder="Buscá por N° interno o chip, o escribí un nombre" list="sugerenciasMadreFicha" autocomplete="off" value="${madreGenealogia ? esc(etiquetaAnimal(madreGenealogia)) : esc(a.madre_texto || '')}">
          <datalist id="sugerenciasMadreFicha">${opcionesIdentificadorAnimales(animales.filter(x => x.sexo === 'hembra' && x.id !== a.id))}</datalist>
          <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Guardar genealogía</button>
        </form>
      </div>

      <div class="card-flat ficha-tab-panel" data-ficha-panel="reproduccion" style="display:none;">
        ${reproduccion.length ? `<div class="timeline">${reproduccion.map(filaReproduccion).join('')}</div>` : `<p class="small muted" style="margin-top:8px;">Todavía no hay eventos de reproducción cargados.</p>`}
        <button class="btn btn-ghost btn-block" type="button" id="btnToggleFormReproduccionFicha" style="margin-top:12px;">➕ Registrar evento</button>
        <form id="formReproduccionFicha" style="margin-top:12px;display:none;">
          ${camposReproduccion('ficha')}
          <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Registrar evento</button>
        </form>
      </div>

      ${a.estado === 'vivo' ? `
      <button class="btn btn-ghost btn-block" id="btnDarDeBaja" style="color:var(--red);">Dar de baja (murió / se perdió)</button>
      ` : ''}
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('btnCerrarFicha').onclick = () => overlay.remove();
  // Barra de navegación superior de la ficha (Pesajes/Leche/Sanidad/
  // Genealogía/Reproducción/Resumen): un solo panel visible a la vez, en
  // vez de todo apilado en un scroll larguísimo — Identificación y
  // Ubicación viven dentro de "Resumen" (son datos fijos del animal, no
  // historial de ninguna de las otras pestañas), y ya no se repiten abajo
  // de todas las demás.
  overlay.querySelectorAll('.ficha-tab').forEach(btn => {
    btn.onclick = () => {
      overlay.querySelectorAll('.ficha-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.fichaTab;
      overlay.querySelectorAll('.ficha-tab-panel').forEach(panel => {
        panel.style.display = panel.dataset.fichaPanel === tab ? '' : 'none';
      });
    };
  });
  // Cada pestaña de historial (Pesajes/Leche/Sanidad/Reproducción) arranca
  // mostrando solo lo ya cargado — el cuestionario para agregar uno nuevo
  // queda escondido detrás de un "+", así el historial no compite en
  // espacio con un formulario largo que la mayoría de las veces no se va
  // a tocar en esa visita. Genealogía usa el mismo botón toggle, pero con
  // "Editar" en vez de "Agregar" si ya había algo cargado.
  const bindToggleFormFicha = (btnId, formId, textoAbrir) => {
    const btn = document.getElementById(btnId);
    const form = document.getElementById(formId);
    if (!btn || !form) return;
    btn.onclick = () => {
      const abrir = form.style.display === 'none';
      form.style.display = abrir ? '' : 'none';
      btn.textContent = abrir ? '▲ Ocultar' : textoAbrir;
    };
  };
  bindToggleFormFicha('btnToggleFormPesajeFicha', 'formPesajeFicha', '➕ Registrar pesaje');
  bindToggleFormFicha('btnToggleFormLecheFicha', 'formLecheFicha', '➕ Registrar ordeña');
  bindToggleFormFicha('btnToggleFormSanidadFicha', 'formSanidadFicha', '➕ Registrar sanidad');
  bindToggleFormFicha('btnToggleFormGenealogiaFicha', 'formGenealogiaFicha', textoBotonGenealogia);
  bindToggleFormFicha('btnToggleFormReproduccionFicha', 'formReproduccionFicha', '➕ Registrar evento');
  bindCamposReproduccion('ficha');
  document.getElementById('formPesajeFicha').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await mockApi.registrarPesaje(a.id, {
        peso_kg: fd.get('peso_kg'), fecha: fd.get('fecha') || null,
        condicion_corporal: fd.get('condicion_corporal') || null, notas: fd.get('notas').trim() || null,
      });
      toast('Pesaje guardado', '⚖️');
      overlay.remove();
      abrirFichaAnimal(a.id);
    } catch (err) { toast(err.message, '⚠️'); }
  };
  document.getElementById('formLecheFicha').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await mockApi.registrarProduccionLeche(a.id, {
        litros: fd.get('litros'), fecha: fd.get('fecha') || null,
        turno: fd.get('turno') || null, notas: fd.get('notas').trim() || null,
      });
      toast('Ordeña guardada', '🥛');
      overlay.remove();
      abrirFichaAnimal(a.id);
    } catch (err) { toast(err.message, '⚠️'); }
  };
  document.getElementById('formSanidadFicha').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await mockApi.registrarSanidad(a.id, {
        tipo: fd.get('tipo'), notas: fd.get('notas').trim() || null, fecha: fd.get('fecha') || null,
        producto: fd.get('producto').trim() || null, lote_producto: fd.get('lote_producto').trim() || null,
        dosis: fd.get('dosis').trim() || null, veterinario: fd.get('veterinario').trim() || null,
        dias_retiro: fd.get('dias_retiro') || null,
      });
      toast('Sanidad registrada', '💉');
      overlay.remove();
      abrirFichaAnimal(a.id);
    } catch (err) { toast(err.message, '⚠️'); }
  };
  document.getElementById('formReproduccionFicha').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await mockApi.registrarReproduccion(a.id, leerDatosReproduccionDeFormulario(fd));
      toast('Evento de reproducción registrado', '🐄');
      overlay.remove();
      abrirFichaAnimal(a.id);
    } catch (err) { toast(err.message, '⚠️'); }
  };
  // El padre/madre tipeado se resuelve contra el propio rebaño (igual que
  // el identificador de Sanidad/Pesaje/Reproducción) — si matchea un
  // animal propio, se guarda por id (así los abuelos se resuelven solos
  // la próxima vez); si no matchea nada, se guarda tal cual como texto
  // libre (padre/madre que no está cargado en el sistema).
  document.getElementById('formGenealogiaFicha').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const padreInput = (fd.get('padre') || '').trim();
    const madreInput = (fd.get('madre') || '').trim();
    const padreAnimal = padreInput ? await buscarMiAnimalPorIdentificador(padreInput) : null;
    const madreAnimal = madreInput ? await buscarMiAnimalPorIdentificador(madreInput) : null;
    try {
      await mockApi.editarGenealogiaAnimal(a.id, {
        padre_id: padreAnimal ? padreAnimal.id : null, padre_texto: padreAnimal ? null : (padreInput || null),
        madre_id: madreAnimal ? madreAnimal.id : null, madre_texto: madreAnimal ? null : (madreInput || null),
      });
      toast('Genealogía guardada', '🌳');
      overlay.remove();
      abrirFichaAnimal(a.id);
    } catch (err) { toast(err.message, '⚠️'); }
  };
  const btnDarDeBaja = document.getElementById('btnDarDeBaja');
  if (btnDarDeBaja) btnDarDeBaja.onclick = async () => {
    const motivo = prompt('¿Por qué se da de baja? (murió, se perdió, robo, etc.)');
    if (motivo === null) return;
    if (!motivo.trim()) { toast('Falta el motivo', '⚠️'); return; }
    try {
      await mockApi.darDeBajaAnimal(a.id, motivo.trim());
      toast('Animal dado de baja', '☠️');
      overlay.remove();
    } catch (err) { toast(err.message, '⚠️'); }
  };
}

// <datalist> con todos los identificadores de tus animales, para que el
// campo "N° interno o chip" de Sanidad/Pesaje/Reproducción sugiera
// mientras se tipea, en vez de exigir el identificador completo antes de
// mostrar nada — un <option> por cada identificador no vacío (puede
// haber dos por animal: numero interno y chip), el navegador filtra solo
// a medida que coincide con lo tipeado. buscarMiAnimalPorIdentificador()
// sigue siendo el que resuelve la búsqueda exacta al tipear/enviar (ver
// bindLookupAnimalRapido más abajo) — esto solo arma las sugerencias
// visibles.
function opcionesIdentificadorAnimales(animales){
  const opts = [];
  const agregar = (id, a) => { if (id) opts.push(`<option value="${esc(id)}">${esc(etiquetaAnimal(a))} — ${esc(a.raza || '')}</option>`); };
  animales.forEach(a => {
    agregar(a.numero_interno, a);
    agregar(a.chip_uid, a);
  });
  return opts.join('');
}

// bloqueInstalarApp() ahora vive en shared/ui-common.js — la usan las 3
// apps por igual, ver ese archivo.
// Sanidad y pesaje son datos del día a día que aporta el propio productor
// — por eso viven como pestañas propias en la barra de navegación (no
// escondidas dentro de la ficha de cada animal, aunque también se puedan
// cargar desde ahí — ver abrirFichaAnimal()). Mismo patrón en las dos:
// alta rápida arriba (elegís el animal de un select, no hace falta entrar
// a su ficha) + historial de todo el rebaño abajo, más reciente primero.
async function viewSanidad(){
  const [animales, todaSanidad] = await Promise.all([mockApi.misAnimales(), mockApi.misEventosAnimal('sanidad', 200)]);
  const nombrePorAnimal = {};
  animales.forEach(a => { nombrePorAnimal[a.id] = a; });
  const nombreDeEvento = e => nombrePorAnimal[e.animal_id];
  const eventos = todaSanidad.slice(0, 30);
  // Trazabilidad real: si algún animal está en período de retiro (el
  // medicamento puede dejar residuo en la carne), se avisa arriba de
  // todo, antes de que alguien lo venda o lo mande a sacrificar por
  // descuido. retiroActivoHoy() en shared/data.js hace el mismo cálculo
  // que usa Monitoreo del lado del admin.
  const enRetiro = animales
    .map(a => ({ a, retiro: retiroActivoHoy(todaSanidad.filter(e => e.animal_id === a.id)) }))
    .filter(x => x.retiro);

  return `
    <h3 class="section-title" style="margin-bottom:4px;">Sanidad</h3>
    <div class="ficha-tabs">
      <button type="button" class="ficha-tab ${sanidadSubview === 'registrar' ? 'active' : ''}" data-sanidad-tab="registrar">Registrar evento</button>
      <button type="button" class="ficha-tab ${sanidadSubview === 'alertas' ? 'active' : ''}" data-sanidad-tab="alertas">Alertas${enRetiro.length ? ` (${enRetiro.length})` : ''}</button>
      <button type="button" class="ficha-tab ${sanidadSubview === 'historial' ? 'active' : ''}" data-sanidad-tab="historial">Historial</button>
    </div>

    ${sanidadSubview === 'registrar' ? `
    <div class="card">
      <h3 class="section-title">Registrar sanidad</h3>
      ${!animales.length ? `<p class="small muted" style="margin-bottom:8px;">Todavía no tenés ningún animal registrado.</p>` : ''}
      <form id="formSanidadRapida">
        <label>Número de animal o chip</label>
        <input id="identificadorSanidad" name="identificador" required placeholder="N° interno o chip — o escaneá con el lector" list="sugerenciasIdentificadorSanidad" autocomplete="off">
        <datalist id="sugerenciasIdentificadorSanidad">${opcionesIdentificadorAnimales(animales)}</datalist>
        <div id="historialAnimalSanidad"></div>
        <label>Tipo de intervención</label>
        <select name="tipo" required>
          <option value="Vacuna">Vacuna</option>
          <option value="Desparasitación">Desparasitación</option>
          <option value="Tratamiento">Tratamiento</option>
          <option value="Revisión veterinaria">Revisión veterinaria</option>
          <option value="Otro">Otro</option>
        </select>
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="notas" placeholder="Notas (opcional)" style="flex:2;">
          <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
        </div>
        <div style="margin-top:8px;">
          <label>Producto / marca</label>
          <input name="producto" placeholder="Opcional">
          <div class="row" style="gap:8px;margin-top:9px;">
            <input name="lote_producto" placeholder="N° de lote (opcional)" style="flex:1;">
            <input name="dosis" placeholder="Dosis (opcional)" style="flex:1;">
          </div>
          <label>Veterinario responsable</label>
          <input name="veterinario" placeholder="Opcional, si no sos vos">
          <label>Días de retiro</label>
          <input name="dias_retiro" type="number" min="0" placeholder="Antes de vender o sacrificar (opcional)">
        </div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Guardar</button>
      </form>
    </div>
    ` : ''}

    ${sanidadSubview === 'alertas' ? `
    <div class="card" style="${enRetiro.length ? 'border-color:var(--red);background:rgba(192,57,43,0.06);' : ''}">
      <b style="${enRetiro.length ? 'color:var(--red);' : ''}">⚠️ En período de retiro</b>
      <p class="small muted" style="margin-top:4px;">No deberían venderse ni sacrificarse todavía.</p>
      ${enRetiro.length ? enRetiro.map(x => `<p class="small" style="margin-top:6px;">${esc(etiquetaAnimal(x.a))} — hasta ${x.retiro.retiro_hasta}</p>`).join('') : `<div class="empty">Sin alertas por ahora.</div>`}
    </div>
    ` : ''}

    ${sanidadSubview === 'historial' ? `
    <div class="card">
      <h3 class="section-title">Historial</h3>
      ${eventos.length ? eventos.map(e => `
        <div class="ficha-row">
          <span class="k">${fmtFechaEvento(e.fecha)} · ${esc(etiquetaAnimal(nombreDeEvento(e)))}${e.producto ? ' · ' + esc(e.producto) : ''}${e.lote_producto ? ` (lote ${esc(e.lote_producto)})` : ''}${e.notas ? ' · ' + esc(e.notas) : ''}${e.retiro_hasta ? ` · retiro hasta ${e.retiro_hasta}` : ''}</span>
          <span class="v">${esc(e.descripcion)}</span>
        </div>`).join('') : `<div class="empty">Todavía no cargaste sanidad.</div>`}
    </div>
    ` : ''}
  `;
}

// Calendario — grilla mensual de verdad, no una lista suelta: marca
// CUALQUIER día con algo (pesaje/sanidad/reproducción/leche ya
// registrados, o un recordatorio programado) y al tocarlo muestra el
// detalle abajo. Los recordatorios (supabase/migrations/20260925090000_calendario_sanitario.sql)
// siguen siendo solo un AVISO — "Marcar hecho" reprograma la fecha, no
// registra sanidad a ningún animal en particular; eso sigue siendo
// Sanidad de siempre.
function diasHastaFecha(fechaISO){
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(fechaISO + 'T00:00:00');
  return Math.round((fecha - hoy) / 86400000);
}
function fechaISO(anio, mes, dia){
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ICONO_TIPO_EVENTO_CALENDARIO = {
  pesaje: '../pesaje.png', sanidad: '../sanidad.png', reproduccion: '../reproduccion.png', leche: '../leche.png',
};

// Hitos de vacunación por edad — referencia general para un ternero
// recién identificado, no reemplaza el criterio de tu veterinario (cada
// zona/rancho puede necesitar otro esquema). Se generan solos al
// registrar un animal CON fecha de nacimiento cargada (viewNuevoAnimalRegistro(),
// más abajo) y quedan como cualquier otro recordatorio del Calendario —
// se pueden editar/borrar igual, no son distintos por dentro.
const PLANTILLA_VACUNACION_POR_EDAD = [
  { nombre: 'Primera desparasitación', meses: 2 },
  { nombre: 'Primera vacuna (bacterina)', meses: 3 },
  { nombre: 'Refuerzo de vacuna', meses: 4 },
  { nombre: 'Vacuna contra brucelosis', meses: 6, soloHembras: true },
];

// Nunca crea uno con fecha ya pasada (un animal adulto que recién se
// identifica no necesita que le aparezca "vencido" un hito de cuando era
// cría) — silenciosamente salteado si ya quedó atrás. Sin conexión (o
// cualquier otro error) tampoco corta el alta del animal en sí: se
// intenta cada uno por separado, y lo que no se pudo crear simplemente
// no queda programado, sin bloquear nada.
async function generarRecordatoriosVacunacion(identificador, fechaNacimiento, sexo){
  const hoy = new Date().toISOString().slice(0, 10);
  const nacimiento = new Date(fechaNacimiento + 'T00:00:00');
  let creados = 0;
  for (const hito of PLANTILLA_VACUNACION_POR_EDAD) {
    if (hito.soloHembras && sexo !== 'hembra') continue;
    const fecha = new Date(nacimiento);
    fecha.setMonth(fecha.getMonth() + hito.meses);
    const iso = fecha.toISOString().slice(0, 10);
    if (iso < hoy) continue;
    try {
      await mockApi.crearRecordatorioSanitario({ nombre: `${identificador} — ${hito.nombre}`, proximaFecha: iso });
      creados++;
    } catch (err) { /* sin conexión u otro problema — el animal ya quedó registrado igual, sigue sin esos recordatorios */ }
  }
  return creados;
}

async function viewCalendario(){
  const hoyISO = new Date().toISOString().slice(0, 10);
  const [animales, pesajes, sanidad, reproduccion, leche, recordatorios] = await Promise.all([
    mockApi.misAnimales(),
    mockApi.misEventosAnimal('pesaje', 500),
    mockApi.misEventosAnimal('sanidad', 500),
    mockApi.misEventosAnimal('reproduccion', 500),
    mockApi.misEventosAnimal('produccion_leche', 500),
    mockApi.listarRecordatoriosSanitarios(),
  ]);
  const nombrePorAnimal = new Map(animales.map(a => [a.id, a]));

  // Todo junto en un solo mapa "día -> lista de cosas", sin importar de
  // qué pantalla salió cada una — es justo el punto de tener un
  // calendario en vez de 4 historiales sueltos.
  const porDia = new Map();
  const agregar = (fechaConHora, item) => {
    const dia = fechaConHora.slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(item);
  };
  pesajes.forEach(e => agregar(e.fecha, { tipo: 'pesaje', animal: nombrePorAnimal.get(e.animal_id), detalle: `${e.peso_kg} kg` }));
  sanidad.forEach(e => agregar(e.fecha, { tipo: 'sanidad', animal: nombrePorAnimal.get(e.animal_id), detalle: e.descripcion }));
  reproduccion.forEach(e => agregar(e.fecha, { tipo: 'reproduccion', animal: nombrePorAnimal.get(e.animal_id), detalle: e.descripcion }));
  leche.forEach(e => agregar(e.fecha, { tipo: 'leche', animal: nombrePorAnimal.get(e.animal_id), detalle: `${e.litros_leche} L` }));
  recordatorios.forEach(r => agregar(r.proxima_fecha, { tipo: 'recordatorio', animal: null, detalle: r.nombre, recordatorio: r }));

  // ===== Grilla del mes =====
  const primerDia = new Date(calendarioAnio, calendarioMes, 1);
  const diasEnMes = new Date(calendarioAnio, calendarioMes + 1, 0).getDate();
  const celdas = [];
  for (let i = 0; i < primerDia.getDay(); i++) celdas.push(null); // relleno antes del día 1
  for (let d = 1; d <= diasEnMes; d++) celdas.push(d);

  const celdaHtml = (dia) => {
    if (dia == null) return `<div class="calendario-dia calendario-dia-vacia"></div>`;
    const iso = fechaISO(calendarioAnio, calendarioMes, dia);
    const cosas = porDia.get(iso) || [];
    const tieneRecordatorioVencido = cosas.some(c => c.tipo === 'recordatorio' && iso < hoyISO);
    const clases = ['calendario-dia'];
    if (iso === hoyISO) clases.push('calendario-dia-hoy');
    if (iso === calendarioDiaSeleccionado) clases.push('calendario-dia-activa');
    return `
      <div class="${clases.join(' ')}" data-cal-dia="${iso}">
        <span class="calendario-num">${dia}</span>
        ${cosas.length ? `<span class="calendario-punto${tieneRecordatorioVencido ? ' calendario-punto-alerta' : ''}"></span>` : ''}
      </div>`;
  };

  const cosasDelDia = calendarioDiaSeleccionado ? (porDia.get(calendarioDiaSeleccionado) || []) : null;
  const detalleDia = calendarioDiaSeleccionado ? `
    <div class="card">
      <h3 class="section-title">${fmtFechaEvento(calendarioDiaSeleccionado)}</h3>
      ${cosasDelDia.length ? cosasDelDia.map(c => c.tipo === 'recordatorio' ? `
        <div class="ficha-row" style="align-items:center;">
          <span class="k">📅 ${esc(c.detalle)}</span>
          <div class="row" style="gap:6px;">
            <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" data-recordatorio-hecho="${c.recordatorio.id}" type="button">Hecho</button>
            <button class="btn btn-ghost" style="padding:4px 8px;font-size:11px;" data-recordatorio-eliminar="${c.recordatorio.id}" type="button">✕</button>
          </div>
        </div>` : `
        <div class="ficha-row" ${c.animal ? `style="cursor:pointer;" data-ver-animal="${c.animal.id}"` : ''}>
          <span class="k"><img src="${ICONO_TIPO_EVENTO_CALENDARIO[c.tipo]}" alt="" style="width:15px;height:15px;object-fit:contain;vertical-align:-3px;"> ${esc(c.animal ? etiquetaAnimal(c.animal) : '(animal eliminado)')}${c.detalle ? ' · ' + esc(c.detalle) : ''}</span>
        </div>`).join('') : `<p class="small muted">Nada registrado ni programado este día.</p>`}
    </div>` : '';

  return `
    <h3 class="section-title" style="margin-bottom:14px;">Calendario</h3>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center;">
        <button class="btn btn-ghost" type="button" data-cal-mes="-1" style="padding:6px 12px;">‹</button>
        <b>${NOMBRES_MES[calendarioMes]} ${calendarioAnio}</b>
        <button class="btn btn-ghost" type="button" data-cal-mes="1" style="padding:6px 12px;">›</button>
      </div>
      <div class="calendario-grid" style="margin-top:10px;">
        <div class="calendario-dow">D</div><div class="calendario-dow">L</div><div class="calendario-dow">M</div>
        <div class="calendario-dow">M</div><div class="calendario-dow">J</div><div class="calendario-dow">V</div><div class="calendario-dow">S</div>
        ${celdas.map(celdaHtml).join('')}
      </div>
    </div>

    ${detalleDia}

    <button class="btn btn-ghost btn-block" type="button" id="btnToggleFormRecordatorio">${calendarioFormAbierto ? '▲ Ocultar' : '➕ Nuevo recordatorio'}</button>
    ${calendarioFormAbierto ? `
    <div class="card">
      <form id="formRecordatorioSanitario">
        <label>Nombre — p. ej. Aftosa, Desparasitación</label>
        <input name="nombre" required placeholder="Nombre">
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="proxima_fecha" type="date" required value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
          <select name="frecuencia_meses" style="flex:1;">
            <option value="">Una sola vez</option>
            <option value="1">Cada mes</option>
            <option value="3">Cada 3 meses</option>
            <option value="6">Cada 6 meses</option>
            <option value="12">Cada 12 meses</option>
          </select>
        </div>
        <input name="notas" placeholder="Notas (opcional)" style="margin-top:9px;">
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Agregar</button>
      </form>
    </div>
    ` : ''}
  `;
}

async function viewPesaje(){
  const [animales, eventos] = await Promise.all([mockApi.misAnimales(), mockApi.misEventosAnimal('pesaje', 30)]);
  const nombrePorAnimal = {};
  animales.forEach(a => { nombrePorAnimal[a.id] = a; });
  const nombreDeEvento = e => nombrePorAnimal[e.animal_id];

  return `
    <h3 class="section-title" style="margin-bottom:14px;">Pesaje</h3>
    <div class="card">
      <h3 class="section-title">Registrar pesaje</h3>
      ${!animales.length ? `<p class="small muted" style="margin-bottom:8px;">Todavía no tenés ningún animal registrado.</p>` : ''}
      <form id="formPesajeRapido">
        <label>Número de animal o chip</label>
        <input id="identificadorPesaje" name="identificador" required placeholder="N° interno o chip — o escaneá con el lector" list="sugerenciasIdentificadorPesaje" autocomplete="off">
        <datalist id="sugerenciasIdentificadorPesaje">${opcionesIdentificadorAnimales(animales)}</datalist>
        <div id="historialAnimalPesaje"></div>
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="peso_kg" type="number" step="0.1" min="0" required placeholder="Peso (kg)" style="flex:1;">
          <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
        </div>
        <label>Condición corporal</label>
        <select name="condicion_corporal">
          <option value="">Sin evaluar (opcional)</option>
          <option value="1">1 · Muy flaco</option>
          <option value="2">2 · Flaco</option>
          <option value="3">3 · Óptimo</option>
          <option value="4">4 · Gordo</option>
          <option value="5">5 · Muy gordo</option>
        </select>
        <label>Notas</label>
        <input name="notas" placeholder="Opcional">
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Guardar</button>
      </form>
    </div>
    <div class="card">
      <h3 class="section-title">Historial</h3>
      ${eventos.length ? eventos.map(e => `
        <div class="ficha-row">
          <span class="k">${fmtFechaEvento(e.fecha)} · ${esc(etiquetaAnimal(nombreDeEvento(e)))}${e.condicion_corporal ? ' · ' + etiquetaCondicionCorporal(e.condicion_corporal) : ''}${e.notas ? ' · ' + esc(e.notas) : ''}</span>
          <span class="v">${e.peso_kg} kg</span>
        </div>`).join('') : `<div class="empty">Todavía no cargaste pesajes.</div>`}
    </div>
  `;
}

// Mismo patrón exacto que viewPesaje(): alta rápida arriba + historial
// de todo el rebaño abajo, más reciente primero (ver
// registrar_produccion_leche() en
// supabase/migrations/20260923090000_leche_y_genealogia.sql). "Turno" es
// opcional a propósito — muchos productores solo llevan un total diario,
// no separado por ordeña.
async function viewLeche(){
  const [animales, eventos] = await Promise.all([mockApi.misAnimales(), mockApi.misEventosAnimal('produccion_leche', 30)]);
  const nombrePorAnimal = {};
  animales.forEach(a => { nombrePorAnimal[a.id] = a; });
  const nombreDeEvento = e => nombrePorAnimal[e.animal_id];

  return `
    <h3 class="section-title" style="margin-bottom:14px;">Producción de leche</h3>
    <div class="card">
      <h3 class="section-title">Registrar ordeña</h3>
      ${!animales.length ? `<p class="small muted" style="margin-bottom:8px;">Todavía no tenés ningún animal registrado.</p>` : ''}
      <form id="formLecheRapido">
        <label>Número de animal o chip</label>
        <input id="identificadorLeche" name="identificador" required placeholder="N° interno o chip — o escaneá con el lector" list="sugerenciasIdentificadorLeche" autocomplete="off">
        <datalist id="sugerenciasIdentificadorLeche">${opcionesIdentificadorAnimales(animales)}</datalist>
        <div id="historialAnimalLeche"></div>
        <div class="row" style="gap:8px;margin-top:9px;">
          <input name="litros" type="number" step="0.1" min="0" required placeholder="Litros" style="flex:1;">
          <input name="fecha" type="date" value="${new Date().toISOString().slice(0, 10)}" style="flex:1;">
        </div>
        <select name="turno" style="margin-top:9px;">
          <option value="">Turno — sin especificar (opcional)</option>
          <option value="Mañana">Mañana</option>
          <option value="Tarde">Tarde</option>
        </select>
        <label>Notas</label>
        <input name="notas" placeholder="Opcional">
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Guardar</button>
      </form>
    </div>
    <div class="card">
      <h3 class="section-title">Historial</h3>
      ${eventos.length ? eventos.map(e => `
        <div class="ficha-row">
          <span class="k">${fmtFechaEvento(e.fecha)} · ${esc(etiquetaAnimal(nombreDeEvento(e)))}${e.descripcion ? ' · ' + esc(e.descripcion) : ''}${e.notas ? ' · ' + esc(e.notas) : ''}</span>
          <span class="v">${e.litros_leche} L</span>
        </div>`).join('') : `<div class="empty">Todavía no cargaste ordeñas.</div>`}
    </div>
  `;
}

// Mismo patrón que viewSanidad()/viewPesaje(): alta rápida arriba (sin
// necesitar entrar a la ficha de cada animal) + historial de todo el
// rebaño abajo, más reciente primero — ver registrar_reproduccion() en
// supabase/migrations/20260819100000_sin_solicitudes_mas_reproduccion_y_reportes.sql.
async function viewReproduccion(){
  // Límite alto (no solo los últimos 30) porque calcularAlertasReproduccion()
  // necesita ver el ÚLTIMO evento de cada hembra para decidir si avisa —
  // el historial de abajo sí se recorta a la vista.
  const [animales, eventos] = await Promise.all([mockApi.misAnimales(), mockApi.misEventosAnimal('reproduccion', 500)]);
  const nombrePorAnimal = {};
  animales.forEach(a => { nombrePorAnimal[a.id] = a; });
  const nombreDeEvento = e => nombrePorAnimal[e.animal_id];
  const alertas = calcularAlertasReproduccion(animales, eventos);
  const eventosAMostrar = eventos.slice(0, 30);

  return `
    <h3 class="section-title" style="margin-bottom:14px;">Reproducción</h3>
    <div class="ficha-tabs">
      <button type="button" class="ficha-tab ${reproduccionSubview === 'registrar' ? 'active' : ''}" data-reproduccion-tab="registrar">Registrar evento</button>
      <button type="button" class="ficha-tab ${reproduccionSubview === 'alertas' ? 'active' : ''}" data-reproduccion-tab="alertas">Alertas${alertas.length ? ` (${alertas.length})` : ''}</button>
      <button type="button" class="ficha-tab ${reproduccionSubview === 'historial' ? 'active' : ''}" data-reproduccion-tab="historial">Historial</button>
    </div>

    ${reproduccionSubview === 'registrar' ? `
    <div class="card">
      <h3 class="section-title">Registrar evento</h3>
      ${!animales.length ? `<p class="small muted" style="margin-bottom:8px;">Todavía no tenés ningún animal registrado.</p>` : ''}
      <form id="formReproduccionRapida">
        <label>Número de animal o chip</label>
        <input id="identificadorReproduccion" name="identificador" required placeholder="N° interno o chip — o escaneá con el lector" list="sugerenciasIdentificadorReproduccion" autocomplete="off">
        <datalist id="sugerenciasIdentificadorReproduccion">${opcionesIdentificadorAnimales(animales)}</datalist>
        <div id="historialAnimalReproduccion"></div>
        ${camposReproduccion('rapida')}
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:8px;">Guardar</button>
      </form>
    </div>
    ` : ''}

    ${reproduccionSubview === 'alertas' ? `
    <div class="card">
      <h3 class="section-title">⚠️ Alertas de celo y parto</h3>
      ${alertas.length ? alertas.map(filaAlertaReproduccion).join('') : `<div class="empty">Sin alertas por ahora.</div>`}
    </div>
    ` : ''}

    ${reproduccionSubview === 'historial' ? `
    <div class="card">
      <h3 class="section-title">Historial</h3>
      ${eventosAMostrar.length ? eventosAMostrar.map(e => {
        const detalle = [esc(etiquetaAnimal(nombreDeEvento(e))), detalleReproduccion(e)].filter(Boolean).join(' · ');
        return `
        <div class="ficha-row">
          <span class="k">${fmtFechaEvento(e.fecha)}${detalle ? ' · ' + detalle : ''}</span>
          <span class="v">${esc(e.descripcion)}</span>
        </div>`;
      }).join('') : `<div class="empty">Todavía no cargaste eventos de reproducción.</div>`}
      ${eventos.length > eventosAMostrar.length ? `<p class="small muted" style="margin-top:8px;">Y ${eventos.length - eventosAMostrar.length} más — solo se muestran los últimos 30.</p>` : ''}
    </div>
    ` : ''}
  `;
}

// Qué hacer con un chip escaneado (o tecleado) — un solo lugar del que
// dependen tanto el buscador de "Mis animales" como el escaneo global de
// abajo, para que se comporten igual sin importar desde dónde se disparen:
//   1. ¿Es un animal propio ya registrado (por chip o N° interno)? → abre
//      su ficha directo.
//   2. Si no, ¿el chip existe en el inventario y sigue "en_stock" (nadie
//      lo usó todavía)? → manda a la hoja de registro: es justo el caso
//      "chip disponible, animal sin registrar" que se quiere resolver de
//      un tirón. consultarChip() es pública (no depende de sesión) y
//      consulta el inventario real, no solo los animales propios.
//   3. Si el chip existe pero ya está "asignado" (a un animal que no es
//      tuyo, si fuera tuyo ya se hubiera encontrado en el paso 1) o
//      "invalidado", o si directamente no existe en el inventario, se
//      avisa con un mensaje claro y no se navega a ningún lado.
async function procesarChipEscaneado(identificador){
  // Dentro del detalle de un lote (viewLoteDetalle()), un escaneo no debe
  // abrir ninguna ficha ni mandar a ningún otro lado — si el chip ya es
  // de un animal propio, se suma directo al lote (sin cortar el ritmo de
  // ir escaneando uno tras otro); si es un chip nuevo disponible, queda
  // pendiente de registrar (agregarChipALote()).
  if (currentScreen === 'lote' && loteScreenSubview === 'detalle' && loteSeleccionadoId) {
    const animalPropio = await buscarMiAnimalPorIdentificador(identificador);
    if (animalPropio) {
      try {
        await mockApi.agregarAnimalesALote(loteSeleccionadoId, [animalPropio.id]);
        toast('Animal sumado al lote', '✅');
        renderApp();
      } catch (err) { toast(err.message, '⚠️'); }
      return;
    }
    await agregarChipALote(identificador);
    return;
  }

  const animal = await buscarMiAnimalPorIdentificador(identificador);
  if (animal) {
    // Si ya había una ficha abierta de un escaneo anterior, se cierra
    // antes de abrir la nueva — así se pueden recorrer varios animales
    // seguidos sin que se vayan apilando fichas una sobre otra.
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    abrirFichaAnimal(animal.id);
    return;
  }

  let info;
  try {
    info = await mockApi.consultarChip(identificador);
  } catch (err) {
    // Sin conexión, consultarChip() no puede confirmar el chip contra el
    // inventario real en el momento — pero eso ya no bloquea el alta:
    // CUALQUIER chip se deja pasar igual al formulario, esté o no en la
    // lista de "reservados" que el admin le haya bajado a este celular.
    // Es el mismo criterio que ya usa registrar_animal_directo() del lado
    // del servidor para un chip que no matchea ningún "en_stock" oficial
    // (se guarda como referencia propia, sin fallar) — acá se aplica
    // también sin señal (ver registrarAnimalDirecto() en shared/data.js).
    // Si el chip SÍ está reservado se avisa distinto, solo para que quien
    // registra sepa que ese en particular ya viene confirmado.
    if (!_pareceErrorDeConexion(err)) { toast(err.message, '⚠️'); return; }
    const reservados = await idbTodo('cache_chips_reservados');
    const chipUid = identificador.trim();
    const esReservado = reservados.some((c) => c.chip_uid === chipUid);
    toast(esReservado ? 'Sin conexión — chip reservado disponible, completá el registro' : 'Sin conexión — el chip se guarda igual, se confirma contra el inventario cuando vuelva la señal', '📴');
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    chipEscaneadoParaRegistro = chipUid;
    animalesSubview = 'form';
    currentScreen = 'animales';
    renderApp();
    return;
  }

  if (!info.existe) { toast(info.advertencia || 'Ese número no está en el inventario', '⚠️'); return; }

  if (info.estado === 'en_stock') {
    toast('Chip disponible — completá el registro del animal', '🪪');
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    chipEscaneadoParaRegistro = identificador.trim();
    animalesSubview = 'form';
    currentScreen = 'animales';
    renderApp();
    return;
  }

  toast(
    info.estado === 'invalidado'
      ? 'Ese chip está invalidado — no se puede usar'
      : 'Ese chip ya está asignado a un animal que no es tuyo',
    '⚠️'
  );
}

// Escaneo global: a diferencia del buscador de "Mis animales" (que
// necesita el cursor puesto ahí), esto funciona en CUALQUIER pantalla de
// la app, sin tener que tocar ningún campo primero — el lector Bluetooth
// manda las teclas igual aunque no haya foco en nada, y acá se van
// juntando en un buffer propio hasta que llega el Enter con el que el
// lector remata cada chip. Se engancha una sola vez (document vive toda
// la sesión, bindEvents() se vuelve a llamar en cada render).
function bindEscaneoGlobal(){
  if (window.__scanGlobalBound) return;
  window.__scanGlobalBound = true;
  document.addEventListener('keydown', async (e) => {
    if (!mockApi.sesionActual()) { scanBuffer = ''; return; }
    const activo = document.activeElement;
    // Si el usuario está escribiendo a mano en un campo de texto
    // (buscador incluido, que ya tiene su propio manejo), no interferir.
    if (activo && (activo.tagName === 'INPUT' || activo.tagName === 'TEXTAREA')) { scanBuffer = ''; return; }

    if (e.key === 'Enter') {
      e.preventDefault();
      const q = scanBuffer.trim();
      scanBuffer = '';
      if (!q) return;
      await procesarChipEscaneado(q);
      return;
    }
    // Solo junta teclas de un solo carácter (letras/números del chip) —
    // ignora Shift, Tab, flechas y demás teclas de control.
    if (e.key.length === 1) {
      scanBuffer += e.key;
      clearTimeout(scanTimer);
      // Si pasa más de lo que tarda el lector en mandar todo el UID
      // completo, se asume que el buffer quedó viejo y se limpia.
      scanTimer = setTimeout(() => { scanBuffer = ''; }, 800);
    }
  });
}

// leerDatosAnimalDeFormulario() se mudó a shared/ui-common.js, junto con
// camposDatosAnimal() — quedaron ahí por si algún otro lugar necesita
// estos mismos campos, aunque hoy el único que los usa es este archivo.

function bindEvents(){
  const app = document.getElementById('app');

  app.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => {
    // Sin esto, tocar una pestaña que no está del todo visible hace que
    // el navegador (sobre todo en celular) desplace solo la barra entera
    // para centrar el botón recién enfocado ANTES de cambiar de pantalla
    // — un movimiento de más que se siente como un tranco en vez de
    // fluido. Sacarle el foco de encima corta ese comportamiento.
    b.blur();
    const destino = b.dataset.nav;
    // Empuja al historial la pantalla que se deja, no la nueva — así el
    // botón de atrás la restaura (ver el "popstate" al final del archivo).
    if (destino !== currentScreen) history.pushState({ pantalla: currentScreen }, '', location.href);
    currentScreen = destino;
    resetearSubvistas();
    renderApp();
  });

  if (currentScreen === 'tienda' && window.GanaIDStore) window.GanaIDStore.bind(app);
  const btnCarritoTienda = app.querySelector('[data-tienda-abrir-carrito]');
  if (btnCarritoTienda) btnCarritoTienda.onclick = () => {
    btnCarritoTienda.blur();
    window.GanaIDStore?.openCart();
  };
  if (window.GanaIDConnectionStatus) window.GanaIDConnectionStatus.bind(app);

  // El menú de usuario (abrirMenuUsuario(), shared/ui-common.js) cablea su
  // propio botón de cerrar sesión — este [data-logout] genérico sigue
  // haciendo falta aparte para viewAccesoRestringido() (shared/ui-common.js),
  // la pantalla de "no tenés acceso a esta app", que no tiene ícono de
  // usuario (la sesión ni siquiera corresponde a esta app).
  const btnLogout = app.querySelector('[data-logout]');
  // No hace falta renderApp() acá — onAuthStateChange (shared/
  // auth-supabase.js) se entera solo del logout y ya vuelve a pintar.
  if (btnLogout) btnLogout.onclick = () => { currentScreen = 'inicio'; mockApi.logout(); };

  bindConsultarChip(app);
  app.querySelectorAll('[data-ver-animal]').forEach(el => el.onclick = () => abrirFichaAnimal(idPropio(el.dataset.verAnimal)));

  bindLookupAnimalRapido('identificadorSanidad', 'historialAnimalSanidad');
  bindLookupAnimalRapido('identificadorPesaje', 'historialAnimalPesaje');
  bindLookupAnimalRapido('identificadorLeche', 'historialAnimalLeche');
  bindLookupAnimalRapido('identificadorReproduccion', 'historialAnimalReproduccion');

  const formSanidadRapida = document.getElementById('formSanidadRapida');
  if (formSanidadRapida) formSanidadRapida.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formSanidadRapida);
    const animal = await buscarMiAnimalPorIdentificador(fd.get('identificador'));
    if (!animal) { toast('Ese N° interno o chip no es de ninguno de tus animales', '⚠️'); return; }
    const datos = {
      tipo: fd.get('tipo'), notas: fd.get('notas').trim() || null, fecha: fd.get('fecha') || null,
      producto: fd.get('producto').trim() || null, lote_producto: fd.get('lote_producto').trim() || null,
      dosis: fd.get('dosis').trim() || null, veterinario: fd.get('veterinario').trim() || null,
      dias_retiro: fd.get('dias_retiro') || null,
    };
    try {
      await mockApi.registrarSanidad(animal.id, datos);
      toast('Sanidad registrada', '💉');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  const formPesajeRapido = document.getElementById('formPesajeRapido');
  if (formPesajeRapido) formPesajeRapido.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formPesajeRapido);
    const animal = await buscarMiAnimalPorIdentificador(fd.get('identificador'));
    if (!animal) { toast('Ese N° interno o chip no es de ninguno de tus animales', '⚠️'); return; }
    const datos = {
      peso_kg: fd.get('peso_kg'), fecha: fd.get('fecha') || null,
      condicion_corporal: fd.get('condicion_corporal') || null, notas: fd.get('notas').trim() || null,
    };
    try {
      await mockApi.registrarPesaje(animal.id, datos);
      toast('Pesaje guardado', '⚖️');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  const formLecheRapido = document.getElementById('formLecheRapido');
  if (formLecheRapido) formLecheRapido.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formLecheRapido);
    const animal = await buscarMiAnimalPorIdentificador(fd.get('identificador'));
    if (!animal) { toast('Ese N° interno o chip no es de ninguno de tus animales', '⚠️'); return; }
    const datos = {
      litros: fd.get('litros'), fecha: fd.get('fecha') || null,
      turno: fd.get('turno') || null, notas: fd.get('notas').trim() || null,
    };
    try {
      await mockApi.registrarProduccionLeche(animal.id, datos);
      toast('Ordeña guardada', '🥛');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  app.querySelectorAll('[data-reproduccion-tab]').forEach(el => el.onclick = () => {
    reproduccionSubview = el.dataset.reproduccionTab;
    renderApp();
  });
  app.querySelectorAll('[data-sanidad-tab]').forEach(el => el.onclick = () => {
    sanidadSubview = el.dataset.sanidadTab;
    renderApp();
  });
  bindCamposReproduccion('rapida');
  const formReproduccionRapida = document.getElementById('formReproduccionRapida');
  if (formReproduccionRapida) formReproduccionRapida.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formReproduccionRapida);
    const animal = await buscarMiAnimalPorIdentificador(fd.get('identificador'));
    if (!animal) { toast('Ese N° interno o chip no es de ninguno de tus animales', '⚠️'); return; }
    const datos = leerDatosReproduccionDeFormulario(fd);
    try {
      await mockApi.registrarReproduccion(animal.id, datos);
      toast('Evento de reproducción registrado', '🐄');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };

  // Mismo criterio que las tablas con buscador del panel de Administración
  // (ver bloqueTablaBuscable en shared/view-generic.js): filtra en el
  // propio JS, sin perder el foco en cada tecla — y funciona igual si el
  // "tipeo" viene del lector Bluetooth en vez de un dedo.
  const buscarMisAnimales = document.getElementById('buscarMisAnimales');
  if (buscarMisAnimales) buscarMisAnimales.oninput = () => {
    const q = buscarMisAnimales.value.trim().toLowerCase();
    let visibles = 0;
    document.querySelectorAll('#listaAnimalesCertificados [data-buscar]').forEach(el => {
      const coincide = el.dataset.buscar.includes(q);
      el.style.display = coincide ? '' : 'none';
      if (coincide) visibles++;
    });
    const sinResultados = document.getElementById('sinResultadosMisAnimales');
    if (sinResultados) sinResultados.style.display = visibles === 0 ? '' : 'none';
  };
  // Escaneo automático: el lector Bluetooth remata cada chip con un Enter
  // (mismo mecanismo que bindConsultarChip() en shared/ui-common.js) —
  // acá, en vez de mostrar un resultado genérico, procesarChipEscaneado()
  // decide qué hacer (abrir ficha o mandar a registrar), mismo criterio
  // que el escaneo global de bindEscaneoGlobal().
  if (buscarMisAnimales) buscarMisAnimales.onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = buscarMisAnimales.value.trim();
    if (!q) return;
    buscarMisAnimales.value = '';
    buscarMisAnimales.dispatchEvent(new Event('input'));
    await procesarChipEscaneado(q);
  };
  bindEscaneoGlobal();

  const btnExportarRanchoActual = app.querySelector('[data-exportar-rancho-actual]');
  if (btnExportarRanchoActual) btnExportarRanchoActual.onclick = () => exportarMiInformacion(false);
  const btnExportarTodosRanchos = app.querySelector('[data-exportar-todos-ranchos]');
  if (btnExportarTodosRanchos) btnExportarTodosRanchos.onclick = () => exportarMiInformacion(true);
  app.querySelectorAll('[data-exportar-lote]').forEach(el => el.onclick = () => exportarExcelLote(idPropio(el.dataset.exportarLote)));

  // Deshabilita LOS DOS botones (mensual/anual) apenas se toca uno —
  // crearSuscripcionMercadoPago() tarda un ratito (llama a la Edge
  // Function, que a su vez llama a la API de Mercado Pago) y un segundo
  // click mientras tanto crearía una suscripción duplicada.
  app.querySelectorAll('[data-suscribirme]').forEach(btn => btn.onclick = async () => {
    // Si ya tiene acceso completo por un código de promoción o un
    // crédito de hardware (sin ser todavía una suscripción real
    // confirmada), avisa antes de mandarlo a pagar — para que no
    // termine iniciando un cobro real pensando que seguía en el
    // período gratis.
    const sesion = getSession();
    const hoy = new Date().toISOString().slice(0, 10);
    const yaTieneAccesoGratis = sesion && sesion.fecha_proximo_pago && sesion.fecha_proximo_pago >= hoy
      && !(sesion.plan_tipo === 'mensual' || sesion.plan_tipo === 'anual') && sesion.plan_estado !== 'al_dia';
    if (yaTieneAccesoGratis) {
      if (!confirm(`Ya tenés acceso completo hasta ${fmtFecha(sesion.fecha_proximo_pago)} (código de promoción o crédito). Si te suscribís ahora vas a empezar a pagar de una, sin esperar a que eso se termine. ¿Suscribirte igual?`)) return;
    }
    const botones = app.querySelectorAll('[data-suscribirme]');
    const textoOriginal = btn.textContent;
    botones.forEach(b => b.disabled = true);
    btn.textContent = 'Redirigiendo a Mercado Pago…';
    try {
      const initPoint = await mockApi.crearSuscripcionMercadoPago(btn.dataset.suscribirme);
      location.href = initPoint;
    } catch (err) {
      toast(err.message, '⚠️');
      botones.forEach(b => b.disabled = false);
      btn.textContent = textoOriginal;
    }
  });

  const formCanjearCodigo = document.getElementById('formCanjearCodigo');
  if (formCanjearCodigo) formCanjearCodigo.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formCanjearCodigo);
    const codigo = (fd.get('codigo') || '').trim();
    if (!codigo) { toast('Escribí un código', '⚠️'); return; }
    try {
      const r = await mockApi.canjearCodigoPromocional(codigo);
      toast(`¡Canjeado! ${r.meses} mes(es) de acceso completo`, '🎟️');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };

  const btnToggleFormRecordatorio = document.getElementById('btnToggleFormRecordatorio');
  if (btnToggleFormRecordatorio) btnToggleFormRecordatorio.onclick = () => {
    calendarioFormAbierto = !calendarioFormAbierto;
    renderApp();
  };
  const formRecordatorioSanitario = document.getElementById('formRecordatorioSanitario');
  if (formRecordatorioSanitario) formRecordatorioSanitario.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formRecordatorioSanitario);
    try {
      await mockApi.crearRecordatorioSanitario({
        nombre: fd.get('nombre').trim(), proximaFecha: fd.get('proxima_fecha'),
        frecuenciaMeses: fd.get('frecuencia_meses') ? parseInt(fd.get('frecuencia_meses'), 10) : null,
        notas: fd.get('notas').trim() || null,
      });
      toast('Recordatorio agregado', '📅');
      calendarioFormAbierto = false;
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  app.querySelectorAll('[data-recordatorio-hecho]').forEach(b => b.onclick = async () => {
    try {
      await mockApi.marcarRecordatorioHecho(Number(b.dataset.recordatorioHecho));
      toast('Recordatorio actualizado', '✅');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });
  app.querySelectorAll('[data-recordatorio-eliminar]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Eliminar este recordatorio?')) return;
    try {
      await mockApi.eliminarRecordatorioSanitario(Number(b.dataset.recordatorioEliminar));
      toast('Recordatorio eliminado', '🗑️');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });
  app.querySelectorAll('[data-cal-mes]').forEach(b => b.onclick = () => {
    calendarioMes += Number(b.dataset.calMes);
    if (calendarioMes < 0) { calendarioMes = 11; calendarioAnio--; }
    else if (calendarioMes > 11) { calendarioMes = 0; calendarioAnio++; }
    calendarioDiaSeleccionado = null;
    renderApp();
  });
  app.querySelectorAll('[data-cal-dia]').forEach(el => el.onclick = () => {
    const iso = el.dataset.calDia;
    calendarioDiaSeleccionado = calendarioDiaSeleccionado === iso ? null : iso;
    renderApp();
  });

  app.querySelectorAll('[data-config-toggle]').forEach(el => el.onclick = () => {
    configuracionAbierta = configuracionAbierta === el.dataset.configToggle ? null : el.dataset.configToggle;
    renderApp();
  });

  // formEditarPerfil() (shared/ui-common.js) es la misma pieza que ya usa
  // el menú del avatar (abrirMenuUsuario()) — acá solo se le da un lugar
  // fijo más, dentro de Configuración.
  const formEditarPerfilConfig = document.getElementById('formEditarPerfil');
  if (formEditarPerfilConfig) formEditarPerfilConfig.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formEditarPerfilConfig);
    try {
      await mockApi.actualizarMiPerfil({
        nombre: fd.get('nombre'), rancho_o_empresa: fd.get('rancho_o_empresa'),
        telefono: fd.get('telefono'), municipio: fd.get('municipio') || null,
      });
      toast('Perfil actualizado', '✅');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };

  const btnAbrirRanchosConfig = document.getElementById('btnAbrirRanchosConfig');
  if (btnAbrirRanchosConfig) btnAbrirRanchosConfig.onclick = abrirSelectorRancho;

  const btnCancelarSuscripcion = document.getElementById('btnCancelarSuscripcion');
  if (btnCancelarSuscripcion) btnCancelarSuscripcion.onclick = async () => {
    if (!confirm('¿Cancelar la suscripción? Vas a seguir con acceso completo hasta la fecha ya pagada — después de eso no se te va a volver a cobrar y volvés al límite gratis (50 animales, 1 rancho).')) return;
    btnCancelarSuscripcion.disabled = true;
    try {
      await mockApi.cancelarSuscripcionMercadoPago();
      toast('Suscripción cancelada — tenés acceso hasta la fecha ya pagada', '✅');
      renderApp();
    } catch (err) {
      toast(err.message, '⚠️');
      btnCancelarSuscripcion.disabled = false;
    }
  };

  const btnActivarPush = document.getElementById('btnActivarPush');
  if (btnActivarPush) btnActivarPush.onclick = async () => {
    try {
      await activarNotificacionesPush();
      toast('Notificaciones activadas en este dispositivo', '🔔');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  const btnDesactivarPush = document.getElementById('btnDesactivarPush');
  if (btnDesactivarPush) btnDesactivarPush.onclick = async () => {
    try {
      await desactivarNotificacionesPush();
      toast('Notificaciones desactivadas en este dispositivo', '✅');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  const btnCerrarSesionConfig = document.getElementById('btnCerrarSesionConfig');
  if (btnCerrarSesionConfig) btnCerrarSesionConfig.onclick = () => { currentScreen = 'inicio'; mockApi.logout(); };

  const btnSincronizarAhora = document.getElementById('btnSincronizarAhora');
  if (btnSincronizarAhora) btnSincronizarAhora.onclick = async () => {
    try { await mockApi.sincronizarAhora(); toast('Sincronizado', '✅'); renderApp(); }
    catch (err) { toast(err.message, '📶'); }
  };
  app.querySelectorAll('[data-descartar-fallo]').forEach((b) => b.onclick = async () => {
    await mockApi.descartarFalloSincronizacion(parseInt(b.dataset.descartarFallo, 10));
    renderApp();
  });

  bindInstalarApp();
  bindIconoMenuUsuario();

  const btnCambiarRancho = document.getElementById('btnCambiarRancho');
  if (btnCambiarRancho) btnCambiarRancho.onclick = () => abrirSelectorRancho();

  // Muestra/oculta "Raza cruzada" según la casilla "Es cruza de razas" —
  // vive en camposDatosAnimal(), compartido por los dos formularios.
  const chkEsCruza = document.getElementById('chkEsCruza');
  if (chkEsCruza) chkEsCruza.onchange = () => {
    const wrap = document.getElementById('wrapRazaCruzada');
    if (wrap) wrap.style.display = chkEsCruza.checked ? '' : 'none';
  };

  const fabAnimal = document.getElementById('fabRegistrarAnimal');
  if (fabAnimal) fabAnimal.onclick = () => { chipEscaneadoParaRegistro = null; animalesSubview = 'form'; renderApp(); };
  const volverAnimales = app.querySelector('[data-volver-animales]');
  if (volverAnimales) volverAnimales.onclick = () => { chipEscaneadoParaRegistro = null; animalesSubview = 'lista'; renderApp(); };

  // ===== "Lote" (viewLotes()/viewNuevoLoteForm()/viewLoteDetalle(), ver más arriba) =====
  const fabNuevoLote = document.getElementById('fabNuevoLote');
  if (fabNuevoLote) fabNuevoLote.onclick = () => { loteScreenSubview = 'form'; renderApp(); };
  const formNuevoLote = document.getElementById('formNuevoLote');
  if (formNuevoLote) formNuevoLote.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formNuevoLote);
    try {
      const lote = await mockApi.crearLote({ nombre: fd.get('nombre'), tipo: fd.get('tipo'), categoria: fd.get('categoria'), notas: fd.get('notas') });
      toast('Lote creado', '✅');
      loteAnimales = [];
      loteDetalleSubview = 'grupo';
      loteTareaAbierta = null;
      loteSeleccionadoId = lote.id;
      loteScreenSubview = 'detalle';
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  app.querySelectorAll('[data-ver-lote]').forEach(el => el.onclick = () => {
    loteAnimales = [];
    loteDetalleSubview = 'grupo';
    loteTareaAbierta = null;
    loteSeleccionadoId = idPropio(el.dataset.verLote);
    loteScreenSubview = 'detalle';
    renderApp();
  });
  const volverLotes = app.querySelector('[data-volver-lotes]');
  if (volverLotes) volverLotes.onclick = () => {
    if (loteAnimales.length && !confirm('¿Salir sin guardar? Se va a perder la lista de animales nuevos que armaste para este lote.')) return;
    loteAnimales = [];
    loteDetalleSubview = 'grupo';
    loteTareaAbierta = null;
    loteSeleccionadoId = null;
    loteScreenSubview = 'lista';
    renderApp();
  };
  app.querySelectorAll('[data-lote-detalle-tab]').forEach(el => el.onclick = () => {
    loteDetalleSubview = el.dataset.loteDetalleTab;
    renderApp();
  });
  app.querySelectorAll('[data-lote-tarea]').forEach(el => el.onclick = () => {
    const tarea = el.dataset.loteTarea;
    loteTareaAbierta = loteTareaAbierta === tarea ? null : tarea;
    renderApp();
  });
  const btnMasOpcionesLote = document.getElementById('btnMasOpcionesLote');
  if (btnMasOpcionesLote) btnMasOpcionesLote.onclick = async () => {
    const lotes = await mockApi.misLotes();
    const lote = lotes.find(l => l.id === loteSeleccionadoId);
    if (lote) abrirMasOpcionesLote(lote);
  };
  const btnEditarLote = document.getElementById('btnEditarLote');
  if (btnEditarLote) btnEditarLote.onclick = async () => {
    const lotes = await mockApi.misLotes();
    const lote = lotes.find(l => l.id === loteSeleccionadoId);
    if (lote) abrirEditorLote(lote);
  };
  const btnAbrirSeleccionGuardados = document.getElementById('btnAbrirSeleccionGuardados');
  if (btnAbrirSeleccionGuardados) btnAbrirSeleccionGuardados.onclick = async () => {
    const [lotes, todos, yaEnLote] = await Promise.all([
      mockApi.misLotes(), mockApi.misAnimales(), mockApi.animalesDeLote(loteSeleccionadoId),
    ]);
    const lote = lotes.find(l => l.id === loteSeleccionadoId);
    if (!lote) return;
    const idsEnLote = new Set(yaEnLote.map(a => a.id));
    abrirSelectorAnimalesGuardados(lote, todos.filter(a => !idsEnLote.has(a.id)));
  };
  app.querySelectorAll('[data-quitar-de-lote]').forEach(el => el.onclick = async () => {
    try {
      await mockApi.quitarAnimalDeLote(loteSeleccionadoId, idPropio(el.dataset.quitarDeLote));
      toast('Animal sacado del lote', '➖');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  });
  const formReproduccionLote = document.getElementById('formReproduccionLote');
  if (formReproduccionLote) formReproduccionLote.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formReproduccionLote);
    try {
      const r = await mockApi.registrarReproduccionLote(loteSeleccionadoId, {
        tipo: fd.get('tipo'), semental: fd.get('semental'), veterinario: fd.get('veterinario'),
        fecha: fd.get('fecha'), notas: fd.get('notas'),
      });
      toast(`Aplicado a ${r.animales} animal(es)`, '🎯');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  const formSanidadLote = document.getElementById('formSanidadLote');
  if (formSanidadLote) formSanidadLote.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(formSanidadLote);
    try {
      const r = await mockApi.registrarSanidadLote(loteSeleccionadoId, {
        tipo: fd.get('tipo'), producto: fd.get('producto'), lote_producto: fd.get('lote_producto'),
        dosis: fd.get('dosis'), veterinario: fd.get('veterinario'), dias_retiro: fd.get('dias_retiro') || null,
        fecha: fd.get('fecha'), notas: fd.get('notas'),
      });
      toast(`Aplicado a ${r.animales} animal(es)`, '💉');
      renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };
  const btnOrdenRankingLote = document.getElementById('btnOrdenRankingLote');
  if (btnOrdenRankingLote) btnOrdenRankingLote.onclick = () => {
    loteOrdenRanking = loteOrdenRanking === 'desc' ? 'asc' : 'desc';
    renderApp();
  };

  // El buscador de arriba de todo (buscarMisAnimales) y el escaneo global
  // también sirven para agregar/sumar al lote estando en su detalle
  // (procesarChipEscaneado() lo redirige solo); loteEscaner es la versión
  // "puesta ahí a propósito" para cuando conviene tener el cursor fijo en
  // un solo campo mientras se escanea seguido.
  const loteEscaner = document.getElementById('loteEscaner');
  if (loteEscaner) loteEscaner.onkeydown = async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = loteEscaner.value.trim();
    if (!q) return;
    await procesarChipEscaneado(q);
  };
  const btnLoteAgregarMacho = document.getElementById('btnLoteAgregarMacho');
  if (btnLoteAgregarMacho) btnLoteAgregarMacho.onclick = () => {
    loteAnimales.push({ chip_uid: null, sexo: 'macho', numero_interno: '', peso_actual_kg: '' });
    renderFilasLote();
  };
  const btnLoteAgregarHembra = document.getElementById('btnLoteAgregarHembra');
  if (btnLoteAgregarHembra) btnLoteAgregarHembra.onclick = () => {
    loteAnimales.push({ chip_uid: null, sexo: 'hembra', numero_interno: '', peso_actual_kg: '' });
    renderFilasLote();
  };
  const loteFilas = document.getElementById('loteFilas');
  if (loteFilas) {
    // Delegado en el contenedor (no fila por fila) porque las filas se
    // reescriben enteras en cada renderFilasLote() — cablearlas una por
    // una se perdería apenas se agrega o quita alguna.
    loteFilas.oninput = (e) => {
      const campo = e.target.closest('[data-lote-campo]');
      if (!campo) return;
      const fila = loteAnimales[Number(campo.dataset.loteIdx)];
      if (fila) fila[campo.dataset.loteCampo] = campo.value;
    };
    loteFilas.onchange = loteFilas.oninput;
    loteFilas.onclick = (e) => {
      const btnQuitar = e.target.closest('[data-lote-quitar]');
      if (!btnQuitar) return;
      loteAnimales.splice(Number(btnQuitar.dataset.loteQuitar), 1);
      renderFilasLote();
    };
  }
  const btnGuardarLote = document.getElementById('btnGuardarLote');
  if (btnGuardarLote) btnGuardarLote.onclick = async () => {
    const raza = (document.getElementById('loteRaza').value || '').trim();
    if (!raza) { toast('Falta la raza', '⚠️'); return; }
    if (!loteAnimales.length) { toast('Todavía no agregaste ningún animal nuevo', '⚠️'); return; }

    const datosComunes = {
      raza,
      color: (document.getElementById('loteColor').value || '').trim() || null,
      marca_hierro: (document.getElementById('loteMarcaHierro').value || '').trim() || null,
      fecha_nacimiento: document.getElementById('loteFechaNacimiento').value || null,
      ubicacion: (document.getElementById('loteUbicacion').value || '').trim() || null,
      notas: (document.getElementById('loteNotas').value || '').trim() || null,
    };

    btnGuardarLote.disabled = true;
    btnGuardarLote.textContent = 'Registrando…';
    let ok = 0;
    const errores = [];
    // Secuencial a propósito, no Promise.all: cada registro compite por un
    // chip del inventario (FOR UPDATE SKIP LOCKED del lado del servidor) —
    // mandarlos todos en paralelo no suma nada y complica saber cuál falló.
    // Cada animal se registra Y se suma al lote actual en el mismo paso.
    for (const fila of loteAnimales) {
      try {
        const r = await mockApi.registrarAnimalDirecto({
          ...datosComunes,
          sexo: fila.sexo,
          chip_uid: fila.chip_uid,
          numero_interno: fila.numero_interno || null,
          peso_actual_kg: fila.peso_actual_kg || null,
        });
        await mockApi.agregarAnimalesALote(loteSeleccionadoId, [r.animal_id]);
        ok++;
      } catch (err) {
        errores.push(`${fila.chip_uid || fila.numero_interno || '(sin identificar)'}: ${err.message}`);
      }
    }
    btnGuardarLote.disabled = false;
    btnGuardarLote.textContent = 'Registrar y sumar al lote';

    if (errores.length) {
      console.warn('Errores registrando el lote:', errores);
      toast(`${ok} registrados, ${errores.length} con error (${errores[0]}${errores.length > 1 ? '…' : ''})`, '⚠️');
    } else {
      toast(`${ok} animal(es) registrados y sumados al lote`, '✅');
    }
    loteAnimales = [];
    renderApp();
  };

  const formAnimalRegistro = document.getElementById('formAnimalRegistro');
  if (formAnimalRegistro) formAnimalRegistro.onsubmit = async (e) => {
    e.preventDefault();
    const datos = leerDatosAnimalDeFormulario(new FormData(formAnimalRegistro));
    try {
      const r = await mockApi.registrarAnimalDirecto(datos);
      const etiqueta = r.chip_uid
        ? (r.chip_es_oficial ? `chip ${r.chip_uid} asignado` : `chip propio ${r.chip_uid} (sin inventario oficial)`)
        : `N° interno ${r.numero_interno}`;
      let extra = '';
      if (datos.fecha_nacimiento) {
        const identificador = r.numero_interno || r.chip_uid || etiqueta;
        const creados = await generarRecordatoriosVacunacion(identificador, datos.fecha_nacimiento, datos.sexo);
        if (creados) extra = ` — ${creados} recordatorio(s) de vacunación programado(s)`;
      }
      toast(`Registrado — ${etiqueta}${extra}`, '🪪');
      chipEscaneadoParaRegistro = null;
      animalesSubview = 'lista'; renderApp();
    } catch (err) { toast(err.message, '⚠️'); }
  };

}

// El primer renderApp() espera a que shared/auth-supabase.js confirme si
// hay sesión o no (puede que ya lo haya resuelto incluso antes de que este
// archivo termine de cargar — esperarSesionInicial() cubre los dos
// órdenes posibles) — así nunca arranca mostrando "sin sesión" un
// instante para después saltar a la app si en realidad sí la había.
esperarSesionInicial().then(renderApp);

// =====================================================================
// Botón de atrás (o el gesto equivalente en Android) DENTRO de la app, en
// vez de salir directo — importante para una app que se usa sin señal:
// antes, "atrás" te sacaba de la pantalla actual sin más, y en el peor
// caso terminaba intentando cargar algo que no tenía caché.
//
// Un MutationObserver detecta cualquier modal/ficha que se abra (varios
// lugares distintos del archivo crean uno con overlay.className =
// "modal-backdrop" — así no hay que ir a tocar cada uno) y empuja un
// estado al historial en ese momento; al apretar atrás, el "popstate" de
// abajo lo consume solo, cerrando el modal en vez de dejar que el
// navegador se vaya de la página. Sin ningún modal abierto, restaura la
// pantalla de la barra inferior que se dejó (ver el pushState en el click
// de "[data-nav]" más arriba). Si no queda nada más que restaurar (se
// volvió hasta el principio), se deja que el navegador siga su curso
// normal — salir de la app ahí sí es lo esperado.
// =====================================================================
new MutationObserver((mutaciones) => {
  for (const m of mutaciones) {
    for (const nodo of m.addedNodes) {
      if (nodo.nodeType === 1 && nodo.classList && nodo.classList.contains('modal-backdrop')) {
        history.pushState({ modal: true }, '', location.href);
        return;
      }
    }
  }
}).observe(document.body, { childList: true });

window.addEventListener('popstate', (e) => {
  const modales = document.querySelectorAll('.modal-backdrop');
  if (modales.length) { modales[modales.length - 1].remove(); return; }
  // Sin "e.state.pantalla" (se volvió hasta la entrada original, la del
  // primer renderApp(), que nunca tuvo un pushState propio) el destino por
  // default es "inicio" — NO no-hacer-nada: como esta transición sigue
  // siendo dentro del mismo documento (pushState nunca lo abandonó),
  // "no hacer nada" dejaba la pantalla vieja mostrada mientras el puntero
  // del historial ya se había movido, y recién el back SIGUIENTE (ahí sí,
  // sin nada más del lado de la app) terminaba saliendo de la página de
  // golpe — daba la sensación de que hacía falta apretar atrás dos veces.
  const destino = (e.state && e.state.pantalla) || 'inicio';
  if (destino !== currentScreen) {
    currentScreen = destino;
    resetearSubvistas();
    renderApp();
  }
});
