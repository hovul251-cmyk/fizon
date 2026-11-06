// Настройка Appwrite для Fizion одной командой: npm run setup
// Создаёт базу, таблицы (сообщения, истории, лента), индексы, хранилище файлов, загружает серверную функцию
// и записывает .env для приложения. Можно запускать повторно — существующее не трогает.
//
// Нужен файл .env.setup (пример — .env.setup.example) с ключом API из консоли Appwrite.

import { execFileSync } from 'node:child_process';
import { createECDH } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client, Functions, ID, Permission, ProjectKeyScopes, Proxy, Query, Role, Runtime, Storage, TablesDB, TablesDBIndexType, Users } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { CLOCK, cleanSecret, normalizeUrl, verifyLivekit } from './check-livekit.mjs';

const env = (k, required = true) => {
  const v = process.env[k]?.trim();
  if (!v && required) {
    console.error(`\n✖ Не задано ${k} в .env.setup — см. README, раздел «Настройка онлайн-режима».\n`);
    process.exit(1);
  }
  return v;
};

const ENDPOINT = env('APPWRITE_ENDPOINT');
const PROJECT = env('APPWRITE_PROJECT_ID');
const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT).setKey(env('APPWRITE_API_KEY'));
const db = new TablesDB(client);
const storage = new Storage(client);
const functions = new Functions(client);
const proxy = new Proxy(client);
const DB = 'fizion';

