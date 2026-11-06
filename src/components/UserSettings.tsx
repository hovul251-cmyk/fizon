import { useState, useSyncExternalStore } from 'react';
import * as social from '../online/social';
import { ME } from '../data';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import { IS_DESKTOP_APP, IS_TAURI } from '../lib/platform';
import { APP_VERSION } from '../lib/updates';
import { NotifySettings, PrivacySettings } from './SettingsExtra';
import { myEmail } from '../online/sync';
import { actions, setUi, useStore } from '../store';
import type { Settings } from '../types';
import { Avatar, Toggle, usePerson } from './common';
import { ChatBgSettings } from './ChatBg';
import { InterfaceSettings, SecuritySettings, SoundSettings, VoiceSettings } from './SettingsMore';
import { WalletSettings } from './Wallet';
import { AdminPanel } from './Admin';
import type { IconName } from '../icons';

type Tab = 'account' | 'look' | 'ui' | 'voice' | 'sounds' | 'notify' | 'privacy' | 'security' | 'wallet' | 'admin' | null;
const TITLES: Record<NonNullable<Tab>, string> = {
  account: 'Мой аккаунт',
  look: 'Внешний вид',
  ui: 'Интерфейс',
  voice: 'Голос и видео',
  sounds: 'Звуки',
  notify: 'Уведомления',
  privacy: 'Шифрование',
  security: 'Конфиденциальность',
  wallet: 'Кошелёк и подарки',
  admin: 'Управление',
};

const themes: [Settings['theme'], string, string, string][] = [
  ['dark', 'Тёмная', '#1E1F22', '#313338'],
  ['ocean', 'Ночной океан', '#0A1324', '#13213C'],
  ['midnight', 'Полночь', '#000000', '#111214'],
  ['light', 'Светлая', '#E3E5E8', '#FFFFFF'],
];

const accents = ['#5865F2', '#2F8CFF', '#23A55A', '#EB459E', '#F0B232', '#22D3EE', '#9B59B6', '#F23F43'];

