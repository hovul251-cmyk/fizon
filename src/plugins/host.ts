// Плагины Neon. Каждый плагин-скрипт работает в отдельном Web Worker — в песочнице:
// у него нет доступа к окну приложения, сессии, паролю, файлам и сети (fetch, WebSocket и т. п. отключены).
// С приложением он общается только сообщениями через объект `fizion`, и каждое действие
// проверяется по разрешениям, которые человек подтвердил при установке.
// Плагины-темы — это CSS, он просто подключается к оформлению.

import { useSyncExternalStore } from 'react';
import { ME } from '../data';
import { actions, getState, subscribeStore, type State } from '../store';

export type Perm = 'messages:read' | 'messages:send' | 'commands';

export const PERMS: Record<Perm, { title: string; risk: string }> = {
  commands: { title: 'Команды через «/»', risk: 'добавит свои команды в поле ввода сообщения' },
  'messages:read': { title: 'Читать сообщения', risk: 'будет видеть новые сообщения в чатах, пока приложение открыто' },
  'messages:send': { title: 'Отправлять сообщения', risk: 'сможет писать сообщения от твоего имени' },
};

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  kind: 'script' | 'theme';
  code: string;
  enabled: boolean;
  permissions: Perm[];
  installedAt: number;
  /** Поставлен из каталога Neon — можно оценить */
  catalogId?: string;
}

export type PanelItem = { type: 'title' | 'text'; text: string } | { type: 'button'; label: string; id: string } | { type: 'stat'; label: string; value: string };

export interface PluginRuntime {
  status: 'running' | 'stopped' | 'error';
  log: { level: 'log' | 'error'; text: string; ts: number }[];
  panel: PanelItem[];
  commands: { name: string; description: string }[];
}

export interface Manifest {
  name: string;
  version: string;
  author: string;
  description: string;
  kind: 'script' | 'theme';
  permissions: Perm[];
  unknownPerms: string[];
}

const KEY = 'fizion-plugins-v1';
const DATA_KEY = (id: string) => `fizion-plugin-data-${id}`;
export const MAX_CODE = 200_000;

/* ---------- состояние для экранов ---------- */

interface HostState {
  records: PluginRecord[];
  runtime: Record<string, PluginRuntime>;
}

let hs: HostState = { records: load(), runtime: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (fn: (s: HostState) => Partial<HostState>) => {
  hs = { ...hs, ...fn(hs) };
  emit();
};

export function usePlugins(): HostState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => hs,
  );
}

function load(): PluginRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PluginRecord[]) : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(hs.records));
  } catch {
    /* место закончилось — плагины останутся до перезапуска */
  }
}

const patchRuntime = (id: string, fn: (r: PluginRuntime) => Partial<PluginRuntime>) =>
  set((s) => {
    const r = s.runtime[id] ?? { status: 'stopped', log: [], panel: [], commands: [] };
    return { runtime: { ...s.runtime, [id]: { ...r, ...fn(r) } } };
  });

const log = (id: string, level: 'log' | 'error', text: string) =>
  patchRuntime(id, (r) => ({ log: [...r.log.slice(-49), { level, text: text.slice(0, 1000), ts: Date.now() }] }));

/* ---------- описание плагина в заголовке ---------- */

