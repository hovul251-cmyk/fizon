import { useSyncExternalStore } from 'react';
import { emptyState, ME, migrateSettings, seedState, STATE_VERSION, STORY_HOURS, uid } from './data';
import { ONLINE } from './lib/appwrite';
import * as remote from './online/remote';
import * as sync from './online/sync';
import * as voice from './online/voice';
import { startRing, stopRing } from './lib/sound';
import { notifyCall } from './lib/notify';
import { unsubscribePush } from './lib/push';
import * as e2e from './online/crypto';
import * as social from './online/social';
import type { Message, PersistedState, Profile, Reel, Server, Settings, Story, VideoTrackLike } from './types';

// Маленькое хранилище без зависимостей: подписка через useSyncExternalStore,
// компонент перерисовывается только когда меняется выбранный им кусок состояния.
// В онлайн-режиме действия сначала меняют данные локально, затем отправляют их в Appwrite.

export type Modal =
  | { kind: 'profile'; userId: string }
  | { kind: 'editor' }
  | { kind: 'createServer' }
  | { kind: 'invite' }
  | { kind: 'serverSettings' }
  | { kind: 'userSettings' }
  | { kind: 'storyComposer' }
  | { kind: 'reelComposer' }
  | { kind: 'newGroup' }
  | { kind: 'newChannel' }
  | { kind: 'joinChannel'; handle: string }
  | { kind: 'joinInvite'; code: string }
  | null;

export interface UiState {
  booting: boolean;
  net: 'offline-mode' | 'online' | 'reconnecting';
  toast: { text: string; id: number } | null;
  view: 'feed' | 'inbox' | 'home' | 'server' | 'plugins' | 'search';
  /** Поиск по всей истории сообщений */
  globalSearch: string;
  /** Открытый просмотр историй: чьи и с какой по счёту */
  stories: { userId: string; index: number } | null;
  /** Лента: все видео или только друзей */
  feedTab: 'all' | 'friends';
  /** Кто в звонке кроме меня */
  callPeers: string[];
  /** Звонок зашифрован сквозным шифрованием */
  callEncrypted: boolean;
  /** Телефон: открыт чат (true) или список чатов (false) */
  mobileChat: boolean;
  /** Звонок в личке: исходящий, входящий или идёт */
  call: CallState | null;
  /** Чаты, у которых вся история уже загружена */
  chatEnd: Record<string, boolean>;
  collapsed: Record<string, boolean>;
  dmsOpen: boolean;
  onboarding: boolean;
  serverId: string | null;
  homeTab: 'friends' | string; // 'friends' или id пользователя для ЛС
  friendsTab: 'online' | 'all' | 'pending' | 'add';
  modal: Modal;
  card: { userId: string; x: number; y: number } | null;
  voice: { serverId: string; channelId: string } | null;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  sharing: boolean;
  speaking: string[];
  videos: Record<string, { track: VideoTrackLike; screen: boolean }>;
  showMembers: boolean;
  search: string;
  /** Я владелец/админ всего приложения (labels на сервере) */
  staff: 'owner' | 'admin' | null;
  /** Аккаунт заморожен: читать можно, писать нельзя */
  frozen: boolean;
}

export interface CallState {
  /** Личный звонок или звонок в группе */
  kind: 'dm' | 'group';
  /** Собеседник (личный) или тот, кто начал звонок (группа) */
  userId: string;
  groupId?: string;
  callId: string;
  dmId: string;
  state: 'outgoing' | 'incoming' | 'active';
  video: boolean;
  /** Когда начался разговор — для таймера */
  since?: number;
  /** Я звонил — значит, я и пишу итог звонка в переписку */
  mine: boolean;
}

export interface State extends PersistedState {
  ui: UiState;
}

const KEY = 'fizion-state-v1';
const SETTINGS_KEY = 'fizion-settings-v1';

const load = (): PersistedState => {
  if (ONLINE) {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return emptyState(raw ? (JSON.parse(raw) as Settings) : undefined);
    } catch {
      return emptyState();
    }
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as PersistedState;
      if (data.version === STATE_VERSION) {
        // ссылки blob: на файлы офлайн-режима живут только до закрытия — после перезапуска их уже нет
        const messages = Object.fromEntries(
          Object.entries(data.messages).map(([k, list]) => [k, list.map((m) => (m.attachment?.url?.startsWith('blob:') ? { ...m, attachment: { ...m.attachment, url: undefined } } : m))]),
        );
        return { ...data, messages, stories: [], reels: [], groups: [], comments: {}, settings: migrateSettings(data.settings) };
      }
    }
  } catch {
    /* повреждённые данные — начинаем заново */
  }
  return seedState();
};

