import { useMemo, useState, useSyncExternalStore } from 'react';
import * as social from '../online/social';
import { ME, uid } from '../data';
import { Icon } from '../icons';
import { actions, setUi, storyAuthors, useStore, type State } from '../store';
import type { Message, Server } from '../types';
import { GroupRow } from './Groups';
import { Avatar, formatTime, IconButton, onAvatarClick, openCard, usePerson, useSpeaking, useStoryState } from './common';

// Список чатов как в мессенджере, а не как в Discord:
// сверху полоса историй, ниже личные переписки с последним сообщением и сообщества-карточки с комнатами.
// Голосовой звонок — плашка внизу списка с кнопками микрофона и звука.

export const canManageServer = (server: Server) => {
  if (server.ownerId === ME) return true;
  const role = server.roles.find((r) => r.id === server.members.find((m) => m.userId === ME)?.roleId);
  return !!role && (role.perms.admin || role.perms.manageChannels || role.perms.manageRoles);
};

const lastOf = (list: Message[] | undefined) => list?.[list.length - 1];

/** Короткий текст последнего сообщения для строки списка */
const preview = (m: Message | undefined, who?: string) => {
  if (!m) return '';
  const body = m.text || (m.attachment?.sticker ? `${m.attachment.sticker.emoji} Стикер` : m.attachment?.poll ? `📊 ${m.attachment.poll.q}` : m.attachment?.game ? '🎲 Мини-игра' : m.attachment?.round ? '⭕ Кружочек' : m.attachment ? (m.attachment.type?.startsWith('image/') ? 'Фото' : m.attachment.type?.startsWith('video/') ? 'Видео' : m.attachment.type?.startsWith('audio/') ? '🎤 Голосовое' : 'Файл') : '');
  return who ? `${who}: ${body}` : body;
};

/* ---------- истории ---------- */

function StoryBubble({ userId }: { userId: string }) {
  const p = usePerson(userId);
  const st = useStoryState(userId);
  if (!p) return null;
  return (
    <button type="button" className={`story-bubble ${st}`} onClick={() => actions.openStories(userId)} title={p.name}>
      <Avatar person={p} size={52} showPresence={false} border="var(--panel)" />
      <span className="ellipsis">{p.name}</span>
    </button>
  );
}

function MyStory() {
  const me = usePerson(ME)!;
  const st = useStoryState(ME);
  return (
    <div className="story-bubble mine">
      <button type="button" className="plain" aria-label={st === 'none' ? 'Добавить историю' : 'Мои истории'} onClick={() => (st === 'none' ? setUi({ modal: { kind: 'storyComposer' } }) : actions.openStories(ME))}>
        <Avatar person={me} size={52} showPresence={false} border="var(--panel)" />
      </button>
      <button type="button" className="story-add" aria-label="Новая история" title="Новая история" onClick={() => setUi({ modal: { kind: 'storyComposer' } })}>
        <Icon name="plus" size={13} />
      </button>
      <span className="ellipsis">{st === 'none' ? 'Добавить' : 'Вы'}</span>
    </div>
  );
}

const selAuthors = (s: State) => storyAuthors(s).join(',');

function StoriesBar() {
  const authors = useStore(selAuthors);
  return (
    <div className="stories-bar" aria-label="Истории">
      <MyStory />
      {authors
        .split(',')
        .filter(Boolean)
        .map((id) => (
          <StoryBubble key={id} userId={id} />
        ))}
    </div>
  );
}

/* ---------- строки ---------- */

/** 🔥 серия дней подряд, как в TikTok/Snapchat */
export function StreakBadge({ userId }: { userId: string }) {
  useSyncExternalStore(social.onSocial, social.socialVersion);
  const s = social.streakWith(userId);
  if (!s.n) return null;
  return (
    <span className={`streak ${s.danger ? 'danger' : ''}`} title={s.danger ? `Огонёк ${s.n} дн. погаснет, если сегодня не напишете друг другу` : `Вы переписываетесь ${s.n} дн. подряд`}>
      🔥{s.n}
      {s.danger && '⏳'}
    </span>
  );
}

