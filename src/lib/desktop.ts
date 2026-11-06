// Возможности приложения для Windows: автозапуск, обновления, показать окно из трея.
// В браузере всё это просто недоступно (функции возвращают null).

import { IS_DESKTOP_APP as IS_TAURI } from './platform';

type TauriWindow = { show(): Promise<void>; unminimize(): Promise<void>; setFocus(): Promise<void> };

/** Показать и поднять окно (оно могло быть спрятано в трей) */
export async function showWindow() {
  if (!IS_TAURI) return;
  const t = (window as unknown as { __TAURI__?: { window: { getCurrentWindow(): TauriWindow } } }).__TAURI__;
  const w = t?.window.getCurrentWindow();
  await w?.show().catch(() => undefined);
  await w?.unminimize().catch(() => undefined);
  await w?.setFocus().catch(() => undefined);
}

export async function getAutostart(): Promise<boolean | null> {
  if (!IS_TAURI) return null;
  try {
    const m = await import('@tauri-apps/plugin-autostart');
    return await m.isEnabled();
  } catch {
    return null;
  }
}

export async function setAutostart(on: boolean) {
  if (!IS_TAURI) return;
  const m = await import('@tauri-apps/plugin-autostart');
  if (on) await m.enable();
  else await m.disable();
}

export interface AppUpdate {
  version: string;
  notes: string;
  install(onProgress?: (percent: number) => void): Promise<void>;
}

/** Есть ли новая версия на GitHub Releases. null — нет или обновления не настроены. */
export async function checkUpdate(): Promise<AppUpdate | null> {
  if (!IS_TAURI) return null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const u = await check();
    if (!u) return null;
    return {
      version: u.version,
      notes: u.body ?? '',
      async install(onProgress) {
        let total = 0;
        let got = 0;
        await u.downloadAndInstall((e) => {
          if (e.event === 'Started') total = e.data.contentLength ?? 0;
          if (e.event === 'Progress') {
            got += e.data.chunkLength;
            if (total) onProgress?.(Math.round((got / total) * 100));
          }
        });
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      },
    };
  } catch {
    return null;
  }
}