const persisted = load();
let state: State = {
  ...persisted,
  ui: {
    booting: ONLINE,
    net: ONLINE ? 'online' : 'offline-mode',
    toast: null,
    view: persisted.servers.length ? 'server' : 'inbox',
    stories: null,
    feedTab: 'all',
    chatEnd: {},
    call: null,
    globalSearch: '',
    callPeers: [],
    callEncrypted: false,
    mobileChat: false,
    collapsed: {},
    dmsOpen: true,
    onboarding: false,
    serverId: persisted.servers[0]?.id ?? null,
    homeTab: 'friends',
    friendsTab: 'online',
    modal: null,
    card: null,
    voice: null,
    muted: false,
    deafened: false,
    camera: false,
    sharing: false,
    speaking: [],
    videos: {},
    staff: null,
    frozen: false,
    showMembers: false,
    search: '',
  },
};

const listeners = new Set<() => void>();
let saveTimer: number | undefined;

const save = () => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      if (ONLINE) localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      else {
        // фото и видео историй и ленты в офлайн-режиме живут только до закрытия приложения
        const { ui: _ui, stories: _s, reels: _r, comments: _c, ...data } = state;
        localStorage.setItem(KEY, JSON.stringify(data));
      }
    } catch {
      console.warn('Не удалось сохранить данные: закончилось место');
    }
  }, 250);
};

export const getState = () => state;

export const setState = (fn: (s: State) => Partial<State>, persist = true) => {
  state = { ...state, ...fn(state) };
  if (persist) save();
  listeners.forEach((l) => l());
};

export const setUi = (patch: Partial<UiState>) => setState((s) => ({ ui: { ...s.ui, ...patch } }), false);

export const subscribeStore = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribeStore, () => selector(state));
}

/* ---------- действия ---------- */

const updateServerLocal = (id: string, fn: (s: Server) => Server) =>
  setState((s) => ({ servers: s.servers.map((x) => (x.id === id ? fn(x) : x)) }));

const addMessage = (chatId: string, msg: Message) =>
  setState((s) => ({ messages: { ...s.messages, [chatId]: [...(s.messages[chatId] ?? []), msg] } }));

