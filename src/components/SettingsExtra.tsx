import { useEffect, useState, useSyncExternalStore } from 'react';
import { getAutostart, setAutostart } from '../lib/desktop';
import { UpdateSettings } from './Updates';
import { ONLINE } from '../lib/appwrite';
import { askNotifyPermission, canNotify, notifyPermission } from '../lib/notify';
import { IS_DESKTOP_APP } from '../lib/platform';
import { currentSubscription, pushSupported, subscribePush, unsubscribePush } from '../lib/push';
import * as remote from '../online/remote';
import { actions, useStore } from '../store';
import { Toggle } from './common';

// Настройки: уведомления (+ автозапуск и обновления на Windows) и сквозное шифрование.

export function NotifySettings() {
  const mode = useStore((s) => s.settings.notify ?? 'all');
  const [perm, setPerm] = useState(notifyPermission());
  const [push, setPush] = useState<boolean | null>(null);
  const [pushMsg, setPushMsg] = useState('');
  const [auto, setAuto] = useState<boolean | null>(null);

  useEffect(() => {
    void currentSubscription().then((s) => setPush(!!s));
    void getAutostart().then(setAuto);
  }, []);

  const togglePush = async (on: boolean) => {
    setPushMsg('');
    if (!on) {
      await unsubscribePush(remote.removePushSub);
      return setPush(false);
    }
    const err = await subscribePush(remote.savePushSub);
    if (err) setPushMsg(err);
    setPush(!err);
    setPerm(notifyPermission());
  };

  return (
    <>
      <div className="settings-head">
        <h1>{IS_DESKTOP_APP ? 'Уведомления и Windows' : 'Уведомления'}</h1>
      </div>
      <div className="ed-col narrow">
        <div className="field">
          О ЧЁМ УВЕДОМЛЯТЬ
          {(
            [
              ['all', 'Личные, группы и упоминания меня в сообществах'],
              ['dm', 'Только личные сообщения, звонки и упоминания'],
              ['off', 'Ничего — открою Fizion сам'],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="radio">
              <input type="radio" name="notify" checked={mode === k} onChange={() => actions.updateSettings({ notify: k })} />
              {l}
            </label>
          ))}
        </div>
        {canNotify() && perm !== 'granted' && (
          <div className="list-row big">
            <div className="grow">
              <div className="strong">Разрешить уведомления</div>
              <div className="muted small">{perm === 'denied' ? 'Уведомления запрещены — разреши их в настройках браузера или Windows' : 'Без разрешения Fizion не сможет показывать уведомления'}</div>
            </div>
            <button type="button" className="btn primary" disabled={perm === 'denied'} onClick={async () => setPerm(await askNotifyPermission())}>
              Разрешить
            </button>
          </div>
        )}
        {!IS_DESKTOP_APP && (
          <div className="list-row big">
            <div className="grow">
              <div className="strong">Push на этом устройстве</div>
              <div className="muted small">
                {pushSupported()
                  ? 'Уведомления о сообщениях и звонках придут, даже когда Fizion закрыт.'
                  : ONLINE
                    ? 'Этот браузер не умеет push. На iPhone добавь Fizion на экран «Домой» и открой оттуда.'
                    : 'Работает в онлайн-режиме.'}
              </div>
              {pushMsg && <div className="form-error small">{pushMsg}</div>}
            </div>
            <Toggle label="Push-уведомления" checked={!!push} onChange={(v) => void togglePush(v)} />
          </div>
        )}
        {IS_DESKTOP_APP && (
          <>
            <div className="list-row big">
              <div className="grow">
                <div className="strong">Запускать вместе с Windows</div>
                <div className="muted small">Fizion тихо стартует в трее — сообщения и звонки придут сразу после включения компьютера</div>
              </div>
              <Toggle
                label="Автозапуск"
                checked={!!auto}
                onChange={async (v) => {
                  await setAutostart(v).catch(() => undefined);
                  setAuto(await getAutostart());
                }}
              />
            </div>
            <div className="list-row big">
              <div className="grow">
                <div className="strong">Значок в трее</div>
                <div className="muted small">Крестик прячет Fizion в трей рядом с часами, чтобы не пропустить звонок. Выйти совсем — правой кнопкой по значку → «Выйти из Fizion».</div>
              </div>
            </div>
          </>
        )}
        <div className="cat flat">ОБНОВЛЕНИЯ</div>
        <UpdateSettings />
      </div>
    </>
  );
}

