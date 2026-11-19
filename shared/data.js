// =====================================================================
// Capa de datos compartida por las 2 apps (ganadero/, administracion/) —
// sin nada de DOM/presentación acá. Eso vive en shared/ui-common.js
// (piezas que comparten las dos) y shared/view-generic.js (interfaz de
// pestañas de administracion; ganadero tiene la suya propia en
// ganadero/app.js). Este archivo se carga primero en todas.
//
// "mockApi" de acá abajo ya llama a Supabase real (Auth + RPC/tablas
// directo, ver supabase/migrations/) — el nombre quedó de la simulación
// local original (localStorage) por la que arrancó el proyecto, no
// porque siga siendo mock. Cada método de acá corresponde 1 a 1 con una
// función RPC o una tabla del lado del servidor, mismos nombres de
// operación cuando aplica. La cola de sincronización (más abajo) es lo
// único que sigue tocando localStorage a propósito — ver el comentario
// ahí.
// =====================================================================

const DB_KEY = 'ganadoRegistroMockDB';
const SESSION_KEY = 'ganadoRegistroMockSession';

// Respaldo del selector de municipios — el municipio se ELIGE de una
// lista, no se escribe libre, para poder agrupar "usuarios por
// municipio" de verdad en el dashboard (si cada quien escribiera el
// nombre a su manera, un mismo municipio terminaría partido en 5
// variantes distintas). La lista REAL vive en asociaciones.municipios
// (cada instalación/administración carga la suya al darse de alta, ver
// supabase/NUEVO_CLIENTE.md) — esta constante es solo el RESPALDO que usa
// selectMunicipios() (shared/ui-common.js) mientras esa consulta todavía
// no resolvió, o si falla. Va vacía a propósito: esta copia del proyecto
// no viene con ningún estado/región precargado — completar acá los
// municipios reales de donde vaya a operar este cliente (o dejarla vacía
// y que el selector dependa 100% de asociaciones.municipios).
const MUNICIPIOS_RESPALDO = [];

function seedDB(){
  return {
    _seq: {},
    // Sin cuentas de arranque — igual que en Supabase real, nadie parte
    // con acceso de admin. El primer admin se crea con
    // mockApi.bootstrapPrimerAdmin() (solo funciona si no existe NINGÚN
    // admin todavía) y de ahí en más, ese admin da de alta al resto del
    // staff con mockApi.crearCuentaStaff().
    perfiles: [],
    lotes_chips: [],
    inventario_chips: [],
    animales: [],
    eventos_animal: [],
    auditoria: [],
  };
}

// Registra una acción sensible en la bitácora de auditoría — solo el
// admin puede leerla (mockApi.listarAuditoria()): no es una pestaña más,
// es la trazabilidad de quién hizo qué en el sistema mismo.
function registrarAuditoria(db, actorId, accion, detalle){
  const actor = db.perfiles.find(p => p.id === actorId);
  db.auditoria.push({
    id: nextId(db, 'auditoria'),
    accion,
    detalle,
    actor_id: actorId,
    actor_nombre: actor ? actor.nombre : '(desconocido)',
    created_at: new Date().toISOString(),
  });
}

// Caché en memoria del objeto ya parseado: sin esto, CADA función de
// mockApi (y hay vistas que llaman varias seguidas, como Resumen o
// Monitoreo) volvía a hacer JSON.parse() de TODA la base. El caso más
// exigente es el buscador rápido de Sanidad/Pesaje (bindLookupAnimalRapido
// en ganadero/app.js), que llama a loadDB() en cada tecla — y con el
// lector RFID/Bluetooth "tipeando" un chip completo en milisegundos, eso
// eran varios parses completos de golpe. Se invalida sola en dos casos:
// cuando esta misma pestaña guarda (saveDB) y cuando OTRA pestaña/app
// (mismo origen) cambia la base — ahí no hay forma de saberlo salvo el
// evento "storage", que el navegador dispara en las demás pestañas pero
// nunca en la que escribió.
let _dbCache = null;

// Cada TABLA en su propia clave de localStorage (en vez de un solo blob
// gigante bajo DB_KEY) — así anotar una sola vacuna no reescribe
// animales+eventos+auditoría+usuarios+etc. juntos como un solo JSON.
// _ultimoJsonPorTabla guarda el último JSON escrito de cada tabla: saveDB()
// compara contra esto y solo llama a localStorage.setItem() en las tablas
// que de verdad cambiaron. Totalmente transparente para el resto del
// código — loadDB()/saveDB(db) le siguen dando y devolviendo a cada
// función el mismo objeto "db" de siempre, con todas sus tablas adentro;
// nadie tiene que avisar qué parte tocó.
const TABLA_PREFIJO = DB_KEY + ':';
let _ultimoJsonPorTabla = {};

window.addEventListener('storage', (e) => {
  if (e.key === DB_KEY || (e.key && e.key.startsWith(TABLA_PREFIJO))) {
    _dbCache = null;
    _ultimoJsonPorTabla = {};
  }
});

function loadDB(){
  if (_dbCache) return _dbCache;

  let db;
  let necesitaGuardar = false;
  // Migración desde el formato viejo (todo en una sola clave DB_KEY): si
  // todavía existe, se reparte en claves por tabla más abajo (saveDB) y se
  // borra la vieja — pasa una sola vez por navegador.
  const viejo = localStorage.getItem(DB_KEY);
  if (viejo !== null) {
    db = JSON.parse(viejo);
    localStorage.removeItem(DB_KEY);
    necesitaGuardar = true;
  } else {
    const claves = Object.keys(localStorage).filter(k => k.startsWith(TABLA_PREFIJO));
    if (!claves.length) {
      db = seedDB();
      necesitaGuardar = true;
    } else {
      db = {};
      for (const k of claves) {
        const tabla = k.slice(TABLA_PREFIJO.length);
        const json = localStorage.getItem(k);
        db[tabla] = JSON.parse(json);
        // Ya está en disco tal cual — se precarga acá para que el primer
        // saveDB() de esta pestaña no la reescriba de nuevo sin necesidad.
        _ultimoJsonPorTabla[tabla] = json;
      }
    }
  }

  // Migración perezosa: una base guardada por una versión anterior de este
  // archivo puede no tener alguna tabla que se agregó (o sacó) después.
  // Sin este relleno, el primer .push()/.filter() sobre esa tabla revienta
  // con "Cannot read properties of undefined", en cualquier navegador que
  // ya hubiera usado la simulación antes de agregarla. Solo agrega las
  // claves que falten — nunca pisa datos ya guardados.
  const base = seedDB();
  for (const clave of Object.keys(base)) {
    if (!(clave in db)) { db[clave] = base[clave]; necesitaGuardar = true; }
  }

  if (necesitaGuardar) saveDB(db);
  _dbCache = db;
  return db;
}
function saveDB(db){
  for (const tabla of Object.keys(db)) {
    const json = JSON.stringify(db[tabla]);
    if (_ultimoJsonPorTabla[tabla] !== json) {
      localStorage.setItem(TABLA_PREFIJO + tabla, json);
      _ultimoJsonPorTabla[tabla] = json;
    }
  }
  _dbCache = db;
}

function nextId(db, tabla){ db._seq[tabla] = (db._seq[tabla] || 0) + 1; return db._seq[tabla]; }

// La sesión YA NO vive en localStorage propio — sale de Supabase Auth,
// cacheada en _sesionCache por shared/auth-supabase.js (que debe cargarse
// ANTES que este archivo; ver el orden de <script> en cada index.html).
// getSession() sigue siendo síncrona a propósito: todo el resto del
// código (requireSesion/requireRol, cada vista) asume que leer la sesión
// no espera nada.
function getSession(){ return (typeof _sesionCache !== 'undefined' && _sesionCache) || null; }

function requireSesion(){ const s = getSession(); if (!s) throw new Error('No autenticado'); return s; }
function requireRol(roles){ const s = requireSesion(); if (!roles.includes(s.rol)) throw new Error('No autorizado'); return s; }

