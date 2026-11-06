// Онлайн-режим на Appwrite: запись. Приложение сначала меняет данные у себя (интерфейс отзывается мгновенно),
// затем отправляет изменение на сервер; остальные получают его через realtime.
// Простые записи (свои сообщения, реакции, профиль, файлы) идут прямо в базу,
// всё, где нужны чужие права или проверка роли, — через серверную функцию fizion-api.

import { AppwriteException, ID, Permission, Query, Role, type Models } from 'appwrite';
import { ME } from '../data';
import { aw, BUCKET, DB } from '../lib/appwrite';
import { getState, setState, setUi } from '../store';
import { STORY_HOURS } from '../data';
import type { Attachment, Message, Profile, Reel, Server, Story } from '../types';
import * as e2e from './crypto';
import * as keys from './keys';
import {
  call,
  dbChatId,
  dmIdFor,
  ensureUsers,
  errorText,
  fetchServers,
  hasProfileRow,
  markProfileCreated,
  myId,
  myLikeRows,
  myReactionRows,
  R,
  reelFromRow,
  storyFromRow,
  type ReelRow,
  type StoryRow,
  rememberDm,
  teamOfChat,
  toast,
  trackMe,
  type MessageRow,
  type ProfileRow,
  chatKeyOf,
  L,
  messageFromRow,
  noteBots,
} from './sync';

const api = () => aw!;
const fail = (e: unknown) => {
  console.error(e);
  toast(errorText(e));
};

const patchMessage = (chatId: string, id: string, patch: Partial<Message>) =>
  setState((s) => ({ messages: { ...s.messages, [chatId]: (s.messages[chatId] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)) } }));

/* ---------- личные сообщения ---------- */

export async function ensureDm(userId: string): Promise<string | undefined> {
  const known = dmIdFor(userId);
  if (known) return known;
  try {
    const { teamId } = await call<{ teamId: string }>('open-dm', { userId: R(userId) });
    rememberDm(userId, teamId);
    return teamId;
  } catch (e) {
    fail(e);
    return undefined;
  }
}

/* ---------- сообщения ---------- */

export async function send(chatId: string, msg: Message) {
  if (chatId.startsWith('dm:')) await ensureDm(chatId.slice(3));
  const chat = dbChatId(chatId);
  const team = teamOfChat(chatId);
  if (!chat || !team) return patchMessage(chatId, msg.id, { pending: false, failed: true });
  // личные и группы шифруются сами, если ключи есть у всех. Вложение (с ключом файла) едет внутри шифра.
  if ((chatId.startsWith('dm:') || chatId.startsWith('g:')) && keys.e2eState() === 'waiting') {
    // открытым текстом не отправляем: собеседник ждёт шифрование
    toast('Ключ шифрования ещё переносится — открой Neon на другом своём устройстве или создай новый ключ: Настройки → Шифрование');
    return patchMessage(chatId, msg.id, { pending: false, failed: true });
  }
  let text = msg.text;
  let attachment = msg.attachment ? JSON.stringify(msg.attachment) : '';
  const sealed = await sealFor(chatId, { text: msg.text, attachment: msg.attachment });
  if (sealed) {
    text = sealed;
    attachment = '';
    patchMessage(chatId, msg.id, { encrypted: true });
  } else if (msg.attachment?.key) {
    // файл уже зашифрован, а ключи пропали — без ключа его никто не откроет
    return patchMessage(chatId, msg.id, { pending: false, failed: true });
  }
  try {
    await api().db.createRow({
      databaseId: DB,
      tableId: 'messages',
      rowId: msg.id,
      data: { chatId: chat, teamId: team, authorId: myId, text, replyTo: msg.replyTo ?? null, attachment, edited: false },
      permissions: [Permission.read(Role.team(team)), Permission.update(Role.user(myId!)), Permission.delete(Role.user(myId!))],
    });
    patchMessage(chatId, msg.id, { pending: false, failed: false });
  } catch (e) {
    if ((e as AppwriteException).code === 409) return patchMessage(chatId, msg.id, { pending: false, failed: false });
    fail(e);
    patchMessage(chatId, msg.id, { pending: false, failed: true });
  }
}

/** Участники группы (настоящие id) */
const groupMembers = (groupId: string) => (getState().groups.find((g) => g.id === groupId)?.members ?? []).map(R);

