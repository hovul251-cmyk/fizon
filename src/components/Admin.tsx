import { useEffect, useState } from 'react';
import { Icon } from '../icons';
import { call, errorText } from '../online/sync';
import { setUi, useStore } from '../store';
import { askPermission } from './Prompts';

// Панель владельца Neon: найти человека, выдать/забрать админку, забанить, заморозить,
// начислить искры и посмотреть журнал. Все права проверяет сервер по меткам аккаунта.

interface AdminUser {
  userId: string;
  username: string;
  displayName: string;
  num: string;
  labels: string[];
  created: string;
  balance: number;
  phone: string;
}
interface LogRow {
  id: string;
  ts: string;
  kind: string;
  text: string;
  actor: string;
  target: string;
}

const KINDS: [string, string][] = [
  ['', 'Всё'],
  ['signup', 'Регистрации'],
  ['login', 'Входы'],
  ['security', 'Безопасность'],
  ['ban', 'Баны'],
  ['freeze', 'Заморозки'],
  ['admin', 'Админы'],
  ['gift', 'Подарки'],
  ['coins', 'Искры'],
  ['channel', 'Каналы'],
];

function Users() {
  const owner = useStore((s) => s.ui.staff === 'owner');
  const [q, setQ] = useState('');
  const [list, setList] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const load = (query = q) =>
    call<{ users: AdminUser[] }>('admin-users', { query }).then(
      (r) => setList(r.users),
      (e) => setError(errorText(e)),
    );
  useEffect(() => void load(''), []);
  const act = async (action: string, payload: Record<string, unknown>, done: string) => {
    setError('');
    try {
      await call(action, payload);
      setUi({ toast: { text: done, id: Date.now() } });
      void load();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="ed-col">
      <form
        className="row gap-s"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <input className="input grow" aria-label="Логин или ID" placeholder="Логин или ID человека" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn">
          <Icon name="search" size={16} /> Найти
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}
      {list?.length === 0 && <p className="muted small">Никого не нашли</p>}
      {list?.map((u) => {
        const banned = u.labels.includes('banned');
        const frozen = u.labels.includes('frozen');
        const role = u.labels.includes('owner') ? 'владелец' : u.labels.includes('admin') ? 'админ' : '';
        return (
          <div key={u.userId} className="admin-user">
            <div className="grow">
              <b>{u.displayName}</b> <span className="muted">@{u.username}</span>
              {role && <span className="tag">{role}</span>}
              {banned && <span className="tag red">бан</span>}
              {frozen && <span className="tag blue">заморожен</span>}
              <span className="muted small block">
                ID {u.num || '—'} · ✨ {u.balance} · с {new Date(u.created).toLocaleDateString('ru')}
                {u.phone ? ` · ${u.phone}` : ''}
              </span>
            </div>
            {!u.labels.includes('owner') && (
              <div className="admin-actions">
                {owner && (
                  <button type="button" className="btn small" onClick={() => void act('admin-set', { userId: u.userId, admin: !u.labels.includes('admin') }, u.labels.includes('admin') ? 'Админка снята' : 'Выдана админка')}>
                    <Icon name="crown" size={14} /> {u.labels.includes('admin') ? 'Снять админа' : 'Сделать админом'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn small"
                  onClick={async () => {
                    if (!frozen && !(await askPermission({ icon: 'snow', title: `Заморозить @${u.username}?`, text: 'Человек сможет читать, но не сможет писать сообщения, пока не разморозишь.', yes: 'Заморозить', no: 'Отмена' }))) return;
                    void act('admin-freeze', { userId: u.userId, freeze: !frozen }, frozen ? 'Разморожен' : 'Заморожен');
                  }}
                >
                  <Icon name="snow" size={14} /> {frozen ? 'Разморозить' : 'Заморозить'}
                </button>
                <button
                  type="button"
                  className={`btn small ${banned ? '' : 'danger-outline'}`}
                  onClick={async () => {
                    if (!banned && !(await askPermission({ icon: 'ban', title: `Забанить @${u.username}?`, text: 'Аккаунт заблокируется, все его сеансы закончатся. Войти он не сможет, пока не разбанишь.', yes: 'Забанить', no: 'Отмена', danger: true }))) return;
                    void act('admin-ban', { userId: u.userId, ban: !banned }, banned ? 'Разбанен' : 'Забанен');
                  }}
                >
                  <Icon name="ban" size={14} /> {banned ? 'Разбанить' : 'Забанить'}
                </button>
                {owner && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      const n = prompt(`Сколько искр начислить @${u.username}? (минус — списать)`, '100');
                      if (n && Number(n)) void act('admin-coins', { userId: u.userId, amount: Number(n) }, `✨ ${n} — готово`);
                    }}
                  >
                    ✨ Искры
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Logs() {
  const [kind, setKind] = useState('');
  const [list, setList] = useState<LogRow[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');
  const load = async (reset: boolean) => {
    try {
      const r = await call<{ logs: LogRow[] }>('admin-logs', { kind, cursor: reset ? undefined : list[list.length - 1]?.id });
      setList((l) => (reset ? r.logs : [...l, ...r.logs]));
      setMore(r.logs.length === 50);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => void load(true), [kind]);
  return (
    <div className="ed-col">
      <div className="seg wrap">
        {KINDS.map(([k, n]) => (
          <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {n}
          </button>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="admin-logs">
        {list.map((l) => (
          <div key={l.id} className="log-row">
            <time>{new Date(l.ts).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
            <span className={`tag k-${l.kind}`}>{KINDS.find(([k]) => k === l.kind)?.[1] ?? l.kind}</span>
            <span className="grow">
              <b>{l.actor}</b> {l.text}
              {l.target && l.target !== l.actor ? <> → {l.target}</> : null}
            </span>
          </div>
        ))}
        {!list.length && <p className="muted small">Пока пусто</p>}
      </div>
      {more && list.length > 0 && (
        <button type="button" className="btn ghost small" onClick={() => void load(false)}>
          Показать ещё
        </button>
      )}
    </div>
  );
}

export function AdminPanel() {
  const role = useStore((s) => s.ui.staff);
  const [tab, setTab] = useState<'users' | 'logs'>('users');
  return (
    <div className="ed-col">
      <p className="muted">
        {role === 'owner' ? 'Ты владелец Neon: можешь назначать админов, банить, замораживать, начислять искры и читать журнал.' : 'Ты админ Neon: можешь банить и замораживать обычных людей и читать журнал.'}
      </p>
      <div className="seg">
        <button type="button" className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>
          Люди
        </button>
        <button type="button" className={tab === 'logs' ? 'on' : ''} onClick={() => setTab('logs')}>
          Журнал
        </button>
      </div>
      {tab === 'users' ? <Users /> : <Logs />}
    </div>
  );
}
