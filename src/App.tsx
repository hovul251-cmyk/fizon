import { useEffect } from 'react';
import { initNotify } from './lib/notify';
import { CallOverlay } from './components/CallOverlay';
import { ChatView } from './components/ChatView';
import { PluginsView } from './components/PluginsView';
import { SearchView } from './components/SearchView';
import { NewGroupModal } from './components/Groups';
import { startPlugins } from './plugins/host';
import { IS_TAURI } from './lib/platform';
import { FeedView, ReelComposer } from './components/Feed';
import { StoryComposer, StoryViewer } from './components/Stories';
import { HomeView } from './components/HomeView';
import { InboxView } from './components/InboxView';
import { Login, Onboarding } from './components/Login';
import { MemberList } from './components/MemberList';
import { ProfileModal, ProfilePopover } from './components/Profile';
import { ProfileEditor } from './components/ProfileEditor';
import { CreateServerModal, InviteModal, ServerSettings } from './components/ServerModals';
import { canManageServer, Sidebar } from './components/Sidebar';
import { TitleBar } from './components/TitleBar';
import { UpdateBanner } from './components/Updates';
import { VoicePip } from './components/Floating';
import { UserSettings } from './components/UserSettings';
import { VoiceView } from './components/VoiceView';
import { ME } from './data';
import { Icon } from './icons';
import { ONLINE } from './lib/appwrite';
import * as sync from './online/sync';
import { actions, getState, setUi, useStore } from './store';
import type { Server } from './types';

/** Подставляем выбранную тему и акцент в CSS-переменные. */
function useTheme() {
  const settings = useStore((s) => s.settings);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.msg = settings.messageStyle ?? 'flat';
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--font-size', `${settings.fontSize}px`);
    root.classList.toggle('reduce-motion', settings.reduceMotion);
    // свой фон чатов
    const bg = settings.chatBg;
    if (bg?.url) {
      root.dataset.chatbg = '1';
      root.style.setProperty('--chat-bg', `url("${bg.url.replace(/"/g, '%22')}")`);
      root.style.setProperty('--chat-bg-dim', String(bg.dim / 100));
      root.style.setProperty('--chat-bg-blur', `${bg.blur}px`);
    } else delete root.dataset.chatbg;
  }, [settings]);
}

function EmptyServer({ server }: { server: Server }) {
  return (
    <main className="chat center">
      <div className="empty">
        <div className="empty-icon">
          <Icon name="bubble" size={40} />
        </div>
        <h2>В «{server.name}» пока нет комнат</h2>
        <p className="muted">{canManageServer(server) ? 'Нажми «+ Комната» в панели слева или открой настройки сообщества' : 'Владелец ещё не создал комнаты'}</p>
        {canManageServer(server) && (
          <button type="button" className="btn primary" onClick={() => setUi({ modal: { kind: 'serverSettings' } })}>
            Настройки сообщества
          </button>
        )}
      </div>
    </main>
  );
}

function ServerView({ server }: { server: Server }) {
  const last = useStore((s) => s.lastChannel[server.id]);
  const showMembers = useStore((s) => s.ui.showMembers);
  const users = useStore((s) => s.users);
  const myPresence = useStore((s) => s.profile.presence);
  const channel = server.channels.find((c) => c.id === last) ?? server.channels.find((c) => c.kind === 'text') ?? server.channels[0];

  return !channel ? (
    <EmptyServer server={server} />
  ) : channel.kind === 'voice' ? (
    <VoiceView server={server} channel={channel} />
  ) : (
    <div className="room">
      <ChatView
        chatId={channel.id}
        title={channel.name}
        icon="community"
        community={{ short: server.short, color: server.color }}
        server={server}
        crumb={server.name}
        topic={channel.topic}
        placeholder="Сообщение"

        ownerId={server.ownerId}
        showMembersToggle
        onInvite={() => setUi({ modal: { kind: 'invite' } })}
        intro={
          <>
            <div className="intro-icon">
              <Icon name="bubble" size={34} />
            </div>
            <h2>{channel.name}</h2>
            <p className="muted">Начало комнаты в сообществе «{server.name}». Позови людей кнопкой приглашения сверху.</p>
          </>
        }
      />
      {showMembers && (
        <div className="drawer">
          <div className="drawer-head">
            <span className="strong">Люди · {server.members.length}</span>
            <button type="button" className="plain" aria-label="Закрыть" onClick={() => setUi({ showMembers: false })}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <MemberList server={server} presenceOf={(id) => (id === ME ? (myPresence === 'offline' ? 'online' : myPresence) : users[id]?.presence ?? 'offline')} />
        </div>
      )}
    </div>
  );
}

