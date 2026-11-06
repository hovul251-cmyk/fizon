import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../icons';
import { createPlayer, parseVideoUrl, type Player } from '../lib/players';
import { expectedTime, getWatch, loadWatch, onWatch, pushWatch, startWatch, stopWatch, type WatchSession } from '../online/watch';
import { actions } from '../store';
import { IconButton, Modal, usePerson } from './common';

// «Смотреть вместе» как в Rave: вставляешь ссылку — видео у всех в чате, пауза и перемотка общие.

const useWatch = (chatId: string) => useSyncExternalStore(onWatch, () => getWatch(chatId));

/** Свёрнутые панели и свои файлы (у каждого свой файл на компьютере) */
const hidden = new Set<string>();
const localFiles = new Map<string, { url: string; size: number }>();
const hiddenListeners = new Set<() => void>();
const setHidden = (chatId: string, on: boolean) => {
  if (on) hidden.add(chatId);
  else hidden.delete(chatId);
  hiddenListeners.forEach((fn) => fn());
};
const useHidden = (chatId: string) =>
  useSyncExternalStore(
    (fn) => {
      hiddenListeners.add(fn);
      return () => void hiddenListeners.delete(fn);
    },
    () => hidden.has(chatId),
  );

const fmtSize = (b: number) => (b > 1_073_741_824 ? `${(b / 1_073_741_824).toFixed(1)} ГБ` : `${Math.max(1, Math.round(b / 1_048_576))} МБ`);
const localKey = (chatId: string, s: { src: string; size?: number }) => `${chatId}|${s.src}|${s.size ?? 0}`;

export function WatchButton({ chatId }: { chatId: string }) {
  const s = useWatch(chatId);
  const isHidden = useHidden(chatId);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="film" label="Смотреть вместе" active={!!s && !isHidden} onClick={() => (s ? setHidden(chatId, !isHidden) : setOpen(true))} />
      {open && <WatchStartModal chatId={chatId} onClose={() => setOpen(false)} />}
    </>
  );
}

function WatchStartModal({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const begin = async (v: Parameters<typeof startWatch>[1]) => {
    setHidden(chatId, false);
    onClose();
    await startWatch(chatId, v);
    actions.send(chatId, `🎬 Смотрим вместе: «${v.title}». Нажми 🎬 вверху чата, чтобы присоединиться`);
  };

  const fromUrl = () => {
    const v = parseVideoUrl(url);
    if (!v) return setError('Такую ссылку не получится смотреть вместе. Подходят YouTube, Rutube и прямые ссылки на видео (.mp4, .webm). Фильм на компьютере — нажми «Свой файл».');
    void begin({ ...v, title: v.kind === 'file' ? v.title : `${v.title} · ${url.trim().slice(0, 60)}` });
  };

  return (
    <Modal onClose={onClose} width={480} label="Смотреть вместе" className="composer-modal">
      <div className="modal-head">
        <h2>Смотреть вместе</h2>
        <p className="muted small">Видео откроется у всех в этом чате. Пауза, запуск и перемотка — общие: кто-то нажал паузу, и у всех пауза.</p>
      </div>
      <form
        className="watch-form"
        onSubmit={(e) => {
          e.preventDefault();
          fromUrl();
        }}
      >
        <input
          className="input"
          autoFocus
          aria-label="Ссылка на видео"
          placeholder="Ссылка: YouTube, Rutube или файл .mp4"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError('');
          }}
        />
        <button type="submit" className="btn primary" disabled={!url.trim()}>
          Смотреть
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      <div className="watch-or muted small">или</div>
      <button type="button" className="btn ghost watch-local" onClick={() => fileInput.current?.click()}>
        <Icon name="film" size={18} />
        <span>
          <b>Свой файл с компьютера</b>
          <span className="muted small">Фильм, серия аниме — любого размера. У друга должен быть такой же файл: Fizion попросит его выбрать и синхронизирует время.</span>
        </span>
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="video/*,.mkv"
        hidden
        aria-label="Видеофайл"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          localFiles.set(localKey(chatId, { src: f.name, size: f.size }), { url: URL.createObjectURL(f), size: f.size });
          void begin({ kind: 'local', src: f.name, title: f.name, size: f.size });
        }}
      />
    </Modal>
  );
}

/** Панель над перепиской: само видео и управление */
export function WatchArea({ chatId }: { chatId: string }) {
  const s = useWatch(chatId);
  const isHidden = useHidden(chatId);
  useEffect(() => void loadWatch(chatId), [chatId]);
  if (!s) return null;
  if (isHidden)
    return (
      <div className="watch-bar">
        <Icon name="film" size={16} />
        <span className="grow ellipsis">
          Смотрят вместе: <b>{s.title}</b>
        </span>
        <button type="button" className="btn small primary" onClick={() => setHidden(chatId, false)}>
          Присоединиться
        </button>
      </div>
    );
  return <WatchPanel key={`${s.kind}|${s.src}`} s={s} />;
}