const mockApi = {
  sesionActual(){ return getSession(); },
  async logout(){ await supabaseClient.auth.signOut(); },
  // Sigue limpiando la base LOCAL (animales, eventos, etc. — todavía
  // no migrada a Supabase, eso es la próxima etapa) y cierra la sesión de
  // Supabase de paso, para no quedar "logueado" con datos locales recién
  // borrados.
  async reiniciarSimulacion(){
    localStorage.removeItem(DB_KEY);
    Object.keys(localStorage).filter(k => k.startsWith(TABLA_PREFIJO)).forEach(k => localStorage.removeItem(k));
    _dbCache = null;
    _ultimoJsonPorTabla = {};
    await supabaseClient.auth.signOut();
  },

  // Autorregistro ABIERTO contra Supabase Auth real: cualquiera que tenga
  // o vaya a comprar un animal registrado puede crear su propia cuenta de
  // ganadero, sin que Administración tenga que autorizar nada antes. El rol
  // lo decide handle_new_user() del lado del servidor (ver
  // supabase/migrations/20260821090000_sin_arranque_en_frio.sql) — SIEMPRE
  // 'ganadero' acá (salvo que el email coincida con una invitación de
  // staff — ver invitarStaff()), nunca algo que mande el cliente. El
  // primer admin de un proyecto nuevo se otorga a mano, no por acá — ver
  // supabase/NUEVO_CLIENTE.md.
  //
  // Si el proyecto tiene "Confirm email" activado (Authentication →
  // Providers → Email, en el dashboard), signUp() NO deja una sesión lista
  // al toque — hay que confirmar el correo primero. Para que "Crear cuenta
  // y entrar" siga siendo instantáneo como hasta ahora, esa opción
  // conviene tenerla DESACTIVADA.
  async registrarGanadero({ email, password, nombre, rancho_o_empresa, telefono, municipio }){
    if (!email || !email.trim()) throw new Error('Falta el email');
    if (!password || password.length < 6) throw new Error('La contraseña necesita al menos 6 caracteres');
    if (!nombre || !nombre.trim()) throw new Error('Falta el nombre');
    const { data, error } = await supabaseClient.auth.signUp({
      email: email.trim(), password,
      options: { data: { nombre: nombre.trim(), rancho_o_empresa: rancho_o_empresa || '', telefono: telefono || '', municipio: municipio || '' } },
    });
    if (error) throw new Error(error.message);
    if (!data.session) {
      return { confirmacionPendiente: true };
    }
    return { confirmacionPendiente: false };
  },

  // Login con contraseña — Supabase Auth valida de verdad (hash, no texto
  // plano). onAuthStateChange (shared/auth-supabase.js) se entera solo y
  // arma la sesión — acá no hace falta guardar nada a mano.
  async loginConPassword(email, password){
    const { error } = await supabaseClient.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : error.message);
  },

  // Arranque del primer admin: es el mismo signUp() de siempre — quién se
  // vuelve admin lo decide handle_new_user() del lado del servidor (la
  // primera cuenta que exista en todo el sistema), no un campo que mande
  // el cliente. Ya no tiene ningún formulario público que la llame (se
  // sacó del login de Administración una vez que existió el primer admin real,
  // para no invitar a randoms a probarla sin motivo) — queda acá sin
  // usar por si algún día hiciera falta reconstruir el sistema desde
  // cero, no porque el bootstrap en frío del servidor pueda repetirse
  // (no puede: se cierra solo apenas existe un admin).
  async bootstrapPrimerAdmin({ email, password, nombre, rancho_o_empresa, telefono }){
    if (!email || !email.trim()) throw new Error('Falta el email');
    if (!password || password.length < 6) throw new Error('La contraseña necesita al menos 6 caracteres');
    if (!nombre || !nombre.trim()) throw new Error('Falta el nombre');
    const { data, error } = await supabaseClient.auth.signUp({
      email: email.trim(), password,
      options: { data: { nombre: nombre.trim(), rancho_o_empresa: rancho_o_empresa || '', telefono: telefono || '' } },
    });
    if (error) throw new Error(error.message);
    return { confirmacionPendiente: !data.session };
  },

  // Alta de otro admin — YA NO crea la cuenta directo con contraseña (eso
  // necesitaría la service_role key del lado del cliente, inseguro). En
  // vez de eso, deja anotada la invitación (email + rol) en el servidor:
  // cuando esa persona haga su propio supabase.auth.signUp() con ese
  // mismo email, handle_new_user() la reconoce y le asigna el rol de acá
  // — nadie más que la propia persona pone su contraseña. Se mantiene el
  // nombre "crearCuentaStaff" (no "invitarStaff") para no tener que tocar
  // todos los lugares del panel de Administración que ya lo llaman así —
  // el comportamiento cambió, el nombre no. Sin 'inspector' como opción:
  // ese rol ya no existe ni como valor del enum en la base (ver
  // 20260917120000_eliminar_rol_inspector.sql) — esto es nomás para no
  // ni siquiera intentarlo y mostrar un error más claro que el de Postgres.
  async crearCuentaStaff({ email, rol, nombre_sugerido, rancho_sugerido, telefono_sugerido, municipio_sugerido }){
    if (!email || !email.trim()) throw new Error('Falta el email');
    if (rol !== 'admin') throw new Error('Rol inválido');
    const { error } = await supabaseClient.rpc('invitar_staff', {
      p_email: email.trim(), p_rol: rol,
      p_nombre_sugerido: nombre_sugerido || null, p_rancho_sugerido: rancho_sugerido || null,
      p_telefono_sugerido: telefono_sugerido || null, p_municipio_sugerido: municipio_sugerido || null,
    });
    if (error) throw new Error(error.message);
  },

  // Lista quiénes están invitados y todavía no se registraron — para que
  // el admin vea a quién ya invitó mientras espera. (No existía en el
  // mockApi original: es nuevo, porque el flujo de invitación por email
  // tampoco existía antes.)
  async listarInvitacionesPendientes(){
    const { data, error } = await supabaseClient.rpc('listar_invitaciones_pendientes');
    if (error) throw new Error(error.message);
    return data || [];
  },

  // Cada quien edita su propio perfil (nombre, rancho/empresa, teléfono y
  // — solo si es ganadero — municipio). El rol NO se toca acá a propósito
  // — la función RPC actualizar_mi_perfil() ni siquiera acepta un rol.
  // onAuthStateChange no dispara solo por esto (no cambia la sesión de
  // Auth, solo la fila de "perfiles"), así que se actualiza _sesionCache a
  // mano para que el nombre en el saludo quede al día sin pedir recargar.
  async actualizarMiPerfil({ nombre, rancho_o_empresa, telefono, municipio }){
    if (!nombre || !nombre.trim()) throw new Error('Falta el nombre');
    const { data, error } = await supabaseClient.rpc('actualizar_mi_perfil', {
      p_nombre: nombre.trim(), p_rancho_o_empresa: rancho_o_empresa || '',
      p_telefono: telefono || '', p_municipio: municipio || null,
    });
    if (error) throw new Error(error.message);
    if (_sesionCache) _sesionCache = { ..._sesionCache, nombre: data.nombre, rol: data.rol };
    return data;
  },

  // Da de alta (o renueva) la suscripción mensual con Mercado Pago —
  // llama a la Edge Function "crear-suscripcion" (supabase/functions/),
  // la única pieza que tiene el Access Token de Mercado Pago. Devuelve el
  // link de pago (init_point); quien llama es responsable de mandar ahí
  // al ganadero (ver btnSuscribirme en ganadero/app.js). plan_estado NO
  // cambia acá — pasa a "al_dia" solo, después, cuando Mercado Pago le
  // avise a webhook-mercadopago que el primer pago quedó autorizado.
  async crearSuscripcionMercadoPago(plan){
    if (plan !== 'mensual' && plan !== 'anual') throw new Error('Elegí un plan: mensual o anual');
    // Mercado Pago rechaza el back_url si no es https ("The back_url
    // contains a disallowed URL scheme") — location.origin a veces NO lo
    // es (abriendo el archivo local directo, "file://", da origin "null";
    // o un instante antes de que el navegador siga el 301 a https).
    // Se arma a mano en vez de confiar en location.origin tal cual, y si
    // ni siquiera hay un host real (el caso "file://"), se avisa claro en
    // vez de mandarle basura a Mercado Pago y mostrar su error en inglés.
    if (!location.host) throw new Error('Para suscribirte necesitás entrar desde la app publicada (con https), no desde un archivo local.');
    const { data, error } = await supabaseClient.functions.invoke('crear-suscripcion', {
      body: { back_url: `https://${location.host}/ganadero/index.html`, plan },
    });
    if (error) {
      // supabase-js no siempre trae el mensaje de nuestra función en
      // error.message (queda en el body de la respuesta) — se intenta
      // leer ahí primero para no mostrar un genérico "Edge Function
      // returned a non-2xx status code".
      const detalle = await error.context?.json?.().catch(() => null);
      throw new Error(detalle?.error || error.message);
    }
    if (!data?.init_point) throw new Error('Mercado Pago no devolvió un link de pago');
    return data.init_point;
  },

  // Cancela el cobro recurrente en Mercado Pago — NO corta el acceso al
  // instante, sigue vigente hasta fecha_proximo_pago (ver el comentario
  // grande en supabase/migrations/20260928090000_cancelacion_suscripcion.sql).
  // Actualiza _sesionCache al toque, mismo criterio que
  // crearRancho()/canjearCodigoPromocional(), para que "Mi plan" refleje
  // el cambio sin esperar a la próxima confirmación de sesión.
  async cancelarSuscripcionMercadoPago(){
    const { error } = await supabaseClient.functions.invoke('cancelar-suscripcion', { body: {} });
    if (error) {
      const detalle = await error.context?.json?.().catch(() => null);
      throw new Error(detalle?.error || error.message);
    }
    if (_sesionCache) _sesionCache = { ..._sesionCache, suscripcion_cancelada: true };
  },

  // Código de promoción (3/6/9 meses gratis, etc.) — un canje por cuenta
  // para siempre (lo valida el servidor). Actualiza _sesionCache al
  // toque con la fecha nueva, mismo criterio que crearRancho()/
  // editarRancho(), para que "Mi plan" refleje el cambio sin esperar a
  // la próxima confirmación de sesión.
  async canjearCodigoPromocional(codigo){
    const { data, error } = await supabaseClient.rpc('canjear_codigo_promocional', { p_codigo: codigo });
    if (error) throw new Error(error.message);
    if (_sesionCache && data?.fecha_proximo_pago) {
      _sesionCache = { ..._sesionCache, plan_estado: 'al_dia', fecha_proximo_pago: data.fecha_proximo_pago };
    }
    return data;
  },

  // =====================================================================
  // Calendario sanitario — recordatorios de vacunación/desparasitación
  // programada (ver supabase/migrations/20260925090000_calendario_sanitario.sql).
  // Es un AVISO ("tocaría aplicar X"), no un registro de que ya se
  // aplicó — eso lo sigue haciendo Sanidad, como siempre. De escritorio,
  // no de corral: requiere conexión, mismo criterio que crear/editar un
  // rancho o un lote.
  // =====================================================================
  async crearRecordatorioSanitario({ nombre, proximaFecha, frecuenciaMeses, notas }){
    const { data, error } = await supabaseClient.rpc('crear_recordatorio_sanitario', {
      p_nombre: nombre, p_proxima_fecha: proximaFecha,
      p_frecuencia_meses: frecuenciaMeses || null, p_notas: notas || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },
  async listarRecordatoriosSanitarios(){
    const { data, error } = await supabaseClient.rpc('listar_recordatorios_sanitarios');
    if (error) throw new Error(error.message);
    return data;
  },
  async marcarRecordatorioHecho(id){
    const { error } = await supabaseClient.rpc('marcar_recordatorio_hecho', { p_id: id });
    if (error) throw new Error(error.message);
  },
  async eliminarRecordatorioSanitario(id){
    const { error } = await supabaseClient.rpc('eliminar_recordatorio_sanitario', { p_id: id });
    if (error) throw new Error(error.message);
  },

  // =====================================================================
  // Notificaciones push (Web Push/VAPID) — ver
  // supabase/migrations/20260926090000_notificaciones_push.sql. La
  // suscripción del navegador en sí (Notification.requestPermission() +
  // pushManager.subscribe()) vive en shared/push.js, no acá — data.js
  // solo guarda/borra/consulta lo que ya se generó.
  // =====================================================================
  async guardarSuscripcionPush(sub){
    const { error } = await supabaseClient.rpc('guardar_suscripcion_push', {
      p_endpoint: sub.endpoint, p_p256dh: sub.keys.p256dh, p_auth: sub.keys.auth,
      p_user_agent: navigator.userAgent,
    });
    if (error) throw new Error(error.message);
  },
  async eliminarSuscripcionPush(endpoint){
    const { error } = await supabaseClient.rpc('eliminar_suscripcion_push', { p_endpoint: endpoint });
    if (error) throw new Error(error.message);
  },
  async tengoNotificacionesActivas(){
    const { data, error } = await supabaseClient.rpc('tengo_notificaciones_activas');
    if (error) throw new Error(error.message);
    return !!data;
  },
  // =====================================================================
  // Ranchos: separan la información de cada finca dentro de una misma
  // cuenta (ver supabase/migrations/20260917150000_ranchos.sql) — pensado
  // para el veterinario/administrador que atiende más de un predio. "Un
  // rancho activo a la vez" (session.rancho_actual_id, no una lista
  // combinada): cambiar de rancho actualiza _sesionCache a mano (mismo
  // criterio que actualizarMiPerfil()) para que el resto de la app
  // (misAnimales/misLotes, ambos filtran por rancho_actual_id) lo vea
  // sin recargar la página.
  // =====================================================================
  // Offline-safe en lectura (mismo criterio que misLotes()) — viewShell()
  // (ganadero/app.js) llama esto en CADA cambio de pantalla para mostrar
  // el nombre del rancho actual arriba de todo, así que si esto tirara
  // sin caché de por medio, quedarse sin señal rompía la navegación
  // ENTERA de la app, no solo el selector de rancho (bug real,
  // encontrado 2026-09-18).
  async misRanchos(){
    const user = requireSesion();
    const enCache = await idbTodo('cache_ranchos');
    const pedir = () => _conTimeout(supabaseClient.from('ranchos').select('*')
      .eq('propietario_id', user.id).eq('activo', true).order('created_at', { ascending: true }));

    if (enCache.length > 0) {
      pedir().then(({ data, error }) => { if (!error) idbUpsertTodos('cache_ranchos', data); }).catch(() => {});
      return enCache;
    }
    try {
      const { data, error } = await pedir();
      if (error) throw new Error(error.message);
      await idbUpsertTodos('cache_ranchos', data);
      return data;
    } catch (err) {
      if (!_pareceErrorDeConexion(err)) throw err;
      return enCache; // vacía — no hay nada mejor que mostrar todavía
    }
  },
  // Crear/cambiar/archivar/editar un rancho SÍ necesitan conexión (igual
  // que crear un lote de manejo) — es una acción de escritorio/oficina,
  // no algo que se necesite sin señal en medio del corral.
  async crearRancho({ nombre, ubicacion, municipio }){
    if (!nombre || !nombre.trim()) throw new Error('Falta el nombre del rancho');
    const { data, error } = await supabaseClient.rpc('crear_rancho', {
      p_nombre: nombre.trim(), p_ubicacion: ubicacion || null, p_municipio: municipio || null,
    });
    if (error) throw new Error(error.message);
    if (_sesionCache) _sesionCache = { ..._sesionCache, rancho_actual_id: data };
    // Para que el rancho recién creado ya aparezca en el selector sin
    // esperar el refresco en segundo plano de la próxima misRanchos().
    await idbUpsertUno('cache_ranchos', {
      id: data, nombre: nombre.trim(), ubicacion: ubicacion || null, municipio: municipio || null,
      activo: true, propietario_id: requireSesion().id, created_at: new Date().toISOString(),
    });
    return data; // id del rancho nuevo, ya queda como "actual"
  },
  async cambiarRanchoActual(ranchoId){
    const { error } = await supabaseClient.rpc('cambiar_rancho_actual', { p_rancho_id: ranchoId });
    if (error) throw new Error(error.message);
    if (_sesionCache) _sesionCache = { ..._sesionCache, rancho_actual_id: ranchoId };
  },
  async editarRancho(ranchoId, { nombre, ubicacion, municipio }){
    if (!nombre || !nombre.trim()) throw new Error('Falta el nombre del rancho');
    const { error } = await supabaseClient.rpc('editar_rancho', {
      p_rancho_id: ranchoId, p_nombre: nombre.trim(), p_ubicacion: ubicacion || null, p_municipio: municipio || null,
    });
    if (error) throw new Error(error.message);
  },
  async archivarRancho(ranchoId){
    const { error } = await supabaseClient.rpc('archivar_rancho', { p_rancho_id: ranchoId });
    if (error) throw new Error(error.message);
    // El servidor puede haber pasado el "actual" a otro rancho si se
    // archivó justo el que se estaba viendo — se refresca del todo en vez
    // de adivinar cuál quedó, es solo esta una llamada RPC más.
    const { data } = await supabaseClient.from('perfiles').select('rancho_actual_id').eq('id', requireSesion().id).single();
    if (_sesionCache && data) _sesionCache = { ..._sesionCache, rancho_actual_id: data.rancho_actual_id };
  },
  // A diferencia de archivarRancho() (reversible, deja el rancho y sus
  // animales/lotes intactos, solo lo saca de la lista), esto borra la
  // fila entera — el servidor (eliminar_rancho()) lo bloquea si el
  // rancho todavía tiene algún animal o lote adentro, así que acá no
  // hace falta duplicar esa validación, solo mostrar el error tal cual
  // vuelve.
  async eliminarRancho(ranchoId){
    const { error } = await supabaseClient.rpc('eliminar_rancho', { p_rancho_id: ranchoId });
    if (error) throw new Error(error.message);
    await idbBorrarUno('cache_ranchos', ranchoId);
    const { data } = await supabaseClient.from('perfiles').select('rancho_actual_id').eq('id', requireSesion().id).single();
    if (_sesionCache && data) _sesionCache = { ..._sesionCache, rancho_actual_id: data.rancho_actual_id };
  },

  // Registra un animal en un solo paso: siempre le asigna un chip del
  // inventario (ver supabase/migrations/20260820090000_solo_chip_y_numero_interno.sql)
  // — la función más sensible: solo acá un chip pasa de "en_stock" a
  // "asignado" y nace un animal — usa "FOR UPDATE SKIP LOCKED" para que
  // dos registros simultáneos nunca tomen el mismo chip.
  // "ganaderoId" es opcional: solo un admin puede pasarlo (registrar a
  // nombre de otro); si no se pasa, el animal queda a nombre de quien
  // llama.
  //
  // Offline-safe: si no hay conexión, se puede registrar con CUALQUIER
  // chip_uid (venga de un escaneo o tipeado a mano) y/o N° interno — ya
  // no hace falta que el chip esté en la lista de "reservados" que el
  // admin le haya bajado a este celular con señal (esa lista sigue
  // existiendo, ver mockApi.misChipsReservados(), pero pasó a ser solo
  // informativa: si el chip está ahí se avisa distinto en la pantalla,
  // no condiciona si se puede guardar). Mismo criterio que ya usaba el
  // registro CON conexión para un chip que no coincide con ningún
  // "en_stock" oficial: se guarda igual, como referencia propia (ver
  // registrar_animal_directo(), supabase/migrations/20260917140000_chip_opcional_temporal.sql)
  // — acá se aplica ese mismo criterio también sin señal. Al sincronizar,
  // si resulta ser un chip oficial todavía libre se asigna así solo; si
  // no, sigue quedando como referencia propia, nunca falla por eso.
  async registrarAnimalDirecto(datosAnimal, ganaderoId = null){
    return _offlineSafe('registrarAnimalDirecto', [datosAnimal, ganaderoId], _onlineRegistrarAnimalDirecto, {
      puedeAplicarOffline: () => !ganaderoId && datosAnimal && (datosAnimal.numero_interno || datosAnimal.chip_uid),
      aplicarLocal: async () => {
        const user = requireSesion();
        const chipUid = datosAnimal.chip_uid ? datosAnimal.chip_uid.trim() : null;
        if (chipUid) {
          // Si coincidía con uno reservado, se descuenta del pool local
          // — solo prolijidad para que el contador no quede inflado, ya
          // no es un requisito para poder registrar.
          const reservados = await idbTodo('cache_chips_reservados');
          if (reservados.some((c) => c.chip_uid === chipUid)) await idbBorrarUno('cache_chips_reservados', chipUid);
        }
        const idLocal = 'local-' + Date.now();
        const animalLocal = {
          id: idLocal, chip_uid: chipUid, numero_interno: datosAnimal.numero_interno || null,
          raza: datosAnimal.raza, color: datosAnimal.color || null, marca_hierro: datosAnimal.marca_hierro || null,
          sexo: datosAnimal.sexo, fecha_nacimiento: datosAnimal.fecha_nacimiento || null,
          peso_nacimiento_kg: datosAnimal.peso_nacimiento_kg || null, peso_actual_kg: datosAnimal.peso_actual_kg || null,
          peso_actual_fecha: datosAnimal.peso_actual_fecha || null, notas: datosAnimal.notas || null,
          propietario_actual_id: user.id, estado: 'vivo', ubicacion_actual: datosAnimal.ubicacion || null,
          // rancho_id acá es lo que hace que este animal ya aparezca en
          // "Mis animales" sin esperar a sincronizar de verdad —
          // misAnimales() filtra por rancho actual (ver
          // supabase/migrations/20260917150000_ranchos.sql), y sin este
          // campo el animal offline quedaba invisible igual que el bug
          // que ya se corrigió del lado online.
          lote_id: null, rancho_id: user.rancho_actual_id, created_at: new Date().toISOString(), _pendienteSync: true,
        };
        await idbUpsertUno('cache_animales', animalLocal);
        return {
          resultado: { ok: true, animal_id: idLocal, chip_uid: chipUid, numero_interno: animalLocal.numero_interno, _pendienteSync: true },
          limpiarAlSincronizar: [{ tabla: 'cache_animales', clave: idLocal }],
          idLocalAnimal: idLocal,
        };
      },
    });
  },

  // Solo admin: cargar chips nuevos es una decisión de compra/presupuesto.
  async registrarLoteChips(proveedor, numeroLote, precioOficial, documentoUrl, chipUids){
    const { data, error } = await supabaseClient.rpc('registrar_lote_chips', {
      p_proveedor: proveedor, p_numero_lote: numeroLote, p_precio_oficial: precioOficial,
      p_documento_url: documentoUrl, p_chip_uids: chipUids.map(u => u.trim()),
    });
    if (error) throw new Error(error.message);
    return data;
  },

  // Pública a propósito — sin requireSesion(). Cualquiera debe poder
  // verificar un chip antes de aceptarlo, sin necesitar cuenta (la función
  // RPC está otorgada a "anon" además de "authenticated").
  async consultarChip(chipUid){
    const { data, error } = await _conTimeout(supabaseClient.rpc('consultar_chip', { p_chip_uid: chipUid.trim() }));
    if (error) throw new Error(error.message);
    return data;
  },

  // El pool de chips que el admin le reservó a ESTE ganadero (ver
  // supabase/migrations/20260914100000_chips_reservados_offline.sql) —
  // se refresca solo mientras hay señal (sincronizarChipsReservados() más
  // abajo) para poder identificar un animal nuevo sin conexión más tarde.
  async misChipsReservados(){
    try {
      const { data, error } = await _conTimeout(supabaseClient.rpc('mis_chips_reservados'));
      if (error) throw new Error(error.message);
      await idbUpsertTodos('cache_chips_reservados', data);
      return data;
    } catch (err) {
      if (!_pareceErrorDeConexion(err)) throw err;
      return await idbTodo('cache_chips_reservados');
    }
  },

  // Un pesaje más en la línea de tiempo del animal — no pisa el anterior,
  // así se puede ver la curva de crecimiento. Además del peso, admite
  // condición corporal (escala 1-5 estándar para bovinos: 1 = muy flaco/
  // emaciado, 3 = óptimo, 5 = muy gordo — la usan veterinarios y
  // asociaciones de criadores en todo el mundo, no es una invención de
  // esta app) y altura a la cruz — entre los tres arman una foto más
  // completa del estado del animal que el peso solo. Exclusivo del
  // ganadero dueño — la función RPC revalida eso también, del lado del
  // servidor (nunca hay que confiar solo en lo que valida el cliente).
  // Offline-safe: el animal ya está en la caché local (se vio antes con
  // señal, o nació de un registro offline propio) — no hace falta
  // preguntarle nada al servidor para anotar un pesaje, así que esto
  // siempre se puede aplicar de una, con o sin conexión.
  async registrarPesaje(animalId, datos){
    const peso = parseFloat(datos.peso_kg);
    if (!peso || peso <= 0) throw new Error('El peso tiene que ser mayor a cero');
    let condicion = null;
    if (datos.condicion_corporal) {
      condicion = parseInt(datos.condicion_corporal, 10);
      if (condicion < 1 || condicion > 5) throw new Error('La condición corporal va de 1 a 5');
    }
    const datosNormalizados = { ...datos, peso_kg: peso, condicion_corporal: condicion };
    return _offlineSafe('registrarPesaje', [animalId, datosNormalizados], _onlineRegistrarPesaje, {
      aplicarLocal: async () => {
        const idEvt = await _aplicarEventoLocal(animalId, 'pesaje', datosNormalizados, {
          peso_kg: peso, condicion_corporal: condicion,
          altura_cm: datosNormalizados.altura_cm ? parseFloat(datosNormalizados.altura_cm) : null,
        });
        await _actualizarCampoAnimalLocal(animalId, { peso_actual_kg: peso, peso_actual_fecha: datosNormalizados.fecha || new Date().toISOString().slice(0, 10) });
        return { resultado: { ok: true, _pendienteSync: true }, limpiarAlSincronizar: [{ tabla: 'cache_eventos', clave: idEvt }] };
      },
    });
  },

  // Vacuna, desparasitación, tratamiento, revisión veterinaria — con los
  // campos que hacen falta para trazabilidad real: "producto" +
  // "lote_producto" identifican EXACTAMENTE qué se aplicó (rastreo rápido
  // si un lote resulta defectuoso), y "dias_retiro" calcula "retiro_hasta"
  // del lado del servidor (ver registrar_sanidad() en
  // supabase/migrations/20260807120200_funciones.sql) — hasta qué fecha el
  // animal no debería venderse ni sacrificarse. Mismo criterio de dueño
  // que registrarPesaje().
  async registrarSanidad(animalId, datos){
    if (!datos.tipo || !datos.tipo.trim()) throw new Error('Falta el tipo de intervención');
    return _offlineSafe('registrarSanidad', [animalId, datos], _onlineRegistrarSanidad, {
      aplicarLocal: async () => {
        const diasRetiro = datos.dias_retiro ? parseInt(datos.dias_retiro, 10) : null;
        const fecha = datos.fecha || new Date().toISOString().slice(0, 10);
        const idEvt = await _aplicarEventoLocal(animalId, 'sanidad', datos, {
          descripcion: datos.tipo.trim(), producto: datos.producto || null, lote_producto: datos.lote_producto || null,
          dosis: datos.dosis || null, veterinario: datos.veterinario || null, dias_retiro: diasRetiro,
          retiro_hasta: diasRetiro ? new Date(new Date(fecha).getTime() + diasRetiro * 86400000).toISOString().slice(0, 10) : null,
        });
        return { resultado: { ok: true, _pendienteSync: true }, limpiarAlSincronizar: [{ tabla: 'cache_eventos', clave: idEvt }] };
      },
    });
  },

  // Eventos de reproducción (monta, inseminación, diagnóstico de
  // gestación, parto, aborto, destete...) — mismo patrón que sanidad,
  // más 4 columnas propias (resultado, fecha probable de parto, sexo y
  // peso de la cría), todas opcionales (ver
  // supabase/migrations/20260819100000_sin_solicitudes_mas_reproduccion_y_reportes.sql).
  async registrarReproduccion(animalId, datos){
    if (!datos.tipo || !datos.tipo.trim()) throw new Error('Falta el tipo de evento reproductivo');
    return _offlineSafe('registrarReproduccion', [animalId, datos], _onlineRegistrarReproduccion, {
      aplicarLocal: async () => {
        const idEvt = await _aplicarEventoLocal(animalId, 'reproduccion', datos, {
          descripcion: datos.tipo.trim(), producto: datos.semental || null, veterinario: datos.veterinario || null,
          resultado: datos.resultado || null, fecha_probable_parto: datos.fecha_probable_parto || null,
          sexo_cria: datos.sexo_cria || null, peso_cria_kg: datos.peso_cria_kg || null,
        });
        return { resultado: { ok: true, _pendienteSync: true }, limpiarAlSincronizar: [{ tabla: 'cache_eventos', clave: idEvt }] };
      },
    });
  },

  // Producción de leche — mismo patrón exacto que registrarPesaje() (un
  // evento más en la línea de tiempo del animal, no pisa el anterior) y
  // mismo criterio de offline-safe: el animal ya está en la caché local,
  // así que anotar una ordeña no necesita preguntarle nada al servidor
  // primero.
  async registrarProduccionLeche(animalId, datos){
    const litros = parseFloat(datos.litros);
    if (!litros || litros <= 0) throw new Error('Los litros tienen que ser mayor a cero');
    const datosNormalizados = { ...datos, litros };
    return _offlineSafe('registrarProduccionLeche', [animalId, datosNormalizados], _onlineRegistrarProduccionLeche, {
      aplicarLocal: async () => {
        const idEvt = await _aplicarEventoLocal(animalId, 'produccion_leche', datosNormalizados, {
          litros_leche: litros, descripcion: datosNormalizados.turno ? datosNormalizados.turno.trim() : null,
        });
        return { resultado: { ok: true, _pendienteSync: true }, limpiarAlSincronizar: [{ tabla: 'cache_eventos', clave: idEvt }] };
      },
    });
  },

  // Arma las filas para el botón "Exportar todo (Excel)" del Resumen (ver
  // exportarRespaldoExcel() en shared/view-generic.js, que usa SheetJS)
  // — encabezados ya en español, listos para volcarse tal cual a una
  // hoja por tabla. Solo admin.
  async datosRespaldoCompleto(){
    const { data, error } = await supabaseClient.rpc('datos_respaldo_completo');
    if (error) throw new Error(error.message);
    return data;
  },

  // Mismo patrón que datosRespaldoCompleto(), pero para que cada ganadero
  // exporte SU PROPIO rebaño (ver botón "⬇️ Exportar Excel" en
  // viewInicio(), ganadero/app.js). Por default solo el rancho actual —
  // todosLosRanchos=true saca el respaldo de la cuenta entera, como
  // antes de que existieran ranchos. Devuelve {rancho_nombre, hojas} —
  // "hojas" es lo que antes era la respuesta entera (ver
  // 20260917160000_editar_rancho_y_excel_por_rancho.sql).
  async miRespaldoExcel(todosLosRanchos = false){
    const { data, error } = await supabaseClient.rpc('mi_respaldo_excel', { p_todos_los_ranchos: todosLosRanchos });
    if (error) throw new Error(error.message);
    return data;
  },
  // Mismo formato que miRespaldoExcel() (mismas 7 hojas), recortado a un
  // lote puntual en vez del rancho/toda la cuenta — ver
  // supabase/migrations/20260920090000_excel_por_lote.sql. Devuelve
  // {lote_nombre, hojas}.
  async miRespaldoExcelLote(loteId){
    const { data, error } = await supabaseClient.rpc('mi_respaldo_excel_lote', { p_lote_id: loteId });
    if (error) throw new Error(error.message);
    return data;
  },

  // Búsqueda "de campo" para un técnico: por chip (lo típico, escaneado
  // con el lector) o N° interno, sin límite al propio rebaño — a
  // diferencia de consultarChip() (pública, sin sesión, oculta a
  // propósito el historial y el dueño) esta exige ser staff porque
  // devuelve datos privados del ganadero y la línea de tiempo completa.
  async buscarAnimalMonitoreo(query){
    if (!query || !query.trim()) throw new Error('Escribí (o escaneá) un chip, número de arete o N° interno');
    const { data, error } = await supabaseClient.rpc('buscar_animal_monitoreo', { p_query: query });
    if (error) throw new Error(error.message);
    return data;
  },

  // Reemplaza al viejo "Reportar" (robo/chip sospechoso/cobro irregular)
  // — acá solo se da de baja un animal, sin trámite de reporte/
  // resolución (ver dar_de_baja_animal() en supabase/migrations/
  // 20260818140000_simplificar_solo_identificacion.sql).
  async darDeBajaAnimal(animalId, motivo){
    const { error } = await supabaseClient.rpc('dar_de_baja_animal', { p_animal_id: animalId, p_motivo: motivo });
    if (error) throw new Error(error.message);
  },

  async promoverUsuario(userId, rol){
    const { error } = await supabaseClient.rpc('promover_usuario', { p_user_id: userId, p_rol: rol });
    if (error) throw new Error(error.message);
  },

  // Borra de verdad SOLO si la cuenta no tiene nada asociado — si tiene,
  // se desactiva en vez de borrar: la trazabilidad no puede depender de
  // que una cuenta siga existiendo. La función RPC además borra de
  // auth.users cuando sí se puede borrar del todo (ver el comentario de
  // eliminar_usuario() en supabase/migrations/20260807120200_funciones.sql).
  async eliminarUsuario(userId){
    const { data, error } = await supabaseClient.rpc('eliminar_usuario', { p_user_id: userId });
    if (error) throw new Error(error.message);
    return data;
  },

  async reactivarUsuario(userId){
    const { error } = await supabaseClient.rpc('reactivar_usuario', { p_user_id: userId });
    if (error) throw new Error(error.message);
  },

  // Solo admin: la bitácora de auditoría.
  async listarAuditoria(){
    const { data, error } = await supabaseClient.rpc('listar_auditoria');
    if (error) throw new Error(error.message);
    return data;
  },

  // Lista de cuentas para la pestaña "Usuarios" del panel de
  // Administración — no existía en el mockApi original porque antes se leía
  // "db.perfiles" directo; ahora que perfiles vive en Supabase, hace falta
  // una función explícita. Solo admin puede verla (RLS ya lo exige, esto
  // es nomás para no depender solo de eso).
  async listarUsuarios(){
    requireRol(['admin']);
    const { data, error } = await supabaseClient.from('perfiles').select('*').order('nombre');
    if (error) throw new Error(error.message);
    return data;
  },

  // Pestaña "Clientes" — a diferencia de "Usuarios" (roles/altas), esta es
  // la vista de negocio: correo de contacto, si está al día con el pago, y
  // cuántos chips lleva comprados. Va por RPC (no select directo) porque
  // el correo vive en auth.users, no en "perfiles".
  async listarClientes(){
    requireRol(['admin']);
    const { data, error } = await supabaseClient.rpc('listar_clientes');
    if (error) throw new Error(error.message);
    return data;
  },

  async actualizarPlanCliente(userId, planEstado, fechaProximoPago){
    requireRol(['admin']);
    const { error } = await supabaseClient.rpc('actualizar_plan_cliente', {
      p_user_id: userId, p_plan_estado: planEstado, p_fecha_proximo_pago: fechaProximoPago || null,
    });
    if (error) throw new Error(error.message);
  },

  // Reservar chips por adelantado para un ganadero puntual — así su
  // celular los puede descargar (misChipsReservados() más abajo) y usarlos
  // para identificar animales nuevos sin conexión (ver
  // supabase/migrations/20260914100000_chips_reservados_offline.sql).
  async reservarChipsCliente(ganaderoId, cantidad){
    requireRol(['admin']);
    const { data, error } = await supabaseClient.rpc('reservar_chips_para_ganadero', {
      p_ganadero_id: ganaderoId, p_cantidad: cantidad,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async liberarChipsCliente(ganaderoId){
    requireRol(['admin']);
    const { data, error } = await supabaseClient.rpc('liberar_chips_reservados', { p_ganadero_id: ganaderoId });
    if (error) throw new Error(error.message);
    return data;
  },

  // =====================================================================
  // Pedidos Gana ID — cada compra pagada en la tienda externa (chips o
  // crédito de suscripción) llega acá vía la Edge Function pedido-ganaid
  // y queda "pendiente" hasta que un admin la resuelve a mano desde la
  // pestaña "Pedidos Gana ID" — ver el comentario grande en
  // supabase/migrations/20260915120000_pedidos_externos_ganaid.sql.
  // =====================================================================
  async listarPedidosExternos(){
    requireRol(['admin']);
    const { data, error } = await supabaseClient.rpc('listar_pedidos_externos');
    if (error) throw new Error(error.message);
    return data;
  },
  // Para "chip_lote": el lote real (con los UID físicos) se carga aparte,
  // desde "Inventario de chips" (mockApi.registrarLoteChips()) — acá solo
  // se deja anotado cuál, si se sabe el id.
  async marcarPedidoExternoAplicado(id, loteId = null){
    requireRol(['admin']);
    const { error } = await supabaseClient.rpc('marcar_pedido_externo_aplicado', { p_id: id, p_lote_id: loteId || null });
    if (error) throw new Error(error.message);
  },
  async descartarPedidoExterno(id, motivo = null){
    requireRol(['admin']);
    const { error } = await supabaseClient.rpc('descartar_pedido_externo', { p_id: id, p_motivo: motivo || null });
    if (error) throw new Error(error.message);
  },
  // "suscripcion_credito": extiende fecha_proximo_pago del ganadero ya
  // identificado (perfil_id, resuelto solo al llegar el webhook si el
  // email del comprador ya tenía cuenta — ver buscarPerfilPorEmail()).
  async aplicarCreditoSuscripcion(id, ganaderoId){
    requireRol(['admin']);
    const { error } = await supabaseClient.rpc('aplicar_credito_suscripcion', { p_id: id, p_ganadero_id: ganaderoId });
    if (error) throw new Error(error.message);
  },
  // El webhook ya intenta esto solo al recibir el pedido — esto es para
  // cuando en ese momento la persona todavía no se había registrado, y el
  // admin lo resuelve más tarde a mano con el email real.
  async buscarPerfilPorEmail(email){
    requireRol(['admin']);
    const { data, error } = await supabaseClient.rpc('buscar_perfil_por_email', { p_email: email.trim() });
    if (error) throw new Error(error.message);
    return data; // uuid del ganadero, o null si no existe
  },

  // Códigos de promoción (3/6/9 meses gratis) — ver
  // supabase/migrations/20260924090000_reactivar_limite_y_codigos_promo.sql.
  async crearCodigoPromocional({ codigo, meses, descripcion, maxUsos, vence }){
    requireRol(['admin']);
    const { data, error } = await supabaseClient.rpc('crear_codigo_promocional', {
      p_codigo: codigo, p_meses: meses, p_descripcion: descripcion || null,
      p_max_usos: maxUsos || null, p_vence: vence || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },
  async listarCodigosPromocionales(){
    requireRol(['admin']);
    const { data, error } = await supabaseClient.rpc('listar_codigos_promocionales');
    if (error) throw new Error(error.message);
    return data;
  },
  async desactivarCodigoPromocional(id){
    requireRol(['admin']);
    const { error } = await supabaseClient.rpc('desactivar_codigo_promocional', { p_id: id });
    if (error) throw new Error(error.message);
  },

  // Offline-safe: sin conexión, devuelve lo último que se guardó en este
  // celular — más los animales que se registraron offline y todavía no
  // terminaron de subir (para que no "desaparezcan" de la lista mientras
  // esperan su turno). Con conexión, refresca la caché de paso.
  // Caché primero, red en segundo plano — NO al revés. Antes esto
  // intentaba la red primero y recién caía al caché si fallaba (o
  // tardaba los 4s del límite de _conTimeout()) — con señal mala pero
  // "presente" (típico del campo: hay barras, pero apenas), cada cambio
  // de pestaña se sentía lentísimo aunque el celular ya tuviera todo
  // guardado. Ahora, si ya hay algo guardado, se devuelve YA MISMO (una
  // lectura de IndexedDB, nunca tarda nada perceptible) y la consulta
  // real se dispara en paralelo, sin que nadie la espere — si trae algo
  // nuevo, se guarda para la próxima vez. Solo la PRIMERA vez de todas
  // (celular recién instalado, caché todavía vacía) hay que esperar la
  // respuesta real, porque no hay nada mejor para mostrar mientras tanto.
  // Filtra por rancho ACTUAL (session.rancho_actual_id) — cada rancho es
  // información separada (ver supabase/migrations/20260917150000_ranchos.sql),
  // así que "mis animales" siempre quiere decir "los de este rancho", no
  // los de la cuenta entera. El filtro va también sobre la caché (no solo
  // la consulta en vivo) porque esa caché es de toda la cuenta — sin
  // esto, cambiar de rancho mostraría por un instante lo del anterior.
  async misAnimales(){
    const user = requireSesion();
    // Si por lo que sea la sesión todavía no sabe cuál es el rancho
    // actual (recién migrada, un fetch que falló), mejor mostrar TODO
    // sin filtrar que esconder animales de verdad por un dato de sesión
    // incompleto — "no sé cuál mostrar" nunca es "no mostrar nada".
    const porRancho = (lista) => user.rancho_actual_id == null ? (lista || []) : (lista || []).filter(a => a.rancho_id === user.rancho_actual_id);
    const enCache = porRancho(await idbTodo('cache_animales'));
    const pedir = () => _conTimeout(supabaseClient.from('animales').select('*').eq('propietario_actual_id', user.id));

    if (enCache.length > 0) {
      pedir().then(({ data, error }) => { if (!error) idbUpsertTodos('cache_animales', data); }).catch(() => {});
      return enCache;
    }
    try {
      const { data, error } = await pedir();
      if (error) throw new Error(error.message);
      await idbUpsertTodos('cache_animales', data);
      return porRancho(data);
    } catch (err) {
      if (!_pareceErrorDeConexion(err)) throw err;
      return enCache; // vacía — no hay nada mejor que mostrar todavía
    }
  },

  // =====================================================================
  // Lotes: un solo modelo, cualquier uso — grupo de manejo (Cría,
  // Engorda...), protocolo reproductivo, campaña sanitaria u otro. Antes
  // convivían dos sistemas (lotes de manejo, membresía de a uno; lotes
  // de trabajo, membresía de muchos) — ver el comentario largo en
  // supabase/migrations/20260918090000_unificar_lotes.sql para el porqué
  // de la fusión. Ahora "tipo" es un dato editable del lote (ver
  // editarLote()) y la membresía siempre es muchos-a-muchos: un animal
  // puede estar en "Engorda" y en "IATF Septiembre 2026" al mismo tiempo.
  // "Un lote de manejo a la vez" lo sigue garantizando el servidor
  // (agregar_animales_a_lote() saca de otros lotes tipo='manejo' al
  // sumar), no hace falta nada especial del lado del cliente para eso.
  // =====================================================================
  // Offline-safe en lectura (crear/editar/archivar un lote sigue
  // necesitando conexión — es infrecuente en el día a día de campo, a
  // diferencia de pesaje/sanidad/reproducción).
  // Filtrado por rancho actual, mismo criterio que misAnimales().
  async misLotes(){
    const user = requireSesion();
    // Mismo fallback que misAnimales(): sin rancho_actual_id confiable,
    // mejor mostrar todo que esconder lotes de verdad.
    const porRancho = (lista) => user.rancho_actual_id == null ? (lista || []) : (lista || []).filter(l => l.rancho_id === user.rancho_actual_id);
    const enCache = porRancho(await idbTodo('cache_lotes'));
    const pedir = () => _conTimeout(supabaseClient.from('lotes').select('*')
      .eq('ganadero_id', user.id).eq('activo', true).order('created_at', { ascending: false }));

    if (enCache.length > 0) {
      pedir().then(({ data, error }) => { if (!error) idbUpsertTodos('cache_lotes', data); }).catch(() => {});
      return enCache;
    }
    try {
      const { data, error } = await pedir();
      if (error) throw new Error(error.message);
      await idbUpsertTodos('cache_lotes', data);
      return porRancho(data);
    } catch (err) {
      if (!_pareceErrorDeConexion(err)) throw err;
      return enCache;
    }
  },
  // Pasa por crear_lote() (RPC) en vez de un insert directo — así el
  // alta puede, en el mismo viaje, sumar la primera tanda de animales
  // (p. ej. "compré este lote de 12 vacas") heredando la regla de "un
  // lote de manejo a la vez" de agregar_animales_a_lote().
  // Offline-safe: crear un lote (y sumarle animales, ver más abajo) es
  // justo lo que se hace parado en el corral con el rebaño delante, así
  // que se aplica optimista en la caché con un id temporal, mismo patrón
  // que registrarAnimalDirecto() — ver _onlineCrearLote() más abajo.
  async crearLote({ nombre, tipo, categoria, notas, animalIds }){
    if (!nombre || !nombre.trim()) throw new Error('Falta el nombre del lote');
    const datos = {
      nombre: nombre.trim(), tipo: tipo || 'manejo', categoria: (categoria || '').trim() || null,
      notas: (notas || '').trim() || null, animalIds: animalIds && animalIds.length ? animalIds : null,
    };
    return _offlineSafe('crearLote', [datos], _onlineCrearLote, {
      aplicarLocal: async () => {
        const user = requireSesion();
        const idLocal = 'local-lote-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
        const lote = {
          id: idLocal, nombre: datos.nombre, tipo: datos.tipo, categoria: datos.categoria, notas: datos.notas,
          activo: true, ganadero_id: user.id, rancho_id: user.rancho_actual_id ?? null,
          created_at: new Date().toISOString(), _pendienteSync: true,
        };
        await idbUpsertUno('cache_lotes', lote);
        if (datos.animalIds) {
          await idbUpsertTodos('cache_lote_animales', datos.animalIds.map(aid => ({ id: `${idLocal}:${aid}`, lote_id: idLocal, animal_id: aid })));
        }
        return { resultado: lote, limpiarAlSincronizar: [{ tabla: 'cache_lotes', clave: idLocal }], idLocalLote: idLocal };
      },
    });
  },
  // Lo que pedía el usuario: poder cambiarle el nombre Y la función
  // (tipo) a un lote ya creado, sin tener que armar uno nuevo. Sin
  // offline: es una edición de datos fijos, no algo que se necesite
  // resolver parado en el corral (mismo criterio que invitar staff o
  // cargar un lote de chips — tareas de escritorio).
  async editarLote(loteId, { nombre, tipo, categoria, notas }){
    if (!nombre || !nombre.trim()) throw new Error('Falta el nombre del lote');
    const { error } = await supabaseClient.rpc('editar_lote', {
      p_lote_id: loteId, p_nombre: nombre.trim(), p_tipo: tipo || 'manejo',
      p_categoria: (categoria || '').trim() || null, p_notas: (notas || '').trim() || null,
    });
    if (error) throw new Error(error.message);
    const { data: fila, error: errFila } = await supabaseClient.from('lotes').select('*').eq('id', loteId).single();
    if (!errFila) await idbUpsertUno('cache_lotes', fila);
  },
  // "Archivar" en vez de borrar — un lote con animales adentro no debería
  // desaparecer de golpe. activo=false alcanza: misLotes() ya no lo
  // trae, pero el vínculo con sus animales (lote_animales) y el
  // historial de eventos que aplicó quedan intactos por si hace falta
  // consultarlos después. Sin offline, mismo criterio que editarLote().
  async archivarLote(loteId){
    const { error } = await supabaseClient.rpc('archivar_lote', { p_lote_id: loteId });
    if (error) throw new Error(error.message);
  },
  // A diferencia de archivarLote() (activo=false, no borra nada), esto sí
  // borra la fila entera — pensado para un lote creado por error o de
  // prueba. Seguro del lado del servidor (lote_animales cae en cascada,
  // los eventos que aplicó solo pierden la etiqueta, no se borran — ver
  // supabase/migrations/20260919090000_eliminar_lote.sql). Sin offline,
  // mismo criterio que editarLote().
  async eliminarLote(loteId){
    const { error } = await supabaseClient.rpc('eliminar_lote', { p_lote_id: loteId });
    if (error) throw new Error(error.message);
    await idbBorrarUno('cache_lotes', loteId);
  },
  // La membresía es tabla puente (lote_animales) — antes se leía SIEMPRE
  // en vivo (ni un cache_lote_animales existía), así que ver quiénes
  // estaban en un lote se rompía enseguida sin señal. Ahora es
  // caché-primero, igual que misAnimales()/misLotes().
  async animalesDeLote(loteId){
    const idsDeCache = async () => new Set(
      (await idbTodo('cache_lote_animales')).filter(v => String(v.lote_id) === String(loteId)).map(v => v.animal_id)
    );
    const pedir = () => _conTimeout(supabaseClient.from('lote_animales').select('lote_id, animal_id').eq('lote_id', loteId));
    const guardarVinculos = (data) => idbUpsertTodos('cache_lote_animales', data.map(v => ({ id: `${v.lote_id}:${v.animal_id}`, ...v })));

    const enCache = await idsDeCache();
    let ids;
    if (enCache.size > 0) {
      pedir().then(({ data, error }) => { if (!error) guardarVinculos(data); }).catch(() => {});
      ids = enCache;
    } else {
      try {
        const { data, error } = await pedir();
        if (error) throw new Error(error.message);
        await guardarVinculos(data);
        ids = new Set(data.map(v => v.animal_id));
      } catch (err) {
        if (!_pareceErrorDeConexion(err)) throw err;
        ids = enCache; // vacío — no hay nada mejor que mostrar todavía
      }
    }
    const animales = await mockApi.misAnimales();
    return animales.filter(a => ids.has(a.id));
  },
  // Offline-safe: es la acción de campo por excelencia de un lote
  // (escanear/elegir animales y sumarlos) — se aplica optimista sobre
  // cache_lote_animales con la misma clave (`lote:animal`) que va a
  // terminar teniendo la fila real, así que cuando el alta sincroniza de
  // verdad no hace falta "limpiar" nada, el upsert online pisa la misma
  // clave sin más. Nota: la regla de servidor "un lote de manejo a la
  // vez" (agregar_animales_a_lote(), ver la migración de unificación) NO
  // se replica acá offline — si en algún momento sumaras el mismo animal
  // a dos lotes de manejo estando sin señal, se corrige solo apenas
  // sincronice (el servidor sí aplica la regla), no antes.
  async agregarAnimalesALote(loteId, animalIds){
    return _offlineSafe('agregarAnimalesALote', [loteId, animalIds], _onlineAgregarAnimalesALote, {
      aplicarLocal: async () => {
        await idbUpsertTodos('cache_lote_animales', animalIds.map(aid => ({ id: `${loteId}:${aid}`, lote_id: loteId, animal_id: aid })));
        return { resultado: { ok: true, agregados: animalIds.length, _pendienteSync: true } };
      },
    });
  },
  async quitarAnimalDeLote(loteId, animalId){
    return _offlineSafe('quitarAnimalDeLote', [loteId, animalId], _onlineQuitarAnimalDeLote, {
      aplicarLocal: async () => {
        await idbBorrarUno('cache_lote_animales', `${loteId}:${animalId}`);
        return { resultado: { ok: true, _pendienteSync: true } };
      },
    });
  },
  // Carga en bloque — un evento de reproducción por cada animal del
  // lote, todos con los mismos datos (mismo protocolo, mismo día). El
  // diagnóstico de gestación de cada uno sigue siendo individual: se
  // carga después con registrarReproduccion() de siempre, animal por
  // animal, no por acá. Disponible para cualquier tipo de lote.
  // Offline-safe: se aplica un evento local (mismo mecanismo que
  // registrarReproduccion() individual) por cada animal que HOY figura
  // en la caché como miembro del lote.
  async registrarReproduccionLote(loteId, { tipo, semental, veterinario, fecha, notas }){
    if (!tipo || !tipo.trim()) throw new Error('Falta el tipo de evento reproductivo');
    const datos = { tipo: tipo.trim(), semental: semental || null, veterinario: veterinario || null, fecha: fecha || null, notas: notas || null };
    return _offlineSafe('registrarReproduccionLote', [loteId, datos], _onlineRegistrarReproduccionLote, {
      aplicarLocal: async () => {
        const miembros = await mockApi.animalesDeLote(loteId);
        const limpiar = [];
        for (const a of miembros) {
          const idEvt = await _aplicarEventoLocal(a.id, 'reproduccion', datos, {
            descripcion: datos.tipo, producto: datos.semental, veterinario: datos.veterinario,
          });
          limpiar.push({ tabla: 'cache_eventos', clave: idEvt });
        }
        return { resultado: { ok: true, animales: miembros.length, _pendienteSync: true }, limpiarAlSincronizar: limpiar };
      },
    });
  },
  // Mismo criterio que registrarReproduccionLote(), para sanidad.
  async registrarSanidadLote(loteId, { tipo, producto, lote_producto, dosis, veterinario, dias_retiro, fecha, notas }){
    if (!tipo || !tipo.trim()) throw new Error('Falta el tipo de intervención');
    const datos = {
      tipo: tipo.trim(), producto: producto || null, lote_producto: lote_producto || null, dosis: dosis || null,
      veterinario: veterinario || null, dias_retiro: dias_retiro || null, fecha: fecha || null, notas: notas || null,
    };
    return _offlineSafe('registrarSanidadLote', [loteId, datos], _onlineRegistrarSanidadLote, {
      aplicarLocal: async () => {
        const miembros = await mockApi.animalesDeLote(loteId);
        const diasRetiro = datos.dias_retiro ? parseInt(datos.dias_retiro, 10) : null;
        const fecha = datos.fecha || new Date().toISOString().slice(0, 10);
        const retiroHasta = diasRetiro ? new Date(new Date(fecha).getTime() + diasRetiro * 86400000).toISOString().slice(0, 10) : null;
        const limpiar = [];
        for (const a of miembros) {
          const idEvt = await _aplicarEventoLocal(a.id, 'sanidad', datos, {
            descripcion: datos.tipo, producto: datos.producto, lote_producto: datos.lote_producto,
            dosis: datos.dosis, veterinario: datos.veterinario, dias_retiro: diasRetiro, retiro_hasta: retiroHasta,
          });
          limpiar.push({ tabla: 'cache_eventos', clave: idEvt });
        }
        return { resultado: { ok: true, animales: miembros.length, _pendienteSync: true }, limpiarAlSincronizar: limpiar };
      },
    });
  },
  // El cruce de ganancia de peso + % de preñez del lote — ver el
  // comentario largo de resumen_lote() del lado del servidor. No se
  // puede RECALCULAR offline (necesita cruzar pesajes/diagnósticos de
  // TODOS los animales del lote, cuenta del servidor) — lo que sí se
  // puede es mostrar la última respuesta real conocida en vez de romper
  // la pantalla, caché-primero igual que el resto. Un lote creado
  // offline y todavía sin sincronizar (id "local-lote-...") nunca pasó
  // por el servidor, así que ahí se arma un resumen mínimo a mano (sin
  // ganancia de peso ni protocolo — esos datos recién existen cuando el
  // lote sincroniza de verdad).
  async resumenLote(loteId){
    // Un lote creado offline y todavía sin sincronizar ("local-lote-...")
    // nunca pasó por el servidor — ni intenta preguntarle nada, va
    // derecho al resumen mínimo de más abajo.
    const esLocal = typeof loteId === 'string' && loteId.startsWith('local-lote-');

    if (!esLocal) {
      const enCache = (await idbTodo('cache_resumen_lote')).find(r => String(r.id) === String(loteId));
      const pedir = () => _conTimeout(supabaseClient.rpc('resumen_lote', { p_lote_id: loteId }));

      if (enCache) {
        pedir().then(({ data, error }) => { if (!error) idbUpsertUno('cache_resumen_lote', { id: loteId, ...data }); }).catch(() => {});
        return enCache;
      }
      try {
        const { data, error } = await pedir();
        if (error) throw new Error(error.message);
        await idbUpsertUno('cache_resumen_lote', { id: loteId, ...data });
        return data;
      } catch (err) {
        if (!_pareceErrorDeConexion(err)) throw err;
        // Sin conexión Y sin nada guardado todavía para ESTE lote puntual
        // — en vez de romper la pantalla entera (era lo que hacía antes:
        // tirar un error y volver a la lista), cae al resumen mínimo de
        // acá abajo. No tiene ganancia de peso ni % de preñez (esos
        // números son cálculo del servidor, no hay forma honesta de
        // armarlos sin conexión), pero al menos deja ver el lote y
        // cuántos animales tiene en vez de no dejar entrar.
      }
    }

    const [vinculos, animales] = await Promise.all([idbTodo('cache_lote_animales'), mockApi.misAnimales()]);
    const ids = new Set(vinculos.filter(v => String(v.lote_id) === String(loteId)).map(v => v.animal_id));
    const miembros = animales.filter(a => ids.has(a.id));
    return {
      total_animales: miembros.length,
      reproduccion: { con_protocolo: 0, preñadas: 0, vacias: 0, pendientes: 0 },
      animales: miembros.map(a => ({
        animal_id: a.id, numero_interno: a.numero_interno, chip_uid: a.chip_uid,
        peso_entrada_kg: null, peso_entrada_fecha: null,
        peso_actual_kg: a.peso_actual_kg, peso_actual_fecha: a.peso_actual_fecha,
        ganancia_kg: null, ganancia_diaria_kg: null, resultado_reproductivo: null,
      })),
    };
  },

  // La ficha de un animal puntual (abrirFichaAnimal() en ganadero/app.js,
  // renderResultadoMonitoreo() del lado de Administración) — antes se leía
  // directo de loadDB(), ahora hace falta pedirlo. RLS ya limita a "el
  // dueño o staff" (ver supabase/migrations/20260807120100_rls.sql).
  // Si "animalId" es un id local (todavía sin sincronizar, "local-..."),
  // ni siquiera se intenta preguntarle al servidor — no existe ahí todavía.
  async obtenerAnimal(animalId){
    if (typeof animalId === 'string' && animalId.startsWith('local-')) {
      const enCache = await idbTodo('cache_animales');
      const local = enCache.find((a) => a.id === animalId);
      if (!local) throw new Error('Ese animal no existe');
      return local;
    }
    const enCache = await idbTodo('cache_animales');
    const local = enCache.find((a) => String(a.id) === String(animalId));
    const pedir = () => _conTimeout(supabaseClient.from('animales').select('*').eq('id', animalId).single());

    if (local) {
      pedir().then(({ data, error }) => { if (!error && data) idbUpsertUno('cache_animales', data); }).catch(() => {});
      return local;
    }
    // Nada guardado todavía para este animal puntual — acá sí hay que
    // esperar la respuesta real, no hay nada mejor para mostrar mientras.
    try {
      const { data, error } = await pedir();
      if (error) throw new Error(error.message);
      await idbUpsertUno('cache_animales', data);
      return data;
    } catch (err) {
      throw new Error('No se pudo cargar este animal sin conexión — todavía no está guardado en este celular.');
    }
  },

  // Padre/madre de un animal — por id si es un animal ya registrado del
  // propio rebaño (ver opcionesIdentificadorAnimales() en ganadero/app.js,
  // mismo datalist que Sanidad/Pesaje/Reproducción) o como texto libre si
  // no está cargado en el sistema. Es de escritorio/oficina (se carga una
  // vez, normalmente desde papeles), no de corral — requiere conexión,
  // mismo criterio que editarRancho()/editarLote().
  async editarGenealogiaAnimal(animalId, { padre_id, padre_texto, madre_id, madre_texto }){
    const { error } = await supabaseClient.rpc('editar_genealogia_animal', {
      p_animal_id: animalId, p_padre_id: padre_id || null, p_padre_texto: padre_texto || null,
      p_madre_id: madre_id || null, p_madre_texto: madre_texto || null,
    });
    if (error) throw new Error(error.message);
    const { data } = await supabaseClient.from('animales').select('*').eq('id', animalId).single();
    if (data) await idbUpsertUno('cache_animales', data);
  },

  // Toda la línea de tiempo (alta/traslado/sanidad/baja/pesaje) de UN
  // animal puntual — la usan la ficha del ganadero y el mini-dashboard en
  // vivo de Sanidad/Pesaje (dashboardAnimalHtml() en ganadero/app.js).
  // Offline-safe: mezcla lo último bajado del servidor con cualquier
  // evento cargado offline sobre ESTE animal que todavía no sincronizó.
  async eventosDeAnimal(animalId){
    const enCache = await idbTodo('cache_eventos');
    const inmediato = enCache.filter((e) => String(e.animal_id) === String(animalId));
    if (typeof animalId === 'string' && animalId.startsWith('local-')) return inmediato; // nunca existió en el servidor todavía

    const pedir = () => _conTimeout(supabaseClient.from('eventos_animal').select('*').eq('animal_id', animalId));

    if (inmediato.length > 0) {
      // Ya hay algo de este animal guardado — se muestra ya, se
      // actualiza solo en segundo plano.
      pedir().then(({ data, error }) => { if (!error) idbUpsertTodos('cache_eventos', data); }).catch(() => {});
      return inmediato;
    }
    // Nada guardado todavía para ESTE animal en particular (puede ser que
    // de verdad no tenga eventos, o que nunca se haya bajado su
    // historial) — acá sí conviene esperar la respuesta real una vez.
    try {
      const { data, error } = await pedir();
      if (error) throw new Error(error.message);
      await idbUpsertTodos('cache_eventos', data);
      return data;
    } catch (err) {
      if (!_pareceErrorDeConexion(err)) throw err;
      return inmediato; // vacío — no hay nada mejor que mostrar todavía
    }
  },

  // Historial reciente de un tipo de evento en TODO el propio rebaño (no
  // uno solo) — lo usan las pestañas Sanidad/Pesaje del ganadero para la
  // lista de abajo. No hace falta filtrar "mis animales" a mano: RLS en
  // eventos_animal ya solo deja ver eventos de animales propios (o de
  // staff), así que un simple select ya viene recortado.
  // Filtrado por rancho actual, mismo criterio que misAnimales()/
  // misLotes() — antes esto traía TODOS los eventos del ganadero sin
  // importar el rancho, así que una cuenta con más de un rancho veía
  // alertas de sanidad/reproducción (y el contador "Preñadas" de Inicio)
  // mezclando animales de un rancho con los de otro. eventos_animal no
  // tiene columna de rancho propia (solo a través de animal_id), así que
  // se cruza contra los ids de misAnimales() (ya filtrados, ya en
  // caché) en vez de duplicar la lógica de qué rancho está activo.
  async misEventosAnimal(tipo, limite = 30){
    const user = requireSesion();
    const idsDelRancho = user.rancho_actual_id == null
      ? null // sin rancho_actual_id confiable, no se filtra — mismo fallback de siempre
      : new Set((await mockApi.misAnimales()).map(a => a.id));
    if (idsDelRancho != null && idsDelRancho.size === 0) return [];
    const delRancho = (e) => idsDelRancho == null || idsDelRancho.has(e.animal_id);

    const filtrarCache = async () => (await idbTodo('cache_eventos'))
      .filter((e) => e.tipo === tipo && delRancho(e))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, limite);
    const inmediato = await filtrarCache();
    const pedir = () => {
      let query = supabaseClient.from('eventos_animal').select('*').eq('tipo', tipo);
      if (idsDelRancho != null) query = query.in('animal_id', Array.from(idsDelRancho));
      return _conTimeout(query.order('fecha', { ascending: false }).limit(limite));
    };

    if (inmediato.length > 0) {
      pedir().then(({ data, error }) => { if (!error) idbUpsertTodos('cache_eventos', data); }).catch(() => {});
      return inmediato;
    }
    try {
      const { data, error } = await pedir();
      if (error) throw new Error(error.message);
      await idbUpsertTodos('cache_eventos', data);
      return data;
    } catch (err) {
      if (!_pareceErrorDeConexion(err)) throw err;
      return inmediato;
    }
  },

  // La "hoja" de un municipio para el dashboard de admin. La
  // función RPC devuelve "tipo"/"subtipo" crudos (no una etiqueta ya
  // armada como "🆕 Alta") — eso se resuelve del lado del cliente con
  // etiquetaTipoEvento(), ver abrirModalMunicipio() en
  // shared/view-generic.js.
  async resumenMunicipio(municipio){
    const { data, error } = await supabaseClient.rpc('resumen_municipio', { p_municipio: municipio });
    if (error) throw new Error(error.message);
    return data;
  },

  // Cuántas acciones están anotadas en el outbox todavía sin subir.
  async contarPendientesSincronizar(){ return (await idbTodo('outbox')).length; },

  // El detalle de esas acciones pendientes — lo usa la tarjeta de
  // "Sincronización" en Inicio (ver viewInicio(), ganadero/app.js) para
  // mostrar QUÉ está esperando a subir, no solo un número pelado.
  async listarPendientesSincronizar(){
    const entradas = (await idbTodo('outbox')).sort((a, b) => a.id - b.id);
    return entradas.map((e) => ({ id: e.id, descripcion: _descripcionAccionOffline(e), creado_en: e.creado_en }));
  },

  // Fallos DE VERDAD (no de conexión — esos se reintentan solos) que
  // quedaron anotados la última vez que se intentó sincronizar. Persiste
  // en el celular hasta que el propio ganadero los revisa y los descarta
  // — a diferencia del toast de aviso, que si nadie lo vio en el momento
  // se perdía para siempre.
  async listarFallosSincronizacion(){
    const fallos = await idbTodo('fallos_sync');
    return fallos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  },
  async descartarFalloSincronizacion(id){ await idbBorrarUno('fallos_sync', id); },

  // Botón "Sincronizar ahora" — el vaciado automático ya corre solo
  // (evento "online", la app vuelve a primer plano, y cada 20s de
  // respaldo — ver el final de este archivo), pero un botón a demanda le
  // da control real al ganadero en vez de tener que confiar a ciegas en
  // que "en algún momento" va a subir.
  async sincronizarAhora(){
    if (!navigator.onLine) throw new Error('Sin conexión todavía — probá cuando tengas señal.');
    await procesarOutbox();
  },

  // ===== Sección de administración avanzada (exclusiva de admin) =====
  // Comparativa de GDP promedio por raza/municipio de TODA la administración
  // — ver benchmark_productividad() en
  // supabase/migrations/20260817140000_admin_avanzado.sql (tiene que ser
  // del lado del servidor: RLS no dejaría al cliente cruzar animales de
  // otros ganaderos).
  async benchmarkProductividad(){
    const { data, error } = await supabaseClient.rpc('benchmark_productividad');
    if (error) throw new Error(error.message);
    return data;
  },

  // Sacrificio + guías de movilización de un animal puntual — lo que ve
  // el admin debajo del resultado de Monitoreo.
  async historialAdministrativo(animalId){
    const { data, error } = await supabaseClient.rpc('historial_administrativo', { p_animal_id: animalId });
    if (error) throw new Error(error.message);
    return data;
  },

  // Cierra la vida del animal en el sistema — requiere un rastro ya
  // cargado (ver crearRastro()/listarRastros() acá abajo).
  async registrarSacrificio({ animal_id, rastro_id, folio_oficial, peso_canal_kg, notas }){
    const { data, error } = await supabaseClient.rpc('registrar_sacrificio', {
      p_animal_id: animal_id, p_rastro_id: rastro_id,
      p_folio_oficial: folio_oficial || null, p_peso_canal_kg: peso_canal_kg ? parseFloat(peso_canal_kg) : null,
      p_notas: notas || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  // Emite una guía de movilización — además deja un evento "traslado" en
  // la línea de tiempo del animal (ver registrar_guia_movilizacion()).
  async registrarGuiaMovilizacion({ animal_id, destino, origen, motivo, transportista, folio }){
    const { data, error } = await supabaseClient.rpc('registrar_guia_movilizacion', {
      p_animal_id: animal_id, p_destino: destino, p_origen: origen || null,
      p_motivo: motivo || null, p_transportista: transportista || null, p_folio: folio || null,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  // Catálogo de rastros/mataderos (TIF) — RLS ya deja ver a cualquier
  // autenticado y crear solo a staff (ver
  // supabase/migrations/20260807120100_rls.sql), así que son inserts/
  // selects directos, sin necesitar una función RPC dedicada.
  async listarRastros(){
    const { data, error } = await supabaseClient.from('rastros').select('*').order('nombre');
    if (error) throw new Error(error.message);
    return data;
  },
  async crearRastro({ nombre, numero_tif, ubicacion }){
    const user = requireRol(['admin']);
    if (!nombre || !nombre.trim()) throw new Error('Falta el nombre del rastro');
    const { data, error } = await supabaseClient.from('rastros').insert({
      usuario_id: user.id, nombre: nombre.trim(), numero_tif: numero_tif || null, ubicacion: ubicacion || null,
    }).select('*').single();
    if (error) throw new Error(error.message);
    return data;
  },

  // Ganaderos activos para elegir como comprador al registrar una venta
  // (formVentaMonitoreo en shared/view-generic.js).
  async listarGanaderosActivos(){
    const { data, error } = await supabaseClient.from('perfiles').select('id, nombre, municipio').eq('rol', 'ganadero').eq('activo', true).order('nombre');
    if (error) throw new Error(error.message);
    return data;
  },
};

// =====================================================================
// Offline-first real, con IndexedDB (no localStorage: más espacio,
// asíncrono, no bloquea el hilo principal). Dos piezas:
//
//   1. CACHÉ DE LECTURA (cache_animales, cache_eventos, cache_lotes,
//      cache_lote_animales, cache_resumen_lote, cache_chips_reservados) —
//      lo último que se pudo traer de Supabase. misAnimales()/
//      obtenerAnimal()/eventosDeAnimal()/animalesDeLote()/etc. (más
//      arriba) ya la usan: con conexión, la refrescan de paso; sin
//      conexión, leen de ahí en vez de tirar un error de red.
//
//   2. OUTBOX (cola de escritura) — registrarAnimalDirecto/Pesaje/
//      Sanidad/Reproduccion y crearLote/agregarAnimalesALote/
//      quitarAnimalDeLote/registrarReproduccionLote/registrarSanidadLote
//      (más arriba) pasan por _offlineSafe(): si la llamada real falla
//      por FALTA DE CONEXIÓN (nunca si es un error de validación real —
//      eso se propaga tal cual, sin encolar nada), la acción se aplica
//      OPTIMISTA en la caché de inmediato — el ganadero ve el resultado
//      al instante, sin darse cuenta de si había señal — y queda anotada
//      acá para mandarse sola en cuanto vuelva la conexión (evento
//      "online", la pestaña vuelve a primer plano, o el intervalo de más
//      abajo — Safari/iOS no soporta Background Sync, así que no alcanza
//      con depender solo del evento).
//
// Un caso necesita cuidado aparte: si se registra un animal (o un lote)
// NUEVO offline y todavía sin sincronizar, y ENCIMA se le carga algo más
// offline encima (un pesaje sobre ESE animal, sumar ESE animal a un
// lote, o sumar animales a ESE lote — todo con id todavía local,
// "local-..."/"local-lote-..."), esa acción dependiente no se puede
// mandar al servidor hasta que el alta de la que depende exista de
// verdad ahí. Por eso el outbox se vacía siempre EN ORDEN (nunca de a
// varios en paralelo) y, apenas un alta sincroniza, se reescribe su id
// local por el id real en cualquier acción pendiente que todavía lo
// estuviera referenciando — en cualquier lugar de sus argumentos, no
// solo el primero (_reescribirIdEnOutbox()) — así lo que sigue en la
// cola ya sale con el id correcto cuando le toca su turno.
//
// Lo que queda AFUERA de este esquema, a propósito: editar/archivar/
// eliminar un lote, cargar un lote de chips, invitar cuentas, y todo el
// panel de Administración — son operaciones de escritorio, no de corral;
// no vale la pena la complejidad de hacerlas offline cuando quien las
// usa normalmente tiene wifi.
// =====================================================================

const OFFLINE_DB_NOMBRE = 'ganadoRegistroOffline';
// v2: suma "fallos_sync" — registro PERSISTENTE de qué acción offline no
// se pudo terminar de subir de verdad (a diferencia del toast de antes,
// que si no lo veías en el momento se perdía para siempre).
// v3: suma "cache_ranchos" — viewShell() (ganadero/app.js) pide la lista
// de ranchos en CADA cambio de pantalla para mostrar el nombre del
// actual arriba de todo; sin caché, quedarse sin señal rompía la
// navegación entera de la app, no solo el selector de rancho (ver
// supabase/migrations/20260917150000_ranchos.sql). El "if not contains"
// de cada línea hace que subir la versión sea segura para quien ya
// tenía una versión vieja instalada en el celular: crea SOLO lo que
// falta, nunca toca lo que ya había.
// v4: suma "cache_lote_animales" (membresía de un lote — antes se leía
// SIEMPRE en vivo, sin caché ninguna, así que ver o sumar animales a un
// lote se rompía entero sin señal) y "cache_resumen_lote" (última
// estadística conocida de cada lote — resumen_lote() se calcula del lado
// del servidor, no hay forma de recalcularla offline, así que se guarda
// la última respuesta real para poder mostrar ALGO en vez de romper la
// pantalla entera cuando no hay conexión).
const OFFLINE_DB_VERSION = 4;
let _offlineDBPromise = null;

function abrirOfflineDB(){
  if (_offlineDBPromise) return _offlineDBPromise;
  _offlineDBPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB no disponible en este navegador')); return; }
    const req = indexedDB.open(OFFLINE_DB_NOMBRE, OFFLINE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cache_animales')) db.createObjectStore('cache_animales', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache_eventos')) db.createObjectStore('cache_eventos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache_lotes')) db.createObjectStore('cache_lotes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache_chips_reservados')) db.createObjectStore('cache_chips_reservados', { keyPath: 'chip_uid' });
      if (!db.objectStoreNames.contains('cache_ranchos')) db.createObjectStore('cache_ranchos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache_lote_animales')) db.createObjectStore('cache_lote_animales', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache_resumen_lote')) db.createObjectStore('cache_resumen_lote', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('fallos_sync')) db.createObjectStore('fallos_sync', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _offlineDBPromise;
}

// "upsert" (ver idbUpsertTodos más abajo) nunca borra lo que ya había en
// una tabla — a propósito, para no perder una fila local todavía sin
// sincronizar justo cuando se refresca la caché con una lectura del
// servidor. Pero eso mismo significa que si en este mismo dispositivo
// cambia DE CUENTA (cerrar sesión y entrar con otra, o — el caso real
// que lo hizo notar, 2026-09-22 — una cuenta de prueba se borró del todo
// por SQL y se volvió a crear con otro id) los datos de la cuenta
// anterior quedan mezclados para siempre con los de la nueva: nadie los
// borra nunca. Se llama desde _resolverSesion() (shared/auth-supabase.js)
// en CADA confirmación de sesión, comparando contra el último id de
// usuario que este dispositivo llegó a confirmar (guardado en
// localStorage, sobrevive a cerrar la app). Si no coincide — incluida la
// primera vez que corre esta versión nueva, sin ningún id guardado
// todavía, que es justo el caso de quien ya tenía la caché vieja
// mezclada — se tira toda la base offline entera y se arranca de cero.
const OFFLINE_DB_ULTIMO_USUARIO_KEY = 'ganadoRegistroOfflineUltimoUsuario';
async function purgarCacheOfflineSiCambioDeUsuario(userId){
  let anterior = null;
  try { anterior = localStorage.getItem(OFFLINE_DB_ULTIMO_USUARIO_KEY); } catch (err) { /* sin localStorage no hay forma de saber si cambió — se sigue de largo, no es crítico */ }
  if (anterior !== userId) {
    if (_offlineDBPromise) {
      // Con límite de tiempo: si la apertura quedó bloqueada (otra pestaña con
      // la base en una versión distinta), no se espera para siempre.
      try {
        const db = await Promise.race([
          _offlineDBPromise,
          new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('Tiempo de espera agotado')), 2000)),
        ]);
        db.close();
      } catch (err) { /* ya cerrada, nunca llegó a abrir, o bloqueada */ }
    }
    _offlineDBPromise = null;
    // Con límite de tiempo: si otra pestaña tiene la base abierta, el borrado
    // puede quedarse esperando para siempre y el inicio de sesión nunca
    // terminaba. Si no se borra a tiempo, no se marca el usuario (se reintenta
    // en la siguiente carga) y la entrada sigue sin bloquearse.
    const borrada = await Promise.race([
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(OFFLINE_DB_NOMBRE);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(false);
      }),
      new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
    ]);
    if (!borrada) return;
  }
  try { localStorage.setItem(OFFLINE_DB_ULTIMO_USUARIO_KEY, userId); } catch (err) { /* no crítico */ }
}

// Primitivas mínimas — todo lo demás de este archivo se construye con
// estas 5. "upsert" nunca borra lo que ya había en la tabla (a diferencia
// de un reemplazo completo): un id numérico (viene del servidor) pisa su
// fila anterior tal cual, y una fila local todavía sin sincronizar
// ("local-...") queda intacta aunque justo en ese momento se esté
// refrescando la caché con una lectura del servidor.
function idbTodo(tabla){
  return abrirOfflineDB().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(tabla, 'readonly').objectStore(tabla).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  })).catch(() => []); // sin IndexedDB (navegador viejo, modo privado estricto) la app sigue andando, solo sin memoria offline
}
function idbUpsertUno(tabla, item){ return idbUpsertTodos(tabla, [item]); }
function idbUpsertTodos(tabla, items){
  return abrirOfflineDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(tabla, 'readwrite');
    const store = tx.objectStore(tabla);
    items.forEach((item) => store.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  })).catch(() => {});
}
function idbBorrarUno(tabla, clave){
  return abrirOfflineDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(tabla, 'readwrite');
    tx.objectStore(tabla).delete(clave);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  })).catch(() => {});
}
function idbAgregarOutbox(entrada){
  return abrirOfflineDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    const req = tx.objectStore('outbox').add(entrada);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  }));
}
function idbAgregarFallo(entrada){
  return abrirOfflineDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction('fallos_sync', 'readwrite');
    const req = tx.objectStore('fallos_sync').add(entrada);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  }));
}