export const actions = {
  /** Офлайн-вход: просто запомнить имя */
  login(name: string) {
    // новый человек на этом устройстве начинает с чистого листа: без чужих сообществ, чатов и друзей.
    // Тот же человек (то же имя) снова видит свои офлайн-данные.
    setState((s) => {
      const same = !!name && s.profile.displayName === name;
      const base = same ? s : { ...emptyState(s.settings), ui: s.ui };
      return { ...base, loggedIn: true, profile: { ...base.profile, displayName: name || base.profile.displayName } };
    });
  },
  async logout() {
    if (ONLINE) {
      await voice.disconnect();
      // это устройство больше не должно получать push чужого аккаунта
      await unsubscribePush(remote.removePushSub).catch(() => undefined);
      await remote.signOut();
      await sync.stop();
    } else setState(() => ({ loggedIn: false }));
  },
  resetAll() {
    localStorage.removeItem(KEY);
    location.reload();
  },
  openServer(serverId: string) {
    setUi({ view: 'server', serverId, card: null, search: '' });
  },
  openFeed() {
    setUi({ view: 'feed', card: null, search: '' });
    if (ONLINE) void sync.loadReels(true);
  },
  openSearch(q: string) {
    setUi({ view: 'search', globalSearch: q, card: null, mobileChat: true });
  },
  openPlugins() {
    setUi({ view: 'plugins', card: null, search: '' });
  },
  toast(text: string) {
    setUi({ toast: { text, id: Date.now() } });
  },
  openInbox() {
    setUi({ view: 'inbox', card: null, search: '' });
  },
  openHome(tab: string = 'friends') {
    setUi({ view: 'home', homeTab: tab, card: null, search: '', mobileChat: true });
  },
  openChannel(serverId: string, channelId: string) {
    setState((s) => ({ lastChannel: { ...s.lastChannel, [serverId]: channelId }, ui: { ...s.ui, search: '', mobileChat: true } }));
  },
  /** Телефон: вернуться из чата к списку */
  backToList() {
    setUi({ mobileChat: false, showMembers: false });
  },
  openDm(userId: string) {
    setState((s) => ({
      dms: s.dms.includes(userId) ? s.dms : [userId, ...s.dms],
      ui: { ...s.ui, view: 'home', homeTab: userId, card: null, modal: null, mobileChat: true },
    }));
  },
  loadChat(chatId: string) {
    if (ONLINE) void sync.loadChat(chatId, remote.ensureDm);
  },
  /** Подгрузить сообщения старше самого раннего загруженного. Возвращает, сколько пришло. */
  async loadOlder(chatId: string): Promise<number> {
    if (!ONLINE || state.ui.chatEnd[chatId]) return 0;
    return sync.loadOlder(chatId);
  },

  /* сообщения */
  send(chatId: string, text: string, replyTo?: string, attachment?: Message['attachment']) {
    const msg: Message = { id: uid(), authorId: ME, text, ts: Date.now(), reactions: [], replyTo, attachment, pending: ONLINE };
    addMessage(chatId, msg);
    if (ONLINE) void remote.send(chatId, msg);
  },
  async sendFile(chatId: string, file: File, text: string, extra?: Partial<Message['attachment']>) {
    if (!ONLINE) {
      const size = file.size > 1_048_576 ? `${(file.size / 1_048_576).toFixed(1)} МБ` : `${Math.max(1, Math.round(file.size / 1024))} КБ`;
      // в офлайн-режиме файл живёт до закрытия приложения
      return actions.send(chatId, text, undefined, { name: file.name, size, url: URL.createObjectURL(file), type: file.type, ...extra });
    }
    if (file.size > 50 * 1_048_576) return sync.toast('Файл больше 50 МБ — такие пока не загружаются');
    sync.toast(`Загружаю ${file.name}…`);
    try {
      const attachment = await remote.uploadAttachment(file, chatId);
      actions.send(chatId, text, undefined, { ...attachment, ...extra });
    } catch (e) {
      sync.toast(sync.errorText(e));
    }
  },
  retry(chatId: string, id: string) {
    const msg = state.messages[chatId]?.find((m) => m.id === id);
    if (!msg) return;
    setState((s) => ({ messages: { ...s.messages, [chatId]: s.messages[chatId].map((m) => (m.id === id ? { ...m, pending: true, failed: false } : m)) } }));
    void remote.send(chatId, msg);
  },
  editMessage(chatId: string, id: string, text: string) {
    setState((s) => ({
      messages: { ...s.messages, [chatId]: (s.messages[chatId] ?? []).map((m) => (m.id === id ? { ...m, text, edited: true } : m)) },
    }));
    if (ONLINE) void remote.editMessage(id, text, chatId, state.messages[chatId]?.find((m) => m.id === id)?.attachment);
  },
  deleteMessage(chatId: string, id: string) {
    const authorId = state.messages[chatId]?.find((m) => m.id === id)?.authorId ?? ME;
    setState((s) => ({ messages: { ...s.messages, [chatId]: (s.messages[chatId] ?? []).filter((m) => m.id !== id) } }));
    if (ONLINE) void remote.deleteMessage(id, authorId);
  },
  toggleReaction(chatId: string, id: string, emoji: string) {
    let adding = true;
    setState((s) => ({
      messages: {
        ...s.messages,
        [chatId]: (s.messages[chatId] ?? []).map((m) => {
          if (m.id !== id) return m;
          const r = m.reactions.find((x) => x.emoji === emoji);
          let reactions = m.reactions;
          if (!r) reactions = [...reactions, { emoji, users: [ME] }];
          else {
            adding = !r.users.includes(ME);
            const users = adding ? [...r.users, ME] : r.users.filter((u) => u !== ME);
            reactions = users.length
              ? reactions.map((x) => (x.emoji === emoji ? { ...x, users } : x))
              : reactions.filter((x) => x.emoji !== emoji);
          }
          return { ...m, reactions };
        }),
      },
    }));
    if (ONLINE) void remote.setReaction(chatId, id, emoji, adding);
  },

  /* профиль */
  async saveProfile(profile: Profile): Promise<Profile> {
    if (!ONLINE) {
      setState(() => ({ profile }));
      return profile;
    }
    const saved = await remote.saveProfile(profile);
    setState(() => ({ profile: saved }));
    return saved;
  },
  setPresence(presence: Profile['presence']) {
    setState((s) => ({ profile: { ...s.profile, presence } }));
    if (ONLINE) void remote.savePresence(state.profile);
  },
  updateSettings(patch: Partial<Settings>) {
    setState((s) => ({ settings: { ...s.settings, ...patch } }));
  },

  /* серверы */
  createServer(server: Server) {
    if (ONLINE) {
      void remote.createServer(server.name, server.color, server.channels);
      return;
    }
    setState((s) => ({
      servers: [...s.servers, server],
      lastChannel: { ...s.lastChannel, [server.id]: server.channels.find((c) => c.kind === 'text')?.id ?? '' },
      ui: { ...s.ui, view: 'server', serverId: server.id, modal: null, mobileChat: true },
    }));
  },
  joinByCode: (code: string) => (ONLINE ? remote.joinByCode(code) : Promise.resolve('Вход по приглашению работает в онлайн-режиме')),
  createInvite: (serverId: string) => (ONLINE ? remote.createInvite(serverId) : Promise.resolve(serverId.slice(0, 8))),
  updateServer(id: string, fn: (s: Server) => Server) {
    const before = state.servers.find((s) => s.id === id);
    updateServerLocal(id, fn);
    if (ONLINE && before) remote.scheduleServerSync(before);
  },
  deleteServer(id: string) {
    const server = state.servers.find((s) => s.id === id);
    if (state.ui.voice?.serverId === id) void actions.leaveVoice();
    setState((s) => {
      const servers = s.servers.filter((x) => x.id !== id);
      return {
        servers,
        ui: { ...s.ui, modal: null, view: servers.length ? 'server' : 'inbox', serverId: servers[0]?.id ?? null },
      };
    });
    if (ONLINE && server) void remote.deleteOrLeave(server);
  },

  /* голос */
  async joinVoice(serverId: string, channelId: string) {
    if (state.ui.voice) await actions.leaveVoice();
    setUi({ voice: { serverId, channelId } });
    if (!ONLINE) {
      updateServerLocal(serverId, (srv) => ({ ...srv, voice: { ...srv.voice, [channelId]: [ME, ...(srv.voice[channelId] ?? []).filter((u) => u !== ME)] } }));
      return;
    }
    void sync.trackMe();
    try {
      await voice.connect({ roomId: channelId });
    } catch (e) {
      sync.toast('Не удалось подключиться к голосу: ' + sync.errorText(e));
      setUi({ voice: null });
      void sync.trackMe();
    }
  },
  async leaveVoice() {
    const v = state.ui.voice;
    if (!v) return;
    setUi({ voice: null, camera: false, sharing: false });
    if (!ONLINE) {
      updateServerLocal(v.serverId, (srv) => ({ ...srv, voice: { ...srv.voice, [v.channelId]: (srv.voice[v.channelId] ?? []).filter((u) => u !== ME) } }));
      return;
    }
    await voice.disconnect();
    void sync.trackMe();
  },
  toggleMute() {
    if (state.ui.muted && ONLINE && !social.mayISpeak()) return sync.toast('Это сцена: говорят по приглашению. Подними руку ✋ — модератор даст слово');
    const muted = !state.ui.muted;
    setUi({ muted, deafened: muted ? state.ui.deafened : false });
    if (ONLINE) {
      void voice.setMic(!muted);
      if (!muted) voice.setDeafened(false);
    }
  },
  toggleDeafen() {
    const deafened = !state.ui.deafened;
    setUi({ deafened, muted: deafened ? true : state.ui.muted });
    if (ONLINE) {
      voice.setDeafened(deafened);
      if (deafened) void voice.setMic(false);
    }
  },
  toggleCamera() {
    if (ONLINE) void voice.setCamera(!state.ui.camera);
    else setUi({ camera: !state.ui.camera });
  },
  toggleScreen() {
    if (ONLINE) void voice.setScreen(!state.ui.sharing);
    else setUi({ sharing: !state.ui.sharing });
  },

  /* истории */
  openStories(userId: string, index = 0) {
    if (activeStories(userId).length) setUi({ stories: { userId, index }, card: null });
  },
  closeStories() {
    setUi({ stories: null });
  },
  markStorySeen(story: Story) {
    if (state.settings.storiesSeen?.[story.id]) return;
    const now = Date.now();
    const seen = Object.fromEntries(Object.entries(state.settings.storiesSeen ?? {}).filter(([, exp]) => exp > now));
    actions.updateSettings({ storiesSeen: { ...seen, [story.id]: story.expiresAt } });
  },
  async postStory(file: File, caption: string, audience: 'all' | 'friends' = 'all'): Promise<string | null> {
    const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null;
    if (!kind) return 'Подходят только фото и видео';
    if (file.size > 50 * 1_048_576) return 'Файл больше 50 МБ';
    const now = Date.now();
    if (!ONLINE) {
      const story: Story = { id: uid(), authorId: ME, url: URL.createObjectURL(file), kind, caption, ts: now, expiresAt: now + STORY_HOURS * 3_600_000 };
      setState((s) => ({ stories: [...s.stories, story] }));
      return null;
    }
    try {
      const story = await remote.postStory(file, kind, caption, audience);
      setState((s) => (s.stories.some((x) => x.id === story.id) ? {} : { stories: [...s.stories, story] }));
      return null;
    } catch (e) {
      return sync.errorText(e);
    }
  },
  deleteStory(id: string) {
    const story = state.stories.find((x) => x.id === id);
    setState((s) => ({ stories: s.stories.filter((x) => x.id !== id) }));
    if (ONLINE && story) void remote.deleteStory(story);
  },

  /* лента */
  async postReel(file: File, caption: string): Promise<string | null> {
    if (!file.type.startsWith('video/')) return 'В ленту можно выложить только видео';
    if (file.size > 50 * 1_048_576) return 'Видео больше 50 МБ — сожми его или обрежь';
    if (!ONLINE) {
      const reel: Reel = { id: uid(), authorId: ME, url: URL.createObjectURL(file), caption, ts: Date.now(), likes: [] };
      setState((s) => ({ reels: [reel, ...s.reels] }));
      return null;
    }
    try {
      const reel = await remote.postReel(file, caption);
      setState((s) => (s.reels.some((x) => x.id === reel.id) ? {} : { reels: [reel, ...s.reels] }));
      return null;
    } catch (e) {
      return sync.errorText(e);
    }
  },
  toggleLike(reelId: string) {
    const reel = state.reels.find((r) => r.id === reelId);
    if (!reel) return;
    const on = !reel.likes.includes(ME);
    setState((s) => ({ reels: s.reels.map((r) => (r.id === reelId ? { ...r, likes: on ? [...r.likes, ME] : r.likes.filter((u) => u !== ME) } : r)) }));
    if (ONLINE) void remote.setLike(reelId, on);
  },
  deleteReel(id: string) {
    const reel = state.reels.find((r) => r.id === id);
    setState((s) => ({ reels: s.reels.filter((r) => r.id !== id) }));
    if (ONLINE && reel) void remote.deleteReel(reel);
  },
  loadMoreReels: () => (ONLINE ? sync.loadReels(false) : Promise.resolve()),

  /* звонки: личные (userId) и в группе ('g:<id>') */
  async startCall(target: string, video = false) {
    if (!ONLINE) return sync.toast('Звонки работают в онлайн-режиме — войди через почту');
    if (state.ui.call) return sync.toast('Сначала заверши текущий звонок');
    if (state.ui.voice) await actions.leaveVoice();
    const group = target.startsWith('g:') ? target.slice(2) : null;
    setUi({ call: { kind: group ? 'group' : 'dm', userId: group ? ME : target, groupId: group ?? undefined, callId: '', dmId: group ?? '', state: group ? 'active' : 'outgoing', video, mine: true, since: group ? Date.now() : undefined }, camera: false, sharing: false });
    if (!group) startRing('out');
    try {
      if (group) {
        // в группе не ждём ответа: заходим в комнату, остальным приходит приглашение
        const callId = await remote.startGroupCall(group, video);
        const cur = getState().ui.call;
        if (!cur) return;
        setUi({ call: { ...cur, callId } });
        await voice.connect({ groupId: group }, await remote.groupCallKey(group));
      } else {
        const started = await remote.startCall(target, video);
        const current = getState().ui.call;
        if (!started || !current) throw new Error('Не удалось начать звонок');
        setUi({ call: { ...current, ...started } });
        await voice.connect({ dmId: started.dmId }, await e2e.callKey(sync.R(target)).catch(() => null));
        // никто не ответил за 45 секунд
        const id = started.callId;
        window.setTimeout(() => {
          const c = state.ui.call;
          if (c?.callId === id && c.state === 'outgoing') void endCall('missed', 'Не отвечает');
        }, 45_000);
      }
      if (video) await voice.setCamera(true);
    } catch (e) {
      stopRing();
      sync.toast('Звонок не начался: ' + sync.errorText(e));
      setUi({ call: null });
      void voice.disconnect();
    }
  },
  async acceptCall(withVideo = false) {
    const c = state.ui.call;
    if (!c || c.state !== 'incoming') return;
    stopRing();
    if (state.ui.voice) await actions.leaveVoice();
    setUi({ call: { ...c, state: 'active', since: Date.now() } });
    if (c.kind === 'dm') void remote.setCallStatus(c.callId, 'accepted');
    try {
      if (c.kind === 'group') await voice.connect({ groupId: c.groupId }, await remote.groupCallKey(c.groupId!));
      else await voice.connect({ dmId: c.dmId }, await e2e.callKey(sync.R(c.userId)).catch(() => null));
      if (withVideo) await voice.setCamera(true);
    } catch (e) {
      sync.toast('Не удалось подключиться: ' + sync.errorText(e));
      void endCall('ended');
    }
  },
  declineCall() {
    const c = state.ui.call;
    if (!c) return;
    stopRing();
    setUi({ call: null });
    if (c.kind === 'dm') void remote.setCallStatus(c.callId, 'declined');
  },
  hangUp: () => endCall('ended'),

  /* группы */
  async createGroup(name: string, userIds: string[]): Promise<string | null> {
    if (!ONLINE) return 'Группы работают в онлайн-режиме — в офлайне нет других людей';
    try {
      const id = await remote.createGroup(name, userIds);
      const [g] = await sync.fetchGroups([id]);
      setState((s) => ({ groups: s.groups.some((x) => x.id === id) ? s.groups : [g, ...s.groups], ui: { ...s.ui, view: 'home', homeTab: `g:${id}`, modal: null, mobileChat: true } }));
      return null;
    } catch (e) {
      return sync.errorText(e);
    }
  },
  /** «Избранное» — чат с самим собой для заметок и пересланного */
  async openSaved() {
    const have = state.groups.find((g) => g.saved);
    if (have) return actions.openHome(`g:${have.id}`);
    if (!ONLINE) return sync.toast('«Избранное» работает в онлайн-режиме');
    try {
      const id = await remote.savedChat();
      const [g] = await sync.fetchGroups([id]);
      setState((s) => ({ groups: s.groups.some((x) => x.id === id) ? s.groups : [g, ...s.groups] }));
      actions.openHome(`g:${id}`);
    } catch (e) {
      sync.toast(sync.errorText(e));
    }
  },
  /** Группа/канал, в который только что вступили: загрузить и открыть */
  async openFetchedGroup(id: string) {
    const [g] = await sync.fetchGroups([id]);
    if (!g) return;
    setState((s) => ({ groups: s.groups.some((x) => x.id === id) ? s.groups.map((x) => (x.id === id ? g : x)) : [g, ...s.groups] }));
    actions.openHome(`g:${id}`);
  },
  async addToGroup(groupId: string, userId: string) {
    try {
      await remote.addToGroup(groupId, userId);
      setState((s) => ({ groups: s.groups.map((g) => (g.id === groupId && !g.members.includes(userId) ? { ...g, members: [...g.members, userId] } : g)) }));
    } catch (e) {
      sync.toast(sync.errorText(e));
    }
  },
  async renameGroup(groupId: string, name: string) {
    setState((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) }));
    await remote.renameGroup(groupId, name).catch((e) => sync.toast(sync.errorText(e)));
  },
  /** Убрать группу/канал из списка (сервер уже отписал) */
  async leaveGroupLocal(groupId: string) {
    setState((s) => ({ groups: s.groups.filter((g) => g.id !== groupId), ui: { ...s.ui, homeTab: 'friends', mobileChat: false } }));
  },
  async leaveGroup(groupId: string) {
    setState((s) => ({ groups: s.groups.filter((g) => g.id !== groupId), ui: { ...s.ui, homeTab: 'friends', mobileChat: false } }));
    await remote.leaveGroup(groupId).catch((e) => sync.toast(sync.errorText(e)));
  },

  /* модерация */
  async moderate(kind: 'kick' | 'ban' | 'mute' | 'unmute', serverId: string, userId: string, minutes = 60): Promise<string> {
    if (!ONLINE) return 'Модерация работает в онлайн-режиме';
    try {
      if (kind === 'kick') await remote.kick(serverId, userId);
      if (kind === 'ban') await remote.ban(serverId, userId);
      if (kind === 'mute') await remote.mute(serverId, userId, minutes);
      if (kind === 'unmute') await remote.unmute(serverId, userId);
      if (kind === 'kick' || kind === 'ban')
        updateServerLocal(serverId, (srv) => ({ ...srv, members: srv.members.filter((m) => m.userId !== userId) }));
      if (kind === 'mute') updateServerLocal(serverId, (srv) => ({ ...srv, mutes: { ...(srv.mutes ?? {}), [userId]: Date.now() + minutes * 60_000 } }));
      if (kind === 'unmute')
        updateServerLocal(serverId, (srv) => {
          const mutes = { ...(srv.mutes ?? {}) };
          delete mutes[userId];
          return { ...srv, mutes };
        });
      const name = state.users[userId]?.name ?? 'Участник';
      return { kick: `${name} удалён из сообщества`, ban: `${name} заблокирован`, mute: `${name} не сможет писать ${minutes >= 1440 ? `${Math.round(minutes / 1440)} дн.` : minutes >= 60 ? `${Math.round(minutes / 60)} ч` : `${minutes} мин`}`, unmute: `${name} снова может писать` }[kind];
    } catch (e) {
      return sync.errorText(e);
    }
  },
  async report(messageId: string, reason: string): Promise<string> {
    if (!ONLINE) return 'Жалобы работают в онлайн-режиме';
    try {
      await remote.report(messageId, reason);
      return 'Жалоба отправлена модераторам';
    } catch (e) {
      return sync.errorText(e);
    }
  },

  /* комментарии к видео */
  loadComments(reelId: string) {
    if (ONLINE) void sync.loadComments(reelId).catch((e) => sync.toast(sync.errorText(e)));
    else setState((s) => (s.comments[reelId] ? {} : { comments: { ...s.comments, [reelId]: [] } }));
  },
  addComment(reelId: string, text: string) {
    const t = text.trim().slice(0, 500);
    if (!t) return;
    if (ONLINE) return void remote.addComment(reelId, t).catch((e) => sync.toast(sync.errorText(e)));
    const c = { id: uid(), reelId, authorId: ME, text: t, ts: Date.now() };
    setState((s) => ({ comments: { ...s.comments, [reelId]: [...(s.comments[reelId] ?? []), c] }, reels: s.reels.map((r) => (r.id === reelId ? { ...r, comments: (r.comments ?? 0) + 1 } : r)) }));
  },
  deleteComment(reelId: string, id: string) {
    setState((s) => ({ comments: { ...s.comments, [reelId]: (s.comments[reelId] ?? []).filter((c) => c.id !== id) }, reels: s.reels.map((r) => (r.id === reelId ? { ...r, comments: Math.max(0, (r.comments ?? 1) - 1) } : r)) }));
    if (ONLINE) void remote.deleteComment(id);
  },

  /* друзья */
  acceptFriend(id: string) {
    setState((s) => ({ friends: [...s.friends, id], pending: s.pending.filter((x) => x !== id) }));
    if (ONLINE) void remote.acceptFriend(id);
  },
  declineFriend(id: string) {
    setState((s) => ({ pending: s.pending.filter((x) => x !== id) }));
    if (ONLINE) void remote.removeFriend(id);
  },
  removeFriend(id: string) {
    setState((s) => ({ friends: s.friends.filter((x) => x !== id) }));
    if (ONLINE) void remote.removeFriend(id);
  },
  async requestFriend(userId: string): Promise<string> {
    if (ONLINE) return remote.requestFriend(userId, state.users[userId]?.name);
    actions.acceptFriend(userId);
    return 'Добавлен в друзья';
  },
  async addFriendByName(username: string): Promise<string> {
    if (ONLINE) return remote.requestFriendByName(username);
    const s = getState();
    const u = Object.values(s.users).find((x) => x.username.toLowerCase() === username.toLowerCase().trim());
    if (!u) return 'В офлайн-режиме других людей нет — войди через почту, чтобы добавлять друзей';
    if (s.friends.includes(u.id)) return `${u.name} уже у тебя в друзьях`;
    setState((st) => ({ friends: [...st.friends, u.id], pending: st.pending.filter((x) => x !== u.id) }));
    return `${u.name} добавлен в друзья`;
  },
};

