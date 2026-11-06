// Уведомления о сообщениях и звонках, пока Fizion открыт или свёрнут (в том числе в трей на Windows).
// Когда Fizion закрыт совсем, в браузере и на телефоне приходят push-уведомления (см. lib/push.ts).

import { ME } from '../data';
import { getState } from '../store';
import type { Message } from '../types';
import { showWindow } from './desktop';

let unread = 0;

function resetUnread() {
  unread = 0;
  document.title = 'Fizion';
  (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.().catch(() => undefined);
}

function bump() {
  unread++;
  document.title = `(${unread}) Fizion`;
  (navigator as Navigator & { setAppBadge?: (n: number) => Promise<void> }).setAppBadge?.(unread).catch(() => undefined);
}

export function initNotify() {
  window.addEventListener('focus', resetUnread);
  document.addEventListener('visibilitychange', () => !document.hidden && document.hasFocus() && resetUnread());
}

export const canNotify = () => typeof Notification !== 'undefined';
export const notifyPermission = () => (canNotify() ? Notification.permission : 'denied');
export async function askNotifyPermission() {
  if (!canNotify()) return 'denied';
  return Notification.requestPermission();
}

/** Пользователь сейчас смотрит именно этот чат? */
function looking(chatKey: string) {
  if (document.hidden || !document.hasFocus()) return false;
  const s = getState();
  if (chatKey.startsWith('dm:') || chatKey.startsWith('g:')) return s.ui.view === 'home' && s.ui.homeTab === (chatKey.startsWith('dm:') ? chatKey.slice(3) : chatKey);
  return s.ui.view === 'server' && !!s.ui.serverId && s.lastChannel[s.ui.serverId] === chatKey;
}

export function previewOf(m: Message) {
  if (m.text) return m.text.length > 140 ? m.text.slice(0, 139) + '…' : m.text;
  const t = m.attachment?.type ?? '';
  if (m.attachment?.sticker) return `${m.attachment.sticker.emoji} Стикер`;
  if (m.attachment?.round) return '⭕ Видеосообщение';
  if (m.attachment?.poll) return `📊 Опрос: ${m.attachment.poll.q}`;
  if (m.attachment?.game) return { dice: '🎲 Кубик', coin: '🪙 Монетка', darts: '🎯 Дартс', slot: '🎰 Слоты' }[m.attachment.game.kind];
  return t.startsWith('image/') ? '🖼 Фото' : t.startsWith('video/') ? '🎬 Видео' : t.startsWith('audio/') ? '🎤 Голосовое сообщение' : m.attachment ? '📎 ' + m.attachment.name : 'Новое сообщение';
}

function show(title: string, body: string, tag: string, open: () => void, requireInteraction = false) {
  if (!canNotify() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/icons/icon-192.png', requireInteraction });
    n.onclick = () => {
      window.focus();
      void showWindow();
      open();
      n.close();
    };
  } catch {
    /* на некоторых телефонах уведомления можно показывать только из service worker */
  }
}

/** Новое сообщение: личные и группы — всегда, комнаты сообществ — только если упомянули */
export function notifyMessage(chatKey: string, m: Message, kind: 'dm' | 'group' | 'room', title: string, open: () => void) {
  if (m.authorId === ME) return;
  const s = getState();
  const mode = s.settings.notify ?? 'all';
  if (mode === 'off') return;
  const tags = [s.profile.username, s.profile.displayName].filter(Boolean).map((t) => '@' + t.toLowerCase());
  const mention = tags.some((t) => m.text.toLowerCase().includes(t));
  if (kind === 'room' && !mention) return;
  if (kind === 'group' && mode === 'dm' && !mention) return;
  if (looking(chatKey)) return;
  bump();
  show(title, previewOf(m), chatKey, open);
}

/** Входящий звонок: на Windows ещё и поднимаем окно из трея */
export function notifyCall(name: string, video: boolean, where?: string) {
  if ((getState().settings.notify ?? 'all') === 'off') return;
  void showWindow();
  if (!document.hidden && document.hasFocus()) return;
  show(where ? `📞 Звонок в «${where}»` : '📞 Входящий звонок', `${name} ${where ? 'начал звонок' : video ? 'звонит по видео' : 'звонит'}`, 'call', () => undefined, true);
}
