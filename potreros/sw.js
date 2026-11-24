// Service worker de Milpa Agricultura inteligente. Solo hace que la app sea instalable.
// No guarda ni intercepta respuestas: cada pantalla y cada dato vienen siempre de la red.
// (Una versión anterior con caché dejaba la app en blanco al actualizar.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Sin respondWith: el navegador resuelve la petición normalmente.
});