/* ---------- звонки: внутреннее ---------- */

const fmtDuration = (ms: number) => {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
};

/** Завершить звонок у себя и, если нужно, сообщить второй стороне. */
async function endCall(status: 'ended' | 'missed' | 'declined' | null, note?: string) {
  const c = state.ui.call;
  if (!c) return;
  stopRing();
  setUi({ call: null });
  if (note) sync.toast(note);
  const alone = state.ui.callPeers.length === 0;
  if (c.kind === 'group') {
    // последний вышел из звонка в группе — приглашения у остальных гаснут
    if (status && c.callId && alone) void remote.setCallStatus(c.callId, 'ended');
    await voice.disconnect();
    if (c.mine && c.callId && c.groupId) actions.send(`g:${c.groupId}`, `📞 Звонок в группе · ${fmtDuration(Date.now() - (c.since ?? Date.now()))}`);
    return;
  }
  if (status && c.callId) void remote.setCallStatus(c.callId, c.state === 'outgoing' && status === 'ended' ? 'missed' : status);
  await voice.disconnect();
  // итог звонка в переписке пишет тот, кто звонил
  if (c.mine && c.callId) actions.send(`dm:${c.userId}`, c.since ? `📞 Звонок · ${fmtDuration(Date.now() - c.since)}` : '📞 Пропущенный звонок');
}

