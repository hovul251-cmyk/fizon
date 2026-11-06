import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import * as auth from '../online/auth';
import * as sync from '../online/sync';
import { actions, setUi, useStore } from '../store';
import { Mascot } from './Mascot';
import { Avatar, colors, nameStyleOf, personFromProfile } from './common';

function Hero() {
  return (
    <section className="login-hero">
      <div className="login-brand">
        <Mascot size={44} mood="still" badge />
        <span>Neon</span>
      </div>
      <div>
        <h1>
          Твой профиль.
          <br />
          Твои правила.
        </h1>
        <p>Сообщества, комнаты, голос и личные сообщения — и профиль, который каждый настраивает как хочет.</p>
      </div>
      <ul className="hero-points">
        <li>
          <Icon name="phone" size={18} /> Вход по номеру телефона, номер скрыт от всех
        </li>
        <li>
          <Icon name="key" size={18} /> Облачный пароль и список устройств — как в Telegram
        </li>
        <li>
          <Icon name="star" size={18} /> Всё оформление профиля — бесплатно
        </li>
      </ul>
    </section>
  );
}

/** Поле для кода из письма: только цифры, крупно, с автозаполнением из почты. */
function CodeInput({ value, onChange, label = 'Код' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <input
      ref={ref}
      className="input code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label={label}
      placeholder="000000"
      maxLength={10}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    />
  );
}

type Step = 'phone' | 'code' | 'password' | 'reset' | 'email';

/** Вход как в Telegram: номер → код из SMS → (облачный пароль, если включён). Почта — только для старых аккаунтов. */
export function Login() {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('+');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resetTo, setResetTo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  if (!ONLINE) return <OfflineLogin />;

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(sync.errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const after = async (next: 'done' | 'password' | undefined) => {
    if (next === 'password') {
      setPassword('');
      setStep('password');
      return;
    }
    await sync.start();
  };
  const sendCode = () =>
    run(async () => {
      const err = await auth.sendPhoneCode(phone);
      if (err) return setError(err);
      setCode('');
      setStep('code');
      setCooldown(60);
    });

  return (
    <div className="login">
      <Hero />
      <section className="login-form-wrap">
        {step === 'phone' && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void sendCode();
            }}
          >
            <div>
              <h2>Вход в Neon</h2>
              <p className="muted">Введи номер телефона — пришлём код по SMS. Аккаунта нет — создадим.</p>
            </div>
            <label className="field">
              НОМЕР ТЕЛЕФОНА
              <input className="input phone-input" type="tel" required autoFocus value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, ''))} placeholder="+375 29 123 45 67" autoComplete="tel" />
            </label>
            <span className="muted small">Номер никто не увидит — он скрыт от всех.</span>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary big" disabled={busy || phone.replace(/\D/g, '').length < 8}>
              {busy ? 'Отправляю…' : 'Получить код'}
            </button>
            <div className="login-links">
              <button type="button" className="link" onClick={() => { setStep('email'); setError(''); }}>
                У меня старый аккаунт по почте
              </button>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await auth.verifyPhoneCode(code);
                if (r.error) return setError(r.error);
                await after(r.next);
              });
            }}
          >
            <div className="mail-icon">
              <Icon name="phone" size={28} />
            </div>
            <div>
              <h2>Код из SMS</h2>
              <p className="muted">
                Отправили код на <b className="text">{auth.normPhone(phone)}</b>. SMS может прийти через минуту.
              </p>
            </div>
            <CodeInput value={code} onChange={setCode} label="Код из SMS" />
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary big" disabled={busy || code.length < 6}>
              {busy ? 'Проверяю…' : 'Войти'}
            </button>
            <div className="login-links">
              <button type="button" className="link" onClick={() => { setStep('phone'); setError(''); }}>
                Другой номер
              </button>
              <button type="button" className="link" disabled={cooldown > 0 || busy} onClick={() => void sendCode()}>
                {cooldown > 0 ? `Отправить ещё раз через ${cooldown} с` : 'Отправить код ещё раз'}
              </button>
            </div>
          </form>
        )}

        {step === 'password' && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const err = await auth.checkCloudPassword(password);
                if (err) return setError(err);
                await sync.start();
              });
            }}
          >
            <div className="mail-icon">
              <Icon name="key" size={28} />
            </div>
            <div>
              <h2>Облачный пароль</h2>
              <p className="muted">На аккаунте включён облачный пароль. Введи его, чтобы войти на этом устройстве.</p>
            </div>
            <input className="input" type="password" autoFocus required aria-label="Облачный пароль" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={auth.passwordHint() ? `Подсказка: ${auth.passwordHint()}` : 'Пароль'} autoComplete="current-password" />
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary big" disabled={busy || !password}>
              {busy ? 'Проверяю…' : 'Войти'}
            </button>
            {auth.canResetPassword() && (
              <div className="login-links">
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    void run(async () => {
                      const r = await auth.startCloudReset();
                      if (r.error) return setError(r.error);
                      setResetTo(r.email ?? '');
                      setCode('');
                      setStep('reset');
                    })
                  }
                >
                  Забыл пароль — сбросить через почту
                </button>
              </div>
            )}
          </form>
        )}

        {step === 'reset' && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const err = await auth.finishCloudReset(code);
                if (err) return setError(err);
                await sync.start();
              });
            }}
          >
            <div className="mail-icon">
              <Icon name="mail" size={28} />
            </div>
            <div>
              <h2>Сброс облачного пароля</h2>
              <p className="muted">
                Отправили код на <b className="text">{resetTo}</b>. После входа облачный пароль выключится — потом можно задать новый.
              </p>
            </div>
            <CodeInput value={code} onChange={setCode} label="Код из письма" />
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary big" disabled={busy || code.length < 6}>
              {busy ? 'Проверяю…' : 'Сбросить и войти'}
            </button>
          </form>
        )}

        {step === 'email' && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await auth.emailLogin(email, password);
                if (r.error) return setError(r.error);
                await after(r.next);
              });
            }}
          >
            <div>
              <h2>Старый аккаунт</h2>
              <p className="muted">Войди почтой и паролем, а потом привяжи номер в Настройки → Конфиденциальность — дальше будешь входить по номеру.</p>
            </div>
            <label className="field">
              ПОЧТА
              <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mail.com" autoComplete="email" />
            </label>
            <label className="field">
              ПАРОЛЬ
              <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary big" disabled={busy}>
              {busy ? 'Секунду…' : 'Войти'}
            </button>
            <div className="login-links">
              <button type="button" className="link" onClick={() => { setStep('phone'); setError(''); }}>
                Войти по номеру
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function OfflineLogin() {
  const profile = useStore((s) => s.profile);
  const [name, setName] = useState('');
  return (
    <div className="login">
      <Hero />
      <section className="login-form-wrap">
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            void actions.saveProfile({ ...profile, displayName: name.trim(), username: name.trim().toLowerCase().replace(/[^a-z0-9._]/g, '') || 'user', onboarded: true });
            actions.login(name.trim());
          }}
        >
          <div>
            <h2>Офлайн-режим</h2>
            <p className="muted">Онлайн не настроен: нет данных Appwrite в файле .env. Можно попробовать Neon на этом компьютере — без других людей, почты и голоса.</p>
          </div>
          <label className="field">
            КАК ТЕБЯ НАЗЫВАТЬ
            <input className="input" required autoFocus value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="Твоё имя" />
          </label>
          <button type="submit" className="btn primary big">
            Продолжить без аккаунта
          </button>
          <p className="note">Чтобы включить вход по почте, выполни шаги из README → «Настройка онлайн-режима».</p>
        </form>
      </section>
    </div>
  );
}

