// Ключи шифрования на сервере Appwrite: всё происходит само, человеку ничего делать не нужно.
//
//  keys       — открытый ключ человека (строка с id человека, видна всем)
//  devices    — устройства человека (видит только он сам): нужны, чтобы перенести ключ на новое
//  keyshares  — зашифрованный пакет с ключом для конкретного нового устройства (видит только он сам)
//  groupkeys  — ключ группы, упакованный для каждого участника (видят участники группы)

import { AppwriteException, ID, Permission, Query, Role, type Models } from 'appwrite';
import { aw, DB } from '../lib/appwrite';
import { IS_DESKTOP_APP, IS_TAURI, isTouch } from '../lib/platform';
import * as e2e from './crypto';

type Row<T> = Models.Row & T;
type KeyRow = Row<{ publicKey: string; encPrivate: string; salt: string; iv: string }>;
type DeviceRow = Row<{ userId: string; publicKey: string; name: string; ready: boolean; seen: number }>;
type ShareRow = Row<{ deviceId: string; userId: string; epk: string; iv: string; ct: string }>;
type GroupKeyDbRow = Row<{ groupId: string; keyId: string; userId: string; by: string; iv: string; ct: string }>;

/** off — онлайн не запущен; ready — всё шифруется; waiting — ключ переносится с другого устройства */
export type E2EState = 'off' | 'ready' | 'waiting';

const api = () => aw!;
let userId: string | null = null;
let state: E2EState = 'off';
let callFn: (action: string, payload: Record<string, unknown>) => Promise<unknown> = async () => undefined;
let onUnlocked: () => void = () => undefined;
const listeners = new Set<() => void>();

export const e2eState = () => state;
export const onE2EChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
function setE2E(s: E2EState) {
  state = s;
  listeners.forEach((fn) => fn());
}

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);
const deviceName = () => {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Linux';
  const app = IS_DESKTOP_APP ? 'приложение' : IS_TAURI ? 'приложение' : /Edg\//.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox' : /Chrome/.test(ua) ? 'Chrome' : 'Safari';
  return `${os} · ${app}${isTouch() && !IS_TAURI ? ' (телефон)' : ''}`;
};

const getRow = <T>(tableId: string, rowId: string) =>
  api()
    .db.getRow<Row<T>>({ databaseId: DB, tableId, rowId })
    .catch((e: AppwriteException) => (e.code === 404 ? null : Promise.reject(e)));

const mine = (id: string) => [Permission.read(Role.user(id)), Permission.update(Role.user(id)), Permission.delete(Role.user(id))];

/* ===================== запуск ===================== */

/**
 * Включить шифрование при входе. Ключ создаётся сам при первом входе, на новых устройствах —
 * переносится с других устройств этого человека. Ничего спрашивать не нужно.
 */
export async function initE2E(id: string, call: typeof callFn, unlocked: () => void) {
  userId = id;
  callFn = call;
  onUnlocked = unlocked;
  const row = await getRow<KeyRow>('keys', id);
  const local = await e2e.loadLocal(id);

  if (!row) {
    // первый вход: создаём ключ
    const pub = await e2e.createIdentity(id);
    await callFn('set-key', { publicKey: pub });
    return finishReady();
  }
  if (local && e2e.myPublicKey() === row.publicKey) return finishReady();

  // ключ уже есть на других устройствах — просим перенести
  const dev = await e2e.thisDevice(id);
  await saveDevice(dev, false);
  if (await takeShare(row.publicKey)) return;
  const others = (await myDevices()).filter((d) => d.$id !== dev.deviceId && d.ready && d.seen > now() - 30 * DAY);
  if (!others.length) {
    // других устройств, откуда можно взять ключ, нет (например, почистили браузер) — начинаем с новым ключом
    await rotate();
    return;
  }
  setE2E('waiting');
}

async function finishReady() {
  const dev = await e2e.thisDevice(userId!);
  await saveDevice(dev, true).catch(() => undefined);
  setE2E('ready');
  await serveDevices().catch(() => undefined);
}

/** Создать новый ключ (старые зашифрованные сообщения на этом устройстве прочитать будет нельзя) */
export async function rotate() {
  const pub = await e2e.createIdentity(userId!);
  await callFn('set-key', { publicKey: pub, rotate: true });
  await finishReady();
  onUnlocked();
}

