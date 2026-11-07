import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import { IS_DESKTOP_APP } from '../lib/platform';
import { checkSoundFile, EVENTS, PACKS, play, preview } from '../lib/sound';
import * as auth from '../online/auth';
import * as remote from '../online/remote';
import * as voice from '../online/voice';
import { actions, setUi, useStore } from '../store';
import type { AudioPrefs, SoundEvent, SoundPrefs, UiPrefs } from '../types';
import { askPermission } from './Prompts';
import { Toggle } from './common';

const NONE = {} as const;

/* ================= интерфейс под себя ================= */

export const NAV_ITEMS: { id: string; name: string; locked?: boolean }[] = [
  { id: 'feed', name: 'Лента' },
  { id: 'chats', name: 'Чаты', locked: true },
  { id: 'inbox', name: 'Входящие' },
  { id: 'plugins', name: 'Плагины' },
];

/** Порядок разделов в верхней панели с учётом спрятанных */
export function navOrder(p: UiPrefs | undefined) {
  const order = [...(p?.order ?? []), ...NAV_ITEMS.map((n) => n.id)].filter((id, i, a) => a.indexOf(id) === i && NAV_ITEMS.some((n) => n.id === id));
  return order.filter((id) => id === 'chats' || !p?.hide?.includes(id));
}

const FONTS: Record<NonNullable<UiPrefs['font']>, [string, string]> = {
  system: ['Системный', "system-ui, -apple-system, 'Segoe UI', sans-serif"],
  inter: ['Inter', "Inter, system-ui, sans-serif"],
  rounded: ['Округлый', "'Nunito', 'Varela Round', 'Segoe UI', system-ui, sans-serif"],
  mono: ['Моноширинный', "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"],
};

/** Применить настройки интерфейса к корню страницы (CSS-переменные и data-атрибуты) */
export function applyUiPrefs(root: HTMLElement, p: UiPrefs | undefined) {
  const set = (k: string, v: string | null) => (v === null ? root.style.removeProperty(k) : root.style.setProperty(k, v));
  root.dataset.side = p?.side ?? 'left';
  root.dataset.avatars = p?.avatars ?? 'circle';
  root.toggleAttribute('data-noavatars', !!p?.hideAvatars);
  root.toggleAttribute('data-alltime', !!p?.alwaysTime);
  root.toggleAttribute('data-floatcomposer', !!p?.floatingComposer);
  set('--panel-w', p?.panelWidth ? `${p.panelWidth}px` : null);
  set('--ui-radius', p?.radius !== undefined ? `${p.radius}px` : null);
  set('--ui-font', p?.font && p.font !== 'system' ? FONTS[p.font][1] : null);
}

