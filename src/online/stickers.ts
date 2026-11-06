// Стикеры как в Telegram: встроенный анимированный набор и наборы, которые делают сами люди.
// Набор — строка таблицы stickerPacks (название + список картинок). Какие наборы добавлены у меня,
// хранится в профиле (stickerPacks), поэтому они одинаковые на всех устройствах.

import { ID, Permission, Query, Role, type Models } from 'appwrite';
import { ME } from '../data';
import { aw, BUCKET, DB, ONLINE } from '../lib/appwrite';
import { actions, getState } from '../store';
import type { Sticker, StickerPack } from '../types';
import { L, myId } from './sync';

type PackRow = Models.Row & { name: string; authorId: string; stickers: string };

const ANIMS = ['bounce', 'wiggle', 'pulse', 'float', 'spin', 'pop'];

/** Встроенный набор: большие анимированные эмодзи — есть у всех сразу */
export const BUILTIN: StickerPack = {
  id: 'fizion',
  name: 'Neon',
  authorId: 'fizion',
  builtin: true,
  stickers: ['😂', '🔥', '❤️', '👍', '😭', '😎', '🤯', '🥳', '😡', '🤔', '👀', '💀', '🙏', '😴', '🤡', '🎉', '💯', '🫡', '🥺', '😈', '🤝', '✨', '🍕', '🎮'].map((emoji, i) => ({
    id: `f${i}`,
    emoji,
    anim: ANIMS[i % ANIMS.length],
  })),
};

const OFFLINE_KEY = 'fizion-sticker-packs';
const packs = new Map<string, StickerPack>([[BUILTIN.id, BUILTIN]]);
const listeners = new Set<() => void>();
let version = 0;
const bump = () => {
  version++;
  listeners.forEach((fn) => fn());
};
export const onStickers = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const stickersVersion = () => version;

const fromRow = (r: PackRow): StickerPack => {
  let stickers: Sticker[] = [];
  try {
    stickers = (JSON.parse(r.stickers) as Sticker[]).filter((s) => s && (s.url || s.emoji)).slice(0, 60);
  } catch {
    /* повреждённый набор — пустой */
  }
  return { id: r.$id, name: r.name, authorId: L(r.authorId), stickers };
};

/** id наборов, добавленных у меня (встроенный — всегда первый) */
export const installedIds = (): string[] => {
  const mine = getState().profile.stickerPacks ?? [];
  return [BUILTIN.id, ...mine.filter((id) => id !== BUILTIN.id)];
};
export const isInstalled = (id: string) => installedIds().includes(id);
export const packOf = (id: string) => packs.get(id);

/** Загрузить свои наборы (при открытии панели стикеров) */
export async function loadInstalled() {
  const need = installedIds().filter((id) => !packs.has(id));
  if (!need.length) return;
  if (!ONLINE || !aw) {
    for (const p of offlinePacks()) packs.set(p.id, p);
    return bump();
  }
  const r = await aw.db.listRows<PackRow>({ databaseId: DB, tableId: 'stickerPacks', queries: [Query.equal('$id', need.slice(0, 100)), Query.limit(100)] }).catch(() => null);
  r?.rows.forEach((row) => packs.set(row.$id, fromRow(row)));
  bump();
}

/** Набор по id (например, стикер прислали в чат — открыть его набор) */
export async function fetchPack(id: string): Promise<StickerPack | null> {
  if (packs.has(id)) return packs.get(id)!;
  if (!ONLINE || !aw) return offlinePacks().find((p) => p.id === id) ?? null;
  const row = await aw.db.getRow<PackRow>({ databaseId: DB, tableId: 'stickerPacks', rowId: id }).catch(() => null);
  if (!row) return null;
  const p = fromRow(row);
  packs.set(id, p);
  bump();
  return p;
}

async function setInstalled(ids: string[]) {
  const s = getState();
  await actions.saveProfile({ ...s.profile, stickerPacks: ids.filter((id) => id !== BUILTIN.id) });
  bump();
}
export const install = (id: string) => setInstalled([...installedIds().filter((x) => x !== id), id]);
export const uninstall = (id: string) => setInstalled(installedIds().filter((x) => x !== id));

/* ---------- создание своего набора ---------- */

/** Картинку — в 512×512 webp (как в Telegram). GIF оставляем как есть, чтобы не пропала анимация. */
export function prepareImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.type.startsWith('video/')) return Promise.resolve(file);
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => resolve(b ?? file), 'image/webp', 0.9);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(b);
  });