export function stopE2E() {
  userId = null;
  e2e.forget();
  e2e.forgetDevice();
  groupRows.clear();
  setE2E('off');
}

/* ===================== устройства ===================== */

async function saveDevice(dev: e2e.DeviceInfo, ready: boolean) {
  const data = { userId: userId!, publicKey: dev.publicKey, name: deviceName(), ready, seen: now() };
  try {
    await api().db.updateRow({ databaseId: DB, tableId: 'devices', rowId: dev.deviceId, data });
  } catch (e) {
    if ((e as AppwriteException).code !== 404) throw e;
    await api().db.createRow({ databaseId: DB, tableId: 'devices', rowId: dev.deviceId, data, permissions: mine(userId!) });
  }
}

export async function myDevices(): Promise<DeviceRow[]> {
  if (!userId) return [];
  const r = await api().db.listRows<DeviceRow>({ databaseId: DB, tableId: 'devices', queries: [Query.equal('userId', userId), Query.limit(50)] });
  return r.rows;
}

export const thisDeviceId = async () => (userId ? (await e2e.thisDevice(userId)).deviceId : null);

/** Убрать устройство из списка (оно больше не получит ключ) */
export async function removeDevice(deviceId: string) {
  await api().db.deleteRow({ databaseId: DB, tableId: 'devices', rowId: deviceId });
}

/** Это устройство с ключом: отправить ключ новым устройствам этого же человека */
async function serveDevices() {
  if (state !== 'ready' || !userId) return;
  for (const d of await myDevices()) {
    if (d.ready || d.seen < now() - 7 * DAY) continue;
    await shareTo(d);
  }
}

async function shareTo(d: DeviceRow) {
  if (await getRow<ShareRow>('keyshares', d.$id)) return;
  const pack = await e2e.shareKeyWith(d.publicKey);
  if (!pack) return;
  await api()
    .db.createRow({ databaseId: DB, tableId: 'keyshares', rowId: d.$id, data: { deviceId: d.$id, userId: userId!, ...pack }, permissions: mine(userId!) })
    .catch((e: AppwriteException) => (e.code === 409 ? undefined : Promise.reject(e)));
}

/** Новое устройство: забрать пакет с ключом, если он уже пришёл */
async function takeShare(expectedPub: string) {
  const dev = await e2e.thisDevice(userId!);
  const share = await getRow<ShareRow>('keyshares', dev.deviceId);
  if (!share) return false;
  const ok = await e2e.acceptShare(userId!, share, expectedPub);
  await api().db.deleteRow({ databaseId: DB, tableId: 'keyshares', rowId: dev.deviceId }).catch(() => undefined);
  if (!ok) return false;
  await finishReady();
  onUnlocked();
  return true;
}

/* ===================== события realtime ===================== */

export async function onDeviceEvent(row: DeviceRow) {
  if (row.userId === userId && !row.ready && state === 'ready') await shareTo(row).catch(() => undefined);
}

export async function onShareEvent(row: ShareRow, kind: string) {
  if (kind === 'delete' || state === 'ready' || !userId) return;
  const dev = await e2e.thisDevice(userId);
  if (row.$id !== dev.deviceId) return;
  const key = await getRow<KeyRow>('keys', userId);
  if (key) await takeShare(key.publicKey);
}

export async function onKeyEvent(row: KeyRow) {
  e2e.refreshPeer(row.$id);
  // человек сменил ключ на другом устройстве — здесь старый ключ больше не годится
  if (row.$id === userId && state === 'ready' && e2e.myPublicKey() !== row.publicKey) {
    e2e.forget();
    const dev = await e2e.thisDevice(userId);
    await saveDevice(dev, false).catch(() => undefined);
    setE2E('waiting');
    await takeShare(row.publicKey).catch(() => false);
  }
}

/* ===================== ключи групп ===================== */

const groupRows = new Map<string, Promise<e2e.GroupKeyRow[]>>();

const toGroupRow = (r: GroupKeyDbRow): e2e.GroupKeyRow => ({ keyId: r.keyId, userId: r.userId, by: r.by, iv: r.iv, ct: r.ct, ts: Date.parse(r.$createdAt) });