// Heurística para distinguir "no hay conexión" de un error de negocio
// real (permisos, datos faltantes, el chip ya lo tomó otro) — solo el
// primer caso se encola; el segundo se propaga tal cual, siempre.
// navigator.onLine=false es la señal más confiable; como respaldo (puede
// haber "señal" wifi sin salida real a internet), también se revisan los
// mensajes típicos de un fetch que no llegó a ningún lado.
function _pareceErrorDeConexion(err){
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  const msg = ((err && err.message) || '').toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('fetch') || msg.includes('network') || msg.includes('load failed');
}

// "navigator.onLine" solo dice si hay una interfaz de red activa (wifi/
// datos prendidos) — no si esa red llega a algún lado de verdad. Con
// señal débil o una wifi sin salida real a internet, el propio fetch()
// del navegador puede quedarse esperando una respuesta muchos segundos
// antes de darse por vencido solo — y hasta que eso pasa, cada pantalla
// (cambiar de pestaña, abrir una ficha) se siente colgada. Esta carrera
// le pone un límite propio, corto: si la llamada real no contestó en
// TIMEOUT_RED_MS, se la da por "sin conexión" ya mismo y se cae al modo
// offline al instante, en vez de esperar lo que el navegador tarde en
// decidirlo solo. El error que arma es un TypeError a propósito —
// _pareceErrorDeConexion() ya lo reconoce como caso de conexión.
const TIMEOUT_RED_MS = 4000;
function _conTimeout(promesa){
  // Sin ninguna interfaz de red activa (modo avión, o el dato/wifi
  // directamente apagado) no tiene sentido esperar nada — ni siquiera los
  // 4 segundos del límite de abajo: es la señal más barata y más
  // confiable que existe de que no hay conexión, así que se falla ya
  // mismo. El límite de tiempo real es para el otro caso, más difícil de
  // detectar de entrada: "hay wifi prendido pero no llega a ningún lado".
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.reject(new TypeError('Sin conexión (sin interfaz de red activa)'));
  }
  return Promise.race([
    promesa,
    new Promise((_, reject) => setTimeout(() => reject(new TypeError('Tiempo de espera agotado — sin conexión real')), TIMEOUT_RED_MS)),
  ]);
}

