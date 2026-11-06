// Онлайн-режим на Appwrite: загрузка данных, realtime и присутствие (кто в сети и в какой голосовой комнате).
// Данные приводятся к тем же типам, что и в офлайн-версии, поэтому экраны работают без изменений.
// Свой id внутри приложения всегда ME ('me'): L() и R() переводят его туда и обратно.
//
// Устройство на сервере: сообщество и личная переписка — это команды (Teams) Appwrite.
// Строки таблиц читаются по праву команды, поэтому человек видит только свои сообщества и переписки.

import { AppwriteException, ExecutionMethod, Permission, Query, Role, type Models, type RealtimeResponseEvent } from 'appwrite';
import { defaultPerms, defaultProfile, emptyState, ME, shortName } from '../data';
import { aw, BUCKET, DB, FUNCTION } from '../lib/appwrite';
import { getState, setState, setUi } from '../store';
import type { Channel, Comment, Group, Message, Presence, Profile, Reaction, Reel, Role as FzRole, Server, Story, User } from '../types';
import * as e2e from './crypto';
import * as keys from './keys';
import { onWatchRow, resetWatch } from './watch';
import * as social from './social';
import { onVoteRow, resetPolls } from './polls';
import { notifyMessage } from '../lib/notify';

/* ---------- строки таблиц ---------- */

type Row<T> = Models.Row & T;
export type ProfileRow = Row<{ username: string; displayName: string; avatarUrl: string | null; bannerUrl: string | null; data: string }>;
type CommunityRow = Row<{ teamId: string; name: string; color: string; ownerId: string }>;
type RoomRow = Row<{ teamId: string; name: string; kind: 'text' | 'voice'; category: string; topic: string; position: number; slowmode?: number; stage?: boolean; speakers?: string }>;
type RoleRow = Row<{ teamId: string; key: string; name: string; color: string; perms: string; position: number }>;
type MemberRoleRow = Row<{ teamId: string; userId: string; roleId: string }>;
export type MessageRow = Row<{ chatId: string; teamId: string; authorId: string; text: string; replyTo: string | null; attachment: string; edited: boolean; botName?: string | null }>;
export type ReactionRow = Row<{ messageId: string; chatId: string; teamId: string; userId: string; emoji: string }>;
type FriendRow = Row<{ fromId: string; toId: string; status: 'pending' | 'accepted' }>;
type DmRow = Row<{ userA: string; userB: string; streak?: number | null; streakDay?: string | null }>;
export type StoryRow = Row<{ authorId: string; fileId: string; url: string; kind: 'image' | 'video'; caption: string; expiresAt: string; audience?: string }>;
export type ReelRow = Row<{ authorId: string; fileId: string; url: string; caption: string }>;
type LikeRow = Row<{ reelId: string; userId: string }>;
type GroupRow = Row<{ name: string; color: string; ownerId: string; kind?: string | null }>;
type MuteRow = Row<{ teamId: string; userId: string; until: string }>;
type ReportCountRow = Row<{ teamId: string; status: string }>;
export type CommentRow = Row<{ reelId: string; authorId: string; text: string }>;
export type KeyRow = Row<{ publicKey: string; encPrivate: string; salt: string; iv: string }>;
export type CallRow = Row<{ dmId: string; fromId: string; toId: string; status: string; video: boolean }>;

/** Входящие события звонков обрабатывает хранилище (там же подключение к голосу) */
let callHandler: ((row: CallRow & { from: string }, kind: 'create' | 'update' | 'delete') => void) | null = null;
export const setCallHandler = (fn: typeof callHandler) => (callHandler = fn);

/* ---------- состояние слоя ---------- */

export let myId: string | null = null;
export let myEmail = '';
export let hasProfileRow = false;
export const L = (id: string) => (id === myId ? ME : id);
export const R = (id: string) => (id === ME ? myId! : id);

const dmByUser = new Map<string, string>(); // локальный id собеседника → id команды-переписки
const userByDm = new Map<string, string>(); // id команды-переписки → локальный id собеседника
const roomTeam = new Map<string, string>(); // id комнаты → id сообщества
const groupIds = new Set<string>(); // команды-группы
const loadedChats = new Set<string>();
const presenceOf = new Map<string, { status: Presence; voice: { s: string; c: string } | null }>();
/** Мои реакции: "сообщение|эмодзи" → id строки, чтобы снять реакцию */
export const myReactionRows = new Map<string, string>();
/** Мои лайки: id видео → id строки, чтобы снять лайк */
export const myLikeRows = new Map<string, string>();
let reelsEnd = false;
let reelsLoading = false;
let unsubscribe: (() => Promise<void>) | null = null;

const api = () => aw!;
const list = async <T>(tableId: string, queries: string[]) =>
  (await api().db.listRows<Row<T>>({ databaseId: DB, tableId, queries: [...queries, Query.limit(500)] })).rows;

export const toast = (text: string) => setUi({ toast: { text, id: Date.now() } });

export const errorText = (e: unknown): string => {
  const type = (e as AppwriteException)?.type ?? '';
  const m = (e as { message?: string })?.message ?? String(e);
  const byType: Record<string, string> = {
    user_invalid_credentials: 'Неверная почта или пароль',
    user_invalid_token: 'Код неверный или устарел. Запроси новый',
    user_already_exists: 'Такая почта уже зарегистрирована — войди',
    user_email_already_exists: 'Такая почта уже зарегистрирована — войди',
    user_password_mismatch: 'Пароли не совпадают',
    password_recently_used: 'Этот пароль уже был недавно — придумай новый',
    password_personal_data: 'Пароль не должен содержать имя или почту',
    general_rate_limit_exceeded: 'Слишком много попыток подряд. Подожди немного',
    user_blocked: 'Аккаунт заблокирован',
    user_not_found: 'Аккаунт с такой почтой не найден',
    user_unauthorized: 'Нужно войти заново',
    user_count_exceeded: 'Достигнут лимит пользователей проекта',
    general_argument_invalid: 'Проверь введённые данные',
    storage_file_too_large: 'Файл слишком большой',
    storage_invalid_file_size: 'Файл слишком большой',
    row_already_exists: 'Такая запись уже есть',
  };
  if (byType[type]) return byType[type];
  if (/Invalid `email`/i.test(m)) return 'Проверь адрес почты — кажется, в нём ошибка';
  if (/Invalid `password`/i.test(m)) return 'Пароль: от 8 символов';
  if (/username/i.test(m) && /unique|exists|duplicate/i.test(m)) return 'Это имя пользователя уже занято';
  if (/invalid token|signal connection.*(401|unauthor)|token is expired|NotAllowed.*token/i.test(m))
    return 'сервер голоса (LiveKit) не принял ключ. Владельцу: проверь ключи командой npm run check:voice, затем npm run setup';
  if (/could not establish (signal|pc) connection|websocket error|ECONN/i.test(m)) return 'не удалось подключиться к серверу голоса. Проверь интернет или VPN и попробуй ещё раз';
  if (/Голос не настроен/i.test(m)) return 'голос не настроен на сервере — владельцу: добавь ключи LiveKit в .env.setup и выполни npm run setup';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Нет связи с сервером. Проверь интернет';
  return m;
};