/** Зашифровать для чата. null — чат не шифруется (сообщество или у кого-то нет ключа). */
async function sealFor(chatId: string, body: e2e.SealedBody): Promise<string | null> {
  if (chatId.startsWith('dm:')) return keys.sealDm(R(chatId.slice(3)), body);
  if (chatId.startsWith('g:')) return keys.sealGroup(chatId.slice(2), groupMembers(chatId.slice(2)), body);
  return null;
}

/** Зашифровать произвольный текст для чата (или вернуть как есть, если чат не шифруется) */
export async function sealText(chatId: string, text: string) {
  return (await sealFor(chatId, { text })) ?? text;
}

/** Будет ли этот чат зашифрован (тогда и файлы шифруем перед загрузкой) */
export async function willSeal(chatId: string) {
  if (chatId.startsWith('dm:')) return keys.canSeal('dm', [R(chatId.slice(3))]);
  if (chatId.startsWith('g:')) return keys.canSeal('group', groupMembers(chatId.slice(2)));
  return false;
}

export async function editMessage(id: string, text: string, chatId?: string, attachment?: Attachment) {
  let data: Record<string, unknown> = { text, edited: true };
  if (chatId && (chatId.startsWith('dm:') || chatId.startsWith('g:'))) {
    const sealed = await sealFor(chatId, { text, attachment });
    if (sealed) data = { text: sealed, attachment: '', edited: true };
  }
  await api().db.updateRow({ databaseId: DB, tableId: 'messages', rowId: id, data }).catch(fail);
}

export async function deleteMessage(id: string, authorId: string) {
  // своё — напрямую, чужое (модератор) — через сервер с проверкой роли
  if (authorId === ME) await api().db.deleteRow({ databaseId: DB, tableId: 'messages', rowId: id }).catch(fail);
  else await call('delete-message', { messageId: id }).catch(fail);
}

export async function setReaction(chatId: string, messageId: string, emoji: string, on: boolean) {
  const key = `${messageId}|${emoji}`;
  try {
    if (on) {
      const team = teamOfChat(chatId);
      const chat = dbChatId(chatId);
      if (!team || !chat) return;
      const row = await api().db.createRow({
        databaseId: DB,
        tableId: 'reactions',
        rowId: ID.unique(),
        data: { messageId, chatId: chat, teamId: team, userId: myId, emoji },
        permissions: [Permission.read(Role.team(team)), Permission.delete(Role.user(myId!))],
      });
      myReactionRows.set(key, row.$id);
    } else {
      const rowId = myReactionRows.get(key);
      if (!rowId) return;
      myReactionRows.delete(key);
      await api().db.deleteRow({ databaseId: DB, tableId: 'reactions', rowId });
    }
  } catch (e) {
    if ((e as AppwriteException).code !== 409) fail(e);
  }
}

/* ---------- файлы ---------- */

const dataUrlToFile = (dataUrl: string, name: string) => {
  const [head, body] = dataUrl.split(',');
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
};

/** Загрузить файл. Ссылка длинная и случайная — её знают только те, кто видит сообщение или профиль. */
async function upload(file: File) {
  const f = await api().storage.createFile({ bucketId: BUCKET, fileId: ID.unique(), file, permissions: [Permission.read(Role.any())] });
  return api().storage.getFileView({ bucketId: BUCKET, fileId: f.$id });
}

/** Загрузить публичный файл (фон чата и т.п.) и получить ссылку */
export const uploadPublic = (file: File) => upload(file);

export async function uploadAttachment(file: File, chatId?: string): Promise<Attachment> {
  const size = file.size > 1_048_576 ? `${(file.size / 1_048_576).toFixed(1)} МБ` : `${Math.max(1, Math.round(file.size / 1024))} КБ`;
  if (chatId && (await willSeal(chatId))) {
    // в личных и группах файл шифруется до загрузки: на сервере лежит только шифр
    const { blob, key } = await e2e.sealFile(await file.arrayBuffer());
    const url = await upload(new File([blob], 'encrypted.bin', { type: 'application/octet-stream' }));
    return { name: file.name, size, url, type: file.type, key };
  }
  return { name: file.name, size, url: await upload(file), type: file.type };
}

/* ---------- профиль ---------- */

const profileData = (p: Profile) => {
  const { displayName: _n, username: _u, avatarImage: _a, bannerImage: _b, ...data } = p;
  return JSON.stringify(data);
};