// El envoltorio que usan registrarAnimalDirecto/Pesaje/Sanidad/
// Reproduccion y, ahora, crearLote/agregarAnimalesALote/
// quitarAnimalDeLote/registrarReproduccionLote/registrarSanidadLote —
// intenta la llamada real primero, SIEMPRE; recién si falla por conexión
// entra a jugar lo local. "opciones.aplicarLocal()" tiene que devolver
// { resultado, limpiarAlSincronizar, idLocalAnimal?, idLocalLote? } —
// limpiarAlSincronizar es la lista de [{tabla, clave}] a borrar de la
// caché una vez que la acción real termine (bien o mal) del otro lado;
// idLocalAnimal/idLocalLote (solo para un alta nueva) es el id temporal
// que hay que reescribir en el resto de la cola cuando el servidor
// confirme el id real (ver _reescribirIdEnOutbox()).
async function _offlineSafe(tipo, args, fnOnline, opciones = {}){
  try {
    return await fnOnline(...args);
  } catch (err) {
    if (!_pareceErrorDeConexion(err)) throw err;
    if (opciones.puedeAplicarOffline && !opciones.puedeAplicarOffline()) {
      throw new Error('Necesitás conexión a internet para esto — probá de nuevo cuando vuelva la señal.');
    }
    const { resultado, limpiarAlSincronizar, idLocalAnimal, idLocalLote } = await opciones.aplicarLocal();
    await idbAgregarOutbox({
      tipo, args, creado_en: new Date().toISOString(),
      limpiarAlSincronizar: limpiarAlSincronizar || null,
      idLocalAnimal: idLocalAnimal || null,
      idLocalLote: idLocalLote || null,
    });
    window.dispatchEvent(new CustomEvent('ganado-cola-cambio'));
    return resultado;
  }
}