function DmRow({ userId, active }: { userId: string; active: boolean }) {
  const p = usePerson(userId);
  const last = useStore((s) => lastOf(s.messages[`dm:${userId}`]));
  if (!p) return null;
  return (
    <div className={`chat-row ${active ? 'on' : ''}`}>
      <button type="button" className="plain chat-row-av" onClick={(e) => onAvatarClick(userId, e)} aria-label={`Профиль ${p.name}`}>
        <Avatar person={p} size={44} border="var(--panel)" />
      </button>
      <button type="button" className="leaf chat-row-main" onClick={() => actions.openDm(userId)}>
        <span className="chat-row-top">
          <span className="strong ellipsis">{p.name}</span>
          <StreakBadge userId={userId} />
          {last && <span className="muted small">{formatTime(last.ts)}</span>}
        </span>
        <span className="muted small ellipsis">{preview(last, last?.authorId === ME ? 'Вы' : undefined) || (p.activity ?? 'Нажми, чтобы написать')}</span>
      </button>
    </div>
  );
}

function VoiceMember({ userId, speaking }: { userId: string; speaking: boolean }) {
  const p = usePerson(userId);
  const muted = useStore((s) => (userId === ME ? s.ui.muted : false));
  if (!p) return null;
  return (
    <button type="button" className="tree-voice-member" onClick={(e) => openCard(userId, e)}>
      <Avatar person={p} size={22} showPresence={false} ring={speaking} />
      <span className="ellipsis">{p.name}</span>
      {muted && <Icon name="micOff" size={13} className="red" />}
    </button>
  );
}

function RoomLastLine({ chatId }: { chatId: string }) {
  const last = useStore((s) => lastOf(s.messages[chatId]));
  const author = usePerson(last?.authorId ?? ME);
  if (!last) return null;
  return <span className="muted small ellipsis room-last">{preview(last, last.authorId === ME ? 'Вы' : author?.name)}</span>;
}

