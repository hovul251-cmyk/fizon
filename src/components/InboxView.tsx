import { useEffect, useMemo, useState } from 'react';
import { askNotifyPermission, notifyPermission } from '../lib/notify';
import { pushSupported, subscribePush } from '../lib/push';
import * as remote from '../online/remote';
import { ME } from '../data';
import { Icon } from '../icons';
import { actions, useStore, type State } from '../store';
import type { Message } from '../types';
import { Avatar, formatDay, formatTime, IconButton, usePerson } from './common';

// «Входящие» — всё, что ждёт ответа: заявки в друзья, упоминания и ответы на твои сообщения.

export interface InboxItem {
  kind: 'mention' | 'reply';
  chatId: string;
  msg: Message;
  where: string;
  open: () => void;
}

const selMessages = (s: State) => s.messages;
const selServers = (s: State) => s.servers;
const selUsers = (s: State) => s.users;
const selName = (s: State) => s.profile.displayName;
const selUsername = (s: State) => s.profile.username;
const selSeen = (s: State) => s.settings.inboxSeenAt ?? 0;
const selPending = (s: State) => s.pending.length;

export function useInbox() {
  const messages = useStore(selMessages);
  const servers = useStore(selServers);
  const users = useStore(selUsers);
  const name = useStore(selName);
  const username = useStore(selUsername);
  const seen = useStore(selSeen);
  const pending = useStore(selPending);

  const items = useMemo(() => {
    const mine = new Set<string>();
    Object.values(messages).forEach((list) => list.forEach((m) => m.authorId === ME && mine.add(m.id)));
    const tags = [name, username].filter(Boolean).map((t) => '@' + t.toLowerCase());
    const where = (chatId: string): [string, () => void] => {
      if (chatId.startsWith('dm:')) {
        const id = chatId.slice(3);
        return [`Личные · ${users[id]?.name ?? 'собеседник'}`, () => actions.openDm(id)];
      }
      const srv = servers.find((s) => s.channels.some((c) => c.id === chatId));
      const ch = srv?.channels.find((c) => c.id === chatId);
      return [srv && ch ? `${srv.name} · ${ch.name}` : 'Комната', () => srv && (actions.openServer(srv.id), actions.openChannel(srv.id, chatId))];
    };
    const out: InboxItem[] = [];
    for (const [chatId, list] of Object.entries(messages)) {
      for (const m of list) {
        if (m.authorId === ME) continue;
        const text = m.text.toLowerCase();
        const kind = m.replyTo && mine.has(m.replyTo) ? 'reply' : tags.some((t) => text.includes(t)) ? 'mention' : null;
        if (!kind) continue;
        const [label, open] = where(chatId);
        out.push({ kind, chatId, msg: m, where: label, open });
      }
    }
    return out.sort((a, b) => b.msg.ts - a.msg.ts).slice(0, 100);
  }, [messages, servers, users, name, username]);

  const unread = pending + items.filter((i) => i.msg.ts > seen).length;
  return { items, unread, seen };
}

function Item({ item, fresh }: { item: InboxItem; fresh: boolean }) {
  const author = usePerson(item.msg.authorId);
  if (!author) return null;
  return (
    <button type="button" className={`inbox-item ${fresh ? 'fresh' : ''}`} onClick={item.open}>
      <Avatar person={author} size={36} showPresence={false} />
      <span className="inbox-body">
        <span className="inbox-meta">
          <b style={author.nameStyle}>{author.name}</b>
          <span className="muted small">{item.kind === 'reply' ? 'ответил(а) тебе' : 'упомянул(а) тебя'}</span>
          <span className="muted small ml-auto">
            {formatDay(item.msg.ts)}, {formatTime(item.msg.ts)}
          </span>
        </span>
        <span className="inbox-text">{item.msg.text || item.msg.attachment?.name}</span>
        <span className="muted small">{item.where}</span>
      </span>
    </button>
  );
}

function Request({ userId }: { userId: string }) {
  const p = usePerson(userId);
  if (!p) return null;
  return (
    <div className="inbox-item static">
      <Avatar person={p} size={36} />
      <span className="inbox-body">
        <span className="inbox-meta">
          <b style={p.nameStyle}>{p.name}</b>
          <span className="muted small">хочет добавить тебя в друзья</span>
        </span>
        <span className="muted small">@{p.username}</span>
      </span>
      <IconButton icon="check" label="Принять" size={36} onClick={() => actions.acceptFriend(userId)} />
      <IconButton icon="close" label="Отклонить" size={36} danger onClick={() => actions.declineFriend(userId)} />
    </div>
  );
}

/** Подсказка включить уведомления — пока разрешение не дали и не отказались */
function NotifyCard() {
  const [perm, setPerm] = useState(notifyPermission());
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('fizion-notify-card') === 'hidden';
    } catch {
      return false;
    }
  });
  if (hidden || perm !== 'default') return null;
  return (
    <div className="notify-card">
      <Icon name="bell" size={20} />
      <span className="grow">
        <b>Включи уведомления</b>
        <span className="muted small">Чтобы не пропустить личные сообщения, упоминания и звонки, даже когда Fizion свёрнут</span>
      </span>
      <button
        type="button"
        className="btn small primary"
        onClick={async () => {
          setPerm(await askNotifyPermission());
          if (pushSupported() && notifyPermission() === 'granted') void subscribePush(remote.savePushSub);
        }}
      >
        Включить
      </button>
      <button
        type="button"
        className="plain"
        aria-label="Не сейчас"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem('fizion-notify-card', 'hidden');
          } catch {
            /* не важно */
          }
        }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function InboxView() {
  const { items, seen } = useInbox();
  const pending = useStore((s) => s.pending);

  // открыли — считаем прочитанным (через секунду, чтобы новые успели подсветиться)
  useEffect(() => {
    const t = window.setTimeout(() => actions.updateSettings({ inboxSeenAt: Date.now() }), 1500);
    return () => window.clearTimeout(t);
  }, [items.length]);

  return (
    <main className="chat">
      <header className="chat-head">
        <Icon name="inbox" className="muted" />
        <span className="strong">Входящие</span>
        <span className="muted small">упоминания, ответы и заявки</span>
      </header>
      <div className="inbox">
        <NotifyCard />
        {pending.length > 0 && (
          <>
            <div className="cat">ЗАЯВКИ В ДРУЗЬЯ — {pending.length}</div>
            {pending.map((id) => (
              <Request key={id} userId={id} />
            ))}
          </>
        )}
        {items.length > 0 && <div className="cat">УПОМИНАНИЯ И ОТВЕТЫ</div>}
        {items.map((i) => (
          <Item key={i.msg.id} item={i} fresh={i.msg.ts > seen} />
        ))}
        {!items.length && !pending.length && (
          <div className="empty">
            <div className="empty-icon">
              <Icon name="inbox" size={36} />
            </div>
            <h2>Всё прочитано</h2>
            <p className="muted">Сюда придут упоминания @{'имени'}, ответы на твои сообщения и заявки в друзья</p>
          </div>
        )}
      </div>
    </main>
  );
}
