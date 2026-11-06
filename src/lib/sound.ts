// Звуки Neon: несколько наборов, собранных прямо в Web Audio (без файлов),
// и свои звуки — любой короткий файл до 5 секунд на любое событие.

import type { SoundEvent, SoundPrefs } from '../types';

let ctx: AudioContext | null = null;
let timer: number | undefined;
let ringEl: HTMLAudioElement | null = null;
let prefs: SoundPrefs = {};
let outputId: string | undefined;

/** Настройки звуков меняются в store — сюда их передаёт App */
export function setSoundPrefs(p: SoundPrefs | undefined, output?: string) {
  prefs = p ?? {};
  outputId = output || undefined;
}

const vol = () => Math.max(0, Math.min(1, (prefs.volume ?? 70) / 100));

type Note = [freq: number, at: number, len: number, type?: OscillatorType];
type Pack = Record<SoundEvent, Note[]>;

export const PACKS: Record<NonNullable<SoundPrefs['pack']>, { name: string; notes?: Pack }> = {
  classic: {
    name: 'Классика',
    notes: {
      message: [[880, 0, 0.09], [1320, 0.08, 0.12]],
      mention: [[988, 0, 0.1], [1319, 0.1, 0.1], [1760, 0.2, 0.16]],
      call: [[880, 0, 0.22], [660, 0.22, 0.22], [880, 0.44, 0.22], [660, 0.66, 0.22]],
      join: [[523, 0, 0.1], [784, 0.1, 0.16]],
      leave: [[784, 0, 0.1], [523, 0.1, 0.16]],
      mute: [[440, 0, 0.08]],
      unmute: [[660, 0, 0.08]],
      sent: [[1200, 0, 0.05]],
    },
  },
  soft: {
    name: 'Мягкие',
    notes: {
      message: [[523, 0, 0.18, 'triangle'], [659, 0.12, 0.25, 'triangle']],
      mention: [[659, 0, 0.18, 'triangle'], [784, 0.14, 0.18, 'triangle'], [1047, 0.28, 0.3, 'triangle']],
      call: [[523, 0, 0.3, 'triangle'], [659, 0.3, 0.3, 'triangle'], [784, 0.6, 0.4, 'triangle']],
      join: [[392, 0, 0.2, 'triangle'], [523, 0.15, 0.3, 'triangle']],
      leave: [[523, 0, 0.2, 'triangle'], [392, 0.15, 0.3, 'triangle']],
      mute: [[330, 0, 0.12, 'triangle']],
      unmute: [[494, 0, 0.12, 'triangle']],
      sent: [[880, 0, 0.08, 'triangle']],
    },
  },
  retro: {
    name: 'Ретро 8-бит',
    notes: {
      message: [[988, 0, 0.06, 'square'], [1319, 0.06, 0.1, 'square']],
      mention: [[659, 0, 0.06, 'square'], [988, 0.06, 0.06, 'square'], [1319, 0.12, 0.06, 'square'], [1976, 0.18, 0.12, 'square']],
      call: [[784, 0, 0.12, 'square'], [988, 0.12, 0.12, 'square'], [784, 0.24, 0.12, 'square'], [988, 0.36, 0.12, 'square'], [1175, 0.48, 0.25, 'square']],
      join: [[523, 0, 0.07, 'square'], [659, 0.07, 0.07, 'square'], [784, 0.14, 0.12, 'square']],
      leave: [[784, 0, 0.07, 'square'], [659, 0.07, 0.07, 'square'], [523, 0.14, 0.12, 'square']],
      mute: [[262, 0, 0.08, 'square']],
      unmute: [[523, 0, 0.08, 'square']],
      sent: [[1568, 0, 0.04, 'square']],
    },
  },
  bubble: {
    name: 'Пузырьки',
    notes: {
      message: [[600, 0, 0.07, 'sine'], [1200, 0.04, 0.09, 'sine']],
      mention: [[500, 0, 0.07], [1000, 0.05, 0.08], [1500, 0.1, 0.1]],
      call: [[700, 0, 0.1], [1400, 0.08, 0.12], [700, 0.4, 0.1], [1400, 0.48, 0.12]],
      join: [[400, 0, 0.06], [900, 0.04, 0.12]],
      leave: [[900, 0, 0.06], [400, 0.04, 0.12]],
      mute: [[300, 0, 0.06]],
      unmute: [[800, 0, 0.06]],
      sent: [[1000, 0, 0.05]],
    },
  },
  none: { name: 'Без звуков' },
};

