export type Presence = 'online' | 'idle' | 'dnd' | 'offline';
export type Visibility = 'all' | 'friends' | 'none';
export type CardStyle = 'glass' | 'matte' | 'neon' | 'minimal';
export type WidgetType = 'about' | 'links' | 'now' | 'showcase' | 'games' | 'badges';

export interface Widget {
  type: WidgetType;
  visible: Visibility;
}

export interface ProfileLink {
  id: string;
  label: string;
  url: string;
}

export interface Profile {
  /** Мои наборы стикеров (id), синхронизируются между устройствами */
  stickerPacks?: string[];
  displayName: string;
  username: string;
  pronouns: string;
  status: string;
  presence: Presence;
  about: string;
  avatarColor: string;
  avatarImage: string | null;
  avatarFrame: 'none' | 'neon' | 'gold' | 'fire';
  bannerColor: string;
  bannerColor2: string;
  bannerImage: string | null;
  nameColor: string;
  nameGradient: boolean;
  nameColor2: string;
  nameEffect: 'none' | 'glow';
  cardStyle: CardStyle;
  cardColor: string;
  links: ProfileLink[];
  showcase: string[];
  games: string[];
  activity: string;
  widgets: Widget[];
  schemaVersion: number;
  /** Прошёл первый вход: выбрал имя */
  onboarded?: boolean;
}

export interface User {
  id: string;
  /** Полный профиль с оформлением — есть у пользователей из онлайн-режима */
  profile?: Profile;
  name: string;
  username: string;
  color: string;
  nameColor: string;
  presence: Presence;
  activity?: string;
  about?: string;
  /** Бот (сообщения от вебхука) */
  bot?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  kind: 'text' | 'voice';
  category: string;
  topic?: string;
  /** Медленный режим: не чаще одного сообщения в N секунд */
  slowmode?: number;
  /** Голосовая комната-сцена: говорят модераторы и те, кому дали слово */
  stage?: boolean;
  /** Кому дали слово на сцене */
  speakers?: string[];
}

export interface Permissions {
  manageChannels: boolean;
  manageMessages: boolean;
  kickBan: boolean;
  timeout: boolean;
  manageRoles: boolean;
  admin: boolean;
}

export interface Role {
  id: string;
  /** Служебные роли: владелец и «все» */
  key?: 'owner' | 'everyone';
  name: string;
  color: string;
  perms: Permissions;
}

export interface Server {
  id: string;
  name: string;
  short: string;
  color: string;
  ownerId: string;
  channels: Channel[];
  roles: Role[];
  members: { userId: string; roleId: string }[];
  voice: Record<string, string[]>;
  /** Кто в муте и до какого времени */
  mutes?: Record<string, number>;
  /** Открытые жалобы — видят только модераторы */
  openReports?: number;
}

/** Группа: переписка и звонки на нескольких людей без сообщества */
export interface Group {
  id: string;
  name: string;
  color: string;
  ownerId: string;
  members: string[];
  /** «Избранное» — чат с самим собой */
  saved?: boolean;
}

export interface Comment {
  id: string;
  reelId: string;
  authorId: string;
  text: string;
  ts: number;
}

export interface Reaction {
  emoji: string;
  users: string[];
}

export interface Attachment {
  name: string;
  size: string;
  url?: string;
  type?: string;
  /** Ключ файла, если он зашифрован (в личных и группах). Хранится только внутри зашифрованного сообщения. */
  key?: { k: string; iv: string };
  /** Стикер: из какого набора (по нему можно открыть и добавить набор себе) */
  sticker?: { pack: string; id: string; emoji: string; anim?: string };
  /** Голосовое/видео-сообщение «кружочком» */
  round?: boolean;
  /** Опрос */
  poll?: { q: string; options: string[]; multi?: boolean; anon?: boolean };
  /** Мини-игра: кубик, монетка, дартс, слоты */
  game?: { kind: 'dice' | 'coin' | 'darts' | 'slot'; value: number };
}

export interface Sticker {
  id: string;
  /** Картинка (webp/png/gif). Нет — значит, это анимированный эмодзи из встроенного набора */
  url?: string;
  emoji: string;
  anim?: string;
}

export interface StickerPack {
  id: string;
  name: string;
  authorId: string;
  stickers: Sticker[];
  builtin?: boolean;
}

export interface Message {
  id: string;
  authorId: string;
  text: string;
  ts: number;
  edited?: boolean;
  replyTo?: string;
  reactions: Reaction[];
  attachment?: Attachment;
  pending?: boolean;
  failed?: boolean;
  /** Пришло зашифрованным (сквозное шифрование личных сообщений) */
  encrypted?: boolean;
  /** Не удалось расшифровать на этом устройстве */
  locked?: boolean;
}

/** История: фото или видео на 24 часа, видна всем вошедшим */
export interface Story {
  id: string;
  authorId: string;
  url: string;
  kind: 'image' | 'video';
  caption: string;
  ts: number;
  expiresAt: number;
  /** Кому видна: всем или только друзьям */
  audience?: 'all' | 'friends';
  /** id файла в хранилище — чтобы удалить вместе с историей */
  fileId?: string;
}

/** Видео в ленте: вертикальный ролик до 3 минут */
export interface Reel {
  id: string;
  authorId: string;
  url: string;
  caption: string;
  ts: number;
  likes: string[];
  comments?: number;
  fileId?: string;
}

export interface Settings {
  theme: 'dark' | 'midnight' | 'light' | 'ocean';
  /** Сообщения строками, как в Discord (по умолчанию), или пузырями, как в Telegram */
  messageStyle?: 'flat' | 'bubbles';
  /** Фон чатов: своя картинка или гифка */
  chatBg?: { url: string; dim: number; blur: number } | null;
  accent: string;
  density: 'cozy' | 'compact';
  fontSize: number;
  reduceMotion: boolean;
  /** Когда последний раз открывали «Входящие» */
  inboxSeenAt?: number;
  /** Просмотренные истории: id → когда истекает (старые удаляются) */
  storiesSeen?: Record<string, number>;
  /** Уведомления: всё (личные, группы, упоминания), только личные и упоминания, выключены */
  notify?: 'all' | 'dm' | 'off';
}

export interface PersistedState {
  version: number;
  loggedIn: boolean;
  profile: Profile;
  users: Record<string, User>;
  friends: string[];
  pending: string[];
  dms: string[];
  servers: Server[];
  messages: Record<string, Message[]>;
  stories: Story[];
  reels: Reel[];
  groups: Group[];
  comments: Record<string, Comment[]>;
  settings: Settings;
  lastChannel: Record<string, string>;
}

/** Видео-дорожка LiveKit, без прямой зависимости типов от библиотеки */
export interface VideoTrackLike {
  attach(el: HTMLMediaElement): HTMLMediaElement;
  detach(el: HTMLMediaElement): HTMLMediaElement;
}
