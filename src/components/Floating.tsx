import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ME } from '../data';
import { Icon } from '../icons';
import { actions, useStore } from '../store';
import type { VideoTrackLike } from '../types';
import { usePerson } from './common';

// Плавающие окна: свёрнутый звонок и «демка» (показ экрана) из голосовой комнаты.
// Их можно перетащить мышкой или пальцем в любое место — положение запоминается.

type Pos = { x: number; y: number };

const load = (key: string): Pos | null => {
  try {
    const v = JSON.parse(localStorage.getItem(`fizion-float-${key}`) ?? 'null') as Pos | null;
    return v && Number.isFinite(v.x) && Number.isFinite(v.y) ? v : null;
  } catch {
    return null;
  }
};
const save = (key: string, p: Pos | null) => {
  try {
    if (p) localStorage.setItem(`fizion-float-${key}`, JSON.stringify(p));
    else localStorage.removeItem(`fizion-float-${key}`);
  } catch {
    /* без localStorage положение просто не запомнится */
  }
};

/** Не даём окну уехать за край экрана */
function clamp(p: Pos, el: HTMLElement | null): Pos {
  const w = el?.offsetWidth ?? 300;
  const h = el?.offsetHeight ?? 200;
  const pad = 8;
  return { x: Math.min(Math.max(pad, p.x), window.innerWidth - w - pad), y: Math.min(Math.max(pad, p.y), window.innerHeight - h - pad) };
}

/**
 * Сделать окно перетаскиваемым. Тянуть можно за любое место, кроме кнопок и полей.
 * enabled=false — окно стоит на своём обычном месте (например, развёрнуто на весь экран).
 */
export function useDraggable(key: string, enabled = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(() => load(key));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ dx: number; dy: number; sx: number; sy: number; moved: boolean; id: number } | null>(null);

  // окно меньше/экран меньше — подвинуть обратно в видимую область
  useEffect(() => {
    if (!enabled || !pos) return;
    const fix = () => setPos((p) => (p ? clamp(p, ref.current) : p));
    fix();
    window.addEventListener('resize', fix);
    return () => window.removeEventListener('resize', fix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [data-nodrag]')) return;
      const r = ref.current!.getBoundingClientRect();
      drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 5) return;
      if (!d.moved) {
        d.moved = true;
        setDragging(true);
      }
      e.preventDefault();
      setPos(clamp({ x: e.clientX - d.dx, y: e.clientY - d.dy }, ref.current));
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      drag.current = null;
      if (d.moved) {
        setDragging(false);
        setPos((p) => {
          save(key, p);
          return p;
        });
      }
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [enabled, key]);

  const reset = () => {
    setPos(null);
    save(key, null);
  };

  const style: CSSProperties | undefined = enabled && pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;
  return { ref, style, onPointerDown, dragging, moved: !!pos, reset };
}

function PipVideo({ track }: { track: VideoTrackLike }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current!;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} className="pip-video" autoPlay playsInline muted />;
}

/**
 * Мини-окно голосовой комнаты: ты в голосе, но смотришь другой чат, а кто-то показывает экран
 * или включил камеру — видео продолжает идти в маленьком окне, которое можно перетащить.
 */
export function VoicePip() {
  const voice = useStore((s) => s.ui.voice);
  const call = useStore((s) => s.ui.call);
  const videos = useStore((s) => s.ui.videos);
  const room = useStore((s) => (s.ui.voice ? s.servers.find((x) => x.id === s.ui.voice!.serverId)?.channels.find((c) => c.id === s.ui.voice!.channelId) : undefined));
  const watchingRoom = useStore((s) => !!s.ui.voice && s.ui.view === 'server' && s.ui.serverId === s.ui.voice.serverId && s.lastChannel[s.ui.voice.serverId] === s.ui.voice.channelId);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  // показываем в первую очередь демку, потом камеру собеседника
  const entry = Object.entries(videos)
    .filter(([id]) => id !== ME)
    .sort(([, a], [, b]) => Number(b.screen) - Number(a.screen))[0];
  const who = usePerson(entry?.[0] ?? ME);
  const show = !!voice && !call && !watchingRoom && !!entry;
  const drag = useDraggable('voice-pip', show);
  if (!show || !entry || hiddenFor === `${entry[0]}|${entry[1].screen}`) return null;
  const [userId, v] = entry;
  return (
    <div ref={drag.ref} style={drag.style} onPointerDown={drag.onPointerDown} className={`voice-pip ${drag.dragging ? 'dragging' : ''}`} role="dialog" aria-label="Мини-окно голосовой комнаты">
      <PipVideo track={v.track} />
      <div className="pip-top">
        <span className="pip-title ellipsis">
          {v.screen && <span className="live">ЭФИР</span>} {who?.name ?? ''} {v.screen ? 'показывает экран' : ''}
        </span>
        <button type="button" className="call-ghost" aria-label="Открыть комнату" title="Открыть комнату" onClick={() => voice && (actions.openServer(voice.serverId), actions.openChannel(voice.serverId, voice.channelId))}>
          <Icon name="expand" size={15} />
        </button>
        <button type="button" className="call-ghost" aria-label="Скрыть мини-окно" title="Скрыть" onClick={() => setHiddenFor(`${userId}|${v.screen}`)}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="pip-hint">{room ? `🔊 ${room.name}` : ''} · перетащи, куда удобно</div>
    </div>
  );
}
