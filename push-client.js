// push-client.js — pedir permiso de notificaciones y suscribir al cliente
// (Fase 4). Requiere que auth-client.js ya haya cargado (usa window.AuthClient
// para saber si hay sesión) y que el navegador ya tenga sw.js registrado
// (lo hace index.html del hub — ver site.webmanifest/registro existente).
//
// Este archivo es sólo para el CLIENTE — no tiene nada que ver con el push
// del Panel (otro proyecto, otro service worker, otras claves VAPID).

(function () {
  // Se pide al servidor (no hardcodeada acá) para no desincronizarse del
  // valor real en Cloudflare — es pública, no hay problema en pedirla sin
  // sesión. Se cachea en memoria tras el primer pedido.
  let vapidPublicKeyCache = null;
  async function obtenerVapidPublicKey() {
    if (vapidPublicKeyCache) return vapidPublicKeyCache;
    const res = await fetch('/api/push/vapid-public-key');
    const data = await res.json();
    vapidPublicKeyCache = data.publicKey;
    return vapidPublicKeyCache;
  }

  function base64UrlToUint8Array(base64Url) {
    const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
    const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  async function soportaPush() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  async function estadoActual() {
    if (!(await soportaPush())) return 'no-soportado';
    if (Notification.permission === 'denied') return 'denegado';
    if (Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return sub ? 'activo' : 'permiso-sin-suscribir';
    }
    return 'no-pedido';
  }

  async function activar() {
    if (!(await soportaPush())) throw new Error('Este navegador no soporta notificaciones.');
    const vapidPublicKey = await obtenerVapidPublicKey();
    if (!vapidPublicKey) throw new Error('Falta configurar la clave pública de notificaciones.');
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') throw new Error('No diste permiso de notificaciones.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
      });
    }
    const json = sub.toJSON();
    const res = await fetch('/api/push/suscribir', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    if (!res.ok) throw new Error('No se pudo guardar la suscripción en el servidor.');
    return true;
  }

  async function desactivar() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await fetch('/api/push/desuscribir', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
    return true;
  }

  window.PushClient = { soportaPush, estadoActual, activar, desactivar };
})();
