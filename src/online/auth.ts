// Вход по номеру телефона (код по SMS) или по почте (код в письме / пароль), облачный пароль, устройства и сеансы.
// Сессию приложение получает только из одноразового токена сервера — так облачный пароль нельзя обойти.

import { ID } from 'appwrite';
import { aw } from '../lib/appwrite';
import { call, errorText } from './sync';

const api = () => aw!;

/** Ответ сервера после первого шага: либо сразу вход, либо нужен облачный пароль */
type Step = { userId: string; secret?: string; needPassword?: boolean; hint?: string; ticket?: string; canReset?: boolean };

let phoneUserId = '';
let pending: { userId: string; ticket: string; hint: string; canReset: boolean } | null = null;
export const passwordHint = () => pending?.hint ?? '';
export const canResetPassword = () => !!pending?.canReset;

const dropSession = () => api().account.deleteSession({ sessionId: 'current' }).catch(() => undefined);

/** +7 (999) 123-45-67 → +79991234567 */
export const normPhone = (s: string) => {
  const d = s.replace(/[^\d+]/g, '');
  return d.startsWith('+') ? '+' + d.slice(1).replace(/\+/g, '') : '+' + d;
};

async function finish(r: Step): Promise<'done' | 'password'> {
  if (r.needPassword && r.ticket) {
    pending = { userId: r.userId, ticket: r.ticket, hint: r.hint ?? '', canReset: !!r.canReset };
    return 'password';
  }
  if (!r.secret) throw new Error('Сервер не выдал вход');
  await dropSession();
  await api().account.createSession({ userId: r.userId, secret: r.secret });
  pending = null;
  return 'done';
}

/** Отправить код по SMS. Аккаунта нет — Appwrite создаст его сам. */
export async function sendPhoneCode(phone: string): Promise<string | null> {
  const p = normPhone(phone);
  if (p.length < 9) return 'Введи номер полностью, с кодом страны';
  try {
    await dropSession();
    phoneUserId = (await api().account.createPhoneToken({ userId: ID.unique(), phone: p })).userId;
    return null;
  } catch (e) {
    return errorText(e);
  }
}

