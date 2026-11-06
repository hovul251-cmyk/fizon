// Сквозное шифрование Fizion — полностью автоматическое: ни фраз, ни кодов, ничего не надо помнить.
//
// • У каждого человека есть ключ (пара ECDH P-256). Он создаётся сам при первом входе.
//   Открытая половина лежит на сервере, закрытая — только на устройствах владельца, и её
//   не видит никто: ни сервер, ни администратор, ни сам владелец (в интерфейсе её нет).
// • Новое устройство получает закрытый ключ от другого своего устройства: оно публикует временный
//   открытый ключ, старое устройство шифрует ключ человека для него (ECDH + HKDF + AES-GCM).
//   Сервер передаёт только зашифрованный пакет.
// • Личные: общий ключ пары собеседников (ECDH → HKDF → AES-GCM).
// • Группы: случайный ключ группы, разосланный каждому участнику под ключом пары «отправитель — участник».
//   Ушёл участник — следующий отправитель создаёт новый ключ группы.
// • Файлы: каждый файл шифруется своим случайным ключом, а ключ едет внутри зашифрованного сообщения.
// • Звонки: ключ для шифрования звука и видео LiveKit выводится из ключа пары или ключа группы.

const subtle = () => crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
export const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(s);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));

const LOCAL_V1 = 'fizion-e2e-v1';
const LOCAL_DEVICE = 'fizion-device-v1';
/** Личные (ключ пары) */
export const PREFIX = 'e2e:v1:';
/** Группы (ключ группы): e2e:g1:<id ключа>:<iv>:<шифр> */
export const GROUP_PREFIX = 'e2e:g1:';
/** Внутри зашифрованного текста: сообщение с вложением хранится как JSON */
const BODY_JSON = '\u0001j';
export const isSealed = (text: string) => text.startsWith('e2e:');

/* ===================== мой ключ ===================== */

let me: { userId: string; priv: CryptoKey; pub: string } | null = null;
const peers = new Map<string, Promise<string | null>>();
const pairKeys = new Map<string, Promise<CryptoKey>>();
let fetchPeerKey: (userId: string) => Promise<string | null> = async () => null;

/** Откуда брать открытые ключи собеседников (таблица keys) */
export const setKeySource = (fn: typeof fetchPeerKey) => (fetchPeerKey = fn);

export const ready = () => !!me;
export const myPublicKey = () => me?.pub ?? null;

export function forget() {
  me = null;
  peers.clear();
  pairKeys.clear();
  groupKeys.clear();
}

/** Ключ на этом устройстве уже есть? */
export async function loadLocal(userId: string) {
  forget();
  try {
    const raw = localStorage.getItem(LOCAL_V1);
    if (!raw) return false;
    const saved = JSON.parse(raw) as { userId: string; jwk: JsonWebKey; pub: string };
    if (saved.userId !== userId) return false;
    const priv = await subtle().importKey('jwk', saved.jwk, ECDH, true, ['deriveBits']);
    me = { userId, priv, pub: saved.pub };
    return true;
  } catch {
    return false;
  }
}

async function remember(userId: string, priv: CryptoKey, pub: string) {
  me = { userId, priv, pub };
  pairKeys.clear();
  groupKeys.clear();
  const jwk = await subtle().exportKey('jwk', priv);
  try {
    localStorage.setItem(LOCAL_V1, JSON.stringify({ userId, jwk, pub }));
  } catch {
    /* ключ останется до перезапуска */
  }
}