// Arma y guarda un evento local (pesaje/sanidad/reproducción) — mismas
// columnas que trae la tabla real, para que la ficha del animal (que lee
// de cache_eventos sin distinguir origen) lo muestre exactamente igual
// que uno que ya vino del servidor. Devuelve el id temporal, para que
// quien llama arme su "limpiarAlSincronizar".
async function _aplicarEventoLocal(animalId, tipo, datosOriginales, camposExtra){
  const user = requireSesion();
  const idLocal = 'local-evt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const evento = {
    id: idLocal, animal_id: animalId, tipo,
    fecha: datosOriginales.fecha || new Date().toISOString().slice(0, 10),
    notas: datosOriginales.notas || null,
    registrado_por: user.id, created_at: new Date().toISOString(),
    _pendienteSync: true,
    ...camposExtra,
  };
  await idbUpsertUno('cache_eventos', evento);
  return idLocal;
}

// Pesaje offline actualiza también "peso_actual_kg" del animal en la
// caché — si no, la ficha seguiría mostrando el peso viejo hasta la
// próxima vez que hubiera señal para refrescar de verdad.
async function _actualizarCampoAnimalLocal(animalId, campos){
  const enCache = await idbTodo('cache_animales');
  const animal = enCache.find((a) => String(a.id) === String(animalId));
  if (animal) await idbUpsertUno('cache_animales', { ...animal, ...campos });
}