const updateProfileRow = (data: Record<string, unknown>) =>
  api().db.updateRow({ databaseId: DB, tableId: 'profiles', rowId: myId!, data }) as unknown as Promise<ProfileRow>;

export async function saveProfile(p: Profile): Promise<Profile> {
  let { avatarImage, bannerImage } = p;
  if (avatarImage?.startsWith('data:')) avatarImage = await upload(dataUrlToFile(avatarImage, 'avatar.webp'));
  if (bannerImage?.startsWith('data:')) bannerImage = await upload(dataUrlToFile(bannerImage, 'banner.webp'));
  const row = { username: p.username, displayName: p.displayName, avatarUrl: avatarImage ?? null, bannerUrl: bannerImage ?? null, data: profileData(p) };
  let saved: ProfileRow;
  if (!hasProfileRow) {
    // первый профиль создаёт сервер — так никто не займёт чужой id
    saved = await call<ProfileRow>('ensure-profile', row);
    markProfileCreated();
    if (saved.data !== row.data || saved.username !== row.username) saved = await updateProfileRow(row);
  } else saved = await updateProfileRow(row);
  if (p.displayName) await api().account.updateName({ name: p.displayName }).catch(() => undefined);
  void trackMe();
  return { ...p, displayName: saved.displayName, username: saved.username, avatarImage, bannerImage, num: saved.num || p.num };
}

export async function savePresence(p: Profile) {
  void trackMe();
  if (hasProfileRow) await updateProfileRow({ data: profileData(p) }).catch(() => undefined);
}

/* ---------- сообщества ---------- */

async function openFetchedServer(id: string) {
  const [server] = await fetchServers([id]);
  if (!server) return;
  setState((s) => ({
    servers: s.servers.some((x) => x.id === id) ? s.servers.map((x) => (x.id === id ? server : x)) : [...s.servers, server],
    ui: { ...s.ui, view: 'server', serverId: id, modal: null, mobileChat: true },
  }));
}

export async function createServer(name: string, color: string, channels: Server['channels']) {
  try {
    const { teamId } = await call<{ teamId: string }>('create-community', {
      name,
      color,
      rooms: channels.map((c) => ({ name: c.name, kind: c.kind, category: c.category, stage: c.stage })),
    });
    await openFetchedServer(teamId);
  } catch (e) {
    fail(e);
  }
}

export async function joinByCode(input: string): Promise<string | null> {
  const code = input.trim().split('/').pop()?.toLowerCase() ?? '';
  if (!code) return 'Введи код приглашения';
  try {
    const { teamId } = await call<{ teamId: string }>('join', { code });
    await openFetchedServer(teamId);
    return null;
  } catch (e) {
    return errorText(e);
  }
}

export async function createInvite(serverId: string): Promise<string | null> {
  try {
    return (await call<{ code: string }>('create-invite', { teamId: serverId })).code;
  } catch (e) {
    fail(e);
    return null;
  }
}

export async function deleteOrLeave(server: Server) {
  await call(server.ownerId === ME ? 'delete-community' : 'leave', { teamId: server.id }).catch(fail);
}

// Настройки сообщества меняются по буквам — копим правки и отправляем одним запросом через 700 мс
const pendingSync = new Map<string, { before: Server; timer: number }>();

export function scheduleServerSync(before: Server) {
  const p = pendingSync.get(before.id);
  if (p) window.clearTimeout(p.timer);
  const base = p?.before ?? before;
  const timer = window.setTimeout(() => {
    pendingSync.delete(before.id);
    const after = getState().servers.find((s) => s.id === before.id);
    if (after) void pushServer(base, after);
  }, 700);
  pendingSync.set(before.id, { before: base, timer });
}

async function pushServer(a: Server, b: Server) {
  const members: Record<string, string> = {};
  const was = new Map(a.members.map((m) => [m.userId, m.roleId]));
  b.members.forEach((m) => {
    if (was.get(m.userId) !== m.roleId) members[R(m.userId)] = m.roleId;
  });
  try {
    await call('update-community', {
      teamId: b.id,
      ...(a.name !== b.name || a.color !== b.color ? { name: b.name, color: b.color } : {}),
      ...(JSON.stringify(a.roles) !== JSON.stringify(b.roles) ? { roles: b.roles } : {}),
      ...(JSON.stringify(a.channels) !== JSON.stringify(b.channels) ? { rooms: b.channels } : {}),
      ...(Object.keys(members).length ? { members } : {}),
    });
  } catch (e) {
    fail(e);
    void openFetchedServer(b.id); // вернуть как на сервере
  }
}