/** Создать ключ человека (первый вход или «начать заново»). Возвращает открытую половину для сервера. */
export async function createIdentity(userId: string): Promise<string> {
  const pair = (await subtle().generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = b64(await subtle().exportKey('raw', pair.publicKey));
  await remember(userId, pair.privateKey, pub);
  return pub;
}

/* ---------- старые ключи 0.8 под секретной фразой (только чтобы открыть их на новом устройстве) ---------- */

interface LegacyRow {
  publicKey: string;
  encPrivate: string;
  salt: string;
  iv: string;
}
async function phraseKey(phrase: string, salt: BufferSource) {
  const base = await subtle().importKey('raw', enc.encode(phrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const hasLegacyPhrase = (row: LegacyRow | null) => !!row && !!row.encPrivate && row.encPrivate !== '-' && !!row.salt;
export async function unlock(userId: string, row: LegacyRow, phrase: string) {
  try {
    const pkcs8 = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, await phraseKey(phrase, unb64(row.salt)), unb64(row.encPrivate));
    const priv = await subtle().importKey('pkcs8', pkcs8, ECDH, true, ['deriveBits']);
    await remember(userId, priv, row.publicKey);
    return true;
  } catch {
    return false;
  }
}

/* ===================== перенос ключа между устройствами ===================== */

export interface DeviceInfo {
  deviceId: string;
  publicKey: string;
}
let device: (DeviceInfo & { priv: CryptoKey }) | null = null;

/** Ключ этого устройства (создаётся один раз и хранится только здесь) */
export async function thisDevice(userId: string): Promise<DeviceInfo> {
  if (device) return { deviceId: device.deviceId, publicKey: device.publicKey };
  try {
    const raw = localStorage.getItem(LOCAL_DEVICE);
    if (raw) {
      const saved = JSON.parse(raw) as { userId: string; deviceId: string; jwk: JsonWebKey; pub: string };
      if (saved.userId === userId) {
        const priv = await subtle().importKey('jwk', saved.jwk, ECDH, true, ['deriveBits']);
        device = { deviceId: saved.deviceId, publicKey: saved.pub, priv };
        return { deviceId: device.deviceId, publicKey: device.publicKey };
      }
    }
  } catch {
    /* создаём заново */
  }
  const pair = (await subtle().generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = b64(await subtle().exportKey('raw', pair.publicKey));
  const deviceId = Array.from(rand(10), (b) => b.toString(16).padStart(2, '0')).join('');
  device = { deviceId, publicKey: pub, priv: pair.privateKey };
  try {
    localStorage.setItem(LOCAL_DEVICE, JSON.stringify({ userId, deviceId, jwk: await subtle().exportKey('jwk', pair.privateKey), pub }));
  } catch {
    /* без localStorage устройство будет новым при каждом запуске */
  }
  return { deviceId, publicKey: pub };
}
export const forgetDevice = () => (device = null);

async function wrapKey(myPriv: CryptoKey, peerPub: string, info: string) {
  const pub = await subtle().importKey('raw', unb64(peerPub), ECDH, false, []);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pub }, myPriv, 256);
  const base = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export interface KeyShare {
  epk: string;
  iv: string;
  ct: string;
}

/** Старое устройство: упаковать ключ человека для нового устройства */
export async function shareKeyWith(devicePub: string): Promise<KeyShare | null> {
  if (!me) return null;
  const eph = (await subtle().generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  const key = await wrapKey(eph.privateKey, devicePub, 'fizion-device-v1');
  const iv = rand(12);
  const pkcs8 = await subtle().exportKey('pkcs8', me.priv);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, pkcs8);
  return { epk: b64(await subtle().exportKey('raw', eph.publicKey)), iv: b64(iv), ct: b64(ct) };
}

/** Новое устройство: распаковать ключ, присланный другим своим устройством */
export async function acceptShare(userId: string, share: KeyShare, expectedPub: string): Promise<boolean> {
  if (!device) return false;
  try {
    const key = await wrapKey(device.priv, share.epk, 'fizion-device-v1');
    const pkcs8 = await subtle().decrypt({ name: 'AES-GCM', iv: unb64(share.iv) }, key, unb64(share.ct));
    const priv = await subtle().importKey('pkcs8', pkcs8, ECDH, true, ['deriveBits']);
    // проверяем, что это и правда ключ человека: из закрытой половины получается та же открытая
    const jwk = await subtle().exportKey('jwk', priv);
    const pubKey = await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, ECDH, true, []);
    if (b64(await subtle().exportKey('raw', pubKey)) !== expectedPub) return false;
    await remember(userId, priv, expectedPub);
    return true;
  } catch {
    return false;
  }
}

/* ===================== ключ пары ===================== */

const peerKey = (userId: string) => {
  if (!peers.has(userId)) peers.set(userId, fetchPeerKey(userId).catch(() => null));
  return peers.get(userId)!;
};
export const peerPublicKey = peerKey;

/** Забыть закэшированный ключ собеседника (он сменил ключ) */
export const refreshPeer = (userId: string) => {
  peers.delete(userId);
  for (const k of [...pairKeys.keys()]) if (k.startsWith(`${userId}|`)) pairKeys.delete(k);
};

async function pairBits(peerId: string, peerPub: string) {
  const pub = await subtle().importKey('raw', unb64(peerPub), ECDH, false, []);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pub }, me!.priv, 256);
  const salt = enc.encode([me!.userId, peerId].sort().join('|'));
  return { bits, salt };
}

