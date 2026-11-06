// Fizion 0.11: вход по номеру и облачный пароль, ID как в Telegram, панель владельца,
// искры (валюта) и подарки, каналы. Подключается в actions.js.
//
// Облачный пароль: приложение само сессию не создаёт — код из SMS (или пароль от старого аккаунта)
// проверяет сервер, потом спрашивает облачный пароль и только тогда выдаёт одноразовый токен входа.
// Сессию, созданную в обход (без токена сервера), функция fizion-events удаляет сразу.

import { DB, HttpError } from './actions.js';

const forbid = (msg = 'Недостаточно прав') => new HttpError(403, 'forbidden', msg);
const bad = (msg) => new HttpError(400, 'bad_request', msg);
const notFound = (msg) => new HttpError(404, 'not_found', msg);
const clean = (s, max) => String(s ?? '').trim().slice(0, max);

/** Действия, которые можно вызвать без входа (сам вход) */
export const PUBLIC_ACTIONS = new Set(['phone-login', 'email-login', 'cloud-check', 'cloud-reset-start', 'cloud-reset']);

/** Подарки: цена в искрах ✨. Улучшенный подарок становится уникальным — с номером, фоном и узором. */
export const GIFTS = {
  bear: { emoji: '🧸', name: 'Мишка', price: 15 },
  heart: { emoji: '💝', name: 'Сердце', price: 15 },
  rose: { emoji: '🌹', name: 'Роза', price: 25 },
  box: { emoji: '🎁', name: 'Подарок', price: 25 },
  cake: { emoji: '🎂', name: 'Торт', price: 50 },
  flowers: { emoji: '💐', name: 'Букет', price: 50 },
  rocket: { emoji: '🚀', name: 'Ракета', price: 50 },
  cup: { emoji: '🏆', name: 'Кубок', price: 100 },
  ring: { emoji: '💍', name: 'Кольцо', price: 100 },
  diamond: { emoji: '💎', name: 'Алмаз', price: 100 },
  crown: { emoji: '👑', name: 'Корона', price: 250 },
  firefly: { emoji: '🪲', name: 'Светлячок', price: 500, limited: 1000 },
};
export const UPGRADE_PRICE = 25;
/** Получатель может обменять подарок на искры: 80% цены */
export const CONVERT_SHARE = 0.8;
/** Подарок от Neon новичку, чтобы было с чем попробовать подарки */
export const WELCOME_BONUS = 100;
const BACKDROPS = ['#6D4AFF', '#E5179F', '#0E9F6E', '#F59E0B', '#2563EB', '#DC2626', '#0891B2', '#7C3AED', '#111827', '#B45309'];
const PATTERNS = ['✦', '★', '●', '◆', '♥', '⚡', '☾', '✿'];