/** Проверить код из SMS. 'password' — у аккаунта облачный пароль, его нужно ввести. */
export async function verifyPhoneCode(code: string): Promise<{ error: string | null; next?: 'done' | 'password' }> {
  try {
    const r = await call<Step>('phone-login', { userId: phoneUserId, secret: code.replace(/\s/g, '') });
    return { error: null, next: await finish(r) };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/* ---------- вход по почте ---------- */

let emailUserId = '';

export const normEmail = (s: string) => s.trim().toLowerCase();
export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normEmail(s));

/** Отправить код на почту. Аккаунта с такой почтой нет — Appwrite создаст его сам. */
export async function sendEmailCode(email: string): Promise<string | null> {
  if (!isEmail(email)) return 'Проверь адрес почты — кажется, в нём ошибка';
  try {
    await dropSession();
    emailUserId = (await api().account.createEmailToken({ userId: ID.unique(), email: normEmail(email) })).userId;
    return null;
  } catch (e) {
    return errorText(e);
  }
}

/** Проверить код из письма. Сервер проверяет его так же, как код из SMS (действие phone-login принимает любой одноразовый код). */
export async function verifyEmailCode(code: string): Promise<{ error: string | null; next?: 'done' | 'password' }> {
  try {
    const r = await call<Step>('phone-login', { userId: emailUserId, secret: code.replace(/\s/g, '') });
    return { error: null, next: await finish(r) };
  } catch (e) {
    return { error: errorText(e) };
  }
}

/** Вход по почте и паролю (через сервер — из-за облачного пароля) */
export async function emailLogin(email: string, password: string): Promise<{ error: string | null; next?: 'done' | 'password' }> {
  try {
    const r = await call<Step>('email-login', { email: email.trim().toLowerCase(), password });
    return { error: null, next: await finish(r) };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function checkCloudPassword(password: string): Promise<string | null> {
  if (!pending) return 'Время вышло — войди заново';
  try {
    await finish(await call<Step>('cloud-check', { userId: pending.userId, ticket: pending.ticket, password }));
    return null;
  } catch (e) {
    return errorText(e);
  }
}

/** Забыл облачный пароль: код придёт на почту для сброса */
export async function startCloudReset(): Promise<{ error: string | null; email?: string }> {
  if (!pending) return { error: 'Время вышло — войди заново' };
  try {
    const r = await call<{ email: string }>('cloud-reset-start', { userId: pending.userId, ticket: pending.ticket });
    return { error: null, email: r.email };
  } catch (e) {
    return { error: errorText(e) };
  }
}

export async function finishCloudReset(code: string): Promise<string | null> {
  if (!pending) return 'Время вышло — войди заново';
  try {
    await finish(await call<Step>('cloud-reset', { userId: pending.userId, ticket: pending.ticket, code: code.replace(/\s/g, '') }));
    return null;
  } catch (e) {
    return errorText(e);
  }
}

/* ---------- настройки: облачный пароль ---------- */

export interface CloudStatus {
  enabled: boolean;
  hint: string;
  email: string;
  emailVerified: boolean;
}
export const cloudStatus = () => call<CloudStatus>('cloud-status');

const wrap = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return errorText(e);
  }
};
export const setCloudPassword = (current: string, password: string, hint: string, email: string) => wrap(() => call('cloud-set', { current, password, hint, email }));
export const removeCloudPassword = (current: string) => wrap(() => call('cloud-remove', { current }));
/** Подтвердить почту для сброса: код на почту и ввод кода */
export const sendRecoveryEmailCode = () => wrap(() => api().account.createEmailVerificationOTP());
export async function confirmRecoveryEmail(code: string) {
  const me = await api().account.get();
  return wrap(() => api().account.updateEmailVerificationOTP({ userId: me.$id, secret: code.replace(/\s/g, '') }));
}

/* ---------- почта и пароль для входа ---------- */

export interface LoginInfo {
  email: string;
  hasPassword: boolean;
}

export async function loginInfo(): Promise<LoginInfo> {
  const me = await api().account.get();
  return { email: me.email ?? '', hasPassword: !!me.passwordUpdate };
}

/** Задать или сменить пароль для входа. Текущий нужен, только если пароль уже был. */
export const changeLoginPassword = (password: string, current?: string) =>
  wrap(() => api().account.updatePassword(current ? { password, oldPassword: current } : { password }));

/** Привязать почту для входа (или сменить её) — Appwrite требует пароль от аккаунта */
export const changeLoginEmail = (email: string, password: string) => wrap(() => api().account.updateEmail({ email: normEmail(email), password }));

/* ---------- телефон ---------- */

export const myPhone = async () => (await api().account.get().catch(() => null))?.phone || null;
/** Привязать номер к старому аккаунту (нужен пароль от него) и отправить код подтверждения */
export async function bindPhone(phone: string, password: string): Promise<string | null> {
  return wrap(async () => {
    await api().account.updatePhone({ phone: normPhone(phone), password });
    await api().account.createPhoneVerification();
  });
}
export async function confirmPhone(code: string) {
  const me = await api().account.get();
  return wrap(() => api().account.updatePhoneVerification({ userId: me.$id, secret: code.replace(/\s/g, '') }));
}

/* ---------- устройства и сеансы ---------- */

export interface SessionInfo {
  id: string;
  current: boolean;
  device: string;
  app: string;
  place: string;
  ip: string;
  created: string;
  mobile: boolean;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const r = await api().account.listSessions();
  return r.sessions
    .map((s) => ({
      id: s.$id,
      current: s.current,
      device: [s.deviceBrand, s.deviceModel].filter(Boolean).join(' ') || [s.osName, s.osVersion].filter(Boolean).join(' ') || 'Неизвестное устройство',
      app: [s.clientName, s.osName && s.deviceBrand ? s.osName : ''].filter(Boolean).join(' · '),
      place: [s.countryName].filter((x) => x && x !== 'Unknown').join(''),
      ip: s.ip,
      created: s.$createdAt,
      mobile: s.deviceName === 'smartphone' || s.deviceName === 'tablet' || /android|ios/i.test(s.osName),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.created.localeCompare(a.created));
}
export const endSession = (id: string) => api().account.deleteSession({ sessionId: id });
export async function endOtherSessions() {
  for (const s of await listSessions()) if (!s.current) await endSession(s.id).catch(() => undefined);
}
