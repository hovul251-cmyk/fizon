import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import * as social from '../online/social';
import { ME } from '../data';
import { Icon, type IconName } from '../icons';
import { toast } from '../online/sync';
import { ONLINE } from '../lib/appwrite';
import { GiftModal, ProfileGifts } from './Wallet';
import { actions, setUi, useStore } from '../store';
import type { Profile, User, Visibility, Widget } from '../types';
import { Modal, StoryAvatar, nameStyleOf, personFromProfile, personFromUser, presenceLabel } from './common';

/** Внешний вид карточки по стилю, который выбрал пользователь. */
export const cardLook = (p: Pick<Profile, 'cardStyle' | 'cardColor' | 'nameColor'>): CSSProperties => {
  switch (p.cardStyle) {
    case 'neon':
      return { background: p.cardColor, border: `2px solid ${p.nameColor}`, boxShadow: `0 0 24px ${p.nameColor}55` };
    case 'matte':
      return { background: p.cardColor, border: '1px solid rgba(255,255,255,.06)' };
    case 'minimal':
      return { background: 'var(--bg1)', border: '1px solid var(--line)' };
    default:
      return { background: p.cardColor, border: `2px solid ${p.nameColor}`, boxShadow: `0 0 0 4px ${p.nameColor}2E` };
  }
};

export const bannerLook = (p: Pick<Profile, 'bannerColor' | 'bannerColor2' | 'bannerImage'>): CSSProperties =>
  p.bannerImage ? { background: `center/cover url(${p.bannerImage})` } : { background: `radial-gradient(circle at 85% 10%, ${p.bannerColor2}99, transparent 55%), ${p.bannerColor}` };

const badgeList: { icon: IconName; label: string }[] = [{ icon: 'star', label: 'Ранний тестер Neon' }];

const canSee = (v: Visibility, asStranger: boolean) => v === 'all' || (v === 'friends' && !asStranger);

