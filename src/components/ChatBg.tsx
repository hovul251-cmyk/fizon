import { useRef, useState } from 'react';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import * as remote from '../online/remote';
import { actions, useStore } from '../store';

// Фон чатов: любая своя картинка или гифка, с затемнением и размытием, чтобы текст читался.

const MAX_MB = 15;

const toDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Не удалось прочитать файл'));
    r.readAsDataURL(f);
  });

export function ChatBgSettings() {
  const bg = useStore((s) => s.settings.chatBg ?? null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError('');
    if (!f.type.startsWith('image/')) return setError('Подойдёт картинка или гифка');
    if (f.size > MAX_MB * 1024 * 1024) return setError(`Файл больше ${MAX_MB} МБ`);
    if (!ONLINE && f.size > 4 * 1024 * 1024) return setError('Без аккаунта фон хранится на устройстве — до 4 МБ');
    setBusy(true);
    try {
      const url = ONLINE ? await remote.uploadPublic(f) : await toDataUrl(f);
      actions.updateSettings({ chatBg: { url, dim: bg?.dim ?? 35, blur: bg?.blur ?? 0 } });
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="field">
      ФОН ЧАТОВ
      <div className="bg-row">
        <button type="button" className="bg-preview" style={bg ? { backgroundImage: `url("${bg.url}")` } : undefined} onClick={() => input.current?.click()} aria-label="Выбрать фон">
          {!bg && <Icon name="image" size={26} />}
          {bg && <span className="bg-dim" style={{ background: `rgba(0,0,0,${bg.dim / 100})`, backdropFilter: `blur(${bg.blur}px)` }} />}
        </button>
        <div className="grow bg-controls">
          <div className="row gap-s">
            <button type="button" className="btn small primary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Загружаю…' : bg ? 'Другая картинка' : 'Выбрать фото или гифку'}
            </button>
            {bg && (
              <button type="button" className="btn small ghost" onClick={() => actions.updateSettings({ chatBg: null })}>
                Убрать
              </button>
            )}
          </div>
          {bg && (
            <>
              <label className="small">
                Затемнение — {bg.dim}%
                <input type="range" min={0} max={85} value={bg.dim} onChange={(e) => actions.updateSettings({ chatBg: { ...bg, dim: Number(e.target.value) } })} />
              </label>
              <label className="small">
                Размытие — {bg.blur}px
                <input type="range" min={0} max={20} value={bg.blur} onChange={(e) => actions.updateSettings({ chatBg: { ...bg, blur: Number(e.target.value) } })} />
              </label>
            </>
          )}
          <span className="muted small">Любая картинка или гифка до {MAX_MB} МБ. Фон виден только тебе.</span>
          {error && <span className="form-error">{error}</span>}
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" hidden aria-label="Файл фона" onChange={(e) => (void pick(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}
