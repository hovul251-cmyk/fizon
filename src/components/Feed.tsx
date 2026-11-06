import { memo, useEffect, useRef, useState } from 'react';
import { ME } from '../data';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import { actions, setUi, useStore, type State } from '../store';
import type { Comment, Reel } from '../types';
import { Modal, openCard, StoryAvatar, usePerson } from './common';
import { MediaPicker } from './Stories';

// Лента: короткие вертикальные видео от всех. Листаются колесом или стрелками ↑ ↓,
// видео в центре играет само, остальные стоят на паузе.

const ago = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (m < 1440) return `${Math.round(m / 60)} ч назад`;
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)} тыс.` : String(n));

const ReelCard = memo(function ReelCard({ reel, muted, onMute, onComments }: { reel: Reel; muted: boolean; onMute: () => void; onComments: () => void }) {
  const author = usePerson(reel.authorId);
  const box = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [burst, setBurst] = useState(0);
  const liked = reel.likes.includes(ME);
  const mine = reel.authorId === ME;

  // играет только то видео, что сейчас в центре ленты
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        const v = video.current;
        if (!v) return;
        if (e.isIntersecting) void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
        else {
          v.pause();
          setPlaying(false);
        }
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().then(() => setPlaying(true));
    else {
      v.pause();
      setPlaying(false);
    }
  };

  const like = () => {
    if (!liked) setBurst(Date.now());
    actions.toggleLike(reel.id);
  };

  if (!author) return null;
  return (
    <section className="reel" ref={box} aria-label={`Видео ${author.name}`}>
      <div className="reel-frame">
        <video
          ref={video}
          src={reel.url}
          loop
          playsInline
          muted={muted}
          preload="metadata"
          onClick={toggle}
          onDoubleClick={() => !liked && like()}
        />
        {!playing && (
          <button type="button" className="reel-play" aria-label="Смотреть" onClick={toggle}>
            <Icon name="play" size={34} />
          </button>
        )}
        {burst > 0 && <span key={burst} className="reel-burst" aria-hidden="true" />}
        <div className="reel-info">
          <div className="reel-author">
            <StoryAvatar person={author} size={38} showPresence={false} border="transparent" />
            <button type="button" className="plain strong" onClick={(e) => openCard(reel.authorId, e)}>
              {author.name}
            </button>
            <span className="small">· {ago(reel.ts)}</span>
          </div>
          {reel.caption && <p className="reel-caption">{reel.caption}</p>}
        </div>
      </div>
      <div className="reel-rail">
        <button type="button" className={`rail-btn ${liked ? 'liked' : ''}`} aria-label={liked ? 'Убрать лайк' : 'Нравится'} aria-pressed={liked} onClick={like}>
          <Icon name="heart" size={26} />
          <span>{count(reel.likes.length)}</span>
        </button>
        <button type="button" className="rail-btn" aria-label="Комментарии" onClick={onComments}>
          <Icon name="bubble" size={24} />
          <span>{count(reel.comments ?? 0)}</span>
        </button>
        <button type="button" className="rail-btn" aria-label={muted ? 'Включить звук' : 'Выключить звук'} onClick={onMute}>
          <Icon name={muted ? 'volumeOff' : 'speaker'} size={24} />
          <span>{muted ? 'Звук' : 'Тише'}</span>
        </button>
        {!mine && (
          <button type="button" className="rail-btn" aria-label={`Написать ${author.name}`} onClick={() => actions.openDm(reel.authorId)}>
            <Icon name="bubble" size={24} />
            <span>Написать</span>
          </button>
        )}
        {mine && (
          <button type="button" className="rail-btn" aria-label="Удалить видео" onClick={() => actions.deleteReel(reel.id)}>
            <Icon name="trash" size={24} />
            <span>Удалить</span>
          </button>
        )}
      </div>
    </section>
  );
});

const selReels = (s: State) => s.reels;
const selFriends = (s: State) => s.friends;

export function FeedView() {
  const reels = useStore(selReels);
  const friends = useStore(selFriends);
  const tab = useStore((s) => s.ui.feedTab);
  const [muted, setMuted] = useState(true);
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const shown = tab === 'friends' ? reels.filter((r) => r.authorId === ME || friends.includes(r.authorId)) : reels;

  // подгружаем следующие видео, когда долистали почти до конца
  useEffect(() => {
    const el = end.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && void actions.loadMoreReels(), { root: scroller.current, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || document.querySelector('.overlay, .story-overlay')) return;
      const el = scroller.current;
      if (!el) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        el.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * el.clientHeight, behavior: 'smooth' });
      }
      if (e.key.toLowerCase() === 'm' || e.key.toLowerCase() === 'ь') setMuted((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="feed">
      <aside className="feed-side">
        <h1>Лента</h1>
        <p className="muted">Короткие вертикальные видео от всех в Fizion. Новые — сверху.</p>
        <div className="seg feed-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setUi({ feedTab: 'all' })}>
            Все
          </button>
          <button type="button" role="tab" aria-selected={tab === 'friends'} className={tab === 'friends' ? 'on' : ''} onClick={() => setUi({ feedTab: 'friends' })}>
            Друзья
          </button>
        </div>
        <button type="button" className="btn primary big" onClick={() => setUi({ modal: { kind: 'reelComposer' } })}>
          <Icon name="plus" size={18} /> Выложить видео
        </button>
        <div className="feed-keys muted small">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> листать
          </span>
          <span>
            <kbd>M</kbd> звук
          </span>
          <span>двойной клик — лайк</span>
        </div>
        {!ONLINE && <p className="note small">Офлайн-режим: видео видишь только ты, и они пропадут после перезапуска.</p>}
      </aside>
      <div className="feed-scroll" ref={scroller}>
        {shown.map((r) => (
          <ReelCard key={r.id} reel={r} muted={muted} onMute={() => setMuted((m) => !m)} onComments={() => setCommentsFor(r.id)} />
        ))}
        {!shown.length && (
          <div className="feed-empty">
            <div className="empty-icon">
              <Icon name="film" size={40} />
            </div>
            <h2>{tab === 'friends' ? 'Друзья пока ничего не выложили' : 'В ленте пока пусто'}</h2>
            <p className="muted">Выложи первое видео — его увидят все в Fizion</p>
            <button type="button" className="btn primary" onClick={() => setUi({ modal: { kind: 'reelComposer' } })}>
              Выложить видео
            </button>
          </div>
        )}
        <div ref={end} className="feed-end" />
      </div>
      {commentsFor && <Comments reelId={commentsFor} onClose={() => setCommentsFor(null)} />}
    </main>
  );
}

/** Длительность видео из файла, в секундах */
const durationOf = (file: File): Promise<number> =>
  new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => resolve(0);
    v.src = url;
  });

export function ReelComposer() {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => !busy && setUi({ modal: null });

  const pick = async (f: File) => {
    setError('');
    if (!f.type.startsWith('video/')) return setError('Нужен видеофайл: mp4, webm или mov');
    const d = await durationOf(f);
    if (d > 180) return setError('Видео длиннее 3 минут — обрежь его');
    setFile(f);
  };

  const publish = async () => {
    if (!file) return;
    setBusy(true);
    const err = await actions.postReel(file, caption.trim());
    setBusy(false);
    if (err) return setError(err);
    setUi({ modal: null, view: 'feed', toast: { text: 'Видео в ленте', id: Date.now() } });
  };

  return (
    <Modal onClose={close} width={440} label="Выложить видео" className="composer-modal">
      <div className="modal-head">
        <h2>Видео в ленту</h2>
        <p className="muted small">Вертикальное, до 3 минут и 50 МБ. Его увидят все в Fizion.</p>
      </div>
      <MediaPicker accept="video/*" file={file} onFile={(f) => void pick(f)} hint="mp4, webm или mov" />
      <textarea className="input" aria-label="Описание видео" placeholder="Описание, #теги" maxLength={500} rows={2} value={caption} onChange={(e) => setCaption(e.target.value)} />
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={close} disabled={busy}>
          Отмена
        </button>
        <button type="button" className="btn primary" disabled={!file || busy} onClick={() => void publish()}>
          {busy ? 'Загружаю…' : 'Опубликовать'}
        </button>
      </div>
    </Modal>
  );
}

function CommentRow({ c }: { c: Comment }) {
  const p = usePerson(c.authorId);
  if (!p) return null;
  return (
    <div className="comment">
      <StoryAvatar person={p} size={32} showPresence={false} />
      <div className="grow">
        <div className="comment-head">
          <button type="button" className="plain strong" style={p.nameStyle} onClick={(e) => openCard(c.authorId, e)}>
            {p.name}
          </button>
          <span className="muted small">{ago(c.ts)}</span>
          {c.authorId === ME && (
            <button type="button" className="plain muted ml-auto" aria-label="Удалить комментарий" onClick={() => actions.deleteComment(c.reelId, c.id)}>
              <Icon name="trash" size={14} />
            </button>
          )}
        </div>
        <p>{c.text}</p>
      </div>
    </div>
  );
}

const EMPTY_COMMENTS: Comment[] = [];

/** Комментарии к видео: справа на компьютере, снизу на телефоне */
function Comments({ reelId, onClose }: { reelId: string; onClose: () => void }) {
  const list = useStore((s) => s.comments[reelId]);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => actions.loadComments(reelId), [reelId]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [list?.length]);
  const items = list ?? EMPTY_COMMENTS;
  return (
    <aside className="comments" aria-label="Комментарии">
      <div className="drawer-head">
        <span className="strong">Комментарии · {items.length}</span>
        <button type="button" className="plain" aria-label="Закрыть комментарии" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="comments-list" ref={box}>
        {list === undefined && <p className="muted small">Загружаю…</p>}
        {list && !items.length && <p className="muted small">Пока никто не написал — будь первым</p>}
        {items.map((c) => (
          <CommentRow key={c.id} c={c} />
        ))}
      </div>
      <form
        className="comments-form"
        onSubmit={(e) => {
          e.preventDefault();
          actions.addComment(reelId, text);
          setText('');
        }}
      >
        <input className="input" aria-label="Комментарий" placeholder="Написать комментарий…" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="send-btn on" aria-label="Отправить комментарий" disabled={!text.trim()}>
          <Icon name="send" size={18} />
        </button>
      </form>
    </aside>
  );
}