function Community({ server, filter }: { server: Server; filter: string }) {
  const collapsedMap = useStore((s) => s.ui.collapsed);
  const collapsed = !!collapsedMap[server.id];
  const active = useStore((s) => s.ui.view === 'server' && s.ui.serverId === server.id);
  const current = useStore((s) => s.lastChannel[server.id]);
  const voice = useStore((s) => s.ui.voice);
  const isSpeaking = useSpeaking();
  const [adding, setAdding] = useState(false);
  const [roomName, setRoomName] = useState('');
  const manage = canManageServer(server);

  const rooms = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q && !server.name.toLowerCase().includes(q) ? server.channels.filter((c) => c.name.toLowerCase().includes(q)) : server.channels;
  }, [server, filter]);
  if (filter && !rooms.length && !server.name.toLowerCase().includes(filter.toLowerCase())) return null;
  const open = !collapsed || !!filter;
  const firstText = server.channels.find((c) => c.kind === 'text');

  const openRoom = (id: string, kind: 'text' | 'voice') => {
    actions.openServer(server.id);
    actions.openChannel(server.id, id);
    if (kind === 'voice' && voice?.channelId !== id) void actions.joinVoice(server.id, id);
  };

  return (
    <div className={`community ${active ? 'on' : ''}`}>
      <div className="community-row">
        <button type="button" className="community-name" onClick={() => (firstText ? openRoom(current ?? firstText.id, 'text') : actions.openServer(server.id))}>
          <span className="community-badge" style={{ background: server.color }}>
            {server.short}
          </span>
          <span className="community-title">
            <span className="strong ellipsis">{server.name}</span>
            <span className="muted small">
              {server.members.length} {plural(server.members.length, 'участник', 'участника', 'участников')}
            </span>
          </span>
        </button>
        <span className="community-tools">
          <button type="button" aria-label="Пригласить" title="Пригласить" onClick={() => setUi({ view: 'server', serverId: server.id, modal: { kind: 'invite' } })}>
            <Icon name="userPlus" size={15} />
          </button>
          {!!server.openReports && (
            <button type="button" className="report-badge" aria-label={`Жалобы: ${server.openReports}`} title="Открытые жалобы" onClick={() => setUi({ view: 'server', serverId: server.id, modal: { kind: 'serverSettings' } })}>
              <Icon name="flag" size={13} /> {server.openReports}
            </button>
          )}
          {manage && (
            <button type="button" aria-label="Настройки сообщества" title="Настройки сообщества" onClick={() => setUi({ view: 'server', serverId: server.id, modal: { kind: 'serverSettings' } })}>
              <Icon name="settings" size={15} />
            </button>
          )}
          <button type="button" className="caret" aria-label={open ? 'Свернуть' : 'Развернуть'} aria-expanded={open} onClick={() => setUi({ collapsed: { ...collapsedMap, [server.id]: open } })}>
            <Icon name={open ? 'up' : 'down'} size={15} />
          </button>
        </span>
      </div>
      {open && (
        <div className="rooms">
          {rooms.map((c) => {
            const inVoice = server.voice[c.id] ?? [];
            return (
              <div key={c.id}>
                <button type="button" className={`leaf room-leaf kind-${c.kind} ${active && current === c.id ? 'on' : ''}`} onClick={() => openRoom(c.id, c.kind)}>
                  <span className="room-icon">
                    <Icon name={c.kind === 'text' ? 'bubble' : c.stage ? 'stage' : 'wave'} size={15} />
                  </span>
                  <span className="room-text">
                    <span className="ellipsis">{c.name}</span>
                    {c.kind === 'text' && <RoomLastLine chatId={c.id} />}
                  </span>
                  {c.kind === 'voice' && inVoice.length > 0 && <span className="leaf-count">{inVoice.length}</span>}
                </button>
                {c.kind === 'voice' && inVoice.length > 0 && (
                  <div className="tree-voice">
                    {inVoice.map((u) => (
                      <VoiceMember key={u} userId={u} speaking={isSpeaking(u)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {rooms.length === 0 && !filter && <p className="tree-hint">Комнат пока нет</p>}
          {manage &&
            !filter &&
            (adding ? (
              <form
                className="room-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = roomName.trim();
                  if (name) {
                    const id = uid();
                    actions.updateServer(server.id, (s) => ({ ...s, channels: [...s.channels, { id, name: name.toLowerCase().replace(/\s+/g, '-'), kind: 'text', category: 'КОМНАТЫ' }] }));
                    openRoom(id, 'text');
                  }
                  setRoomName('');
                  setAdding(false);
                }}
              >
                <Icon name="bubble" size={15} />
                <input autoFocus aria-label="Название комнаты" placeholder="новая-комната" value={roomName} onChange={(e) => setRoomName(e.target.value)} onBlur={() => !roomName && setAdding(false)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
              </form>
            ) : (
              <button type="button" className="leaf ghost" onClick={() => setAdding(true)}>
                <Icon name="plus" size={15} />
                Комната
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
};

/** Плашка звонка: где ты, микрофон, звук, отключиться */
function CallPill() {
  const voice = useStore((s) => s.ui.voice);
  const servers = useStore((s) => s.servers);
  const muted = useStore((s) => s.ui.muted);
  const deafened = useStore((s) => s.ui.deafened);
  if (!voice) return null;
  const srv = servers.find((s) => s.id === voice.serverId);
  const ch = srv?.channels.find((c) => c.id === voice.channelId);
  return (
    <div className="call-pill">
      <button type="button" className="call-pill-text" onClick={() => { actions.openServer(voice.serverId); actions.openChannel(voice.serverId, voice.channelId); }}>
        <span className="ok">
          <Icon name="signal" size={15} /> В звонке
        </span>
        <span className="muted small ellipsis">
          {ch?.name} · {srv?.name}
        </span>
      </button>
      <IconButton icon={muted ? 'micOff' : 'mic'} label={muted ? 'Включить микрофон' : 'Выключить микрофон'} alert={muted} onClick={actions.toggleMute} />
      <IconButton icon={deafened ? 'headphonesOff' : 'headphones'} label={deafened ? 'Включить звук' : 'Выключить звук'} alert={deafened} onClick={actions.toggleDeafen} />
      <IconButton icon="hangup" label="Отключиться" danger onClick={actions.leaveVoice} />
    </div>
  );
}

export function Sidebar() {
  const view = useStore((s) => s.ui.view);
  const homeTab = useStore((s) => s.ui.homeTab);
  const dmsOpen = useStore((s) => s.ui.dmsOpen);
  const dms = useStore((s) => s.dms);
  const groups = useStore((s) => s.groups);
  const users = useStore((s) => s.users);
  const pending = useStore((s) => s.pending.length);
  const servers = useStore((s) => s.servers);
  const [filter, setFilter] = useState('');

  const q = filter.trim().toLowerCase();
  const shownDms = q ? dms.filter((id) => users[id]?.name.toLowerCase().includes(q)) : dms;
  const savedGroup = groups.find((g) => g.saved);
  const shownGroups = (q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups).filter((g) => !g.saved);

  return (
    <aside className="tree" aria-label="Чаты">
      <StoriesBar />
      <div className="tree-top">
        <label className="tree-search">
          <Icon name="search" size={15} />
          <input
            aria-label="Поиск чатов"
            placeholder="Поиск чатов и сообщений"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setFilter('');
              if (e.key === 'Enter' && filter.trim()) actions.openSearch(filter.trim());
            }}
          />
        </label>
        {filter.trim().length >= 2 && (
          <button type="button" className="search-all" onClick={() => actions.openSearch(filter.trim())}>
            <Icon name="search" size={14} /> Искать «{filter.trim()}» во всех сообщениях
          </button>
        )}
      </div>
      <div className="tree-scroll">
        <div className="tree-sec">
          <button type="button" className="tree-sec-btn" aria-expanded={dmsOpen || !!q} onClick={() => setUi({ dmsOpen: !dmsOpen })}>
            Личные
            <Icon name={dmsOpen || q ? 'down' : 'chevronRight'} size={13} />
          </button>
          <button type="button" className="node" aria-label="Новая группа" title="Новая группа — переписка и звонки на нескольких" onClick={() => setUi({ modal: { kind: 'newGroup' } })}>
            <Icon name="plus" size={15} />
            Группа
          </button>
          <button type="button" className="node" aria-label="Новый канал" title="Канал — пишешь ты, подписчики читают" onClick={() => setUi({ modal: { kind: 'newChannel' } })}>
            <Icon name="megaphone" size={15} />
            Канал
          </button>
          <button type="button" className={`node ${view === 'home' && homeTab === 'friends' ? 'on' : ''}`} onClick={() => actions.openHome('friends')}>
            <Icon name="users" size={15} />
            Друзья
            {pending > 0 && <span className="count">{pending}</span>}
          </button>
        </div>
        {(dmsOpen || q) && (
          <div className="dm-list">
            {!q && (
              <div className={`chat-row saved-row ${savedGroup && view === 'home' && homeTab === `g:${savedGroup.id}` ? 'on' : ''}`}>
                <span className="chat-row-av">
                  <span className="saved-ico">
                    <Icon name="bookmark" size={20} />
                  </span>
                </span>
                <button type="button" className="leaf chat-row-main" onClick={() => void actions.openSaved()}>
                  <span className="chat-row-top">
                    <span className="strong ellipsis">Избранное</span>
                  </span>
                  <span className="muted small ellipsis">Заметки, ссылки, файлы — только для тебя</span>
                </button>
              </div>
            )}
            {shownGroups.map((g) => (
              <GroupRow key={g.id} group={g} active={view === 'home' && homeTab === `g:${g.id}`} />
            ))}
            {shownDms.map((id) => (
              <DmRow key={id} userId={id} active={view === 'home' && homeTab === id} />
            ))}
            {!shownDms.length && !shownGroups.length && <p className="tree-hint">{q ? 'Никого не нашлось' : 'Переписок пока нет — напиши другу из раздела «Друзья»'}</p>}
          </div>
        )}
        <div className="tree-sec">
          <span className="tree-sec-btn">Сообщества</span>
          <button type="button" className="node" aria-label="Создать или вступить" title="Создать или вступить" onClick={() => setUi({ modal: { kind: 'createServer' } })}>
            <Icon name="plus" size={15} />
            Новое
          </button>
        </div>
        {servers.map((s) => (
          <Community key={s.id} server={s} filter={filter} />
        ))}
        {!servers.length && (
          <button type="button" className="tree-empty" onClick={() => setUi({ modal: { kind: 'createServer' } })}>
            <Icon name="plus" size={18} />
            <span>
              <b>Создать сообщество</b>
              <span className="muted small">или вступить по приглашению</span>
            </span>
          </button>
        )}
      </div>
      <CallPill />
    </aside>
  );
}
