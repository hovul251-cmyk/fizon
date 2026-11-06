import { useState } from 'react';
import { ME, shortName } from '../data';
import { Icon } from '../icons';
import { actions, setUi, useStore } from '../store';
import type { Group, Message } from '../types';
import { ChatView } from './ChatView';
import { useEncrypted } from './useEncrypted';
import { Avatar, formatTime, IconButton, Modal, openCard, usePerson } from './common';

// Группы: переписка и звонки на нескольких друзей без создания сообщества.

export function GroupBadge({ group, size = 44 }: { group: Group; size?: number }) {
  return (
    <span className="group-badge" style={{ width: size, height: size, background: group.color, fontSize: Math.round(size * 0.34) }}>
      {shortName(group.name)}
    </span>
  );
}

const lastOf = (list: Message[] | undefined) => list?.[list.length - 1];

export function GroupRow({ group, active }: { group: Group; active: boolean }) {
  const last = useStore((s) => lastOf(s.messages[`g:${group.id}`]));
  const author = usePerson(last?.authorId ?? ME);
  return (
    <div className={`chat-row ${active ? 'on' : ''}`}>
      <span className="chat-row-av">
        <GroupBadge group={group} />
      </span>
      <button type="button" className="leaf chat-row-main" onClick={() => actions.openHome(`g:${group.id}`)}>
        <span className="chat-row-top">
          <span className="strong ellipsis">{group.name}</span>
          {last && <span className="muted small">{formatTime(last.ts)}</span>}
        </span>
        <span className="muted small ellipsis">
          {last ? `${last.authorId === ME ? 'Вы' : author?.name}: ${last.text || 'вложение'}` : `${group.members.length} участников`}
        </span>
      </button>
    </div>
  );
}

function FriendPick({ userId, on, toggle }: { userId: string; on: boolean; toggle: () => void }) {
  const p = usePerson(userId);
  if (!p) return null;
  return (
    <label className={`pick-row ${on ? 'on' : ''}`}>
      <input type="checkbox" checked={on} onChange={toggle} />
      <Avatar person={p} size={32} showPresence={false} />
      <span className="ellipsis">{p.name}</span>
    </label>
  );
}

export function NewGroupModal() {
  const friends = useStore((s) => s.friends);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => !busy && setUi({ modal: null });
  const create = async () => {
    setBusy(true);
    const err = await actions.createGroup(name.trim() || 'Группа', picked);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <Modal onClose={close} width={440} label="Новая группа" className="composer-modal">
      <div className="modal-head">
        <h2>Новая группа</h2>
        <p className="muted small">Переписка и звонки на нескольких друзей — без создания сообщества. До 50 человек.</p>
      </div>
      <input className="input" aria-label="Название группы" placeholder="Название, например «Тиммейты»" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="cat flat">ДРУЗЬЯ · выбрано {picked.length}</div>
      <div className="pick-list">
        {friends.map((id) => (
          <FriendPick key={id} userId={id} on={picked.includes(id)} toggle={() => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
        ))}
        {!friends.length && <p className="muted small">Сначала добавь друзей — в группу можно позвать только их.</p>}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={close} disabled={busy}>
          Отмена
        </button>
        <button type="button" className="btn primary" disabled={busy || !picked.length} onClick={() => void create()}>
          {busy ? 'Создаю…' : 'Создать группу'}
        </button>
      </div>
    </Modal>
  );
}

function Member({ userId, owner }: { userId: string; owner: boolean }) {
  const p = usePerson(userId);
  if (!p) return null;
  return (
    <button type="button" className="member" onClick={(e) => openCard(userId, e)}>
      <Avatar person={p} size={32} />
      <span className="member-text">
        <span className="strong ellipsis" style={p.nameStyle}>
          {p.name}
        </span>
        {owner && <span className="muted small">создатель</span>}
      </span>
    </button>
  );
}

/** «Избранное»: чат с самим собой */
function SavedView({ group }: { group: Group }) {
  return (
    <div className="room">
      <ChatView
        chatId={`g:${group.id}`}
        title="Избранное"
        icon="community"
        community={{ short: '★', color: group.color }}
        crumb="только для тебя"
        placeholder="Заметка, ссылка или файл"
        intro={
          <>
            <span className="saved-ico big">
              <Icon name="bookmark" size={40} />
            </span>
            <h2>Избранное</h2>
            <p className="muted">Сюда можно пересылать сообщения, сохранять ссылки, файлы и заметки. Видишь только ты — на всех своих устройствах, и всё зашифровано.</p>
          </>
        }
      />
    </div>
  );
}

export function GroupView({ group }: { group: Group }) {
  if (group.saved) return <SavedView group={group} />;
  return <GroupChat group={group} />;
}

function GroupChat({ group }: { group: Group }) {
  const [panel, setPanel] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState(group.name);
  const friends = useStore((s) => s.friends);
  const candidates = friends.filter((f) => !group.members.includes(f));
  const encrypted = useEncrypted(`g:${group.id}`);
  return (
    <div className="room">
      <ChatView
        chatId={`g:${group.id}`}
        title={group.name}
        icon="community"
        community={{ short: shortName(group.name), color: group.color }}
        crumb={`${group.members.length} участников`}
        placeholder="Сообщение в группу"
        encrypted={encrypted}
        onCall={(video) => void actions.startCall(`g:${group.id}`, video)}
        extraTools={<IconButton icon="users" label="Участники группы" active={panel} onClick={() => setPanel((v) => !v)} />}
        intro={
          <>
            <GroupBadge group={group} size={80} />
            <h2>{group.name}</h2>
            <p className="muted">Начало группы. Здесь можно переписываться и созваниваться всем вместе.</p>
          </>
        }
      />
      {panel && (
        <div className="drawer">
          <div className="drawer-head">
            <span className="strong">Участники · {group.members.length}</span>
            <button type="button" className="plain" aria-label="Закрыть" onClick={() => setPanel(false)}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="members group-members">
            {group.members.map((id) => (
              <Member key={id} userId={id} owner={id === group.ownerId} />
            ))}
            {adding ? (
              <div className="pick-list">
                {candidates.map((id) => (
                  <FriendPick
                    key={id}
                    userId={id}
                    on={false}
                    toggle={() => {
                      void actions.addToGroup(group.id, id);
                      setAdding(false);
                    }}
                  />
                ))}
                {!candidates.length && <p className="muted small">Все друзья уже в группе</p>}
              </div>
            ) : (
              <button type="button" className="btn small" onClick={() => setAdding(true)}>
                <Icon name="userPlus" size={15} /> Добавить друга
              </button>
            )}
            <form
              className="row gap-s"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim() && title.trim() !== group.name) void actions.renameGroup(group.id, title.trim().slice(0, 40));
              }}
            >
              <input className="input grow" aria-label="Название группы" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
              <button type="submit" className="btn small" disabled={!title.trim() || title.trim() === group.name}>
                OK
              </button>
            </form>
            <button type="button" className="btn small danger-outline" onClick={() => confirm(`Выйти из группы «${group.name}»?`) && void actions.leaveGroup(group.id)}>
              Выйти из группы
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
