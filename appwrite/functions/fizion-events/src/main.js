// Точка входа fizion-events. Два дела в одной функции (на бесплатном Appwrite — максимум 2 функции):
//  1) Appwrite вызывает её сам на новые сообщения и звонки: push, мут, медленный режим, исходящие боты;
//  2) по её публичному адресу внешние сервисы шлют входящие вебхуки (сообщения ботов в комнату).
import { Client, ID, Permission, Query, Role, TablesDB, Teams } from 'node-appwrite';
import webpush from 'web-push';
import { createHmac } from 'node:crypto';
import { handle } from './events.js';
import { receive } from './hooks.js';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key'] ?? '');

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  const push =
    VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY
      ? {
          send(subscription, payload) {
            return webpush.sendNotification(subscription, JSON.stringify(payload), {
              TTL: payload.urgent ? 60 : 3600,
              urgency: payload.urgent ? 'high' : 'normal',
              vapidDetails: { subject: VAPID_SUBJECT || 'https://appwrite.io', publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
            });
          },
        }
      : null;

  const db = new TablesDB(client);
  const event = req.headers['x-appwrite-event'] ?? '';
  try {
    if (req.headers['x-appwrite-trigger'] !== 'event' || !event) {
      // входящий вебхук: проверяется по секрету вебхука
      const out = await receive(
        { db, Query, ID, Permission, Role },
        { method: req.method, query: req.query ?? {}, headers: req.headers ?? {}, body: typeof req.bodyText === 'string' ? req.bodyText : typeof req.body === 'string' ? req.body : (req.body ?? '') },
      );
      return res.json(out.body, out.status);
    }
    // событие: строку берём из базы, а не из запроса — подделанное событие ничего не изменит
    const m = /\.tables\.(messages|calls)\.rows\.([^.]+)\.create$/.exec(event);
    if (!m) return res.json({ skipped: event });
    const row = await db.getRow({ databaseId: 'fizion', tableId: m[1], rowId: m[2] }).catch(() => null);
    if (!row || Date.now() - Date.parse(row.$createdAt) > 120_000) return res.json({ skipped: 'stale' });
    const result = await handle({ db, teams: new Teams(client), Query, push, log, fetch, hmac: (key, body) => createHmac('sha256', key).update(body).digest('hex') }, event, row);
    return res.json(result);
  } catch (e) {
    error(String(e?.stack ?? e));
    return res.json({ error: 'failed' }, 500);
  }
};