/** Вызвать серверную функцию Fizion. Ошибки сервера приходят как Error с понятным текстом. */
export async function call<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const ex = await api().functions.createExecution({
    functionId: FUNCTION,
    body: JSON.stringify({ ...payload, action }),
    async: false,
    method: ExecutionMethod.POST,
    headers: { 'content-type': 'application/json' },
  });
  let body: { error?: string } & Record<string, unknown> = {};
  try {
    body = JSON.parse(ex.responseBody || '{}');
  } catch {
    /* пустой ответ */
  }
  if (ex.responseStatusCode >= 400 || ex.status === 'failed') throw new Error(body.error || 'Сервер не ответил. Проверь, что функция fizion-api развёрнута');
  return body as T;
}

/* ---------- преобразование строк в данные приложения ---------- */

const parse = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const profileFromRow = (row: ProfileRow): Profile => ({
  ...defaultProfile(row.displayName),
  ...parse<Partial<Profile>>(row.data, {}),
  displayName: row.displayName,
  username: row.username,
  avatarImage: row.avatarUrl || null,
  bannerImage: row.bannerUrl || null,
});

const userFromRow = (row: ProfileRow): User => {
  const p = profileFromRow(row);
  return {
    id: row.$id,
    name: p.displayName,
    username: p.username,
    color: p.avatarColor,
    nameColor: p.nameColor,
    presence: presenceOf.get(row.$id)?.status ?? 'offline',
    activity: p.activity || undefined,
    about: p.about || undefined,
    profile: p,
  };
};

const roleFromRow = (r: RoleRow): FzRole => ({
  id: r.$id,
  key: r.key === 'owner' || r.key === 'everyone' ? r.key : undefined,
  name: r.name,
  color: r.color,
  perms: { ...defaultPerms(), ...parse(r.perms, {}) },
});

const roomFromRow = (c: RoomRow): Channel => ({
  id: c.$id,
  name: c.name,
  kind: c.kind,
  category: c.category || 'КОМНАТЫ',
  topic: c.topic || undefined,
  slowmode: c.slowmode || undefined,
  stage: c.kind === 'voice' && !!c.stage ? true : undefined,
  speakers: c.stage ? parse<string[]>(c.speakers, []).map(L) : undefined,
});

const reactionsFrom = (rows: ReactionRow[]): Reaction[] => {
  const map = new Map<string, string[]>();
  rows.forEach((r) => {
    map.set(r.emoji, [...(map.get(r.emoji) ?? []), L(r.userId)]);
    if (r.userId === myId) myReactionRows.set(`${r.messageId}|${r.emoji}`, r.$id);
  });
  return [...map.entries()].map(([emoji, users]) => ({ emoji, users }));
};

export const messageFromRow = (m: MessageRow, reactions: ReactionRow[] = []): Message => ({
  id: m.$id,
  authorId: L(m.authorId),
  text: m.text ?? '',
  ts: Date.parse(m.$createdAt),
  edited: !!m.edited,
  replyTo: m.replyTo || undefined,
  attachment: parse(m.attachment, undefined),
  reactions: reactionsFrom(reactions.filter((r) => r.messageId === m.$id)),
});

export const storyFromRow = (r: StoryRow): Story => ({
  id: r.$id,
  authorId: L(r.authorId),
  url: r.url,
  kind: r.kind === 'video' ? 'video' : 'image',
  caption: r.caption ?? '',
  ts: Date.parse(r.$createdAt),
  expiresAt: Date.parse(r.expiresAt),
  audience: r.audience === 'friends' ? 'friends' : 'all',
  fileId: r.fileId,
});

export const reelFromRow = (r: ReelRow, likes: LikeRow[]): Reel => ({
  id: r.$id,
  authorId: L(r.authorId),
  url: r.url,
  caption: r.caption ?? '',
  ts: Date.parse(r.$createdAt),
  fileId: r.fileId,
  likes: likes.filter((l) => l.reelId === r.$id).map((l) => {
    if (l.userId === myId) myLikeRows.set(r.$id, l.$id);
    return L(l.userId);
  }),
});

/** Ключ чата в приложении по id из базы: комнаты как есть, личные — dm:<собеседник>. */
const chatKey = (dbChatId: string) => (userByDm.has(dbChatId) ? `dm:${userByDm.get(dbChatId)}` : groupIds.has(dbChatId) ? `g:${dbChatId}` : dbChatId);
export const isGroupTeam = (id: string) => groupIds.has(id);
export const chatKeyOf = chatKey;

/** Команда, которой принадлежит чат: сообщество комнаты или команда переписки. */
export const teamOfChat = (chatId: string) => (chatId.startsWith('dm:') ? dmByUser.get(chatId.slice(3)) : chatId.startsWith('g:') ? chatId.slice(2) : roomTeam.get(chatId));
export const dbChatId = (chatId: string) => (chatId.startsWith('dm:') ? dmByUser.get(chatId.slice(3)) : chatId.startsWith('g:') ? chatId.slice(2) : chatId);

/* ---------- сквозное шифрование ---------- */