async function hkdf(bits: ArrayBuffer, salt: BufferSource, info: string, usage: 'aes' | 'raw') {
  const base = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey', 'deriveBits']);
  if (usage === 'raw') return subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, 256);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Ключ пары «я — он» для заданной цели (сообщения или ключи группы) */
async function pairKey(peerId: string, info: string): Promise<CryptoKey | null> {
  if (!me) return null;
  const pub = peerId === me.userId ? me.pub : await peerKey(peerId);
  if (!pub) return null;
  const id = `${peerId}|${info}`;
  if (!pairKeys.has(id)) pairKeys.set(id, pairBits(peerId, pub).then(({ bits, salt }) => hkdf(bits, salt, info, 'aes') as Promise<CryptoKey>));
  return pairKeys.get(id)!;
}

/** Можно ли сейчас переписываться с ним зашифрованно (ключи есть у обоих) */
export async function canEncryptWith(peerId: string) {
  return !!(me && (await peerKey(peerId)));
}

async function seal(key: CryptoKey, text: string) {
  const iv = rand(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  return `${b64(iv)}:${b64(ct)}`;
}
async function open(key: CryptoKey, ivCt: string) {
  const [iv, ct] = ivCt.split(':');
  return dec.decode(await subtle().decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct)));
}

/* ===================== тело сообщения: текст + вложение ===================== */

export interface SealedBody {
  text: string;
  attachment?: unknown;
}
const packBody = (b: SealedBody) => (b.attachment ? BODY_JSON + JSON.stringify({ t: b.text, a: b.attachment }) : b.text);
const unpackBody = (s: string): SealedBody => {
  if (!s.startsWith(BODY_JSON)) return { text: s };
  try {
    const j = JSON.parse(s.slice(BODY_JSON.length)) as { t?: string; a?: unknown };
    return { text: j.t ?? '', attachment: j.a };
  } catch {
    return { text: '' };
  }
};

/** Зашифровать для собеседника. null — шифрование недоступно (нет ключа у кого-то из двоих). */
export async function encryptFor(peerId: string, body: SealedBody | string): Promise<string | null> {
  const key = await pairKey(peerId, 'fizion-dm-v1').catch(() => null);
  if (!key) return null;
  return PREFIX + (await seal(key, packBody(typeof body === 'string' ? { text: body } : body)));
}

/** Расшифровать личное. null — не получилось (нет ключа на этом устройстве или сообщение повреждено). */
export async function decryptFrom(peerId: string, payload: string): Promise<SealedBody | null> {
  if (!payload.startsWith(PREFIX)) return { text: payload };
  const key = await pairKey(peerId, 'fizion-dm-v1').catch(() => null);
  if (!key) return null;
  try {
    return unpackBody(await open(key, payload.slice(PREFIX.length)));
  } catch {
    return null;
  }
}

/* ===================== ключи групп ===================== */

export interface GroupKeyRow {
  keyId: string;
  userId: string;
  by: string;
  iv: string;
  ct: string;
  ts: number;
}
/** groupId → keyId → ключ (raw 32 байта) */
const groupKeys = new Map<string, Map<string, Promise<ArrayBuffer | null>>>();

async function unwrapGroupKey(row: GroupKeyRow): Promise<ArrayBuffer | null> {
  const key = await pairKey(row.by, 'fizion-gk-v1').catch(() => null);
  if (!key) return null;
  try {
    return await subtle().decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, key, unb64(row.ct));
  } catch {
    return null;
  }
}

