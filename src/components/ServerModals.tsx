import { inviteLink } from './Channels';
import { useEffect, useState } from 'react';
import { ONLINE } from '../lib/appwrite';
import { defaultPerms, makeServer, shortName, templates, uid } from '../data';
import { Icon, type IconName } from '../icons';
import { actions, setUi, useStore } from '../store';
import type { Permissions, Server } from '../types';
import * as remote from '../online/remote';
import { Avatar, colors, Modal, Toggle, usePerson } from './common';
import { BotsTab } from './Bots';

const tplIcons: Record<string, IconName> = { creator: 'play', gaming: 'gamepad', friends: 'users', study: 'cap', empty: 'plus' };

export function CreateServerModal() {
  const myName = useStore((s) => s.profile.displayName);
  const [name, setName] = useState(`Сообщество ${myName}`);
  const [tpl, setTpl] = useState('creator');
  const [color, setColor] = useState(colors[0]);
  const [joining, setJoining] = useState(false);
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [busy, setBusy] = useState(false);
  const close = () => setUi({ modal: null });

  if (joining)
    return (
      <Modal onClose={close} label="Вступить в сообщество" className="form-modal">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setJoinError((await actions.joinByCode(code)) ?? '');
            setBusy(false);
          }}
        >
          <div className="modal-top">
            <h1>Вступить в сообщество</h1>
            <p className="muted">Вставь код или ссылку-приглашение, которую тебе прислали</p>
          </div>
          <div className="modal-body">
            <label className="field">
              КОД ПРИГЛАШЕНИЯ
              <input className="input" autoFocus placeholder="fizion.app/i/k7m2p9xa" value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
            {joinError && <p className="red small">{joinError}</p>}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost" onClick={() => setJoining(false)}>
              Назад
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Вступаю…' : 'Вступить'}
            </button>
          </div>
        </form>
      </Modal>
    );

  return (
    <Modal onClose={close} label="Создание сообщества" className="form-modal">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) actions.createServer(makeServer(name.trim(), color, tpl));
        }}
      >
        <div className="modal-top">
          <h1>Новое сообщество</h1>
          <p className="muted">Сервер — место для тебя и твоего сообщества. Название и цвет можно поменять позже.</p>
        </div>
        <div className="modal-body">
          <div className="row gap">
            <div className="srv-preview" style={{ background: color }}>
              {shortName(name)}
            </div>
            <label className="field grow">
              НАЗВАНИЕ СООБЩЕСТВА
              <input className="input" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
            </label>
          </div>
          <div className="swatches" role="radiogroup" aria-label="Цвет сообщества">
            {colors.map((c) => (
              <button type="button" role="radio" aria-checked={c === color} aria-label={c} key={c} className={`sw ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
          <div className="cat flat">ШАБЛОН</div>
          <div className="tpls">
            {Object.entries(templates).map(([k, t]) => (
              <button type="button" key={k} className={`tpl ${tpl === k ? 'on' : ''}`} onClick={() => setTpl(k)}>
                <span className="tpl-ic">
                  <Icon name={tplIcons[k]} />
                </span>
                {t.label}
                <span className="muted small normal ml-auto">{t.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn ghost mr-auto" onClick={() => setJoining(true)}>
            Есть приглашение?
          </button>
          <button type="button" className="btn ghost" onClick={close}>
            Отмена
          </button>
          <button type="submit" className="btn primary">
            Создать
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function InviteModal({ server }: { server: Server }) {
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const close = () => setUi({ modal: null });

  useEffect(() => {
    let alive = true;
    void actions.createInvite(server.id).then((c) => alive && setCode(c));
    return () => {
      alive = false;
    };
  }, [server.id]);

  const link = code ? inviteLink(code) : 'Создаю приглашение…';
  return (
    <Modal onClose={close} label="Приглашение" className="form-modal">
      <div className="modal-top left">
        <h1>Пригласить друзей на {server.name}</h1>
      </div>
      <div className="modal-body">
        <label className="field">
          ССЫЛКА-ПРИГЛАШЕНИЕ
          <span className="row gap">
            <input className="input grow" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              disabled={!code}
              className={`btn ${copied ? 'green' : 'primary'}`}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                } catch {
                  /* буфер обмена недоступен */
                }
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Icon name={copied ? 'check' : 'copy'} size={18} /> {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </span>
        </label>
        <p className="muted small">
          {ONLINE
            ? 'Действует 7 дней. Отправь ссылку в любой чат — друг нажмёт на неё и сразу вступит, копировать код не нужно.'
            : 'В офлайн-режиме приглашения не работают — это предпросмотр.'}
        </p>
        {code && <SendToFriends text={`Заходи в «${server.name}»: ${link}`} />}
      </div>
    </Modal>
  );
}

const permNames: [keyof Permissions, string, string][] = [
  ['manageChannels', 'Управлять комнатами', 'Создавать, менять и удалять комнаты'],
  ['manageMessages', 'Управлять сообщениями', 'Удалять и закреплять сообщения других участников'],
  ['kickBan', 'Выгонять и банить', 'Удалять участников из сообщества и запрещать вход'],
  ['timeout', 'Тайм-аут участников', 'Временно запрещать писать и говорить'],
  ['manageRoles', 'Управлять ролями', 'Создавать роли ниже своей и выдавать их'],
  ['admin', 'Администратор', 'Все права. Выдавай только тем, кому полностью доверяешь'],
];

export function ServerSettings({ server }: { server: Server }) {
  const [tab, setTab] = useState<'overview' | 'roles' | 'channels' | 'reports' | 'bans' | 'bots'>(server.openReports ? 'reports' : 'roles');
  const [roleId, setRoleId] = useState(server.roles[1]?.id ?? server.roles[0].id);
  const [newCh, setNewCh] = useState({ name: '', kind: 'text' as 'text' | 'voice' | 'stage', category: 'ОБЩЕНИЕ' });
  const role = server.roles.find((r) => r.id === roleId) ?? server.roles[0];
  const upd = (fn: (s: Server) => Server) => actions.updateServer(server.id, fn);
  const close = () => setUi({ modal: null });
  const count = (id: string) => server.members.filter((m) => m.roleId === id).length;

  return (
    <div className="fullscreen" role="dialog" aria-modal="true" aria-label="Настройки сообщества">
      <nav className="settings-nav">
        <div className="cat ellipsis">{server.name.toUpperCase()}</div>
        <button type="button" className={`nav-item ${tab === 'overview' ? 'on' : ''}`} onClick={() => setTab('overview')}>
          Обзор
        </button>
        <button type="button" className={`nav-item ${tab === 'roles' ? 'on' : ''}`} onClick={() => setTab('roles')}>
          Роли
        </button>
        <button type="button" className={`nav-item ${tab === 'channels' ? 'on' : ''}`} onClick={() => setTab('channels')}>
          Комнаты
        </button>
        <button type="button" className={`nav-item ${tab === 'bots' ? 'on' : ''}`} onClick={() => setTab('bots')}>
          Боты и вебхуки
        </button>
        <div className="cat">МОДЕРАЦИЯ</div>
        <button type="button" className={`nav-item ${tab === 'reports' ? 'on' : ''}`} onClick={() => setTab('reports')}>
          Жалобы
          {!!server.openReports && <span className="count ml-auto">{server.openReports}</span>}
        </button>
        <button type="button" className={`nav-item ${tab === 'bans' ? 'on' : ''}`} onClick={() => setTab('bans')}>
          Баны и муты
        </button>
        <div className="menu-sep" />
        <button
          type="button"
          className="nav-item danger"
          onClick={() => {
            if (confirm(`Удалить сообщество «${server.name}»? Это нельзя отменить.`)) actions.deleteServer(server.id);
          }}
        >
          Удалить сообщество
        </button>
      </nav>

      {tab === 'overview' && (
        <main className="settings-main">
          <div className="settings-head">
            <h1>Обзор сообщества</h1>
          </div>
          <div className="ed-col">
            <div className="row gap">
              <div className="srv-preview big" style={{ background: server.color }}>
                {server.short}
              </div>
              <label className="field grow">
                НАЗВАНИЕ СООБЩЕСТВА
                <input className="input" value={server.name} maxLength={40} onChange={(e) => upd((s) => ({ ...s, name: e.target.value, short: shortName(e.target.value) }))} />
              </label>
            </div>
            <div className="field">
              ЦВЕТ
              <div className="swatches">
                {colors.map((c) => (
                  <button type="button" key={c} aria-label={c} className={`sw ${c === server.color ? 'on' : ''}`} style={{ background: c }} onClick={() => upd((s) => ({ ...s, color: c }))} />
                ))}
              </div>
            </div>
          </div>
        </main>
      )}

      {tab === 'roles' && (
        <>
          <section className="roles-col">
            <div className="row between">
              <h1 className="h2">Роли</h1>
              <button
                type="button"
                className="btn small primary"
                onClick={() => {
                  const id = uid();
                  upd((s) => {
                    const at = s.roles.findIndex((r) => r.key === 'everyone');
                    const roles = [...s.roles];
                    roles.splice(at < 0 ? roles.length : at, 0, { id, name: 'Новая роль', color: '#60A5FA', perms: defaultPerms() });
                    return { ...s, roles };
                  });
                  setRoleId(id);
                }}
              >
                Создать
              </button>
            </div>
            {server.roles.map((r) => (
              <button type="button" key={r.id} className={`role ${r.id === roleId ? 'on' : ''}`} onClick={() => setRoleId(r.id)}>
                <span className="rd" style={{ background: r.color }} />
                <span className="ellipsis">{r.name}</span>
                <span className="muted small ml-auto">{count(r.id)}</span>
              </button>
            ))}
          </section>
          <main className="settings-main">
            <div className="settings-head">
              <h1>
                Роль — <span style={{ color: role.color }}>{role.name}</span>
              </h1>
            </div>
            <div className="ed-col">
              <div className="row gap">
                <label className="field grow">
                  НАЗВАНИЕ РОЛИ
                  <input className="input" value={role.name} disabled={!!role.key} maxLength={30} onChange={(e) => upd((s) => ({ ...s, roles: s.roles.map((r) => (r.id === role.id ? { ...r, name: e.target.value } : r)) }))} />
                </label>
              </div>
              <div className="swatches">
                {['#A78BFA', '#22D3EE', '#FBBF24', '#F472B6', '#34D399', '#60A5FA', '#F87171', '#9AA3B2'].map((c) => (
                  <button type="button" key={c} aria-label={c} className={`sw ${c === role.color ? 'on' : ''}`} style={{ background: c }} onClick={() => upd((s) => ({ ...s, roles: s.roles.map((r) => (r.id === role.id ? { ...r, color: c } : r)) }))} />
                ))}
              </div>
              <div className="cat flat">ПРАВА</div>
              {permNames.map(([k, t, d]) => (
                <div className="perm" key={k}>
                  <div>
                    <div className="strong">{t}</div>
                    <div className="muted small">{d}</div>
                  </div>
                  <Toggle
                    label={t}
                    checked={role.perms[k]}
                    onChange={(v) => role.key !== 'owner' && upd((s) => ({ ...s, roles: s.roles.map((r) => (r.id === role.id ? { ...r, perms: { ...r.perms, [k]: v } } : r)) }))}
                  />
                </div>
              ))}
              {!role.key && (
                <button
                  type="button"
                  className="btn danger-outline"
                  onClick={() => {
                    const everyone = server.roles.find((r) => r.key === 'everyone')?.id ?? '';
                    upd((s) => ({ ...s, roles: s.roles.filter((r) => r.id !== role.id), members: s.members.map((m) => (m.roleId === role.id ? { ...m, roleId: everyone } : m)) }));
                    setRoleId(everyone);
                  }}
                >
                  Удалить роль
                </button>
              )}
            </div>
          </main>
        </>
      )}

      {tab === 'channels' && (
        <main className="settings-main">
          <div className="settings-head">
            <h1>Комнаты</h1>
          </div>
          <div className="ed-col">
            <form
              className="row gap"
              onSubmit={(e) => {
                e.preventDefault();
                const n = newCh.name.trim();
                if (!n) return;
                upd((s) => ({ ...s, channels: [...s.channels, { id: uid(), name: newCh.kind === 'text' ? n.toLowerCase().replace(/\s+/g, '-') : n, kind: newCh.kind === 'text' ? 'text' : 'voice', ...(newCh.kind === 'stage' ? { stage: true } : {}), category: newCh.kind === 'stage' ? 'ЭФИРЫ' : newCh.kind === 'voice' ? 'ГОЛОСОВЫЕ' : newCh.category.toUpperCase() || 'ОБЩЕНИЕ' }] }));
                setNewCh({ ...newCh, name: '' });
              }}
            >
              <input className="input grow" aria-label="Название комнаты" placeholder="Название новой комнаты" value={newCh.name} onChange={(e) => setNewCh({ ...newCh, name: e.target.value })} />
              <select className="select" aria-label="Тип комнаты" value={newCh.kind} onChange={(e) => setNewCh({ ...newCh, kind: e.target.value as 'text' | 'voice' | 'stage' })}>
                <option value="text">Текстовый</option>
                <option value="voice">Голосовой</option>
                <option value="stage">Сцена (эфир)</option>
              </select>
              <button type="submit" className="btn primary">
                Добавить
              </button>
            </form>
            {server.channels.map((c) => (
              <div className="list-row" key={c.id}>
                <Icon name={c.kind === 'text' ? 'hash' : c.stage ? 'stage' : 'speaker'} size={18} />
                <b className="ellipsis">{c.name}</b>
                <span className="muted small">{c.category}</span>
                {c.kind === 'text' && (
                  <select
                    className="select small-select"
                    aria-label={`Медленный режим в ${c.name}`}
                    title="Медленный режим: не чаще одного сообщения в…"
                    value={c.slowmode ?? 0}
                    onChange={(e) => upd((s) => ({ ...s, channels: s.channels.map((x) => (x.id === c.id ? { ...x, slowmode: Number(e.target.value) || undefined } : x)) }))}
                  >
                    {SLOW.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="plain red" aria-label={`Удалить ${c.name}`} onClick={() => upd((s) => ({ ...s, channels: s.channels.filter((x) => x.id !== c.id) }))}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
          </div>
        </main>
      )}

      {tab === 'reports' && <ReportsTab server={server} />}
      {tab === 'bans' && <BansTab server={server} />}
      {tab === 'bots' && <BotsTab server={server} />}

      <button type="button" className="close-round" aria-label="Закрыть настройки" onClick={close}>
        <Icon name="close" />
        <span>ESC</span>
      </button>
    </div>
  );
}

const SLOW: [number, string][] = [
  [0, 'Без ограничений'],
  [5, 'Раз в 5 с'],
  [10, 'Раз в 10 с'],
  [30, 'Раз в 30 с'],
  [60, 'Раз в минуту'],
  [300, 'Раз в 5 минут'],
  [900, 'Раз в 15 минут'],
  [3600, 'Раз в час'],
];

function PersonLine({ userId }: { userId: string }) {
  const p = usePerson(userId);
  return (
    <span className="row gap-s">
      {p && <Avatar person={p} size={24} showPresence={false} />}
      <b style={p?.nameStyle}>{p?.name ?? 'Участник'}</b>
    </span>
  );
}

function ReportsTab({ server }: { server: Server }) {
  const [list, setList] = useState<remote.ReportView[] | null>(null);
  const [busy, setBusy] = useState('');
  const load = () => {
    if (!ONLINE) return setList([]);
    remote.listReports(server.id).then(setList).catch(() => setList([]));
  };
  useEffect(load, [server.id, server.openReports]);
  const room = (id: string) => server.channels.find((c) => c.id === id)?.name ?? 'комната';
  const act = async (r: remote.ReportView, action: 'dismiss' | 'delete' | 'mute' | 'ban') => {
    setBusy(r.id);
    try {
      await remote.resolveReport(r.id, action, 60);
      setList((l) => (l ?? []).filter((x) => x.messageId !== r.messageId));
      setUi({ toast: { text: { dismiss: 'Жалоба отклонена', delete: 'Сообщение удалено', mute: 'Удалено, автор не может писать час', ban: 'Удалено, автор заблокирован' }[action], id: Date.now() } });
    } catch (e) {
      setUi({ toast: { text: (e as Error).message, id: Date.now() } });
    }
    setBusy('');
  };
  return (
    <main className="settings-main">
      <div className="settings-head">
        <h1>Жалобы</h1>
        <p className="muted">Жалобы участников на сообщения. Видят их только владелец, администраторы и модераторы.</p>
      </div>
      <div className="ed-col">
        {list === null && <p className="muted">Загружаю…</p>}
        {list?.length === 0 && <p className="muted">{ONLINE ? 'Открытых жалоб нет 👌' : 'Жалобы работают в онлайн-режиме.'}</p>}
        {list?.map((r) => (
          <div key={r.id} className="report-card">
            <div className="row between">
              <PersonLine userId={r.authorId} />
              <span className="muted small">
                в «{room(r.chatId)}» · {new Date(r.ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <blockquote>{r.text || 'Вложение'}</blockquote>
            <div className="muted small">
              Причина: <b className="text">{r.reason}</b> · пожаловался <PersonLine userId={r.reporterId} />
            </div>
            <div className="row gap-s wrap">
              <button type="button" className="btn small ghost" disabled={busy === r.id} onClick={() => void act(r, 'dismiss')}>
                Отклонить
              </button>
              <button type="button" className="btn small" disabled={busy === r.id} onClick={() => void act(r, 'delete')}>
                Удалить сообщение
              </button>
              <button type="button" className="btn small" disabled={busy === r.id} onClick={() => void act(r, 'mute')}>
                Удалить и мут на час
              </button>
              <button type="button" className="btn small danger-outline" disabled={busy === r.id} onClick={() => void act(r, 'ban')}>
                Удалить и забанить
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function BansTab({ server }: { server: Server }) {
  const [bans, setBans] = useState<{ userId: string; localId: string; reason: string }[] | null>(null);
  useEffect(() => {
    if (!ONLINE) return setBans([]);
    remote.listBans(server.id).then(setBans).catch(() => setBans([]));
  }, [server.id]);
  const mutes = Object.entries(server.mutes ?? {}).filter(([, until]) => until > Date.now());
  return (
    <main className="settings-main">
      <div className="settings-head">
        <h1>Баны и муты</h1>
        <p className="muted">Мут — человек остаётся в сообществе, но не может писать. Бан — удаляет из сообщества и не пускает обратно по приглашению.</p>
      </div>
      <div className="ed-col">
        <div className="cat flat">В МУТЕ</div>
        {!mutes.length && <p className="muted">Никого</p>}
        {mutes.map(([uid, until]) => (
          <div className="list-row" key={uid}>
            <PersonLine userId={uid} />
            <span className="muted small ml-auto">до {new Date(until).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            <button type="button" className="btn small" onClick={async () => setUi({ toast: { text: await actions.moderate('unmute', server.id, uid), id: Date.now() } })}>
              Снять мут
            </button>
          </div>
        ))}
        <div className="cat flat">ЗАБАНЕНЫ</div>
        {bans === null && <p className="muted">Загружаю…</p>}
        {bans?.length === 0 && <p className="muted">Никого</p>}
        {bans?.map((b) => (
          <div className="list-row" key={b.userId}>
            <PersonLine userId={b.localId} />
            <span className="muted small ml-auto ellipsis">{b.reason}</span>
            <button
              type="button"
              className="btn small"
              onClick={async () => {
                await remote.unban(server.id, b.userId).catch(() => undefined);
                setBans((l) => (l ?? []).filter((x) => x.userId !== b.userId));
              }}
            >
              Разбанить
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}

/** Отправить ссылку друзьям в личку одной кнопкой */
function SendToFriends({ text }: { text: string }) {
  const friends = useStore((s) => s.friends);
  const [sent, setSent] = useState<string[]>([]);
  if (!friends.length) return null;
  return (
    <div className="send-friends">
      <div className="cat flat">ОТПРАВИТЬ ДРУЗЬЯМ</div>
      {friends.slice(0, 30).map((id) => (
        <FriendSendRow key={id} id={id} sent={sent.includes(id)} onSend={() => {
          actions.send(`dm:${id}`, text);
          setSent((l) => [...l, id]);
        }} />
      ))}
    </div>
  );
}
function FriendSendRow({ id, sent, onSend }: { id: string; sent: boolean; onSend: () => void }) {
  const p = usePerson(id);
  if (!p) return null;
  return (
    <div className="pick-row">
      <Avatar person={p} size={28} showPresence={false} />
      <span className="grow ellipsis">{p.name}</span>
      <button type="button" className={`btn small ${sent ? 'green' : 'primary'}`} disabled={sent} onClick={onSend}>
        {sent ? 'Отправлено' : 'Отправить'}
      </button>
    </div>
  );
}
