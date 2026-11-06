import { useState } from 'react';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import { actions, setUi, useStore } from '../store';
import { ChatView } from './ChatView';
import { GroupView } from './Groups';
import { useEncrypted } from './useEncrypted';
import { StreakBadge } from './Sidebar';

import { Avatar, BackButton, IconButton, openCard, presenceLabel, StoryAvatar, usePerson } from './common';

function FriendRow({ userId, pending }: { userId: string; pending?: boolean }) {
  const p = usePerson(userId);
  if (!p) return null;
  return (
    <div className="friend">
      <button type="button" className="plain friend-who" onClick={(e) => openCard(userId, e)}>
        <Avatar person={p} size={40} border="var(--bg2)" />
        <span className="member-text">
          <span className="strong">
            {p.name} <span className="muted small normal">{p.username}</span>
          </span>
          <span className="muted small">{pending ? 'Входящая заявка в друзья' : p.activity || presenceLabel[p.presence]}</span>
        </span>
      </button>
      {pending ? (
        <>
          <IconButton icon="check" label="Принять" size={36} onClick={() => actions.acceptFriend(userId)} />
          <IconButton icon="close" label="Отклонить" size={36} danger onClick={() => actions.declineFriend(userId)} />
        </>
      ) : (
        <>
          <IconButton icon="chat" label={`Написать ${p.name}`} size={36} onClick={() => actions.openDm(userId)} />
          <IconButton icon="trash" label="Удалить из друзей" size={36} danger onClick={() => actions.removeFriend(userId)} />
        </>
      )}
    </div>
  );
}

function Friends() {
  const tab = useStore((s) => s.ui.friendsTab);
  const friends = useStore((s) => s.friends);
  const pending = useStore((s) => s.pending);
  const users = useStore((s) => s.users);
  const [q, setQ] = useState('');
  const [add, setAdd] = useState('');
  const [result, setResult] = useState('');

  const list = (tab === 'pending' ? pending : friends)
    .filter((id) => tab !== 'online' || users[id]?.presence !== 'offline')
    .filter((id) => !q || users[id]?.name.toLowerCase().includes(q.toLowerCase()));

  const tabs: [typeof tab, string][] = [
    ['online', 'В сети'],
    ['all', 'Все'],
    ['pending', 'Ожидают'],
  ];

  return (
    <div className="home-main">
      <main className="chat">
        <header className="chat-head">
          <BackButton />
          <Icon name="users" className="muted" />
          <span className="muted crumb">Личные /</span>
          <span className="strong">Друзья</span>
          {tabs.map(([k, l]) => (
            <button type="button" key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setUi({ friendsTab: k })}>
              {l}
              {k === 'pending' && pending.length > 0 && <span className="pill red">{pending.length}</span>}
            </button>
          ))}
          <button type="button" className={`tab accentbg ${tab === 'add' ? 'on' : ''}`} onClick={() => setUi({ friendsTab: 'add' })}>
            Добавить в друзья
          </button>
        </header>
        {tab === 'add' ? (
          <div className="pad-l">
            <h2 className="h2">Добавить в друзья</h2>
            <p className="muted">{ONLINE ? 'Введи логин друга — его видно в профиле под ником. Новые люди ни у кого не появляются сами: только по заявке' : 'Друзей можно добавлять в онлайн-режиме, когда войдёшь через почту'}</p>
            <form
              className="add-friend"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!add.trim()) return;
                setResult('Ищу…');
                setResult(await actions.addFriendByName(add));
              }}
            >
              <input className="input" aria-label="Логин друга" placeholder="Логин, например diadon" value={add} onChange={(e) => setAdd(e.target.value)} />
              <button type="submit" className="btn primary">
                Отправить заявку
              </button>
            </form>
            {result && <p className="muted">{result}</p>}
          </div>
        ) : (
          <div className="pad-l">
            <label className="search wide">
              <Icon name="search" size={18} />
              <input aria-label="Поиск друзей" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="cat">
              {tab === 'online' ? 'В СЕТИ' : tab === 'all' ? 'ВСЕ ДРУЗЬЯ' : 'ОЖИДАЮТ'} — {list.length}
            </div>
            {list.length === 0 && <p className="muted pad">{tab === 'pending' ? 'Новых заявок нет' : 'Здесь пока никого'}</p>}
            {list.map((id) => (
              <FriendRow key={id} userId={id} pending={tab === 'pending'} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export function HomeView() {
  const tab = useStore((s) => s.ui.homeTab);
  const group = useStore((s) => (tab.startsWith('g:') ? s.groups.find((g) => `g:${g.id}` === tab) : undefined));
  const dmUser = usePerson(tab === 'friends' || tab.startsWith('g:') ? 'me' : tab);
  const encrypted = useEncrypted(tab);

  if (group) return <GroupView key={group.id} group={group} />;
  return tab === 'friends' || tab.startsWith('g:') || !dmUser ? (
    <Friends />
  ) : (
    <ChatView
      chatId={`dm:${tab}`}
      title={dmUser.name}
      icon="avatar"
      avatarUserId={tab}
      placeholder="Сообщение"
      onCall={(video) => void actions.startCall(tab, video)}
      encrypted={encrypted}
      extraTools={<StreakBadge userId={tab} />}

      intro={
        <>
          <StoryAvatar person={dmUser} size={80} showPresence={false} />
          <h2>{dmUser.name}</h2>
          <p className="muted">Это начало вашей переписки с {dmUser.name}.</p>
        </>
      }
    />
  );
}