// Mapeo tipo → función real, para cuando el outbox le toca el turno a
// cada entrada. Cuerpos idénticos a como eran antes registrarPesaje() etc.
// llamaban a Supabase directo — se sacaron a funciones aparte para poder
// reusarlas tanto en el camino "online, de una" como acá.
async function _onlineRegistrarAnimalDirecto(datosAnimal, ganaderoId){
  const { data, error } = await _conTimeout(supabaseClient.rpc('registrar_animal_directo', {
    p_datos_animal: datosAnimal, p_ganadero_id: ganaderoId,
  }));
  if (error) throw new Error(error.message);
  // El servidor decide con qué rancho quedó etiquetado el animal
  // (perfiles.rancho_actual_id AL MOMENTO de guardar — ver
  // registrar_animal_directo(), 20260917150000_ranchos.sql). Si la
  // sesión en memoria quedó desincronizada de esa por cualquier motivo
  // (falló un fetch, se pisó con la caché vieja de localStorage, etc.),
  // el animal recién creado quedaba invisible en misAnimales() — filtra
  // por rancho_actual_id de la sesión, y ese no coincidía con el que el
  // servidor le puso de verdad al animal. Se corrige acá mismo, apenas
  // se sabe cuál es el correcto, sin esperar a que algo más la
  // refresque sola.
  if (_sesionCache && data && data.rancho_id != null && _sesionCache.rancho_actual_id !== data.rancho_id) {
    _sesionCache = { ..._sesionCache, rancho_actual_id: data.rancho_id };
  }
  // misAnimales() es "caché primero" (responde YA con lo que ya tenía
  // guardado, y solo DESPUÉS pisa la caché con lo real en segundo plano
  // — ver el comentario ahí) — sin esto, el animal recién creado no
  // aparecía hasta la SIGUIENTE vez que se pedía la lista con la caché
  // ya vacía o refrescada, que en la práctica era "recargar la página".
  // Guardando la fila completa ACÁ MISMO, la próxima misAnimales() (la
  // que dispara la propia pantalla al volver a "Mis animales" apenas se
  // guarda) ya la encuentra.
  if (data && data.animal_id != null) {
    const { data: filaCompleta } = await supabaseClient.from('animales').select('*').eq('id', data.animal_id).single();
    if (filaCompleta) await idbUpsertUno('cache_animales', filaCompleta);
  }
  return data;
}
// Las 3 registrar_*() del servidor son "returns void" — no devuelven la
// fila nueva, así que no hay un id puntual para meter en la caché como
// en _onlineRegistrarAnimalDirecto(). En cambio, se vuelve a pedir TODO
// el historial de ESE animal (acotado, no todo el rebaño) y se pisa la
// caché con eso — mismo motivo: sin esto, el evento recién guardado no
// aparecía en la ficha ni en Sanidad/Pesaje/Reproducción hasta que algo
// más refrescara la caché sola (en la práctica, recargar la página).
async function _refrescarEventosDeAnimalEnCache(animalId){
  try {
    const { data, error } = await supabaseClient.from('eventos_animal').select('*').eq('animal_id', animalId);
    if (!error && data) await idbUpsertTodos('cache_eventos', data);
  } catch (err) { /* sin conexión momentánea — la próxima lectura ya se encarga de reintentar */ }
}
async function _onlineRegistrarPesaje(animalId, datos){
  const { error } = await _conTimeout(supabaseClient.rpc('registrar_pesaje', {
    p_animal_id: animalId, p_peso_kg: datos.peso_kg, p_condicion_corporal: datos.condicion_corporal,
    p_altura_cm: datos.altura_cm ? parseFloat(datos.altura_cm) : null,
    p_fecha: datos.fecha || null, p_notas: datos.notas || null,
  }));
  if (error) throw new Error(error.message);
  await _refrescarEventosDeAnimalEnCache(animalId);
  return { ok: true };
}
async function _onlineRegistrarSanidad(animalId, datos){
  const { error } = await _conTimeout(supabaseClient.rpc('registrar_sanidad', {
    p_animal_id: animalId, p_tipo: datos.tipo.trim(),
    p_producto: datos.producto || null, p_lote_producto: datos.lote_producto || null,
    p_dosis: datos.dosis || null, p_veterinario: datos.veterinario || null,
    p_dias_retiro: datos.dias_retiro ? parseInt(datos.dias_retiro, 10) : null,
    p_fecha: datos.fecha || null, p_notas: datos.notas || null,
  }));
  if (error) throw new Error(error.message);
  await _refrescarEventosDeAnimalEnCache(animalId);
  return { ok: true };
}
async function _onlineRegistrarReproduccion(animalId, datos){
  const { error } = await _conTimeout(supabaseClient.rpc('registrar_reproduccion', {
    p_animal_id: animalId, p_tipo: datos.tipo.trim(),
    p_semental: datos.semental || null, p_veterinario: datos.veterinario || null,
    p_fecha: datos.fecha || null, p_notas: datos.notas || null,
    p_resultado: datos.resultado || null, p_fecha_probable_parto: datos.fecha_probable_parto || null,
    p_sexo_cria: datos.sexo_cria || null, p_peso_cria_kg: datos.peso_cria_kg || null,
  }));
  if (error) throw new Error(error.message);
  await _refrescarEventosDeAnimalEnCache(animalId);
  return { ok: true };
}
async function _onlineRegistrarProduccionLeche(animalId, datos){
  const { error } = await _conTimeout(supabaseClient.rpc('registrar_produccion_leche', {
    p_animal_id: animalId, p_litros: datos.litros,
    p_turno: datos.turno || null, p_fecha: datos.fecha || null, p_notas: datos.notas || null,
  }));
  if (error) throw new Error(error.message);
  await _refrescarEventosDeAnimalEnCache(animalId);
  return { ok: true };
}
// A diferencia de las 5 de arriba, estas 5 devuelven algo que el
// outbox necesita mirar para reconciliar ids locales: crearLote()
// devuelve "lote_id" (equivalente al "animal_id" que ya devolvía
// _onlineRegistrarAnimalDirecto), y las otras 4 reciben un lote_id que
// puede venir apuntando a uno todavía local — Supabase lo rechaza tal
// cual, pero para entonces _reescribirIdEnOutbox() ya lo tiene que haber
// corregido en la cola (ver el orden en procesarOutbox()).
async function _onlineCrearLote(datos){
  const { data: id, error } = await _conTimeout(supabaseClient.rpc('crear_lote', {
    p_nombre: datos.nombre, p_tipo: datos.tipo, p_categoria: datos.categoria,
    p_notas: datos.notas, p_animal_ids: datos.animalIds,
  }));
  if (error) throw new Error(error.message);
  const { data: fila, error: errFila } = await _conTimeout(supabaseClient.from('lotes').select('*').eq('id', id).single());
  if (errFila) throw new Error(errFila.message);
  await idbUpsertUno('cache_lotes', fila);
  return { ...fila, lote_id: fila.id };
}
async function _onlineAgregarAnimalesALote(loteId, animalIds){
  const { error } = await _conTimeout(supabaseClient.rpc('agregar_animales_a_lote', {
    p_lote_id: loteId, p_animal_ids: animalIds,
  }));
  if (error) throw new Error(error.message);
  await idbUpsertTodos('cache_lote_animales', animalIds.map(aid => ({ id: `${loteId}:${aid}`, lote_id: loteId, animal_id: aid })));
  return { ok: true };
}
async function _onlineQuitarAnimalDeLote(loteId, animalId){
  const { error } = await _conTimeout(supabaseClient.rpc('quitar_animal_de_lote', {
    p_lote_id: loteId, p_animal_id: animalId,
  }));
  if (error) throw new Error(error.message);
  await idbBorrarUno('cache_lote_animales', `${loteId}:${animalId}`);
  return { ok: true };
}
async function _onlineRegistrarReproduccionLote(loteId, datos){
  const { data, error } = await _conTimeout(supabaseClient.rpc('registrar_reproduccion_lote', {
    p_lote_id: loteId, p_tipo: datos.tipo, p_semental: datos.semental,
    p_veterinario: datos.veterinario, p_fecha: datos.fecha, p_notas: datos.notas,
  }));
  if (error) throw new Error(error.message);
  return data;
}
async function _onlineRegistrarSanidadLote(loteId, datos){
  const { data, error } = await _conTimeout(supabaseClient.rpc('registrar_sanidad_lote', {
    p_lote_id: loteId, p_tipo: datos.tipo, p_producto: datos.producto,
    p_lote_producto: datos.lote_producto, p_dosis: datos.dosis, p_veterinario: datos.veterinario,
    p_dias_retiro: datos.dias_retiro, p_fecha: datos.fecha, p_notas: datos.notas,
  }));
  if (error) throw new Error(error.message);
  return data;
}
const ACCIONES_OFFLINE = {
  registrarAnimalDirecto: (args) => _onlineRegistrarAnimalDirecto(...args),
  registrarPesaje: (args) => _onlineRegistrarPesaje(...args),
  registrarSanidad: (args) => _onlineRegistrarSanidad(...args),
  registrarReproduccion: (args) => _onlineRegistrarReproduccion(...args),
  registrarProduccionLeche: (args) => _onlineRegistrarProduccionLeche(...args),
  crearLote: (args) => _onlineCrearLote(...args),
  agregarAnimalesALote: (args) => _onlineAgregarAnimalesALote(...args),
  quitarAnimalDeLote: (args) => _onlineQuitarAnimalDeLote(...args),
  registrarReproduccionLote: (args) => _onlineRegistrarReproduccionLote(...args),
  registrarSanidadLote: (args) => _onlineRegistrarSanidadLote(...args),
};

