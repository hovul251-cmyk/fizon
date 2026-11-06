import { useEffect, useMemo, useRef, useState } from 'react';
import { ME } from '../data';
import { Icon } from '../icons';
import { actions, activeStories, getState, setUi, storyAuthors, useStore, type State } from '../store';
import type { Story } from '../types';
import { Avatar, Modal, usePerson } from './common';

// Истории как в Telegram: фото или видео на 24 часа. Зелёное свечение вокруг аватарки —
// есть новые истории, серое — все просмотрены. Нажал на аватарку — открылся просмотр.

const IMAGE_MS = 5000;

const ago = (ts: number) => {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60_000));
  return m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`;
};

/** Чьи истории идут после этого человека: сначала свои, потом полоса историй по порядку */
const queue = (s: State) => [...(activeStories(ME, s).length ? [ME] : []), ...storyAuthors(s)];

const selView = (s: State) => s.ui.stories;
const selStories = (s: State) => s.stories;

export function StoryViewer() {
  const view = useStore(selView);
  const all = useStore(selStories);
  if (!view) return null;
  const list = all.filter((x) => x.authorId === view.userId && x.expiresAt > Date.now()).sort((a, b) => a.ts - b.ts);
  const story = list[Math.min(view.index, list.length - 1)];
  if (!story) return null;
  return <StoryPlayer key={story.id} story={story} index={list.indexOf(story)} list={list} />;
}

function StoryPlayer({ story, index, list }: { story: Story; index: number; list: Story[] }) {
  const author = usePerson(story.authorId);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [reply, setReply] = useState('');
  const [sent, setSent] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const mine = story.authorId === ME;

  const next = () => {
    if (index < list.length - 1) return setUi({ stories: { userId: story.authorId, index: index + 1 } });
    const q = queue(getState());
    const after = q[q.indexOf(story.authorId) + 1];
    if (after) setUi({ stories: { userId: after, index: 0 } });
    else actions.closeStories();
  };
  const prev = () => {
    if (index > 0) return setUi({ stories: { userId: story.authorId, index: index - 1 } });
    const q = queue(getState());
    const before = q[q.indexOf(story.authorId) - 1];
    if (before) setUi({ stories: { userId: before, index: Math.max(0, activeStories(before).length - 1) } });
    else setProgress(0);
  };

  useEffect(() => actions.markStorySeen(story), [story]);

  // фото: свой таймер; видео: по времени ролика
  useEffect(() => {
    if (story.kind !== 'image' || paused) return;
    let raf = 0;
    const start = performance.now() - progress * IMAGE_MS;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / IMAGE_MS);
      setProgress(p);
      if (p >= 1) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story.id, paused]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (paused) v.pause();
    else void v.play().catch(() => {
      // браузер не дал включить звук без нажатия — запускаем без звука
      v.muted = true;
      setMuted(true);
      void v.play().catch(() => undefined);
    });
  }, [paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return actions.closeStories();
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sendReply = () => {
    const t = reply.trim();
    if (!t) return;
    actions.send(`dm:${story.authorId}`, `Ответ на историю: ${t}`);
    setReply('');
    setSent(true);
    setPaused(false);
  };

  if (!author) return null;
  return (
    <div className="story-overlay" role="dialog" aria-modal="true" aria-label={`История ${author.name}`} onMouseDown={(e) => e.target === e.currentTarget && actions.closeStories()}>
      <button type="button" className="story-nav left" aria-label="Предыдущая история" onClick={prev}>
        <Icon name="chevronLeft" size={26} />
      </button>
      <div className="story-stage">
        <div className="story-bars">
          {list.map((s, i) => (
            <span key={s.id}>
              <i style={{ transform: `scaleX(${i < index ? 1 : i > index ? 0 : progress})` }} />
            </span>
          ))}
        </div>
        <div className="story-head">
          <Avatar person={author} size={36} showPresence={false} story={false} border="transparent" />
          <span className="grow">
            <span className="strong">{mine ? 'Моя история' : author.name}</span>
            <span className="small">
              {ago(story.ts)}
              {story.audience === 'friends' && ' · только друзьям'}
            </span>
          </span>
          {story.kind === 'video' && (
            <button type="button" className="story-ctrl" aria-label={muted ? 'Включить звук' : 'Выключить звук'} onClick={() => setMuted((m) => !m)}>
              <Icon name={muted ? 'volumeOff' : 'speaker'} size={18} />
            </button>
          )}
          <button type="button" className="story-ctrl" aria-label={paused ? 'Продолжить' : 'Пауза'} onClick={() => setPaused((p) => !p)}>
            <Icon name={paused ? 'play' : 'pause'} size={18} />
          </button>
          {mine && (
            <button
              type="button"
              className="story-ctrl"
              aria-label="Удалить историю"
              onClick={() => {
                actions.deleteStory(story.id);
                if (list.length === 1) actions.closeStories();
              }}
            >
              <Icon name="trash" size={18} />
            </button>
          )}
          <button type="button" className="story-ctrl" aria-label="Закрыть" onClick={actions.closeStories}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="story-media" onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onMouseLeave={() => paused && setPaused(false)}>
          {story.kind === 'image' ? (
            <img src={story.url} alt={story.caption || 'История'} draggable={false} />
          ) : (
            <video
              ref={video}
              src={story.url}
              autoPlay
              playsInline
              muted={muted}
              onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
              onEnded={next}
            />
          )}
          <button type="button" className="story-tap left" aria-label="Назад" onClick={prev} />
          <button type="button" className="story-tap right" aria-label="Дальше" onClick={next} />
        </div>
        {story.caption && <div className="story-caption">{story.caption}</div>}
        {!mine && (
          <form
            className="story-reply"
            onSubmit={(e) => {
              e.preventDefault();
              sendReply();
            }}
          >
            <input
              aria-label="Ответить на историю"
              placeholder={sent ? 'Ответ отправлен в личные' : `Ответить ${author.name}…`}
              value={reply}
              maxLength={500}
              onFocus={() => setPaused(true)}
              onBlur={() => !reply && setPaused(false)}
              onChange={(e) => setReply(e.target.value)}
            />
            <button type="submit" aria-label="Отправить ответ" disabled={!reply.trim()}>
              <Icon name="send" size={18} />
            </button>
          </form>
        )}
      </div>
      <button type="button" className="story-nav right" aria-label="Следующая история" onClick={next}>
        <Icon name="chevronRight" size={26} />
      </button>
    </div>
  );
}

/** Уменьшить фото до 1080×1920 и сжать — история загружается быстрее и занимает меньше места */
const shrinkImage = (file: File): Promise<File> =>
  new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1080 / img.width, 1920 / img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => resolve(b ? new File([b], 'story.webp', { type: 'image/webp' }) : file), 'image/webp', 0.88);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });

export function MediaPicker({ accept, file, onFile, hint }: { accept: string; file: File | null; onFile: (f: File) => void; hint: string }) {
  const input = useRef<HTMLInputElement>(null);
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return (
    <div
      className={`media-pick ${file ? 'has' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      {url && file?.type.startsWith('image/') && <img src={url} alt="Предпросмотр" />}
      {url && file?.type.startsWith('video/') && <video src={url} autoPlay muted loop playsInline />}
      <button type="button" className={file ? 'btn ghost small-btn media-change' : 'media-empty'} onClick={() => input.current?.click()}>
        {file ? (
          'Выбрать другой файл'
        ) : (
          <>
            <Icon name="upload" size={30} />
            <b>Выбери файл</b>
            <span className="muted small">{hint}</span>
          </>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        aria-label="Файл"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function StoryComposer() {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => !busy && setUi({ modal: null });

  const publish = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    const ready = file.type.startsWith('image/') && file.type !== 'image/gif' ? await shrinkImage(file) : file;
    const err = await actions.postStory(ready, caption.trim(), 'friends');
    setBusy(false);
    if (err) return setError(err);
    setUi({ modal: null, toast: { text: 'История опубликована на 24 часа', id: Date.now() } });
  };

  return (
    <Modal onClose={close} width={440} label="Новая история" className="composer-modal">
      <div className="modal-head">
        <h2>Новая история</h2>
        <p className="muted small">История живёт 24 часа и видна только друзьям. Вокруг твоей аватарки загорится зелёное свечение.</p>
      </div>
      <MediaPicker accept="image/*,video/*" file={file} onFile={(f) => { setFile(f); setError(''); }} hint="Фото или видео до 50 МБ, лучше вертикальное" />
      <input className="input" aria-label="Подпись к истории" placeholder="Подпись (необязательно)" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} />
      <p className="muted small">🔒 Историю видят только твои друзья — незнакомые люди её не увидят.</p>
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
