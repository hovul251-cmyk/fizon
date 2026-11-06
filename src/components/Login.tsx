import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import * as remote from '../online/remote';
import * as sync from '../online/sync';
import { actions, setUi, useStore } from '../store';
import { Avatar, colors, nameStyleOf, personFromProfile } from './common';

type Mode = 'code' | 'password';
type Step = 'form' | 'code' | 'new-password';

function Hero() {
  return (
    <section className="login-hero">
      <div className="login-brand">
        <div className="logo">F</div>
        <span>Fizion</span>
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
          <Icon name="mail" size={18} /> Вход по коду из письма — без паролей
        </li>
        <li>
          <Icon name="lock" size={18} /> Доступ к сообщениям проверяет сервер
        </li>
        <li>
          <Icon name="star" size={18} /> Всё оформление профиля — бесплатно
        </li>
      </ul>
    </section>
  );
}

/** Поле для кода из письма: только цифры, крупно, с автозаполнением из почты. */
function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <input
      ref={ref}
      className="input code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label="Код из письма"
      placeholder="000000"
      maxLength={10}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    />
  );
}

export function Login() {
  const [mode, setMode] = useState<Mode>('code');
  const [register, setRegister] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [codeType, setCodeType] = useState<remote.CodeType>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
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

  const toCode = (type: remote.CodeType) => {
    setCodeType(type);
    setCode('');
    setStep('code');
    setCooldown(60);
  };

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (mode === 'code') {
        const err = await remote.sendLoginCode(email);
        return err ? setError(err) : toCode('email');
      }
      if (register) {
        const r = await remote.signUp(email, password, name.trim() || email.split('@')[0]);
        if (r.error) return setError(r.error);
        if (r.confirm) return toCode('signup');
        await sync.start();
        return;
      }
      const r = await remote.signIn(email, password);
      if (r.error) return setError(r.error);
      if (r.needsConfirm) return toCode('signup');
      await sync.start();
    });
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const err = await remote.verifyCode(code, codeType);
      if (err) return setError(err);
      if (codeType === 'recovery') {
        setPassword('');
        return setStep('new-password');
      }
      await sync.start();
    });
  };

  const forgot = () =>
    void run(async () => {
      if (!email.trim()) return setError('Сначала введи свою почту');
      const err = await remote.sendResetCode(email);
      return err ? setError(err) : toCode('recovery');
    });

  const resend = () =>
    void run(async () => {
      const err = await remote.resendCode(email, codeType);
      if (err) return setError(err);
      setCooldown(60);
    });

  const titles: Record<remote.CodeType, string> = {
    email: 'Код для входа',
    signup: 'Подтверди почту',
    recovery: 'Сброс пароля',
  };

  return (
    <div className="login">
      <Hero />
      <section className="login-form-wrap">
        {step === 'form' && (
          <form className="login-form" onSubmit={submitForm}>
            <div>
              <h2>{mode === 'password' && register ? 'Создай аккаунт' : 'Вход в Fizion'}</h2>
              <p className="muted">
                {mode === 'code' ? 'Пришлём на почту код. Аккаунта нет — создадим автоматически.' : register ? 'После регистрации придёт код подтверждения' : 'Войди почтой и паролем'}
              </p>
            </div>
            <div className="seg">
              <button type="button" className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>
                Код на почту
              </button>
              <button type="button" className={mode === 'password' ? 'on' : ''} onClick={() => setMode('password')}>
                Пароль
              </button>
            </div>
            {mode === 'password' && register && (
              <label className="field">
                ИМЯ В FIZION
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Как тебя будут видеть" />
              </label>
            )}
            <label className="field">
              ПОЧТА
              <input className="input" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mail.com" autoComplete="email" />
            </label>
            {mode === 'password' && (
              <label className="field">
                ПАРОЛЬ
                <input
                  className="input"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={register ? 'Не меньше 8 символов' : '••••••••'}
                  autoComplete={register ? 'new-password' : 'current-password'}
                />
              </label>
            )}
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary big" disabled={busy}>
              {busy ? 'Секунду…' : mode === 'code' ? 'Получить код' : register ? 'Зарегистрироваться' : 'Войти'}
            </button>
            {mode === 'password' && (
              <div className="login-links">
                <button type="button" className="link" onClick={() => setRegister((v) => !v)}>
                  {register ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Регистрация'}
                </button>
                {!register && (
                  <button type="button" className="link" onClick={forgot}>
                    Забыл пароль
                  </button>
                )}
              </div>
            )}
          </form>
        )}

        {step === 'code' && (
          <form className="login-form" onSubmit={submitCode}>
            <div className="mail-icon">
              <Icon name="mail" size={28} />
            </div>
            <div>
              <h2>{titles[codeType]}</h2>
              <p className="muted">
                Отправили код на <b className="text">{email.trim()}</b>. Письмо может прийти через минуту — проверь «Спам».
              </p>
            </div>
            <CodeInput value={code} onChange={setCode} />
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary big" disabled={busy || code.length < 6}>
              {busy ? 'Проверяю…' : 'Подтвердить'}
            </button>
            <div className="login-links">
              <button type="button" className="link" onClick={() => { setStep('form'); setError(''); }}>
                Другая почта
              </button>
              <button type="button" className="link" disabled={cooldown > 0 || busy} onClick={resend}>
                {cooldown > 0 ? `Отправить ещё раз через ${cooldown} с` : 'Отправить код ещё раз'}
              </button>
            </div>
          </form>
        )}

        {step === 'new-password' && (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const r = await remote.setNewPassword(email, password);
                if (r.badCode) {
                  setStep('code');
                  setCode('');
                }
                if (r.error) return setError(r.error);
                await sync.start();
              });
            }}
          >
            <div>
              <h2>Новый пароль</h2>
              <p className="muted">Придумай новый пароль — сохраним его вместе с кодом из письма и сразу войдём.</p>
            </div>
            <label className="field">
              НОВЫЙ ПАРОЛЬ
              <input className="input" type="password" required minLength={8} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Не меньше 8 символов" autoComplete="new-password" />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn primary big" disabled={busy}>
              {busy ? 'Сохраняю…' : 'Сохранить и войти'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

/** Без настроек Appwrite: локальный профиль на этом компьютере. */
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
            <p className="muted">Онлайн не настроен: нет данных Appwrite в файле .env. Можно попробовать Fizion на этом компьютере — без других людей, почты и голоса.</p>
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
            <input className="input" required autoFocus maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            ИМЯ ПОЛЬЗОВАТЕЛЯ — ПО НЕМУ ТЕБЯ ДОБАВЯТ В ДРУЗЬЯ
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