function WatchPanel({ s }: { s: WatchSession }) {
  const chatId = s.chatId;
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const session = useRef(s);
  session.current = s;
  const applying = useRef(0);
  const [needTap, setNeedTap] = useState(false);
  const [changing, setChanging] = useState(false);
  const [local, setLocal] = useState(() => (s.kind === 'local' ? (localFiles.get(localKey(chatId, s)) ?? null) : null));
  const starter = usePerson(s.by);
  const src = s.kind === 'local' ? local?.url : s.src;

  /** Подстроиться под общее состояние */
  const apply = async () => {
    const p = player.current;
    const cur = session.current;
    if (!p) return;
    applying.current = Date.now() + 900;
    const want = expectedTime(cur);
    // на паузе ставим точно в кадр, во время просмотра — не дёргаем из-за долей секунды
    if (Math.abs(p.time() - want) > (cur.playing ? 1 : 0.25)) p.seek(want);
    if (cur.playing && !p.playing()) setNeedTap(!(await p.play()));
    if (!cur.playing && p.playing()) p.pause();
    if (!cur.playing) setNeedTap(false);
  };

  useEffect(() => {
    if (!host.current || !src) return;
    const p = createPlayer(s.kind, src, s.kind === 'youtube' || s.kind === 'rutube' ? expectedTime(session.current) : 0, host.current, (e) => {
      if (e.type === 'ready') return void apply();
      if (Date.now() < applying.current) return;
      setNeedTap(false);
      if (e.type === 'play') void pushWatch(chatId, { playing: true, pos: e.time });
      if (e.type === 'pause' || e.type === 'ended') void pushWatch(chatId, { playing: false, pos: e.time });
      if (e.type === 'seek') void pushWatch(chatId, { playing: player.current?.playing() ?? false, pos: e.time });
    });
    player.current = p;
    return () => {
      p.destroy();
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.kind, src]);

  // кто-то другой нажал паузу, запуск или перемотал
  useEffect(() => {
    void apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.at, s.playing, s.pos]);

  // раз в 3 секунды проверяем, не разошлись ли (интернет, буферизация)
  useEffect(() => {
    let behind = 0;
    const t = window.setInterval(() => {
      const p = player.current;
      const cur = session.current;
      if (!p || !cur.playing || Date.now() < applying.current) return;
      if (Math.abs(p.time() - expectedTime(cur)) > 2) {
        applying.current = Date.now() + 900;
        p.seek(expectedTime(cur));
      }
      behind = p.playing() ? 0 : behind + 1;
      if (behind >= 2) setNeedTap(true); // браузер не дал запустить видео без нажатия
    }, 3000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <section className="watch-panel" aria-label="Смотреть вместе">
      <div className="watch-stage" ref={host}>
        {s.kind === 'local' && !local && (
          <div className="watch-pick">
            <Icon name="film" size={34} />
            <b>Выбери у себя файл «{s.title}»</b>
            <span className="muted small">
              {starter?.name ?? 'Друг'} смотрит свой файл{s.size ? ` (${fmtSize(s.size)})` : ''}. Открой такой же у себя — время синхронизируется само.
            </span>
            <label className="btn primary">
              Выбрать файл
              <input
                type="file"
                accept="video/*,.mkv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const v = { url: URL.createObjectURL(f), size: f.size };
                  localFiles.set(localKey(chatId, s), v);
                  setLocal(v);
                }}
              />
            </label>
          </div>
        )}
        {needTap && (
          <button type="button" className="watch-tap" onClick={() => void player.current?.play().then(() => (setNeedTap(false), apply()))}>
            <Icon name="play" size={30} />
            Подключиться к просмотру
          </button>
        )}
      </div>
      <div className="watch-tools">
        <span className="grow ellipsis">
          <b>{s.title}</b>
          {local && s.size && local.size !== s.size && <span className="watch-warn"> · файл отличается по размеру — время может не совпадать</span>}
        </span>
        <span className={`watch-state ${s.playing ? 'on' : ''}`}>{s.playing ? '● идёт' : 'пауза'}</span>
        <IconButton icon="refresh" label="Другое видео" onClick={() => setChanging(true)} />
        <IconButton icon="chevronUp" label="Свернуть" onClick={() => setHidden(chatId, true)} />
        <IconButton icon="close" label="Выключить для всех" danger onClick={() => confirm('Выключить видео для всех в чате?') && void stopWatch(chatId)} />
      </div>
      {changing && <WatchStartModal chatId={chatId} onClose={() => setChanging(false)} />}
    </section>
  );
}
