import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ME } from '../data';
import { Icon } from '../icons';
import * as polls from '../online/polls';
import { actions, setUi } from '../store';
import type { Attachment } from '../types';
import { Modal, usePerson } from './common';

// Штуки, которых нет в Discord: опросы, мини-игры (кубик, монетка, дартс, слоты) и видео-«кружочки».

type GameKind = NonNullable<Attachment['game']>['kind'];

const GAMES: Record<GameKind, { emoji: string; name: string; max: number }> = {
  dice: { emoji: '🎲', name: 'Кубик', max: 6 },
  coin: { emoji: '🪙', name: 'Монетка', max: 2 },
  darts: { emoji: '🎯', name: 'Дартс', max: 6 },
  slot: { emoji: '🎰', name: 'Слоты', max: 64 },
};

const rnd = (max: number) => {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % max) + 1;
};

export function sendGame(chatId: string, kind: GameKind) {
  const g = GAMES[kind];
  actions.send(chatId, '', undefined, { name: g.name, size: '', game: { kind, value: rnd(g.max) } });
}

/* ---------- меню «+» в поле ввода ---------- */

export function AttachMenu({ onFile, onPoll, onRound, onGame, onClose }: { onFile: () => void; onPoll: () => void; onRound: () => void; onGame: (k: GameKind) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // клик мимо меню закрывает его (кнопка «+» сама переключает меню — её не считаем)
    const out = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest('[aria-label="Прикрепить"]')) close.current();
    };
    window.addEventListener('pointerdown', out);
    return () => window.removeEventListener('pointerdown', out);
  }, []);
  const item = (icon: Parameters<typeof Icon>[0]['name'] | null, emoji: string | null, label: string, hint: string, fn: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="attach-item"
      onClick={() => {
        onClose();
        fn();
      }}
    >
      <span className="attach-ico">{icon ? <Icon name={icon} size={18} /> : emoji}</span>
      <span className="attach-text">
        <b>{label}</b>
        <span className="muted small">{hint}</span>
      </span>
    </button>
  );
  return (
    <div ref={ref} className="attach-menu up" role="menu" aria-label="Что прикрепить">
      {item('upload', null, 'Файлы', 'До 10 штук, по 50 МБ', onFile)}
      {item('poll', null, 'Опрос', 'Спроси мнение у всех', onPoll)}
      {item('circleVideo', null, 'Кружочек', 'Видеосообщение до 60 секунд', onRound)}
      <div className="attach-games">
        {(Object.keys(GAMES) as GameKind[]).map((k) => (
          <button
            type="button"
            key={k}
            className="attach-game"
            title={GAMES[k].name}
            onClick={() => {
              onClose();
              onGame(k);
            }}
          >
            <span>{GAMES[k].emoji}</span>
            <span className="small muted">{GAMES[k].name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- мини-игры ---------- */

const SLOT = ['🍒', '🍋', '🍇', '7️⃣'];
const DARTS = ['мимо', 'внешнее кольцо', 'кольцо', 'ближе к центру', 'почти в яблочко', 'В ЯБЛОЧКО!'];

export function GameView({ g, fresh }: { g: NonNullable<Attachment['game']>; fresh: boolean }) {
  const [rolling, setRolling] = useState(fresh);
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setRolling(false), 1400);
    return () => clearTimeout(t);
  }, [fresh]);
  const v = Math.min(Math.max(1, g.value | 0), GAMES[g.kind]?.max ?? 6);
  let face: string;
  let result: string;
  switch (g.kind) {
    case 'dice':
      face = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][v - 1];
      result = `Выпало ${v}`;
      break;
    case 'coin':
      face = v === 1 ? '🦅' : '🪙';
      result = v === 1 ? 'Орёл' : 'Решка';
      break;
    case 'darts':
      face = '🎯';
      result = DARTS[v - 1];
      break;
    default: {
      const n = v - 1;
      const s = [SLOT[n & 3], SLOT[(n >> 2) & 3], SLOT[(n >> 4) & 3]];
      face = s.join('');
      result = s[0] === s[1] && s[1] === s[2] ? (s[0] === '7️⃣' ? 'ДЖЕКПОТ!' : 'Три в ряд!') : 'Не повезло';
    }
  }
  return (
    <div className={`mgame mgame-${g.kind} ${rolling ? 'rolling' : ''} ${(g.kind === 'darts' && v === 6) || (g.kind === 'slot' && ((v - 1) & 3) === (((v - 1) >> 2) & 3) && ((v - 1) & 3) === (((v - 1) >> 4) & 3)) ? 'win' : ''}`}>
      <span className="mgame-face" aria-hidden="true">
        {rolling ? GAMES[g.kind].emoji : face}
      </span>
      <span className="mgame-result">{rolling ? '…' : result}</span>
    </div>
  );
}

/* ---------- опросы ---------- */

export function PollComposer({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [anon, setAnon] = useState(false);
  const clean = opts.map((o) => o.trim()).filter(Boolean);
  const ok = q.trim() && clean.length >= 2;
  return (
    <Modal onClose={onClose} width={460} label="Новый опрос" className="composer-modal">
      <div className="modal-head">
        <h2>Новый опрос</h2>
      </div>
      <input className="input" aria-label="Вопрос" placeholder="Вопрос" maxLength={200} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="poll-opts">
        {opts.map((o, i) => (
          <div key={i} className="row gap-s">
            <input
              className="input grow"
              aria-label={`Вариант ${i + 1}`}
              placeholder={`Вариант ${i + 1}`}
              maxLength={100}
              value={o}
              onChange={(e) => {
                const next = opts.map((x, j) => (j === i ? e.target.value : x));
                // дописали последний — сразу появляется ещё одно поле
                if (i === opts.length - 1 && e.target.value && opts.length < 10) next.push('');
                setOpts(next);
              }}
            />
            {opts.length > 2 && (
              <button type="button" className="plain muted" aria-label="Убрать вариант" onClick={() => setOpts(opts.filter((_, j) => j !== i))}>
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> Можно выбрать несколько
      </label>
      <label className="check-row">
        <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Анонимный — не показывать, кто как голосовал
      </label>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!ok}
          onClick={() => {
            actions.send(chatId, '', undefined, { name: 'Опрос', size: '', poll: { q: q.trim(), options: clean.slice(0, 10), multi: multi || undefined, anon: anon || undefined } });
            onClose();
          }}
        >
          Отправить
        </button>
      </div>
    </Modal>
  );
}

function Voter({ id }: { id: string }) {
  const p = usePerson(id);
  return <span className="voter" title={p?.name} style={{ background: p?.color ?? '#5865F2' }}>{(p?.name ?? '?').slice(0, 1).toUpperCase()}</span>;
}

export function PollView({ poll, chatId, messageId, pending }: { poll: NonNullable<Attachment['poll']>; chatId: string; messageId: string; pending?: boolean }) {
  useSyncExternalStore(polls.onPolls, polls.pollsVersion);
  useEffect(() => void polls.loadVotes([messageId]), [messageId]);
  const all = polls.votesOf(messageId);
  const mine = all.get(ME) ?? [];
  const voted = mine.length > 0;
  const counts = poll.options.map((_, i) => [...all.values()].filter((c) => c.includes(i)).length);
  const people = all.size;
  const best = Math.max(...counts);
  const choose = (i: number) => {
    if (pending) return;
    const next = poll.multi ? (mine.includes(i) ? mine.filter((x) => x !== i) : [...mine, i].sort()) : mine.includes(i) ? [] : [i];
    polls.vote(chatId, messageId, next).catch(() => setUi({ toast: { text: 'Не получилось проголосовать — проверь интернет', id: Date.now() } }));
  };
  return (
    <div className="poll">
      <div className="poll-q">
        <Icon name="poll" size={16} /> {poll.q}
      </div>
      <div className="muted small">
        {poll.anon ? 'Анонимный' : 'Открытый'} опрос{poll.multi ? ' · несколько ответов' : ''}
      </div>
      {poll.options.map((o, i) => {
        const pct = people ? Math.round((counts[i] / people) * 100) : 0;
        const who = poll.anon ? [] : [...all.entries()].filter(([, c]) => c.includes(i)).map(([id]) => id);
        return (
          <button type="button" key={i} className={`poll-opt ${mine.includes(i) ? 'on' : ''} ${voted && counts[i] === best && best > 0 ? 'best' : ''}`} onClick={() => choose(i)}>
            {voted && <span className="poll-bar" style={{ width: `${pct}%` }} />}
            <span className="poll-check">{mine.includes(i) ? '✓' : ''}</span>
            <span className="poll-label">{o}</span>
            {voted && (
              <span className="poll-right">
                {who.slice(0, 3).map((id) => (
                  <Voter key={id} id={id} />
                ))}
                <b>{pct}%</b>
              </span>
            )}
          </button>
        );
      })}
      <div className="muted small">
        {people ? `${people} ${plural(people, 'голос', 'голоса', 'голосов')}` : 'Пока никто не голосовал'}
        {voted ? ' · нажми ещё раз, чтобы передумать' : ''}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

/* ---------- видео-кружочки ---------- */

const ROUND_MAX = 60;

export function RoundRecorder({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [state, setState] = useState<'starting' | 'ready' | 'recording' | 'error'>('starting');
  const [sec, setSec] = useState(0);
  const sendOnStop = useRef(false);

  useEffect(() => {
    let dead = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 480, height: 480, facingMode: 'user' }, audio: true })
      .then((s) => {
        if (dead) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) video.current.srcObject = s;
        setState('ready');
      })
      .catch(() => setState('error'));
    return () => {
      dead = true;
      sendOnStop.current = false;
      if (rec.current?.state === 'recording') rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const started = Date.now();
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSec(s);
      if (s >= ROUND_MAX) stop(true);
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const start = () => {
    if (!stream.current) return;
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
    const r = new MediaRecorder(stream.current, type ? { mimeType: type, videoBitsPerSecond: 900_000 } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      if (!sendOnStop.current) return;
      const mime = (r.mimeType || 'video/webm').split(';')[0];
      const blob = new Blob(chunks.current, { type: mime });
      const f = new File([blob], `кружочек.${mime.includes('mp4') ? 'mp4' : 'webm'}`, { type: mime });
      void actions.sendFile(chatId, f, '', { round: true });
      onClose();
    };
    rec.current = r;
    r.start(500);
    setSec(0);
    setState('recording');
  };
  const stop = (send: boolean) => {
    sendOnStop.current = send;
    if (rec.current?.state === 'recording') rec.current.stop();
    if (!send) onClose();
  };

  return (
    <Modal onClose={() => stop(false)} width={380} label="Кружочек" className="round-modal">
      <div className={`round-cam ${state === 'recording' ? 'rec' : ''}`}>
        {state === 'error' ? <div className="round-error">Нет доступа к камере — разреши её в настройках системы</div> : <video ref={video} autoPlay playsInline muted />}
        {state === 'recording' && (
          <svg className="round-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="48" pathLength={ROUND_MAX} strokeDasharray={`${sec} ${ROUND_MAX}`} />
          </svg>
        )}
      </div>
      <div className="round-time">{state === 'recording' ? `● 0:${String(sec).padStart(2, '0')} / 1:00` : 'Видеосообщение до минуты'}</div>
      <div className="modal-actions center">
        <button type="button" className="btn ghost" onClick={() => stop(false)}>
          Отмена
        </button>
        {state === 'recording' ? (
          <button type="button" className="btn primary" onClick={() => stop(true)}>
            Отправить
          </button>
        ) : (
          <button type="button" className="btn primary" disabled={state !== 'ready'} onClick={start}>
            Записать
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Кружочек в чате: без звука крутится по кругу, нажал — со звуком с начала */
export function RoundVideo({ url }: { url: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const [loud, setLoud] = useState(false);
  const [prog, setProg] = useState(0);
  return (
    <button
      type="button"
      className={`round-video ${loud ? 'loud' : ''}`}
      aria-label={loud ? 'Пауза' : 'Включить со звуком'}
      onClick={() => {
        const el = v.current!;
        if (!loud) {
          el.currentTime = 0;
          el.muted = false;
          el.loop = false;
          void el.play();
          setLoud(true);
        } else {
          el.muted = true;
          el.loop = true;
          setLoud(false);
        }
      }}
    >
      <video
        ref={v}
        src={url}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        onTimeUpdate={(e) => setProg(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
        onEnded={(e) => {
          e.currentTarget.muted = true;
          e.currentTarget.loop = true;
          void e.currentTarget.play();
          setLoud(false);
        }}
      />
      {loud && (
        <svg className="round-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="48" pathLength={100} strokeDasharray={`${prog * 100} 100`} />
        </svg>
      )}
      {!loud && <span className="round-mute">🔇</span>}
    </button>
  );
}