const step = (t) => console.log(`\n▸ ${t}`);
const ok = (t) => console.log(`  ✓ ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = async (fn) => {
  try {
    await fn();
    return true;
  } catch (e) {
    if (e?.code === 404) return false;
    throw e;
  }
};

// type: v — короткая строка (varchar), t — длинный текст, i — число, b — да/нет, d — дата
/** @typedef {{ key: string, type: string, size?: number, required: boolean, xdefault?: any }} Col */
/** @typedef {{ id: string, name: string, perms?: string[], columns: Col[], indexes: [string, string, string[]][] }} Tbl */
/** @returns {Col} */
const S = (key, size, required = false) => ({ key, type: 'v', size, required });
const T = (key) => ({ key, type: 't', required: false, xdefault: '' });
const I = (key) => ({ key, type: 'i', required: false, xdefault: 0 });
const B = (key) => ({ key, type: 'b', required: false, xdefault: false });
const D = (key) => ({ key, type: 'd', required: true });

const users = [Permission.create(Role.users())];
/** @type {Tbl[]} */
const tables = [
  // num — публичный ID человека, как в Telegram (выдаёт сервер)
  { id: 'profiles', name: 'Профили', columns: [S('username', 32, true), S('displayName', 32, true), S('avatarUrl', 1024), S('bannerUrl', 1024), T('data'), S('num', 12)], indexes: [['username_u', 'unique', ['username']], ['num', 'key', ['num']]] },
  { id: 'communities', name: 'Сообщества', columns: [S('teamId', 36, true), S('name', 40, true), S('color', 16), S('ownerId', 36, true)], indexes: [] },
  { id: 'rooms', name: 'Комнаты', columns: [S('teamId', 36, true), S('name', 40, true), S('kind', 8, true), S('category', 40), S('topic', 200), I('position'), I('slowmode'), B('stage'), T('speakers')], indexes: [['team', 'key', ['teamId']]] },
  { id: 'roles', name: 'Роли', columns: [S('teamId', 36, true), S('key', 16), S('name', 30, true), S('color', 16), T('perms'), I('position')], indexes: [['team', 'key', ['teamId']]] },
  { id: 'memberRoles', name: 'Роли участников', columns: [S('teamId', 36, true), S('userId', 36, true), S('roleId', 36, true)], indexes: [['team', 'key', ['teamId']], ['team_user_u', 'unique', ['teamId', 'userId']]] },
  { id: 'invites', name: 'Приглашения', columns: [S('teamId', 36, true), S('createdBy', 36, true), D('expiresAt'), I('uses')], indexes: [['team', 'key', ['teamId']]] },
  // lastA/lastB/streak/streakDay — огоньки дружбы (сколько дней подряд переписываетесь)
  { id: 'dms', name: 'Личные переписки', columns: [S('userA', 36, true), S('userB', 36, true), S('lastA', 10), S('lastB', 10), I('streak'), S('streakDay', 10)], indexes: [['pair_u', 'unique', ['userA', 'userB']]] },
  {
    id: 'messages',
    name: 'Сообщения',
    perms: users,
    columns: [S('chatId', 36, true), S('teamId', 36, true), S('authorId', 36, true), T('text'), S('replyTo', 36), T('attachment'), B('edited'), S('botName', 40)],
    indexes: [['chat_time', 'key', ['chatId', '$createdAt']], ['team', 'key', ['teamId']], ['author', 'key', ['authorId']], ['text_ft', 'fulltext', ['text']]],
  },
  {
    id: 'reactions',
    name: 'Реакции',
    perms: users,
    columns: [S('messageId', 36, true), S('chatId', 36, true), S('teamId', 36, true), S('userId', 36, true), S('emoji', 16, true)],
    indexes: [['message', 'key', ['messageId']], ['chat', 'key', ['chatId']], ['team', 'key', ['teamId']], ['once_u', 'unique', ['messageId', 'userId', 'emoji']]],
  },
  {
    id: 'stories',
    name: 'Истории',
    perms: users,
    columns: [S('authorId', 36, true), S('fileId', 36, true), S('url', 1024, true), S('kind', 8, true), S('caption', 200), D('expiresAt'), S('audience', 8)],
    indexes: [['author', 'key', ['authorId']], ['expires', 'key', ['expiresAt']]],
  },
  {
    id: 'reels',
    name: 'Лента',
    perms: users,
    columns: [S('authorId', 36, true), S('fileId', 36, true), S('url', 1024, true), S('caption', 500)],
    indexes: [['author', 'key', ['authorId']], ['time', 'key', ['$createdAt']]],
  },
  {
    id: 'reelLikes',
    name: 'Лайки ленты',
    perms: users,
    columns: [S('reelId', 36, true), S('userId', 36, true)],
    indexes: [['reel', 'key', ['reelId']], ['once_u', 'unique', ['reelId', 'userId']]],
  },
  {
    id: 'calls',
    name: 'Звонки',
    perms: users,
    columns: [S('dmId', 36, true), S('fromId', 36, true), S('toId', 36, true), S('status', 10, true), B('video')],
    indexes: [['dm', 'key', ['dmId']], ['to', 'key', ['toId']]],
  },
  // kind: '' — группа, 'saved' — Избранное, 'channel' — канал (handle — ссылка @канала)
  {
    id: 'groups',
    name: 'Группы и каналы',
    columns: [S('name', 40, true), S('color', 16), S('ownerId', 36, true), S('kind', 16), S('handle', 32), S('about', 200), B('isPublic'), I('subs')],
    indexes: [['owner', 'key', ['ownerId']], ['handle', 'key', ['handle']]],
  },
  { id: 'bans', name: 'Баны', columns: [S('teamId', 36, true), S('userId', 36, true), S('by', 36), S('reason', 200)], indexes: [['team', 'key', ['teamId']], ['team_user_u', 'unique', ['teamId', 'userId']]] },
  { id: 'mutes', name: 'Муты', columns: [S('teamId', 36, true), S('userId', 36, true), S('by', 36), D('until')], indexes: [['team', 'key', ['teamId']], ['team_user_u', 'unique', ['teamId', 'userId']]] },
  {
    id: 'reports',
    name: 'Жалобы',
    columns: [S('teamId', 36, true), S('messageId', 36, true), S('chatId', 36), S('reporterId', 36, true), S('authorId', 36, true), S('reason', 200), S('text', 500), S('status', 10, true)],
    indexes: [['team', 'key', ['teamId']], ['message', 'key', ['messageId']]],
  },
  { id: 'reelComments', name: 'Комментарии ленты', perms: users, columns: [S('reelId', 36, true), S('authorId', 36, true), S('text', 500, true)], indexes: [['reel', 'key', ['reelId']]] },
  { id: 'keys', name: 'Ключи шифрования', columns: [S('publicKey', 200, true), S('encPrivate', 400, true), S('salt', 64), S('iv', 64)], indexes: [] },
  // устройства и перенос ключа между ними: строки создаёт сам человек и видит только он
  { id: 'devices', name: 'Устройства (шифрование)', perms: users, columns: [S('userId', 36, true), S('publicKey', 200, true), S('name', 80), B('ready'), I('seen')], indexes: [['user', 'key', ['userId']]] },
  { id: 'keyshares', name: 'Перенос ключа на устройство', perms: users, columns: [S('deviceId', 36, true), S('userId', 36, true), S('epk', 200, true), S('iv', 40, true), S('ct', 600, true)], indexes: [['user', 'key', ['userId']]] },
  // ключ группы, упакованный для каждого участника (читают участники группы)
  {
    id: 'groupkeys',
    name: 'Ключи групп',
    perms: users,
    columns: [S('groupId', 36, true), S('keyId', 36, true), S('userId', 36, true), S('by', 36, true), S('iv', 40, true), S('ct', 200, true)],
    indexes: [['group', 'key', ['groupId']]],
  },
  // «Смотреть вместе»: одна строка на чат (id строки = id чата)
  {
    id: 'watch',
    name: 'Смотреть вместе',
    perms: users,
    columns: [S('teamId', 36, true), S('chatId', 36, true), T('data'), B('playing'), I('pos'), I('at'), S('by', 36)],
    indexes: [['team', 'key', ['teamId']]],
  },
  // вебхуки и боты сообщества: видят только модераторы, секрет хранится в виде хеша
  { id: 'webhooks', name: 'Вебхуки и боты', columns: [S('teamId', 36, true), S('roomId', 36, true), S('name', 40, true), S('tokenHash', 64, true), S('outUrl', 500), S('by', 36)], indexes: [['team', 'key', ['teamId']], ['room', 'key', ['roomId']]] },
  { id: 'blocks', name: 'Блокировки', columns: [S('by', 36, true), S('userId', 36, true)], indexes: [['by', 'key', ['by']], ['user', 'key', ['userId']]] },
  { id: 'pins', name: 'Закреплённые сообщения', columns: [S('chatId', 36, true), S('teamId', 36, true), S('messageId', 36, true), S('by', 36)], indexes: [['chat', 'key', ['chatId']], ['team', 'key', ['teamId']]] },
  // «прочитано»: до какого момента человек дочитал чат (id строки — хеш чата и человека)
  { id: 'reads', name: 'Прочитано', perms: users, columns: [S('chatId', 36, true), S('teamId', 36, true), S('userId', 36, true), I('ts')], indexes: [['chat', 'key', ['chatId']], ['user', 'key', ['userId']]] },
  // стикеры: наборы создают сами пользователи, видят все (добавить набор можно из любого чата)
  { id: 'stickerPacks', name: 'Наборы стикеров', perms: users, columns: [S('name', 64, true), S('authorId', 36, true), T('stickers')], indexes: [['author', 'key', ['authorId']]] },
  // голоса в опросах: одна строка на «сообщение + человек» (id — хеш), менять голос можно
  { id: 'votes', name: 'Голоса в опросах', perms: users, columns: [S('messageId', 36, true), S('teamId', 36, true), S('userId', 36, true), S('choice', 64, true)], indexes: [['msg', 'key', ['messageId']]] },
  { id: 'pushSubs', name: 'Push-подписки', perms: users, columns: [S('userId', 36, true), S('endpoint', 1024, true), S('p256dh', 200, true), S('auth', 64, true)], indexes: [['user', 'key', ['userId']]] },
  {
    id: 'catalog',
    name: 'Каталог плагинов',
    perms: users,
    columns: [S('name', 40, true), S('version', 16), S('description', 300), S('authorId', 36, true), S('kind', 8, true), S('permissions', 100), S('fileId', 36, true), S('url', 1024, true)],
    indexes: [['name', 'key', ['name']], ['author', 'key', ['authorId']]],
  },
  { id: 'catalogRatings', name: 'Оценки плагинов', perms: users, columns: [S('pluginId', 36, true), S('userId', 36, true), I('stars')], indexes: [['plugin', 'key', ['pluginId']], ['once_u', 'unique', ['pluginId', 'userId']]] },
  { id: 'catalogInstalls', name: 'Установки плагинов', perms: users, columns: [S('pluginId', 36, true), S('userId', 36, true)], indexes: [['plugin', 'key', ['pluginId']], ['once_u', 'unique', ['pluginId', 'userId']]] },
  // облачный пароль: только сервер (строки без прав — клиенту не видны)
  {
    id: 'secure',
    name: 'Облачные пароли',
    columns: [S('hash', 128), S('salt', 64), S('hint', 60), S('email', 200), I('failed'), I('lockUntil'), I('allowUntil'), S('ticket', 64), I('ticketUntil')],
    indexes: [],
  },
  // журнал для владельца: входы, баны, подарки, новые люди (видит только сервер → панель владельца)
  { id: 'logs', name: 'Журнал', columns: [S('kind', 24, true), S('actorId', 36), S('targetId', 36), S('text', 300)], indexes: [['kind', 'key', ['kind']], ['time', 'key', ['$createdAt']]] },
  // искры: баланс меняет только сервер, человек видит свой
  { id: 'wallets', name: 'Искры', columns: [I('balance'), I('spent')], indexes: [] },
  // подарки: видны всем (на профиле), анонимные — без отправителя
  {
    id: 'gifts',
    name: 'Подарки',
    columns: [S('fromId', 36), S('toId', 36, true), S('giftId', 16, true), S('text', 200), I('price'), I('serial'), S('look', 32), B('converted'), B('hidden')],
    indexes: [['to', 'key', ['toId']], ['gift', 'key', ['giftId']]],
  },
  { id: 'friendships', name: 'Друзья', columns: [S('fromId', 36, true), S('toId', 36, true), S('status', 10, true)], indexes: [['from', 'key', ['fromId']], ['to', 'key', ['toId']]] },
];

async function setupDatabase() {
  step('База данных');
  if (!(await exists(() => db.get({ databaseId: DB })))) await db.create({ databaseId: DB, name: 'Fizion' });
  ok('fizion');

  for (const t of tables) {
    step(`Таблица ${t.id} — ${t.name}`);
    if (!(await exists(() => db.getTable({ databaseId: DB, tableId: t.id }))))
      await db.createTable({ databaseId: DB, tableId: t.id, name: t.name, permissions: t.perms ?? [], rowSecurity: true });
    else await db.updateTable({ databaseId: DB, tableId: t.id, name: t.name, permissions: t.perms ?? [], rowSecurity: true });

    const have = new Set((await db.listColumns({ databaseId: DB, tableId: t.id })).columns.map((c) => c.key));
    for (const c of t.columns) {
      if (have.has(c.key)) continue;
      const base = { databaseId: DB, tableId: t.id, key: c.key, required: c.required };
      if (c.type === 'v') await db.createVarcharColumn({ ...base, size: c.size });
      if (c.type === 't') await db.createTextColumn({ ...base, xdefault: c.xdefault });
      if (c.type === 'i') await db.createIntegerColumn({ ...base, xdefault: c.xdefault });
      if (c.type === 'b') await db.createBooleanColumn({ ...base, xdefault: c.xdefault });
      if (c.type === 'd') await db.createDatetimeColumn(base);
    }
    // столбцы создаются в фоне — ждём, пока все станут доступны
    for (let i = 0; i < 60; i++) {
      const cols = (await db.listColumns({ databaseId: DB, tableId: t.id })).columns;
      if (cols.every((c) => c.status === 'available')) break;
      if (cols.some((c) => c.status === 'failed')) throw new Error(`Столбец не создался в ${t.id}`);
      await sleep(1000);
    }
    ok(`столбцы: ${t.columns.map((c) => c.key).join(', ')}`);

    const haveIdx = new Set((await db.listIndexes({ databaseId: DB, tableId: t.id })).indexes.map((x) => x.key));
    for (const [key, type, columns] of t.indexes) {
      if (haveIdx.has(key)) continue;
      try {
        const kind = type === 'unique' ? TablesDBIndexType.Unique : type === 'fulltext' ? TablesDBIndexType.Fulltext : TablesDBIndexType.Key;
        await db.createIndex({ databaseId: DB, tableId: t.id, key, type: kind, columns });
        ok(`индекс ${key}`);
      } catch (e) {
        console.warn(`  ! индекс ${key} не создан: ${e.message}`);
      }
    }
  }
}

async function setupStorage() {
  step('Хранилище файлов');
  const base = { bucketId: 'files', name: 'Файлы', permissions: users, fileSecurity: true };
  if (await exists(() => storage.getBucket({ bucketId: 'files' }))) return ok('files уже есть');
  for (const mb of [50, 30, 10]) {
    try {
      await storage.createBucket({ ...base, maximumFileSize: mb * 1024 * 1024 });
      return ok(`files, до ${mb} МБ на файл`);
    } catch (e) {
      if (mb === 10) throw e;
    }
  }
}

/** Ключи VAPID для push-уведомлений в браузер и на телефон (стандарт Web Push, P-256) */
function makeVapid() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const b64 = (buf) => buf.toString('base64url');
  return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey().length === 32 ? ecdh.getPrivateKey() : Buffer.concat([Buffer.alloc(32 - ecdh.getPrivateKey().length), ecdh.getPrivateKey()])) };
}

let vapidPublic = '';

async function setVariable(functionId, vars, key, value, secret) {
  const old = vars.find((v) => v.key === key);
  if (old) await functions.updateVariable({ functionId, variableId: old.$id, key, value, secret });
  else await functions.createVariable({ functionId, variableId: ID.unique(), key, value, secret });
}

async function deploy(functionId, dir) {
  const tmp = mkdtempSync(join(tmpdir(), 'fizion-'));
  const archive = join(tmp, 'code.tar.gz');
  // tar есть в Windows 10+, macOS и Linux. Архив пишем по короткому имени из его папки:
  // tar из Git Bash принимает «C:\…» за адрес сервера («Cannot connect to C: resolve failed»)
  execFileSync('tar', ['-czf', 'code.tar.gz', '--exclude=node_modules', '-C', resolve(dir), '.'], { stdio: 'inherit', cwd: tmp });
  await functions.createDeployment({ functionId, code: InputFile.fromPath(archive, 'code.tar.gz'), activate: true });
}

async function upsertFunction(fn) {
  if (await exists(() => functions.get({ functionId: fn.functionId }))) await functions.update(fn);
  else await functions.create(fn);
}

async function setupFunction() {
  step('Серверная функция fizion-api');
  const fn = {
    functionId: 'fizion-api',
    name: 'Fizion API',
    runtime: Runtime.Node22,
    // любой — потому что вход (проверка SMS и облачного пароля) идёт ещё без сессии; остальное функция сама требует входа
    execute: [Role.any()],
    entrypoint: 'src/main.js',
    commands: 'npm install',
    timeout: 30,
    scopes: [ProjectKeyScopes.UsersRead, ProjectKeyScopes.UsersWrite, ProjectKeyScopes.TeamsRead, ProjectKeyScopes.TeamsWrite, ProjectKeyScopes.RowsRead, ProjectKeyScopes.RowsWrite],
  };
  await upsertFunction(fn);
  ok('создана');

  const vars = (await functions.listVariables({ functionId: fn.functionId })).variables;
  const lk = { url: normalizeUrl(process.env.LIVEKIT_URL), key: cleanSecret(process.env.LIVEKIT_API_KEY), secret: cleanSecret(process.env.LIVEKIT_API_SECRET) };
  if (!lk.url || !lk.key || !lk.secret) {
    console.warn('  ! LiveKit не задан — голосовые комнаты и звонки не заработают, пока не добавишь LIVEKIT_* в .env.setup');
  } else {
    // ключи проверяются на самом LiveKit — иначе при звонке будет «invalid token»
    const problem = await verifyLivekit(lk);
    if (problem?.startsWith(CLOCK)) console.warn(`  ! ${problem.slice(CLOCK.length)}`);
    else if (problem) throw new Error(`Ключи LiveKit не подходят: ${problem}`);
    else ok(`ключи LiveKit подходят к ${lk.url}`);
    await setVariable(fn.functionId, vars, 'LIVEKIT_URL', lk.url, false);
    await setVariable(fn.functionId, vars, 'LIVEKIT_API_KEY', lk.key, true);
    await setVariable(fn.functionId, vars, 'LIVEKIT_API_SECRET', lk.secret, true);
  }
  ok('секреты LiveKit');
  await deploy(fn.functionId, 'appwrite/functions/fizion-api');
  ok('код загружен — сборка займёт около минуты');
}

async function setupEvents() {
  step('Функция fizion-events: push-уведомления и защита от нарушителей');
  const fn = {
    functionId: 'fizion-events',
    name: 'Fizion Events',
    runtime: Runtime.Node22,
    // публичный адрес нужен для входящих вебхуков (ботов); события проверяются внутри функции
    execute: [Role.any()],
    events: [`tablesdb.${DB}.tables.messages.rows.*.create`, `tablesdb.${DB}.tables.calls.rows.*.create`, 'users.*.sessions.*.create'],
    entrypoint: 'src/main.js',
    commands: 'npm install',
    timeout: 30,
    scopes: [ProjectKeyScopes.UsersRead, ProjectKeyScopes.UsersWrite, ProjectKeyScopes.TeamsRead, ProjectKeyScopes.RowsRead, ProjectKeyScopes.RowsWrite],
  };
  await upsertFunction(fn);
  const vars = (await functions.listVariables({ functionId: fn.functionId })).variables;
  // ключи VAPID создаются один раз: если их поменять, старые подписки на устройствах перестанут работать
  const known = vars.find((v) => v.key === 'VAPID_PUBLIC_KEY');
  if (known?.value) vapidPublic = known.value;
  else {
    const k = makeVapid();
    vapidPublic = k.publicKey;
    await setVariable(fn.functionId, vars, 'VAPID_PUBLIC_KEY', k.publicKey, false);
    await setVariable(fn.functionId, vars, 'VAPID_PRIVATE_KEY', k.privateKey, true);
  }
  await setVariable(fn.functionId, vars, 'VAPID_SUBJECT', new URL(ENDPOINT).origin, false);
  ok('ключи push');
  await deploy(fn.functionId, 'appwrite/functions/fizion-events');
  ok('код загружен');
}

let hooksUrl = '';

/** Публичный адрес для входящих вебхуков (GitHub, сервер игры, свои боты) — это адрес функции fizion-events */
async function findHooksUrl() {
  step('Адрес для ботов и вебхуков');
  try {
    const rules = await proxy.listRules({ queries: [Query.equal('deploymentResourceId', 'fizion-events'), Query.limit(10)] });
    const domain = rules.rules.map((r) => r.domain)[0];
    if (domain) {
      hooksUrl = `https://${domain}/`;
      ok(hooksUrl);
    } else console.warn('  ! адрес пока не появился — посмотри его в консоли: Functions → fizion-events → Domains, и впиши в .env как VITE_HOOKS_URL');
  } catch (e) {
    console.warn(`  ! не удалось узнать адрес (${e.message}). У ключа API должно быть право rules.read; или впиши адрес из Functions → fizion-events → Domains в .env как VITE_HOOKS_URL`);
  }
}

