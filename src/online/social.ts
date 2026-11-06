// Привычные мелочи мессенджера: «печатает…», «прочитано» ✓✓, закреплённые сообщения и блокировка.
//  - «печатает» едет в присутствии (presence): какой чат и когда — гаснет само через несколько секунд;
//  - «прочитано» — строка таблицы reads на пару «чат + человек»: до какого момента он дочитал;
//  - закреп — таблица pins (закрепляет сервер: в сообществах это могут только модераторы);
//  - блокировка — таблица blocks; сервер не даёт заблокированному написать, позвонить и добавиться.

import { AppwriteException, Permission, Query, Role, type Models } from 'appwrite';
import { ME } from '../data';
import { aw, DB, ONLINE } from '../lib/appwrite';
import { setState } from '../store';
import { call, chatKeyOf, dbChatId, errorText, L, myId, R, teamOfChat, toast, trackMe } from './sync';

type Row<T> = Models.Row & T;
type ReadRow = Row<{ chatId: string; teamId: string; userId: string; ts: number }>;
type PinRow = Row<{ chatId: string; teamId: string; messageId: string; by: string }>;
type BlockRow = Row<{ by: string; userId: string }>;

const api = () => aw!;
let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  listeners.forEach((fn) => fn());
};
export const onSocial = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const socialVersion = () => version;

/** Чаты, где есть «печатает» и «прочитано»: личные и группы (в сообществах слишком много людей) */
const isPrivate = (chatId: string) => chatId.startsWith('dm:') || chatId.startsWith('g:');

/* ===================== печатает… ===================== */

const typing = new Map<string, Map<string, number>>(); // чат → человек → до какого момента показывать
let mine: { c: string; t: number } | null = null;

/** Что положить в своё присутствие */
export const typingMeta = () => (mine && Date.now() - mine.t < 6000 ? mine : null);

/** Я набираю текст в этом чате (зовётся на каждое нажатие — отправляем не чаще раза в 3 секунды) */
export function iAmTyping(chatId: string) {
  if (!ONLINE || !isPrivate(chatId)) return;
  const c = dbChatId(chatId);
  if (!c) return;
  const now = Date.now();
  if (mine?.c === c && now - mine.t < 3000) return;
  mine = { c, t: now };
  void trackMe();
}

export function stoppedTyping() {
  if (!mine) return;
  mine = null;
  void trackMe();
}

/** Из присутствия собеседника: печатает ли он и где */
export function onPresenceTyping(userId: string, meta: { c?: string; t?: number } | null | undefined) {
  const who = L(userId);
  if (who === ME) return;
  let changed = false;
  for (const m of typing.values()) if (m.delete(who)) changed = true;
  if (meta?.c && meta.t && Date.now() - meta.t < 8000) {
    const key = chatKeyOf(meta.c);
    if (!typing.has(key)) typing.set(key, new Map());
    typing.get(key)!.set(who, Date.now() + 6000);
    changed = true;
  }
  if (changed) bump();
}

/** Пришло сообщение — значит, уже не печатает */
export function clearTyping(chatId: string, who: string) {
  if (typing.get(chatId)?.delete(who)) bump();
}

export const typingIn = (chatId: string) => [...(typing.get(chatId) ?? new Map<string, number>()).entries()].filter(([, until]) => until > Date.now()).map(([id]) => id);

// «печатает» гаснет само
if (typeof window !== 'undefined')
  window.setInterval(() => {
    let changed = false;
    for (const m of typing.values())
      for (const [id, until] of m)
        if (until < Date.now()) {
          m.delete(id);
          changed = true;
        }
    if (changed) bump();
  }, 2000);

/* ===================== прочитано ===================== */

const reads = new Map<string, Map<string, number>>(); // чат → человек → до какого момента прочитал
const sentRead = new Map<string, number>();
const readTimers = new Map<string, number>();

