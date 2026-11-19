// =====================================================================
// Notificaciones push (Web Push, VAPID) — la parte que vive en el
// navegador: pedir permiso, suscribirse contra el service worker ya
// registrado, y guardar esa suscripción en Supabase (shared/data.js).
// La clave pública VAPID es justamente eso, PÚBLICA — no hay problema en
// que viaje en el HTML (la privada nunca sale de la Edge Function).
//
// Lo que decide CUÁNDO mandar un push (parto próximo, retiro por
// vencer, recordatorio del calendario) todavía no está armado — ver el
// comentario grande en supabase/migrations/20260926090000_notificaciones_push.sql.
// Esto solo deja el dispositivo listo para RECIBIR uno.
// =====================================================================

const VAPID_PUBLIC_KEY = 'BIAQBgi2fOQasWx_uTT7xBA-jK3n8V0U4LROoOVq5wWwE30_G5JfPBMNjaVFrDbgXa-MCGeLTymWk3n_HSkCQZ0';

// pushManager.subscribe() pide la clave como Uint8Array, no como el
// string base64url que da VAPID — conversión estándar, la misma que usa
// cualquier ejemplo de Web Push.
function claveVapidComoUint8Array(base64url){
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const salida = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) salida[i] = raw.charCodeAt(i);
  return salida;
}

function notificacionesSoportadas(){
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

// Pide permiso (si hace falta), se suscribe contra el service worker de
// ESTA app (ganadero o administración — cada una ya registró el suyo
// antes, ver shared/instalar.js) y guarda la suscripción. Devuelve la
// suscripción si quedó activa, o lanza con un mensaje claro si no.
async function activarNotificacionesPush(){
  if (!notificacionesSoportadas()) {
    throw new Error('Este navegador no admite notificaciones — probá desde Chrome en Android o en la compu.');
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    throw new Error(permiso === 'denied'
      ? 'Bloqueaste las notificaciones para esta app — para activarlas tenés que habilitarlas desde el navegador.'
      : 'No se activaron las notificaciones.');
  }
  const registro = await navigator.serviceWorker.ready;
  let sub = await registro.pushManager.getSubscription();
  if (!sub) {
    sub = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: claveVapidComoUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await mockApi.guardarSuscripcionPush(sub.toJSON());
  return sub;
}

// Desactiva en ESTE dispositivo — no toca otros celulares/PCs que la
// misma cuenta pueda tener activados aparte.
async function desactivarNotificacionesPush(){
  if (!notificacionesSoportadas()) return;
  const registro = await navigator.serviceWorker.ready;
  const sub = await registro.pushManager.getSubscription();
  if (!sub) return;
  await sub.unsubscribe();
  await mockApi.eliminarSuscripcionPush(sub.endpoint);
}
