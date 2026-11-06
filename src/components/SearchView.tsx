import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import * as remote from '../online/remote';
import { actions, getState, setUi, useStore } from '../store';
import { Avatar, BackButton, formatDay, formatTime, usePerson } from './common';

// Поиск по всей истории сообщений на сервере — во всех чатах, где ты состоишь.
// Сервер сам отдаёт только то, что тебе можно читать. Зашифрованные личные сообщения не ищутся.

function where(chatKey: string) {
  const s = getState();
  if (chatKey.startsWith('dm:')) return { label: `Личные · ${s.users[chatKey.slice(3)]?.name ?? 'собеседник'}`, open: () => actions.openDm(chatKey.slice(3)) };
  if (chatKey.startsWith('g:')) return { label: `Группа · ${s.groups.find((g) => `g:${g.id}` === chatKey)?.name ?? ''}`, open: () => actions.openHome(chatKey) };
  const srv = s.servers.find((x) => x.channels.some((c) => c.id === chatKey));
  const ch = srv?.channels.find((c) => c.id === chatKey);
  return {
    label: srv && ch ? `${srv.name} · ${ch.name}` : 'Комната',
    open: () => {
      if (!srv) return;
      actions.openServer(srv.id);
      actions.openChannel(srv.id, chatKey);
    },
  };
}

function Hit({ hit, q }: { hit: remote.SearchHit; q: string }) {
  const p = usePerson(hit.msg.authorId);
  const w = where(hit.chatKey);
  const i = hit.msg.text.toLowerCase().indexOf(q.toLowerCase());
  const text = hit.msg.text;
  return (
    <button type="button" className="inbox-item search-hit" onClick={w.open}>
      {p && <Avatar person={p} size={36} showPresence={false} />}
      <span className="inbox-body">
        <span className="inbox-meta">
          <b style={p?.nameStyle}>{p?.name ?? 'Участник'}</b>
          <span className="muted small">
            {w.label} · {formatDay(hit.msg.ts)}, {formatTime(hit.msg.ts)}
          </span>
        </span>
        <span className="inbox-text">
          {i < 0 ? (
            text
          ) : (
            <>
              {text.slice(Math.max(0, i - 40), i)}
              <mark>{text.slice(i, i + q.length)}</mark>
              {text.slice(i + q.length, i + q.length + 120)}
            </>
          )}
        </span>
      </span>
    </button>
  );
}

export function SearchView() {
  const query = useStore((s) => s.ui.globalSearch);
  const [q, setQ] = useState(query);
  const [hits, setHits] = useState<remote.SearchHit[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => setQ(query), [query]);
  useEffect(() => {
    const term = q.trim();
    setError('');
    if (term.length < 2) return setHits(null);
    if (!ONLINE) return setError('Поиск по истории работает в онлайн-режиме');
    const t = window.setTimeout(() => {
      setHits(null);
      remote
        .searchMessages(term)
        .then(setHits)
        .catch((e) => setError((e as Error).message));
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <main className="chat">
      <header className="chat-head">
        <BackButton />
        <span className="head-icon">
          <Icon name="search" />
        </span>
        <label className="search big-search grow">
          <Icon name="search" size={16} />
          <input autoFocus aria-label="Поиск по всем сообщениям" placeholder="Найти в сообщениях всех чатов" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setUi({ globalSearch: '' })} />
        </label>
      </header>
      <div className="inbox">
        {error && <p className="form-error">{error}</p>}
        {!error && q.trim().length < 2 && <p className="muted">Введи хотя бы 2 буквы — поиск идёт по всей истории на сервере, во всех твоих чатах.</p>}
        {!error && q.trim().length >= 2 && hits === null && <p className="muted">Ищу…</p>}
        {hits?.length === 0 && <p className="muted">Ничего не нашлось</p>}
        {hits?.map((h) => (
          <Hit key={h.msg.id} hit={h} q={q.trim()} />
        ))}
        {!!hits?.length && <p className="muted small">Показаны последние {hits.length}. Зашифрованные личные сообщения в поиск не попадают.</p>}
      </div>
    </main>
  );
}
