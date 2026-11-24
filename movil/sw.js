// Service worker de la app Campo Vivo. Solo la hace instalable; no guarda respuestas.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
