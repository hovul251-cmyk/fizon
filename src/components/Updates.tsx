import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from '../icons';
import { IS_DESKTOP_APP, IS_TAURI } from '../lib/platform';
import { APP_VERSION, canAutoUpdate, checkForUpdate, foundUpdate, onFoundUpdate, setFoundUpdate, watchUpdates, type Update } from '../lib/updates';

// «Вышла новая версия» → кнопка «Обновить». Новые версии появляются сами после push на GitHub.

const useFoundUpdate = () => useSyncExternalStore(onFoundUpdate, foundUpdate);

/** Запустить установку и показывать проценты */
function useInstall(update: Update | null) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const install = async () => {
    if (!update) return;
    setError('');
    setProgress(0);
    try {
      await update.install(setProgress);
    } catch {
      setProgress(null);
      setError('Не получилось обновиться. Проверь интернет и попробуй ещё раз.');
    }
  };
  return { progress, error, install };
}

export function UpdateBanner() {
  const update = useFoundUpdate();
  const [hidden, setHidden] = useState<string | null>(null);
  const { progress, error, install } = useInstall(update);
  useEffect(() => watchUpdates(setFoundUpdate), []);
  if (!update || hidden === update.version) return null;
  const notes = update.notes.trim().split('\n')[0]?.slice(0, 140);
  return (
    <div className="update-banner" role="status">
      <span className="update-ico">
        <Icon name="upload" size={18} />
      </span>
      <span className="grow update-text">
        <b>Вышла новая версия Neon {update.version}</b>
        <span className="muted small">
          {progress !== null
            ? IS_DESKTOP_APP
              ? `Загружаю… ${progress}%. Neon перезапустится сам.`
              : 'Обновляю…'
            : error || notes || (IS_DESKTOP_APP ? 'Обновление займёт меньше минуты.' : IS_TAURI ? 'Скачается новый APK — открой его, и Android обновит Neon.' : 'Страница перезагрузится — ничего не потеряется.')}
        </span>
        {progress !== null && IS_DESKTOP_APP && (
          <span className="update-bar">
            <i style={{ width: `${progress}%` }} />
          </span>
        )}
      </span>
      <button type="button" className="btn small primary" disabled={progress !== null} onClick={() => void install()}>
        {progress !== null ? 'Обновляю…' : 'Обновить'}
      </button>
      {progress === null && (
        <button type="button" className="plain" aria-label="Позже" title="Позже" onClick={() => setHidden(update.version)}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

/** Строка в настройках: текущая версия и «Проверить обновления» */
export function UpdateSettings() {
  const update = useFoundUpdate();
  const [state, setState] = useState<'idle' | 'checking' | 'latest'>('idle');
  const { progress, error, install } = useInstall(update);
  const check = async () => {
    setState('checking');
    const u = await checkForUpdate();
    if (u) setFoundUpdate(u);
    setState(u ? 'idle' : 'latest');
  };
  return (
    <div className="list-row big">
      <div className="grow">
        <div className="strong">Neon {APP_VERSION}</div>
        <div className="muted small">
          {!canAutoUpdate()
            ? 'В этой сборке обновления не проверяются (режим разработки или Android-сборка без GitHub).'
            : update
              ? `Доступна версия ${update.version}${progress !== null && IS_DESKTOP_APP ? ` — загружено ${progress}%` : ''}`
              : state === 'checking'
                ? 'Проверяю…'
                : state === 'latest'
                  ? 'У тебя последняя версия.'
                  : 'Новые версии проверяются сами каждые 15 минут.'}
          {error && ` ${error}`}
        </div>
      </div>
      {canAutoUpdate() &&
        (update ? (
          <button type="button" className="btn primary" disabled={progress !== null} onClick={() => void install()}>
            Обновить
          </button>
        ) : (
          <button type="button" className="btn" disabled={state === 'checking'} onClick={() => void check()}>
            Проверить обновления
          </button>
        ))}
    </div>
  );
}
