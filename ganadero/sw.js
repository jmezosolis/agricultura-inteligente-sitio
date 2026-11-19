// Service worker mínimo para que "Instalar app" funcione y quede un
// ícono real en el teléfono o el escritorio, y para que la app ABRA sin
// señal. Cache-first del shell propio (HTML/CSS/JS) — la ÚNICA cosa que
// nunca se cachea es la API de Supabase en sí (*.supabase.co: auth,
// rest, rpc — datos VIVOS, cachearlos de acá serviría una respuesta
// vieja como si fuera fresca, mismo aprendizaje que costó caro en
// Planificador de Potreros). Eso es distinto de la LIBRERÍA de
// supabase-js que se trae de jsdelivr.net — ese archivo es un asset
// estático como cualquier .js propio, así que SÍ se precachea: sin él,
// "supabaseClient" ni se llega a crear, y toda la app se cae apenas no
// hay señal (bug real, encontrado 2026-09-18 — antes esLlamadaExterna()
// excluía jsdelivr.net entero, no solo supabase.co).
const CACHE_NAME = 'ganado-registro-ganadero-v131';
const SHELL = [
  './index.html', './app.js', './tienda.js', './tienda-data.js', './connection-status.js', './styles.css', './tienda.css', './manifest.json', './icon-192.png?v=2', './icon-512.png?v=2',
  "./assets/productos/BWR01H.jpg", "./assets/productos/BWR03F.jpg", "./assets/productos/BWRT02F.jpg",
  "./assets/productos/BWB12.jpg", "./assets/productos/BWB13H.jpg", "./assets/productos/BB12X.png",
  "./assets/productos/BWB32H.jpg", "./assets/productos/APL-01.jpg", "./assets/productos/APL-01B.jpg",
  "./assets/productos/BET01.jpg", "./assets/productos/BET04.jpg", "./assets/productos/BET10.jpg",
  "./assets/productos/ARETE-01.jpg", "./assets/productos/UCS002.jpg", "./assets/productos/BWV02.jpg",
  "./assets/productos/AFR550-AP650.jpg", "./assets/productos/AFR550-AP1000i.jpg", "./assets/productos/AFR402.jpg",
  "./assets/productos/AHR210.jpg", "./assets/productos/AHR206.jpg", "./assets/productos/AHR225.jpg",
  "./assets/productos/AHR220.jpg", "./assets/productos/BST-02.jpg", "./assets/productos/ALR421.jpg",
  "./assets/productos/ALR260P.jpg",
  './icon-192-maskable.png', './icon-512-maskable.png',
  // Estos 3 faltaban — son justo los que arman supabaseClient/la sesión,
  // así que sin ellos precacheados la app ni arrancaba sin señal si el
  // celular nunca los había llegado a cachear "de rebote" (por ejemplo
  // recién instalada, o justo después de una actualización).
  '../supabase-config.js', '../shared/supabase-client.js', '../shared/auth-supabase.js',
  '../shared/data.js', '../shared/ui-common.js', '../shared/instalar.js', '../shared/push.js',
  // La librería de supabase-js en sí — ver el comentario de arriba.
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Solo la API en sí (datos vivos) queda afuera del cache-first de abajo —
// cualquier otro GET (propio o de un CDN, como jsdelivr) sigue el mismo
// criterio de "caché primero, red de refresco en segundo plano".
function esApiDeSupabase(url) {
  return url.hostname.endsWith('supabase.co');
}

// Caché primero, red en segundo plano ("stale-while-revalidate"): con
// señal mala o lenta (el caso típico de uso, en el campo) esto abre la app
// al instante con lo último guardado en vez de esperar a que la red
// responda o haga timeout. La red se pide igual, en paralelo, para que la
// PRÓXIMA visita ya tenga la versión fresca — nunca se espera esa
// respuesta si ya había algo cacheado. Antes era al revés (red primero,
// caché solo si la red fallaba), que es justo lo opuesto de lo que
// conviene con conexión inestable.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || esApiDeSupabase(url)) return;
  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cacheado = await cache.match(e.request);
      const actualizarEnSegundoPlano = fetch(e.request)
        .then((res) => { cache.put(e.request, res.clone()); return res; })
        .catch(() => null);
      return cacheado || (await actualizarEnSegundoPlano) || cache.match('./index.html');
    })
  );
});

// Notificaciones push (Web Push/VAPID) — el navegador entrega el mensaje
// acá, no directo a la página (que puede estar cerrada en ese momento,
// es justo el punto de esto). "data" viene del body que mande la Edge
// Function del lado del servidor (enviar-push) — si el payload no es
// JSON válido o falta, se muestra un genérico en vez de romper.
self.addEventListener('push', (e) => {
  let datos = {};
  try { datos = e.data ? e.data.json() : {}; } catch (err) { /* payload no era JSON — sigue con {} */ }
  const titulo = datos.titulo || 'Gana ID';
  e.waitUntil(
    self.registration.showNotification(titulo, {
      body: datos.cuerpo || '',
      // Sin "badge": ese campo Android lo pinta como silueta sólida de UN
      // color (toma solo la transparencia de la imagen, ignora los colores
      // reales) — con un logo opaco como el nuestro queda un cuadrado sin
      // forma en la pantalla de bloqueo. Sin especificarlo, Android usa su
      // propio ícono genérico ahí en vez de ese bloque feo. El ícono grande
      // (a color, en la notificación expandida) sí se ve bien.
      icon: './icon-192.png',
      data: { url: datos.url || './index.html' },
    })
  );
});

// Tocar la notificación enfoca una pestaña ya abierta de esta app si hay
// una, o abre una nueva — nunca deja la notificación "colgada" sin
// reacción al tocarla.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './index.html', self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      const abierta = lista.find((c) => c.url === url);
      if (abierta) return abierta.focus();
      return self.clients.openWindow(url);
    })
  );
});
