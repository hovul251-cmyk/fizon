// Входящие вебхуки Fizion: внешний сервис (GitHub, сервер игры, свой бот) шлёт POST на адрес
// вебхука — в комнате сообщества появляется сообщение от бота.
//
// Адрес: https://<домен функции>/?id=<id вебхука>&token=<секрет>
// Тело: JSON { "content": "текст", "username": "имя бота (необязательно)" } или просто текст.
// Совместимо с форматом Discord ({ content, username }), поэтому многие сервисы подключаются без доработок.

import { createHash, timingSafeEqual } from 'node:crypto';

export const DB = 'fizion';
const LIMIT_PER_MINUTE = 20;

export const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Текст сообщения из тела запроса в любом привычном формате */
export function textFrom(body) {
  if (typeof body === 'string') {
    const t = body.trim();
    if (t.startsWith('{')) {
      try {
        return textFrom(JSON.parse(t));
      } catch {
        return { text: t };
      }
    }
    return { text: t };
  }
  if (!body || typeof body !== 'object') return { text: '' };
  // Discord / Slack / свой формат
  const text = body.content ?? body.text ?? body.message ?? (Array.isArray(body.embeds) ? body.embeds.map((e) => [e.title, e.description].filter(Boolean).join('\n')).join('\n\n') : '');
  return { text: String(text ?? '').trim(), username: body.username ? String(body.username) : undefined };
}

/**
 * Обработать запрос. ctx: { db, Query, ID, Permission, Role }.
 * Возвращает { status, body }.
 */
export async function receive(ctx, { method, query, headers, body }) {
  const { db, Query, ID, Permission, Role } = ctx;
  if (method === 'GET') return { status: 200, body: { ok: true, hint: 'Отправь POST с JSON { "content": "текст" }' } };
  if (method !== 'POST') return { status: 405, body: { error: 'Только POST' } };
  const id = String(query.id ?? '');
  const token = String(query.token ?? headers['x-fizion-token'] ?? '');
  if (!id || !token) return { status: 401, body: { error: 'Нужны id и token' } };
  let hook;
  try {
    hook = await db.getRow({ databaseId: DB, tableId: 'webhooks', rowId: id });
  } catch {
    return { status: 404, body: { error: 'Вебхук не найден' } };
  }
  if (!same(hook.tokenHash, sha256(token))) return { status: 401, body: { error: 'Неверный токен' } };

  const { text, username } = textFrom(body);
  if (!text) return { status: 400, body: { error: 'Пустое сообщение: передай content' } };

  // не больше 20 сообщений в минуту от одного вебхука
  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await db.listRows({ databaseId: DB, tableId: 'messages', queries: [Query.equal('authorId', id), Query.greaterThan('$createdAt', since), Query.limit(LIMIT_PER_MINUTE + 1)] });
  if (recent.rows.length >= LIMIT_PER_MINUTE) return { status: 429, body: { error: 'Слишком часто: не больше 20 сообщений в минуту' } };

  const row = await db.createRow({
    databaseId: DB,
    tableId: 'messages',
    rowId: ID.unique(),
    data: {
      chatId: hook.roomId,
      teamId: hook.teamId,
      authorId: id,
      botName: (username || hook.name).slice(0, 40),
      text: text.slice(0, 2000),
      replyTo: null,
      attachment: '',
      edited: false,
    },
    // метка bot: по ней сервер отличает настоящего бота от подделки (обычному клиенту её не выдать)
    permissions: [Permission.read(Role.team(hook.teamId)), Permission.read(Role.label('bot'))],
  });
  return { status: 200, body: { ok: true, id: row.$id } };
}