/** Читает строки вида `// @name Кубик` или ` * @permissions commands` в начале файла. */
export function parseManifest(code: string, fileName = ''): Manifest {
  const head = code.slice(0, 3000);
  const get = (k: string) => new RegExp(`@${k}[ \\t]+([^\\n*]+)`).exec(head)?.[1].trim() ?? '';
  const rawPerms = get('permissions')
    .split(/[\s,]+/)
    .filter(Boolean);
  const known = Object.keys(PERMS) as Perm[];
  const type = get('type').toLowerCase();
  const kind = type === 'theme' || fileName.toLowerCase().endsWith('.css') ? 'theme' : 'script';
  return {
    name: get('name').slice(0, 40),
    version: get('version').slice(0, 16) || '1.0',
    author: get('author').slice(0, 40),
    description: get('description').slice(0, 300),
    kind,
    permissions: kind === 'theme' ? [] : known.filter((p) => rawPerms.includes(p)),
    unknownPerms: kind === 'theme' ? [] : rawPerms.filter((p) => !known.includes(p as Perm)),
  };
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'plugin';

/* ---------- песочница ---------- */

// Этот код выполняется внутри Worker перед кодом плагина.
const BOOT = `'use strict';
(() => {
  const post = self.postMessage.bind(self);
  // отключаем сеть и всё, через что можно выйти за пределы песочницы
  for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'Worker', 'SharedWorker', 'indexedDB', 'caches', 'BroadcastChannel', 'WebTransport', 'Request', 'Response']) {
    try { delete self[k]; } catch (e) {}
    let o = Object.getPrototypeOf(self);
    while (o) { try { delete o[k]; } catch (e) {} o = Object.getPrototypeOf(o); }
    try { Object.defineProperty(self, k, { value: undefined, writable: false, configurable: false }); } catch (e) {}
  }
  const handlers = {};
  const commands = {};
  let storage = {};
  const str = (v) => (typeof v === 'string' ? v : v === undefined ? 'undefined' : (() => { try { return JSON.stringify(v); } catch (e) { return String(v); } })());
  const fizion = {
    on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
    command(name, description, fn) {
      if (typeof description === 'function') { fn = description; description = ''; }
      name = String(name).replace(/^\\//, '').toLowerCase().replace(/[^\\p{L}\\p{N}_-]/gu, '').slice(0, 24);
      commands[name] = fn;
      post({ t: 'command', name, description: String(description || '').slice(0, 120) });
    },
    send(chatId, text) { post({ t: 'send', chatId: String(chatId), text: String(text) }); },
    toast(text) { post({ t: 'toast', text: str(text) }); },
    panel(items) { post({ t: 'panel', items: Array.isArray(items) ? items : [] }); },
    log(...a) { post({ t: 'log', text: a.map(str).join(' ') }); },
    storage: {
      get(k) { return storage[k]; },
      set(k, v) { storage[k] = v; post({ t: 'storage', data: storage }); },
      remove(k) { delete storage[k]; post({ t: 'storage', data: storage }); },
      all() { return Object.assign({}, storage); },
    },
    me: null,
  };
  self.fizion = fizion;
  self.console = { log: fizion.log, info: fizion.log, warn: fizion.log, error: (...a) => post({ t: 'error', text: a.map(str).join(' ') }), debug() {} };
  const fail = (e) => post({ t: 'error', text: String((e && e.stack) || e) });
  self.addEventListener('message', async (e) => {
    const m = e.data || {};
    if (m.t === 'init') { storage = m.storage || {}; fizion.me = m.me; (handlers.ready || []).forEach((fn) => { try { fn(); } catch (err) { fail(err); } }); }
    if (m.t === 'event') for (const fn of handlers[m.name] || []) { try { await fn(m.data); } catch (err) { fail(err); } }
    if (m.t === 'run') {
      try { const r = await commands[m.name](m.args, m.ctx); post({ t: 'result', id: m.id, text: r == null ? null : str(r) }); }
      catch (err) { fail(err); post({ t: 'result', id: m.id, text: null }); }
    }
  });
})();
`;

interface Live {
  worker: Worker;
  pending: Map<string, (text: string | null) => void>;
  sent: number[];
}
const live = new Map<string, Live>();
const themes = new Map<string, HTMLStyleElement>();

const has = (rec: PluginRecord, p: Perm) => rec.permissions.includes(p);

/** Не чаще N раз за окно — чтобы плагин не завалил чат или уведомления */
const allowRate = (l: Live, max: number, windowMs: number) => {
  const now = Date.now();
  l.sent = l.sent.filter((t) => now - t < windowMs);
  if (l.sent.length >= max) return false;
  l.sent.push(now);
  return true;
};

const cleanPanel = (items: unknown[]): PanelItem[] =>
  items.slice(0, 40).flatMap((x): PanelItem[] => {
    const o = (x ?? {}) as Record<string, unknown>;
    const s = (v: unknown, n: number) => String(v ?? '').slice(0, n);
    if (o.type === 'button' && o.label) return [{ type: 'button', label: s(o.label, 40), id: s(o.id ?? o.label, 40) }];
    if (o.type === 'stat') return [{ type: 'stat', label: s(o.label, 60), value: s(o.value, 40) }];
    if (o.type === 'title') return [{ type: 'title', text: s(o.text, 80) }];
    if (o.text != null) return [{ type: 'text', text: s(o.text, 500) }];
    return [];
  });

function startScript(rec: PluginRecord) {
  const url = URL.createObjectURL(new Blob([BOOT, '\n;(function () {\n', rec.code, '\n}).call(undefined);\n'], { type: 'text/javascript' }));
  let worker: Worker;
  try {
    worker = new Worker(url, { name: `plugin:${rec.id}` });
  } catch (e) {
    patchRuntime(rec.id, () => ({ status: 'error' }));
    log(rec.id, 'error', 'Не удалось запустить: ' + String(e));
    return;
  } finally {
    URL.revokeObjectURL(url);
  }
  const l: Live = { worker, pending: new Map(), sent: [] };
  live.set(rec.id, l);
  patchRuntime(rec.id, () => ({ status: 'running', panel: [], commands: [] }));

  worker.onerror = (e) => {
    e.preventDefault();
    patchRuntime(rec.id, () => ({ status: 'error' }));
    log(rec.id, 'error', `${e.message}${e.lineno ? ` (строка ${Math.max(1, e.lineno - BOOT.split('\n').length - 1)})` : ''}`);
  };
  worker.onmessage = (e: MessageEvent) => {
    const m = (e.data ?? {}) as Record<string, unknown>;
    const deny = (perm: Perm) => log(rec.id, 'error', `Нет разрешения «${PERMS[perm].title}» — добавь @permissions ${perm} в заголовок плагина`);
    switch (m.t) {
      case 'command':
        if (!has(rec, 'commands')) return deny('commands');
        return patchRuntime(rec.id, (r) => ({ commands: [...r.commands.filter((c) => c.name !== m.name), { name: String(m.name), description: String(m.description ?? '') }] }));
      case 'result':
        l.pending.get(String(m.id))?.(m.text == null ? null : String(m.text).slice(0, 2000));
        return l.pending.delete(String(m.id));
      case 'send': {
        if (!has(rec, 'messages:send')) return deny('messages:send');
        const text = String(m.text).trim().slice(0, 2000);
        if (!text) return;
        if (!allowRate(l, 5, 10_000)) return log(rec.id, 'error', 'Слишком много сообщений подряд — не больше 5 за 10 секунд');
        return actions.send(String(m.chatId), text);
      }
      case 'toast':
        if (!allowRate(l, 5, 10_000)) return;
        return actions.toast(`${rec.name}: ${String(m.text).slice(0, 200)}`);
      case 'panel':
        return patchRuntime(rec.id, () => ({ panel: cleanPanel(m.items as unknown[]) }));
      case 'storage': {
        const json = JSON.stringify(m.data ?? {});
        if (json.length > 100_000) return log(rec.id, 'error', 'Хранилище плагина больше 100 КБ — данные не сохранены');
        try {
          localStorage.setItem(DATA_KEY(rec.id), json);
        } catch {
          log(rec.id, 'error', 'Не удалось сохранить данные плагина');
        }
        return;
      }
      case 'log':
        return log(rec.id, 'log', String(m.text));
      case 'error':
        return log(rec.id, 'error', String(m.text));
    }
  };
  let storage = {};
  try {
    storage = JSON.parse(localStorage.getItem(DATA_KEY(rec.id)) ?? '{}');
  } catch {
    /* повреждённые данные — с нуля */
  }
  const s = getState();
  worker.postMessage({ t: 'init', storage, me: { name: s.profile.displayName, username: s.profile.username } });
}

function startTheme(rec: PluginRecord) {
  const el = document.createElement('style');
  el.dataset.plugin = rec.id;
  el.textContent = rec.code;
  document.head.appendChild(el);
  themes.set(rec.id, el);
  patchRuntime(rec.id, () => ({ status: 'running' }));
}

function stop(id: string) {
  const l = live.get(id);
  if (l) {
    l.worker.terminate();
    l.pending.forEach((resolve) => resolve(null));
    live.delete(id);
  }
  themes.get(id)?.remove();
  themes.delete(id);
  patchRuntime(id, () => ({ status: 'stopped', commands: [], panel: [] }));
}

function run(rec: PluginRecord) {
  stop(rec.id);
  if (!rec.enabled) return;
  if (rec.kind === 'theme') startTheme(rec);
  else startScript(rec);
}

/* ---------- управление ---------- */

export function install(code: string, fileName = '', catalogId?: string): { ok: true; id: string } | { ok: false; error: string } {
  if (code.length > MAX_CODE) return { ok: false, error: 'Плагин больше 200 КБ' };
  const m = parseManifest(code, fileName);
  if (!m.name) return { ok: false, error: 'В начале файла нет строки «// @name Название»' };
  const id = slug(m.name);
  const old = hs.records.find((r) => r.id === id);
  const rec: PluginRecord = { id, ...m, code, enabled: true, installedAt: old?.installedAt ?? Date.now(), catalogId: catalogId ?? old?.catalogId };
  set((s) => ({ records: old ? s.records.map((r) => (r.id === id ? rec : r)) : [...s.records, rec] }));
  persist();
  run(rec);
  return { ok: true, id };
}

export function setEnabled(id: string, enabled: boolean) {
  set((s) => ({ records: s.records.map((r) => (r.id === id ? { ...r, enabled } : r)) }));
  persist();
  const rec = hs.records.find((r) => r.id === id);
  if (rec) run(rec);
}

export function remove(id: string) {
  stop(id);
  set((s) => {
    const runtime = { ...s.runtime };
    delete runtime[id];
    return { records: s.records.filter((r) => r.id !== id), runtime };
  });
  persist();
  localStorage.removeItem(DATA_KEY(id));
}

export function clickButton(id: string, buttonId: string) {
  live.get(id)?.worker.postMessage({ t: 'event', name: 'button', data: buttonId });
}

/* ---------- команды «/» ---------- */

export interface CommandInfo {
  name: string;
  description: string;
  pluginId: string;
  pluginName: string;
}

export const listCommands = (s: HostState = hs): CommandInfo[] =>
  s.records.flatMap((r) => (s.runtime[r.id]?.commands ?? []).map((c) => ({ ...c, pluginId: r.id, pluginName: r.name })));

/** Выполнить «/команда аргументы». null — такой команды нет; иначе текст для отправки (или '' — ничего не отправлять). */
export async function runCommand(text: string, chatId: string): Promise<string | null> {
  const m = /^\/([\p{L}\p{N}_-]+)\s*([\s\S]*)$/u.exec(text.trim());
  if (!m) return null;
  const cmd = listCommands().find((c) => c.name === m[1].toLowerCase());
  const l = cmd && live.get(cmd.pluginId);
  if (!cmd || !l) return null;
  const id = Math.random().toString(36).slice(2);
  const result = await new Promise<string | null>((resolve) => {
    l.pending.set(id, resolve);
    l.worker.postMessage({ t: 'run', id, name: cmd.name, args: m[2], ctx: { chatId, chat: chatTitle(getState(), chatId) } });
    window.setTimeout(() => {
      if (l.pending.delete(id)) {
        log(cmd.pluginId, 'error', `Команда /${cmd.name} не ответила за 5 секунд`);
        resolve(null);
      }
    }, 5000);
  });
  return result ?? '';
}

/* ---------- события сообщений ---------- */

const chatTitle = (s: State, chatId: string) => {
  if (chatId.startsWith('dm:')) return s.users[chatId.slice(3)]?.name ?? 'Личные';
  for (const srv of s.servers) {
    const ch = srv.channels.find((c) => c.id === chatId);
    if (ch) return `${srv.name} · ${ch.name}`;
  }
  return '';
};

const startedAt = Date.now();
const lastSeen = new Map<string, number>();
let lastMessages: State['messages'] | null = null;

function watchMessages() {
  const s = getState();
  if (s.messages === lastMessages) return;
  lastMessages = s.messages;
  const readers = hs.records.filter((r) => r.enabled && r.kind === 'script' && has(r, 'messages:read') && live.has(r.id));
  for (const [chatId, list] of Object.entries(s.messages)) {
    const seen = lastSeen.get(chatId) ?? startedAt;
    let max = seen;
    for (const m of list) {
      if (m.ts <= seen) continue;
      max = Math.max(max, m.ts);
      if (!readers.length) continue;
      const author = m.authorId === ME ? s.profile.displayName : (s.users[m.authorId]?.name ?? '');
      const data = { id: m.id, chatId, chat: chatTitle(s, chatId), text: m.text, author, authorId: m.authorId === ME ? 'me' : m.authorId, mine: m.authorId === ME, ts: m.ts };
      readers.forEach((r) => live.get(r.id)?.worker.postMessage({ t: 'event', name: 'message', data }));
    }
    lastSeen.set(chatId, max);
  }
}

let started = false;
/** Запустить включённые плагины при старте приложения. */
export function startPlugins() {
  if (started) return;
  started = true;
  hs.records.forEach(run);
  subscribeStore(watchMessages);
}
