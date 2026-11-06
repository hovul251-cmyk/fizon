// Серверная логика Fizion для Appwrite. Всё, где нужно проверить права или выдать
// доступ другому человеку, делается здесь, ключом сервера — клиент так не может.
// Зависимости передаются снаружи (ctx), поэтому эту же логику можно проверить без сети.

export const DB = 'fizion';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const forbid = (msg = 'Недостаточно прав') => new HttpError(403, 'forbidden', msg);
const bad = (msg) => new HttpError(400, 'bad_request', msg);
const notFound = (msg) => new HttpError(404, 'not_found', msg);

/** Всё, что принадлежит сообществу и удаляется вместе с ним */
const COMMUNITY_TABLES = ['messages', 'reactions', 'rooms', 'roles', 'memberRoles', 'invites', 'bans', 'mutes', 'reports', 'pins', 'watch', 'reads', 'webhooks'];

const OWNER_PERMS = { admin: true, manageChannels: true, manageMessages: true, kickBan: true, timeout: true, manageRoles: true };
const MOD_PERMS = { admin: false, manageChannels: true, manageMessages: true, kickBan: true, timeout: true, manageRoles: false };
const NO_PERMS = { admin: false, manageChannels: false, manageMessages: false, kickBan: false, timeout: false, manageRoles: false };

const clean = (s, max) => String(s ?? '').trim().slice(0, max);
const normUsername = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 32);
const parse = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};

/** Роли Appwrite-команды из прав роли Fizion. Ими проверяется модерация. */
const teamRolesFor = (perms, isOwner) => {
  const r = ['member'];
  if (isOwner) r.push('owner', 'admin', 'mod');
  else {
    if (perms.admin || perms.manageChannels || perms.manageRoles) r.push('admin');
    if (perms.admin || perms.manageMessages || perms.kickBan) r.push('mod');
  }
  return r;
};