export function UserSettings() {
  const [tab, setTabRaw] = useState<Tab>(() => (window.innerWidth <= 760 ? null : 'look'));
  const [openedOnMobile, setOpened] = useState(false);
  const settings = useStore((s) => s.settings);
  const profile = useStore((s) => s.profile);
  const me = usePerson(ME)!;
  const set = actions.updateSettings;
  const close = () => setUi({ modal: null });
  const role = useStore((s) => s.ui.staff);
  const setTab = (t: Tab) => {
    setTabRaw(t);
    setOpened(true);
  };
  // «Назад»: на телефоне — к списку разделов, на компьютере — закрыть настройки
  const back = () => {
    if (window.innerWidth <= 760 && openedOnMobile) {
      setOpened(false);
      return;
    }
    close();
  };
  const item = (t: NonNullable<Tab>, label: string, icon: IconName) => (
    <button type="button" className={`nav-item ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
      <Icon name={icon} size={18} /> <span className="grow">{label}</span> <Icon name="chevronRight" size={14} className="m-only" />
    </button>
  );
  const title = TITLES[tab ?? 'look'];

  return (
    <div className={`fullscreen settings-screen ${openedOnMobile ? 'm-open' : 'm-list'}`} role="dialog" aria-modal="true" aria-label="Настройки">
      <nav className="settings-nav">
        <div className="settings-top m-only">
          <button type="button" className="back-btn" onClick={close} aria-label="Назад">
            <Icon name="arrowLeft" size={20} /> Назад
          </button>
          <b>Настройки</b>
        </div>
        <div className="cat">АККАУНТ</div>
        {item('account', 'Мой аккаунт', 'user')}
        <button type="button" className="nav-item" onClick={() => setUi({ modal: { kind: 'editor' } })}>
          <Icon name="edit" size={18} /> <span className="grow">Профиль</span> <Icon name="chevronRight" size={14} className="m-only" />
        </button>
        {item('security', 'Конфиденциальность', 'lock')}
        {item('wallet', 'Кошелёк и подарки', 'gift')}
        <div className="cat">ПРИЛОЖЕНИЕ</div>
        {item('look', 'Внешний вид', 'image')}
        {item('ui', 'Интерфейс', 'layout')}
        {item('voice', 'Голос и видео', 'mic')}
        {item('sounds', 'Звуки', 'bell')}
        {item('notify', IS_DESKTOP_APP ? 'Уведомления и обновления' : 'Уведомления', 'inbox')}
        {item('privacy', 'Шифрование', 'shield')}
        {role && (
          <>
            <div className="cat">УПРАВЛЕНИЕ</div>
            {item('admin', role === 'owner' ? 'Панель владельца' : 'Панель админа', 'crown')}
          </>
        )}
        <div className="menu-sep" />
        <button type="button" className="nav-item danger" onClick={() => { close(); void actions.logout(); }}>
          <Icon name="logout" size={18} /> <span className="grow">Выйти</span>
        </button>
        <div className="muted small pad">Neon {APP_VERSION} · {IS_DESKTOP_APP ? 'Windows' : IS_TAURI ? 'Android' : 'веб'} · {ONLINE ? 'онлайн' : 'офлайн-режим'}</div>
      </nav>
      <main className="settings-main">
        <div className="settings-back">
          <button type="button" className="back-btn" onClick={back}>
            <Icon name="arrowLeft" size={20} /> Назад
          </button>
          <b className="m-only">{title}</b>
        </div>
        {tab === 'look' && (
          <>
            <div className="settings-head">
              <h1>Внешний вид</h1>
            </div>
            <div className="ed-col narrow">
              <div className="field">
                ТЕМА
                <div className="themes">
                  {themes.map(([k, l, a, b]) => (
                    <button type="button" key={k} className={`theme ${settings.theme === k ? 'on' : ''}`} onClick={() => set({ theme: k })}>
                      <span className="theme-prev" style={{ background: a }}>
                        <span style={{ background: b }} />
                      </span>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                АКЦЕНТНЫЙ ЦВЕТ
                <div className="swatches">
                  {accents.map((c) => (
                    <button type="button" key={c} aria-label={c} className={`sw round ${settings.accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} />
                  ))}
                  <label className="sw round custom" title="Свой цвет">
                    <Icon name="plus" size={14} />
                    <input type="color" value={settings.accent} onChange={(e) => set({ accent: e.target.value })} aria-label="Свой акцентный цвет" />
                  </label>
                </div>
              </div>
              <div className="field">
                ВИД СООБЩЕНИЙ
                {(
                  [
                    ['flat', 'Строками, как в Discord — аватар и имя у каждого сообщения'],
                    ['bubbles', 'Пузырями, как в Telegram — свои справа'],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k} className="radio">
                    <input type="radio" name="msgstyle" checked={(settings.messageStyle ?? 'flat') === k} onChange={() => set({ messageStyle: k })} />
                    {l}
                  </label>
                ))}
              </div>
              <ChatBgSettings />
              <div className="field">
                ПЛОТНОСТЬ СООБЩЕНИЙ
                {(
                  [
                    ['cozy', 'Удобная — аватары и отступы'],
                    ['compact', 'Компактная — больше сообщений на экране'],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k} className="radio">
                    <input type="radio" name="density" checked={settings.density === k} onChange={() => set({ density: k })} />
                    {l}
                  </label>
                ))}
              </div>
              <label className="field">
                РАЗМЕР ТЕКСТА В ЧАТАХ — {settings.fontSize} PX
                <input type="range" min={12} max={22} value={settings.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
              </label>
              <div className="font-preview" aria-hidden="true">
                <div className="msg">
                  <div className="msg-body">
                    <div className="bubble">
                      <div className="msg-head">
                        <span className="strong">Kira</span>
                      </div>
                      <div className="msg-text">Привет! Так будут выглядеть сообщения 👋</div>
                    </div>
                  </div>
                </div>
                <div className="msg mine">
                  <div className="msg-body">
                    <div className="bubble">
                      <div className="msg-text">Отлично, теперь читать удобнее</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="list-row big">
                <div className="grow">
                  <div className="strong">Уменьшить анимации</div>
                  <div className="muted small">Отключает эффекты профилей, свечение и пульсацию в голосовых</div>
                </div>
                <Toggle label="Уменьшить анимации" checked={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />
              </div>
            </div>
          </>
        )}
        {tab === 'account' && (
          <>
            <div className="settings-head">
              <h1>Мой аккаунт</h1>
            </div>
            <div className="ed-col narrow">
              <div className="account-card">
                <Avatar person={me} size={72} border="var(--bg1)" />
                <div className="grow">
                  <div className="h2" style={me.nameStyle}>
                    {profile.displayName}
                  </div>
                  <div className="muted">
                    {profile.username}
                    {ONLINE && myEmail && ` · ${myEmail}`}
                  </div>
                </div>
                <button type="button" className="btn primary" onClick={() => setUi({ modal: { kind: 'editor' } })}>
                  Редактировать профиль
                </button>
              </div>
              <div className="list-row big">
                <div className="grow">
                  <div className="strong">Где хранятся данные</div>
                  <div className="muted small">
                    {ONLINE
                      ? 'Сообщения, сообщества и профиль хранятся на сервере Neon и доступны с любого устройства.'
                      : 'Офлайн-режим: сообщения, сообщества и профиль хранятся только на этом компьютере.'}
                  </div>
                </div>
              </div>
              <BlockedList />
              {ONLINE && <DeleteAccount />}
              {!ONLINE && (
                <div className="list-row big">
                  <div className="grow">
                    <div className="strong">Сбросить все данные</div>
                    <div className="muted small">Удалит локальные сообщества, сообщения и профиль</div>
                  </div>
                  <button type="button" className="btn danger-outline" onClick={() => confirm('Удалить все локальные данные Neon?') && actions.resetAll()}>
                    Сбросить
                  </button>
                </div>
              )}
            </div>
          </>
        )}
        {tab === 'voice' && <VoiceSettings />}
        {tab === 'notify' && <NotifySettings />}
        {tab === 'privacy' && <PrivacySettings />}
        {tab === 'security' && <SecuritySettings />}
        {tab === 'ui' && <InterfaceSettings />}
        {tab === 'sounds' && <SoundSettings />}
        {tab === 'wallet' && <WalletSettings />}
        {tab === 'admin' && role && <AdminPanel />}
      </main>
      <button type="button" className="close-round" aria-label="Закрыть настройки" onClick={close}>
        <Icon name="close" />
        <span>ESC</span>
      </button>
    </div>
  );
}

