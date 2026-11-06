import { useEffect, useState } from 'react';
import { Query, type Models } from 'appwrite';
import { ME } from '../data';
import { aw, DB, ONLINE } from '../lib/appwrite';
import { call, errorText, L, R } from '../online/sync';
import { setUi, useStore } from '../store';
import { Modal, usePerson } from './common';
import { Mascot } from './Mascot';

// Искры ✨ и подарки — как звёзды и подарки в Telegram, но свои:
// подарок можно обменять на искры, улучшить до уникального (номер, фон, узор) и передать дальше.

export const GIFTS: Record<string, { emoji: string; name: string; price: number; limited?: number }> = {
  bear: { emoji: '🧸', name: 'Мишка', price: 15 },
  heart: { emoji: '💝', name: 'Сердце', price: 15 },
  rose: { emoji: '🌹', name: 'Роза', price: 25 },
  box: { emoji: '🎁', name: 'Подарок', price: 25 },
  cake: { emoji: '🎂', name: 'Торт', price: 50 },
  flowers: { emoji: '💐', name: 'Букет', price: 50 },
  rocket: { emoji: '🚀', name: 'Ракета', price: 50 },
  cup: { emoji: '🏆', name: 'Кубок', price: 100 },
  ring: { emoji: '💍', name: 'Кольцо', price: 100 },
  diamond: { emoji: '💎', name: 'Алмаз', price: 100 },
  crown: { emoji: '👑', name: 'Корона', price: 250 },
  firefly: { emoji: '🪲', name: 'Светлячок', price: 500, limited: 1000 },
};
const UPGRADE = 25;

type GiftRow = Models.Row & { fromId: string; toId: string; giftId: string; text: string; price: number; serial: number; look: string; converted: boolean; hidden: boolean };
export interface Gift {
  id: string;
  from: string | null;
  to: string;
  giftId: string;
  text: string;
  price: number;
  serial: number;
  bg: string;
  pattern: string;
  hidden: boolean;
  ts: string;
}
const fromRow = (r: GiftRow): Gift => {
  const [bg, pattern] = (r.look || '').split('|');
  return { id: r.$id, from: r.fromId ? L(r.fromId) : null, to: L(r.toId), giftId: r.giftId, text: r.text, price: r.price, serial: r.serial, bg: bg || '', pattern: pattern || '', hidden: r.hidden, ts: r.$createdAt };
};

export async function loadGifts(userId: string): Promise<Gift[]> {
  if (!ONLINE || !aw) return [];
  const r = await aw.db.listRows<GiftRow>({ databaseId: DB, tableId: 'gifts', queries: [Query.equal('toId', R(userId)), Query.equal('converted', false), Query.orderDesc('$createdAt'), Query.limit(100)] }).catch(() => null);
  return (r?.rows ?? []).map(fromRow).filter((g) => userId === ME || !g.hidden);
}

let balanceCache: number | null = null;
export function useBalance() {
  const [b, setB] = useState<number | null>(balanceCache);
  const load = () =>
    call<{ balance: number }>('wallet').then(
      (r) => {
        balanceCache = r.balance;
        setB(r.balance);
      },
      () => undefined,
    );
  useEffect(() => void (ONLINE && load()), []);
  return [b, load] as const;
}

export function GiftTile({ g, size = 64 }: { g: Pick<Gift, 'giftId' | 'serial' | 'bg' | 'pattern'>; size?: number }) {
  const info = GIFTS[g.giftId] ?? { emoji: '🎁', name: 'Подарок' };
  return (
    <span className={`gift-tile ${g.serial ? 'unique' : ''}`} style={g.serial ? { background: `radial-gradient(circle at 50% 40%, ${g.bg}cc, ${g.bg})` } : undefined} data-pattern={g.serial ? g.pattern : undefined}>
      <span className="gift-emoji" style={{ fontSize: size * 0.6 }}>
        {info.emoji}
      </span>
      {g.serial > 0 && <span className="gift-serial">#{g.serial}</span>}
    </span>
  );
}

/** Подарить подарок человеку */
export function GiftModal({ to, onClose }: { to: string; onClose: () => void }) {
  const person = usePerson(to);
  const [balance, reload] = useBalance();
  const [pick, setPick] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [anon, setAnon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const g = pick ? GIFTS[pick] : null;
  return (
    <Modal onClose={onClose} width={520} label="Подарок" className="composer-modal">
      <div className="modal-head">
        <h2>Подарок для {person?.name ?? 'друга'}</h2>
        <p className="muted small">
          У тебя <b className="coins">✨ {balance ?? '…'}</b> искр. Подарок появится в профиле — его можно обменять на искры или улучшить до уникального.
        </p>
      </div>
      <div className="gift-grid">
        {Object.entries(GIFTS).map(([id, x]) => (
          <button type="button" key={id} className={`gift-cell ${pick === id ? 'on' : ''}`} onClick={() => setPick(id)}>
            <span className="gift-emoji">{x.emoji}</span>
            <span className="small">{x.name}</span>
            <b className="coins small">✨ {x.price}</b>
            {x.limited && <span className="tag">лимит {x.limited}</span>}
          </button>
        ))}
      </div>
      {g && (
        <>
          <input className="input" aria-label="Подпись к подарку" placeholder="Подпись (необязательно)" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
          <label className="check-row">
            <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Анонимно — не показывать, от кого
          </label>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!g || busy || (balance !== null && g.price > balance)}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await call('gift-send', { to: R(to), giftId: pick, text, anon });
              void reload();
              setUi({ toast: { text: `${g!.emoji} Подарок отправлен!`, id: Date.now() } });
              onClose();
            } catch (e) {
              setError(errorText(e));
            }
            setBusy(false);
          }}
        >
          {g ? (balance !== null && g.price > balance ? 'Не хватает искр' : `Подарить за ✨ ${g.price}`) : 'Выбери подарок'}
        </button>
      </div>
    </Modal>
  );
}