/** Мини-карточка профиля. Используется во всплывашке и в предпросмотре редактора. */
export function ProfileCardView({ profile, user, asStranger = false, compact = false }: { profile?: Profile; user?: User; asStranger?: boolean; compact?: boolean }) {
  const reduceMotion = useStore((s) => s.settings.reduceMotion);
  if (user && !user.profile) {
    const p = personFromUser(user);
    return (
      <div className="pcard" style={{ background: 'var(--bg1)', border: '1px solid var(--line)' }}>
        <div className="pcard-banner" style={{ background: user.color }} />
        <div className="pcard-top">
          <StoryAvatar person={p} size={88} border="var(--bg1)" />
        </div>
        <div className="pcard-body">
          <div>
            <div className="pcard-name" style={{ color: user.nameColor }}>
              {user.name}
            </div>
            <div className="muted small">
              {user.username} · {presenceLabel[user.presence]}
            </div>
          </div>
          {user.activity && <div className="pcard-status">{user.activity}</div>}
          {user.about && (
            <div>
              <div className="sec">О СЕБЕ</div>
              <div className="pcard-text">{user.about}</div>
            </div>
          )}
        </div>
      </div>
    );
  }
  const pr = profile ?? user!.profile!;
  const me = user ? personFromUser(user) : personFromProfile(pr);
  const vis = (t: Widget['type']) => {
    const w = pr.widgets.find((x) => x.type === t);
    return !!w && canSee(w.visible, asStranger);
  };
  return (
    <div className={`pcard ${compact ? 'compact' : ''} ${pr.nameEffect === 'glow' && !reduceMotion ? 'glow' : ''}`} style={cardLook(pr)}>
      <div className="pcard-banner" style={bannerLook(pr)} />
      <div className="pcard-top">
        <StoryAvatar person={me} size={compact ? 72 : 88} border={pr.cardStyle === 'minimal' ? 'var(--bg1)' : pr.cardColor} />
        {vis('badges') && (
          <div className="pcard-badges">
            {badgeList.map((b) => (
              <span key={b.icon} className={`b-${b.icon}`} title={b.label}>
                <Icon name={b.icon} size={16} />
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="pcard-body">
        <div>
          <div className="pcard-name" style={nameStyleOf(pr)}>
            {pr.displayName}
          </div>
          <div className="muted-violet small">
            {pr.username}
            {pr.pronouns && ` · ${pr.pronouns}`}
          </div>
        </div>
        {pr.status && (
          <div className="pcard-status">
            <span className="pdot" style={{ background: 'var(--cyan)' }} />
            {pr.status}
          </div>
        )}
        {vis('about') && pr.about && (
          <div>
            <div className="sec">О СЕБЕ</div>
            <div className="pcard-text">{pr.about}</div>
          </div>
        )}
        {vis('links') && pr.links.length > 0 && (
          <div>
            <div className="sec">ССЫЛКИ</div>
            <div className="pcard-links">
              {pr.links.map((l) => (
                <a key={l.id} href={l.url} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        )}
        {!compact && vis('now') && pr.activity && (
          <div>
            <div className="sec">СЕЙЧАС</div>
            <div className="pcard-now">
              <span>
                <Icon name="play" />
              </span>
              <b>{pr.activity}</b>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Всплывающая мини-карточка рядом с именем. */
export function ProfilePopover() {
  const card = useStore((s) => s.ui.card);
  const profile = useStore((s) => s.profile);
  const users = useStore((s) => s.users);
  const friends = useStore((s) => s.friends);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!card) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setUi({ card: null });
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setUi({ card: null });
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  }, [card]);

  if (!card) return null;
  const isMe = card.userId === ME;
  const user = users[card.userId];
  const w = 336;
  const h = 520;
  const x = Math.min(card.x, window.innerWidth - w - 12);
  const y = Math.max(40, Math.min(card.y, window.innerHeight - h - 12));

  return (
    <div className="popover" ref={ref} style={{ left: Math.max(12, x), top: y, width: w }}>
      {isMe ? <ProfileCardView profile={profile} compact /> : user && <ProfileCardView user={user} asStranger={!friends.includes(user.id)} compact />}
      <div className="popover-actions">
        <button type="button" className="btn small" onClick={() => setUi({ card: null, modal: { kind: 'profile', userId: card.userId } })}>
          Открыть профиль
        </button>
        {isMe ? (
          <button type="button" className="btn small primary" onClick={() => setUi({ card: null, modal: { kind: 'editor' } })}>
            Изменить
          </button>
        ) : (
          <button type="button" className="btn small primary" onClick={() => actions.openDm(card.userId)}>
            Написать
          </button>
        )}
      </div>
      {!isMe && <ModTools userId={card.userId} />}
    </div>
  );
}

/** Модератор открыл карточку участника своего сообщества: мут, выгнать, бан */
function ModTools({ userId }: { userId: string }) {
  const server = useStore((s) => (s.ui.view === 'server' ? s.servers.find((x) => x.id === s.ui.serverId) : undefined));
  const [open, setOpen] = useState(false);
  if (!server) return null;
  const myRole = server.roles.find((r) => r.id === server.members.find((m) => m.userId === ME)?.roleId);
  const amMod = server.ownerId === ME || !!(myRole && (myRole.perms.admin || myRole.perms.kickBan || myRole.perms.timeout));
  const target = server.members.find((m) => m.userId === userId);
  if (!amMod || !target || server.ownerId === userId) return null;
  const muted = (server.mutes?.[userId] ?? 0) > Date.now();
  const run = async (kind: 'kick' | 'ban' | 'mute' | 'unmute', minutes?: number) => {
    if ((kind === 'ban' || kind === 'kick') && !confirm(kind === 'ban' ? 'Забанить: удалить из сообщества и не пускать обратно?' : 'Выгнать из сообщества? Вернуться можно по приглашению.')) return;
    toast(await actions.moderate(kind, server.id, userId, minutes));
    setUi({ card: null });
  };
  return (
    <div className="mod-tools">
      <button type="button" className="mod-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="lock" size={14} /> Модерация {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mod-actions">
          {muted ? (
            <button type="button" className="btn small" onClick={() => void run('unmute')}>
              Снять мут
            </button>
          ) : (
            <>
              <button type="button" className="btn small" onClick={() => void run('mute', 10)}>
                Мут 10 мин
              </button>
              <button type="button" className="btn small" onClick={() => void run('mute', 60)}>
                1 час
              </button>
              <button type="button" className="btn small" onClick={() => void run('mute', 1440)}>
                1 день
              </button>
            </>
          )}
          <button type="button" className="btn small" onClick={() => void run('kick')}>
            Выгнать
          </button>
          <button type="button" className="btn small danger-outline" onClick={() => void run('ban')}>
            Забанить
          </button>
        </div>
      )}
    </div>
  );
}

const tileColors = ['#2E1F5E', '#0B3A44', '#3F2A0B', '#3B1230', '#1F2A44', '#14352A'];
const gameColors = ['#166534', '#9A3412', '#1E3A8A', '#6B21A8', '#155E75'];

/** Полный профиль в отдельном окне: свой или чужой. */
export function ProfileModal({ userId }: { userId: string }) {
  const myProfileData = useStore((s) => s.profile);
  const user = useStore((s) => s.users[userId]);
  const friends = useStore((s) => s.friends);
  const close = () => setUi({ modal: null });
  const isMe = userId === ME;
  const isFriend = friends.includes(userId);

  const addFriend = async () => toast(await actions.requestFriend(userId));
  const [gift, setGift] = useState(false);

  // демо-пользователи офлайн-режима без оформления — простая карточка
  if (!isMe && (!user || !user.profile)) {
    if (!user) return null;
    const p = personFromUser(user);
    return (
      <Modal onClose={close} width={640} label={`Профиль ${user.name}`} className="profile-modal">
        <div className="pm-banner" style={{ background: user.color }} />
        <div className="pm-head">
          <StoryAvatar person={p} size={112} border="var(--bg1)" />
          <div className="pm-who">
            <div className="pm-name" style={{ color: user.nameColor }}>
              {user.name}
            </div>
            <div className="muted">{user.username}</div>
          </div>
          <div className="pm-btns">
            <button type="button" className="btn primary" onClick={() => actions.openDm(userId)}>
              Написать
            </button>
            {!isFriend && !social.isBlocked(userId) && (
              <button type="button" className="btn" onClick={addFriend}>
                В друзья
              </button>
            )}
            <BlockButton userId={userId} />
          </div>
        </div>
        <div className="pm-grid one">
          <div className="widget">
            <div className="sec">О СЕБЕ</div>
            <div className="pcard-text">{user.about || 'Пользователь пока ничего о себе не рассказал.'}</div>
          </div>
        </div>
        <button type="button" className="close-x" aria-label="Закрыть" onClick={close}>
          <Icon name="close" />
        </button>
      </Modal>
    );
  }

  const profile = isMe ? myProfileData : user!.profile!;
  const person = isMe ? personFromProfile(profile) : personFromUser(user!);
  const asStranger = !isMe && !isFriend;
  const order = profile.widgets.filter((w) => canSee(w.visible, asStranger) && w.type !== 'badges');
  const widget = (w: Widget) => {
    switch (w.type) {
      case 'about':
        return profile.about ? (
          <div className="widget" key="about">
            <div className="sec">О СЕБЕ</div>
            <div className="pcard-text">{profile.about}</div>
          </div>
        ) : null;
      case 'links':
        return profile.links.length ? (
          <div className="widget" key="links">
            <div className="sec">ССЫЛКИ</div>
            <div className="pm-links">
              {profile.links.map((l) => (
                <a key={l.id} href={l.url} target="_blank" rel="noreferrer">
                  <Icon name="link" size={16} /> {l.label}
                </a>
              ))}
            </div>
          </div>
        ) : null;
      case 'now':
        return profile.activity ? (
          <div className="widget" key="now">
            <div className="sec">СЕЙЧАС</div>
            <div className="pcard-now big">
              <span>
                <Icon name="play" size={24} />
              </span>
              <b>{profile.activity}</b>
            </div>
          </div>
        ) : null;
      case 'showcase':
        return profile.showcase.length ? (
          <div className="widget wide" key="showcase">
            <div className="sec">ВИТРИНА РАБОТ</div>
            <div className="showcase">
              {profile.showcase.map((s, i) => (
                <div key={s + i} style={{ background: tileColors[i % tileColors.length] }}>
                  {s}
                </div>
              ))}
            </div>
          </div>
        ) : null;
      case 'games':
        return profile.games.length ? (
          <div className="widget" key="games">
            <div className="sec">ЛЮБИМЫЕ ИГРЫ</div>
            {profile.games.map((g, i) => (
              <div className="game" key={g}>
                <span style={{ background: gameColors[i % gameColors.length] }} />
                {g}
              </div>
            ))}
          </div>
        ) : null;
      default:
        return null;
    }
  };
  const blocks = order.map(widget).filter(Boolean);

  return (
    <Modal onClose={close} width={960} label={isMe ? 'Мой профиль' : `Профиль ${profile.displayName}`} className="profile-modal">
      <div className="pm-frame" style={cardLook(profile)}>
        <div className="pm-banner tall" style={bannerLook(profile)} />
        <div className="pm-head">
          <StoryAvatar person={person} size={128} border={profile.cardStyle === 'minimal' ? 'var(--bg1)' : profile.cardColor} />
          <div className="pm-who">
            <div className="pm-name" style={nameStyleOf(profile)}>
              {profile.displayName}
            </div>
            <div className="muted-violet">
              {profile.username}
              {profile.pronouns && ` · ${profile.pronouns}`}
              {profile.status && ` · ${profile.status}`}
            </div>
          </div>
          <div className="pm-btns">
            {isMe ? (
              <button type="button" className="btn primary" onClick={() => setUi({ modal: { kind: 'editor' } })}>
                Редактировать профиль
              </button>
            ) : (
              <>
                <button type="button" className="btn primary" onClick={() => actions.openDm(userId)}>
                  Написать
                </button>
                {!isFriend && !social.isBlocked(userId) && (
                  <button type="button" className="btn" onClick={addFriend}>
                    В друзья
                  </button>
                )}
                {ONLINE && (
                  <button type="button" className="btn" onClick={() => setGift(true)}>
                    <Icon name="gift" size={16} /> Подарок
                  </button>
                )}
                <BlockButton userId={userId} />
              </>
            )}
          </div>
        </div>
        <ProfileBasics userId={userId} profile={profile} />
        <div className="pm-grid">{blocks}</div>
        {blocks.length === 0 && (
          <p className="muted pad-l">{isMe ? 'Профиль пока пустой. Добавь «О себе», ссылки или витрину работ в редакторе.' : 'Пользователь пока не заполнил профиль или скрыл его.'}</p>
        )}
      </div>
      <button type="button" className="close-x" aria-label="Закрыть" onClick={close}>
        <Icon name="close" />
      </button>
      {gift && <GiftModal to={userId} onClose={() => setGift(false)} />}
    </Modal>
  );
}

/** Главное о человеке: логин, ID, о себе, во что играет сейчас, все его истории и подарки */
function ProfileBasics({ userId, profile }: { userId: string; profile: Profile }) {
  const all = useStore((s) => s.stories);
  const stories = all.filter((x) => x.authorId === userId && x.expiresAt > Date.now()).sort((a, b) => a.ts - b.ts);
  const copy = (t: string, what: string) => {
    void navigator.clipboard?.writeText(t);
    setUi({ toast: { text: `${what} скопирован`, id: Date.now() } });
  };
  const live = profile.liveApp && Date.now() - profile.liveApp.since < 6 * 3600_000 ? profile.liveApp : null;
  return (
    <div className="pm-basics">
      <div className="pm-facts">
        <button type="button" className="fact" onClick={() => copy('@' + profile.username, 'Логин')} title="Скопировать">
          <span className="muted small">Логин</span>
          <b>@{profile.username}</b>
        </button>
        {profile.num && (
          <button type="button" className="fact" onClick={() => copy(profile.num!, 'ID')} title="Скопировать">
            <span className="muted small">ID</span>
            <b>{profile.num}</b>
          </button>
        )}
        {live && (
          <span className="fact live">
            <span className="muted small">Сейчас</span>
            <b>
              <Icon name="gamepad" size={14} /> {live.name}
            </b>
          </span>
        )}
      </div>
      <div className="pm-about">
        <div className="sec">О СЕБЕ</div>
        <div className="pcard-text">{profile.about || (userId === ME ? 'Расскажи о себе в редакторе профиля.' : 'Пока ничего не рассказал о себе.')}</div>
      </div>
      {stories.length > 0 && (
        <div className="pm-stories">
          <div className="sec">ИСТОРИИ · {stories.length}</div>
          <div className="pm-story-row">
            {stories.map((st, i) => (
              <button type="button" key={st.id} className="pm-story" aria-label={`История ${i + 1}`} onClick={() => setUi({ modal: null, stories: { userId, index: i } })}>
                {st.kind === 'video' ? <video src={st.url} muted preload="metadata" /> : <img src={st.url} alt="" loading="lazy" />}
                <span className="small">{new Date(st.ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <ProfileGifts userId={userId} />
    </div>
  );
}

/** Заблокировать / разблокировать человека */
function BlockButton({ userId }: { userId: string }) {
  useSyncExternalStore(social.onSocial, social.socialVersion);
  const on = social.isBlocked(userId);
  return (
    <button
      type="button"
      className={`btn ${on ? '' : 'danger-outline'}`}
      onClick={() => {
        if (on) return void social.unblock(userId);
        if (confirm('Заблокировать? Он не сможет писать тебе в личные, звонить, добавлять в друзья и в группы. Его сообщения в общих чатах будут свёрнуты.')) void social.block(userId);
      }}
    >
      <Icon name="block" size={16} /> {on ? 'Разблокировать' : 'Заблокировать'}
    </button>
  );
}
