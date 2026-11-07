// Доступ к микрофону, камере и уведомлениям.
// Телефоны (особенно iPhone) спрашивают разрешение только по нажатию человека, поэтому
// разрешения выдаются в Настройки → Разрешения кнопкой, а не сами при входе в звонок.

import { IS_TAURI } from './platform';

export type PermKind = 'microphone' | 'camera' | 'notifications';
/** granted — можно; denied — запрещено (снять запрет можно только в настройках браузера/телефона);
 *  prompt — ещё не спрашивали; insecure — сайт открыт по http, браузер не даёт доступ вообще; unsupported — нет в этом браузере */
export type PermState = 'granted' | 'denied' | 'prompt' | 'insecure' | 'unsupported';

const IS_IOS = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const IS_ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
export const STANDALONE = typeof matchMedia !== 'undefined' && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

const secure = () => typeof isSecureContext === 'undefined' || isSecureContext;

/** Узнать состояние разрешения, ничего не спрашивая у человека */
export async function permState(kind: PermKind): Promise<PermState> {
  if (!secure()) return 'insecure';
  if (kind === 'notifications') {
    if (!('Notification' in window)) return 'unsupported';
    const p = Notification.permission;
    return p === 'default' ? 'prompt' : p;
  }
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const st = await navigator.permissions.query({ name: kind as PermissionName });
    return st.state;
  } catch {
    // Firefox и старые Safari не умеют спрашивать про микрофон — смотрим, видны ли названия устройств
    const devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const want = kind === 'microphone' ? 'audioinput' : 'videoinput';
    return devs.some((d) => d.kind === want && d.label) ? 'granted' : 'prompt';
  }
}

/** Следить за изменением разрешения (человек разрешил в настройках браузера) */
export function watchPerm(kind: PermKind, cb: () => void): () => void {
  if (kind === 'notifications' || !navigator.permissions?.query) return () => undefined;
  let st: PermissionStatus | null = null;
  let off = false;
  navigator.permissions
    .query({ name: kind as PermissionName })
    .then((s) => {
      if (off) return;
      st = s;
      s.addEventListener('change', cb);
    })
    .catch(() => undefined);
  return () => {
    off = true;
    st?.removeEventListener('change', cb);
  };
}

/** Попросить разрешение. Вызывать прямо из обработчика нажатия — иначе телефон не покажет окно. */
export async function requestPerm(kind: PermKind): Promise<PermState> {
  if (!secure()) return 'insecure';
  if (kind === 'notifications') {
    if (!('Notification' in window)) return 'unsupported';
    const r = await Notification.requestPermission();
    return r === 'default' ? 'prompt' : r;
  }
  if (!navigator.mediaDevices?.getUserMedia) return 'unsupported';
  try {
    const s = await navigator.mediaDevices.getUserMedia(kind === 'microphone' ? { audio: true } : { video: true });
    s.getTracks().forEach((t) => t.stop());
    return 'granted';
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    // устройства нет или оно занято — разрешение при этом могло выдаться
    return permState(kind);
  }
}

/** Ошибка из-за запрета доступа (а не из-за сети или занятого устройства) */
export const isPermissionError = (e: unknown) => /NotAllowedError|Permission denied|permission/i.test(`${(e as Error)?.name ?? ''} ${(e as Error)?.message ?? e}`);

const WHAT: Record<PermKind, string> = { microphone: 'микрофону', camera: 'камере', notifications: 'уведомлениям' };

/** Понятный текст, когда звонок или запись не получили доступ */
export const deniedText = (kind: PermKind) => `Нет доступа к ${WHAT[kind]}. Открой Настройки → Разрешения и нажми «Разрешить»`;

/** Как снять запрет вручную — зависит от устройства */
export function unblockHelp(kind: PermKind): string {
  const name = kind === 'microphone' ? 'Микрофон' : kind === 'camera' ? 'Камера' : 'Уведомления';
  if (IS_TAURI && IS_ANDROID) return `Настройки телефона → Приложения → Neon → Разрешения → ${name} → Разрешить. Потом вернись сюда и нажми «Проверить».`;
  if (IS_TAURI) return `Параметры Windows → Конфиденциальность и защита → ${name} → разреши доступ для классических приложений.`;
  if (IS_IOS) {
    if (kind === 'notifications') return STANDALONE ? 'Настройки iPhone → Уведомления → Neon → Допуск уведомлений.' : 'На iPhone уведомления работают, только если добавить Neon на экран «Домой»: кнопка «Поделиться» → «На экран Домой».';
    return `В Safari нажми «аА» слева от адреса → «Настройки веб-сайта» → ${name} → «Разрешить». Или Настройки iPhone → Safari → ${name}.`;
  }
  if (IS_ANDROID) return `Нажми на значок слева от адреса сайта → «Разрешения» → ${name} → «Разрешить». Потом обнови страницу.`;
  return `Нажми на значок замка слева от адреса сайта → ${name} → «Разрешить», потом обнови страницу.`;
}
