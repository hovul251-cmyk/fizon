import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import * as remote from '../online/remote';
import type { Server } from '../types';

// Боты и вебхуки сообщества (как в Discord):
//  - входящий вебхук: внешний сервис шлёт POST на адрес — в комнате появляется сообщение от бота;
//  - исходящий: Neon сам отправляет сообщения комнаты на адрес твоего бота, а бот отвечает через входящий.

function Secret({ id, token, onClose }: { id: string; token: string; onClose: () => void }) {
  const url = remote.webhookUrl(id, token);
  const [copied, setCopied] = useState(false);
  return (
    <div className="hook-secret">
      <b>Адрес вебхука — скопируй сейчас, больше он не покажется</b>
      {url ? (
        <code className="hook-url">{url}</code>
      ) : (
        <span className="muted small">
          Адрес функции не настроен: выполни <code>npm run setup</code> — он впишет VITE_HOOKS_URL в .env. Пока вот данные: id <code>{id}</code>, токен <code>{token}</code>
        </span>
      )}
      <div className="row gap-s">
        <button
          type="button"
          className="btn small primary"
          onClick={() => {
            void navigator.clipboard?.writeText(url || `id=${id} token=${token}`);
            setCopied(true);
          }}
        >
          <Icon name="copy" size={15} /> {copied ? 'Скопировано' : 'Скопировать'}
        </button>
        <button type="button" className="btn small ghost" onClick={onClose}>
          Готово
        </button>
      </div>
      <details className="muted small">
        <summary>Как отправить сообщение</summary>
        <pre className="hook-example">{`curl -X POST "${url || 'АДРЕС'}" \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Сервер игры запущен 🎮", "username": "Сервер"}'`}</pre>
        Формат как у Discord: поле <code>content</code> (текст) и необязательное <code>username</code>. GitHub, GitLab и многие сервисы умеют слать в Discord — подставь этот адрес.
      </details>
    </div>
  );
}

export function BotsTab({ server }: { server: Server }) {
  const rooms = server.channels.filter((c) => c.kind === 'text');
  const [hooks, setHooks] = useState<remote.WebhookInfo[] | null>(null);
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [outUrl, setOutUrl] = useState('');
  const [secret, setSecret] = useState<{ id: string; token: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () =>
    void remote
      .listWebhooks(server.id)
      .then(setHooks)
      .catch((e) => {
        setHooks([]);
        setError((e as Error).message);
      });
  useEffect(() => {
    if (ONLINE) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  const create = async () => {
    setError('');
    setBusy(true);
    try {
      const r = await remote.createWebhook(server.id, roomId, name.trim() || 'Бот', outUrl.trim());
      setSecret(r);
      setName('');
      setOutUrl('');
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <main className="settings-main">
      <div className="settings-head">
        <h1>Боты и вебхуки</h1>
      </div>
      <div className="ed-col">
        <p className="muted">
          Подключи сервисы и своих ботов: уведомления о стримах и коммитах, статус игрового сервера, ответы на команды. Бот пишет в выбранную комнату, его сообщения
          подписаны значком «БОТ».
        </p>
        {!ONLINE && <p className="note">Боты работают в онлайн-режиме.</p>}
        {ONLINE && (
          <>
            {secret && <Secret {...secret} onClose={() => setSecret(null)} />}
            <form
              className="hook-form"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <div className="row gap-s">
                <input className="input grow" aria-label="Имя бота" placeholder="Имя бота, например «GitHub»" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
                <select className="select" aria-label="Комната бота" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      # {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="input"
                aria-label="Адрес твоего бота"
                placeholder="Необязательно: https://адрес-твоего-бота — Neon будет присылать ему сообщения комнаты"
                value={outUrl}
                onChange={(e) => setOutUrl(e.target.value)}
              />
              <button type="submit" className="btn primary" disabled={busy || !roomId}>
                <Icon name="webhook" size={16} /> {busy ? 'Создаю…' : 'Создать вебхук'}
              </button>
            </form>
            {error && <p className="form-error">{error}</p>}
            <div className="cat flat">ПОДКЛЮЧЁННЫЕ · {hooks?.length ?? 0}</div>
            {hooks === null && <p className="muted small">Загружаю…</p>}
            {hooks?.map((h) => (
              <div className="list-row big" key={h.id}>
                <Icon name="bot" size={20} />
                <div className="grow">
                  <div className="strong">{h.name}</div>
                  <div className="muted small ellipsis">
                    # {rooms.find((r) => r.id === h.roomId)?.name ?? 'комната удалена'}
                    {h.outUrl && ` · получает сообщения: ${h.outUrl}`}
                  </div>
                </div>
                <button type="button" className="btn small" title="Новый секрет: старый адрес перестанет работать" onClick={() => void remote.resetWebhook(h.id).then(setSecret).catch((e) => setError((e as Error).message))}>
                  Новый адрес
                </button>
                <button type="button" className="plain red" aria-label={`Удалить ${h.name}`} onClick={() => confirm(`Удалить вебхук «${h.name}»?`) && void remote.deleteWebhook(h.id).then(reload)}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            ))}
            <details className="muted small">
              <summary>Как сделать своего бота</summary>
              Укажи «Адрес твоего бота» — Neon будет отправлять туда каждое сообщение комнаты (POST JSON: room, author, content). Подпись запроса — заголовок
              X-Fizion-Signature: HMAC-SHA256 тела, ключ — SHA-256 от секрета вебхука. Ответить в комнату бот может через адрес вебхука. Бот видит только сообщения своей
              комнаты; личные и группы ботам недоступны.
            </details>
          </>
        )}
      </div>
    </main>
  );
}
