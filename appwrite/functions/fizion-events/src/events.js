// Функция fizion-events запускается сама на события базы:
//  - новое сообщение: проверка мута и медленного режима, затем push-уведомления получателям;
//  - новый звонок: push «Входящий звонок» тем, кому звонят.
// Зависимости передаются снаружи (ctx), поэтому логику можно проверить без сети.

export const DB = 'fizion';

const BODY_MAX = 140;

/** Короткий текст уведомления. Зашифрованное сервер прочитать не может — пишем просто «сообщение». */
export function previewText(row) {
  const text = String(row.text ?? '');
  if (text.startsWith('e2e:')) return '🔒 Зашифрованное сообщение';
  if (text.trim()) return text.length > BODY_MAX ? text.slice(0, BODY_MAX - 1) + '…' : text;
  try {
    const a = JSON.parse(row.attachment || 'null');
    if (a?.sticker) return `${a.sticker.emoji || ''} Стикер`.trim();
    if (a?.poll) return '📊 Опрос: ' + String(a.poll.q || '').slice(0, 100);
    if (a?.game) return '🎲 Мини-игра';
    if (a?.round) return '⭕ Видеосообщение';
    if (a?.type?.startsWith('image/')) return '🖼 Фото';
    if (a?.type?.startsWith('video/')) return '🎬 Видео';
    if (a?.type?.startsWith('audio/')) return '🎤 Голосовое сообщение';
    if (a) return '📎 ' + (a.name || 'Файл');
  } catch {
    /* без вложения */
  }
  return 'Новое сообщение';
}

export const mentionsIn = (text) => [...String(text ?? '').matchAll(/@([a-z0-9._]{2,32})/gi)].map((m) => m[1].toLowerCase());