// Etiqueta legible para la pantalla de "Pendientes de sincronizar" —
// nadie quiere ver "registrarAnimalDirecto" crudo en su celular.
function _descripcionAccionOffline(entrada){
  const [primerArg, segundoArg] = entrada.args || [];
  switch (entrada.tipo) {
    case 'registrarAnimalDirecto':
      return `Registro de animal — ${(primerArg && (primerArg.chip_uid || primerArg.numero_interno)) || '(sin identificar)'}`;
    case 'registrarPesaje':
      return `Pesaje — ${(segundoArg && segundoArg.peso_kg) || '?'} kg`;
    case 'registrarSanidad':
      return `Sanidad — ${(segundoArg && segundoArg.tipo) || '(sin tipo)'}`;
    case 'registrarReproduccion':
      return `Reproducción — ${(segundoArg && segundoArg.tipo) || '(sin tipo)'}`;
    case 'registrarProduccionLeche':
      return `Producción de leche — ${(segundoArg && segundoArg.litros) || '?'} L`;
    case 'crearLote':
      return `Lote nuevo — ${(primerArg && primerArg.nombre) || '(sin nombre)'}`;
    case 'agregarAnimalesALote':
      return `Sumar ${(segundoArg && segundoArg.length) || 0} animal(es) al lote`;
    case 'quitarAnimalDeLote':
      return 'Sacar un animal de un lote';
    case 'registrarReproduccionLote':
      return `Reproducción en bloque — ${(segundoArg && segundoArg.tipo) || '(sin tipo)'}`;
    case 'registrarSanidadLote':
      return `Sanidad en bloque — ${(segundoArg && segundoArg.tipo) || '(sin tipo)'}`;
    default:
      return entrada.tipo;
  }
}

