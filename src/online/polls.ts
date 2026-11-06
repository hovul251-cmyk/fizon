// Опросы в чатах: сам опрос едет внутри сообщения (в личных и группах — зашифрованным),
// голоса — строки таблицы votes «сообщение + человек → выбор». Переголосовать можно в любой момент.

import { AppwriteException, Permission, Query, Role, type Models } from 'appwrite';
import { ME } from '../data';
import { aw, DB, ONLINE } from '../lib/appwrite';
import { L, myId, teamOfChat } from './sync';

type VoteRow = Models.Row & { messageId: string; teamId: string; userId: string; choice: string };

const votes = new Map<string, Map<string, number[]>>(); // сообщение → человек → выбранные варианты
const loaded = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  listeners.forEach((fn) => fn());
};
export const onPolls = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const pollsVersion = () => version;

const parseChoice = (s: string) =>
  s
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < 20);

function setVote(messageId: string, who: string, choice: number[]) {
  if (!votes.has(messageId)) votes.set(messageId, new Map());
  const m = votes.get(messageId)!;
  if (choice.length) m.set(who, choice);
  else m.delete(who);
  bump();
}

export const votesOf = (messageId: string) => votes.get(messageId) ?? new Map<string, number[]>();

/** Подгрузить голоса для опросов, которые сейчас на экране */
export async function loadVotes(messageIds: string[]) {
  const need = messageIds.filter((id) => !loaded.has(id));
  if (!need.length || !ONLINE || !aw) return;
  need.forEach((id) => loaded.add(id));
  const r = await aw.db.listRows<VoteRow>({ databaseId: DB, tableId: 'votes', queries: [Query.equal('messageId', need.slice(0, 100)), Query.limit(1000)] }).catch(() => null);
  r?.rows.forEach((v) => setVote(v.messageId, L(v.userId), parseChoice(v.choice)));
}

export function onVoteRow(row: VoteRow, kind: string) {
  setVote(row.messageId, L(row.userId), kind === 'delete' ? [] : parseChoice(row.choice));
}

const voteRowId = async (messageId: string, uid: string) => {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${messageId}|${uid}`)));
  return 'v' + Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 35);
};

/** Проголосовать (пустой выбор — отозвать голос) */
export async function vote(chatId: string, messageId: string, choice: number[]) {
  setVote(messageId, ME, choice);
  if (!ONLINE || !aw || !myId) return;
  const rowId = await voteRowId(messageId, myId);
  const team = teamOfChat(chatId);
  if (!team) return;
  if (!choice.length) return void (await aw.db.deleteRow({ databaseId: DB, tableId: 'votes', rowId }).catch(() => undefined));
  const data = { messageId, teamId: team, userId: myId, choice: choice.join(',') };
  try {
    await aw.db.updateRow({ databaseId: DB, tableId: 'votes', rowId, data: { choice: data.choice } });
  } catch (e) {
    if ((e as AppwriteException).code !== 404) throw e;
    await aw.db.createRow({
      databaseId: DB,
      tableId: 'votes',
      rowId,
      data,
      permissions: [Permission.read(Role.team(team)), Permission.update(Role.user(myId)), Permission.delete(Role.user(myId))],
    });
  }
}

export function resetPolls() {
  votes.clear();
  loaded.clear();
  bump();
}
