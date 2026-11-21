// =====================================================================
// Portada única de "Agricultura inteligente".
//
// Un solo login (Supabase, el mismo de Gana ID) sirve para las dos apps.
// - Sin sesión: la portada muestra la información y el botón de
//   "Iniciar sesión" / "Registrarse", que abren el mismo formulario de
//   Gana ID (bloqueAccesoCuenta / bindAccesoCuenta de shared/ui-common.js).
// - Con sesión: la portada muestra el selector de app. Gana ID entra según
//   el rol (admin -> administracion/, ganadero -> ganadero/). Agricultura inteligente
//   vive en potreros/ del mismo dominio, así que comparte la sesión.
// =====================================================================

const RUTA_GANAID = {
  administracion: './administracion/index.html',
  ganadero: './ganadero/index.html',
};
const RUTA_GANADER_AI = './potreros/index.html';

function $(id) { return document.getElementById(id); }

function modalAbierto() { return !$('modalAcceso').hidden; }

function abrirAcceso(vista) {
  _accesoVista = vista;
  $('modalAcceso').hidden = false;
  pintarAcceso();
  const primerCampo = $('cuerpoAcceso').querySelector('input');
  if (primerCampo) primerCampo.focus();
}

function cerrarAcceso() {
  $('modalAcceso').hidden = true;
  $('cuerpoAcceso').innerHTML = '';
}

function pintarAcceso() {
  if (_accesoVista === 'registro') { pintarRegistroPortal(); return; }
  $('cuerpoAcceso').innerHTML = bloqueAccesoCuenta();
  bindAccesoCuenta();
}

// --- Registro interactivo de la portal: 3 pasos con opciones seleccionables e íconos ---
// Solo para la portal. Gana ID conserva su formulario compartido (shared/ui-common.js).
let registroPaso = 1;
const registroDatos = { ocupacion: '', intereses: [], nombre: '', email: '', municipio: '' };