function offlinePacks(): StickerPack[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? '[]') as StickerPack[];
  } catch {
    return [];
  }
}

/** Видеостикер: не длиннее 3 секунд (как в Telegram) */
export function checkVideo(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration > 3.05 ? `«${file.name}» длится ${v.duration.toFixed(1)} с — видеостикер не длиннее 3 секунд` : null);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(`«${file.name}» — не получилось прочитать видео`);
    };
    v.src = url;
  });
}

/** Создать набор из своих картинок. Возвращает новый набор (он сразу добавлен себе). */
export async function createPack(name: string, items: { file: File; emoji: string }[], onProgress?: (done: number) => void): Promise<StickerPack> {
  const title = name.trim().slice(0, 64) || 'Мои стикеры';
  const stickers: Sticker[] = [];
  for (const [i, it] of items.slice(0, 60).entries()) {
    const video = it.file.type.startsWith('video/');
    if (video) {
      const bad = await checkVideo(it.file);
      if (bad) throw new Error(bad);
    }
    const blob = await prepareImage(it.file);
    if (blob.size > 3 * 1024 * 1024) throw new Error(`«${it.file.name}» больше 3 МБ — для стикера это слишком`);
    let url: string;
    if (ONLINE && aw) {
      const ext = video ? (blob.type.includes('mp4') ? 'mp4' : 'webm') : blob.type === 'image/gif' ? 'gif' : 'webp';
      const f = await aw.storage.createFile({ bucketId: BUCKET, fileId: ID.unique(), file: new File([blob], `sticker.${ext}`, { type: blob.type }), permissions: [Permission.read(Role.any())] });
      url = aw.storage.getFileView({ bucketId: BUCKET, fileId: f.$id });
    } else url = await blobToDataUrl(blob);
    stickers.push({ id: `s${i}`, url, emoji: it.emoji || '🙂', ...(video ? { video: true } : {}) });
    onProgress?.(i + 1);
  }
  let pack: StickerPack;
  if (ONLINE && aw && myId) {
    const row = await aw.db.createRow<PackRow>({
      databaseId: DB,
      tableId: 'stickerPacks',
      rowId: ID.unique(),
      data: { name: title, authorId: myId, stickers: JSON.stringify(stickers) },
      permissions: [Permission.read(Role.users()), Permission.update(Role.user(myId)), Permission.delete(Role.user(myId))],
    });
    pack = fromRow(row);
  } else {
    pack = { id: `local-${Date.now().toString(36)}`, name: title, authorId: ME, stickers };
    try {
      localStorage.setItem(OFFLINE_KEY, JSON.stringify([...offlinePacks(), pack]));
    } catch {
      throw new Error('Не хватает места на устройстве — в офлайн-режиме наборы хранятся локально');
    }
  }
  packs.set(pack.id, pack);
  await install(pack.id);
  return pack;
}

/** Копия чужого набора себе — можно переименовать, менять и дополнять как свой */
export async function copyPack(src: StickerPack, name?: string): Promise<StickerPack> {
  const title = (name ?? `${src.name} (копия)`).trim().slice(0, 64);
  const stickers = src.stickers.map((s, i) => ({ ...s, id: `s${i}` }));
  let pack: StickerPack;
  if (ONLINE && aw && myId) {
    const row = await aw.db.createRow<PackRow>({
      databaseId: DB,
      tableId: 'stickerPacks',
      rowId: ID.unique(),
      data: { name: title, authorId: myId, stickers: JSON.stringify(stickers) },
      permissions: [Permission.read(Role.users()), Permission.update(Role.user(myId)), Permission.delete(Role.user(myId))],
    });
    pack = fromRow(row);
  } else {
    pack = { id: `local-${Date.now().toString(36)}`, name: title, authorId: ME, stickers };
    localStorage.setItem(OFFLINE_KEY, JSON.stringify([...offlinePacks(), pack]));
  }
  packs.set(pack.id, pack);
  await install(pack.id);
  return pack;
}

/** Удалить свой набор насовсем (у тех, кто его добавил, он пропадёт) */
export async function deletePack(id: string) {
  await uninstall(id);
  packs.delete(id);
  if (ONLINE && aw) await aw.db.deleteRow({ databaseId: DB, tableId: 'stickerPacks', rowId: id }).catch(() => undefined);
  else localStorage.setItem(OFFLINE_KEY, JSON.stringify(offlinePacks().filter((p) => p.id !== id)));
  bump();
}
