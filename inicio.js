// =====================================================================
// Página principal: un solo formulario de acceso (login + registro), sin
// tener que elegir "tu app" a mano — reemplaza a la vieja landing con
// las 2 tarjetas (Ganadero/Administrador). Apenas hay sesión (recién
// entrada, o ya guardada de una visita anterior), redirige sola según el
// rol de la cuenta: 'admin' -> administracion/, cualquier otra cosa
// ('ganadero') -> ganadero/ — nadie elige, decide el rol.
//
// Comparte bloqueAccesoCuenta()/bindAccesoCuenta() con las 2 apps (ver
// shared/ui-common.js) — mismo formulario de acceso en los 3 lados,
// nada nuevo que mantener acá.
// =====================================================================

async function renderApp(){
  const session = mockApi.sesionActual();
  if (session) {
    redirigirSeguro(session.rol === 'admin' ? './administracion/index.html' : './ganadero/index.html');
    return;
  }
  document.getElementById('app').innerHTML = `
    <div class="wrap">
      <div class="brand">
        <div class="brand-logo-badge">
          <!-- "?v=2" fuerza a que el navegador/CDN de Hostinger lo traten
               como un archivo distinto al de antes, sin esperar a que
               venza el caché de 7 días (ver frontend/.htaccess) — subir
               este número cada vez que se reemplace el logo. -->
          <img src="./ganadero.png?v=2" alt="" class="brand-logo">
        </div>
      </div>
      ${bloqueAccesoCuenta()}
    </div>`;
  bindAccesoCuenta();
}

// Mismo criterio que ganadero/app.js y shared/view-generic.js: esperar a
// que shared/auth-supabase.js confirme si hay sesión o no antes del
// primer render, así nunca se ve el formulario de acceso un instante
// para después saltar redirigiendo si en realidad sí había sesión.
esperarSesionInicial().then(renderApp);
