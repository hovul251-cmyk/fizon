// Push-уведомления для веб-версии и телефона: приходят, даже когда вкладка или приложение закрыты.
// Отправляет их функция fizion-events на сервере, показывает service worker (public/sw.js).

import { IS_TAURI } from './platform';

const urlB64 = (s: string) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => !IS_TAURI && 'serviceWorker' in navigator && 'PushManager' in window && !!import.meta.env.VITE_VAPID_PUBLIC_KEY;

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Включить push на этом устройстве. Возвращает текст ошибки или null. */
export async function subscribePush(save: (sub: PushSubscriptionJSON) => Promise<void>): Promise<string | null> {
  if (IS_TAURI) return 'В приложении для Windows уведомления приходят, пока Neon работает в трее';
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'Этот браузер не умеет push. На iPhone сначала добавь Neon на экран «Домой» и открой оттуда';
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!key) return 'Push не настроен на сервере — выполни npm run setup';
  if ((await Notification.requestPermission()) !== 'granted') return 'Уведомления запрещены — разреши их в настройках браузера для этого сайта';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) }));
  await save(sub.toJSON());
  return null;
}

export async function unsubscribePush(remove: (endpoint: string) => Promise<void>) {
  const sub = await currentSubscription();
  if (!sub) return;
  await remove(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