function BlockedRow({ userId }: { userId: string }) {
  const p = usePerson(userId);
  return (
    <div className="list-row">
      {p && <Avatar person={p} size={32} showPresence={false} />}
      <span className="grow ellipsis">{p?.name ?? 'Пользователь'}</span>
      <button type="button" className="btn small" onClick={() => void social.unblock(userId)}>
        Разблокировать
      </button>
    </div>
  );
}

function BlockedList() {
  useSyncExternalStore(social.onSocial, social.socialVersion);
  const list = social.blockedList();
  if (!list.length) return null;
  return (
    <>
      <div className="cat flat">ЗАБЛОКИРОВАННЫЕ · {list.length}</div>
      {list.map((id) => (
        <BlockedRow key={id} userId={id} />
      ))}
    </>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open)
    return (
      <div className="list-row big">
        <div className="grow">
          <div className="strong">Удалить аккаунт</div>
          <div className="muted small">Насовсем: профиль, друзья, твои сообщества, истории и видео. Восстановить нельзя.</div>
        </div>
        <button type="button" className="btn danger-outline" onClick={() => setOpen(true)}>
          Удалить…
        </button>
      </div>
    );
  return (
    <form
      className="danger-zone"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          await social.deleteAccount(word.trim().toLowerCase());
          setUi({ modal: null });
          await actions.logout().catch(() => undefined);
          location.reload();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <b>Удалить аккаунт насовсем?</b>
      <span className="muted small">
        Удалятся профиль, друзья, сообщества, где ты владелец (вместе со всеми сообщениями), твои истории и видео. В остальных чатах твои сообщения останутся
        с подписью «Удалённый аккаунт». Отменить нельзя. Напиши слово <b>удалить</b>, чтобы подтвердить.
      </span>
      <input className="input" aria-label="Подтверждение удаления" value={word} onChange={(e) => setWord(e.target.value)} placeholder="удалить" />
      {error && <p className="form-error">{error}</p>}
      <div className="row gap-s">
        <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>
          Отмена
        </button>
        <button type="submit" className="btn danger" disabled={busy || word.trim().toLowerCase() !== 'удалить'}>
          {busy ? 'Удаляю…' : 'Удалить аккаунт'}
        </button>
      </div>
    </form>
  );
}