export function createEvents(ctx) {
  const { db, teams, users = null, Query, push, log = () => undefined, fetch: fetchFn = null, hmac = null } = ctx;
  // метки людей (заморожен, бан) — запоминаем на время запуска функции
  const labelCache = new Map();
  const labelsOf = async (uid) => {
    if (!users || !uid) return [];
    if (!labelCache.has(uid)) labelCache.set(uid, await users.get({ userId: uid }).then((u) => u.labels ?? [], () => []));
    return labelCache.get(uid);
  };
  const get = async (tableId, rowId) => {
    try {
      return await db.getRow({ databaseId: DB, tableId, rowId });
    } catch (e) {
      if (e?.code === 404) return null;
      throw e;
    }
  };
  const list = async (tableId, queries) => (await db.listRows({ databaseId: DB, tableId, queries: [...queries, Query.limit(500)] })).rows;
  const members = async (teamId) => (await teams.listMemberships({ teamId, queries: [Query.limit(500)] })).memberships;

  async function deleteMessage(row) {
    await db.deleteRows({ databaseId: DB, tableId: 'reactions', queries: [Query.equal('messageId', row.$id)] }).catch(() => undefined);
    await db.deleteRow({ databaseId: DB, tableId: 'messages', rowId: row.$id }).catch(() => undefined);
  }

  /** Сообщение в сообществе нарушает мут или медленный режим? Тогда удаляем — сервер решает, а не приложение. */
  async function guard(row, community) {
    // имя бота ставит только функция вебхуков (метка bot — клиент сам её выдать не может)
    if (row.botName) {
      const hook = await get('webhooks', row.authorId);
      if (hook && hook.teamId === row.teamId && hook.roomId === row.chatId && (row.$permissions ?? []).includes('read("label:bot")')) return false;
      await deleteMessage(row);
      return true;
    }
    // автор — тот, кто создал строку: клиент может выдать право на изменение только самому себе
    if (!(row.$permissions ?? []).includes(`update("user:${row.authorId}")`)) {
      await deleteMessage(row);
      return true;
    }
    if (!community) return false;
    const team = await members(row.teamId);
    const author = team.find((m) => m.userId === row.authorId);
    if (!author) {
      await deleteMessage(row);
      return true;
    }
    if (author.roles.some((r) => r === 'owner' || r === 'admin' || r === 'mod')) return false;
    const mute = (await list('mutes', [Query.equal('teamId', row.teamId), Query.equal('userId', row.authorId)]))[0];
    if (mute && Date.parse(mute.until) > Date.now()) {
      await deleteMessage(row);
      return true;
    }
    const room = await get('rooms', row.chatId);
    const slow = room?.slowmode ?? 0;
    if (slow > 0) {
      const recent = await list('messages', [Query.equal('chatId', row.chatId), Query.equal('authorId', row.authorId), Query.orderDesc('$createdAt'), Query.limit(2)]);
      const prev = recent.find((m) => m.$id !== row.$id);
      if (prev && Date.parse(row.$createdAt) - Date.parse(prev.$createdAt) < slow * 1000) {
        await deleteMessage(row);
        return true;
      }
    }
    return false;
  }

  /** Отправить push всем подпискам этих людей, умершие подписки удалить */
  async function notify(userIds, payload) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length || !push) return 0;
    let sent = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const subs = await list('pushSubs', [Query.equal('userId', ids.slice(i, i + 100))]);
      for (const s of subs) {
        try {
          await push.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
          sent++;
        } catch (e) {
          if (e?.statusCode === 404 || e?.statusCode === 410) await db.deleteRow({ databaseId: DB, tableId: 'pushSubs', rowId: s.$id }).catch(() => undefined);
          else log(`push: ${e?.statusCode ?? ''} ${e?.message ?? e}`);
        }
      }
    }
    return sent;
  }

  /**
   * Огоньки дружбы 🔥: сколько дней подряд вы оба писали друг другу.
   * Пишут оба в один день — серия растёт; пропустили день — начинается заново.
   */
  async function streak(dm, row) {
    const day = (t) => new Date(t).toISOString().slice(0, 10);
    const today = day(row.$createdAt ?? Date.now());
    const yesterday = day(Date.parse(today) - 86_400_000);
    const data = {};
    if (row.authorId === dm.userA && dm.lastA !== today) data.lastA = today;
    if (row.authorId === dm.userB && dm.lastB !== today) data.lastB = today;
    if (!Object.keys(data).length) return;
    const lastA = data.lastA ?? dm.lastA;
    const lastB = data.lastB ?? dm.lastB;
    if (lastA === today && lastB === today && dm.streakDay !== today) {
      data.streak = dm.streakDay === yesterday ? (dm.streak ?? 0) + 1 : 1;
      data.streakDay = today;
    }
    await db.updateRow({ databaseId: DB, tableId: 'dms', rowId: dm.$id, data });
  }

  /** Боты сообщества: отправить им новое сообщение комнаты (исходящий вебхук) */
  async function toBots(row, community, authorName) {
    if (row.botName || !fetchFn) return 0;
    const hooks = (await list('webhooks', [Query.equal('roomId', row.chatId)])).filter((h) => h.outUrl);
    if (!hooks.length) return 0;
    const room = await get('rooms', row.chatId);
    const payload = JSON.stringify({
      type: 'message',
      id: row.$id,
      community: { id: row.teamId, name: community.name },
      room: { id: row.chatId, name: room?.name ?? '' },
      author: { id: row.authorId, name: authorName },
      content: String(row.text ?? '').slice(0, 2000),
      ts: row.$createdAt,
    });
    let n = 0;
    for (const h of hooks) {
      try {
        // подпись: HMAC-SHA256 тела, ключ — sha256 от секрета вебхука (бот знает секрет и сам посчитает ключ)
        const sig = hmac ? hmac(h.tokenHash, payload) : '';
        await fetchFn(h.outUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fizion-signature': sig, 'user-agent': 'Fizion-Bots/1.0' }, body: payload, signal: AbortSignal.timeout(4000) });
        n++;
      } catch (e) {
        log(`bot ${h.$id}: ${e?.message ?? e}`);
      }
    }
    return n;
  }

  return {
    async message(row) {
      // замороженный аккаунт: читать можно, писать нельзя
      if (!row.botName && (await labelsOf(row.authorId)).includes('frozen')) {
        await deleteMessage(row);
        return { deleted: true, frozen: true };
      }
      const community = await get('communities', row.teamId);
      if (await guard(row, community)) return { deleted: true };
      if (row.botName) return { sent: 0, bot: true };
      const author = await get('profiles', row.authorId);
      const name = author?.displayName ?? 'Neon';
      const body = previewText(row);
      if (community) {
        // в сообществе — только тем, кого упомянули через @имя (и ботам комнаты)
        const names = mentionsIn(row.text);
        const bots = await toBots(row, community, name);
        if (!names.length) return { sent: 0, bots };
        const profiles = await list('profiles', [Query.equal('username', names.slice(0, 50))]);
        const team = new Set((await members(row.teamId)).map((m) => m.userId));
        const to = profiles.map((p) => p.$id).filter((id) => id !== row.authorId && team.has(id));
        const room = await get('rooms', row.chatId);
        return { sent: await notify(to, { title: `${name} · ${community.name}`, body, tag: row.chatId, url: `/?server=${row.teamId}&room=${row.chatId}`, room: room?.name }), bots };
      }
      const group = await get('groups', row.teamId);
      if (group?.kind === 'channel') {
        // в канал пишут только владелец и админы канала; подписчикам — без push (как в Telegram, тихо)
        const m = (await members(row.teamId)).find((x) => x.userId === row.authorId);
        if (!m || !m.roles.some((r) => r === 'owner' || r === 'admin')) {
          await deleteMessage(row);
          return { deleted: true, channel: true };
        }
        const to = (await members(row.teamId)).map((x) => x.userId).filter((id) => id !== row.authorId);
        return { sent: await notify(to, { title: group.name, body, tag: row.chatId, url: `/?group=${row.teamId}` }) };
      }
      if (!group) {
        // личные: собеседник заблокировал автора — сообщение не доставляем
        const dm = await get('dms', row.teamId);
        const other = dm && (dm.userA === row.authorId ? dm.userB : dm.userA);
        if (other && (await list('blocks', [Query.equal('by', other), Query.equal('userId', row.authorId)])).length) {
          await deleteMessage(row);
          return { deleted: true, blocked: true };
        }
        if (dm) await streak(dm, row).catch((e) => log(`streak: ${e?.message ?? e}`));
      }
      const to = (await members(row.teamId)).map((m) => m.userId).filter((id) => id !== row.authorId);
      return {
        sent: await notify(to, {
          title: group ? `${name} · ${group.name}` : name,
          body,
          tag: row.chatId,
          url: group ? `/?group=${row.teamId}` : `/?dm=${row.authorId}`,
        }),
      };
    },

    async call(row) {
      if (row.status !== 'ringing') return { sent: 0 };
      if (row.toId && row.toId !== '*' && (await list('blocks', [Query.equal('by', row.toId), Query.equal('userId', row.fromId)])).length) {
        // звонок от заблокированного — сразу завершаем, без уведомления
        await db.updateRow({ databaseId: DB, tableId: 'calls', rowId: row.$id, data: { status: 'declined' } }).catch(() => undefined);
        return { sent: 0, blocked: true };
      }
      const author = await get('profiles', row.fromId);
      const name = author?.displayName ?? 'Neon';
      const group = await get('groups', row.dmId);
      const to = row.toId && row.toId !== '*' ? [row.toId] : (await members(row.dmId)).map((m) => m.userId).filter((id) => id !== row.fromId);
      return {
        sent: await notify(to, {
          title: group ? `📞 Звонок в «${group.name}»` : '📞 Входящий звонок',
          body: group ? `${name} начал звонок` : `${name} звонит${row.video ? ' по видео' : ''}`,
          tag: `call-${row.$id}`,
          url: group ? `/?group=${row.dmId}` : `/?dm=${row.fromId}`,
          urgent: true,
        }),
      };
    },
  };
}