/** Первый вход: выбрать имя, ник и цвет. */
export function Onboarding() {
  const profile = useStore((s) => s.profile);
  const [name, setName] = useState(profile.displayName);
  const [username, setUsername] = useState(profile.username);
  const [color, setColor] = useState(profile.avatarColor);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = { ...profile, displayName: name || 'Твоё имя', avatarColor: color };

  return (
    <div className="login">
      <section className="login-form-wrap wide">
        <form
          className="login-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await actions.saveProfile({ ...profile, displayName: name.trim(), username, avatarColor: color, onboarded: true });
              setUi({ onboarding: false });
            } catch (err) {
              setError(sync.errorText(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <h2>Добро пожаловать!</h2>
            <p className="muted">Как тебя будут видеть другие. Всё это можно поменять позже в редакторе профиля.</p>
          </div>
          <div className="onb-preview">
            <Avatar person={personFromProfile(preview)} size={72} border="var(--bg0)" />
            <div>
              <div className="h2" style={nameStyleOf(preview)}>
                {preview.displayName}
              </div>
              <div className="muted">@{username || 'username'}</div>
            </div>
          </div>
          <label className="field">
            ИМЯ
            <input className="input" required autoFocus maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Как тебя видят другие" />
          </label>
          <label className="field">
            ЛОГИН — ПО НЕМУ ТЕБЯ ДОБАВЯТ В ДРУЗЬЯ
            <input
              className="input"
              required
              minLength={2}
              maxLength={32}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
              placeholder="латиница, цифры, точка, _"
            />
          </label>
          <div className="field">
            ЦВЕТ АВАТАРА
            <div className="swatches">
              {colors.slice(0, 7).map((c) => (
                <button type="button" key={c} aria-label={c} className={`sw round ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn primary big" disabled={busy || username.length < 2 || !name.trim()}>
            {busy ? 'Сохраняю…' : 'Готово'}
          </button>
        </form>
      </section>
    </div>
  );
}
