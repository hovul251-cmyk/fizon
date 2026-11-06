// Обновления Fizion: ты пушишь код на GitHub → GitHub собирает новую версию →
// здесь это замечается и появляется «Вышла новая версия» с кнопкой «Обновить».
//  - Windows: новая сборка из GitHub Releases (подписанная), ставится и перезапускает приложение;
//  - веб: version.json рядом с сайтом; «Обновить» просто перезагружает вкладку на новую версию;
//  - Android: последний релиз на GitHub; «Обновить» скачивает новый APK, Android предлагает его установить.

import { checkUpdate } from './desktop';
import { IS_DESKTOP_APP, IS_TAURI } from './platform';

declare const __APP_VERSION__: string;

/** Версия, которая сейчас запущена */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

export interface Update {
  version: string;
  notes: string;
  /** Скачать и применить. Для Windows — с процентами загрузки. */
  install(onProgress?: (percent: number) => void): Promise<void>;
}

/** Репозиторий GitHub с релизами (его прописывает сборка на GitHub) */
const REPO = (import.meta.env.VITE_GITHUB_REPO ?? '').trim();
const IS_ANDROID_APP = IS_TAURI && !IS_DESKTOP_APP;

/** Умеет ли эта сборка обновляться сама (в режиме разработки — нет) */
export const canAutoUpdate = () => !import.meta.env.DEV && (IS_DESKTOP_APP || !IS_TAURI || (IS_ANDROID_APP && !!REPO));

/** 0.9.12 новее 0.9.3? */
export function isNewer(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function checkAndroid(): Promise<Update | null> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!r.ok) return null;
  const rel = (await r.json()) as { tag_name?: string; body?: string; assets?: { name: string; browser_download_url: string }[] };
  const version = (rel.tag_name ?? '').replace(/^v/, '');
  const apk = rel.assets?.find((a) => /\.apk$/i.test(a.name));
  if (!version || !apk || !isNewer(version, APP_VERSION)) return null;
  return {
    version,
    notes: rel.body ?? '',
    async install() {
      // скачиваем APK браузером — Android сам предложит установить поверх (данные сохранятся)
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(apk.browser_download_url);
    },
  };
}

async function checkWeb(): Promise<Update | null> {
  const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) return null;
  const info = (await r.json()) as { version?: string; notes?: string };
  if (!info.version || info.version === APP_VERSION) return null;
  return {
    version: info.version,
    notes: info.notes ?? '',
    async install() {
      // подтянуть новый service worker, чтобы он не отдал старую страницу из кэша
      const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
      await reg?.update().catch(() => undefined);
      location.reload();
    },
  };
}

/** Проверить прямо сейчас. null — новой версии нет (или проверка не удалась). */
export async function checkForUpdate(): Promise<Update | null> {
  if (!canAutoUpdate()) return null;
  try {
    if (IS_DESKTOP_APP) return await checkUpdate();
    if (IS_ANDROID_APP) return await checkAndroid();
    return await checkWeb();
  } catch {
    return null;
  }
}

const FIRST_CHECK_MS = 5_000;
const EVERY_MS = 15 * 60_000;
const ON_FOCUS_AFTER_MS = 2 * 60_000;

/**
 * Проверять обновления само: через 5 секунд после запуска, потом каждые 15 минут
 * и когда возвращаешься в окно. Как только нашлась новая версия — вызывает onFound и перестаёт проверять.
 */
export function watchUpdates(onFound: (u: Update) => void): () => void {
  if (!canAutoUpdate()) return () => undefined;
  let last = 0;
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    last = Date.now();
    const u = await checkForUpdate();
    if (u && !stopped) {
      stop();
      onFound(u);
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && Date.now() - last > ON_FOCUS_AFTER_MS && void run();
  const first = window.setTimeout(() => void run(), FIRST_CHECK_MS);
  const timer = window.setInterval(() => void run(), EVERY_MS);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  const stop = () => {
    stopped = true;
    window.clearTimeout(first);
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onVisible);
  };
  return stop;
}

// ── найденное обновление: его показывают и баннер, и настройки
let found: Update | null = null;
const listeners = new Set<() => void>();
export const foundUpdate = () => found;
export const onFoundUpdate = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export function setFoundUpdate(u: Update | null) {
  found = u;
  listeners.forEach((fn) => fn());
}