// регистрация обработчиков — после загрузки всех модулей (у store и sync взаимный импорт)
const registerHandlers = () => {
  sync.provideActions(() => actions);
  if (!ONLINE) return;
  voice.setCallLostHandler(() => void endCall('ended', 'Связь со звонком прервалась'));
  sync.setCallHandler((row, kind) => {
    const c = state.ui.call;
    if (kind === 'create' && row.status === 'ringing' && row.from !== ME) {
      if (Date.now() - Date.parse(row.$createdAt) > 60_000) return;
      const group = state.groups.find((g) => g.id === row.dmId);
      // уже разговариваю — второй личный звонок получает «занято», приглашение в группу просто пропускаем
      if (c) return group ? undefined : void remote.setCallStatus(row.$id, 'busy');
      setUi({ call: { kind: group ? 'group' : 'dm', userId: row.from, groupId: group?.id, callId: row.$id, dmId: row.dmId, state: 'incoming', video: row.video, mine: false } });
      startRing('in');
      notifyCall(state.users[row.from]?.name ?? 'Кто-то', row.video, group?.name);
      // приглашение в группу гаснет само через минуту
      if (group) window.setTimeout(() => state.ui.call?.callId === row.$id && state.ui.call.state === 'incoming' && actions.declineCall(), 60_000);
      return;
    }
    if (!c || row.$id !== c.callId || kind !== 'update') return;
    if (c.kind === 'group') {
      if (row.status === 'ended' && c.state === 'incoming') void endCall(null);
      return;
    }
    if (row.status === 'accepted' && c.state === 'outgoing') {
      stopRing();
      setUi({ call: { ...c, state: 'active', since: Date.now() } });
    } else if (row.status === 'declined') void endCall(null, 'Звонок отклонён');
    else if (row.status === 'busy') void endCall(null, 'Собеседник уже разговаривает');
    else if (row.status === 'missed' && c.state === 'incoming') void endCall(null, 'Пропущенный звонок');
    else if (row.status === 'ended') void endCall(null);
  });
}