e2e.setKeySource(async (userId) => {
  const row = await api().db.getRow<KeyRow>({ databaseId: DB, tableId: 'keys', rowId: userId }).catch(() => null);
  return row?.publicKey ?? null;
});


const LOCKED_TEXT = '🔒 Зашифровано. Ключ переносится с другого твоего устройства — открой Fizion там, и сообщение появится';

/** Расшифровать сообщения личной переписки или группы (свои и чужие). Вложения тоже едут внутри шифра. */
export async function decryptAll(chatKey: string, msgs: Message[]): Promise<Message[]> {
  if (!msgs.some((m) => e2e.isSealed(m.text))) return msgs;
  const peer = chatKey.startsWith('dm:') ? R(chatKey.slice(3)) : null;
  const group = chatKey.startsWith('g:') ? chatKey.slice(2) : null;
  return Promise.all(
    msgs.map(async (m) => {
      if (!e2e.isSealed(m.text)) return m;
      const body = peer ? await e2e.decryptFrom(peer, m.text) : group ? await keys.openGroup(group, m.text) : null;
      if (!body) return { ...m, text: LOCKED_TEXT, encrypted: true, locked: true };
      return { ...m, text: body.text, attachment: (body.attachment as Message['attachment']) ?? m.attachment, encrypted: true };
    }),
  );
}

/** Расшифровать произвольный текст чата. null — не получилось. */
export async function openText(chatKey: string, text: string): Promise<string | null> {
  if (!e2e.isSealed(text)) return text;
  const [m] = await decryptAll(chatKey, [{ id: '', authorId: '', text, ts: 0, reactions: [] }]);
  return m.locked ? null : m.text;
}

/** Ключ только что появился на этом устройстве — перечитать чаты, где были нерасшифрованные сообщения */
function reopenLocked() {
  const locked = Object.entries(getState().messages)
    .filter(([, l]) => l.some((m) => m.locked))
    .map(([k]) => k);
  for (const k of locked) {
    loadedChats.delete(k);
    void loadChat(k, async () => undefined);
  }
}

/* ---------- загрузка ---------- */

async function memberships(teamId: string) {
  return (await api().teams.listMemberships({ teamId, queries: [Query.limit(500)] })).memberships;
}

export async function fetchServers(ids: string[]): Promise<Server[]> {
  if (!ids.length) return [];
  const [communities, rooms, roles, memberRoles, members, mutes, reports] = await Promise.all([
    list<CommunityRow>('communities', [Query.equal('$id', ids)]),
    list<RoomRow>('rooms', [Query.equal('teamId', ids), Query.orderAsc('position')]),
    list<RoleRow>('roles', [Query.equal('teamId', ids), Query.orderAsc('position')]),
    list<MemberRoleRow>('memberRoles', [Query.equal('teamId', ids)]),
    Promise.all(ids.map((id) => memberships(id).then((m) => [id, m] as const))),
    list<MuteRow>('mutes', [Query.equal('teamId', ids)]).catch(() => [] as MuteRow[]),
    // жалобы видят только модераторы — у остальных список просто пустой
    list<ReportCountRow>('reports', [Query.equal('teamId', ids), Query.equal('status', 'open')]).catch(() => [] as ReportCountRow[]),
  ]);
  const byTeam = new Map(members);
  const servers = communities.map((c) => {
    const rs = roles.filter((r) => r.teamId === c.$id).map(roleFromRow);
    const owner = rs.find((r) => r.key === 'owner')?.id ?? '';
    const everyone = rs.find((r) => r.key === 'everyone')?.id ?? '';
    const chans = rooms.filter((r) => r.teamId === c.$id);
    chans.forEach((r) => roomTeam.set(r.$id, c.$id));
    return {
      id: c.$id,
      name: c.name,
      short: shortName(c.name),
      color: c.color || '#8B5CF6',
      ownerId: L(c.ownerId),
      channels: chans.map(roomFromRow),
      roles: rs,
      members: (byTeam.get(c.$id) ?? []).map((m) => ({
        userId: L(m.userId),
        roleId: memberRoles.find((x) => x.teamId === c.$id && x.userId === m.userId)?.roleId ?? (m.roles.includes('owner') ? owner : everyone),
      })),
      voice: voiceOf(c.$id),
      mutes: Object.fromEntries(mutes.filter((m) => m.teamId === c.$id && Date.parse(m.until) > Date.now()).map((m) => [L(m.userId), Date.parse(m.until)])),
      openReports: reports.filter((r) => r.teamId === c.$id).length,
    } satisfies Server;
  });
  await ensureUsers(servers.flatMap((x) => x.members.map((m) => m.userId)));
  return servers;
}

/** Группы: строки groups + участники команд */
export async function fetchGroups(ids: string[]): Promise<Group[]> {
  if (!ids.length) return [];
  const rows = await list<GroupRow>('groups', [Query.equal('$id', ids)]);
  const groups = await Promise.all(
    rows.map(async (g) => {
      groupIds.add(g.$id);
      const m = await memberships(g.$id).catch(() => []);
      return { id: g.$id, name: g.name, color: g.color || '#5865F2', ownerId: L(g.ownerId), members: m.map((x) => L(x.userId)), saved: g.kind === 'saved' || undefined } satisfies Group;
    }),
  );
  await ensureUsers(groups.flatMap((g) => g.members));
  return groups;
}

