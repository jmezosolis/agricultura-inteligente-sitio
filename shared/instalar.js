// =====================================================================
// Captura el evento nativo de instalación de PWA ("beforeinstallprompt")
// — mismo script en las 2 apps (ganadero/, administracion/), para
// no repetir esta lógica index.html por index.html. Sin esto no pasa nada
// visible: Chrome/Edge deciden con su propia heurística cuándo ofrecerlo,
// no hay forma de forzarlo — lo único que hacemos es quedarnos con el
// evento para poder ofrecerlo nosotros desde el botón "📲 Instalar app"
// (ver bloqueInstalarApp()/bindInstalarApp()/intentarInstalarApp() en
// shared/ui-common.js) en vez de esperar el banner propio del navegador.
// Ese botón vive dentro de la hoja de cada rol (en su viewLogin(), antes
// de iniciar sesión) — un solo lugar para instalar, no uno en la landing
// y otro adentro.
//
// Debe cargarse en cada index.html DESPUÉS de shared/data.js y de
// shared/ui-common.js (usa la función intentarInstalarApp() de ahí). En
// las 3 apps ya está en ese orden. Registra también el service worker de
// esa app (ruta relativa "./sw.js", resuelta contra la página que lo carga).
// =====================================================================

window.__yaInstalada = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
window.__esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
window.__deferredInstallPrompt = null;

(function(){
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__deferredInstallPrompt = e;
    window.dispatchEvent(new CustomEvent('ganado-instalable'));
  });

  window.addEventListener('appinstalled', () => {
    window.__yaInstalada = true;
    window.__deferredInstallPrompt = null;
    window.dispatchEvent(new CustomEvent('ganado-instalable'));
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
  }
})();