/* ---------- друзья ---------- */

const friendResult = (status: string, name?: string) =>
  status === 'accepted' ? `${name ?? 'Пользователь'} теперь у тебя в друзьях` : status === 'pending' ? 'Заявка уже отправлена' : `Заявка отправлена${name ? ` — ${name}` : ''}`;

export async function requestFriendByName(username: string): Promise<string> {
  const name = username.trim().toLowerCase().replace(/^@/, '');
  if (!name) return 'Введи логин или ID';
  try {
    // цифры — это ID, как в Telegram
    if (/^\d{6,12}$/.test(name)) {
      const u = await call<{ userId: string; username: string }>('find-user', { query: name });
      const { status } = await call<{ status: string }>('friend-request', { userId: u.userId });
      return friendResult(status, '@' + u.username);
    }
    const { status } = await call<{ status: string }>('friend-request', { username: name });
    return friendResult(status, '@' + name);
  } catch (e) {
    return errorText(e);
  }
}

export async function requestFriend(userId: string, name?: string): Promise<string> {
  try {
    const { status } = await call<{ status: string }>('friend-request', { userId: R(userId) });
    await ensureUsers([userId]);
    return friendResult(status, name);
  } catch (e) {
    return errorText(e);
  }
}

export async function acceptFriend(userId: string) {
  await call('friend-accept', { userId: R(userId) }).catch(fail);
}

export async function removeFriend(userId: string) {
  await call('friend-remove', { userId: R(userId) }).catch(fail);
}

/* ---------- вход через почту ---------- */

export type CodeType = 'email' | 'signup' | 'recovery';

const mail = (email: string) => email.trim().toLowerCase();
let pendingUserId = ''; // кому отправили код
let pendingSecret = ''; // код сброса пароля, пока человек придумывает новый

/** Выйти из старой сессии, если осталась (иначе Appwrite не даст войти заново). */
const dropSession = () => api().account.deleteSession({ sessionId: 'current' }).catch(() => undefined);

/** Код на почту для входа без пароля. Нет аккаунта — Appwrite создаст его сам. */
export async function sendLoginCode(email: string): Promise<string | null> {
  try {
    await dropSession();
    pendingUserId = (await api().account.createEmailToken({ userId: ID.unique(), email: mail(email) })).userId;
    return null;
  } catch (e) {
    return errorText(e);
  }
}

/** Вход по паролю. needsConfirm — почта не подтверждена: отправили код подтверждения. */
export async function signIn(email: string, password: string): Promise<{ error: string | null; needsConfirm: boolean }> {
  try {
    await dropSession();
    await api().account.createEmailPasswordSession({ email: mail(email), password });
    const me = await api().account.get();
    if (!me.emailVerification) {
      pendingUserId = me.$id;
      await api().account.createEmailVerificationOTP();
      return { error: null, needsConfirm: true };
    }
    return { error: null, needsConfirm: false };
  } catch (e) {
    return { error: errorText(e), needsConfirm: false };
  }
}

/** Регистрация по паролю: аккаунт, вход и код подтверждения почты. */
export async function signUp(email: string, password: string, displayName: string): Promise<{ error: string | null; confirm: boolean }> {
  try {
    await dropSession();
    const user = await api().account.create({ userId: ID.unique(), email: mail(email), password, name: displayName.trim().slice(0, 32) || undefined });
    await api().account.createEmailPasswordSession({ email: mail(email), password });
    pendingUserId = user.$id;
    await api().account.createEmailVerificationOTP();
    return { error: null, confirm: true };
  } catch (e) {
    return { error: errorText(e), confirm: false };
  }
}

export async function sendResetCode(email: string): Promise<string | null> {
  try {
    pendingUserId = (await api().account.createRecoveryOTP({ email: mail(email) })).userId;
    return null;
  } catch (e) {
    return errorText(e);
  }
}

export async function resendCode(email: string, type: CodeType): Promise<string | null> {
  try {
    if (type === 'email') pendingUserId = (await api().account.createEmailToken({ userId: ID.unique(), email: mail(email) })).userId;
    else if (type === 'recovery') pendingUserId = (await api().account.createRecoveryOTP({ email: mail(email) })).userId;
    else await api().account.createEmailVerificationOTP();
    return null;
  } catch (e) {
    return errorText(e);
  }
}