/** Догрузить профили людей, которых ещё нет в памяти. */
/** Имена ботов (вебхуков) из сообщений: у ботов нет профиля */
const botNames = new Map<string, string>();
export function noteBots(rows: { authorId: string; botName?: string | null }[]) {
  for (const r of rows) if (r.botName) botNames.set(r.authorId, r.botName);
}
const botColor = (id: string) => ['#2F8CFF', '#22D3EE', '#A78BFA', '#34D399', '#F472B6', '#FBBF24'][[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 6];

export async function ensureUsers(ids: string[]) {
  const known = getState().users;
  const need = [...new Set(ids.filter((id) => id !== ME && (!known[id] || (botNames.has(id) && known[id].name !== botNames.get(id)))))];
  for (let i = 0; i < need.length; i += 100) {
    const part = need.slice(i, i + 100);
    const rows = await list<ProfileRow>('profiles', [Query.equal('$id', part)]).catch(() => null);
    setState((s) => {
      const users = { ...s.users };
      rows?.forEach((row) => (users[row.$id] = userFromRow(row as ProfileRow)));
      // без профиля: бот вебхука или удалённый аккаунт — сообщения всё равно показываем
      if (rows)
        for (const id of part) {
          if (users[id] && !botNames.has(id)) continue;
          const bot = botNames.get(id);
          users[id] = bot
            ? { id, name: bot, username: 'бот', color: botColor(id), nameColor: botColor(id), presence: 'offline', bot: true }
            : { id, name: 'Удалённый аккаунт', username: 'deleted', color: '#56647F', nameColor: '#8D9BB9', presence: 'offline' };
        }
      return { users };
    });
  }
}

async function loadFriends() {
  const rows = await list<FriendRow>('friendships', []);
  const friends = rows.filter((f) => f.status === 'accepted').map((f) => L(f.fromId === myId ? f.toId : f.fromId));
  const pending = rows.filter((f) => f.status === 'pending' && f.toId === myId).map((f) => L(f.fromId));
  await ensureUsers([...friends, ...pending]);
  setState(() => ({ friends, pending }));
}

const mapDm = (row: DmRow) => {
  const other = L(row.userA === myId ? row.userB : row.userA);
  dmByUser.set(other, row.$id);
  userByDm.set(row.$id, other);
  social.setStreak(other, row.streak ?? 0, row.streakDay ?? '');
  return other;
};

export const dmIdFor = (userId: string) => dmByUser.get(userId);
export const rememberDm = (userId: string, dmId: string) => {
  dmByUser.set(userId, dmId);
  userByDm.set(dmId, userId);
};

/** Загрузить последние 100 сообщений чата при первом открытии. */
export async function loadChat(chatId: string, ensureDm: (userId: string) => Promise<string | undefined>) {
  if (!aw || loadedChats.has(chatId)) return;
  loadedChats.add(chatId);
  const id = chatId.startsWith('dm:') ? (dmByUser.get(chatId.slice(3)) ?? (await ensureDm(chatId.slice(3)))) : dbChatId(chatId);
  if (!id) {
    loadedChats.delete(chatId);
    return;
  }
  try {
    const [rows, reactions] = await Promise.all([
      api().db.listRows<MessageRow>({ databaseId: DB, tableId: 'messages', queries: [Query.equal('chatId', id), Query.orderDesc('$createdAt'), Query.limit(100)] }),
      list<ReactionRow>('reactions', [Query.equal('chatId', id)]),
    ]);
    const msgs = rows.rows.reverse();
    if (msgs.length < 100) setUi({ chatEnd: { ...getState().ui.chatEnd, [chatId]: true } });
    noteBots(msgs);
    await ensureUsers(msgs.map((r) => L(r.authorId)));
    const loaded = await decryptAll(chatId, msgs.map((m) => messageFromRow(m, reactions)));
    setState((s) => {
      const local = s.messages[chatId] ?? [];
      const ids = new Set(loaded.map((m) => m.id));
      return { messages: { ...s.messages, [chatId]: [...loaded, ...local.filter((m) => !ids.has(m.id))].sort((a, b) => a.ts - b.ts) } };
    });
  } catch (e) {
    loadedChats.delete(chatId);
    toast(errorText(e));
  }
}

const olderLoading = new Set<string>();

/** Следующие 50 сообщений старше самого раннего загруженного. */
export async function loadOlder(chatId: string): Promise<number> {
  const id = dbChatId(chatId);
  const first = getState().messages[chatId]?.find((m) => !m.pending && !m.failed);
  if (!aw || !id || !first || olderLoading.has(chatId)) return 0;
  olderLoading.add(chatId);
  try {
    const rows = (
      await api().db.listRows<MessageRow>({
        databaseId: DB,
        tableId: 'messages',
        queries: [Query.equal('chatId', id), Query.orderDesc('$createdAt'), Query.cursorAfter(first.id), Query.limit(50)],
      })
    ).rows.reverse();
    if (rows.length < 50) setUi({ chatEnd: { ...getState().ui.chatEnd, [chatId]: true } });
    if (!rows.length) return 0;
    const reactions = await list<ReactionRow>('reactions', [Query.equal('messageId', rows.map((r) => r.$id))]);
    noteBots(rows);
    await ensureUsers(rows.map((r) => L(r.authorId)));
    const older = await decryptAll(chatId, rows.map((m) => messageFromRow(m, reactions)));
    setState((s) => {
      const local = s.messages[chatId] ?? [];
      const ids = new Set(local.map((m) => m.id));
      return { messages: { ...s.messages, [chatId]: [...older.filter((m) => !ids.has(m.id)), ...local] } };
    });
    return older.length;
  } catch (e) {
    toast(errorText(e));
    return 0;
  } finally {
    olderLoading.delete(chatId);
  }
}

/* ---------- истории и лента ---------- */

export async function loadStories() {
  if (!aw || !myId) return;
  const now = new Date().toISOString();
  const rows = await list<StoryRow>('stories', [Query.greaterThan('expiresAt', now), Query.orderAsc('$createdAt')]).catch(() => []);
  await ensureUsers(rows.map((r) => L(r.authorId)));
  setState(() => ({ stories: rows.map(storyFromRow) }));
  // свои истекшие истории удаляем вместе с файлами, чтобы не занимали хранилище
  const old = await list<StoryRow>('stories', [Query.equal('authorId', myId), Query.lessThan('expiresAt', now)]).catch(() => []);
  for (const r of old) {
    await api().db.deleteRow({ databaseId: DB, tableId: 'stories', rowId: r.$id }).catch(() => undefined);
    if (r.fileId) await api().storage.deleteFile({ bucketId: BUCKET, fileId: r.fileId }).catch(() => undefined);
  }
}

/** Лента: первая страница (reset) или следующая. По 12 видео, новые сверху. */
export async function loadReels(reset: boolean) {
  if (!aw || reelsLoading || (!reset && reelsEnd)) return;
  reelsLoading = true;
  try {
    const last = reset ? undefined : getState().reels.at(-1);
    const { rows } = await api().db.listRows<ReelRow>({
      databaseId: DB,
      tableId: 'reels',
      queries: [Query.orderDesc('$createdAt'), ...(last ? [Query.cursorAfter(last.id)] : []), Query.limit(12)],
    });
    reelsEnd = rows.length < 12;
    const likes = rows.length
      ? (await api().db.listRows<LikeRow>({ databaseId: DB, tableId: 'reelLikes', queries: [Query.equal('reelId', rows.map((r) => r.$id)), Query.limit(5000)] })).rows
      : [];
    await ensureUsers(rows.map((r) => L(r.authorId)));
    const comments = rows.length
      ? (await api().db.listRows<CommentRow>({ databaseId: DB, tableId: 'reelComments', queries: [Query.equal('reelId', rows.map((r) => r.$id)), Query.limit(5000)] })).rows
      : [];
    const reels = rows.map((r) => ({ ...reelFromRow(r, likes), comments: comments.filter((c) => c.reelId === r.$id).length }));
    setState((s) => {
      if (reset) return { reels };
      const ids = new Set(s.reels.map((r) => r.id));
      return { reels: [...s.reels, ...reels.filter((r) => !ids.has(r.id))] };
    });
  } catch (e) {
    toast(errorText(e));
  } finally {
    reelsLoading = false;
  }
}

let starting: Promise<boolean> | null = null;

/** Есть сессия — загрузить всё о пользователе и включить realtime. Повторные вызовы ждут первый. */
export function start(): Promise<boolean> {
  if (unsubscribe) return Promise.resolve(true);
  starting ??= doStart().finally(() => (starting = null));
  return starting;
}

async function doStart(): Promise<boolean> {
  if (!aw) return false;
  let me: Models.User;
  try {
    me = await api().account.get();
  } catch {
    setUi({ booting: false });
    return false;
  }
  myId = me.$id;
  myEmail = me.email;
  try {
    const profileRow = await api()
      .db.getRow<ProfileRow>({ databaseId: DB, tableId: 'profiles', rowId: myId })
      .catch((e: AppwriteException) => (e.code === 404 ? null : Promise.reject(e)));
    hasProfileRow = !!profileRow;
    await keys.initE2E(myId, call, reopenLocked).catch((e) => console.error('e2e', e));
    const [teams, dms] = await Promise.all([api().teams.list({ queries: [Query.limit(500)] }), list<DmRow>('dms', [])]);
    const dmUsers = dms.map(mapDm);
    const rest = teams.teams.filter((t) => !userByDm.has(t.$id)).map((t) => t.$id);
    const groups = await fetchGroups(rest);
    const communityIds = rest.filter((id) => !groupIds.has(id));
    const servers = await fetchServers(communityIds);
    const base = profileRow ? profileFromRow(profileRow) : { ...defaultProfile(me.name || me.email.split('@')[0]), username: (me.name || me.email.split('@')[0]).toLowerCase().replace(/[^a-z0-9._]/g, '') };
    setState((s) => ({
      loggedIn: true,
      profile: { ...base, presence: base.presence ?? 'online' },
      servers,
      groups,
      dms: dmUsers,
      ui: { ...s.ui, booting: false, onboarding: !profileRow || !base.onboarded, view: servers.length ? 'server' : 'inbox', serverId: servers[0]?.id ?? null },
    }));
    await ensureUsers(dmUsers);
    await loadFriends();
    await social.loadBlocks();
    await subscribe();
    void loadStories();
    return true;
  } catch (e) {
    setUi({ booting: false });
    toast(errorText(e));
    return false;
  }
}

/** Выход: отписаться и очистить данные. */
export async function stop() {
  await unsubscribe?.().catch(() => undefined);
  unsubscribe = null;
  myId = null;
  hasProfileRow = false;
  dmByUser.clear();
  userByDm.clear();
  roomTeam.clear();
  groupIds.clear();
  keys.stopE2E();
  resetWatch();
  social.resetSocial();
  resetPolls();
  loadedChats.clear();
  presenceOf.clear();
  myReactionRows.clear();
  myLikeRows.clear();
  reelsEnd = false;
  setState((s) => ({ ...emptyState(s.settings), ui: { ...s.ui, modal: null, card: null, voice: null, view: 'inbox', serverId: null, onboarding: false } }));
}

export const markProfileCreated = () => (hasProfileRow = true);

/* ---------- realtime ---------- */

const patchMessages = (fn: (list: Message[], key: string) => Message[]) =>
  setState((s) => {
    const messages: Record<string, Message[]> = {};
    for (const [k, l] of Object.entries(s.messages)) messages[k] = fn(l, k);
    return { messages };
  });

const patchServer = (id: string, fn: (s: Server) => Server) => setState((s) => ({ servers: s.servers.map((x) => (x.id === id ? fn(x) : x)) }));

const removeServerLocal = (id: string) =>
  setState((s) => {
    const servers = s.servers.filter((x) => x.id !== id);
    return { servers, ui: s.ui.serverId === id ? { ...s.ui, serverId: servers[0]?.id ?? null, view: servers.length ? 'server' : 'inbox', modal: null } : s.ui };
  });

async function onMessage(row: MessageRow, kind: Kind) {
  if (kind === 'delete') return patchMessages((l) => l.filter((m) => m.id !== row.$id));
  if (!userByDm.has(row.chatId) && !roomTeam.has(row.chatId) && !groupIds.has(row.chatId)) {
    // новая переписка, которую начал кто-то другой
    const dm = await api().db.getRow<DmRow>({ databaseId: DB, tableId: 'dms', rowId: row.chatId }).catch(() => null);
    if (!dm) return;
    mapDm(dm);
  }
  const key = chatKey(row.chatId);
  noteBots([row]);
  await ensureUsers([L(row.authorId)]);
  const [msg] = await decryptAll(key, [messageFromRow(row)]);
  social.clearTyping(key, msg.authorId);
  const isNew = kind === 'create' && !(getState().messages[key] ?? []).some((m) => m.id === msg.id);
  setState((s) => {
    const l = s.messages[key] ?? [];
    const old = l.find((m) => m.id === msg.id);
    const next = old ? l.map((m) => (m.id === msg.id ? { ...msg, reactions: m.reactions } : m)) : [...l, msg].sort((a, b) => a.ts - b.ts);
    const patch: Partial<ReturnType<typeof getState>> = { messages: { ...s.messages, [key]: next } };
    if (key.startsWith('dm:')) {
      const other = key.slice(3);
      patch.dms = [other, ...s.dms.filter((d) => d !== other)];
    }
    if (key.startsWith('g:')) {
      const id = key.slice(2);
      patch.groups = [...s.groups.filter((g) => g.id === id), ...s.groups.filter((g) => g.id !== id)];
    }
    return patch;
  });
  if (isNew) notifyAbout(key, msg);
}

/** Уведомление о новом сообщении и что открыть по нажатию */
function notifyAbout(key: string, msg: Message) {
  const s = getState();
  const author = s.users[msg.authorId]?.name ?? 'Fizion';
  if (key.startsWith('dm:')) return notifyMessage(key, msg, 'dm', author, () => getActions().openDm(key.slice(3)));
  if (key.startsWith('g:')) {
    const g = s.groups.find((x) => x.id === key.slice(2));
    return notifyMessage(key, msg, 'group', `${author} · ${g?.name ?? 'Группа'}`, () => getActions().openHome(key));
  }
  const srv = s.servers.find((x) => x.channels.some((c) => c.id === key));
  if (!srv) return;
  notifyMessage(key, msg, 'room', `${author} · ${srv.name}`, () => {
    getActions().openServer(srv.id);
    getActions().openChannel(srv.id, key);
  });
}

/** store импортирует sync, поэтому действия берём лениво, чтобы не было цикла при загрузке модулей */
let getActions: () => typeof import('../store').actions = () => {
  throw new Error('actions not ready');
};
export const provideActions = (fn: typeof getActions) => (getActions = fn);

function onReaction(row: ReactionRow, kind: Kind) {
  const user = L(row.userId);
  if (row.userId === myId) {
    if (kind === 'delete') myReactionRows.delete(`${row.messageId}|${row.emoji}`);
    else myReactionRows.set(`${row.messageId}|${row.emoji}`, row.$id);
  }
  patchMessages((l) =>
    l.map((m) => {
      if (m.id !== row.messageId) return m;
      const r = m.reactions.find((x) => x.emoji === row.emoji);
      if (kind === 'delete') {
        if (!r) return m;
        const users = r.users.filter((u) => u !== user);
        return { ...m, reactions: users.length ? m.reactions.map((x) => (x.emoji === row.emoji ? { ...x, users } : x)) : m.reactions.filter((x) => x.emoji !== row.emoji) };
      }
      if (r?.users.includes(user)) return m;
      return { ...m, reactions: r ? m.reactions.map((x) => (x.emoji === row.emoji ? { ...x, users: [...x.users, user] } : x)) : [...m.reactions, { emoji: row.emoji, users: [user] }] };
    }),
  );
}

function onRoom(row: RoomRow, kind: Kind) {
  if (kind === 'delete') {
    roomTeam.delete(row.$id);
    return setState((s) => ({ servers: s.servers.map((x) => ({ ...x, channels: x.channels.filter((c) => c.id !== row.$id) })) }));
  }
  roomTeam.set(row.$id, row.teamId);
  patchServer(row.teamId, (s) => {
    const ch = roomFromRow(row);
    const channels = s.channels.some((c) => c.id === row.$id) ? s.channels.map((c) => (c.id === row.$id ? ch : c)) : [...s.channels, ch];
    return { ...s, channels };
  });
}

function onRole(row: RoleRow, kind: Kind) {
  if (kind === 'delete') return setState((s) => ({ servers: s.servers.map((x) => ({ ...x, roles: x.roles.filter((r) => r.id !== row.$id) })) }));
  patchServer(row.teamId, (s) => {
    const role = roleFromRow(row);
    if (s.roles.some((r) => r.id === row.$id)) return { ...s, roles: s.roles.map((r) => (r.id === row.$id ? role : r)) };
    const roles = [...s.roles];
    const at = roles.findIndex((r) => r.key === 'everyone');
    roles.splice(at < 0 ? roles.length : at, 0, role);
    return { ...s, roles };
  });
}

function onMemberRole(row: MemberRoleRow, kind: Kind) {
  patchServer(row.teamId, (s) => {
    const everyone = s.roles.find((r) => r.key === 'everyone')?.id ?? '';
    const uid = L(row.userId);
    return { ...s, members: s.members.map((m) => (m.userId === uid ? { ...m, roleId: kind === 'delete' ? everyone : row.roleId } : m)) };
  });
}

function onCommunity(row: CommunityRow, kind: Kind) {
  if (kind === 'delete') return removeServerLocal(row.$id);
  patchServer(row.$id, (s) => ({ ...s, name: row.name, short: shortName(row.name), color: row.color }));
}

async function onMembership(m: Models.Membership, kind: Kind) {
  if (groupIds.has(m.teamId)) return onGroupMembership(m, kind);
  const known = getState().servers.some((s) => s.id === m.teamId);
  if (m.userId === myId) {
    if (kind === 'delete') return removeServerLocal(m.teamId);
    if (known || userByDm.has(m.teamId)) return;
    // меня добавили в сообщество (или в новую переписку — её подхватит событие dms)
    const [server] = await fetchServers([m.teamId]).catch(() => []);
    if (server) setState((s) => (s.servers.some((x) => x.id === server.id) ? {} : { servers: [...s.servers, server] }));
    return;
  }
  if (!known) return;
  if (kind === 'delete') return patchServer(m.teamId, (s) => ({ ...s, members: s.members.filter((x) => x.userId !== m.userId) }));
  await ensureUsers([m.userId]);
  patchServer(m.teamId, (s) => {
    if (s.members.some((x) => x.userId === m.userId)) return s;
    const roleId = m.roles.includes('owner') ? s.roles.find((r) => r.key === 'owner')?.id : s.roles.find((r) => r.key === 'everyone')?.id;
    return { ...s, members: [...s.members, { userId: m.userId, roleId: roleId ?? '' }] };
  });
}

async function onGroupMembership(m: Models.Membership, kind: Kind) {
  const uid = L(m.userId);
  if (m.userId === myId && kind === 'delete') {
    groupIds.delete(m.teamId);
    return setState((s) => ({ groups: s.groups.filter((g) => g.id !== m.teamId), ui: s.ui.homeTab === `g:${m.teamId}` ? { ...s.ui, homeTab: 'friends' } : s.ui }));
  }
  await ensureUsers([uid]);
  setState((s) => ({
    groups: s.groups.map((g) => (g.id !== m.teamId ? g : { ...g, members: kind === 'delete' ? g.members.filter((x) => x !== uid) : g.members.includes(uid) ? g.members : [...g.members, uid] })),
  }));
}

async function onGroup(row: GroupRow, kind: Kind) {
  if (kind === 'delete') {
    groupIds.delete(row.$id);
    return setState((s) => ({ groups: s.groups.filter((g) => g.id !== row.$id) }));
  }
  if (getState().groups.some((g) => g.id === row.$id))
    return setState((s) => ({ groups: s.groups.map((g) => (g.id === row.$id ? { ...g, name: row.name, color: row.color, ownerId: L(row.ownerId) } : g)) }));
  const [g] = await fetchGroups([row.$id]);
  if (g) setState((s) => (s.groups.some((x) => x.id === g.id) ? {} : { groups: [g, ...s.groups] }));
}

function onMute(row: MuteRow, kind: Kind) {
  patchServer(row.teamId, (s) => {
    const mutes = { ...(s.mutes ?? {}) };
    if (kind === 'delete') delete mutes[L(row.userId)];
    else mutes[L(row.userId)] = Date.parse(row.until);
    return { ...s, mutes };
  });
}

function onReport(row: ReportCountRow, kind: Kind) {
  if (kind === 'create') toast('Новая жалоба в сообществе — открой его настройки');
  void list<ReportCountRow>('reports', [Query.equal('teamId', row.teamId), Query.equal('status', 'open')])
    .then((rows) => patchServer(row.teamId, (s) => ({ ...s, openReports: rows.length })))
    .catch(() => undefined);
}

export const commentFromRow = (r: CommentRow): Comment => ({ id: r.$id, reelId: r.reelId, authorId: L(r.authorId), text: r.text, ts: Date.parse(r.$createdAt) });

async function onComment(row: CommentRow, kind: Kind) {
  await ensureUsers([L(row.authorId)]);
  setState((s) => {
    const list = s.comments[row.reelId];
    const has = !!list?.some((c) => c.id === row.$id);
    const comments = list ? { ...s.comments, [row.reelId]: kind === 'delete' ? list.filter((c) => c.id !== row.$id) : has ? list : [...list, commentFromRow(row)] } : s.comments;
    const delta = kind === 'delete' ? -1 : has ? 0 : 1;
    return { comments, reels: s.reels.map((r) => (r.id === row.reelId ? { ...r, comments: Math.max(0, (r.comments ?? 0) + delta) } : r)) };
  });
}

/** Комментарии к видео — загружаются, когда открыли панель */
export async function loadComments(reelId: string) {
  const rows = (await api().db.listRows<CommentRow>({ databaseId: DB, tableId: 'reelComments', queries: [Query.equal('reelId', reelId), Query.orderAsc('$createdAt'), Query.limit(200)] })).rows;
  await ensureUsers(rows.map((r) => L(r.authorId)));
  setState((s) => ({ comments: { ...s.comments, [reelId]: rows.map(commentFromRow) } }));
}

async function onStory(row: StoryRow, kind: Kind) {
  if (kind === 'delete') return setState((s) => ({ stories: s.stories.filter((x) => x.id !== row.$id) }));
  await ensureUsers([L(row.authorId)]);
  const story = storyFromRow(row);
  setState((s) => ({ stories: s.stories.some((x) => x.id === story.id) ? s.stories : [...s.stories, story] }));
}

async function onReel(row: ReelRow, kind: Kind) {
  if (kind === 'delete') return setState((s) => ({ reels: s.reels.filter((r) => r.id !== row.$id) }));
  await ensureUsers([L(row.authorId)]);
  setState((s) => {
    const old = s.reels.find((r) => r.id === row.$id);
    const reel = { ...reelFromRow(row, []), likes: old?.likes ?? [] };
    return { reels: old ? s.reels.map((r) => (r.id === reel.id ? reel : r)) : [reel, ...s.reels] };
  });
}

function onLike(row: LikeRow, kind: Kind) {
  const user = L(row.userId);
  if (row.userId === myId) {
    if (kind === 'delete') myLikeRows.delete(row.reelId);
    else myLikeRows.set(row.reelId, row.$id);
  }
  setState((s) => ({
    reels: s.reels.map((r) => {
      if (r.id !== row.reelId) return r;
      const has = r.likes.includes(user);
      if (kind === 'delete') return has ? { ...r, likes: r.likes.filter((u) => u !== user) } : r;
      return has ? r : { ...r, likes: [...r.likes, user] };
    }),
  }));
}

async function onCall(row: CallRow, kind: Kind) {
  if (!userByDm.has(row.dmId) && !groupIds.has(row.dmId)) {
    // звонок в переписке, которой ещё нет в приложении
    const dm = await api().db.getRow<DmRow>({ databaseId: DB, tableId: 'dms', rowId: row.dmId }).catch(() => null);
    if (!dm) return;
    mapDm(dm);
  }
  await ensureUsers([L(row.fromId), L(row.toId)]);
  callHandler?.({ ...row, from: L(row.fromId) }, kind);
}

function onProfile(row: ProfileRow) {
  if (row.$id === myId) return;
  setState((s) => (s.users[row.$id] ? { users: { ...s.users, [row.$id]: userFromRow(row) } } : {}));
}

type Kind = 'create' | 'update' | 'delete';
const kindOf = (events: string[]): Kind => (events.some((e) => e.endsWith('.delete')) ? 'delete' : events.some((e) => e.endsWith('.create')) ? 'create' : 'update');

async function dispatch(evt: RealtimeResponseEvent<Record<string, unknown>>) {
  const kind = kindOf(evt.events);
  const p = evt.payload as Record<string, unknown> & { $tableId?: string };
  try {
    if (evt.events.some((e) => e.startsWith('presences.'))) return applyPresence(p as unknown as Models.Presence, kind);
    if (evt.events.some((e) => e.includes('.memberships.'))) return void (await onMembership(p as unknown as Models.Membership, kind));
    switch (p.$tableId) {
      case 'messages':
        return void (await onMessage(p as unknown as MessageRow, kind));
      case 'reactions':
        return onReaction(p as unknown as ReactionRow, kind);
      case 'rooms':
        return onRoom(p as unknown as RoomRow, kind);
      case 'roles':
        return onRole(p as unknown as RoleRow, kind);
      case 'memberRoles':
        return onMemberRole(p as unknown as MemberRoleRow, kind);
      case 'communities':
        return onCommunity(p as unknown as CommunityRow, kind);
      case 'friendships':
        return void (await loadFriends());
      case 'dms':
        if (kind !== 'delete') {
          const other = mapDm(p as unknown as DmRow);
          void ensureUsers([other]);
          // новая переписка (например, друг написал первым) — сразу в списке
          setState((s) => (s.dms.includes(other) ? {} : { dms: [other, ...s.dms] }));
        }
        return;
      case 'profiles':
        return onProfile(p as unknown as ProfileRow);
      case 'stories':
        return void (await onStory(p as unknown as StoryRow, kind));
      case 'reels':
        return void (await onReel(p as unknown as ReelRow, kind));
      case 'reelLikes':
        return onLike(p as unknown as LikeRow, kind);
      case 'groups':
        return void (await onGroup(p as unknown as GroupRow, kind));
      case 'mutes':
        return onMute(p as unknown as MuteRow, kind);
      case 'reports':
        return onReport(p as unknown as ReportCountRow, kind);
      case 'reelComments':
        return void (await onComment(p as unknown as CommentRow, kind));
      case 'keys':
        return void (await keys.onKeyEvent(p as never));
      case 'devices':
        return void (await keys.onDeviceEvent(p as never));
      case 'keyshares':
        return void (await keys.onShareEvent(p as never, kind));
      case 'groupkeys':
        return keys.onGroupKeyEvent(p as never);
      case 'watch':
        return void (await onWatchRow(p as never, kind));
      case 'reads':
        return social.onReadRow(p as never);
      case 'pins':
        return social.onPinRow(p as never, kind);
      case 'votes':
        return onVoteRow(p as never, kind);
      case 'calls':
        return void (await onCall(p as unknown as CallRow, kind));
    }
  } catch (e) {
    console.error('realtime', e);
  }
}

async function subscribe() {
  const tables = ['messages', 'reactions', 'rooms', 'roles', 'memberRoles', 'communities', 'friendships', 'dms', 'profiles', 'stories', 'reels', 'reelLikes', 'calls', 'groups', 'mutes', 'reports', 'reelComments', 'keys', 'devices', 'keyshares', 'groupkeys', 'watch', 'reads', 'pins', 'votes'];
  const rt = api().realtime;
  rt.onError(() => setUi({ net: 'reconnecting' }));
  const sub = await rt.subscribe([...tables.map((t) => `tablesdb.${DB}.tables.${t}.rows`), 'memberships', 'presences'], (evt) => {
    setUi({ net: 'online' });
    void dispatch(evt);
  });
  unsubscribe = sub.unsubscribe;
  await loadPresence();
  await trackMe();
}

/* ---------- присутствие ---------- */

const voiceOf = (serverId: string) => {
  const voice: Record<string, string[]> = {};
  for (const [uid, p] of presenceOf) if (p.voice?.s === serverId) (voice[p.voice.c] ??= []).push(L(uid));
  return voice;
};

function refreshPresence() {
  setState((s) => {
    const users = { ...s.users };
    for (const id of Object.keys(users)) {
      const pr = presenceOf.get(id)?.status ?? 'offline';
      if (users[id].presence !== pr) users[id] = { ...users[id], presence: pr };
    }
    return { users, servers: s.servers.map((x) => ({ ...x, voice: voiceOf(x.id) })) };
  });
}

const statusOf = (s: string | null | undefined): Presence => (s === 'idle' || s === 'dnd' || s === 'online' ? s : 'offline');

function applyPresence(p: Models.Presence, kind: Kind) {
  const meta = (p.metadata ?? {}) as { voice?: { s: string; c: string; hand?: boolean } | null; typing?: { c: string; t: number } | null };
  if (kind === 'delete' || (p.expiresAt && Date.parse(p.expiresAt) < Date.now())) {
    presenceOf.delete(p.userId);
    social.onPresenceTyping(p.userId, null);
    social.onPresenceHand(p.userId, null, false);
  } else {
    presenceOf.set(p.userId, { status: statusOf(p.status), voice: meta.voice ?? null });
    social.onPresenceTyping(p.userId, meta.typing);
    social.onPresenceHand(p.userId, meta.voice?.c, !!meta.voice?.hand);
  }
  refreshPresence();
}

async function loadPresence() {
  const r = await api().presences.list({ queries: [Query.limit(500)] }).catch(() => null);
  presenceOf.clear();
  r?.presences.forEach((p) => {
    const voice = ((p.metadata ?? {}) as { voice?: { s: string; c: string; hand?: boolean } }).voice ?? null;
    presenceOf.set(p.userId, { status: statusOf(p.status), voice });
    social.onPresenceHand(p.userId, voice?.c, !!voice?.hand);
  });
  refreshPresence();
}

/** Сообщить остальным свой статус и голосовую комнату. «Невидимый» не показывается вовсе. */
export async function trackMe() {
  if (!aw || !myId) return;
  const s = getState();
  const v = s.ui.voice;
  await api()
    .realtime.upsertPresence({
      presenceId: myId,
      status: s.profile.presence,
      permissions: s.profile.presence === 'offline' ? [Permission.read(Role.user(myId))] : [Permission.read(Role.users())],
      metadata: { voice: v && s.profile.presence !== 'offline' ? { s: v.serverId, c: v.channelId, hand: social.handUp() || undefined } : null, typing: s.profile.presence !== 'offline' ? social.typingMeta() : null },
    })
    .catch(() => undefined);
}