/* ---------- истории: выборки ---------- */

/** Действующие истории человека, от старых к новым */
export const activeStories = (userId: string, s: State = state) => {
  const now = Date.now();
  return s.stories.filter((x) => x.authorId === userId && x.expiresAt > now).sort((a, b) => a.ts - b.ts);
};

/** Есть ли у человека истории и все ли просмотрены: 'none' | 'new' | 'seen' */
export const storyStateOf = (userId: string, s: State = state): 'none' | 'new' | 'seen' => {
  const list = activeStories(userId, s);
  if (!list.length) return 'none';
  const seen = s.settings.storiesSeen ?? {};
  return list.every((x) => seen[x.id]) ? 'seen' : 'new';
};

/** Порядок людей в полосе историй: сначала непросмотренные, потом просмотренные; свои — отдельно первым кружком */
export const storyAuthors = (s: State = state): string[] => {
  const now = Date.now();
  const latest = new Map<string, number>();
  s.stories.forEach((x) => x.expiresAt > now && x.authorId !== ME && latest.set(x.authorId, Math.max(latest.get(x.authorId) ?? 0, x.ts)));
  return [...latest.keys()].sort((a, b) => {
    const sa = storyStateOf(a, s) === 'new' ? 0 : 1;
    const sb = storyStateOf(b, s) === 'new' ? 0 : 1;
    return sa - sb || (latest.get(b) ?? 0) - (latest.get(a) ?? 0);
  });
};

// sync берёт действия отсюда лениво (модули импортируют друг друга) — регистрируем,
// когда все модули уже загружены, иначе порядок сборки может оказаться другим
queueMicrotask(registerHandlers);
