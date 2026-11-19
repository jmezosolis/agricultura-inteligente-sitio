// Service worker de Pesaje por imagen. Solo hace que la app sea instalable; no guarda respuestas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Sin respondWith: el navegador resuelve cada petición normalmente.
});