export const EVENTS: { id: SoundEvent; name: string }[] = [
  { id: 'message', name: 'Новое сообщение' },
  { id: 'mention', name: 'Тебя упомянули' },
  { id: 'call', name: 'Входящий звонок' },
  { id: 'sent', name: 'Сообщение отправлено' },
  { id: 'join', name: 'Кто-то зашёл в голосовой' },
  { id: 'leave', name: 'Кто-то вышел из голосового' },
  { id: 'mute', name: 'Микрофон выключен' },
  { id: 'unmute', name: 'Микрофон включён' },
];

function synth(notes: Note[]) {
  ctx ??= new AudioContext();
  const now = ctx.currentTime;
  const v = vol() * 0.18;
  for (const [f, at, len, type] of notes) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type ?? 'sine';
    o.frequency.value = f;
    const t = now + at;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + len + 0.02);
  }
}

function playFile(url: string, loop = false) {
  const a = new Audio(url);
  a.volume = vol();
  a.loop = loop;
  // свой звук не длиннее 5 секунд, даже если файл длиннее
  if (!loop) window.setTimeout(() => a.pause(), 5000);
  const el = a as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  if (outputId && el.setSinkId) void el.setSinkId(outputId).catch(() => undefined);
  void a.play().catch(() => undefined);
  return a;
}

/** Проиграть звук события (с учётом набора, громкости и своих звуков) */
export function play(ev: SoundEvent, force = false) {
  try {
    if (!force && prefs.off?.includes(ev)) return;
    const custom = prefs.custom?.[ev];
    if (custom) return void playFile(custom);
    const notes = PACKS[prefs.pack ?? 'classic'].notes?.[ev];
    if (notes) synth(notes);
  } catch {
    /* звук недоступен — ничего страшного */
  }
}

/** Проиграть набор целиком для предпросмотра */
export function preview(pack: NonNullable<SoundPrefs['pack']>, ev: SoundEvent = 'message') {
  const notes = PACKS[pack].notes?.[ev];
  if (notes) synth(notes);
}

export function startRing(kind: 'in' | 'out') {
  stopRing();
  try {
    if (kind === 'in' && !prefs.off?.includes('call') && prefs.custom?.call) {
      ringEl = playFile(prefs.custom.call, true);
      return;
    }
    const playOnce = () => (kind === 'in' ? play('call') : synth([[425, 0, 1]]));
    playOnce();
    timer = window.setInterval(playOnce, kind === 'in' ? 2000 : 4000);
  } catch {
    /* звук недоступен — звонок всё равно показывается */
  }
}

export function stopRing() {
  window.clearInterval(timer);
  timer = undefined;
  ringEl?.pause();
  ringEl = null;
}

/** Проверить свой звук: аудио и не длиннее 5 секунд */
export function checkSoundFile(f: File): Promise<string | null> {
  if (!f.type.startsWith('audio/') && !/\.(mp3|ogg|wav|m4a|webm|opus)$/i.test(f.name)) return Promise.resolve('Нужен аудиофайл: mp3, ogg, wav, m4a');
  if (f.size > 1024 * 1024) return Promise.resolve('Файл больше 1 МБ — для звука это много');
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(f);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(a.duration > 5.05 ? `Звук длится ${a.duration.toFixed(1)} с — можно не больше 5 секунд` : null);
    };
    a.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('Не получилось прочитать этот файл');
    };
    a.src = url;
  });
}
