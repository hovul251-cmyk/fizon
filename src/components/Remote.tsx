import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ME } from '../data';
import { Icon } from '../icons';
import * as rc from '../online/remotectl';
import { setUi, useStore } from '../store';
import type { VideoTrackLike } from '../types';
import { IconButton, usePerson } from './common';

// Удалённое управление в звонке: кнопка «Попросить управление», окно согласия по центру,
// красная плашка «Тобой управляют» и большое окно управления у гостя.

const useRemote = () => useSyncExternalStore(rc.onRemote, rc.remoteState);

/** Кто из собеседников сейчас показывает экран (не я) */
function useSharer() {
  const videos = useStore((s) => s.ui.videos);
  return Object.entries(videos).find(([id, v]) => id !== ME && v.screen)?.[0] ?? null;
}

/** Кнопка в панели звонка: попросить управление ПК того, кто показывает экран */
export function RemoteRequestButton({ size }: { size?: number }) {
  const sharer = useSharer();
  const st = useRemote();
  const who = usePerson(sharer ?? ME);
  if (!sharer) return null;
  if (st.controlling === sharer) return <IconButton icon="mouse" label="Закончить управление" active size={size} onClick={() => void rc.releaseControl()} />;
  return (
    <IconButton
      icon="mouse"
      label={st.asking ? 'Ждём ответа…' : `Попросить управление ПК ${who?.name ?? ''}`}
      active={!!st.asking}
      size={size}
      onClick={() => {
        if (st.asking) return;
        void rc.requestControl(sharer);
        setUi({ toast: { text: `Спросили ${who?.name ?? 'собеседника'} — ждём ответа`, id: Date.now() } });
      }}
    />
  );
}

type Monitor = { x: number; y: number; w: number; h: number; primary: boolean };