export function groupKeyRows(groupId: string, fresh = false): Promise<e2e.GroupKeyRow[]> {
  if (fresh || !groupRows.has(groupId)) {
    const p = api()
      .db.listRows<GroupKeyDbRow>({ databaseId: DB, tableId: 'groupkeys', queries: [Query.equal('groupId', groupId), Query.orderDesc('$createdAt'), Query.limit(500)] })
      .then((r) => r.rows.map(toGroupRow))
      .catch(() => [] as e2e.GroupKeyRow[]);
    groupRows.set(groupId, p);
  }
  return groupRows.get(groupId)!;
}

export const onGroupKeyEvent = (row: GroupKeyDbRow) => groupRows.delete(row.groupId);

async function addRows(groupId: string, keyId: string, raw: ArrayBuffer, members: string[]) {
  for (const m of members) {
    const packed = await e2e.wrapGroupKeyFor(m, raw);
    if (!packed) continue;
    await api().db.createRow({
      databaseId: DB,
      tableId: 'groupkeys',
      rowId: ID.unique(),
      data: { groupId, keyId, userId: m, by: userId!, ...packed },
      permissions: [Permission.read(Role.team(groupId)), Permission.delete(Role.user(userId!))],
    });
  }
}

/**
 * Текущий ключ группы для отправки. Если кто-то из участников ещё без ключа — докладываем ему;
 * если в ключе есть ушедшие участники — создаём новый. null — шифровать нельзя
 * (у кого-то из участников ещё нет ключа — он на старой версии).
 */
async function currentGroupKey(groupId: string, members: string[]): Promise<{ keyId: string; rows: e2e.GroupKeyRow[] } | null> {
  if (state !== 'ready' || !userId) return null;
  for (const m of members) if (!(await e2e.peerPublicKey(m)) && m !== userId) return null;
  let rows = await groupKeyRows(groupId);
  const latest = rows.find((r) => r.userId === userId);
  if (latest) {
    const holders = new Set(rows.filter((r) => r.keyId === latest.keyId).map((r) => r.userId));
    const left = [...holders].some((h) => !members.includes(h));
    if (!left) {
      const missing = members.filter((m) => !holders.has(m));
      if (missing.length) {
        const raw = await groupRawFor(groupId, latest.keyId, rows);
        if (raw) {
          await addRows(groupId, latest.keyId, raw, missing).catch(() => undefined);
          rows = await groupKeyRows(groupId, true);
        }
      }
      return { keyId: latest.keyId, rows };
    }
  }
  const { keyId, raw } = e2e.newGroupKey(groupId);
  await addRows(groupId, keyId, raw, members);
  rows = await groupKeyRows(groupId, true);
  return { keyId, rows };
}

/** Сырой ключ группы (нужен, чтобы доложить его новому участнику) */
const groupRawFor = (groupId: string, keyId: string, rows: e2e.GroupKeyRow[]) => e2e.groupKeyRaw(groupId, keyId, rows);

/* ===================== что вызывают остальные части ===================== */

export async function sealDm(peerId: string, body: e2e.SealedBody): Promise<string | null> {
  if (state !== 'ready') return null;
  return e2e.encryptFor(peerId, body).catch(() => null);
}

export async function sealGroup(groupId: string, members: string[], body: e2e.SealedBody): Promise<string | null> {
  const cur = await currentGroupKey(groupId, members).catch(() => null);
  if (!cur) return null;
  return e2e.encryptForGroup(groupId, cur.keyId, cur.rows, body).catch(() => null);
}

export async function openGroup(groupId: string, payload: string): Promise<e2e.SealedBody | null> {
  let res = await e2e.decryptGroup(groupId, payload, await groupKeyRows(groupId));
  if (res === null && state === 'ready') res = await e2e.decryptGroup(groupId, payload, await groupKeyRows(groupId, true)); // ключ мог прийти только что
  return res;
}

/** Можно ли зашифровать этот чат прямо сейчас (для файлов: шифровать ли их) */
export async function canSeal(kind: 'dm' | 'group', ids: string[]): Promise<boolean> {
  if (state !== 'ready') return false;
  for (const m of ids) if (m !== userId && !(await e2e.peerPublicKey(m))) return false;
  return kind === 'dm' || ids.length > 0;
}

export async function groupCallKey(groupId: string, members: string[]) {
  const cur = await currentGroupKey(groupId, members).catch(() => null);
  if (!cur) return null;
  return e2e.groupCallKey(groupId, cur.keyId, cur.rows);
}