export function PrivacySettings() {
  const state = useSyncExternalStore(remote.onEncryptionChange, remote.encryptionState);
  const [devices, setDevices] = useState<remote.DeviceView[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => void remote.encryptionDevices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => {
    if (ONLINE && state !== 'off') reload();
  }, [state]);

  const restart = async () => {
    if (!confirm('Создать новый ключ? Старые зашифрованные сообщения на этом устройстве открыть будет нельзя. Обычно это не нужно — ключ переносится сам.')) return;
    setBusy(true);
    await remote.restartEncryption().catch(() => undefined);
    setBusy(false);
    reload();
  };

  return (
    <>
      <div className="settings-head">
        <h1>Сквозное шифрование</h1>
      </div>
      <div className="ed-col narrow">
        <p className="muted">
          Личные сообщения, группы, файлы, голосовые и звонки шифруются прямо на устройстве. Прочитать их могут только участники переписки — ни сервер, ни администратор
          Fizion. Ключ создаётся сам и нигде не показывается, поэтому его невозможно подсмотреть или потерять: на новый компьютер или телефон он переносится сам с
          твоих других устройств.
        </p>
        {!ONLINE && <p className="note">Шифрование работает в онлайн-режиме.</p>}
        {ONLINE && state === 'ready' && (
          <div className="e2e-ok">
            <b>🔒 Шифрование работает</b>
            <span className="muted small">В зашифрованных чатах рядом с сообщениями горит замок.</span>
          </div>
        )}
        {ONLINE && state === 'waiting' && (
          <div className="e2e-wait">
            <b>⏳ Переношу ключ с другого устройства</b>
            <span className="muted small">
              Открой Fizion на компьютере или телефоне, где ты уже входил, — ключ перенесётся сам за пару секунд, и сообщения откроются. Если старого устройства
              больше нет — нажми «Создать новый ключ» ниже.
            </span>
          </div>
        )}
        {ONLINE && state !== 'off' && (
          <>
            <div className="cat flat">УСТРОЙСТВА С ДОСТУПОМ К ПЕРЕПИСКЕ</div>
            {devices === null && <p className="muted small">Загружаю…</p>}
            {devices?.map((d) => (
              <div className="list-row big" key={d.id}>
                <div className="grow">
                  <div className="strong">
                    {d.name}
                    {d.current && <span className="tag-soft">это устройство</span>}
                  </div>
                  <div className="muted small">{d.ready ? `ключ есть · был в сети ${new Date(d.seen).toLocaleDateString('ru-RU')}` : 'ждёт ключ'}</div>
                </div>
                {!d.current && (
                  <button
                    type="button"
                    className="btn small danger-outline"
                    onClick={() => confirm(`Убрать «${d.name}» из списка? Если это не твоё устройство — заодно смени пароль.`) && void remote.removeEncryptionDevice(d.id).then(reload)}
                  >
                    Убрать
                  </button>
                )}
              </div>
            ))}
            <p className="muted small">Видишь незнакомое устройство — убери его и смени пароль от аккаунта.</p>
            <button type="button" className="btn small" disabled={busy} onClick={() => void restart()}>
              {busy ? 'Создаю…' : 'Создать новый ключ'}
            </button>
          </>
        )}
        <p className="muted small">Не шифруются сообщения в сообществах (там их видят все участники и модераторы), истории и лента. Поиск по истории не видит зашифрованные сообщения.</p>
      </div>
    </>
  );
}