// Cuando un alta offline sincroniza de verdad (un animal nuevo, o desde
// esta sesión también un lote nuevo), cualquier otra acción que siguiera
// en la cola apuntando a su id temporal ("local-..."/"local-lote-...")
// se reescribe con el id real recién asignado — así, cuando le toque su
// turno, ya sale con el id correcto en vez de fallar porque ese id nunca
// existió en el servidor. Busca el id temporal en CUALQUIER posición de
// "args" (no solo la primera) porque agregarAnimalesALote() lo recibe
// como lote_id en args[0] PERO TAMBIÉN puede traer ids de animales
// locales adentro del array animalIds en args[1] (alta de animal +
// sumarlo al lote, las dos cosas offline en la misma visita).
async function _reescribirIdEnOutbox(idTemporal, idReal){
  const db = await abrirOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    const req = store.getAll();
    req.onsuccess = () => {
      req.result.forEach((entrada) => {
        let cambio = false;
        const reemplazar = (v) => {
          if (v === idTemporal) { cambio = true; return idReal; }
          if (Array.isArray(v)) return v.map(reemplazar);
          return v;
        };
        if (entrada.args) entrada.args = entrada.args.map(reemplazar);
        if (cambio) store.put(entrada);
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Si un alta offline (animal o lote) termina fallando de verdad al
// sincronizar (no por conexión — por ejemplo, otro dispositivo ya usó ese
// chip primero), cualquier acción que se le hubiera cargado encima
// offline tampoco puede llegar a ningún lado (nunca existió de verdad
// del lado del servidor) — se cancela junto con ella en vez de quedar
// trabada en la cola para siempre. "tablaCache" es de dónde borrar la
// fila optimista huérfana (cache_animales o cache_lotes).
async function _cancelarDependientesDeLocal(idTemporal, tablaCache){
  const pendientes = await idbTodo('outbox');
  const dependeDe = (e) => (e.args || []).some((v) => v === idTemporal || (Array.isArray(v) && v.includes(idTemporal)));
  const dependientes = pendientes.filter(dependeDe);
  for (const dep of dependientes) {
    if (dep.limpiarAlSincronizar) for (const { tabla, clave } of dep.limpiarAlSincronizar) await idbBorrarUno(tabla, clave);
    await idbBorrarUno('outbox', dep.id);
  }
  await idbBorrarUno(tablaCache, idTemporal);
}

let _sincronizando = false;
async function procesarOutbox(){
  if (_sincronizando || !navigator.onLine) return;
  _sincronizando = true;
  let huboCambios = false;
  try {
    const entradas = (await idbTodo('outbox')).sort((a, b) => a.id - b.id);
    for (const entrada of entradas) {
      if (!navigator.onLine) break;
      try {
        const resultadoOnline = await ACCIONES_OFFLINE[entrada.tipo](entrada.args);
        if (entrada.idLocalAnimal && resultadoOnline && resultadoOnline.animal_id) {
          await _reescribirIdEnOutbox(entrada.idLocalAnimal, resultadoOnline.animal_id);
        }
        if (entrada.idLocalLote && resultadoOnline && resultadoOnline.lote_id) {
          await _reescribirIdEnOutbox(entrada.idLocalLote, resultadoOnline.lote_id);
        }
        if (entrada.limpiarAlSincronizar) for (const { tabla, clave } of entrada.limpiarAlSincronizar) await idbBorrarUno(tabla, clave);
        await idbBorrarUno('outbox', entrada.id);
        huboCambios = true;
        window.dispatchEvent(new CustomEvent('ganado-cola-cambio'));
      } catch (err) {
        if (_pareceErrorDeConexion(err)) break; // se reintenta solo, no se pierde el orden
        // Error de negocio real al sincronizar — no se puede reintentar
        // solo. Se saca de la cola, se avisa, y si era un alta (de animal
        // o de lote) se cancela también todo lo que dependía de ella.
        if (entrada.idLocalAnimal) await _cancelarDependientesDeLocal(entrada.idLocalAnimal, 'cache_animales');
        if (entrada.idLocalLote) await _cancelarDependientesDeLocal(entrada.idLocalLote, 'cache_lotes');
        if (entrada.limpiarAlSincronizar) for (const { tabla, clave } of entrada.limpiarAlSincronizar) await idbBorrarUno(tabla, clave);
        await idbBorrarUno('outbox', entrada.id);
        huboCambios = true;
        // Queda anotado PERSISTENTE (no solo el toast, que si no lo veías
        // en el momento se perdía para siempre) — así el ganadero lo
        // puede revisar cuando quiera desde Inicio, no solo si estaba
        // mirando la pantalla justo en el instante en que pasó.
        await idbAgregarFallo({ tipo: entrada.tipo, descripcion: _descripcionAccionOffline(entrada), motivo: err.message, fecha: new Date().toISOString() });
        window.dispatchEvent(new CustomEvent('ganado-cola-cambio'));
        if (typeof toast === 'function') toast(`No se pudo sincronizar una acción pendiente — ${err.message}`, '⚠️');
      }
    }
  } finally {
    _sincronizando = false;
    // Dos condiciones, no una sola: "hubo cambios" (nunca forzar un
    // re-render de la nada, en cada tick del intervalo de 20s) Y "la
    // sesión ya se confirmó al menos una vez" (_sesionListo, ver
    // shared/auth-supabase.js). Esto último es el que importa de verdad:
    // procesarOutbox() se llama SOLO al cargar la página, ANTES incluso de
    // que la primera consulta de sesión termine — un renderApp() de acá en
    // ese instante leía mockApi.sesionActual() como null (todavía no se
    // sabía si había sesión o no, no es que no la hubiera) y la app
    // redirigía por las dudas, cortando en el aire su propia consulta de
    // sesión real en danza. Loop clásico: se va, la otra página tampoco
    // llega a confirmar a tiempo, vuelve, y así.
    if (huboCambios && typeof renderApp === 'function' && typeof _sesionListo !== 'undefined' && _sesionListo) renderApp();
  }
}

window.addEventListener('online', procesarOutbox);
// Además del evento "online" (solo dispara en la transición real de sin
// conexión a con conexión): un intento al abrir la app, por si quedaron
// pendientes de una sesión anterior; cuando la pestaña vuelve a primer
// plano (se guardó algo con la pantalla apagada y después se reabre); y
// un reintento cada 20s como red de seguridad — Safari/iOS no soporta la
// Background Sync API real, así que no conviene depender solo del evento.
document.addEventListener('visibilitychange', () => { if (!document.hidden) procesarOutbox(); });
procesarOutbox();
setInterval(procesarOutbox, 20000);

// Refresca el pool de chips reservados mientras haya señal — se llama
// sola al iniciar sesión y cada vez que se sincroniza algo (ver
// bindEvents() en ganadero/app.js).
async function sincronizarChipsReservados(){
  try { await mockApi.misChipsReservados(); } catch (err) { /* sin conexión: la caché existente sigue sirviendo */ }
}
window.addEventListener('online', sincronizarChipsReservados);
window.addEventListener('ganado-cola-cambio', sincronizarChipsReservados);

// ===== Helpers de presentación (compartidos por cualquier UI) =====
function etiquetaRol(r){ return { ganadero:'Ganadero', admin:'Admin' }[r] || r; }
function etiquetaEstadoAnimal(e){ return { vivo:'Vivo', vendido:'Vendido', sacrificado:'Sacrificado', baja:'Baja' }[e] || e; }
function etiquetaTipoEvento(t){ return { alta:'🆕 Alta', traslado:'🚚 Traslado', sanidad:'💉 Sanidad', reproduccion:'🐄 Reproducción', baja:'⚰️ Baja', pesaje:'⚖️ Pesaje' }[t] || t; }

// Un animal con período de retiro vigente no debería venderse ni
// sacrificarse todavía (el medicamento puede dejar residuo en la carne) —
// lo consultan tanto la ficha del ganadero (abrirFichaAnimal()) como
// Monitoreo del técnico (renderResultadoMonitoreo()), mismo cálculo en
// los dos lugares. Si hay más de uno vigente, el que vence más tarde
// manda (es el que más tiempo hay que esperar).
function retiroActivoHoy(eventosAnimal){
  const hoy = new Date().toISOString().slice(0, 10);
  return eventosAnimal
    .filter(e => e.tipo === 'sanidad' && e.retiro_hasta && e.retiro_hasta >= hoy)
    .sort((a, b) => b.retiro_hasta.localeCompare(a.retiro_hasta))[0] || null;
}
function etiquetaCondicionCorporal(n){ return { 1:'1 · Muy flaco', 2:'2 · Flaco', 3:'3 · Óptimo', 4:'4 · Gordo', 5:'5 · Muy gordo' }[n] || n; }
function etiquetaEstadoChip(e){ return { en_stock:'En stock', asignado:'Asignado', invalidado:'Invalidado' }[e] || e; }
// Ya no la usa nadie (era una lectura síncrona sobre localStorage, de
// cuando "perfiles" vivía ahí) — se reemplazó por mapaNombresPerfiles()
// en shared/view-generic.js, que trae la tabla real de una vez y arma un
// mapa id→nombre para usar sincrónico dentro de un .map(). Queda comentada
// acá como referencia de qué reemplazó a qué.
// function nombrePerfil(id){ ... }

// Etiqueta para mostrar un animal donde antes se usaba un "nombre" — ya no
// se le pide nombre al animal (ver camposDatosAnimal en shared/ui-common.js),
// así que se identifica con lo primero que exista: el N° interno del
// ganadero (lo más probable, es lo que él mismo usa), si no el chip
// oficial, y si no hay nada, el sexo.
function etiquetaAnimal(a){
  if (!a) return '(desconocido)';
  return a.numero_interno || a.chip_uid || (a.sexo === 'macho' ? 'Macho sin identificar' : a.sexo === 'hembra' ? 'Hembra sin identificar' : 'Sin identificar');
}

// Categoría bovina por edad + sexo — becerro/a (menor a 12 meses),
// novillo/a (1 a 2 años) y toro/vaca (2 años o más). Son los cortes que
// usa la mayoría de las asociaciones ganaderas de la región para separar
// el rebaño más allá de "macho/hembra" — ajustables acá si la tuya usa
// otros. Es una categoría CALCULADA, no una columna guardada: un animal
// cambia de categoría solo con el paso del tiempo, así que calcularla al
// vuelo (acá y en el servidor, ver categoriaBovinoSql() en las
// migraciones que la necesiten) evita tener que andar actualizándola a
// mano o con un job aparte. Sin fecha de nacimiento no se puede calcular
// la edad, así que cae en "Sin clasificar" en vez de asumir cualquier cosa.
function categoriaBovino(sexo, fechaNacimiento){
  if (!fechaNacimiento) return 'Sin clasificar';
  const meses = (Date.now() - new Date(fechaNacimiento + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  if (meses < 0) return 'Sin clasificar'; // fecha de nacimiento cargada a futuro por error
  if (sexo === 'macho') return meses < 12 ? 'Becerro' : meses < 24 ? 'Novillo' : 'Toro';
  if (sexo === 'hembra') return meses < 12 ? 'Becerra' : meses < 24 ? 'Novilla' : 'Vaca';
  return 'Sin clasificar';
}

function fmtFecha(iso){ return new Date(iso).toLocaleString('es-MX', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }

// Los eventos "clásicos" (alta/traslado/sanidad/baja) guardan fecha+hora
// completa (new Date().toISOString()); un pesaje se carga con un
// <input type="date"> — solo el día. Pasar eso por fmtFecha() de todos
// modos mostraría un "00:00" que no significa nada, así que acá se
// distingue por el largo del string en vez de por el tipo de evento.
function fmtFechaEvento(fecha){
  return fecha.length <= 10
    ? new Date(fecha + 'T00:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })
    : fmtFecha(fecha);
}

// Escape de HTML — CUALQUIER texto que venga de un usuario (nombre,
// motivo de baja, notas, raza escrita a mano, etc.) tiene que
// pasar por acá antes de interpolarse en una plantilla que termina en
// innerHTML. Sin esto, alguien podía cargar "<img src=x onerror=...>"
// como nombre o como motivo de una baja y ejecutarlo en el
// navegador de cualquiera que lo viera después — incluido un admin
// mirando "Usuarios", que es el peor caso (correría con su sesión).
// Sirve tanto para texto suelto como para valores dentro de un
// atributo (value="...") porque también escapa comillas.
function esc(valor){
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Un animal/lote creado offline (todavía sin sincronizar) tiene un id
// LOCAL de texto ("local-...", "local-lote-..." — ver
// _aplicarEventoLocal()/registrarAnimalDirecto()/crearLote() más abajo),
// no un número. Varios "onclick" de app.js leen el id desde un atributo
// data-* (siempre texto, venga de donde venga) y antes lo pasaban por
// Number() sin pensarlo — para un id real eso da el número de siempre,
// pero para uno local da NaN, así que abrir la ficha, sumarlo a un lote,
// sacarlo, etc. dejaba de funcionar apenas el animal/lote todavía no
// había sincronizado. Esto es lo que hay que usar en su lugar en
// cualquier data-* que pueda venir de un id local.
function idPropio(valor){
  return /^local-/.test(valor) ? valor : Number(valor);
}

// A pedido: los cuadros negros de confirmación ("Registrado ✅", "Guardado
// ✅", etc.) ya no se muestran — el resultado de la acción ya se ve solo
// en la pantalla (el animal queda en la lista, el pesaje en el
// historial...), no hace falta además un cartel confirmándolo. Se deja
// SOLO lo que de verdad necesita que el ganadero se entere de algo que
// salió mal o requiere su atención (⚠️) — todo lo demás se sigue
// llamando exactamente igual en el resto del código, esto lo filtra en
// un solo lugar en vez de tener que tocar cada llamada.
function toast(msg, emoji = 'ℹ️'){
  if (emoji !== '⚠️') return;
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = emoji + ' ' + msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}