/** Подарки на профиле человека */
export function ProfileGifts({ userId }: { userId: string }) {
  const [list, setList] = useState<Gift[] | null>(null);
  const [open, setOpen] = useState<Gift | null>(null);
  const load = () => void loadGifts(userId).then(setList);
  useEffect(load, [userId]);
  if (!list?.length) return null;
  return (
    <div className="profile-gifts">
      <div className="pcard-label">ПОДАРКИ · {list.filter((g) => !g.hidden).length}</div>
      <div className="gift-row">
        {list.map((g) => (
          <button type="button" key={g.id} className={`gift-mini ${g.hidden ? 'hidden' : ''}`} onClick={() => setOpen(g)} title={GIFTS[g.giftId]?.name}>
            <GiftTile g={g} size={44} />
          </button>
        ))}
      </div>
      {open && <GiftView g={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), load())} />}
    </div>
  );
}

function GiftView({ g, onClose, onChanged }: { g: Gift; onClose: () => void; onChanged: () => void }) {
  const from = usePerson(g.from ?? ME);
  const mine = g.to === ME;
  const info = GIFTS[g.giftId];
  const friends = useStore((s) => s.friends);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [giveTo, setGiveTo] = useState('');
  const act = async (action: string, extra: Record<string, unknown> = {}, done?: string) => {
    setBusy(true);
    setError('');
    try {
      await call(action, { id: g.id, ...extra });
      if (done) setUi({ toast: { text: done, id: Date.now() } });
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
    setBusy(false);
  };
  return (
    <Modal onClose={onClose} width={400} label="Подарок" className="composer-modal gift-view">
      <div className="gift-big">
        <GiftTile g={g} size={120} />
      </div>
      <h2 className="center">
        {info?.name ?? 'Подарок'}
        {g.serial ? ` #${g.serial}` : ''}
      </h2>
      <p className="muted center small">
        {g.from ? `от ${from?.name ?? '…'}` : 'от тайного отправителя'} · {new Date(g.ts).toLocaleDateString('ru')}
        {g.serial ? ' · уникальный' : ` · ✨ ${g.price}`}
      </p>
      {g.text && <p className="gift-text">«{g.text}»</p>}
      {mine && (
        <div className="ed-col">
          {!g.serial && (
            <>
              <button type="button" className="btn primary" disabled={busy} onClick={() => void act('gift-upgrade', {}, '✨ Подарок стал уникальным!')}>
                Улучшить до уникального — ✨ {UPGRADE}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void act('gift-convert', {}, `Обменял на ✨ ${Math.floor(g.price * 0.8)}`)}>
                Обменять на ✨ {Math.floor(g.price * 0.8)}
              </button>
            </>
          )}
          {g.serial > 0 && (
            <div className="row gap-s">
              <select className="input grow" aria-label="Кому передать" value={giveTo} onChange={(e) => setGiveTo(e.target.value)}>
                <option value="">Передать другу…</option>
                {friends.map((f) => (
                  <FriendOption key={f} id={f} />
                ))}
              </select>
              <button type="button" className="btn" disabled={!giveTo || busy} onClick={() => void act('gift-transfer', { to: R(giveTo) }, 'Подарок передан')}>
                Передать
              </button>
            </div>
          )}
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void act('gift-hide', { hidden: !g.hidden })}>
            {g.hidden ? 'Показывать в профиле' : 'Скрыть из профиля'}
          </button>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}

function FriendOption({ id }: { id: string }) {
  const p = usePerson(id);
  return <option value={id}>{p?.name ?? id}</option>;
}

/** Настройки → Кошелёк и подарки */
export function WalletSettings() {
  const [balance, reload] = useBalance();
  const [msg, setMsg] = useState('');
  if (!ONLINE) return <p className="muted">Искры и подарки работают, когда вход через аккаунт.</p>;
  return (
    <div className="ed-col narrow">
      <div className="wallet-card">
        <Mascot size={72} mood="look" />
        <div className="grow">
          <span className="muted small">Мои искры</span>
          <b className="wallet-balance">✨ {balance ?? '…'}</b>
        </div>
        <button
          type="button"
          className="btn primary"
          onClick={async () => {
            setMsg('');
            try {
              await call('topup');
            } catch (e) {
              setMsg(errorText(e));
            }
            void reload();
          }}
        >
          Пополнить
        </button>
      </div>
      {msg && <p className="muted small notice">{msg}</p>}
      <p className="muted small">
        Искрами дарят подарки друзьям. Подарок виден в профиле получателя: его можно обменять на 80% искр, улучшить до уникального с номером и своим фоном или передать другому
        другу. Новичкам — 100 искр в подарок от Neon.
      </p>
      <div className="field">МОИ ПОДАРКИ</div>
      <ProfileGifts userId={ME} />
      <div className="field">КАТАЛОГ</div>
      <div className="gift-grid">
        {Object.entries(GIFTS).map(([id, x]) => (
          <span key={id} className="gift-cell">
            <span className="gift-emoji">{x.emoji}</span>
            <span className="small">{x.name}</span>
            <b className="coins small">✨ {x.price}</b>
          </span>
        ))}
      </div>
      <p className="muted small">Подарить: открой профиль друга → «Подарок».</p>
    </div>
  );
}