/** Проверить код. Вход и подтверждение — сразу; для сброса пароля код проверится вместе с новым паролем. */
export async function verifyCode(code: string, type: CodeType): Promise<string | null> {
  const secret = code.replace(/\s/g, '');
  try {
    if (type === 'email') await api().account.createSession({ userId: pendingUserId, secret });
    else if (type === 'signup') await api().account.updateEmailVerificationOTP({ userId: pendingUserId, secret });
    else pendingSecret = secret;
    return null;
  } catch (e) {
    return errorText(e);
  }
}

/** Новый пароль по коду из письма, затем вход с ним. */
export async function setNewPassword(email: string, password: string): Promise<{ error: string | null; badCode: boolean }> {
  try {
    await api().account.updateRecoveryOTP({ userId: pendingUserId, secret: pendingSecret, password });
  } catch (e) {
    const t = (e as AppwriteException).type;
    return { error: errorText(e), badCode: t === 'user_invalid_token' };
  }
  pendingSecret = '';
  try {
    await dropSession();
    await api().account.createEmailPasswordSession({ email: mail(email), password });
    return { error: null, badCode: false };
  } catch (e) {
    return { error: errorText(e), badCode: false };
  }
}

export async function signOut() {
  await dropSession();
  setUi({ voice: null });
}

/* ---------- истории и лента ---------- */

/** Файл, который автор потом может удалить сам */
async function uploadOwned(file: File) {
  const f = await api().storage.createFile({
    bucketId: BUCKET,
    fileId: ID.unique(),
    file,
    permissions: [Permission.read(Role.any()), Permission.delete(Role.user(myId!))],
  });
  return { fileId: f.$id, url: api().storage.getFileView({ bucketId: BUCKET, fileId: f.$id }) };
}

const removeFile = (fileId?: string) => (fileId ? api().storage.deleteFile({ bucketId: BUCKET, fileId }).catch(() => undefined) : undefined);

export async function postStory(file: File, kind: Story['kind'], caption: string, audience: 'all' | 'friends' = 'all'): Promise<Story> {
  const { fileId, url } = await uploadOwned(file);
  // «только друзьям»: права на чтение каждому другу выдаёт сервер
  if (audience === 'friends') return storyFromRow(await call<StoryRow>('post-story', { fileId, url, kind, caption }));
  const row = await api().db.createRow<StoryRow>({
    databaseId: DB,
    tableId: 'stories',
    rowId: ID.unique(),
    data: { authorId: myId!, fileId, url, kind, caption: caption.slice(0, 200), expiresAt: new Date(Date.now() + STORY_HOURS * 3_600_000).toISOString() },
    permissions: [Permission.read(Role.users()), Permission.delete(Role.user(myId!))],
  });
  return storyFromRow(row);
}

export async function deleteStory(story: Story) {
  await api().db.deleteRow({ databaseId: DB, tableId: 'stories', rowId: story.id }).catch(fail);
  await removeFile(story.fileId);
}

export async function postReel(file: File, caption: string): Promise<Reel> {
  const { fileId, url } = await uploadOwned(file);
  const row = await api().db.createRow<ReelRow>({
    databaseId: DB,
    tableId: 'reels',
    rowId: ID.unique(),
    data: { authorId: myId!, fileId, url, caption: caption.slice(0, 500) },
    permissions: [Permission.read(Role.users()), Permission.update(Role.user(myId!)), Permission.delete(Role.user(myId!))],
  });
  return reelFromRow(row, []);
}

export async function deleteReel(reel: Reel) {
  await api().db.deleteRow({ databaseId: DB, tableId: 'reels', rowId: reel.id }).catch(fail);
  await removeFile(reel.fileId);
}

export async function setLike(reelId: string, on: boolean) {
  try {
    if (on) {
      const row = await api().db.createRow({
        databaseId: DB,
        tableId: 'reelLikes',
        rowId: ID.unique(),
        data: { reelId, userId: myId },
        permissions: [Permission.read(Role.users()), Permission.delete(Role.user(myId!))],
      });
      myLikeRows.set(reelId, row.$id);
    } else {
      const rowId = myLikeRows.get(reelId);
      if (!rowId) return;
      myLikeRows.delete(reelId);
      await api().db.deleteRow({ databaseId: DB, tableId: 'reelLikes', rowId });
    }
  } catch (e) {
    if ((e as AppwriteException).code !== 409) fail(e);
  }
}