/**
 * Новая сессия входа. Если у человека облачный пароль, сессия разрешена только из одноразового
 * токена, который выдал сервер после проверки пароля. Остальные (в обход пароля) удаляем сразу.
 */
export async function onSession(ctx, session) {
  const { db, users, log = () => undefined } = ctx;
  const uid = session?.userId;
  if (!uid) return { skipped: 'no user' };
  const sec = await db.getRow({ databaseId: DB, tableId: 'secure', rowId: uid }).catch(() => null);
  const labels = await users.get({ userId: uid }).then((u) => u.labels ?? [], () => []);
  const kill = async (why) => {
    await users.deleteSession({ userId: uid, sessionId: session.$id }).catch(() => undefined);
    await db.createRow({ databaseId: DB, tableId: 'logs', rowId: 'unique()', data: { kind: 'security', actorId: uid, targetId: uid, text: why }, permissions: [] }).catch(() => undefined);
    log(`session ${session.$id} of ${uid} removed: ${why}`);
    return { removed: true };
  };
  if (labels.includes('banned')) return kill('Попытка входа в забаненный аккаунт');
  if (!sec?.hash) return { ok: true };
  if (session.provider === 'token' && (sec.allowUntil ?? 0) > Date.now()) {
    await db.updateRow({ databaseId: DB, tableId: 'secure', rowId: uid, data: { allowUntil: 0 } }).catch(() => undefined);
    return { ok: true };
  }
  return kill('Вход без облачного пароля — сессия удалена');
}

/** По имени события Appwrite выбрать обработчик */
export async function handle(ctx, event, row) {
  const ev = createEvents(ctx);
  if (/\.tables\.messages\.rows\.[^.]+\.create$/.test(event)) return ev.message(row);
  if (/\.tables\.calls\.rows\.[^.]+\.create$/.test(event)) return ev.call(row);
  return { skipped: event };
}