const readRowId = async (db: string, uid: string) => {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${db}|${uid}`)));
  return 'r' + Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 35);
};

function setRead(chatId: string, who: string, ts: number) {
  if (!reads.has(chatId)) reads.set(chatId, new Map());
  const m = reads.get(chatId)!;
  if ((m.get(who) ?? 0) >= ts) return;
  m.set(who, ts);
  bump();
}

/** До какого момента мои сообщения прочитаны кем-то из собеседников */
export function readUpTo(chatId: string): number {
  let max = 0;
  for (const [who, ts] of reads.get(chatId) ?? []) if (who !== ME && ts > max) max = ts;
  return max;
}
/** Сколько человек прочитали сообщение (для групп) */
export const readCount = (chatId: string, ts: number) => [...(reads.get(chatId) ?? [])].filter(([who, t]) => who !== ME && t >= ts).length;

export async function loadReads(chatId: string) {
  if (!ONLINE || !aw || !isPrivate(chatId)) return;
  const db = dbChatId(chatId);
  if (!db) return;
  const r = await api()
    .db.listRows<ReadRow>({ databaseId: DB, tableId: 'reads', queries: [Query.equal('chatId', db), Query.limit(100)] })
    .catch(() => null);
  r?.rows.forEach((x) => setRead(chatId, L(x.userId), x.ts));
}

export function onReadRow(row: ReadRow) {
  setRead(chatKeyOf(row.chatId), L(row.userId), row.ts);
}

/** Я дочитал чат до этого момента (вызывается, когда чат открыт и окно на экране) */
export function markRead(chatId: string, ts: number) {
  if (!ONLINE || !aw || !isPrivate(chatId) || !myId) return;
  if ((sentRead.get(chatId) ?? 0) >= ts) return;
  sentRead.set(chatId, ts);
  setRead(chatId, ME, ts);
  window.clearTimeout(readTimers.get(chatId));
  readTimers.set(
    chatId,
    window.setTimeout(() => void saveRead(chatId, ts), 1200),
  );
}

async function saveRead(chatId: string, ts: number) {
  const db = dbChatId(chatId);
  const team = teamOfChat(chatId);
  if (!db || !team || !myId) return;
  const rowId = await readRowId(db, myId);
  const data = { chatId: db, teamId: team, userId: myId, ts };
  try {
    await api().db.updateRow({ databaseId: DB, tableId: 'reads', rowId, data: { ts } });
  } catch (e) {
    if ((e as AppwriteException).code !== 404) return;
    await api()
      .db.createRow({
        databaseId: DB,
        tableId: 'reads',
        rowId,
        data,
        permissions: [Permission.read(Role.team(team)), Permission.update(Role.user(myId)), Permission.delete(Role.user(myId))],
      })
      .catch(() => undefined);
  }
}

/* ===================== закреплённые ===================== */

const pins = new Map<string, string[]>(); // чат → id сообщений (старые → новые)

export const pinsOf = (chatId: string) => pins.get(chatId) ?? [];

function setPin(chatId: string, messageId: string, on: boolean) {
  const l = (pins.get(chatId) ?? []).filter((x) => x !== messageId);
  pins.set(chatId, on ? [...l, messageId] : l);
  bump();
}

export async function loadPins(chatId: string) {
  if (!ONLINE || !aw) return;
  const db = dbChatId(chatId);
  if (!db) return;
  const r = await api()
    .db.listRows<PinRow>({ databaseId: DB, tableId: 'pins', queries: [Query.equal('chatId', db), Query.orderAsc('$createdAt'), Query.limit(50)] })
    .catch(() => null);
  if (!r) return;
  pins.set(
    chatId,
    r.rows.map((x) => x.messageId),
  );
  bump();
}

export function onPinRow(row: PinRow, kind: string) {
  setPin(chatKeyOf(row.chatId), row.messageId, kind !== 'delete');
}

export async function pin(chatId: string, messageId: string, on: boolean) {
  setPin(chatId, messageId, on);
  if (!ONLINE) return;
  try {
    await call('pin', { messageId, on });
  } catch (e) {
    setPin(chatId, messageId, !on);
    toast(errorText(e));
  }
}

/* ===================== блокировка ===================== */

let blocked = new Set<string>();
export const isBlocked = (userId: string) => blocked.has(userId);
export const blockedList = () => [...blocked];

export async function loadBlocks() {
  if (!ONLINE || !aw || !myId) return;
  const r = await api()
    .db.listRows<BlockRow>({ databaseId: DB, tableId: 'blocks', queries: [Query.equal('by', myId), Query.limit(500)] })
    .catch(() => null);
  blocked = new Set((r?.rows ?? []).map((x) => L(x.userId)));
  bump();
}

export async function block(userId: string) {
  blocked.add(userId);
  setState((s) => ({ friends: s.friends.filter((f) => f !== userId), pending: s.pending.filter((p) => p !== userId) }));
  bump();
  if (!ONLINE) return;
  try {
    await call('block', { userId: R(userId) });
  } catch (e) {
    blocked.delete(userId);
    bump();
    toast(errorText(e));
  }
}

export async function unblock(userId: string) {
  blocked.delete(userId);
  bump();
  if (!ONLINE) return;
  await call('unblock', { userId: R(userId) }).catch((e) => toast(errorText(e)));
}

/* ===================== сцена: поднятые руки и право говорить ===================== */

const hands = new Map<string, Set<string>>(); // комната → кто поднял руку
let myHand = false;
let canSpeak = true;

export const handUp = () => myHand;
export const mayISpeak = () => canSpeak;
export const handsIn = (roomId: string) => [...(hands.get(roomId) ?? [])];

/** Поднять или опустить руку (видят модераторы сцены) */
export function setHand(on: boolean) {
  myHand = on;
  bump();
  void trackMe();
}

export function setCanSpeak(on: boolean) {
  if (canSpeak === on) return;
  canSpeak = on;
  if (on) myHand = false;
  bump();
}

export function onPresenceHand(userId: string, roomId: string | null | undefined, hand: boolean) {
  const who = L(userId);
  let changed = false;
  for (const set of hands.values()) if (set.delete(who)) changed = true;
  if (roomId && hand) {
    if (!hands.has(roomId)) hands.set(roomId, new Set());
    hands.get(roomId)!.add(who);
    changed = true;
  }
  if (changed) bump();
}

/** Модератор: дать слово или убрать со сцены */
export async function setSpeaker(roomId: string, userId: string, on: boolean) {
  await call('stage-speaker', { roomId, userId: R(userId), on }).catch((e) => toast(errorText(e)));
}

/* ===================== огоньки дружбы ===================== */

const streaks = new Map<string, { n: number; day: string }>();
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function setStreak(userId: string, n: number, day: string) {
  const old = streaks.get(userId);
  if (old && old.n === n && old.day === day) return;
  streaks.set(userId, { n, day });
  bump();
}

/** Сколько дней подряд вы переписываетесь (0 — серии нет). danger — сегодня ещё не писали оба, серия сгорит завтра. */
export function streakWith(userId: string): { n: number; danger: boolean } {
  const s = streaks.get(userId);
  if (!s || s.n < 2) return { n: 0, danger: false };
  const today = utcDay(Date.now());
  const yesterday = utcDay(Date.now() - 86_400_000);
  if (s.day === today) return { n: s.n, danger: false };
  if (s.day === yesterday) return { n: s.n, danger: true };
  return { n: 0, danger: false };
}

export function resetSocial() {
  typing.clear();
  reads.clear();
  sentRead.clear();
  pins.clear();
  blocked = new Set();
  mine = null;
  hands.clear();
  streaks.clear();
  myHand = false;
  canSpeak = true;
  bump();
}

/** Удалить аккаунт насовсем */
export async function deleteAccount(confirmWord: string) {
  await call('delete-account', { confirm: confirmWord });
}