/* ---------- звонки в личке ---------- */

export async function startCall(userId: string, video: boolean): Promise<{ callId: string; dmId: string } | null> {
  const dmId = await ensureDm(userId);
  if (!dmId) return null;
  const row = await api().db.createRow({
    databaseId: DB,
    tableId: 'calls',
    rowId: ID.unique(),
    data: { dmId, fromId: myId, toId: R(userId), status: 'ringing', video },
    permissions: [Permission.read(Role.team(dmId)), Permission.update(Role.team(dmId))],
  });
  return { callId: row.$id, dmId };
}

export async function setCallStatus(callId: string, status: 'accepted' | 'declined' | 'ended' | 'missed' | 'busy') {
  await api().db.updateRow({ databaseId: DB, tableId: 'calls', rowId: callId, data: { status } }).catch(() => undefined);
}

/* ---------- группы ---------- */

export async function createGroup(name: string, userIds: string[]) {
  const { teamId } = await call<{ teamId: string }>('create-group', { name, userIds: userIds.map(R) });
  return teamId;
}
/** «Избранное»: создать (один раз) и вернуть id */
export const savedChat = () => call<{ teamId: string }>('saved-chat', {}).then((r) => r.teamId);
export const addToGroup = (groupId: string, userId: string) => call('group-add', { groupId, userId: R(userId) });
export const renameGroup = (groupId: string, name: string) => call('group-rename', { groupId, name });
export const leaveGroup = (groupId: string) => call('group-leave', { groupId });

export async function startGroupCall(groupId: string, video: boolean) {
  const row = await api().db.createRow({
    databaseId: DB,
    tableId: 'calls',
    rowId: ID.unique(),
    data: { dmId: groupId, fromId: myId, toId: '*', status: 'ringing', video },
    permissions: [Permission.read(Role.team(groupId)), Permission.update(Role.team(groupId))],
  });
  return row.$id;
}

/* ---------- модерация ---------- */

export const kick = (teamId: string, userId: string) => call('kick', { teamId, userId: R(userId) });
export const ban = (teamId: string, userId: string, reason = '') => call('ban', { teamId, userId: R(userId), reason });
export const unban = (teamId: string, userId: string) => call('unban', { teamId, userId });
export const mute = (teamId: string, userId: string, minutes: number) => call('mute', { teamId, userId: R(userId), minutes });
export const unmute = (teamId: string, userId: string) => call('unmute', { teamId, userId: R(userId) });
export const report = (messageId: string, reason: string) => call('report', { messageId, reason });
export const resolveReport = (reportId: string, action: 'dismiss' | 'delete' | 'mute' | 'ban', minutes?: number) => call('resolve-report', { reportId, decision: action, minutes });

export interface ReportView {
  id: string;
  messageId: string;
  chatId: string;
  reporterId: string;
  authorId: string;
  reason: string;
  text: string;
  ts: number;
}

export async function listReports(teamId: string): Promise<ReportView[]> {
  const { rows } = await api().db.listRows<Models.Row & Record<string, string>>({
    databaseId: DB,
    tableId: 'reports',
    queries: [Query.equal('teamId', teamId), Query.equal('status', 'open'), Query.orderDesc('$createdAt'), Query.limit(100)],
  });
  await ensureUsers(rows.flatMap((r) => [L(r.reporterId), L(r.authorId)]));
  return rows.map((r) => ({ id: r.$id, messageId: r.messageId, chatId: r.chatId, reporterId: L(r.reporterId), authorId: L(r.authorId), reason: r.reason, text: r.text, ts: Date.parse(r.$createdAt) }));
}

export async function listBans(teamId: string) {
  const { rows } = await api().db.listRows<Models.Row & Record<string, string>>({ databaseId: DB, tableId: 'bans', queries: [Query.equal('teamId', teamId), Query.limit(200)] });
  await ensureUsers(rows.map((r) => L(r.userId)));
  return rows.map((r) => ({ userId: r.userId, localId: L(r.userId), reason: r.reason }));
}

/* ---------- комментарии к видео ---------- */

export async function addComment(reelId: string, text: string) {
  await api().db.createRow({
    databaseId: DB,
    tableId: 'reelComments',
    rowId: ID.unique(),
    data: { reelId, authorId: myId, text: text.slice(0, 500) },
    permissions: [Permission.read(Role.users()), Permission.delete(Role.user(myId!))],
  });
}
export const deleteComment = (id: string) => api().db.deleteRow({ databaseId: DB, tableId: 'reelComments', rowId: id }).catch(fail);