/** Ключ группы по id из строк таблицы groupkeys (строка для меня) */
function groupRaw(groupId: string, keyId: string, rows: GroupKeyRow[]): Promise<ArrayBuffer | null> {
  let m = groupKeys.get(groupId);
  if (!m) groupKeys.set(groupId, (m = new Map()));
  const cached = m.get(keyId);
  if (cached) return cached;
  const mine = rows.find((r) => r.keyId === keyId && r.userId === me?.userId);
  const p = mine ? unwrapGroupKey(mine) : Promise.resolve(null);
  m.set(keyId, p);
  void p.then((v) => v === null && m!.delete(keyId)); // не получилось — попробуем позже снова
  return p;
}

/** Сырой ключ группы (чтобы упаковать его для нового участника) */
export const groupKeyRaw = groupRaw;

const aesFromRaw = (raw: ArrayBuffer) => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

/** Упаковать ключ группы для участника (под ключом пары «я — он») */
export async function wrapGroupKeyFor(memberId: string, raw: ArrayBuffer): Promise<{ iv: string; ct: string } | null> {
  const key = await pairKey(memberId, 'fizion-gk-v1').catch(() => null);
  if (!key) return null;
  const iv = rand(12);
  return { iv: b64(iv), ct: b64(await subtle().encrypt({ name: 'AES-GCM', iv }, key, raw)) };
}

/** Новый случайный ключ группы. Сразу запоминается у себя. */
export function newGroupKey(groupId: string): { keyId: string; raw: ArrayBuffer } {
  const raw = rand(32).buffer;
  const keyId = Array.from(rand(8), (b) => b.toString(16).padStart(2, '0')).join('');
  let m = groupKeys.get(groupId);
  if (!m) groupKeys.set(groupId, (m = new Map()));
  m.set(keyId, Promise.resolve(raw));
  return { keyId, raw };
}

export const forgetGroup = (groupId: string) => groupKeys.delete(groupId);

export async function encryptForGroup(groupId: string, keyId: string, rows: GroupKeyRow[], body: SealedBody | string): Promise<string | null> {
  const raw = await groupRaw(groupId, keyId, rows);
  if (!raw) return null;
  return `${GROUP_PREFIX}${keyId}:${await seal(await aesFromRaw(raw), packBody(typeof body === 'string' ? { text: body } : body))}`;
}

export async function decryptGroup(groupId: string, payload: string, rows: GroupKeyRow[]): Promise<SealedBody | null> {
  if (!payload.startsWith(GROUP_PREFIX)) return { text: payload };
  const rest = payload.slice(GROUP_PREFIX.length);
  const keyId = rest.slice(0, rest.indexOf(':'));
  const raw = await groupRaw(groupId, keyId, rows);
  if (!raw) return null;
  try {
    return unpackBody(await open(await aesFromRaw(raw), rest.slice(keyId.length + 1)));
  } catch {
    return null;
  }
}

/* ===================== файлы ===================== */

export interface FileKey {
  k: string;
  iv: string;
}

/** Зашифровать файл: каждый файл — своим ключом */
export async function sealFile(data: ArrayBuffer): Promise<{ blob: Blob; key: FileKey }> {
  const raw = rand(32);
  const iv = rand(12);
  const key = await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, data);
  return { blob: new Blob([ct], { type: 'application/octet-stream' }), key: { k: b64(raw), iv: b64(iv) } };
}

export async function openFile(data: ArrayBuffer, fk: FileKey): Promise<ArrayBuffer> {
  const key = await subtle().importKey('raw', unb64(fk.k), { name: 'AES-GCM' }, false, ['decrypt']);
  return subtle().decrypt({ name: 'AES-GCM', iv: unb64(fk.iv) }, key, data);
}

/* ===================== звонки ===================== */

/** Ключ шифрования звонка с этим собеседником (32 байта) или null */
export async function callKey(peerId: string): Promise<ArrayBuffer | null> {
  if (!me) return null;
  const pub = await peerKey(peerId);
  if (!pub) return null;
  const { bits, salt } = await pairBits(peerId, pub);
  return hkdf(bits, salt, 'fizion-call-v1', 'raw') as Promise<ArrayBuffer>;
}

/** Ключ группового звонка — из текущего ключа группы */
export async function groupCallKey(groupId: string, keyId: string, rows: GroupKeyRow[]): Promise<ArrayBuffer | null> {
  const raw = await groupRaw(groupId, keyId, rows);
  if (!raw) return null;
  return hkdf(raw, enc.encode(groupId), 'fizion-gcall-v1', 'raw') as Promise<ArrayBuffer>;
}
