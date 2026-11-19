// Service worker de Huella de carbono. Solo hace que la app sea instalable; no guarda respuestas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
