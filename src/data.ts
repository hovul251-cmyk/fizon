import type { Channel, PersistedState, Permissions, Profile, Role, Server, Settings } from './types';

export const ME = 'me';

/** Версия локальных данных: при смене старые демо-данные сбрасываются */
// 3: сброс старых демо-данных ранних версий (сообщества и чаты «из коробки» больше не появляются)
export const STATE_VERSION = 3;

export const uid = () => crypto.randomUUID();

const perms = (p: Partial<Permissions> = {}): Permissions => ({
  manageChannels: false,
  manageMessages: false,
  kickBan: false,
  timeout: false,
  manageRoles: false,
  admin: false,
  ...p,
});

export const defaultPerms = (): Permissions => perms();

export const defaultRoles = (): Role[] => [
  { id: 'owner', key: 'owner', name: 'Владелец', color: '#A78BFA', perms: perms({ admin: true, manageChannels: true, manageMessages: true, kickBan: true, timeout: true, manageRoles: true }) },
  { id: 'mod', name: 'Модератор', color: '#22D3EE', perms: perms({ manageChannels: true, manageMessages: true, kickBan: true, timeout: true }) },
  { id: 'everyone', key: 'everyone', name: '@все', color: '#9AA3B2', perms: perms() },
];

export const templates: Record<string, { label: string; hint: string; channels: Omit<Channel, 'id'>[] }> = {
  creator: {
    label: 'Для креаторов',
    hint: 'новости, работы, коллабы',
    channels: [
      { name: 'новости', kind: 'text', category: 'ИНФОРМАЦИЯ' },
      { name: 'общий', kind: 'text', category: 'ОБЩЕНИЕ' },
      { name: 'мои-работы', kind: 'text', category: 'ОБЩЕНИЕ' },
      { name: 'коллабы', kind: 'text', category: 'ОБЩЕНИЕ' },
      { name: 'Голосовой', kind: 'voice', category: 'ГОЛОСОВЫЕ' },
    ],
  },
  gaming: {
    label: 'Игровой',
    hint: 'голос, поиск тиммейтов',
    channels: [
      { name: 'общий', kind: 'text', category: 'ОБЩЕНИЕ' },
      { name: 'ищу-тиммейтов', kind: 'text', category: 'ОБЩЕНИЕ' },
      { name: 'Лобби', kind: 'voice', category: 'ГОЛОСОВЫЕ' },
      { name: 'Катка', kind: 'voice', category: 'ГОЛОСОВЫЕ' },
    ],
  },
  friends: {
    label: 'Для друзей',
    hint: 'общий чат и голос',
    channels: [
      { name: 'общий', kind: 'text', category: 'ОБЩЕНИЕ' },
      { name: 'мемы', kind: 'text', category: 'ОБЩЕНИЕ' },
      { name: 'Голосовой', kind: 'voice', category: 'ГОЛОСОВЫЕ' },
    ],
  },
  study: {
    label: 'Учёба',
    hint: 'предметы, задания',
    channels: [
      { name: 'объявления', kind: 'text', category: 'ИНФОРМАЦИЯ' },
      { name: 'задания', kind: 'text', category: 'УЧЁБА' },
      { name: 'вопросы', kind: 'text', category: 'УЧЁБА' },
      { name: 'Учебная комната', kind: 'voice', category: 'ГОЛОСОВЫЕ' },
    ],
  },
  empty: { label: 'С нуля', hint: 'один канал', channels: [{ name: 'общий', kind: 'text', category: 'ОБЩЕНИЕ' }] },
};

export const makeServer = (name: string, color: string, tpl: string, ownerId = ME): Server => {
  const channels = (templates[tpl] ?? templates.empty).channels.map((c) => ({ ...c, id: uid() }));
  return {
    id: uid(),
    name,
    short: shortName(name),
    color,
    ownerId,
    channels,
    roles: defaultRoles(),
    members: [{ userId: ME, roleId: 'owner' }],
    voice: {},
  };
};

/** Пустое состояние для онлайн-режима: всё приходит с сервера. */
export const emptyState = (settings?: Settings): PersistedState => ({
  version: STATE_VERSION,
  loggedIn: false,
  profile: defaultProfile(''),
  users: {},
  friends: [],
  pending: [],
  dms: [],
  servers: [],
  messages: {},
  stories: [],
  reels: [],
  groups: [],
  comments: {},
  settings: settings ? migrateSettings(settings) : { theme: 'dark', accent: DEFAULT_ACCENT, density: 'cozy', fontSize: 15, reduceMotion: false },
  lastChannel: {},
});

/** Фирменный цвет Neon 0.10 — как в Discord */
export const DEFAULT_ACCENT = '#5865F2';
/** Старые фирменные цвета прошлых версий меняем на новый */
export const migrateSettings = (s: Settings): Settings => (['#8B5CF6', '#FF6A3D', '#2F8CFF'].includes(s.accent.toUpperCase()) ? { ...s, accent: DEFAULT_ACCENT } : s);

export const STORY_HOURS = 24;

export const shortName = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '?';

export const defaultProfile = (name = ''): Profile => ({
  displayName: name,
  username: name.toLowerCase().replace(/[^a-z0-9._]/g, '') || 'user',
  pronouns: '',
  status: '',
  presence: 'online',
  about: '',
  avatarColor: '#5865F2',
  avatarImage: null,
  avatarFrame: 'neon',
  bannerColor: '#0B3A44',
  bannerColor2: '#8B5CF6',
  bannerImage: null,
  nameColor: '#FF9A6B',
  nameGradient: true,
  nameColor2: '#FFD166',
  nameEffect: 'none',
  cardStyle: 'glass',
  cardColor: '#1A1730',
  links: [],
  showcase: [],
  games: [],
  activity: '',
  widgets: [
    { type: 'about', visible: 'all' },
    { type: 'links', visible: 'all' },
    { type: 'now', visible: 'all' },
    { type: 'showcase', visible: 'all' },
    { type: 'games', visible: 'friends' },
    { type: 'badges', visible: 'all' },
  ],
  schemaVersion: 1,
  onboarded: false,
});

/** Первое состояние офлайн-режима: никаких выдуманных людей и сообщений, только ты. */
export const seedState = (): PersistedState => emptyState();