export function InterfaceSettings() {
  const p: UiPrefs = useStore((s) => s.settings.ui) ?? NONE;
  const set = (patch: Partial<UiPrefs>) => actions.updateSettings({ ui: { ...p, ...patch } });
  const order = navOrder({ ...p, hide: [] });
  const move = (id: string, d: -1 | 1) => {
    const o = [...order];
    const i = o.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    set({ order: o });
  };
  return (
    <div className="ed-col narrow">
      <p className="muted">Собери Neon под себя: всё меняется сразу и сохраняется на этом устройстве.</p>
      <div className="field">
        РАЗДЕЛЫ ВВЕРХУ — порядок и какие показывать
        <div className="ui-order">
          {order.map((id, i) => {
            const item = NAV_ITEMS.find((n) => n.id === id)!;
            const hidden = p.hide?.includes(id);
            return (
              <div key={id} className={`ui-order-row ${hidden ? 'off' : ''}`}>
                <span className="grow">{item.name}</span>
                <button type="button" className="plain" aria-label={`${item.name} выше`} disabled={i === 0} onClick={() => move(id, -1)}>
                  <Icon name="chevronUp" size={16} />
                </button>
                <button type="button" className="plain" aria-label={`${item.name} ниже`} disabled={i === order.length - 1} onClick={() => move(id, 1)}>
                  <Icon name="chevronDown" size={16} />
                </button>
                {!item.locked && <Toggle label={`Показывать «${item.name}»`} checked={!hidden} onChange={(v) => set({ hide: v ? (p.hide ?? []).filter((x) => x !== id) : [...(p.hide ?? []), id] })} />}
              </div>
            );
          })}
        </div>
      </div>
      <div className="field">
        СПИСОК ЧАТОВ
        <div className="seg">
          {(['left', 'right'] as const).map((k) => (
            <button type="button" key={k} className={(p.side ?? 'left') === k ? 'on' : ''} onClick={() => set({ side: k })}>
              {k === 'left' ? 'Слева' : 'Справа'}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        ШИРИНА СПИСКА ЧАТОВ — {p.panelWidth ?? 'обычная'}
        {p.panelWidth ? ' px' : ''}
        <input type="range" min={220} max={420} step={10} value={p.panelWidth ?? 300} onChange={(e) => set({ panelWidth: Number(e.target.value) })} />
      </label>
      <label className="field">
        СКРУГЛЕНИЕ УГЛОВ — {p.radius ?? 8} px
        <input type="range" min={0} max={20} value={p.radius ?? 8} onChange={(e) => set({ radius: Number(e.target.value) })} />
      </label>
      <div className="field">
        АВАТАРКИ
        <div className="seg">
          {(
            [
              ['circle', 'Круглые'],
              ['squircle', 'Скруглённые'],
              ['square', 'Квадратные'],
            ] as const
          ).map(([k, n]) => (
            <button type="button" key={k} className={(p.avatars ?? 'circle') === k ? 'on' : ''} onClick={() => set({ avatars: k })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        ШРИФТ
        <div className="seg wrap">
          {(Object.keys(FONTS) as (keyof typeof FONTS)[]).map((k) => (
            <button type="button" key={k} className={(p.font ?? 'system') === k ? 'on' : ''} style={{ fontFamily: FONTS[k][1] }} onClick={() => set({ font: k })}>
              {FONTS[k][0]}
            </button>
          ))}
        </div>
      </div>
      <div className="list-row">
        <span className="grow">Аватарки в сообщениях</span>
        <Toggle label="Аватарки в сообщениях" checked={!p.hideAvatars} onChange={(v) => set({ hideAvatars: !v })} />
      </div>
      <div className="list-row">
        <span className="grow">Время у каждого сообщения</span>
        <Toggle label="Время у каждого сообщения" checked={!!p.alwaysTime} onChange={(v) => set({ alwaysTime: v })} />
      </div>
      <div className="list-row">
        <span className="grow">Поле ввода «парит» над чатом, как в Telegram</span>
        <Toggle label="Парящее поле ввода" checked={!!p.floatingComposer} onChange={(v) => set({ floatingComposer: v })} />
      </div>
      <button type="button" className="btn ghost small" onClick={() => actions.updateSettings({ ui: {} })}>
        Вернуть как было
      </button>
    </div>
  );
}

/* ================= звуки ================= */

export function SoundSettings() {
  const p: SoundPrefs = useStore((s) => s.settings.sounds) ?? NONE;
  const set = (patch: Partial<SoundPrefs>) => actions.updateSettings({ sounds: { ...p, ...patch } });
  const [busy, setBusy] = useState<SoundEvent | null>(null);
  const [error, setError] = useState('');
  const upload = async (ev: SoundEvent, f: File | undefined) => {
    if (!f) return;
    setError('');
    const bad = await checkSoundFile(f);
    if (bad) return setError(bad);
    setBusy(ev);
    try {
      const url = ONLINE ? await remote.uploadPublic(f) : await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(f);
      });
      set({ custom: { ...p.custom, [ev]: url } });
      play(ev, true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  };
  return (
    <div className="ed-col narrow">
      <div className="field">
        НАБОР ЗВУКОВ
        <div className="sound-packs">
          {(Object.keys(PACKS) as NonNullable<SoundPrefs['pack']>[]).map((k) => (
            <button
              type="button"
              key={k}
              className={`sound-pack ${(p.pack ?? 'classic') === k ? 'on' : ''}`}
              onClick={() => {
                set({ pack: k });
                preview(k, 'mention');
              }}
            >
              <Icon name={k === 'none' ? 'volumeOff' : 'music'} size={18} />
              {PACKS[k].name}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        ГРОМКОСТЬ ЗВУКОВ — {p.volume ?? 70}%
        <input type="range" min={0} max={100} value={p.volume ?? 70} onChange={(e) => set({ volume: Number(e.target.value) })} onPointerUp={() => play('message', true)} />
      </label>
      <div className="field">
        СОБЫТИЯ И СВОИ ЗВУКИ
        <span className="muted small">Поставь на любое событие свой звук — mp3, ogg, wav или m4a, не длиннее 5 секунд.</span>
      </div>
      {EVENTS.map((ev) => {
        const off = p.off?.includes(ev.id);
        const custom = p.custom?.[ev.id];
        return (
          <div key={ev.id} className="list-row sound-row">
            <button type="button" className="plain" aria-label={`Послушать: ${ev.name}`} onClick={() => play(ev.id, true)}>
              <Icon name="play" size={16} />
            </button>
            <span className="grow">
              {ev.name}
              {custom && <span className="muted small"> · свой звук</span>}
            </span>
            {custom ? (
              <button type="button" className="btn small ghost" onClick={() => set({ custom: { ...p.custom, [ev.id]: undefined } })}>
                Убрать свой
              </button>
            ) : (
              <label className="btn small ghost">
                {busy === ev.id ? 'Загружаю…' : 'Свой звук'}
                <input type="file" accept="audio/*" hidden aria-label={`Свой звук: ${ev.name}`} onChange={(e) => (void upload(ev.id, e.target.files?.[0]), (e.target.value = ''))} />
              </label>
            )}
            <Toggle label={ev.name} checked={!off} onChange={(v) => set({ off: v ? (p.off ?? []).filter((x) => x !== ev.id) : [...(p.off ?? []), ev.id] })} />
          </div>
        );
      })}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/* ================= голос и видео ================= */

function useDevices() {
  const [list, setList] = useState<MediaDeviceInfo[]>([]);
  const [labels, setLabels] = useState(true);
  const load = async () => {
    const d = (await navigator.mediaDevices?.enumerateDevices().catch(() => [])) ?? [];
    setList(d);
    setLabels(d.some((x) => x.label));
  };
  useEffect(() => {
    void load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', load);
  }, []);
  return { list, labels, reload: load };
}

function MicTest({ prefs }: { prefs: AudioPrefs }) {
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => {
    if (level === null) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: prefs.input || undefined, noiseSuppression: prefs.noise ?? true, echoCancellation: prefs.echo ?? true, autoGainControl: prefs.agc ?? true } });
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          if (stop) return;
          an.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(100, Math.round((peak / 128) * 160)));
          requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(null);
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level === null, prefs.input, prefs.noise, prefs.echo, prefs.agc]);
  return (
    <div className="mic-test">
      <button type="button" className="btn small" onClick={() => setLevel((l) => (l === null ? 0 : null))}>
        {level === null ? 'Проверить микрофон' : 'Остановить проверку'}
      </button>
      <span className="mic-meter" aria-label="Громкость микрофона">
        <i style={{ width: `${level ?? 0}%` }} />
      </span>
    </div>
  );
}

export function VoiceSettings() {
  const a: AudioPrefs = useStore((s) => s.settings.audio) ?? NONE;
  const inCall = useStore((s) => !!s.ui.voice || !!s.ui.call);
  const callPopup = useStore((s) => !!s.settings.callPopup);
  const { list, labels, reload } = useDevices();
  const set = (patch: Partial<AudioPrefs>) => actions.updateSettings({ audio: { ...a, ...patch } });
  const pick = (kind: MediaDeviceKind, key: 'input' | 'output' | 'camera', label: string) => {
    const devs = list.filter((d) => d.kind === kind);
    return (
      <label className="field">
        {label}
        <select
          className="input"
          value={a[key] ?? ''}
          onChange={(e) => {
            set({ [key]: e.target.value || undefined });
            if (inCall && e.target.value) void voice.switchDevice(kind, e.target.value);
          }}
        >
          <option value="">По умолчанию (как в системе)</option>
          {devs
            .filter((d) => d.deviceId && d.deviceId !== 'default')
            .map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `${label.toLowerCase()} ${i + 1}`}
              </option>
            ))}
        </select>
      </label>
    );
  };
  const proc = (key: 'noise' | 'echo' | 'agc', name: string, hint: string) => (
    <div className="list-row">
      <span className="grow">
        {name}
        <span className="muted small block">{hint}</span>
      </span>
      <Toggle
        label={name}
        checked={a[key] ?? true}
        onChange={(v) => {
          set({ [key]: v });
          if (inCall) setTimeout(() => void voice.applyAudioProcessing(), 0);
        }}
      />
    </div>
  );
  return (
    <div className="ed-col narrow">
      {!labels && (
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
            s?.getTracks().forEach((t) => t.stop());
            void reload();
          }}
        >
          Показать названия устройств (нужен доступ к микрофону)
        </button>
      )}
      {pick('audioinput', 'input', 'МИКРОФОН')}
      <MicTest prefs={a} />
      {pick('audiooutput', 'output', 'ДИНАМИКИ ИЛИ НАУШНИКИ')}
      {pick('videoinput', 'camera', 'КАМЕРА')}
      <div className="field">ОБРАБОТКА ЗВУКА</div>
      {proc('noise', 'Шумоподавление', 'Убирает клавиатуру, вентилятор и шум улицы')}
      {proc('echo', 'Эхоподавление', 'Собеседник не слышит себя из твоих колонок')}
      {proc('agc', 'Автоусиление микрофона', 'Выравнивает громкость: тихий голос станет громче')}
      <div className="field">ЗВОНКИ</div>
      <div className="list-row">
        <span className="grow">
          Поднимать окно при входящем звонке
          <span className="muted small block">Выключено — придёт уведомление, нажмёшь на него и ответишь</span>
        </span>
        <Toggle label="Поднимать окно при звонке" checked={callPopup} onChange={(v) => actions.updateSettings({ callPopup: v })} />
      </div>
      {!ONLINE && <p className="muted small">Голос работает в онлайн-режиме — см. README.</p>}
    </div>
  );
}

/* ================= конфиденциальность ================= */

function Sessions() {
  const [list, setList] = useState<auth.SessionInfo[] | null>(null);
  const [error, setError] = useState('');
  const load = () => auth.listSessions().then(setList, (e) => setError((e as Error).message));
  useEffect(() => void load(), []);
  if (!ONLINE) return <p className="muted small">Устройства видны, когда вход через аккаунт.</p>;
  return (
    <div className="sessions">
      {error && <p className="form-error">{error}</p>}
      {!list && !error && <p className="muted small">Загружаю…</p>}
      {list?.map((s) => (
        <div key={s.id} className="list-row session-row">
          <span className="sess-ico">
            <Icon name={s.mobile ? 'phone' : 'monitor'} size={20} />
          </span>
          <span className="grow">
            <b>{s.device}</b>
            {s.current && <span className="tag green">это устройство</span>}
            <span className="muted small block">
              {[s.app, s.place, s.ip].filter(Boolean).join(' · ')} · вход {new Date(s.created).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          </span>
          {!s.current && (
            <button type="button" className="btn small danger-outline" onClick={() => void auth.endSession(s.id).then(load)}>
              Завершить
            </button>
          )}
        </div>
      ))}
      {list && list.length > 1 && (
        <button
          type="button"
          className="btn danger-outline"
          onClick={async () => {
            if (await askPermission({ icon: 'devices', title: 'Завершить другие сеансы?', text: 'На всех остальных устройствах придётся войти заново.', yes: 'Завершить', no: 'Отмена', danger: true })) void auth.endOtherSessions().then(load);
          }}
        >
          Завершить все другие сеансы
        </button>
      )}
    </div>
  );
}

function CloudPassword() {
  const [st, setSt] = useState<auth.CloudStatus | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | 'email'>('view');
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [hint, setHint] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => auth.cloudStatus().then(setSt, (e) => setError((e as Error).message));
  useEffect(() => void load(), []);
  if (!ONLINE) return null;
  const run = async (fn: () => Promise<string | null>, after?: () => void) => {
    setBusy(true);
    setError('');
    const err = await fn();
    setBusy(false);
    if (err) return setError(err);
    after?.();
    void load();
  };
  return (
    <div className="cloud-pw">
      <div className="list-row">
        <Icon name="key" size={20} />
        <span className="grow">
          <b>Облачный пароль</b>
          <span className="muted small block">{st?.enabled ? `Включён${st.hint ? ` · подсказка: ${st.hint}` : ''}${st.email ? ` · почта для сброса: ${st.email}${st.emailVerified ? '' : ' (не подтверждена)'}` : ''}` : 'Выключен. С ним для входа на новом устройстве мало кода из SMS — нужен ещё и пароль.'}</span>
        </span>
        {mode === 'view' && (
          <button type="button" className="btn small" onClick={() => setMode('edit')}>
            {st?.enabled ? 'Изменить' : 'Включить'}
          </button>
        )}
      </div>
      {st?.enabled && st.email && !st.emailVerified && mode === 'view' && (
        <button type="button" className="btn small" onClick={() => void run(auth.sendRecoveryEmailCode, () => setMode('email'))}>
          Подтвердить почту для сброса
        </button>
      )}
      {mode === 'email' && (
        <form
          className="ed-col"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => auth.confirmRecoveryEmail(code), () => setMode('view'));
          }}
        >
          <span className="muted small">Код отправлен на {st?.email}</span>
          <input className="input" inputMode="numeric" aria-label="Код из письма" placeholder="Код из письма" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="btn primary" disabled={busy || code.trim().length < 4}>
            Подтвердить
          </button>
        </form>
      )}
      {mode === 'edit' && (
        <form
          className="ed-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (pw !== pw2) return setError('Пароли не совпадают');
            void run(
              () => auth.setCloudPassword(cur, pw, hint, email),
              () => {
                setMode(email ? 'email' : 'view');
                setCur('');
                setPw('');
                setPw2('');
                if (email) void auth.sendRecoveryEmailCode();
              },
            );
          }}
        >
          {st?.enabled && <input className="input" type="password" autoComplete="current-password" aria-label="Текущий облачный пароль" placeholder="Текущий облачный пароль" value={cur} onChange={(e) => setCur(e.target.value)} />}
          <input className="input" type="password" autoComplete="new-password" aria-label="Новый пароль" placeholder="Новый пароль (от 6 символов)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input className="input" type="password" autoComplete="new-password" aria-label="Повтори пароль" placeholder="Повтори пароль" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <input className="input" aria-label="Подсказка" placeholder="Подсказка (видна при входе, не пиши сам пароль)" maxLength={60} value={hint} onChange={(e) => setHint(e.target.value)} />
          <input className="input" type="email" aria-label="Почта для сброса" placeholder={st?.email ? `Почта для сброса: ${st.email}` : 'Почта для сброса пароля'} value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="muted small">Эта почта нужна только чтобы сбросить облачный пароль, если забудешь. Облачный пароль спрашивается после кода или пароля для входа.</span>
          <div className="row gap-s">
            <button type="button" className="btn ghost" onClick={() => setMode('view')}>
              Отмена
            </button>
            {st?.enabled && (
              <button type="button" className="btn danger-outline" disabled={busy || !cur} onClick={() => void run(() => auth.removeCloudPassword(cur), () => setMode('view'))}>
                Выключить пароль
              </button>
            )}
            <button type="submit" className="btn primary" disabled={busy || pw.length < 6}>
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </div>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

/** Почта и пароль, с которыми можно войти на любом устройстве. Пароль меняется тут же. */
function LoginPassword() {
  const [info, setInfo] = useState<auth.LoginInfo | null>(null);
  const [mode, setMode] = useState<'view' | 'password' | 'email'>('view');
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => auth.loginInfo().then(setInfo, (e) => setError((e as Error).message));
  useEffect(() => void load(), []);
  if (!ONLINE) return null;
  const reset = (m: typeof mode = 'view') => {
    setMode(m);
    setCur('');
    setPw('');
    setPw2('');
    setEmail('');
    setError('');
  };
  const done = (text: string) => {
    reset();
    void load();
    setUi({ toast: { text, id: Date.now() } });
  };
  const has = !!info?.hasPassword;
  const status = !info ? 'Загружаю…' : `${info.email ? `Почта: ${info.email}` : 'Почта не привязана'} · ${has ? 'пароль задан' : 'пароля нет — входишь по коду'}`;
  return (
    <div className="cloud-pw">
      <div className="list-row">
        <Icon name="mail" size={20} />
        <span className="grow">
          <b>Почта и пароль для входа</b>
          <span className="muted small block">{status}</span>
        </span>
      </div>
      {mode === 'view' && info && (
        <div className="row gap-s wrap">
          <button type="button" className="btn small" onClick={() => reset('password')}>
            <Icon name="key" size={14} /> {has ? 'Сменить пароль' : 'Задать пароль'}
          </button>
          <button type="button" className="btn small ghost" onClick={() => reset('email')}>
            <Icon name="mail" size={14} /> {info.email ? 'Сменить почту' : 'Привязать почту'}
          </button>
        </div>
      )}
      {mode === 'password' && (
        <form
          className="ed-col"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw.length < 8) return setError('Пароль — минимум 8 символов');
            if (pw !== pw2) return setError('Пароли не совпадают');
            setBusy(true);
            setError('');
            const err = await auth.changeLoginPassword(pw, has ? cur : undefined);
            setBusy(false);
            if (err) return setError(/password|пароль/i.test(err) && has ? 'Текущий пароль неверный' : err);
            done(has ? 'Пароль изменён' : 'Пароль задан');
          }}
        >
          {has && <input className="input" type="password" autoComplete="current-password" aria-label="Текущий пароль" placeholder="Текущий пароль" value={cur} onChange={(e) => setCur(e.target.value)} />}
          <input className="input" type="password" autoComplete="new-password" aria-label="Новый пароль" placeholder="Новый пароль (от 8 символов)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input className="input" type="password" autoComplete="new-password" aria-label="Повтори пароль" placeholder="Повтори новый пароль" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {has && <span className="muted small">Забыл текущий пароль? Выйди и войди по коду на почту или по SMS — тогда старый пароль не понадобится для входа.</span>}
          <div className="row gap-s">
            <button type="button" className="btn ghost" onClick={() => reset()}>
              Отмена
            </button>
            <button type="submit" className="btn primary" disabled={busy || pw.length < 8 || (has && !cur)}>
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </div>
        </form>
      )}
      {mode === 'email' && (
        <form
          className="ed-col"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!auth.isEmail(email)) return setError('Проверь адрес почты — кажется, в нём ошибка');
            if (!has && pw !== pw2) return setError('Пароли не совпадают');
            setBusy(true);
            setError('');
            // без пароля Appwrite почту не меняет — сначала задаём пароль
            let err = has ? null : await auth.changeLoginPassword(pw);
            if (!err) err = await auth.changeLoginEmail(email, has ? cur : pw);
            setBusy(false);
            if (err) return setError(/409|already|exists|уже/i.test(err) ? 'Эта почта уже привязана к другому аккаунту' : err);
            done('Почта для входа сохранена');
          }}
        >
          <input className="input" type="email" autoComplete="email" aria-label="Почта" placeholder="Новая почта" value={email} onChange={(e) => setEmail(e.target.value)} />
          {has ? (
            <input className="input" type="password" autoComplete="current-password" aria-label="Пароль для входа" placeholder="Пароль для входа" value={cur} onChange={(e) => setCur(e.target.value)} />
          ) : (
            <>
              <span className="muted small">Заодно придумай пароль — с ним можно входить по почте без кода.</span>
              <input className="input" type="password" autoComplete="new-password" aria-label="Пароль" placeholder="Пароль (от 8 символов)" value={pw} onChange={(e) => setPw(e.target.value)} />
              <input className="input" type="password" autoComplete="new-password" aria-label="Повтори пароль" placeholder="Повтори пароль" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </>
          )}
          <div className="row gap-s">
            <button type="button" className="btn ghost" onClick={() => reset()}>
              Отмена
            </button>
            <button type="submit" className="btn primary" disabled={busy || !email || (has ? !cur : pw.length < 8)}>
              {busy ? 'Сохраняю…' : 'Сохранить'}
            </button>
          </div>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function PhoneRow() {
  const [phone, setPhone] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<'view' | 'bind' | 'code'>('view');
  const [num, setNum] = useState('');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const load = () => auth.myPhone().then(setPhone);
  useEffect(() => void load(), []);
  if (!ONLINE) return null;
  const masked = phone ? phone.replace(/^(\+\d{1,3})\d+(\d{2})$/, '$1 ••• ••• ••$2') : '';
  return (
    <div>
      <div className="list-row">
        <Icon name="phone" size={20} />
        <span className="grow">
          <b>Номер телефона</b>
          <span className="muted small block">{phone ? `${show ? phone : masked} · скрыт от всех, его видишь только ты` : 'Не привязан — привяжи, чтобы входить по номеру'}</span>
        </span>
        {phone ? (
          <button type="button" className="plain muted" aria-label={show ? 'Скрыть номер' : 'Показать номер'} onClick={() => setShow((v) => !v)}>
            <Icon name="eye" size={18} />
          </button>
        ) : (
          mode === 'view' && (
            <button type="button" className="btn small" onClick={() => setMode('bind')}>
              Привязать
            </button>
          )
        )}
      </div>
      {mode === 'bind' && (
        <form
          className="ed-col"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            const err = await auth.bindPhone(num, pass);
            if (err) setError(err);
            else setMode('code');
          }}
        >
          <input className="input" type="tel" aria-label="Номер телефона" placeholder="+375 29 123 45 67" value={num} onChange={(e) => setNum(e.target.value)} />
          <input className="input" type="password" aria-label="Пароль от аккаунта" placeholder="Пароль для входа (задаётся ниже, в «Почта и пароль»)" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button type="submit" className="btn primary">
            Получить код
          </button>
        </form>
      )}
      {mode === 'code' && (
        <form
          className="ed-col"
          onSubmit={async (e) => {
            e.preventDefault();
            const err = await auth.confirmPhone(code);
            if (err) setError(err);
            else {
              setMode('view');
              void load();
            }
          }}
        >
          <input className="input" inputMode="numeric" aria-label="Код из SMS" placeholder="Код из SMS" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="btn primary">
            Подтвердить
          </button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

export function SecuritySettings() {
  const share = useStore((s) => !!s.settings.shareActivity);
  const num = useStore((s) => s.profile.num);
  return (
    <div className="ed-col narrow">
      {num && (
        <div className="list-row">
          <Icon name="hash" size={20} />
          <span className="grow">
            <b>Мой ID: {num}</b>
            <span className="muted small block">По нему тебя можно найти и добавить в друзья, даже если сменишь имя</span>
          </span>
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(num);
              setUi({ toast: { text: 'ID скопирован', id: Date.now() } });
            }}
          >
            <Icon name="copy" size={14} /> Копировать
          </button>
        </div>
      )}
      <PhoneRow />
      <LoginPassword />
      <CloudPassword />
      <div className="field">УСТРОЙСТВА, С КОТОРЫХ ВЫПОЛНЕН ВХОД</div>
      <Sessions />
      <div className="field">ЧТО ВИДЯТ ДРУГИЕ</div>
      <div className="list-row">
        <Icon name="gamepad" size={20} />
        <span className="grow">
          <b>Показывать, в каком приложении я сижу</b>
          <span className="muted small block">{IS_DESKTOP_APP ? 'Друзья увидят «Играет в Minecraft» или «Сидит в Photoshop». Название окна и что в нём — не передаются.' : 'Работает только в приложении для Windows.'}</span>
        </span>
        <Toggle
          label="Показывать приложение"
          checked={share}
          onChange={async (v) => {
            if (v && !(await askPermission({ icon: 'gamepad', title: 'Показывать друзьям, во что ты играешь?', text: 'Neon будет раз в полминуты смотреть, какая программа у тебя открыта, и показывать друзьям только её название. Выключить можно в любой момент.', yes: 'Разрешить', no: 'Не надо' }))) return;
            actions.updateSettings({ shareActivity: v });
          }}
        />
      </div>
    </div>
  );
}
