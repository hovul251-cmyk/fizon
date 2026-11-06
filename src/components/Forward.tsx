import { useMemo, useState, type ReactNode } from 'react';
import { shortName } from '../data';
import { Icon } from '../icons';
import { actions, setUi, useStore } from '../store';
import type { Message } from '../types';
import { Avatar, Modal, usePerson } from './common';
import { GroupBadge } from './Groups';

// Переслать сообщение в другой чат: личные, группы, комнаты сообществ.

interface Target {
  id: string;
  title: string;
  hint: string;
  kind: 'dm' | 'group' | 'room';
  color?: string;
  userId?: string;
}

function DmTitle({ userId, children }: { userId: string; children: (name: string) => ReactNode }) {
  const p = usePerson(userId);
  return <>{children(p?.name ?? '…')}</>;
}

function TargetIcon({ t }: { t: Target }) {
  const p = usePerson(t.userId ?? '');
  if (t.kind === 'dm' && p) return <Avatar person={p} size={34} showPresence={false} />;
  if (t.kind === 'group') return <GroupBadge group={{ id: t.id, name: t.title, color: t.color ?? '#2F8CFF', ownerId: '', members: [] }} size={34} />;
  return (
    <span className="community-badge" style={{ background: t.color, width: 34, height: 34 }}>
      {shortName(t.hint)}
    </span>
  );
}

export function ForwardModal({ msg, onClose }: { msg: Message; onClose: () => void }) {
  const dms = useStore((s) => s.dms);
  const friends = useStore((s) => s.friends);
  const groups = useStore((s) => s.groups);
  const servers = useStore((s) => s.servers);
  const users = useStore((s) => s.users);
  const author = usePerson(msg.authorId);
  const [q, setQ] = useState('');

  const targets = useMemo<Target[]>(
    () => [
      // переписки и друзья, с которыми ещё не переписывались
      ...[...new Set([...dms, ...friends])].map((u) => ({ id: `dm:${u}`, title: users[u]?.name ?? '', hint: dms.includes(u) ? 'личные' : 'друг', kind: 'dm' as const, userId: u })),
      ...[...groups].sort((a, b) => Number(!!b.saved) - Number(!!a.saved)).map((g) => ({ id: `g:${g.id}`, title: g.saved ? '★ Избранное' : g.name, hint: g.saved ? 'только для тебя' : `группа · ${g.members.length}`, kind: 'group' as const, color: g.color })),
      ...servers.flatMap((sv) => sv.channels.filter((c) => c.kind === 'text').map((c) => ({ id: c.id, title: `# ${c.name}`, hint: sv.name, kind: 'room' as const, color: sv.color }))),
    ],
    [dms, friends, groups, servers, users],
  );
  const shown = targets.filter((t) => !q.trim() || `${t.title} ${t.hint}`.toLowerCase().includes(q.trim().toLowerCase()));

  const send = (t: Target) => {
    const from = author?.name ?? 'кто-то';
    const text = `↪ Переслано от ${from}${msg.text ? `:\n${msg.text}` : ''}`;
    actions.send(t.id, text, undefined, msg.attachment);
    onClose();
    setUi({ toast: { text: `Переслано: ${t.kind === 'dm' ? users[t.userId!]?.name ?? '' : t.title}`, id: Date.now() } });
  };

  return (
    <Modal onClose={onClose} width={440} label="Переслать" className="composer-modal">
      <div className="modal-head">
        <h2>Переслать</h2>
        <p className="muted small ellipsis">{msg.text || (msg.attachment ? `📎 ${msg.attachment.name}` : '')}</p>
      </div>
      <label className="search wide">
        <Icon name="search" size={16} />
        <input aria-label="Кому переслать" placeholder="Кому переслать" value={q} autoFocus onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="pick-list forward-list">
        {shown.map((t) => (
          <button type="button" key={t.id} className="pick-row" onClick={() => send(t)}>
            <TargetIcon t={t} />
            <span className="grow ellipsis">
              {t.kind === 'dm' ? <DmTitle userId={t.userId!}>{(n) => <b>{n}</b>}</DmTitle> : <b>{t.title}</b>}
              <span className="muted small"> · {t.hint}</span>
            </span>
            <Icon name="forward" size={16} />
          </button>
        ))}
        {!shown.length && <p className="muted small">Нет подходящих чатов</p>}
      </div>
    </Modal>
  );
}
