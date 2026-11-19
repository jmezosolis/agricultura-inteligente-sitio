// =====================================================================
// Sesión real contra Supabase Auth — reemplaza a setSession()/getSession()
// de shared/data.js, que hasta ahora vivían en localStorage propio.
//
// onAuthStateChange() se dispara solo, siempre, apenas se suscribe (una
// vez, con la sesión que ya hubiera — supabase-js la guarda en su propio
// localStorage y la recupera sin pedirle nada al usuario) y de nuevo cada
// vez que alguien hace signIn/signUp/signOut en cualquier parte de la app.
// El resultado se cachea acá en _sesionCache para que mockApi.sesionActual()
// pueda seguir siendo SÍNCRONA — todo el resto del código (bindEvents,
// renderApp, requireSesion/requireRol) ya asume que leerla no espera nada,
// así que nunca se llama a supabaseClient.auth.getSession() directo desde
// otro lado, siempre a través de esta caché.
//
// El primer renderApp() de cada app YA NO se llama solo al final de
// app.js/view-generic.js — se dispara desde acá, la primera vez que este
// listener resuelve el estado inicial. Así nunca hay un parpadeo mostrando
// "sin sesión" antes de confirmar que en realidad sí la hay.
// =====================================================================

let _sesionCache = undefined; // undefined = todavía no se sabe; null = sin sesión; objeto = con sesión

// Municipios de la ADMINISTRACIÓN de quien tiene sesión — reemplaza al
// array fijo MUNICIPIOS_RESPALDO (que ahora solo queda como fallback, ver
// municipiosDisponibles() en shared/ui-common.js) desde que cada
// instalación tiene su propia lista en la tabla "asociaciones" (Fase 2 del
// multi-tenant). Se resuelve una sola vez por sesión, junto con el resto
// del perfil, no en cada render de un formulario.
let _municipiosCache = null;
// Estado de la ADMINISTRACIÓN de quien tiene sesión — reemplaza al
// "Chiapas" que antes venía escrito a mano en la búsqueda de coordenadas
// del mapa (coordenadasMunicipio(), shared/view-generic.js). Se resuelve
// junto con _municipiosCache, mismo motivo.
let _estadoCache = null;

// onAuthStateChange puede disparar su primer evento (la sesión ya
// guardada, si había) ANTES de que termine de cargar app.js/view-generic.js
// más abajo — en ese momento "renderApp" todavía no existe como función,
// así que llamarla ahí adentro se perdía en silencio y la app quedaba en
// blanco. esperarSesionInicial() le da a cada app.js/view-generic.js una
// promesa a la que engancharse AL FINAL del archivo (cuando renderApp ya
// existe seguro) para el primer render, sin depender de en qué orden
// terminan de correr las cosas.
let _sesionListo = false;
let _resolversEsperandoSesion = [];
function esperarSesionInicial(){
  if (_sesionListo) return Promise.resolve();
  return new Promise((resolve) => _resolversEsperandoSesion.push(resolve));
}

// Último perfil confirmado, guardado en localStorage (no alcanza con la
// memoria: esto tiene que sobrevivir a cerrar y reabrir la app). Es lo que
// permite que, con el token de sesión todavía válido pero sin poder
// llegar al servidor, la app siga sabiendo quién sos y con qué rol —
// en vez de tratarte como "sin sesión" y mandarte al login por una
// consulta que no tuvo tiempo de contestar.
const PERFIL_CACHE_KEY = 'ganadoRegistroUltimoPerfil';
function _guardarPerfilCache(userId, perfil){
  try { localStorage.setItem(PERFIL_CACHE_KEY, JSON.stringify({ userId, perfil, t: Date.now() })); } catch (err) { /* no crítico */ }
}
function _leerPerfilCache(userId){
  try {
    const guardado = JSON.parse(localStorage.getItem(PERFIL_CACHE_KEY) || 'null');
    return (guardado && guardado.userId === userId) ? guardado.perfil : null;
  } catch (err) { return null; }
}

