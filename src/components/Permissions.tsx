import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../icons';
import { permState, requestPerm, unblockHelp, watchPerm, type PermKind, type PermState } from '../lib/permissions';
import { IS_TAURI } from '../lib/platform';
import { pushSupported, subscribePush } from '../lib/push';
import * as remote from '../online/remote';
import { setUi } from '../store';

const ROWS: { kind: PermKind; icon: IconName; name: string; why: string }[] = [
  { kind: 'microphone', icon: 'mic', name: 'Микрофон', why: 'Голосовые комнаты, звонки и голосовые сообщения' },
  { kind: 'camera', icon: 'video', name: 'Камера', why: 'Видеозвонки и видеосообщения в кружочках' },
  { kind: 'notifications', icon: 'bell', name: 'Уведомления', why: 'Новые сообщения и входящие звонки, когда Neon свёрнут' },
];

const LABEL: Record<PermState, [string, string]> = {
  granted: ['Разрешено', 'green'],
  denied: ['Запрещено', 'red'],
  prompt: ['Не разрешено', ''],
  insecure: ['Недоступно', 'red'],
  unsupported: ['Не поддерживается', ''],
};

function PermRow({ kind, icon, name, why }: (typeof ROWS)[number]) {
  const [st, setSt] = useState<PermState | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const check = () => void permState(kind).then(setSt);
  useEffect(() => {
    check();
    const off = watchPerm(kind, check);
    // вернулся из настроек телефона — проверяем ещё раз
    const vis = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', vis);
    return () => {
      off();
      document.removeEventListener('visibilitychange', vis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const ask = () => {
    setBusy(true);
    // requestPerm вызывается прямо в нажатии — иначе телефон не покажет окно разрешения
    void requestPerm(kind).then((r) => {
      setBusy(false);
      setSt(r);
      if (r === 'granted') setUi({ toast: { text: `${name}: доступ разрешён`, id: Date.now() } });
      // уведомления разрешили — подписываемся на push, чтобы они приходили и при закрытой вкладке
      if (r === 'granted' && kind === 'notifications' && pushSupported()) void subscribePush(remote.savePushSub);
      else if (r === 'denied') setHelp(true);
    });
  };
  const [label, tone] = st ? LABEL[st] : ['Проверяю…', ''];
  return (
    <div className="perm-row">
      <div className="list-row">
        <span className={`perm-ico ${st === 'granted' ? 'ok' : ''}`}>
          <Icon name={icon} size={20} />
        </span>
        <span className="grow">
          <b>{name}</b> <span className={`tag ${tone}`}>{label}</span>
          <span className="muted small block">{why}</span>
        </span>
        {st === 'granted' ? (
          <Icon name="check" size={20} className="perm-ok" />
        ) : st === 'denied' ? (
          <button type="button" className="btn small" onClick={() => setHelp((v) => !v)}>
            Как разрешить
          </button>
        ) : st === 'prompt' ? (
          <button type="button" className="btn small primary" disabled={busy} onClick={ask}>
            {busy ? 'Жду ответа…' : 'Разрешить'}
          </button>
        ) : null}
      </div>
      {st === 'denied' && help && (
        <div className="perm-help">
          <p>{unblockHelp(kind)}</p>
          <div className="row gap-s wrap">
            <button type="button" className="btn small" onClick={check}>
              <Icon name="refresh" size={14} /> Проверить
            </button>
            <button type="button" className="btn small ghost" onClick={ask}>
              Спросить ещё раз
            </button>
          </div>
        </div>
      )}
      {st === 'unsupported' && kind === 'notifications' && <p className="perm-help">{unblockHelp('notifications')}</p>}
    </div>
  );
}

/** Настройки → Разрешения: каждое разрешение выдаётся кнопкой */
export function PermissionSettings() {
  const insecure = typeof isSecureContext !== 'undefined' && !isSecureContext;
  return (
    <div className="ed-col narrow">
      <p className="muted">
        {IS_TAURI ? 'Neon спросит разрешение, когда нажмёшь кнопку.' : 'Браузер спрашивает разрешение, только когда нажимаешь кнопку.'} Нажми «Разрешить» и выбери «Разрешить» в появившемся окне.
      </p>
      {insecure && (
        <div className="perm-help warn">
          <b>Сайт открыт по http://</b>
          <p>
            Браузеры дают доступ к микрофону, камере и уведомлениям только сайтам на <b>https://</b> (или localhost). Открой веб-версию по её https-адресу — её выкладывает <code>npm run web:deploy</code>.
          </p>
        </div>
      )}
      {ROWS.map((r) => (
        <PermRow key={r.kind} {...r} />
      ))}
    </div>
  );
}
