// Где запущен Fizion: окно Tauri на Windows или браузер (компьютер или телефон).

/** Приложение для Windows (в браузере этого объекта нет) */
export const IS_TAURI = typeof window !== 'undefined' && '__TAURI__' in window;

/** Приложение для компьютера (а не Android-сборка Tauri) — у него есть окно, трей и автозапуск */
export const IS_DESKTOP_APP = IS_TAURI && !/Android|iPhone|iPad/i.test(navigator.userAgent);

/** Сенсорный экран без наведения мыши — телефон или планшет */
export const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches;

/** Узкий экран: показываем либо список чатов, либо открытый чат */
export const isNarrow = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches;

/** Офлайн-кэш и установка на главный экран — только для веб-версии */
export function registerServiceWorker() {
  if (IS_TAURI || !('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return;
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}

/** Показ экрана есть в браузерах компьютера и в приложении, но не на телефонах */
export const canShareScreen = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices && !isTouch();
