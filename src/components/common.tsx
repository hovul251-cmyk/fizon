import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { ME } from '../data';
import { ONLINE } from '../lib/appwrite';
import { Icon } from '../icons';
import { actions, getState, setUi, storyStateOf, useStore, type State } from '../store';
import type { Presence, Profile, User } from '../types';

export const presenceColor: Record<Presence, string> = {
  online: 'var(--green)',
  idle: 'var(--amber)',
  dnd: 'var(--red)',
  offline: '#6B7280',
};

export const presenceLabel: Record<Presence, string> = {
  online: 'В сети',
  idle: 'Не активен',
  dnd: 'Не беспокоить',
  offline: 'Не в сети',
};

/** Единый вид пользователя: для себя берём данные профиля, для остальных — из списка пользователей. */
export interface Person {
  id: string;
  name: string;
  username: string;
  color: string;
  image: string | null;
  presence: Presence;
  activity?: string;
  nameStyle: CSSProperties;
  frame: Profile['avatarFrame'];
  status?: string;
  about?: string;
}

export const nameStyleOf = (p: Profile): CSSProperties =>
  p.nameGradient
    ? {
        backgroundImage: `linear-gradient(90deg, ${p.nameColor}, ${p.nameColor2})`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        filter: p.nameEffect === 'glow' ? `drop-shadow(0 0 6px ${p.nameColor}88)` : undefined,
      }
    : { color: p.nameColor, textShadow: p.nameEffect === 'glow' ? `0 0 10px ${p.nameColor}99` : undefined };

export const personFromProfile = (p: Profile): Person => ({
  id: ME,
  name: p.displayName,
  username: p.username,
  color: p.avatarColor,
  image: p.avatarImage,
  presence: p.presence,
  activity: p.activity,
  nameStyle: nameStyleOf(p),
  frame: p.avatarFrame,
  status: p.status,
  about: p.about,
});

export const personFromUser = (u: User): Person =>
  u.profile ? { ...personFromProfile(u.profile), id: u.id, presence: u.presence } : {
  id: u.id,
  name: u.name,
  username: u.username,
  color: u.color,
  image: null,
  presence: u.presence,
  activity: u.activity,
  nameStyle: { color: u.nameColor },
  frame: 'none',
  about: u.about,
};

const selSpeaking = (s: State) => s.ui.speaking;
const selMuted = (s: State) => s.ui.muted;
const selInVoice = (s: State) => s.ui.voice !== null;

/** Кто сейчас говорит. Онлайн — по данным LiveKit, офлайн — только ты, когда в голосовом с включённым микрофоном. */
export function useSpeaking(): (userId: string) => boolean {
  const speaking = useStore(selSpeaking);
  const muted = useStore(selMuted);
  const inVoice = useStore(selInVoice);
  if (ONLINE) return (id) => speaking.includes(id);
  return (id) => id === ME && inVoice && !muted;
}

const selProfile = (s: State) => s.profile;
const selUsers = (s: State) => s.users;

export function usePerson(id: string): Person | null {
  const profile = useStore(selProfile);
  const users = useStore(selUsers);
  if (id === ME) return personFromProfile(profile);
  const u = users[id];
  return u ? personFromUser(u) : null;
}

const frames: Record<Profile['avatarFrame'], string | null> = {
  none: null,
  neon: 'conic-gradient(#A78BFA, #22D3EE, #A78BFA)',
  gold: 'conic-gradient(#FDE68A, #F59E0B, #FDE68A)',
  fire: 'conic-gradient(#F97316, #EF4444, #FACC15, #F97316)',
};

/** Есть ли у человека истории: зелёное свечение вокруг аватарки, серое — если все просмотрены */
export function useStoryState(userId: string) {
  return useStore((s) => storyStateOf(userId, s));
}