export function createMoreActions(ctx, h) {
  const { db, teams, users, sdk, userId } = ctx;
  const { Query, Permission, Role, ID } = sdk;
  const { get, list, create, update, remove } = h;
  const now = () => Date.now();

  /* ---------- журнал для владельца ---------- */
  const logEvent = (kind, text, targetId = '', actorId = userId ?? '') =>
    create('logs', { kind: clean(kind, 24), actorId: actorId ?? '', targetId: targetId ?? '', text: clean(text, 300) }, []).catch(() => undefined);

  /* ---------- метки: владелец, админ, заморожен ---------- */
  const labelsOf = async (uid) => (await users.get({ userId: uid })).labels ?? [];
  const staffOf = (labels) => (labels.includes('owner') ? 'owner' : labels.includes('admin') ? 'admin' : null);
  const requireStaff = async (ownerOnly = false) => {
    const role = staffOf(await labelsOf(userId));
    if (!role || (ownerOnly && role !== 'owner')) throw forbid(ownerOnly ? 'Только владелец Neon' : 'Только для админов Neon');
    return role;
  };
  const setLabel = async (uid, label, on) => {
    const cur = await labelsOf(uid);
    const next = on ? [...new Set([...cur, label])] : cur.filter((l) => l !== label);
    await users.updateLabels({ userId: uid, labels: next });
    return next;
  };

  /* ---------- облачный пароль ---------- */
  const secure = (uid) => get('secure', uid);
  const saveSecure = async (uid, data) => ((await secure(uid)) ? update('secure', uid, data) : create('secure', { hash: '', salt: '', hint: '', email: '', failed: 0, lockUntil: 0, allowUntil: 0, ticket: '', ticketUntil: 0, ...data }, [], uid));
  const hashPw = (pw, salt) => ctx.crypto.scrypt(String(pw), salt);
  const maskEmail = (e) => (e ? e.replace(/^(.)(.*)(.@.*)$/, (_, a, b, c) => a + '•'.repeat(Math.min(6, b.length)) + c) : '');

  /** Выдать одноразовый токен входа (сессию из него fizion-events пропустит) */
  const issue = async (uid) => {
    if (await secure(uid)) await update('secure', uid, { allowUntil: now() + 120_000 });
    const labels = await labelsOf(uid);
    if (labels.includes('banned')) throw forbid('Аккаунт заблокирован администрацией Neon');
    const t = await users.createToken({ userId: uid, length: 32, expire: 120 });
    await logEvent('login', 'Вход на новом устройстве', uid, uid);
    return { userId: uid, secret: t.secret };
  };

  /** Код из SMS/письма проверяем, создав и сразу удалив сессию без ключа */
  const verifyToken = async (uid, secret) => {
    let s;
    try {
      s = await ctx.publicAccount().createSession({ userId: uid, secret: String(secret ?? '').replace(/\s/g, '') });
    } catch {
      throw bad('Неверный или устаревший код');
    }
    await users.deleteSession({ userId: uid, sessionId: s.$id }).catch(() => undefined);
  };

  const afterFirstFactor = async (uid) => {
    const sec = await secure(uid);
    if (sec?.hash) {
      const ticket = ctx.crypto.randomToken();
      await update('secure', uid, { ticket, ticketUntil: now() + 10 * 60_000 });
      return { needPassword: true, hint: sec.hint ?? '', ticket, userId: uid, canReset: !!sec.email };
    }
    return issue(uid);
  };

  const checkTicket = async (uid, ticket) => {
    const sec = await secure(uid);
    if (!sec?.hash || !ticket || sec.ticket !== ticket || sec.ticketUntil < now()) throw bad('Время вышло — войди заново');
    return sec;
  };

  /* ---------- ID как в Telegram ---------- */
  const ensureNum = async (uid) => {
    const p = await get('profiles', uid);
    if (!p) return null;
    if (p.num) return p.num;
    for (let i = 0; i < 6; i++) {
      const num = String(100_000_000 + Math.floor(Math.random() * 900_000_000));
      if ((await list('profiles', [Query.equal('num', num)])).length) continue;
      await update('profiles', uid, { num });
      return num;
    }
    return null;
  };

  /* ---------- искры ---------- */
  const wallet = async (uid) => {
    let w = await get('wallets', uid);
    if (!w) {
      w = await create('wallets', { balance: WELCOME_BONUS, spent: 0 }, [Permission.read(Role.user(uid))], uid);
      await logEvent('coins', `Приветственный бонус +${WELCOME_BONUS} ✨`, uid, uid);
    }
    return w;
  };
  const addCoins = async (uid, delta, why) => {
    const w = await wallet(uid);
    const balance = (w.balance ?? 0) + delta;
    if (balance < 0) throw new HttpError(402, 'no_coins', `Не хватает искр: нужно ${-delta}, у тебя ${w.balance ?? 0}`);
    await update('wallets', uid, { balance, spent: (w.spent ?? 0) + (delta < 0 ? -delta : 0) });
    await logEvent('coins', `${delta > 0 ? '+' : ''}${delta} ✨ · ${why}`, uid);
    return balance;
  };

  /* ---------- каналы ---------- */
  const normHandle = (s) => String(s ?? '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '').slice(0, 32);
  const channel = async (groupId) => {
    const g = await get('groups', groupId);
    if (!g || g.kind !== 'channel') throw notFound('Канал не найден');
    return g;
  };
  const channelRole = async (teamId, uid = userId) => {
    const r = await teams.listMemberships({ teamId, queries: [Query.equal('userId', uid)] }).catch(() => null);
    return r?.memberships.find((m) => m.userId === uid) ?? null;
  };
  const subsCount = async (teamId) => (await teams.listMemberships({ teamId, queries: [Query.limit(1)] })).total;

  return {
    /* ===== вход ===== */
    async 'phone-login'({ userId: uid, secret }) {
      if (!uid || !secret) throw bad('Нужен код из SMS');
      await verifyToken(uid, secret);
      return afterFirstFactor(uid);
    },
    /** Старые аккаунты: почта и пароль. Проверяем на сервере, чтобы не обойти облачный пароль. */
    async 'email-login'({ email, password }) {
      let s;
      try {
        s = await ctx.publicAccount().createEmailPasswordSession({ email: clean(email, 200).toLowerCase(), password: String(password ?? '') });
      } catch {
        throw bad('Неверная почта или пароль');
      }
      await users.deleteSession({ userId: s.userId, sessionId: s.$id }).catch(() => undefined);
      return afterFirstFactor(s.userId);
    },
    async 'cloud-check'({ userId: uid, ticket, password }) {
      const sec = await checkTicket(uid, ticket);
      if ((sec.lockUntil ?? 0) > now()) throw new HttpError(429, 'locked', `Слишком много попыток. Попробуй через ${Math.ceil((sec.lockUntil - now()) / 60_000)} мин.`);
      if (hashPw(password, sec.salt) !== sec.hash) {
        const failed = (sec.failed ?? 0) + 1;
        await update('secure', uid, { failed, lockUntil: failed >= 5 ? now() + 15 * 60_000 : 0 });
        await logEvent('security', `Неверный облачный пароль (${failed})`, uid, uid);
        throw bad(failed >= 5 ? 'Неверный пароль. Вход заблокирован на 15 минут' : `Неверный пароль. Осталось попыток: ${5 - failed}`);
      }
      await update('secure', uid, { failed: 0, lockUntil: 0, ticket: '', ticketUntil: 0 });
      return issue(uid);
    },
    /** Забыл облачный пароль: код на почту для сброса */
    async 'cloud-reset-start'({ userId: uid, ticket }) {
      const sec = await checkTicket(uid, ticket);
      if (!sec.email) throw bad('Почта для сброса не задана — сбросить пароль нельзя');
      await ctx.publicAccount().createEmailToken({ userId: uid, email: sec.email });
      return { email: maskEmail(sec.email) };
    },
    async 'cloud-reset'({ userId: uid, ticket, code }) {
      await checkTicket(uid, ticket);
      await verifyToken(uid, code);
      await update('secure', uid, { hash: '', salt: '', hint: '', failed: 0, lockUntil: 0, ticket: '', ticketUntil: 0 });
      await logEvent('security', 'Облачный пароль сброшен через почту', uid, uid);
      return issue(uid);
    },

    /* ===== настройки безопасности ===== */
    async 'cloud-status'() {
      const sec = await secure(userId);
      const u = await users.get({ userId });
      return { enabled: !!sec?.hash, hint: sec?.hint ?? '', email: sec?.email || u.email || '', emailVerified: !!u.emailVerification && (!sec?.email || sec.email === u.email) };
    },
    async 'cloud-set'({ current, password, hint, email }) {
      const sec = await secure(userId);
      if (sec?.hash && hashPw(current, sec.salt) !== sec.hash) throw bad('Текущий облачный пароль неверный');
      if (String(password ?? '').length < 6) throw bad('Пароль — минимум 6 символов');
      const mail = clean(email, 200).toLowerCase();
      if (mail) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw bad('Почта выглядит неправильно');
        const u = await users.get({ userId });
        if (u.email !== mail) {
          try {
            await users.updateEmail({ userId, email: mail });
          } catch (e) {
            if (e?.code === 409) throw bad('Эта почта уже привязана к другому аккаунту');
            throw e;
          }
          await users.updateEmailVerification({ userId, emailVerification: false });
        }
      }
      const salt = ctx.crypto.randomToken();
      await saveSecure(userId, { hash: hashPw(password, salt), salt, hint: clean(hint, 60), email: mail || sec?.email || '', failed: 0, lockUntil: 0 });
      await logEvent('security', 'Облачный пароль включён или изменён', userId);
      return { ok: true };
    },
    async 'cloud-remove'({ current }) {
      const sec = await secure(userId);
      if (!sec?.hash) return { ok: true };
      if (hashPw(current, sec.salt) !== sec.hash) throw bad('Облачный пароль неверный');
      await update('secure', userId, { hash: '', salt: '', hint: '' });
      await logEvent('security', 'Облачный пароль выключен', userId);
      return { ok: true };
    },

    /* ===== ID и поиск человека ===== */
    async 'my-num'() {
      return { num: await ensureNum(userId) };
    },
    async 'find-user'({ query }) {
      const q = clean(query, 40).replace(/^@/, '');
      if (!q) throw bad('Введи логин или ID');
      const rows = /^\d{6,12}$/.test(q) ? await list('profiles', [Query.equal('num', q)]) : await list('profiles', [Query.equal('username', q.toLowerCase())]);
      if (!rows[0]) throw notFound(/^\d+$/.test(q) ? 'Человека с таким ID нет' : 'Пользователь с таким логином не найден');
      return { userId: rows[0].$id, username: rows[0].username, displayName: rows[0].displayName, num: rows[0].num };
    },

    /* ===== панель владельца ===== */
    async 'staff-me'() {
      const labels = await labelsOf(userId);
      return { role: staffOf(labels), frozen: labels.includes('frozen') };
    },
    async 'admin-users'({ query = '' }) {
      await requireStaff();
      const q = clean(query, 40).replace(/^@/, '').toLowerCase();
      let rows;
      if (/^\d{6,12}$/.test(q)) rows = await list('profiles', [Query.equal('num', q)]);
      else if (q) rows = await list('profiles', [Query.startsWith('username', q)]);
      else rows = (await db.listRows({ databaseId: DB, tableId: 'profiles', queries: [Query.orderDesc('$createdAt'), Query.limit(30)] })).rows;
      const out = [];
      for (const p of rows.slice(0, 30)) {
        const u = await users.get({ userId: p.$id }).catch(() => null);
        const w = await get('wallets', p.$id);
        out.push({ userId: p.$id, username: p.username, displayName: p.displayName, num: p.num ?? '', labels: u?.labels ?? [], created: p.$createdAt, balance: w?.balance ?? 0, phone: u?.phone ? u.phone.replace(/\d(?=\d{2})/g, '•') : '' });
      }
      return { users: out };
    },
    async 'admin-set'({ userId: target, admin }) {
      await requireStaff(true);
      if (target === userId) throw bad('Это ты');
      await setLabel(target, 'admin', !!admin);
      await logEvent('admin', admin ? 'Выдал права админа' : 'Забрал права админа', target);
      return { ok: true };
    },
    async 'admin-ban'({ userId: target, ban, reason = '' }) {
      const role = await requireStaff();
      if (target === userId) throw bad('Это ты');
      const theirs = staffOf(await labelsOf(target));
      if (theirs === 'owner' || (theirs === 'admin' && role !== 'owner')) throw forbid('Нельзя наказать владельца или другого админа');
      await setLabel(target, 'banned', !!ban);
      await users.updateStatus({ userId: target, status: !ban });
      if (ban) await users.deleteSessions({ userId: target }).catch(() => undefined);
      await logEvent('ban', `${ban ? 'Забанил' : 'Разбанил'}${reason ? `: ${clean(reason, 200)}` : ''}`, target);
      return { ok: true };
    },
    async 'admin-freeze'({ userId: target, freeze, reason = '' }) {
      const role = await requireStaff();
      if (target === userId) throw bad('Это ты');
      const theirs = staffOf(await labelsOf(target));
      if (theirs === 'owner' || (theirs === 'admin' && role !== 'owner')) throw forbid('Нельзя наказать владельца или другого админа');
      await setLabel(target, 'frozen', !!freeze);
      await logEvent('freeze', `${freeze ? 'Заморозил' : 'Разморозил'}${reason ? `: ${clean(reason, 200)}` : ''}`, target);
      return { ok: true };
    },
    async 'admin-coins'({ userId: target, amount, reason = '' }) {
      await requireStaff(true);
      const n = Math.trunc(Number(amount));
      if (!n || Math.abs(n) > 1_000_000) throw bad('Сколько искр начислить?');
      const balance = await addCoins(target, n, `от владельца${reason ? `: ${clean(reason, 100)}` : ''}`);
      return { balance };
    },
    async 'admin-logs'({ cursor, kind }) {
      await requireStaff();
      const q = [Query.orderDesc('$createdAt'), Query.limit(50)];
      if (kind) q.push(Query.equal('kind', clean(kind, 24)));
      if (cursor) q.push(Query.cursorAfter(cursor));
      const rows = (await db.listRows({ databaseId: DB, tableId: 'logs', queries: q })).rows;
      const ids = [...new Set(rows.flatMap((r) => [r.actorId, r.targetId]).filter(Boolean))];
      const names = {};
      if (ids.length) for (const p of await list('profiles', [Query.equal('$id', ids.slice(0, 100))])) names[p.$id] = `${p.displayName} (@${p.username})`;
      return { logs: rows.map((r) => ({ id: r.$id, ts: r.$createdAt, kind: r.kind, text: r.text, actor: names[r.actorId] ?? (r.actorId ? 'кто-то' : 'система'), target: names[r.targetId] ?? '' })) };
    },

    /* ===== искры и подарки ===== */
    async wallet() {
      const w = await wallet(userId);
      return { balance: w.balance ?? 0 };
    },
    async topup() {
      throw new HttpError(501, 'no_payments', 'Покупка искр скоро появится: владелец подключает оплату. Пока искры можно получить от владельца Neon.');
    },
    async 'gift-send'({ to, giftId, text = '', anon = false }) {
      const g = GIFTS[giftId];
      if (!g) throw bad('Такого подарка нет');
      if (!to || to === userId) throw bad('Подарок можно отправить другому человеку');
      if (!(await get('profiles', to))) throw notFound('Получатель не найден');
      if (g.limited) {
        const sold = (await db.listRows({ databaseId: DB, tableId: 'gifts', queries: [Query.equal('giftId', giftId), Query.limit(1)] })).total;
        if (sold >= g.limited) throw bad('Этот лимитированный подарок закончился');
      }
      await addCoins(userId, -g.price, `подарок «${g.name}»`);
      const row = await create(
        'gifts',
        { fromId: anon ? '' : userId, toId: to, giftId, text: clean(text, 200), price: g.price, serial: 0, look: '', converted: false, hidden: false },
        [Permission.read(Role.users()), Permission.read(Role.user(userId))],
      );
      await logEvent('gift', `Подарил ${g.emoji} ${g.name}${anon ? ' (анонимно)' : ''}`, to);
      return { id: row.$id };
    },
    async 'gift-convert'({ id }) {
      const row = await get('gifts', id);
      if (!row || row.toId !== userId) throw notFound('Подарок не найден');
      if (row.converted) throw bad('Уже обменян');
      if (row.serial) throw bad('Уникальный подарок нельзя обменять');
      const amount = Math.floor((row.price ?? 0) * CONVERT_SHARE);
      await update('gifts', id, { converted: true, hidden: true });
      const balance = await addCoins(userId, amount, 'обмен подарка');
      return { balance, amount };
    },
    async 'gift-hide'({ id, hidden }) {
      const row = await get('gifts', id);
      if (!row || row.toId !== userId) throw notFound('Подарок не найден');
      await update('gifts', id, { hidden: !!hidden });
      return { ok: true };
    },
    /** Улучшить: подарок становится уникальным — номер, свой фон и узор (как коллекционные в Telegram) */
    async 'gift-upgrade'({ id }) {
      const row = await get('gifts', id);
      if (!row || row.toId !== userId) throw notFound('Подарок не найден');
      if (row.serial) throw bad('Уже уникальный');
      if (row.converted) throw bad('Подарок обменян на искры');
      await addCoins(userId, -UPGRADE_PRICE, 'улучшение подарка');
      const serial = (await db.listRows({ databaseId: DB, tableId: 'gifts', queries: [Query.equal('giftId', row.giftId), Query.greaterThan('serial', 0), Query.limit(1)] })).total + 1;
      const look = `${BACKDROPS[Math.floor(Math.random() * BACKDROPS.length)]}|${PATTERNS[Math.floor(Math.random() * PATTERNS.length)]}`;
      await update('gifts', id, { serial, look });
      return { serial, look };
    },
    /** Передать уникальный подарок другу */
    async 'gift-transfer'({ id, to }) {
      const row = await get('gifts', id);
      if (!row || row.toId !== userId) throw notFound('Подарок не найден');
      if (!row.serial) throw bad('Передавать можно только уникальные подарки');
      if (!to || to === userId) throw bad('Кому передать?');
      if (!(await get('profiles', to))) throw notFound('Получатель не найден');
      await update('gifts', id, { toId: to, fromId: userId, hidden: false });
      await logEvent('gift', `Передал уникальный подарок #${row.serial}`, to);
      return { ok: true };
    },

    /* ===== каналы ===== */
    async 'channel-create'({ name, handle, about = '', isPublic = true }) {
      const title = clean(name, 40);
      if (title.length < 1) throw bad('Как назовём канал?');
      const h = normHandle(handle);
      if (isPublic) {
        if (h.length < 4) throw bad('Ссылка на канал: минимум 4 символа (латиница, цифры, _)');
        if ((await list('groups', [Query.equal('handle', h)])).length) throw new HttpError(409, 'handle_taken', 'Такая ссылка уже занята');
      }
      const teamId = ID.unique();
      await teams.create({ teamId, name: 'channel' });
      await teams.createMembership({ teamId, userId, roles: ['member', 'owner', 'admin'] });
      const perms = isPublic ? [Permission.read(Role.users())] : [Permission.read(Role.team(teamId))];
      await create('groups', { name: title, color: '#6D4AFF', ownerId: userId, kind: 'channel', handle: isPublic ? h : '', about: clean(about, 200), isPublic: !!isPublic, subs: 1 }, perms, teamId);
      await logEvent('channel', `Создал канал «${title}»`);
      return { teamId };
    },
    async 'channel-find'({ handle }) {
      const h = normHandle(handle);
      const g = (await list('groups', [Query.equal('handle', h)]))[0];
      if (!g || g.kind !== 'channel') throw notFound('Канал не найден');
      const me = await channelRole(g.$id);
      return { id: g.$id, name: g.name, about: g.about ?? '', handle: g.handle, subs: g.subs ?? 0, joined: !!me };
    },
    async 'channel-join'({ groupId, handle }) {
      const g = groupId ? await channel(groupId) : (await list('groups', [Query.equal('handle', normHandle(handle))]))[0];
      if (!g || g.kind !== 'channel') throw notFound('Канал не найден');
      if (!g.isPublic) throw forbid('Это закрытый канал — нужно приглашение');
      if (!(await channelRole(g.$id))) {
        await teams.createMembership({ teamId: g.$id, userId, roles: ['member'] });
        await update('groups', g.$id, { subs: await subsCount(g.$id) });
      }
      return { teamId: g.$id };
    },
    async 'channel-leave'({ groupId }) {
      const g = await channel(groupId);
      const m = await channelRole(g.$id);
      if (!m) return { ok: true };
      if (m.roles.includes('owner')) throw bad('Владелец не может отписаться — можно удалить канал');
      await teams.deleteMembership({ teamId: g.$id, membershipId: m.$id });
      await update('groups', g.$id, { subs: await subsCount(g.$id) });
      return { ok: true };
    },
    async 'channel-update'({ groupId, name, about, handle, isPublic }) {
      const g = await channel(groupId);
      const me = await channelRole(g.$id);
      if (!me?.roles.includes('owner')) throw forbid('Только владелец канала');
      const data = {};
      if (name !== undefined) data.name = clean(name, 40) || g.name;
      if (about !== undefined) data.about = clean(about, 200);
      if (isPublic !== undefined) data.isPublic = !!isPublic;
      if (handle !== undefined) {
        const h = normHandle(handle);
        if (h && h !== g.handle) {
          if (h.length < 4) throw bad('Ссылка: минимум 4 символа');
          if ((await list('groups', [Query.equal('handle', h)])).length) throw new HttpError(409, 'handle_taken', 'Такая ссылка уже занята');
        }
        data.handle = h;
      }
      const pub = data.isPublic ?? g.isPublic;
      await db.updateRow({ databaseId: DB, tableId: 'groups', rowId: g.$id, data, permissions: pub ? [Permission.read(Role.users())] : [Permission.read(Role.team(g.$id))] });
      return { ok: true };
    },
    async 'channel-admin'({ groupId, userId: target, on }) {
      const g = await channel(groupId);
      const me = await channelRole(g.$id);
      if (!me?.roles.includes('owner')) throw forbid('Админов назначает владелец канала');
      const m = await channelRole(g.$id, target);
      if (!m) throw notFound('Этот человек не подписан на канал');
      if (m.roles.includes('owner')) return { ok: true };
      await teams.updateMembership({ teamId: g.$id, membershipId: m.$id, roles: on ? ['member', 'admin'] : ['member'] });
      return { ok: true };
    },
    async 'channel-delete'({ groupId }) {
      const g = await channel(groupId);
      const me = await channelRole(g.$id);
      if (!me?.roles.includes('owner')) throw forbid('Удалить канал может только владелец');
      await db.deleteRows({ databaseId: DB, tableId: 'messages', queries: [Query.equal('teamId', g.$id)] }).catch(() => undefined);
      await remove('groups', g.$id);
      await teams.delete({ teamId: g.$id }).catch(() => undefined);
      return { ok: true };
    },
    async 'channel-admins'({ groupId }) {
      const g = await channel(groupId);
      if (!(await channelRole(g.$id))) throw forbid('Сначала подпишись');
      const r = await teams.listMemberships({ teamId: g.$id, queries: [Query.limit(100)] });
      return { admins: r.memberships.filter((m) => m.roles.includes('admin') || m.roles.includes('owner')).map((m) => ({ userId: m.userId, owner: m.roles.includes('owner') })) };
    },
  };
}

/** Сервер: создать профиль → сразу выдать ему ID и записать в журнал */
export async function afterProfileCreated(ctx, h, uid) {
  const more = createMoreActions({ ...ctx, userId: uid }, h);
  await more['my-num']().catch(() => undefined);
}