async function _resolverSesion(session){
  if (!session) { _sesionCache = null; _municipiosCache = null; _estadoCache = null; return; }

  // Antes de tocar nada más — si este dispositivo tiene cacheados datos
  // offline de OTRA cuenta (cambio de usuario, o una cuenta de prueba
  // borrada y recreada con otro id, ver purgarCacheOfflineSiCambioDeUsuario()
  // en shared/data.js), se tiran enteros antes de que cualquier pantalla
  // llegue a leerlos.
  if (typeof purgarCacheOfflineSiCambioDeUsuario === 'function') {
    // En segundo plano: la limpieza puede tardar varios segundos si la base
    // offline está bloqueada, y no debe retrasar ni bloquear el inicio de sesión.
    if (typeof purgarCacheOfflineSiCambioDeUsuario === 'function') {
      purgarCacheOfflineSiCambioDeUsuario(session.user.id).catch(() => { /* no crítico */ });
    }
  }

  // Perfil + asociación en UNA sola consulta (PostgREST puede traer la
  // tabla relacionada por la foreign key sin round-trip aparte: antes esto
  // eran 2 consultas seguidas — perfil, después asociación — en cada carga
  // de la app, la más frecuente de todo el sistema. Con conexión de campo
  // (celular, señal débil) cada round-trip de más se siente. _conTimeout()
  // (shared/data.js) corta la espera sola a los pocos segundos en vez de
  // colgarse esperando lo que el navegador tarde en decidir que no hay
  // conexión — sin eso, "confirmar la sesión" (lo más frecuente de toda
  // la app) se sentía lentísimo con señal mala.
  let perfil, error;
  try {
    ({ data: perfil, error } = await _conTimeout(supabaseClient
      .from('perfiles')
      .select('id, nombre, rol, activo, asociacion_id, plan_estado, plan_tipo, fecha_proximo_pago, suscripcion_cancelada, rancho_actual_id, asociaciones(municipios, estado)')
      .eq('id', session.user.id)
      .single()));
  } catch (err) {
    // El fetch ni siquiera contestó (timeout, o sin conexión real) — el
    // token de auth sigue siendo válido, así que NO es lo mismo que "no
    // hay sesión": se conserva la sesión que ya estaba confirmada para este
    // mismo usuario, y si no había ninguna, el último perfil guardado.
    if (_sesionCache && _sesionCache.id && _sesionCache.email === session.user.email) return;
    const cache = _leerPerfilCache(session.user.id);
    if (cache) {
      _sesionCache = {
        id: cache.id, nombre: cache.nombre, rol: cache.rol, email: session.user.email,
        plan_estado: cache.plan_estado, plan_tipo: cache.plan_tipo, fecha_proximo_pago: cache.fecha_proximo_pago,
        suscripcion_cancelada: cache.suscripcion_cancelada, rancho_actual_id: cache.rancho_actual_id,
      };
      _municipiosCache = cache.asociaciones ? cache.asociaciones.municipios : null;
      _estadoCache = cache.asociaciones ? cache.asociaciones.estado : null;
      return;
    }
    // Primera vez que se ve a este usuario y no hay forma de confirmarlo
    // (recién instalado, cero conexión) — acá sí no queda otra que tratarlo
    // como sin sesión todavía.
    _sesionCache = null;
    return;
  }

  if (error || !perfil) {
    // PGRST116 = la consulta no encontró la fila: el perfil de verdad no existe
    // (por ejemplo, en el instante de un signUp() recién confirmado, antes de
    // que handle_new_user() cree la fila). Cualquier otro error es transitorio
    // (red, servidor ocupado): no se cierra la sesión por eso.
    const perfilNoExiste = error && error.code === 'PGRST116';
    if (!perfilNoExiste && _sesionCache && _sesionCache.email === session.user.email) return;
    if (!perfilNoExiste) {
      const cache = _leerPerfilCache(session.user.id);
      if (cache) {
        _sesionCache = {
          id: cache.id, nombre: cache.nombre, rol: cache.rol, email: session.user.email,
          plan_estado: cache.plan_estado, plan_tipo: cache.plan_tipo, fecha_proximo_pago: cache.fecha_proximo_pago,
          suscripcion_cancelada: cache.suscripcion_cancelada, rancho_actual_id: cache.rancho_actual_id,
        };
        _municipiosCache = cache.asociaciones ? cache.asociaciones.municipios : null;
        _estadoCache = cache.asociaciones ? cache.asociaciones.estado : null;
        return;
      }
    }
    _sesionCache = null;
    return;
  }

  if (perfil.activo === false) {
    await supabaseClient.auth.signOut();
    _sesionCache = null;
    if (typeof toast === 'function') toast('Esta cuenta está desactivada', '⚠️');
    return;
  }

  _sesionCache = {
    id: perfil.id, nombre: perfil.nombre, rol: perfil.rol, email: session.user.email,
    plan_estado: perfil.plan_estado, plan_tipo: perfil.plan_tipo, fecha_proximo_pago: perfil.fecha_proximo_pago,
    suscripcion_cancelada: perfil.suscripcion_cancelada, rancho_actual_id: perfil.rancho_actual_id,
  };
  _guardarPerfilCache(session.user.id, perfil);

  // Si la embebida falla o viene vacía (no debería, pero por las dudas), el
  // fallback MUNICIPIOS_RESPALDO en ui-common.js cubre el selector — no es
  // algo crítico para poder entrar a la app.
  _municipiosCache = perfil.asociaciones ? perfil.asociaciones.municipios : null;
  _estadoCache = perfil.asociaciones ? perfil.asociaciones.estado : null;
}

// Lo usa selectMunicipios() en shared/ui-common.js.
function municipiosDeLaSesion(){ return _municipiosCache; }
// Lo usa coordenadasMunicipio() en shared/view-generic.js (geocodificación
// del mapa) — nunca hardcodeado a un estado fijo.
function estadoDeLaSesion(){ return _estadoCache; }

supabaseClient.auth.onAuthStateChange(async (_evento, session) => {
  await _resolverSesion(session);
  if (!_sesionListo) {
    _sesionListo = true;
    _resolversEsperandoSesion.forEach((resolver) => resolver());
    _resolversEsperandoSesion = [];
  }
  if (typeof renderApp === 'function') renderApp();
});

// El botón "atrás" del navegador no siempre recarga la página — si salió
// de acá con location.href (login -> redirige a administracion/ganadero,
// ver inicio.js) y no hubo handlers de "unload", el navegador puede
// guardarla en el bfcache y, al volver, restaurar tal cual quedó
// congelado el DOM en el instante justo antes de irse (acá: el formulario
// de acceso, porque renderApp() en ese caso no llega a pintar nada antes
// del redirect) en vez de cargarla de cero — como ningún script vuelve a
// correr, nadie se entera de que la sesión sigue activa y se ve una foto
// vieja. "pageshow" con persisted=true avisa justo ese caso; renderApp()
// ya tiene la sesión cacheada (_sesionCache), así que repintar alcanza,
// sin necesidad de recargar toda la página.
window.addEventListener('pageshow', (e) => {
  if (e.persisted && typeof renderApp === 'function') renderApp();
});
