import { api, IS_DEMO } from './api';

/** Browser push for this device. Works in Chrome, Edge, Firefox and Safari (on iPhone/iPad once WorkMars is added to the Home Screen). */
export const pushSupported = () => !IS_DEMO && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function registerServiceWorker() {
  if (IS_DEMO || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { /* not fatal: push just stays off */ });
}

async function registration() {
  registerServiceWorker();
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const toKey = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Asks permission, subscribes this browser and registers it with the server. */
export async function enablePush(publicKey: string) {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone() ? 'On iPhone and iPad, first tap Share → “Add to Home Screen”, open WorkMars from there, then turn on notifications.' : 'This browser doesn’t support push notifications.');
  if (!window.isSecureContext) throw new Error('Push notifications need a secure (https) address.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.' : 'Notifications weren’t allowed.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made for a different server key can't receive our messages.
  if (sub && sub.options.applicationServerKey) {
    const existing = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (existing !== publicKey.replace(/=+$/, '')) { await sub.unsubscribe(); sub = null; }
  }
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) });
  } catch (err) {
    // Private/incognito windows and some privacy browsers have no push service.
    if ((err as Error).name === 'AbortError' || (err as Error).name === 'NotAllowedError') {
      throw new Error('This browser couldn’t connect to its notification service. If this is a private/incognito window, open WorkMars in a normal window. In Brave, turn on “Use Google services for push messaging” in settings.');
    }
    throw err;
  }
  await api.post('/push/subscribe', sub.toJSON());
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