let webUrl = '';
/** Адрес веб-версии (для ссылок на каналы и приглашений) — появляется после первой выкладки сайта */
async function findWebUrl() {
  try {
    const rules = await proxy.listRules({ queries: [Query.equal('deploymentResourceId', 'fizion-web'), Query.limit(10)] });
    const domain = rules.rules.map((r) => r.domain)[0];
    if (domain) webUrl = `https://${domain}`;
  } catch {
    /* сайта ещё нет — ссылки будут вида fizion://… и откроются внутри приложения */
  }
}

function writeAppEnv() {
  step('Файл .env для приложения');
  const want = { VITE_APPWRITE_ENDPOINT: ENDPOINT, VITE_APPWRITE_PROJECT_ID: PROJECT, VITE_VAPID_PUBLIC_KEY: vapidPublic, VITE_HOOKS_URL: hooksUrl, VITE_WEB_URL: webUrl };
  let text = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  for (const [k, v] of Object.entries(want)) {
    if (!v) continue;
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${text.trimEnd()}${text.trim() ? '\n' : ''}${line}\n`;
  }
  writeFileSync('.env', text);
  ok('записан');
}

/** Владелец Fizion: OWNER_LOGIN из .env.setup получает метку owner — ему открывается панель владельца */
async function setupOwner() {
  step('Владелец Fizion (панель владельца)');
  const login = String(process.env.OWNER_LOGIN ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!login) return console.warn('  ! впиши в .env.setup строку OWNER_LOGIN=твой_логин и запусти npm run setup ещё раз — тогда появится панель владельца');
  const p = (await db.listRows({ databaseId: DB, tableId: 'profiles', queries: [Query.equal('username', login), Query.limit(1)] })).rows[0];
  if (!p) return console.warn(`  ! человек с логином ${login} не найден — сначала зарегистрируйся в Fizion с этим логином`);
  const u = new Users(client);
  const cur = (await u.get({ userId: p.$id })).labels ?? [];
  if (!cur.includes('owner')) await u.updateLabels({ userId: p.$id, labels: [...new Set([...cur, 'owner'])] });
  ok(`@${login} — владелец`);
}

try {
  await setupDatabase();
  await setupStorage();
  await setupFunction();
  await setupEvents();
  await findHooksUrl();
  await findWebUrl();
  await setupOwner().catch((e) => console.warn(`  ! не получилось назначить владельца: ${e.message}. У ключа API должны быть права users.read и users.write`));
  writeAppEnv();
  console.log('\n✔ Готово. Вход по номеру: в консоли Appwrite → Auth → Settings должен быть включён Phone. Затем: npm run app\n');
} catch (e) {
  console.error(`\n✖ ${e.message}\n`);
  if (e?.code === 401) console.error('Проверь APPWRITE_API_KEY и что у ключа есть все права из README.\n');
  process.exit(1);
}