export function Avatar({ person, size = 40, ring, showPresence = true, border = 'var(--bg1)', story = true }: { person: Person; size?: number; ring?: boolean; showPresence?: boolean; border?: string; story?: boolean }) {
  const storyState = useStoryState(person.id);
  const frame = frames[person.frame];
  const pad = frame ? Math.max(2, Math.round(size / 28)) : 0;
  const inner = size - pad * 2;
  const dot = Math.max(10, Math.round(size * 0.3));
  return (
    <span
      className={`avatar ${story && storyState !== 'none' ? `story-${storyState}` : ''} ${ring ? 'speaking' : ''}`}
      style={{ width: size, height: size, padding: pad, background: frame ?? undefined, ['--ring' as string]: `${Math.max(2, Math.round(size / 18))}px` }}
    >
      <span
        className="avatar-in"
        style={{
          width: inner,
          height: inner,
          background: person.image ? `center/cover url(${person.image})` : person.color,
          fontSize: Math.round(inner * 0.4),
          border: frame ? `${Math.max(2, Math.round(size / 24))}px solid ${border}` : undefined,
        }}
      >
        {person.image ? null : person.name.slice(0, 1).toUpperCase()}
      </span>
      {showPresence && (
        <span
          className="avatar-dot"
          style={{ width: dot, height: dot, background: presenceColor[person.presence], borderColor: border, borderWidth: Math.max(2, Math.round(dot / 4)) }}
        />
      )}
    </span>
  );
}

/** Аватарка, по которой можно открыть истории человека (если они есть) */
export function StoryAvatar(props: Parameters<typeof Avatar>[0]) {
  const st = useStoryState(props.person.id);
  if (st === 'none') return <Avatar {...props} />;
  return (
    <button type="button" className="plain story-avatar" aria-label={`Истории ${props.person.name}`} title="Смотреть истории" onClick={(e) => { e.stopPropagation(); actions.openStories(props.person.id); }}>
      <Avatar {...props} />
    </button>
  );
}

/** Телефон: стрелка «назад» к списку чатов (на компьютере скрыта) */
export function BackButton() {
  return (
    <button type="button" className="m-back" aria-label="Назад к чатам" onClick={actions.backToList}>
      <Icon name="chevronLeft" size={22} />
    </button>
  );
}

export function Name({ person, className = '', onClick }: { person: Person; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" className={`name ${className}`} style={person.nameStyle} onClick={onClick}>
      {person.name}
    </button>
  );
}

/** Нажатие на аватарку: есть истории — открыть их, как в Telegram, иначе карточку профиля. */
export const onAvatarClick = (userId: string, e: React.MouseEvent) => {
  e.stopPropagation();
  if (storyStateOf(userId, getState()) !== 'none') actions.openStories(userId);
  else openCard(userId, e);
};

/** Открыть мини-карточку профиля рядом с местом клика. */
export const openCard = (userId: string, e: React.MouseEvent) => {
  e.stopPropagation();
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const w = 336;
  const x = r.right + 12 + w > window.innerWidth ? r.left - w - 12 : r.right + 12;
  setUi({ card: { userId, x, y: r.top } });
};

export function Modal({ children, onClose, width = 520, className = '', label }: { children: ReactNode; onClose: () => void; width?: number; className?: string; label: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className={`modal ${className}`} style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function IconButton({ icon, label, onClick, active, alert, danger, size = 32 }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick?: () => void; active?: boolean; alert?: boolean; danger?: boolean; size?: number }) {
  return (
    <button type="button" className={`icon-btn ${active ? 'on' : ''} ${alert ? 'alert' : ''} ${danger ? 'danger' : ''}`} style={{ width: size, height: size }} aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={Math.round(size * 0.58)} />
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const formatDay = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};

/** Уменьшить картинку до нужного размера и вернуть data URL — чтобы не раздувать локальное хранилище. */
export const readImage = (file: File, maxW: number, maxH: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxW / img.width, maxH / img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/webp', 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });

export const colors = ['#2F8CFF', '#8B5CF6', '#FF6A3D', '#22D3EE', '#F472B6', '#FBBF24', '#34D399', '#60A5FA', '#F87171', '#0E7490', '#B45309', '#BE185D'];
