// Copiar como "supabase-config.js" (ese archivo real NO se sube a git) y
// completar con los datos del proyecto — Project Settings → API en el
// dashboard de Supabase.
//
// La "anon key" es pública por diseño: viaja en el HTML, y la seguridad
// real la da Row Level Security (RLS) en la base de datos, no que esta
// clave sea secreta. La "service_role key", en cambio, SE SALTA todas las
// políticas de RLS — esa jamás debe aparecer en el frontend ni en este
// archivo.
const SUPABASE_URL = 'https://krmzykgzmcgnjvsicaaq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_bXIMHv6T-mVyyswqv1NL1Q_tD-ghmNl';
