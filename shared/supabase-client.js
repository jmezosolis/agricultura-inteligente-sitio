// =====================================================================
// Inicializa el cliente de Supabase — un solo lugar, las 3 apps lo cargan
// igual. Requiere, en este orden, que ya estén cargados:
//   1. El script de supabase-js (CDN, ver los <script> en cada index.html)
//   2. supabase-config.js (SUPABASE_URL / SUPABASE_ANON_KEY — ver
//      supabase-config.example.js para cómo armarlo)
//
// Se llama "supabaseClient" (no "supabase" a secas) para no pisar el
// objeto global que trae el script del CDN (que expone su propio
// "supabase.createClient(...)" — si el cliente ya inicializado se llamara
// igual, la segunda carga de esta misma variable rompería todo).
//
// TODAVÍA NO se usa en ningún lado más que acá — shared/data.js sigue
// funcionando 100% contra localStorage (mockApi). Este archivo deja el
// cliente listo y probado para cuando se reemplacen las funciones de
// mockApi por llamadas reales (ver el comentario grande al principio de
// shared/data.js).
// =====================================================================

// Adelanta el DNS + handshake TLS contra el proyecto de Supabase ANTES de
// que la primera consulta real lo necesite (login, perfil, animales...) —
// unos cientos de ms que se notan sobre todo con señal de campo débil.
// Con señal buena no se nota, pero tampoco cuesta nada tenerlo.
try {
  const l = document.createElement('link');
  l.rel = 'preconnect'; l.href = SUPABASE_URL; l.crossOrigin = 'anonymous';
  document.head.appendChild(l);
} catch (err) { /* no crítico si falla — el resto de la app sigue igual */ }

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