function NoServers() {
  return (
    <main className="chat center">
      <div className="empty">
        <div className="empty-icon dashed">
          <Icon name="plus" size={40} />
        </div>
        <h2>Пока тут пусто</h2>
        <p className="muted">Создай сообщество для друзей или вступи по приглашению</p>
        <button type="button" className="btn primary" onClick={() => setUi({ modal: { kind: 'createServer' } })}>
          Создать сообщество
        </button>
      </div>
    </main>
  );
}

function Modals() {
  const modal = useStore((s) => s.ui.modal);
  const servers = useStore((s) => s.servers);
  const serverId = useStore((s) => s.ui.serverId);
  const server = servers.find((s) => s.id === serverId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = getState().ui.modal;
      if (e.key === 'Escape' && (m?.kind === 'serverSettings' || m?.kind === 'userSettings')) setUi({ modal: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!modal) return null;
  switch (modal.kind) {
    case 'profile':
      return <ProfileModal userId={modal.userId} />;
    case 'editor':
      return <ProfileEditor />;
    case 'createServer':
      return <CreateServerModal />;
    case 'invite':
      return server ? <InviteModal server={server} /> : null;
    case 'serverSettings':
      return server ? <ServerSettings server={server} /> : null;
    case 'userSettings':
      return <UserSettings />;
    case 'storyComposer':
      return <StoryComposer />;
    case 'reelComposer':
      return <ReelComposer />;
    case 'newGroup':
      return <NewGroupModal />;
  }
}

function Toast() {
  const toast = useStore((s) => s.ui.toast);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setUi({ toast: null }), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);
  if (!toast) return null;
  return (
    <div className="toast" role="status" key={toast.id}>
      {toast.text}
    </div>
  );
}

function Splash() {
  return (
    <div className="splash">
      <div className="logo pulse">F</div>
      <span className="muted">Подключаюсь к Fizion…</span>
    </div>
  );
}

/** Онлайн: восстановить сессию при запуске. */
function useOnline() {
  useEffect(() => {
    initNotify();
    startPlugins();
    if (!ONLINE) return;
    void sync.start().then((ok) => ok && openFromUrl(location.search));
    // нажали на push-уведомление, а Fizion уже открыт
    const onSw = (e: MessageEvent) => e.data?.type === 'fizion-open' && openFromUrl(new URL(e.data.url, location.origin).search);
    navigator.serviceWorker?.addEventListener('message', onSw);
    return () => navigator.serviceWorker?.removeEventListener('message', onSw);
  }, []);
}

/** Открыть чат из ссылки уведомления: ?dm=<id>, ?group=<id>, ?server=<id>&room=<id> */
function openFromUrl(search: string) {
  const q = new URLSearchParams(search);
  const local = (id: string | null) => (id ? sync.L(id) : null);
  const dm = local(q.get('dm'));
  const group = q.get('group');
  const server = q.get('server');
  const room = q.get('room');
  if (dm) actions.openDm(dm);
  else if (group) actions.openHome(`g:${group}`);
  else if (server && room) {
    actions.openServer(server);
    actions.openChannel(server, room);
  } else return;
  history.replaceState(null, '', location.pathname);
}

/** Windows: новая версия на GitHub — предложить обновиться */
export function App() {
  useTheme();
  useOnline();
  const booting = useStore((s) => s.ui.booting);
  const net = useStore((s) => s.ui.net);
  const loggedIn = useStore((s) => s.loggedIn);
  const onboarding = useStore((s) => s.ui.onboarding);
  const view = useStore((s) => s.ui.view);
  const mobileChat = useStore((s) => s.ui.mobileChat);
  const servers = useStore((s) => s.servers);
  const serverId = useStore((s) => s.ui.serverId);
  const server = servers.find((s) => s.id === serverId);

  return (
    <div className={`app ${IS_TAURI ? 'is-desktop-app' : 'is-web'}`}>
      <TitleBar />
      {net === 'reconnecting' && loggedIn && <div className="net-banner">Связь потеряна. Переподключаюсь…</div>}
      {booting ? (
        <Splash />
      ) : !loggedIn ? (
        <Login />
      ) : onboarding ? (
        <Onboarding />
      ) : (
        <div className={`shell view-${view} ${mobileChat ? 'm-chat' : 'm-list'}`}>
          {view !== 'feed' && view !== 'plugins' && <Sidebar />}
          <div className="workspace">
            {view === 'search' ? <SearchView /> : view === 'plugins' ? <PluginsView /> : view === 'feed' ? <FeedView /> : view === 'inbox' ? <InboxView /> : view === 'home' ? <HomeView /> : server ? <ServerView server={server} /> : <NoServers />}
          </div>
          <ProfilePopover />
          <Modals />
          <StoryViewer />
          <CallOverlay />
          <VoicePip />
        </div>
      )}
      <Toast />
      <UpdateBanner />
    </div>
  );
}