// Íconos de contorno (trazo neón) para la ocupación
const ICONO_TRAZO = (d) => `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#00FF9D" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const REGISTRO_OCUPACIONES = [
  ['productor', 'Productor o ganadero', 'Manejo un rancho o un hato', ICONO_TRAZO('<path d="M3 11l9-7 9 7v9H3z"/><path d="M9 20v-6h6v6"/>')],
  ['familiar', 'Familia productora', 'Crío animales en el traspatio o en el solar', ICONO_TRAZO('<circle cx="8" cy="8" r="3"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><circle cx="17" cy="9" r="2.5"/><path d="M15 21v-.5a4.5 4.5 0 0 1 7 0"/>')],
  ['tecnico', 'Técnico o asesor', 'Acompaño a productores en campo', ICONO_TRAZO('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><path d="M9 12h6M9 16h6"/>')],
  ['veterinario', 'Veterinario o zootecnista', 'Trabajo con salud y manejo animal', ICONO_TRAZO('<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/><path d="M12 9v5M9.5 11.5h5"/>')],
  ['investigador', 'Investigador o estudiante', 'Desarrollo o estudio tecnología para el campo', ICONO_TRAZO('<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>')],
  ['otro', 'Otro', 'Me interesa el campo por otra razón', ICONO_TRAZO('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>')],
];

// Íconos de las herramientas: los mismos de la app
const ICONO_LIBRO = ICONO_TRAZO('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 8h7M8 11h7"/>');
const REGISTRO_INTERESES = [
  ['potreros', 'Monitoreo de cultivos', '<img src="assets/cesped.png" alt="" aria-hidden="true">'],
  ['chip', 'Trazabilidad con chip (SINIIGA)', '<img src="assets/ganaid-azul.png" alt="" aria-hidden="true">'],
  ['peso', 'Pesaje por imagen', '<img src="assets/pesaje-naranja.png" alt="" aria-hidden="true">'],
  ['huella', 'Huella de carbono', '<img src="assets/huella-icono-sostenible.png" alt="" aria-hidden="true">'],
  ['investigacion', 'Investigación y publicaciones', ICONO_LIBRO],
];

function registroGuardarCampos() {
  const n = document.getElementById('regNombre');
  const e = document.getElementById('regEmail');
  const m = document.getElementById('regMunicipio');
  if (n) registroDatos.nombre = n.value;
  if (e) registroDatos.email = e.value;
  if (m) registroDatos.municipio = m.value;
}

function registroAviso(texto) {
  const a = document.getElementById('regAviso');
  if (a) a.textContent = texto || '';
}

function pintarRegistroPortal() {
  const titulos = ['Tu ocupación', 'Lo que te interesa', 'Tus datos'];
  const subtitulos = [
    'Elige la opción que mejor te describe.',
    'Puedes elegir varias. Lo puedes cambiar después.',
    'Solo te pedimos lo necesario para crear tu cuenta.',
  ];
  let cuerpo = '';
  if (registroPaso === 1) {
    cuerpo = `<div class="reg-grid">${REGISTRO_OCUPACIONES.map(([v, t, d, ico]) =>
      `<button type="button" class="reg-opcion${registroDatos.ocupacion === v ? ' activa' : ''}" data-ocupacion="${v}"><span class="reg-ico">${ico}</span><b>${t}</b><span class="reg-desc">${d}</span></button>`
    ).join('')}</div>`;
  } else if (registroPaso === 2) {
    cuerpo = `<div class="reg-grid">${REGISTRO_INTERESES.map(([v, t, ico]) =>
      `<button type="button" class="reg-chip${registroDatos.intereses.includes(v) ? ' activa' : ''}" data-interes="${v}"><span class="reg-ico">${ico}</span><b>${t}</b></button>`
    ).join('')}</div>`;
  } else {
    cuerpo = `<div class="reg-datos">
      <label class="reg-campo">Nombre<input id="regNombre" required placeholder="Tu nombre" value="${escaparHtml(registroDatos.nombre)}"></label>
      <label class="reg-campo">Correo<input id="regEmail" type="email" required placeholder="tu@email.com" autocomplete="email" value="${escaparHtml(registroDatos.email)}"></label>
      <label class="reg-campo">Contraseña<input id="regPassword" type="password" required minlength="6" placeholder="Al menos 6 caracteres" autocomplete="new-password"></label>
      <label class="reg-campo">Municipio<input id="regMunicipio" placeholder="Ej. Jojutla" value="${escaparHtml(registroDatos.municipio)}"></label>
    </div>`;
  }
  const barra = [1, 2, 3].map((p) => `<span class="${p <= registroPaso ? 'hecho' : ''}"></span>`).join('');
  const izquierda = registroPaso > 1
    ? '<button type="button" class="secundario" data-reg-atras>Atrás</button>'
    : '<button type="button" class="secundario" data-acceso-login>Ya tengo cuenta</button>';
  const derecha = registroPaso < 3
    ? '<button type="button" class="primario" data-reg-siguiente>Siguiente</button>'
    : '<button type="submit" class="primario" id="regCrear">Crear cuenta</button>';
  $('cuerpoAcceso').innerHTML = `
    <form id="formRegistroPortal" class="reg-wizard">
      <div class="reg-barra" aria-hidden="true">${barra}</div>
      <p class="reg-paso">Paso ${registroPaso} de 3</p>
      <h3 class="reg-titulo">${titulos[registroPaso - 1]}</h3>
      <p class="reg-subtitulo">${subtitulos[registroPaso - 1]}</p>
      ${cuerpo}
      <p class="reg-aviso" id="regAviso" role="alert"></p>
      <div class="reg-acciones">${izquierda}${derecha}</div>
    </form>`;
  bindRegistroPortal();
}

function bindRegistroPortal() {
  const form = document.getElementById('formRegistroPortal');
  form.querySelectorAll('[data-ocupacion]').forEach((b) => b.onclick = () => {
    registroDatos.ocupacion = b.dataset.ocupacion;
    pintarRegistroPortal();
  });
  form.querySelectorAll('[data-interes]').forEach((b) => b.onclick = () => {
    const v = b.dataset.interes;
    const i = registroDatos.intereses.indexOf(v);
    if (i >= 0) registroDatos.intereses.splice(i, 1); else registroDatos.intereses.push(v);
    pintarRegistroPortal();
  });
  const atras = form.querySelector('[data-reg-atras]');
  if (atras) atras.onclick = () => { registroGuardarCampos(); registroPaso--; pintarRegistroPortal(); };
  const siguiente = form.querySelector('[data-reg-siguiente]');
  if (siguiente) siguiente.onclick = () => {
    registroGuardarCampos();
    if (registroPaso === 1 && !registroDatos.ocupacion) return registroAviso('Elige la opción que mejor te describe.');
    registroPaso++;
    pintarRegistroPortal();
  };
  const login = form.querySelector('[data-acceso-login]');
  if (login) login.onclick = () => { _accesoVista = 'login'; pintarAcceso(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    registroGuardarCampos();
    const password = document.getElementById('regPassword').value;
    if (!registroDatos.nombre.trim()) return registroAviso('Falta tu nombre.');
    if (!registroDatos.email.trim()) return registroAviso('Falta tu correo.');
    if (password.length < 6) return registroAviso('La contraseña necesita al menos 6 caracteres.');
    const boton = document.getElementById('regCrear');
    boton.disabled = true;
    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email: registroDatos.email.trim(),
        password,
        options: { data: {
          nombre: registroDatos.nombre.trim(),
          municipio: registroDatos.municipio.trim(),
          rancho_o_empresa: '',
          telefono: '',
          ocupacion: registroDatos.ocupacion,
          intereses: registroDatos.intereses,
        } },
      });
      if (error) throw new Error(error.message);
      if (!data.session) toast('Cuenta creada. Revisa tu correo para confirmarla antes de entrar', '📩');
      else toast('Cuenta creada', '✅');
      registroPaso = 1;
      cerrarAcceso();
    } catch (err) {
      registroAviso(err.message);
    } finally {
      boton.disabled = false;
    }
  };
}


function pintarSeccionApps(session) {
  const cont = $('apps-contenido');
  if (!session) {
    cont.innerHTML = `
      <div class="apps-bloqueado">
        <p>Inicia sesión una sola vez y entra a cualquiera de las dos apps con la misma cuenta.</p>
        <button type="button" class="primario" data-accion="login">Iniciar sesión</button>
        <button type="button" class="secundario" data-accion="registro">Crear mi cuenta</button>
      </div>`;
    return;
  }
  const rutaGanaid = session.rol === 'admin' ? RUTA_GANAID.administracion : RUTA_GANAID.ganadero;
  const nombre = (session.nombre || session.email || '').toString();
  cont.innerHTML = `
    <div class="apps-grid">
      <article class="app-tarjeta">
        <span class="app-icono-combo" aria-hidden="true"><img class="base" src="assets/cesped.png" alt=""><img class="base2" src="assets/cesped.png" alt=""><img class="sat" src="assets/satelite.webp" alt=""><img class="maiz b1" src="assets/maiz-cultivo.gif" alt=""></span>
        <h3>Agricultura inteligente</h3>
        <p class="app-subtitulo">Monitoreo de cultivos</p>
        <ul>
          <li>Monitoreo de cultivos con imágenes satelitales</li>
          <li>Vigor, humedad y agua de cada cultivo y lote</li>
          <li>Lotes y seguimiento de cultivos de distintos tipos</li>
          <li>Pesaje y conteo por imagen con visión por computadora</li>
        </ul>
      </article>
      <article class="app-tarjeta oculto">
        <img class="app-icono-img" src="assets/ganaid-azul.png" alt="" aria-hidden="true">
        <h3>Gana ID</h3>
        <p class="app-subtitulo">Trazabilidad con chip</p>
        <ul>
          <li>Optimiza el manejo y el uso de los datos de cada animal</li>
          <li>Historial: traslados, sanidad, pesajes y bajas</li>
          <li>Compatible con chip RFID; aretes SINIIGA</li>
          <li>Cuentas de ganadero y de administración</li>
        </ul>
      </article>
      <article class="app-tarjeta oculto">
        <img class="app-icono-img" src="assets/pesaje-naranja.png" alt="" aria-hidden="true">
        <h3>Pesaje por imagen</h3>
        <p class="app-subtitulo">Estimación de peso con cámara</p>
        <ul>
          <li>Estima el peso del ganado desde una foto o video</li>
          <li>Calibración con pesos reales de báscula</li>
          <li>Conteo de animales con visión por computadora</li>
        </ul>
      </article>
      <article class="app-tarjeta oculto">
        <img class="app-icono-img" src="assets/huella-icono-sostenible.png" alt="" aria-hidden="true">
        <h3>Huella de carbono</h3>
        <p class="app-subtitulo">Metano del hato con tus datos</p>
        <ul>
          <li>Calcula el metano entérico con los animales y pesos de Gana ID</li>
          <li>Desglose por categoría de animal</li>
          <li>Supuestos ajustables y claramente etiquetados</li>
        </ul>
      </article>
      <article class="app-tarjeta">
        <img class="app-icono-img" src="assets/icono-ia-blanco.png" alt="" aria-hidden="true">
        <h3>Detección con IA</h3>
        <p class="app-subtitulo">Plantas, enfermedades y preguntas</p>
        <ul>
          <li>Detecta plantas y enfermedades desde una foto</li>
          <li>Haz preguntas sobre manejo de tus cultivos</li>
        </ul>
      </article>
      <article class="app-tarjeta">
        <img class="app-icono-img" src="assets/icono-mapa.png" alt="" aria-hidden="true">
        <h3>Mapa de alertas</h3>
        <p class="app-subtitulo">Clima y vista satelital</p>
        <ul>
          <li>Olas de calor, heladas, lluvia intensa y viento fuerte</li>
          <li>Vista satelital y calles en un solo mapa</li>
        </ul>
      </article>
      <article class="app-tarjeta">
        <img class="app-icono-img" src="assets/icono-inventario.png" alt="" aria-hidden="true">
        <h3>Inventario de insumos</h3>
        <p class="app-subtitulo">Agroquímicos y fertilizantes con código de barras</p>
        <ul>
          <li>Registra cada producto escaneando su código de barras</li>
          <li>Descuenta lo aplicado a cada cultivo y lleva el stock</li>
        </ul>
      </article>
    </div>
    <p class="apps-salir"><button type="button" class="enlace" data-accion="salir">Cerrar sesión</button></p>`;
}

function pintarNavegacionCuenta(session) {
  const sinSesion = $('nav-sin-sesion');
  const conSesion = $('nav-con-sesion');
  sinSesion.hidden = !!session;
  conSesion.hidden = !session;
}

function escaparHtml(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderApp() {
  const session = mockApi.sesionActual();
  pintarNavegacionCuenta(session);
  pintarSeccionApps(session);
  if (session) {
    cerrarAcceso();
  } else if (modalAbierto()) {
    pintarAcceso();
  }
}

// Clics delegados: navegación, botones de la sección de apps y el modal.
document.addEventListener('click', async (e) => {
  const accion = e.target.closest('[data-accion]')?.dataset.accion;
  if (accion === 'login') return abrirAcceso('login');
  if (accion === 'registro') return abrirAcceso('registro');
  if (accion === 'demo') { $('modalDemo').hidden = false; return; }
  if (e.target.closest('[data-cerrar-demo]') || e.target.id === 'modalDemo') { $('modalDemo').hidden = true; return; }
  if (accion === 'salir') {
    await mockApi.logout();
    return;
  }
  if (e.target.closest('[data-cerrar-acceso]') || e.target.id === 'modalAcceso') return cerrarAcceso();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalAbierto()) cerrarAcceso();
});

// Mantiene el selector de app y el botón de cuenta sincronizados con la sesión.
esperarSesionInicial().then(renderApp);
