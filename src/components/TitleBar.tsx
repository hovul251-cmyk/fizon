import { useState } from 'react';
import { ME } from '../data';
import { Icon, type IconName } from '../icons';
import { IS_DESKTOP_APP, isNarrow } from '../lib/platform';
import { actions, getState, setUi, useStore } from '../store';
import type { Presence } from '../types';
import { Avatar, presenceColor, presenceLabel, usePerson, useStoryState } from './common';
import { useInbox } from './InboxView';

// Верхняя панель вместо полосы серверов: разделы Лента · Чаты · Входящие по центру,
// справа — ты сам (истории, статус, настройки) и кнопки окна.
// В Tauri включён withGlobalTauri, поэтому API окна доступно без npm-пакета.
type TauriWindow = { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void> };
const win = (): TauriWindow | null => {
  const t = (window as unknown as { __TAURI__?: { window: { getCurrentWindow(): TauriWindow } } }).__TAURI__;
  return t ? t.window.getCurrentWindow() : null;
};

function NavTab({ icon, label, on, count, onClick }: { icon: IconName; label: string; on: boolean; count?: number; onClick: () => void }) {
  return (
    <button type="button" className={`nav-tab ${on ? 'on' : ''}`} onClick={onClick} aria-current={on ? 'page' : undefined}>
      <Icon name={icon} size={17} />
      {label}
      {!!count && <span className="count">{count}</span>}
    </button>
  );
}

const openChats = () => {
  const s = getState();

  if (s.ui.serverId && s.servers.some((x) => x.id === s.ui.serverId)) actions.openServer(s.ui.serverId);
  else actions.openHome(s.ui.homeTab);
  // на телефоне «Чаты» всегда ведут к списку
  if (isNarrow()) setUi({ mobileChat: false });
};

function MeMenu() {
  const me = usePerson(ME)!;
  const story = useStoryState(ME);
  const [open, setOpen] = useState(false);
  const pick = (p: Presence) => {
    actions.setPresence(p);
    setOpen(false);
  };
  const go = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="me-menu">
      <button type="button" className="me-btn" aria-label="Мой профиль и статус" onClick={() => setOpen((v) => !v)}>
        <Avatar person={me} size={30} border="var(--bg0)" />
      </button>
      {open && (
        <>
          <div className="click-away" onMouseDown={() => setOpen(false)} />
          <div className="dropdown me-drop" role="menu">
            <div className="me-drop-head">
              <Avatar person={me} size={44} border="var(--bg2)" />
              <span className="grow">
                <span className="strong ellipsis" style={me.nameStyle}>
                  {me.name}
                </span>
                <span className="muted small">@{me.username}</span>
              </span>
            </div>
            {story !== 'none' && (
              <button type="button" role="menuitem" onClick={go(() => actions.openStories(ME))}>
                <Icon name="play" size={16} /> Мои истории
              </button>
            )}
            <button type="button" role="menuitem" onClick={go(() => setUi({ modal: { kind: 'storyComposer' } }))}>
              <Icon name="plusCircle" size={16} /> Добавить историю
            </button>
            <button type="button" role="menuitem" onClick={go(() => setUi({ modal: { kind: 'editor' } }))}>
              <Icon name="edit" size={16} /> Оформить профиль
            </button>
            <div className="menu-sep" />
            {(['online', 'idle', 'dnd', 'offline'] as Presence[]).map((p) => (
              <button type="button" role="menuitemradio" aria-checked={me.presence === p} key={p} onClick={() => pick(p)}>
                <span className="pdot" style={{ background: presenceColor[p] }} />
                {p === 'offline' ? 'Невидимый' : presenceLabel[p]}
                {me.presence === p && <Icon name="check" size={14} className="ml-auto" />}
              </button>
            ))}
            <div className="menu-sep" />
            <button type="button" role="menuitem" onClick={go(() => setUi({ modal: { kind: 'userSettings' } }))}>
              <Icon name="settings" size={16} /> Настройки
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Nav() {
  const view = useStore((s) => s.ui.view);
  const { unread } = useInbox();
  return (
    <nav className="nav" aria-label="Разделы">
      <NavTab icon="film" label="Лента" on={view === 'feed'} onClick={actions.openFeed} />
      <NavTab icon="bubble" label="Чаты" on={view === 'home' || view === 'server'} onClick={openChats} />
      <NavTab icon="inbox" label="Входящие" on={view === 'inbox'} count={unread} onClick={actions.openInbox} />
      <NavTab icon="puzzle" label="Плагины" on={view === 'plugins'} onClick={actions.openPlugins} />
    </nav>
  );
}

export function TitleBar() {
  const inside = useStore((s) => s.loggedIn && !s.ui.booting && !s.ui.onboarding);
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-name" data-tauri-drag-region>
        <span className="brand-mark">F</span>
        Fizion
      </div>
      {inside ? <Nav /> : <span />}
      <div className="titlebar-right" data-tauri-drag-region>
        {inside && <MeMenu />}
        {IS_DESKTOP_APP && (
        <div className="titlebar-ctrls">
          <button type="button" aria-label="Свернуть" onClick={() => win()?.minimize()}>
            <Icon name="minimize" size={14} />
          </button>
          <button type="button" aria-label="Развернуть" onClick={() => win()?.toggleMaximize()}>
            <Icon name="maximize" size={14} />
          </button>
          <button type="button" aria-label="Закрыть" className="close" onClick={() => win()?.close()}>
            <Icon name="close" size={14} />
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