/** Живёт в App: окно «Дать управление?» и красная плашка, пока тобой управляют */
export function RemoteHost() {
  const st = useRemote();
  const [ask, setAsk] = useState<{ from: string; monitors: Monitor[]; resolve: (r: { ok: boolean; monitor?: number }) => void } | null>(null);
  const [mon, setMon] = useState(0);
  const [left, setLeft] = useState(30);
  const controller = usePerson(st.controller ?? ME);
  const asker = usePerson(ask?.from ?? ME);

  useEffect(() => {
    rc.setRemoteToast((text) => setUi({ toast: { text, id: Date.now() } }));
    rc.setAskHandler(async (from) => {
      type Invoke = (c: string) => Promise<Monitor[]>;
      const inv = (window as unknown as { __TAURI__?: { core: { invoke: Invoke } } }).__TAURI__?.core.invoke;
      const monitors = (await inv?.('list_monitors').catch(() => [])) ?? [];
      return new Promise((resolve) => {
        setMon(0);
        setLeft(30);
        setAsk({ from, monitors, resolve });
      });
    });
    return () => void rc.setAskHandler(null);
  }, []);

  useEffect(() => {
    if (!ask) return;
    const t = window.setInterval(() => setLeft((n) => (n <= 1 ? (answer(false), 0) : n - 1)), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  const answer = (ok: boolean) => {
    ask?.resolve({ ok, monitor: mon });
    setAsk(null);
  };

  return (
    <>
      {ask && (
        <div className="center-prompt-wrap">
          <div className="center-prompt" role="alertdialog" aria-modal="true" aria-label="Запрос управления">
            <span className="cp-ico danger">
              <Icon name="mouse" size={30} />
            </span>
            <h2>{asker?.name ?? 'Собеседник'} просит управление твоим компьютером</h2>
            <div className="cp-text">
              Он сможет двигать мышь, нажимать и печатать на твоём ПК и будет видеть то, что ты показываешь. Давай доступ только тем, кому доверяешь.
              <br />
              <b>Остановить в любой момент: Ctrl+Alt+X</b> или кнопка на красной плашке.
            </div>
            {ask.monitors.length > 1 && (
              <label className="field left">
                КАКОЙ ЭКРАН ТЫ ПОКАЗЫВАЕШЬ
                <select className="input" value={mon} onChange={(e) => setMon(Number(e.target.value))}>
                  {ask.monitors.map((m, i) => (
                    <option key={i} value={i}>
                      Экран {i + 1} — {m.w}×{m.h}
                      {m.primary ? ' (основной)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="cp-actions">
              <button type="button" className="btn ghost" autoFocus onClick={() => answer(false)}>
                Отказать ({left})
              </button>
              <button type="button" className="btn danger" onClick={() => answer(true)}>
                Дать управление
              </button>
            </div>
          </div>
        </div>
      )}
      {st.controller && (
        <div className="remote-banner" role="status">
          <Icon name="mouse" size={16} />
          <span className="grow">
            <b>{controller?.name ?? 'Собеседник'}</b> управляет твоим компьютером · <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>X</kbd> — остановить
          </span>
          <button type="button" className="btn small" onClick={() => void rc.stopHosting()}>
            Остановить
          </button>
        </div>
      )}
      <RemoteSession />
    </>
  );
}

function SessionVideo({ track, onEl }: { track: VideoTrackLike; onEl: (el: HTMLVideoElement | null) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current!;
    track.attach(el);
    onEl(el);
    return () => {
      track.detach(el);
      onEl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);
  return <video ref={ref} className="rs-video" autoPlay playsInline muted />;
}

/** У гостя: большое окно с экраном собеседника — всё, что делаешь мышью и клавиатурой здесь, уходит к нему */
function RemoteSession() {
  const st = useRemote();
  const video = useStore((s) => (st.controlling ? s.ui.videos[st.controlling] : undefined));
  const who = usePerson(st.controlling ?? ME);
  const el = useRef<HTMLVideoElement | null>(null);
  const layer = useRef<HTMLDivElement>(null);
  const last = useRef(0);

  useEffect(() => {
    if (st.controlling && video && !video.screen) void rc.releaseControl();
  }, [st.controlling, video]);
  useEffect(() => {
    if (st.controlling) layer.current?.focus();
  }, [st.controlling]);

  if (!st.controlling || !video) return null;

  /** Координаты курсора → доля кадра (с учётом чёрных полос по краям) */
  const pos = (e: { clientX: number; clientY: number }) => {
    const v = el.current;
    if (!v || !v.videoWidth) return null;
    const r = v.getBoundingClientRect();
    const k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight);
    const w = v.videoWidth * k;
    const h = v.videoHeight * k;
    const x = (e.clientX - (r.left + (r.width - w) / 2)) / w;
    const y = (e.clientY - (r.top + (r.height - h) / 2)) / h;
    if (x < 0 || y < 0 || x > 1 || y > 1) return null;
    return { x, y };
  };

  return (
    <div className="remote-session" role="dialog" aria-label={`Управление ПК ${who?.name ?? ''}`}>
      <div className="rs-top">
        <Icon name="mouse" size={16} />
        <span className="grow">
          Ты управляешь компьютером <b>{who?.name}</b>. Мышь и клавиатура работают внутри окна.
        </span>
        <button type="button" className="btn small danger" onClick={() => void rc.releaseControl()}>
          Закончить
        </button>
      </div>
      <div
        ref={layer}
        className="rs-stage"
        tabIndex={0}
        onContextMenu={(e) => e.preventDefault()}
        onPointerMove={(e) => {
          const now = performance.now();
          if (now - last.current < 16) return;
          last.current = now;
          const p = pos(e);
          if (p) rc.sendInput({ t: 'move', ...p });
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          layer.current?.focus();
          const p = pos(e);
          if (p) rc.sendInput({ t: 'down', ...p, b: e.button });
        }}
        onPointerUp={(e) => {
          const p = pos(e);
          if (p) rc.sendInput({ t: 'up', ...p, b: e.button });
        }}
        onWheel={(e) => rc.sendInput({ t: 'wheel', dy: Math.round(e.deltaY) })}
        onKeyDown={(e) => {
          // Ctrl+Alt+X — стоп-комбинация хозяина, её не передаём
          if (e.ctrlKey && e.altKey && e.code === 'KeyX') return;
          e.preventDefault();
          rc.sendInput({ t: 'key', code: e.code, down: true, text: e.key.length === 1 ? e.key : undefined });
        }}
        onKeyUp={(e) => {
          e.preventDefault();
          rc.sendInput({ t: 'key', code: e.code, down: false });
        }}
      >
        <SessionVideo track={video.track} onEl={(v) => (el.current = v)} />
      </div>
    </div>
  );
}
