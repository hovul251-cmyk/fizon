import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import { IS_TAURI } from '../lib/platform';
import { call, errorText } from '../online/sync';
import { joinByCode } from '../online/remote';
import { ME } from '../data';
import { actions, setUi } from '../store';
import type { Group } from '../types';
import { ChatView } from './ChatView';
import { IconButton, Modal } from './common';
import { GroupBadge } from './Groups';

// Каналы как в Telegram: пишут владелец и админы, подписчики читают и ставят реакции.
// У открытого канала есть ссылка @имя — по ней можно перейти и подписаться в один клик.
// Здесь же ссылки-приглашения в сообщества: нажал — вступил, код копировать не нужно.

const WEB = (import.meta.env.VITE_WEB_URL as string | undefined)?.replace(/\/$/, '');
/** Адрес, который можно отправить кому угодно: веб-версия или ссылка fizion:// */
const base = () => WEB || (!IS_TAURI && typeof location !== 'undefined' ? location.origin : '');
export const channelLink = (handle: string) => (base() ? `${base()}/?c=${handle}` : `fizion://c/${handle}`);
export const inviteLink = (code: string) => (base() ? `${base()}/?invite=${code}` : `fizion://invite/${code}`);

/** Найти в тексте ссылку на канал или приглашение */
export const LINK_RE = /((?:https?:\/\/[^\s]+?[?&](?:invite|c)=[\w-]+)|(?:fizion:\/\/(?:invite|c)\/[\w-]+)|(?:https?:\/\/[^\s<]+))/g;
export function parseFizionLink(url: string): { kind: 'invite' | 'channel'; value: string } | null {
  const m = /(?:[?&]invite=|fizion:\/\/invite\/)([\w-]+)/.exec(url);
  if (m) return { kind: 'invite', value: m[1] };
  const c = /(?:[?&]c=|fizion:\/\/c\/)([\w-]+)/.exec(url);
  if (c) return { kind: 'channel', value: c[1] };
  return null;
}
/** Открыть ссылку Neon внутри приложения (true — это была наша ссылка) */
export function openFizionLink(url: string) {
  const l = parseFizionLink(url);
  if (!l) return false;
  setUi({ modal: l.kind === 'invite' ? { kind: 'joinInvite', code: l.value } : { kind: 'joinChannel', handle: l.value } });
  return true;
}

export function NewChannelModal() {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [about, setAbout] = useState('');
  const [isPublic, setPublic] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => !busy && setUi({ modal: null });
  return (
    <Modal onClose={close} width={460} label="Новый канал" className="composer-modal">
      <div className="modal-head">
        <h2>Новый канал</h2>
        <p className="muted small">Пишешь ты (и админы, которых назначишь), подписчики читают и ставят реакции. Подписчиков — сколько угодно.</p>
      </div>
      <input className="input" aria-label="Название канала" placeholder="Название, например «Новости DIADOn»" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <textarea className="input" aria-label="Описание" placeholder="Описание (необязательно)" maxLength={200} rows={2} value={about} onChange={(e) => setAbout(e.target.value)} />
      <div className="seg">
        <button type="button" className={isPublic ? 'on' : ''} onClick={() => setPublic(true)}>
          Открытый
        </button>
        <button type="button" className={!isPublic ? 'on' : ''} onClick={() => setPublic(false)}>
          Закрытый
        </button>
      </div>
      {isPublic ? (
        <label className="field">
          ССЫЛКА
          <div className="input-prefix">
            <span>@</span>
            <input className="input" aria-label="Ссылка на канал" placeholder="diadon_news" maxLength={32} value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
          </div>
          <span className="muted small">По ссылке любой найдёт канал и подпишется. Латиница, цифры и _, от 4 символов.</span>
        </label>
      ) : (
        <p className="muted small">Закрытый канал не найти поиском — подписчиков добавляешь сам.</p>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={close} disabled={busy}>
          Отмена
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !name.trim() || (isPublic && handle.length < 4) || !ONLINE}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const { teamId } = await call<{ teamId: string }>('channel-create', { name, handle, about, isPublic });
              setUi({ modal: null });
              await actions.openFetchedGroup(teamId);
            } catch (e) {
              setError(errorText(e));
            }
            setBusy(false);
          }}
        >
          {!ONLINE ? 'Каналы — в онлайн-режиме' : busy ? 'Создаю…' : 'Создать канал'}
        </button>
      </div>
    </Modal>
  );
}

export function JoinChannelModal({ handle }: { handle: string }) {
  const [info, setInfo] = useState<{ id: string; name: string; about: string; handle: string; subs: number; joined: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<NonNullable<typeof info>>('channel-find', { handle }).then(setInfo, (e) => setError(errorText(e)));
  }, [handle]);
  const close = () => setUi({ modal: null });
  return (
    <Modal onClose={close} width={400} label="Канал" className="composer-modal center-modal">
      {info ? (
        <>
          <span className="chan-avatar">
            <Icon name="megaphone" size={34} />
          </span>
          <h2>{info.name}</h2>
          <p className="muted small">
            @{info.handle} · {info.subs} подписчиков
          </p>
          {info.about && <p>{info.about}</p>}
        </>
      ) : (
        <p className="muted">{error || 'Ищу канал…'}</p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={close}>
          Закрыть
        </button>
        {info && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { teamId } = await call<{ teamId: string }>('channel-join', { groupId: info.id });
                close();
                await actions.openFetchedGroup(teamId);
              } catch (e) {
                setError(errorText(e));
                setBusy(false);
              }
            }}
          >
            {info.joined ? 'Открыть' : 'Подписаться'}
          </button>
        )}
      </div>
    </Modal>
  );
}

