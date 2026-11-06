// Точка входа функции Appwrite. Тело запроса: { "action": "...", ...параметры }.
// Кто вызвал — Appwrite передаёт в заголовке x-appwrite-user-id, подделать его клиент не может.
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { Client, ID, Permission, Query, Role, TablesDB, Teams, Users } from 'node-appwrite';
import { createHash, randomBytes } from 'node:crypto';
import { run } from './actions.js';

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key'] ?? '');

  // лишние пробелы, кавычки и переносы строк при копировании ключей — частая причина «invalid token»
  const clean = (v) => (v ?? '').replace(/[\u200B-\u200D\uFEFF\r\n\t]/g, '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  const LIVEKIT_API_KEY = clean(process.env.LIVEKIT_API_KEY);
  const LIVEKIT_API_SECRET = clean(process.env.LIVEKIT_API_SECRET);
  let LIVEKIT_URL = clean(process.env.LIVEKIT_URL);
  if (LIVEKIT_URL && !/^wss?:\/\//.test(LIVEKIT_URL)) LIVEKIT_URL = `wss://${LIVEKIT_URL.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
  const livekit =
    LIVEKIT_URL && LIVEKIT_API_KEY && LIVEKIT_API_SECRET
      ? {
          url: LIVEKIT_URL,
          async token({ identity, name, room, canPublish = true }) {
            const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name, ttl: '6h' });
            at.addGrant({ room, roomJoin: true, canPublish, canSubscribe: true, canPublishData: true });
            return at.toJwt();
          },
          /** Сцена: дать или забрать слово у того, кто уже в эфире */
          async setPublish(room, identity, canPublish) {
            const svc = new RoomServiceClient(LIVEKIT_URL.replace(/^ws/, 'http'), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
            await svc.updateParticipant(room, identity, undefined, { canPublish, canSubscribe: true, canPublishData: true });
          },
        }
      : null;

  let body = {};
  try {
    body = req.bodyJson ?? JSON.parse(req.body || '{}');
  } catch {
    return res.json({ error: 'Неверный запрос', code: 'bad_json' }, 400);
  }
  const { action, ...payload } = body;

  const result = await run(
    {
      userId: req.headers['x-appwrite-user-id'] || null,
      db: new TablesDB(client),
      teams: new Teams(client),
      users: new Users(client),
      sdk: { ID, Query, Permission, Role },
      crypto: { sha256: (s) => createHash('sha256').update(s).digest('hex'), randomToken: () => randomBytes(24).toString('base64url') },
      livekit,
      log: error,
    },
    action,
    payload,
  );
  if (result.status >= 500) log(`action ${action} failed`);
  return res.json(result.body, result.status);
};
