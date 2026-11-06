// «Смотреть вместе»: одно видео на весь чат, у всех на одной секунде.
// На сервере — одна строка таблицы watch на чат: что смотрим, идёт или пауза, с какой секунды и когда это было.
// Кто-то нажал паузу или перемотал — строка обновилась, у остальных плеер подстроился (realtime).
// В личных и группах ссылка и название зашифрованы, как сообщения.

import { AppwriteException, Permission, Role, type Models } from 'appwrite';
import { ME } from '../data';
import { aw, DB, ONLINE } from '../lib/appwrite';
import type { WatchKind } from '../lib/players';
import { sealText } from './remote';
import { chatKeyOf, dbChatId, L, myId, openText, teamOfChat } from './sync';

export interface WatchSession {
  chatId: string;
  kind: WatchKind;
  /** id ролика, адрес файла или (для своего файла) его имя */
  src: string;
  title: string;
  /** размер своего файла — чтобы у друга был тот же */
  size?: number;
  playing: boolean;
  /** секунда видео в момент `at` */
  pos: number;
  /** когда это состояние задано (мс) */
  at: number;
  by: string;
}

type WatchRow = Models.Row & { teamId: string; chatId: string; data: string; playing: boolean; pos: number; at: number; by: string };

const sessions = new Map<string, WatchSession>();
const listeners = new Set<() => void>();
const lastSent = new Map<string, number>();
const emit = () => listeners.forEach((fn) => fn());

export const getWatch = (chatId: string) => sessions.get(chatId);
export const onWatch = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** На какой секунде видео должно быть прямо сейчас */
export const expectedTime = (s: WatchSession) => (s.playing ? s.pos + (Date.now() - s.at) / 1000 : s.pos);

function set(chatId: string, s: WatchSession | null) {
  if (s) sessions.set(chatId, s);
  else sessions.delete(chatId);
  emit();
}

const api = () => aw!;

async function fromRow(row: WatchRow): Promise<WatchSession | null> {
  const chatId = chatKeyOf(row.chatId);
  const text = await openText(chatId, row.data);
  if (text === null) return null;
  try {
    const d = JSON.parse(text) as { kind: WatchKind; src: string; title: string; size?: number };
    return { chatId, kind: d.kind, src: d.src, title: d.title, size: d.size, playing: !!row.playing, pos: (row.pos ?? 0) / 1000, at: row.at || Date.parse(row.$updatedAt), by: L(row.by) };
  } catch {
    return null;
  }
}

/** Узнать, смотрят ли что-то в этом чате (при открытии чата) */
export async function loadWatch(chatId: string) {
  if (!ONLINE || !aw) return;
  const id = dbChatId(chatId);
  if (!id) return;
  const row = await api()
    .db.getRow<WatchRow>({ databaseId: DB, tableId: 'watch', rowId: id })
    .catch((e: AppwriteException) => (e.code === 404 ? null : Promise.reject(e)))
    .catch(() => null);
  const s = row ? await fromRow(row) : null;
  set(chatId, s);
}

export async function onWatchRow(row: WatchRow, kind: 'create' | 'update' | 'delete') {
  const chatId = chatKeyOf(row.chatId);
  if (kind === 'delete') return set(chatId, null);
  if (row.by === myId && lastSent.get(chatId) === row.at) return; // это наше же изменение
  const s = await fromRow(row);
  if (s) set(chatId, s);
}

async function write(chatId: string, s: WatchSession, fresh: boolean) {
  lastSent.set(chatId, s.at);
  if (!ONLINE || !aw) return;
  const id = dbChatId(chatId);
  const team = teamOfChat(chatId);
  if (!id || !team) return;
  const state = { playing: s.playing, pos: Math.round(s.pos * 1000), at: s.at, by: myId! };
  if (!fresh) {
    try {
      await api().db.updateRow({ databaseId: DB, tableId: 'watch', rowId: id, data: state });
      return;
    } catch (e) {
      if ((e as AppwriteException).code !== 404) throw e;
    }
  }
  const data = await sealText(chatId, JSON.stringify({ kind: s.kind, src: s.src, title: s.title, size: s.size }));
  const row = { teamId: team, chatId: id, data, ...state };
  try {
    await api().db.createRow({
      databaseId: DB,
      tableId: 'watch',
      rowId: id,
      data: row,
      permissions: [Permission.read(Role.team(team)), Permission.update(Role.team(team)), Permission.delete(Role.team(team))],
    });
  } catch (e) {
    if ((e as AppwriteException).code !== 409) throw e;
    await api().db.updateRow({ databaseId: DB, tableId: 'watch', rowId: id, data: row });
  }
}

/** Включить видео в чате (заменяет то, что смотрели) */
export async function startWatch(chatId: string, v: { kind: WatchKind; src: string; title: string; size?: number; start?: number }) {
  const s: WatchSession = { chatId, kind: v.kind, src: v.src, title: v.title.slice(0, 120), size: v.size, playing: false, pos: v.start ?? 0, at: Date.now(), by: ME };
  set(chatId, s);
  await write(chatId, s, true);
}

/** Я нажал запуск/паузу/перемотал — сообщить остальным */
export async function pushWatch(chatId: string, state: { playing: boolean; pos: number }) {
  const cur = sessions.get(chatId);
  if (!cur) return;
  const s = { ...cur, ...state, at: Date.now(), by: ME };
  set(chatId, s);
  await write(chatId, s, false).catch(() => undefined);
}

/** Выключить для всех */
export async function stopWatch(chatId: string) {
  set(chatId, null);
  if (!ONLINE || !aw) return;
  const id = dbChatId(chatId);
  if (id) await api().db.deleteRow({ databaseId: DB, tableId: 'watch', rowId: id }).catch(() => undefined);
}

export function resetWatch() {
  sessions.clear();
  lastSent.clear();
  emit();
}
