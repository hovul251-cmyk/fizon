// Удалённое управление компьютером в звонке.
// Кто смотрит демонстрацию экрана, может попросить управление. Тот, кто показывает экран,
// видит окно по центру и решает сам. Разрешил — мышь и клавиатура гостя работают на его ПК
// (через нативный код Windows), сверху висит красная плашка, остановить можно кнопкой или Ctrl+Alt+X.
// Команды идут только через звонок LiveKit и принимаются только от того, кому дали доступ.

import { IS_DESKTOP_APP } from '../lib/platform';
import { getState } from '../store';
import { R } from './sync';

type Msg =
  | { t: 'rc-req' }
  | { t: 'rc-ok' }
  | { t: 'rc-no' }
  | { t: 'rc-stop' }
  | { t: 'move' | 'down' | 'up'; x: number; y: number; b?: number }
  | { t: 'wheel'; dy: number }
  | { t: 'key'; code: string; down: boolean; text?: string };

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
const tauri = () => (window as unknown as { __TAURI__?: { core: { invoke: Invoke }; event: { listen(e: string, cb: () => void): Promise<() => void> } } }).__TAURI__;
const invoke: Invoke = (cmd, args) => tauri()?.core.invoke(cmd, args) ?? Promise.resolve(null);

/** Можно ли дать управление своим компьютером (только приложение для Windows) */
export const canHost = () => IS_DESKTOP_APP;

export interface RemoteState {
  /** Кому я дал управление своим ПК */
  controller: string | null;
  /** Чьим ПК управляю я */
  controlling: string | null;
  /** Жду ответа от … */
  asking: string | null;
}
let state: RemoteState = { controller: null, controlling: null, asking: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<RemoteState>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};
export const onRemote = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));
export const remoteState = () => state;

let askHandler: ((from: string) => Promise<{ ok: boolean; monitor?: number }>) | null = null;
/** Окно «Дать управление?» показывает интерфейс — сюда он передаёт свою функцию */
export const setAskHandler = (fn: typeof askHandler) => (askHandler = fn);
let toastFn: (t: string) => void = () => undefined;
export const setRemoteToast = (fn: (t: string) => void) => (toastFn = fn);

const enc = new TextEncoder();
const dec = new TextDecoder();
async function send(to: string, m: Msg, reliable = true) {
  const v = await import('./voice');
  await v.sendData(enc.encode(JSON.stringify(m)), [R(to)], reliable).catch(() => undefined);
}

let unlistenHotkey: (() => void) | null = null;
async function startHosting(userId: string, monitor?: number) {
  await invoke('remote_set', { enabled: true, monitor: monitor ?? null });
  set({ controller: userId });
  unlistenHotkey?.();
  unlistenHotkey = (await tauri()?.event.listen('remote-stopped', () => void stopHosting(true))) ?? null;
}

/** Забрать управление (я — тот, кем управляют) */
export async function stopHosting(byHotkey = false) {
  const who = state.controller;
  await invoke('remote_set', { enabled: false, monitor: null });
  unlistenHotkey?.();
  unlistenHotkey = null;
  set({ controller: null });
  if (who) {
    await send(who, { t: 'rc-stop' });
    toastFn(byHotkey ? 'Управление остановлено (Ctrl+Alt+X)' : 'Управление остановлено');
  }
}

/** Попросить управление ПК того, кто показывает экран */
export async function requestControl(userId: string) {
  set({ asking: userId });
  await send(userId, { t: 'rc-req' });
  window.setTimeout(() => state.asking === userId && set({ asking: null }), 30_000);
}

/** Перестать управлять чужим ПК */
export async function releaseControl() {
  const who = state.controlling;
  set({ controlling: null });
  if (who) await send(who, { t: 'rc-stop' });
}

/** Гость: отправить движение мыши/клавишу (координаты 0..1 по кадру демонстрации) */
export function sendInput(m: Exclude<Msg, { t: 'rc-req' | 'rc-ok' | 'rc-no' | 'rc-stop' }>) {
  if (!state.controlling) return;
  void send(state.controlling, m, m.t !== 'move');
}

/** Пришло сообщение по звонку */
export function onRemoteData(from: string, payload: Uint8Array) {
  let m: Msg;
  try {
    m = JSON.parse(dec.decode(payload)) as Msg;
  } catch {
    return;
  }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'rc-req':
      void (async () => {
        if (!canHost() || !getState().ui.sharing) return send(from, { t: 'rc-no' });
        if (state.controller) return send(from, { t: 'rc-no' });
        const ans = (await askHandler?.(from)) ?? { ok: false };
        if (!ans.ok) return send(from, { t: 'rc-no' });
        await startHosting(from, ans.monitor);
        await send(from, { t: 'rc-ok' });
      })();
      return;
    case 'rc-ok':
      if (state.asking === from) set({ asking: null, controlling: from });
      return;
    case 'rc-no':
      if (state.asking === from) {
        set({ asking: null });
        toastFn('Управление не дали');
      }
      return;
    case 'rc-stop':
      if (state.controlling === from) {
        set({ controlling: null });
        toastFn('Управление закончилось');
      }
      if (state.controller === from) void stopHosting();
      return;
    default:
      // ввод принимаем только от того, кому сами дали управление, и только пока показываем экран
      if (state.controller !== from) return;
      if (!getState().ui.sharing) return void stopHosting();
      void invoke('remote_input', { ev: m });
  }
}

/** Звонок закончился — всё выключить */
export function resetRemote() {
  if (state.controller) void stopHosting();
  set({ controller: null, controlling: null, asking: null });
}