/* ---------- поиск по истории на сервере ---------- */

export interface SearchHit {
  chatKey: string;
  msg: Message;
}

export async function searchMessages(q: string, chatId?: string): Promise<SearchHit[]> {
  const queries = [Query.search('text', q), Query.orderDesc('$createdAt'), Query.limit(50)];
  const db = chatId ? dbChatId(chatId) : undefined;
  if (db) queries.unshift(Query.equal('chatId', db));
  const { rows } = await api().db.listRows<MessageRow>({ databaseId: DB, tableId: 'messages', queries });
  noteBots(rows);
  await ensureUsers(rows.map((r) => L(r.authorId)));
  return rows.filter((r) => !e2e.isSealed(r.text)).map((r) => ({ chatKey: chatKeyOf(r.chatId), msg: messageFromRow(r) }));
}

/* ---------- push-подписки ---------- */

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 36);

export async function savePushSub(sub: PushSubscriptionJSON) {
  if (!sub.endpoint || !sub.keys) throw new Error('Браузер не выдал подписку');
  try {
    await api().db.createRow({
      databaseId: DB,
      tableId: 'pushSubs',
      rowId: await sha(sub.endpoint),
      data: { userId: myId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      permissions: [Permission.read(Role.user(myId!)), Permission.delete(Role.user(myId!))],
    });
  } catch (e) {
    if ((e as AppwriteException).code !== 409) throw e;
  }
}

export async function removePushSub(endpoint: string) {
  await api().db.deleteRow({ databaseId: DB, tableId: 'pushSubs', rowId: await sha(endpoint) }).catch(() => undefined);
}

/* ---------- ключи шифрования ---------- */

export const encryptionState = keys.e2eState;
export const onEncryptionChange = keys.onE2EChange;
export const restartEncryption = keys.rotate;

export interface DeviceView {
  id: string;
  name: string;
  ready: boolean;
  seen: number;
  current: boolean;
}

/** Мои устройства с доступом к зашифрованной переписке */
export async function encryptionDevices(): Promise<DeviceView[]> {
  const [rows, current] = await Promise.all([keys.myDevices(), keys.thisDeviceId()]);
  return rows.map((d) => ({ id: d.$id, name: d.name, ready: d.ready, seen: d.seen * 1000, current: d.$id === current })).sort((a, b) => Number(b.current) - Number(a.current) || b.seen - a.seen);
}
export const removeEncryptionDevice = keys.removeDevice;

/** Ключ шифрования группового звонка (или null — звонок без шифрования) */
export const groupCallKey = (groupId: string) => keys.groupCallKey(groupId, groupMembers(groupId)).catch(() => null);

/* ---------- каталог плагинов ---------- */

type CatalogRow = Models.Row & { name: string; version: string; description: string; authorId: string; kind: string; permissions: string; fileId: string; url: string };

export interface CatalogItem {
  id: string;
  name: string;
  version: string;
  description: string;
  authorId: string;
  kind: 'script' | 'theme';
  permissions: string[];
  url: string;
  rating: number;
  votes: number;
  installs: number;
  myStars: number;
  mine: boolean;
  ts: number;
}

export async function loadCatalog(): Promise<CatalogItem[]> {
  const items = (await api().db.listRows<CatalogRow>({ databaseId: DB, tableId: 'catalog', queries: [Query.orderDesc('$updatedAt'), Query.limit(100)] })).rows;
  const ids = items.map((i) => i.$id);
  const [ratings, installs] = ids.length
    ? await Promise.all([
        api().db.listRows<Models.Row & { pluginId: string; userId: string; stars: number }>({ databaseId: DB, tableId: 'catalogRatings', queries: [Query.equal('pluginId', ids), Query.limit(5000)] }),
        api().db.listRows<Models.Row & { pluginId: string; userId: string }>({ databaseId: DB, tableId: 'catalogInstalls', queries: [Query.equal('pluginId', ids), Query.limit(5000)] }),
      ])
    : [{ rows: [] }, { rows: [] }];
  await ensureUsers(items.map((i) => L(i.authorId)));
  return items.map((i) => {
    const rs = ratings.rows.filter((r) => r.pluginId === i.$id);
    return {
      id: i.$id,
      name: i.name,
      version: i.version,
      description: i.description,
      authorId: L(i.authorId),
      kind: i.kind === 'theme' ? 'theme' : 'script',
      permissions: i.permissions ? i.permissions.split(',') : [],
      url: i.url,
      rating: rs.length ? rs.reduce((a, r) => a + r.stars, 0) / rs.length : 0,
      votes: rs.length,
      installs: installs.rows.filter((r) => r.pluginId === i.$id).length,
      myStars: rs.find((r) => r.userId === myId)?.stars ?? 0,
      mine: i.authorId === myId,
      ts: Date.parse(i.$updatedAt),
    };
  });
}

/** Опубликовать (или обновить свой) плагин. Код лежит файлом в хранилище. */
export async function publishPlugin(p: { name: string; version: string; description: string; kind: string; permissions: string[]; code: string; fileName: string }) {
  const file = new File([p.code], p.fileName, { type: p.kind === 'theme' ? 'text/css' : 'text/javascript' });
  const { fileId, url } = await uploadOwned(file);
  const data = { name: p.name, version: p.version, description: p.description, authorId: myId!, kind: p.kind, permissions: p.permissions.join(','), fileId, url };
  const mine = (await api().db.listRows<CatalogRow>({ databaseId: DB, tableId: 'catalog', queries: [Query.equal('authorId', myId!), Query.equal('name', p.name)] })).rows[0];
  if (mine) {
    await api().db.updateRow({ databaseId: DB, tableId: 'catalog', rowId: mine.$id, data });
    await removeFile(mine.fileId);
  } else
    await api().db.createRow({
      databaseId: DB,
      tableId: 'catalog',
      rowId: ID.unique(),
      data,
      permissions: [Permission.read(Role.users()), Permission.update(Role.user(myId!)), Permission.delete(Role.user(myId!))],
    });
}

export async function unpublishPlugin(id: string) {
  const row = await api().db.getRow<CatalogRow>({ databaseId: DB, tableId: 'catalog', rowId: id });
  await api().db.deleteRow({ databaseId: DB, tableId: 'catalog', rowId: id });
  await removeFile(row.fileId);
}

export async function fetchPluginCode(item: CatalogItem) {
  const r = await fetch(item.url);
  if (!r.ok) throw new Error('Не удалось скачать плагин');
  const code = await r.text();
  // засчитываем установку (по одной от человека)
  await api()
    .db.createRow({ databaseId: DB, tableId: 'catalogInstalls', rowId: ID.unique(), data: { pluginId: item.id, userId: myId }, permissions: [Permission.read(Role.users()), Permission.delete(Role.user(myId!))] })
    .catch(() => undefined);
  return code;
}

export async function ratePlugin(id: string, stars: number) {
  const mine = (await api().db.listRows<Models.Row & { stars: number }>({ databaseId: DB, tableId: 'catalogRatings', queries: [Query.equal('pluginId', id), Query.equal('userId', myId!)] })).rows[0];
  if (mine) await api().db.updateRow({ databaseId: DB, tableId: 'catalogRatings', rowId: mine.$id, data: { stars } });
  else
    await api().db.createRow({
      databaseId: DB,
      tableId: 'catalogRatings',
      rowId: ID.unique(),
      data: { pluginId: id, userId: myId, stars },
      permissions: [Permission.read(Role.users()), Permission.update(Role.user(myId!)), Permission.delete(Role.user(myId!))],
    });
}

/* ---------- вебхуки и боты сообщества ---------- */

export interface WebhookInfo {
  id: string;
  roomId: string;
  name: string;
  outUrl: string;
  createdAt: string;
}

/** Адрес функции fizion-events для входящих вебхуков (его записывает npm run setup) */
export const HOOKS_URL = (import.meta.env.VITE_HOOKS_URL ?? '').trim();
export const webhookUrl = (id: string, token: string) => (HOOKS_URL ? `${HOOKS_URL.replace(/\/?$/, '/')}?id=${id}&token=${token}` : '');
export const listWebhooks = (teamId: string) => call<{ hooks: WebhookInfo[] }>('webhook-list', { teamId }).then((r) => r.hooks);
export const createWebhook = (teamId: string, roomId: string, name: string, outUrl: string) => call<{ id: string; token: string }>('webhook-create', { teamId, roomId, name, outUrl });
export const resetWebhook = (id: string) => call<{ id: string; token: string }>('webhook-reset', { id });
export const deleteWebhook = (id: string) => call('webhook-delete', { id });
