// Проверка ключей LiveKit: npm run check:voice
// Ошибка «invalid token» при звонке почти всегда значит, что ключ и секрет не от того проекта,
// что указан в LIVEKIT_URL, или при копировании захватились лишние символы. Эта команда это ловит.

import { pathToFileURL } from 'node:url';
import { RoomServiceClient } from 'livekit-server-sdk';

/** Убрать кавычки, пробелы и невидимые символы, которые цепляются при копировании */
export const cleanSecret = (v) =>
  (v ?? '')
    .replace(/[\u200B-\u200D\uFEFF\r\n\t]/g, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

/** wss://проект.livekit.cloud — даже если вставили https:// или ссылку из панели */
export function normalizeUrl(raw) {
  let v = cleanSecret(raw);
  if (!v) return '';
  if (!/^[a-z]+:\/\//i.test(v)) v = `wss://${v}`;
  const u = new URL(v);
  return `${u.protocol === 'ws:' || u.protocol === 'http:' ? 'ws' : 'wss'}://${u.host}`;
}

/** Начало сообщения «проблема только с часами компьютера» — настройка может продолжаться */
export const CLOCK = 'ЧАСЫ: ';

/** Насколько часы компьютера расходятся с сервером LiveKit (секунды; плюс — спешат) */
async function clockSkew(http) {
  try {
    const r = await fetch(http, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    const d = Date.parse(r.headers.get('date') ?? '');
    return Number.isFinite(d) ? (Date.now() - d) / 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Проверить ключи на настоящем сервере LiveKit.
 * Возвращает null, если всё хорошо, или текст ошибки по-русски.
 */
export async function verifyLivekit({ url, key, secret }) {
  if (!url || !key || !secret) return 'не заданы LIVEKIT_URL, LIVEKIT_API_KEY или LIVEKIT_API_SECRET';
  if (/cloud\.livekit\.io/i.test(url)) return `LIVEKIT_URL — это адрес панели управления, а нужен адрес проекта вида wss://имя-xxxx.livekit.cloud (LiveKit → Settings → Project → URL)`;
  if (!/^API/i.test(key)) return `LIVEKIT_API_KEY должен начинаться с «API…». Похоже, ключ и секрет перепутаны местами`;
  if (/[^\x21-\x7E]/.test(secret) || /^[*•.]+$/.test(secret))
    return 'в LIVEKIT_API_SECRET скопированы точки-«звёздочки» (•••), а не сам секрет. LiveKit показывает настоящий секрет только один раз — в окне сразу после Create key (кнопка копирования рядом). Создай новый ключ и скопируй секрет оттуда';
  if (secret.length < 20) return 'LIVEKIT_API_SECRET слишком короткий — скопируй его целиком (LiveKit → Settings → Keys)';
  const http = url.replace(/^ws/, 'http');
  try {
    await new RoomServiceClient(http, key, secret).listRooms();
    return null;
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/401|unauthor|invalid token|signature|permission/i.test(msg)) {
      // частая причина — неверные часы на компьютере: токен проверки «из будущего» или «просрочен»
      const skew = await clockSkew(http);
      if (skew !== null && Math.abs(skew) > 60)
        return `${CLOCK}часы на этом компьютере ${skew > 0 ? 'спешат' : 'отстают'} примерно на ${Math.round(Math.abs(skew) / 60)} мин — из-за этого LiveKit не принимает проверку. Включи «Параметры → Время и язык → Дата и время → Установить время автоматически» и нажми «Синхронизировать». На звонки это не влияет: их ключ выдаёт сервер Appwrite со своими часами`;
      return `LiveKit не принял ключ (${msg}).
  Сейчас в .env.setup: ключ «${key.slice(0, 6)}…${key.slice(-3)}» (${key.length} символов), секрет ${secret.length} символов (обычно 40–45), адрес ${url}.
  Проверь:
   1) в LiveKit слева вверху выбран проект, у которого Settings → Project → URL = ${url};
   2) ключ создан именно в нём (Settings → Keys) и совпадает с «${key.slice(0, 6)}…»;
   3) секрет скопирован целиком сразу при создании ключа (потом LiveKit его не показывает — если не уверен, создай ключ заново);
   4) в .env.setup строки ровно такие: LIVEKIT_API_KEY=API... и LIVEKIT_API_SECRET=... — без пробелов вокруг «=», каждая на своей строке, и файл сохранён`;
    }
    if (/ENOTFOUND|getaddrinfo|fetch failed|ECONN/i.test(msg)) return `не удалось достучаться до ${url} — проверь адрес проекта (LiveKit → Settings → Project → URL)`;
    return `проверка не удалась: ${msg}`;
  }
}

// запуск как отдельной команды
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = normalizeUrl(process.env.LIVEKIT_URL);
  const err = await verifyLivekit({ url, key: cleanSecret(process.env.LIVEKIT_API_KEY), secret: cleanSecret(process.env.LIVEKIT_API_SECRET) });
  if (err?.startsWith(CLOCK)) {
    console.warn(`\n! ${err.slice(CLOCK.length)}\n`);
    process.exit(0);
  }
  if (err) {
    console.error(`\n✖ ${err}\n`);
    process.exit(1);
  }
  console.log(`\n✔ Ключи LiveKit подходят к ${url}.`);
  console.log('  Если звонки всё равно не идут — выполни npm run setup, чтобы ключи попали на сервер Appwrite.\n');
}
