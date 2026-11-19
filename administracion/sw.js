// Service worker mínimo para que "Instalar app" funcione y quede un
// ícono real en el teléfono o el escritorio, y para que la app ABRA sin
// señal. Cache-first del shell propio (HTML/CSS/JS) — la ÚNICA cosa que
// nunca se cachea es la API de Supabase en sí (*.supabase.co: auth,
// rest, rpc — datos VIVOS, cachearlos de acá serviría una respuesta
// vieja como si fuera fresca, mismo aprendizaje que costó caro en
// Planificador de Potreros). Eso es distinto de la LIBRERÍA de
// supabase-js que se trae de jsdelivr.net — ese archivo es un asset
// estático como cualquier .js propio, así que SÍ se precachea: sin él,
// "supabaseClient" ni se llega a crear (bug real, encontrado 2026-09-18
// — antes esta lista ni siquiera incluía supabase-config.js/
// supabase-client.js/auth-supabase.js, y jsdelivr.net entero quedaba
// excluido del cache-first).
// Subir código nuevo NO alcanza para que quien ya visitó/instaló la app lo
// vea: cache-first sirve lo que ya tenía guardado antes de pedir nada a la
// red (ver el fetch handler más abajo), así que sigue mostrando el shell
// viejo hasta la visita SIGUIENTE a la que lo pisó. "activate" solo borra
// cachés con un nombre distinto al de acá — por eso cada vez que cambie
// algo del shell (index.html, styles.css, o cualquier shared/*.js de la
// lista de abajo) hay que subir también este número de versión, para que
// el navegador lo trate como caché nueva y baje todo de cero de una.
const CACHE_NAME = 'ganado-registro-administracion-v52';
const SHELL = [
  './', './index.html', './manifest.json', './icon-192.png?v=2', './icon-512.png?v=2',
  './icon-192-maskable.png', './icon-512-maskable.png',
  '../supabase-config.js', '../shared/supabase-client.js', '../shared/auth-supabase.js',
  '../shared/data.js', '../shared/ui-common.js', '../shared/view-generic.js', '../shared/instalar.js', '../shared/styles.css',
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