export function createActions(ctx) {
  const { db, teams, users, sdk, userId } = ctx;
  // хеш и случайный секрет для вебхуков (node:crypto передаёт main.js — так логику можно проверить и без Node)
  const sha256 = (s) => ctx.crypto.sha256(String(s));
  const randomToken = () => ctx.crypto.randomToken();
  const { ID, Query, Permission, Role } = sdk;

  const get = async (tableId, rowId) => {
    try {
      return await db.getRow({ databaseId: DB, tableId, rowId });
    } catch (e) {
      if (e?.code === 404) return null;
      throw e;
    }
  };
  const list = async (tableId, queries = []) => (await db.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(500)] })).rows;
  const create = (tableId, data, permissions, rowId = ID.unique()) => db.createRow({ databaseId: DB, tableId, rowId, data, permissions });
  const update = (tableId, rowId, data) => db.updateRow({ databaseId: DB, tableId, rowId, data });
  const remove = (tableId, rowId) => db.deleteRow({ databaseId: DB, tableId, rowId });
  const removeWhere = (tableId, queries) => db.deleteRows({ databaseId: DB, tableId, queries });

  const membership = async (teamId, uid = userId) => {
    try {
      const r = await teams.listMemberships({ teamId, queries: [Query.equal('userId', uid)] });
      return r.memberships.find((m) => m.userId === uid) ?? null;
    } catch (e) {
      if (e?.code === 404) return null;
      throw e;
    }
  };
  const requireMember = async (teamId) => {
    const m = await membership(teamId);
    if (!m) throw forbid('Ты не участник этого сообщества');
    return m;
  };
  const requireRole = async (teamId, roles) => {
    const m = await requireMember(teamId);
    if (!roles.some((r) => m.roles.includes(r))) throw forbid();
    return m;
  };
  const teamRead = (teamId) => [Permission.read(Role.team(teamId))];
  const MODS = ['owner', 'admin', 'mod'];
  /** Только модераторы сообщества: читать и менять (жалобы) */
  const modsOnly = (teamId) => MODS.flatMap((r) => [Permission.read(Role.team(teamId, r)), Permission.update(Role.team(teamId, r))]);

  const isFriend = async (a, b) => {
    const rows = [
      ...(await list('friendships', [Query.equal('fromId', a), Query.equal('toId', b)])),
      ...(await list('friendships', [Query.equal('fromId', b), Query.equal('toId', a)])),
    ];
    return rows.some((f) => f.status === 'accepted');
  };
  const friendsOf = async (uid) => {
    const rows = [...(await list('friendships', [Query.equal('fromId', uid)])), ...(await list('friendships', [Query.equal('toId', uid)]))];
    return rows.filter((f) => f.status === 'accepted').map((f) => (f.fromId === uid ? f.toId : f.fromId));
  };
  /** Модератор не может наказать владельца, себя и того, у кого роль не ниже его */
  const requireModOver = async (teamId, target) => {
    const me = await requireRole(teamId, MODS);
    if (target === userId) throw bad('Нельзя применить к себе');
    const them = await membership(teamId, target);
    if (them?.roles.includes('owner')) throw forbid('Владельца наказать нельзя');
    if (them && !me.roles.includes('owner') && them.roles.some((r) => r === 'admin' || r === 'mod') && !me.roles.includes('admin')) throw forbid('Нельзя наказать модератора');
    return { me, them };
  };
  /** Кто-то из двоих заблокировал другого? */
  const blockedBetween = async (a, b) =>
    (await list('blocks', [Query.equal('by', a), Query.equal('userId', b)])).length > 0 || (await list('blocks', [Query.equal('by', b), Query.equal('userId', a)])).length > 0;
  const requireNotBlocked = async (other) => {
    if (await blockedBetween(userId, other)) throw forbid('Этот человек ограничил общение с тобой или ты его заблокировал');
  };
  const removeMember = async (teamId, target, m) => {
    if (m) await teams.deleteMembership({ teamId, membershipId: m.$id });
    await removeWhere('memberRoles', [Query.equal('teamId', teamId), Query.equal('userId', target)]);
  };

  const profileRow = (data) => ({
    username: data.username,
    displayName: data.displayName,
    avatarUrl: data.avatarUrl ?? null,
    bannerUrl: data.bannerUrl ?? null,
    data: typeof data.data === 'string' ? data.data : JSON.stringify(data.data ?? {}),
  });

  return {
    /** Первый вход: создать профиль. Делает сервер, чтобы нельзя было занять чужой id. */
    async 'ensure-profile'({ username, displayName, avatarUrl, bannerUrl, data }) {
      const existing = await get('profiles', userId);
      if (existing) return existing;
      const u = normUsername(username);
      if (u.length < 2) throw bad('Имя пользователя: минимум 2 символа');
      const taken = await list('profiles', [Query.equal('username', u)]);
      if (taken.length) throw new HttpError(409, 'username_taken', 'Это имя пользователя уже занято');
      const name = clean(displayName, 32) || u;
      return create('profiles', profileRow({ username: u, displayName: name, avatarUrl, bannerUrl, data }), [
        Permission.read(Role.users()),
        Permission.update(Role.user(userId)),
        Permission.delete(Role.user(userId)),
      ], userId);
    },

    async 'create-community'({ name, color, rooms = [] }) {
      const title = clean(name, 40);
      if (!title) throw bad('Нужно название');
      const teamId = ID.unique();
      await teams.create({ teamId, name: title });
      await teams.createMembership({ teamId, userId, roles: ['member', 'owner', 'admin', 'mod'] });
      const perms = teamRead(teamId);
      await create('communities', { teamId, name: title, color: clean(color, 16) || '#8B5CF6', ownerId: userId }, perms, teamId);
      await create('roles', { teamId, key: 'owner', name: 'Владелец', color: '#A78BFA', perms: JSON.stringify(OWNER_PERMS), position: 0 }, perms);
      await create('roles', { teamId, key: '', name: 'Модератор', color: '#22D3EE', perms: JSON.stringify(MOD_PERMS), position: 1 }, perms);
      await create('roles', { teamId, key: 'everyone', name: '@все', color: '#9AA3B2', perms: JSON.stringify(NO_PERMS), position: 100 }, perms);
      let i = 0;
      for (const r of rooms.slice(0, 50)) {
        await create('rooms', { teamId, name: clean(r.name, 40) || 'комната', kind: r.kind === 'voice' ? 'voice' : 'text', category: clean(r.category, 40) || 'КОМНАТЫ', topic: '', position: i++ }, perms);
      }
      return { teamId };
    },

    /** Применить настройки сообщества целиком: название, роли, комнаты, роли участников. */
    async 'update-community'({ teamId, name, color, roles, rooms, members }) {
      const me = await requireRole(teamId, ['owner', 'admin']);
      const isOwner = me.roles.includes('owner');
      const community = await get('communities', teamId);
      if (!community) throw notFound('Сообщество не найдено');
      const perms = teamRead(teamId);

      if (name !== undefined || color !== undefined) {
        const title = clean(name ?? community.name, 40) || community.name;
        await update('communities', teamId, { name: title, color: clean(color ?? community.color, 16) });
        if (title !== community.name) await teams.updateName({ teamId, name: title });
      }

      if (Array.isArray(rooms)) {
        const current = await list('rooms', [Query.equal('teamId', teamId)]);
        const keep = new Set();
        let i = 0;
        for (const r of rooms.slice(0, 100)) {
          const row = {
            name: clean(r.name, 40) || 'комната',
            kind: r.kind === 'voice' ? 'voice' : 'text',
            category: clean(r.category, 40) || 'КОМНАТЫ',
            topic: clean(r.topic, 200),
            slowmode: Math.max(0, Math.min(3600, parseInt(r.slowmode) || 0)),
            stage: r.kind === 'voice' && !!r.stage,
            position: i++,
          };
          const old = current.find((c) => c.$id === r.id);
          if (old) await update('rooms', old.$id, row);
          else await create('rooms', { teamId, ...row }, perms, r.id || ID.unique());
          keep.add(r.id);
        }
        for (const c of current) if (!keep.has(c.$id)) {
          await remove('rooms', c.$id);
          await removeWhere('messages', [Query.equal('chatId', c.$id)]);
        }
      }

      const currentRoles = await list('roles', [Query.equal('teamId', teamId)]);
      if (Array.isArray(roles) && isOwner) {
        const keep = new Set();
        let i = 1;
        for (const r of roles.slice(0, 50)) {
          const old = currentRoles.find((c) => c.$id === r.id);
          if (old?.key === 'owner') {
            keep.add(old.$id);
            continue;
          }
          const row = { name: clean(r.name, 30) || 'Роль', color: clean(r.color, 16), perms: JSON.stringify({ ...NO_PERMS, ...(r.perms ?? {}) }), position: old?.key === 'everyone' ? 100 : i++ };
          if (old) await update('roles', old.$id, row);
          else await create('roles', { teamId, key: '', ...row }, perms, r.id || ID.unique());
          keep.add(r.id);
        }
        for (const c of currentRoles) if (!keep.has(c.$id) && !c.key) {
          await remove('roles', c.$id);
          await removeWhere('memberRoles', [Query.equal('teamId', teamId), Query.equal('roleId', c.$id)]);
        }
      }

      if (members && typeof members === 'object' && isOwner) {
        const allRoles = await list('roles', [Query.equal('teamId', teamId)]);
        const assigned = await list('memberRoles', [Query.equal('teamId', teamId)]);
        for (const [uid, roleId] of Object.entries(members)) {
          const role = allRoles.find((r) => r.$id === roleId);
          const m = await membership(teamId, uid);
          if (!role || !m || m.roles.includes('owner')) continue;
          const row = assigned.find((a) => a.userId === uid);
          if (role.key === 'everyone') {
            if (row) await remove('memberRoles', row.$id);
          } else if (row) await update('memberRoles', row.$id, { roleId });
          else await create('memberRoles', { teamId, userId: uid, roleId }, perms);
          await teams.updateMembership({ teamId, membershipId: m.$id, roles: teamRolesFor(parse(role.perms, NO_PERMS), false) });
        }
      }
      return { ok: true };
    },

    async 'delete-community'({ teamId }) {
      await requireRole(teamId, ['owner']);
      for (const t of COMMUNITY_TABLES) await removeWhere(t, [Query.equal('teamId', teamId)]);
      if (await get('communities', teamId)) await remove('communities', teamId);
      await teams.delete({ teamId });
      return { ok: true };
    },

    async 'create-invite'({ teamId }) {
      await requireMember(teamId);
      const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
      const code = Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await create('invites', { teamId, createdBy: userId, expiresAt, uses: 0 }, teamRead(teamId), code);
      return { code, expiresAt };
    },

    async join({ code }) {
      const c = String(code ?? '').trim().split('/').pop().toLowerCase();
      const inv = c ? await get('invites', c) : null;
      if (!inv || Date.parse(inv.expiresAt) < Date.now()) throw notFound('Приглашение не найдено или устарело');
      const banned = await list('bans', [Query.equal('teamId', inv.teamId), Query.equal('userId', userId)]);
      if (banned.length) throw forbid('Тебя заблокировали в этом сообществе');
      if (!(await membership(inv.teamId))) await teams.createMembership({ teamId: inv.teamId, userId, roles: ['member'] });
      await update('invites', inv.$id, { uses: (inv.uses ?? 0) + 1 });
      return { teamId: inv.teamId };
    },

    async leave({ teamId }) {
      const m = await requireMember(teamId);
      if (m.roles.includes('owner')) throw bad('Владелец не может выйти — можно удалить сообщество');
      await teams.deleteMembership({ teamId, membershipId: m.$id });
      await removeWhere('memberRoles', [Query.equal('teamId', teamId), Query.equal('userId', userId)]);
      return { ok: true };
    },

    /** Личная переписка — это отдельная команда из двух человек. */
    async 'open-dm'({ userId: other }) {
      if (!other || other === userId) throw bad('Нужен собеседник');
      await users.get({ userId: other }).catch(() => {
        throw notFound('Пользователь не найден');
      });
      await requireNotBlocked(other);
      const [a, b] = [userId, other].sort();
      const existing = await list('dms', [Query.equal('userA', a), Query.equal('userB', b)]);
      if (existing[0]) return { teamId: existing[0].$id };
      const teamId = ID.unique();
      await teams.create({ teamId, name: 'dm' });
      await teams.createMembership({ teamId, userId: a, roles: ['member'] });
      await teams.createMembership({ teamId, userId: b, roles: ['member'] });
      await create('dms', { userA: a, userB: b }, [Permission.read(Role.user(a)), Permission.read(Role.user(b))], teamId);
      return { teamId };
    },

    async 'friend-request'({ username, userId: target }) {
      let to = target;
      if (!to) {
        const rows = await list('profiles', [Query.equal('username', normUsername(username))]);
        if (!rows[0]) throw notFound('Пользователь с таким именем не найден');
        to = rows[0].$id;
      }
      if (to === userId) throw bad('Это ты :)');
      await requireNotBlocked(to);
      const both = [
        ...(await list('friendships', [Query.equal('fromId', userId), Query.equal('toId', to)])),
        ...(await list('friendships', [Query.equal('fromId', to), Query.equal('toId', userId)])),
      ];
      const incoming = both.find((f) => f.fromId === to && f.status === 'pending');
      if (incoming) {
        await update('friendships', incoming.$id, { status: 'accepted' });
        return { status: 'accepted' };
      }
      if (both.some((f) => f.status === 'accepted')) return { status: 'accepted' };
      if (both.length) return { status: 'pending' };
      await create('friendships', { fromId: userId, toId: to, status: 'pending' }, [
        Permission.read(Role.user(userId)),
        Permission.read(Role.user(to)),
      ]);
      return { status: 'sent' };
    },

    async 'friend-accept'({ userId: from }) {
      const rows = await list('friendships', [Query.equal('fromId', from), Query.equal('toId', userId)]);
      if (!rows[0]) throw notFound('Заявка не найдена');
      await update('friendships', rows[0].$id, { status: 'accepted' });
      return { ok: true };
    },

    async 'friend-remove'({ userId: other }) {
      const rows = [
        ...(await list('friendships', [Query.equal('fromId', userId), Query.equal('toId', other)])),
        ...(await list('friendships', [Query.equal('fromId', other), Query.equal('toId', userId)])),
      ];
      for (const r of rows) await remove('friendships', r.$id);
      return { ok: true };
    },

    /** Удалить чужое сообщение — нужна роль модератора. Своё клиент удаляет сам. */
    async 'delete-message'({ messageId }) {
      const msg = await get('messages', messageId);
      if (!msg) return { ok: true };
      if (msg.authorId !== userId) await requireRole(msg.teamId, ['owner', 'admin', 'mod']);
      await removeWhere('reactions', [Query.equal('messageId', messageId)]);
      await remove('messages', messageId);
      return { ok: true };
    },

    /** Доступ в голосовую комнату через LiveKit — только участникам сообщества.
     *  Звонок в личке (dmId) — только двоим участникам этой переписки. */
    async 'voice-token'({ roomId, dmId, groupId }) {
      let roomName;
      let canSpeak = true;
      if (groupId) {
        if (!(await get('groups', groupId))) throw notFound('Группа не найдена');
        await requireMember(groupId);
        roomName = `group-${groupId}`;
      } else if (dmId) {
        const dm = await get('dms', dmId);
        if (!dm || (dm.userA !== userId && dm.userB !== userId)) throw forbid('Нет доступа к звонку');
        roomName = `call-${dm.$id}`;
      } else {
        const room = await get('rooms', roomId);
        if (!room || room.kind !== 'voice') throw forbid('Нет доступа к комнате');
        const m = await requireMember(room.teamId);
        roomName = `voice-${room.$id}`;
        // сцена: говорят модераторы и те, кому дали слово, остальные слушают
        if (room.stage) canSpeak = m.roles.some((r) => MODS.includes(r)) || parse(room.speakers, []).includes(userId);
      }
      if (!ctx.livekit) throw new HttpError(500, 'livekit_missing', 'Голос не настроен на сервере');
      const profile = await get('profiles', userId);
      const token = await ctx.livekit.token({ identity: userId, name: profile?.displayName ?? 'Fizion', room: roomName, canPublish: canSpeak });
      return { token, url: ctx.livekit.url, canSpeak };
    },

    /* ---------- группы: переписка на нескольких без сообщества ---------- */

    async 'create-group'({ name, userIds = [] }) {
      const title = clean(name, 40) || 'Группа';
      const ids = [...new Set((Array.isArray(userIds) ? userIds : []).filter((x) => x && x !== userId))].slice(0, 49);
      for (const id of ids) {
        if (!(await isFriend(userId, id))) throw forbid('В группу можно добавить только друзей');
        await requireNotBlocked(id);
      }
      const teamId = ID.unique();
      await teams.create({ teamId, name: 'group' });
      await teams.createMembership({ teamId, userId, roles: ['member', 'owner'] });
      for (const id of ids) await teams.createMembership({ teamId, userId: id, roles: ['member'] });
      const colors = ['#2F8CFF', '#FF6A3D', '#22D3EE', '#A78BFA', '#34D399', '#F472B6', '#FBBF24'];
      await create('groups', { name: title, color: colors[Math.floor(Math.random() * colors.length)], ownerId: userId }, teamRead(teamId), teamId);
      return { teamId };
    },

    /** «Избранное»: личный чат с самим собой — заметки, ссылки, пересланное. Создаётся один раз. */
    async 'saved-chat'() {
      const mine = await list('groups', [Query.equal('ownerId', userId), Query.equal('kind', 'saved')]);
      if (mine.length) return { teamId: mine[0].$id };
      const teamId = ID.unique();
      await teams.create({ teamId, name: 'saved' });
      await teams.createMembership({ teamId, userId, roles: ['member', 'owner'] });
      await create('groups', { name: 'Избранное', color: '#5865F2', ownerId: userId, kind: 'saved' }, teamRead(teamId), teamId);
      return { teamId };
    },

    async 'group-add'({ groupId, userId: other }) {
      await requireMember(groupId);
      const g = await get('groups', groupId);
      if (!g) throw notFound('Группа не найдена');
      if (g.kind === 'saved') throw bad('В «Избранное» нельзя добавлять людей');
      if (!(await isFriend(userId, other))) throw forbid('Добавить можно только друга');
      await requireNotBlocked(other);
      const r = await teams.listMemberships({ teamId: groupId, queries: [Query.limit(100)] });
      if (r.memberships.length >= 50) throw bad('В группе уже 50 человек');
      if (!r.memberships.some((m) => m.userId === other)) await teams.createMembership({ teamId: groupId, userId: other, roles: ['member'] });
      return { ok: true };
    },

    async 'group-rename'({ groupId, name }) {
      await requireMember(groupId);
      const title = clean(name, 40);
      if (!title) throw bad('Нужно название');
      await update('groups', groupId, { name: title });
      return { ok: true };
    },

    async 'group-leave'({ groupId }) {
      const m = await requireMember(groupId);
      const group = await get('groups', groupId);
      await teams.deleteMembership({ teamId: groupId, membershipId: m.$id });
      const left = (await teams.listMemberships({ teamId: groupId, queries: [Query.limit(100)] })).memberships;
      if (!left.length) {
        for (const t of ['messages', 'reactions']) await removeWhere(t, [Query.equal('teamId', groupId)]);
        if (group) await remove('groups', groupId);
        await teams.delete({ teamId: groupId });
      } else if (group?.ownerId === userId) await update('groups', groupId, { ownerId: left[0].userId });
      return { ok: true };
    },

    /* ---------- модерация сообществ ---------- */

    async kick({ teamId, userId: target }) {
      const { them } = await requireModOver(teamId, target);
      if (!them) throw notFound('Этого человека нет в сообществе');
      await removeMember(teamId, target, them);
      return { ok: true };
    },

    async ban({ teamId, userId: target, reason }) {
      const { them } = await requireModOver(teamId, target);
      await removeMember(teamId, target, them);
      const exists = await list('bans', [Query.equal('teamId', teamId), Query.equal('userId', target)]);
      if (!exists.length) await create('bans', { teamId, userId: target, by: userId, reason: clean(reason, 200) }, teamRead(teamId));
      return { ok: true };
    },

    async unban({ teamId, userId: target }) {
      await requireRole(teamId, MODS);
      await removeWhere('bans', [Query.equal('teamId', teamId), Query.equal('userId', target)]);
      return { ok: true };
    },

    /** Мут: человек остаётся в сообществе, но не может писать до указанного времени */
    async mute({ teamId, userId: target, minutes }) {
      await requireModOver(teamId, target);
      const min = Math.max(1, Math.min(60 * 24 * 28, parseInt(minutes) || 10));
      const until = new Date(Date.now() + min * 60_000).toISOString();
      const old = await list('mutes', [Query.equal('teamId', teamId), Query.equal('userId', target)]);
      if (old[0]) await update('mutes', old[0].$id, { until, by: userId });
      else await create('mutes', { teamId, userId: target, until, by: userId }, teamRead(teamId));
      return { until };
    },

    async unmute({ teamId, userId: target }) {
      await requireRole(teamId, MODS);
      await removeWhere('mutes', [Query.equal('teamId', teamId), Query.equal('userId', target)]);
      return { ok: true };
    },

    /** Жалоба на сообщение — видят только модераторы этого сообщества */
    async report({ messageId, reason }) {
      const msg = await get('messages', messageId);
      if (!msg) throw notFound('Сообщение уже удалено');
      await requireMember(msg.teamId);
      if (!(await get('communities', msg.teamId))) throw bad('Жаловаться можно на сообщения в сообществах');
      if (msg.authorId === userId) throw bad('Это твоё сообщение');
      const dup = await list('reports', [Query.equal('messageId', messageId), Query.equal('reporterId', userId)]);
      if (dup.length) return { ok: true };
      await create(
        'reports',
        { teamId: msg.teamId, messageId, chatId: msg.chatId, reporterId: userId, authorId: msg.authorId, reason: clean(reason, 200) || 'Без причины', text: clean(msg.text, 500), status: 'open' },
        modsOnly(msg.teamId),
      );
      return { ok: true };
    },

    async 'resolve-report'({ reportId, decision: action, minutes }) {
      const rep = await get('reports', reportId);
      if (!rep) throw notFound('Жалоба не найдена');
      await requireRole(rep.teamId, MODS);
      const actions = createActions(ctx);
      if (action === 'delete' || action === 'mute' || action === 'ban') {
        if (await get('messages', rep.messageId)) {
          await removeWhere('reactions', [Query.equal('messageId', rep.messageId)]);
          await remove('messages', rep.messageId);
        }
      }
      if (action === 'mute') await actions.mute({ teamId: rep.teamId, userId: rep.authorId, minutes: minutes ?? 60 });
      if (action === 'ban') await actions.ban({ teamId: rep.teamId, userId: rep.authorId, reason: rep.reason });
      // закрываем и другие жалобы на это же сообщение
      for (const r of await list('reports', [Query.equal('messageId', rep.messageId), Query.equal('status', 'open')])) await update('reports', r.$id, { status: action === 'dismiss' ? 'dismissed' : 'resolved' });
      return { ok: true };
    },

    /* ---------- истории только для друзей ---------- */

    async 'post-story'({ fileId, url, kind, caption, hours = 24 }) {
      const friends = (await friendsOf(userId)).slice(0, 90);
      const expiresAt = new Date(Date.now() + Math.min(48, Math.max(1, hours)) * 3_600_000).toISOString();
      return create(
        'stories',
        { authorId: userId, fileId: clean(fileId, 36), url: clean(url, 1024), kind: kind === 'video' ? 'video' : 'image', caption: clean(caption, 200), expiresAt, audience: 'friends' },
        [Permission.read(Role.user(userId)), ...friends.map((f) => Permission.read(Role.user(f))), Permission.delete(Role.user(userId))],
      );
    },

    /* ---------- ключи сквозного шифрования ---------- */

    /** Открытый ключ виден всем, закрытый лежит зашифрованным секретной фразой — сервер его прочитать не может */
    /* ---------- вебхуки и боты ---------- */

    /** Новый вебхук для комнаты. Секрет показывается один раз — хранится только его хеш. */
    async 'webhook-create'({ teamId, roomId, name, outUrl = '' }) {
      await requireRole(teamId, MODS);
      const room = await get('rooms', roomId);
      if (!room || room.teamId !== teamId || room.kind !== 'text') throw bad('Нужна текстовая комната этого сообщества');
      const out = clean(outUrl, 500);
      if (out && !/^https:\/\/[^\s]+$/.test(out)) throw bad('Адрес бота должен начинаться с https://');
      if ((await list('webhooks', [Query.equal('teamId', teamId)])).length >= 25) throw bad('В сообществе уже 25 вебхуков');
      const token = randomToken();
      const row = await create(
        'webhooks',
        { teamId, roomId, name: clean(name, 40) || 'Бот', tokenHash: sha256(token), outUrl: out, by: userId },
        modsOnly(teamId),
      );
      return { id: row.$id, token };
    },

    async 'webhook-list'({ teamId }) {
      await requireRole(teamId, MODS);
      const rows = await list('webhooks', [Query.equal('teamId', teamId)]);
      return { hooks: rows.map((r) => ({ id: r.$id, roomId: r.roomId, name: r.name, outUrl: r.outUrl, createdAt: r.$createdAt })) };
    },

    async 'webhook-reset'({ id }) {
      const hook = await get('webhooks', id);
      if (!hook) throw notFound('Вебхук не найден');
      await requireRole(hook.teamId, MODS);
      const token = randomToken();
      await update('webhooks', id, { tokenHash: sha256(token) });
      return { id, token };
    },

    async 'webhook-delete'({ id }) {
      const hook = await get('webhooks', id);
      if (!hook) return { ok: true };
      await requireRole(hook.teamId, MODS);
      await remove('webhooks', id);
      return { ok: true };
    },

    /* ---------- сцена: эфир, где говорят только приглашённые ---------- */

    /** Дать слово слушателю или убрать со сцены (модераторы) */
    async 'stage-speaker'({ roomId, userId: target, on = true }) {
      const room = await get('rooms', roomId);
      if (!room || room.kind !== 'voice' || !room.stage) throw bad('Это не сцена');
      await requireRole(room.teamId, MODS);
      const speakers = new Set(parse(room.speakers, []));
      if (on) speakers.add(target);
      else speakers.delete(target);
      await update('rooms', roomId, { speakers: JSON.stringify([...speakers].slice(0, 50)) });
      // права в уже идущем эфире меняются сразу, без переподключения
      await ctx.livekit?.setPublish?.(`voice-${roomId}`, target, on).catch(() => undefined);
      return { ok: true };
    },

    /* ---------- блокировка ---------- */

    /** Заблокировать: он не сможет написать в личку, позвонить, добавить в друзья или в группу */
    async block({ userId: other }) {
      if (!other || other === userId) throw bad('Нужен человек');
      if (!(await list('blocks', [Query.equal('by', userId), Query.equal('userId', other)])).length)
        await create('blocks', { by: userId, userId: other }, [Permission.read(Role.user(userId)), Permission.delete(Role.user(userId))]);
      const rows = [
        ...(await list('friendships', [Query.equal('fromId', userId), Query.equal('toId', other)])),
        ...(await list('friendships', [Query.equal('fromId', other), Query.equal('toId', userId)])),
      ];
      for (const r of rows) await remove('friendships', r.$id);
      return { ok: true };
    },

    async unblock({ userId: other }) {
      await removeWhere('blocks', [Query.equal('by', userId), Query.equal('userId', other)]);
      return { ok: true };
    },

    /* ---------- закреплённые сообщения ---------- */

    /** Закрепить или открепить. В личных и группах — любой участник, в сообществе — модераторы. */
    async pin({ messageId, on = true }) {
      const msg = await get('messages', messageId);
      if (!msg) throw notFound('Сообщение не найдено');
      const community = await get('communities', msg.teamId);
      if (community) await requireRole(msg.teamId, MODS);
      else await requireMember(msg.teamId);
      const old = await get('pins', messageId);
      if (!on) {
        if (old) await remove('pins', messageId);
        return { ok: true };
      }
      if (!old) {
        const pins = await list('pins', [Query.equal('chatId', msg.chatId)]);
        if (pins.length >= 50) throw bad('Закреплено уже 50 сообщений — открепи старые');
        await create('pins', { chatId: msg.chatId, teamId: msg.teamId, messageId, by: userId }, teamRead(msg.teamId), messageId);
      }
      return { ok: true };
    },

    /* ---------- удаление аккаунта ---------- */

    /** Удалить аккаунт насовсем: свои сообщества, участие везде, профиль, ключи, подписки. */
    async 'delete-account'({ confirm }) {
      if (confirm !== 'удалить') throw bad('Подтверди удаление словом «удалить»');
      const { memberships = [] } = await users.listMemberships({ userId }).catch(() => ({ memberships: [] }));
      for (const m of memberships) {
        if (m.roles.includes('owner') && (await get('communities', m.teamId))) {
          // своё сообщество удаляем целиком
          for (const tb of COMMUNITY_TABLES) await removeWhere(tb, [Query.equal('teamId', m.teamId)]).catch(() => undefined);
          await remove('communities', m.teamId).catch(() => undefined);
          await teams.delete({ teamId: m.teamId }).catch(() => undefined);
        } else await removeMember(m.teamId, userId, m);
      }
      for (const [tb, col] of [
        ['friendships', 'fromId'],
        ['friendships', 'toId'],
        ['blocks', 'by'],
        ['blocks', 'userId'],
        ['devices', 'userId'],
        ['keyshares', 'userId'],
        ['pushSubs', 'userId'],
        ['stories', 'authorId'],
        ['reels', 'authorId'],
        ['reads', 'userId'],
      ])
        await removeWhere(tb, [Query.equal(col, userId)]).catch(() => undefined);
      for (const id of ['profiles', 'keys']) if (await get(id, userId)) await remove(id, userId);
      await users.delete({ userId });
      return { ok: true };
    },

    /** Открытый ключ шифрования. Сменить уже существующий можно только явно (rotate) — чтобы новое
     *  устройство случайно не затёрло ключ, которым зашифрована вся переписка. */
    async 'set-key'({ publicKey, rotate = false }) {
      const pub = clean(publicKey, 200);
      if (!pub || !/^[A-Za-z0-9+/=]{60,200}$/.test(pub)) throw bad('Нет ключа');
      const row = { publicKey: pub, encPrivate: '-', salt: '', iv: '' };
      const old = await get('keys', userId);
      if (old) {
        if (old.publicKey === pub) return { ok: true };
        if (!rotate) throw new HttpError(409, 'key_exists', 'Ключ уже создан на другом устройстве');
        await update('keys', userId, row);
      } else await create('keys', row, [Permission.read(Role.users()), Permission.delete(Role.user(userId))], userId);
      return { ok: true };
    },
  };
}

/** Выполнить действие по имени. Возвращает { status, body }. */
export async function run(ctx, action, payload) {
  if (!ctx.userId) return { status: 401, body: { error: 'Нужно войти', code: 'unauthorized' } };
  const actions = createActions(ctx);
  const fn = actions[action];
  if (!fn) return { status: 400, body: { error: 'Неизвестное действие', code: 'unknown_action' } };
  try {
    return { status: 200, body: await fn(payload ?? {}) };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { error: e.message, code: e.code } };
    if (e?.code === 409) return { status: 409, body: { error: 'Такая запись уже есть', code: 'conflict' } };
    ctx.log?.(String(e?.stack ?? e));
    return { status: 500, body: { error: 'Ошибка сервера', code: 'server_error' } };
  }
}