export function JoinInviteModal({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => setUi({ modal: null });
  return (
    <Modal onClose={close} width={400} label="Приглашение" className="composer-modal center-modal">
      <span className="chan-avatar">
        <Icon name="userPlus" size={32} />
      </span>
      <h2>Приглашение в сообщество</h2>
      <p className="muted small">Тебя позвали в сообщество Neon. Вступить?</p>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={close}>
          Не сейчас
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const err = await joinByCode(code);
            setBusy(false);
            if (err) setError(err);
            else close();
          }}
        >
          {busy ? 'Вступаю…' : 'Вступить'}
        </button>
      </div>
    </Modal>
  );
}

function ChannelSettings({ group, onClose }: { group: Group; onClose: () => void }) {
  const ch = group.channel!;
  const [name, setName] = useState(group.name);
  const [about, setAbout] = useState(ch.about);
  const [handle, setHandle] = useState(ch.handle);
  const [isPublic, setPublic] = useState(ch.isPublic);
  const [error, setError] = useState('');
  return (
    <Modal onClose={onClose} width={460} label="Настройки канала" className="composer-modal">
      <div className="modal-head">
        <h2>Настройки канала</h2>
      </div>
      <input className="input" aria-label="Название" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      <textarea className="input" aria-label="Описание" rows={2} value={about} maxLength={200} onChange={(e) => setAbout(e.target.value)} placeholder="Описание" />
      <div className="seg">
        <button type="button" className={isPublic ? 'on' : ''} onClick={() => setPublic(true)}>
          Открытый
        </button>
        <button type="button" className={!isPublic ? 'on' : ''} onClick={() => setPublic(false)}>
          Закрытый
        </button>
      </div>
      {isPublic && (
        <div className="input-prefix">
          <span>@</span>
          <input className="input" aria-label="Ссылка" value={handle} maxLength={32} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button
          type="button"
          className="btn danger-outline"
          onClick={async () => {
            if (!confirm('Удалить канал вместе со всеми постами? Отменить нельзя.')) return;
            try {
              await call('channel-delete', { groupId: group.id });
              onClose();
              await actions.leaveGroupLocal(group.id);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          Удалить канал
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            try {
              await call('channel-update', { groupId: group.id, name, about, handle, isPublic });
              onClose();
              await actions.openFetchedGroup(group.id);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          Сохранить
        </button>
      </div>
    </Modal>
  );
}

export function ChannelView({ group }: { group: Group }) {
  const ch = group.channel!;
  const owner = group.ownerId === ME;
  const admin = owner || ch.admins.includes(ME);
  const [settings, setSettings] = useState(false);
  const share = () => {
    const link = ch.isPublic && ch.handle ? channelLink(ch.handle) : '';
    if (!link) return setUi({ toast: { text: 'У закрытого канала нет ссылки', id: Date.now() } });
    void navigator.clipboard?.writeText(link);
    setUi({ toast: { text: 'Ссылка на канал скопирована — отправь её кому угодно', id: Date.now() } });
  };
  return (
    <div className="room channel-room">
      <ChatView
        chatId={`g:${group.id}`}
        title={group.name}
        icon="community"
        community={{ short: '📣', color: group.color }}
        crumb={`${ch.subs} подписчиков${ch.isPublic && ch.handle ? ` · @${ch.handle}` : ''}`}
        placeholder="Новый пост в канал"
        readOnly={
          admin ? undefined : (
            <>
              <Icon name="megaphone" size={16} /> Ты подписан на канал
              <button
                type="button"
                className="btn small ghost"
                onClick={async () => {
                  try {
                    await call('channel-leave', { groupId: group.id });
                    await actions.leaveGroupLocal(group.id);
                  } catch (e) {
                    setUi({ toast: { text: errorText(e), id: Date.now() } });
                  }
                }}
              >
                Отписаться
              </button>
            </>
          )
        }
        extraTools={
          <>
            <IconButton icon="link" label="Скопировать ссылку на канал" onClick={share} />
            {owner && <IconButton icon="settings" label="Настройки канала" onClick={() => setSettings(true)} />}
          </>
        }
        intro={
          <>
            <GroupBadge group={group} size={80} />
            <h2>{group.name}</h2>
            <p className="muted">{ch.about || (admin ? 'Это твой канал. Пиши посты — подписчики увидят их и получат уведомление.' : 'Канал')}</p>
          </>
        }
      />
      {settings && <ChannelSettings group={group} onClose={() => setSettings(false)} />}
    </div>
  );
}
