import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { askNotifyPermission, canNotify, notifyPermission } from '../lib/notify';
import { IS_DESKTOP_APP } from '../lib/platform';
import { checkForUpdate, setFoundUpdate, type Update } from '../lib/updates';
import { useStore } from '../store';
import { Mascot } from './Mascot';

// Окна-вопросы по центру экрана: «Разрешить уведомления?», «Дать управление?», проверка обновлений при запуске.
// Вместо маленьких системных окошек сайта в углу — крупная карточка посередине, как в приложениях.

export interface PromptOpts {
  icon?: IconName;
  title: string;
  text: ReactNode;
  yes?: string;
  no?: string;
  danger?: boolean;
  /** Через сколько секунд ответить «нет» само (например, запрос управления) */
  timeout?: number;
}

type Pending = PromptOpts & { id: number; resolve: (ok: boolean) => void };
let queue: Pending[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
let seq = 0;

/** Спросить человека по центру экрана. true — согласился. */
export function askPermission(opts: PromptOpts): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...opts, id: ++seq, resolve }];
    emit();
  });
}
function answer(id: number, ok: boolean) {
  const p = queue.find((x) => x.id === id);
  queue = queue.filter((x) => x.id !== id);
  emit();
  p?.resolve(ok);
}

export function PromptHost() {
  const list = useSyncExternalStore(
    (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    () => queue,
  );
  const p = list[0];
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!p?.timeout) return;
    setLeft(p.timeout);
    const t = window.setInterval(() => setLeft((n) => (n <= 1 ? (answer(p.id, false), 0) : n - 1)), 1000);
    return () => window.clearInterval(t);
  }, [p]);
  if (!p) return null;
  return (
    <div className="center-prompt-wrap" role="presentation">
      <div className="center-prompt" role="alertdialog" aria-modal="true" aria-label={p.title}>
        <span className={`cp-ico ${p.danger ? 'danger' : ''}`}>
          <Icon name={p.icon ?? 'bell'} size={30} />
        </span>
        <h2>{p.title}</h2>
        <div className="cp-text">{p.text}</div>
        <div className="cp-actions">
          <button type="button" className="btn ghost" onClick={() => answer(p.id, false)}>
            {p.no ?? 'Не сейчас'}
            {p.timeout ? ` (${left})` : ''}
          </button>
          <button type="button" className={`btn ${p.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => answer(p.id, true)}>
            {p.yes ?? 'Разрешить'}
          </button>
        </div>
      </div>
    </div>
  );
}

const ASKED_KEY = 'fizion-notify-asked';

/** Сразу после входа — один раз спросить про уведомления (по центру, а не в углу браузера) */
export function useNotifyPrompt() {
  const loggedIn = useStore((s) => s.loggedIn);
  useEffect(() => {
    if (!loggedIn || !canNotify() || notifyPermission() !== 'default') return;
    let asked = false;
    try {
      asked = !!localStorage.getItem(ASKED_KEY);
    } catch {
      /* без localStorage спросим каждый раз */
    }
    if (asked) return;
    const t = window.setTimeout(async () => {
      try {
        localStorage.setItem(ASKED_KEY, '1');
      } catch {
        /* ничего */
      }
      const ok = await askPermission({
        icon: 'bell',
        title: 'Включить уведомления?',
        text: 'Узнаешь о новых сообщениях и звонках, даже когда Neon свёрнут. Выключить можно в любой момент в настройках.',
        yes: 'Включить',
      });
      if (ok) await askNotifyPermission();
    }, 1500);
    return () => window.clearTimeout(t);
  }, [loggedIn]);
}

/** При запуске приложения на компьютере: сначала проверяем обновления */
export function StartupUpdate() {
  const [state, setState] = useState<'checking' | 'found' | 'done'>(IS_DESKTOP_APP && !import.meta.env.DEV ? 'checking' : 'done');
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (state !== 'checking') return;
    let done = false;
    const finish = (u: Update | null) => {
      if (done) return;
      done = true;
      if (u) {
        setFoundUpdate(u);
        setUpdate(u);
        setState('found');
      } else setState('done');
    };
    // нет интернета или GitHub долго отвечает — не держим человека дольше 6 секунд
    const t = window.setTimeout(() => finish(null), 6000);
    void checkForUpdate()
      .then(finish)
      .catch(() => finish(null))
      .finally(() => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (state === 'done') return null;
  return (
    <div className="startup-update" role="dialog" aria-modal="true" aria-label="Проверка обновлений">
      <div className="su-card">
        <Mascot size={110} mood={state === 'found' ? 'wow' : 'look'} />
        {state === 'checking' ? (
          <>
            <h2>Проверяю обновления…</h2>
            <span className="muted small">Это пара секунд</span>
            <span className="su-bar indeterminate">
              <i />
            </span>
          </>
        ) : (
          <>
            <h2>Вышла версия {update?.version}</h2>
            <span className="muted small">{error || (progress !== null ? `Загружаю… ${progress}%. Neon перезапустится сам.` : update?.notes.trim().split('\n')[0]?.slice(0, 160) || 'Обновление займёт меньше минуты.')}</span>
            {progress !== null && (
              <span className="su-bar">
                <i style={{ width: `${progress}%` }} />
              </span>
            )}
            <div className="cp-actions">
              <button type="button" className="btn ghost" disabled={progress !== null} onClick={() => setState('done')}>
                Позже
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={progress !== null}
                onClick={async () => {
                  setError('');
                  setProgress(0);
                  try {
                    await update!.install(setProgress);
                  } catch {
                    setProgress(null);
                    setError('Не получилось обновиться. Проверь интернет и попробуй ещё раз.');
                  }
                }}
              >
                Обновить сейчас
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
