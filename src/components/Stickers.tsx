import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ME } from '../data';
import { Icon } from '../icons';
import * as st from '../online/stickers';
import { actions, setUi, useStore } from '../store';
import type { Attachment, Sticker, StickerPack } from '../types';
import { Modal } from './common';

// Стикеры: панель в поле ввода, показ в чате и редактор своих наборов.

const useStickers = () => useSyncExternalStore(st.onStickers, st.stickersVersion);

/** Сам стикер: картинка или анимированный эмодзи */
export function StickerImage({ s, size = 140 }: { s: Pick<Sticker, 'url' | 'emoji' | 'anim'>; size?: number }) {
  if (s.url) return <img className="sticker-img" src={s.url} alt={s.emoji} style={{ width: size, height: size }} draggable={false} loading="lazy" />;
  return (
    <span className={`sticker-emoji anim-${s.anim ?? 'bounce'}`} style={{ fontSize: size * 0.72, width: size, height: size }} role="img" aria-label={s.emoji}>
      {s.emoji}
    </span>
  );
}

/** Стикер в сообщении: нажал — открылся его набор, можно добавить себе */
export function StickerMessage({ a }: { a: Attachment }) {
  const [open, setOpen] = useState(false);
  if (!a.sticker) return null;
  return (
    <>
      <button type="button" className="sticker-msg-btn" aria-label={`Стикер ${a.sticker.emoji}`} onClick={() => setOpen(true)}>
        <StickerImage s={{ url: a.url, emoji: a.sticker.emoji, anim: a.sticker.anim }} />
      </button>
      {open && <PackModal packId={a.sticker.pack} onClose={() => setOpen(false)} />}
    </>
  );
}

const stickerAttachment = (pack: StickerPack, s: Sticker): Attachment => ({
  name: 'Стикер',
  size: '',
  url: s.url,
  type: s.url ? 'image/webp' : undefined,
  sticker: { pack: pack.id, id: s.id, emoji: s.emoji, anim: s.anim },
});

/** Панель стикеров над полем ввода */
export function StickerPicker({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  useStickers();
  useStore((s) => s.profile.stickerPacks);
  const [tab, setTab] = useState(st.BUILTIN.id);
  const [creating, setCreating] = useState(false);
  useEffect(() => void st.loadInstalled(), []);
  const ids = st.installedIds();
  const pack = st.packOf(tab) ?? st.BUILTIN;
  return (
    <div className="sticker-pop up" role="dialog" aria-label="Стикеры">
      <div className="sticker-tabs">
        {ids.map((id) => {
          const p = st.packOf(id);
          const first = p?.stickers[0];
          return (
            <button type="button" key={id} className={`sticker-tab ${tab === id ? 'on' : ''}`} title={p?.name ?? '…'} onClick={() => setTab(id)}>
              {first ? <StickerImage s={first} size={28} /> : <Icon name="sticker" size={18} />}
            </button>
          );
        })}
        <button type="button" className="sticker-tab add" title="Создать свой набор" aria-label="Создать свой набор" onClick={() => setCreating(true)}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      <div className="sticker-head">
        <b className="ellipsis">{pack.name}</b>
        {!pack.builtin && (
          <button type="button" className="plain muted small" onClick={() => void st.uninstall(pack.id).then(() => setTab(st.BUILTIN.id))}>
            убрать из моих
          </button>
        )}
      </div>
      <div className="sticker-grid">
        {pack.stickers.map((s) => (
          <button
            type="button"
            key={s.id}
            className="sticker-cell"
            title={s.emoji}
            onClick={() => {
              actions.send(chatId, '', undefined, stickerAttachment(pack, s));
              onClose();
            }}
          >
            <StickerImage s={s} size={72} />
          </button>
        ))}
      </div>
      {creating && <PackEditor onClose={() => setCreating(false)} onCreated={(p) => setTab(p.id)} />}
    </div>
  );
}

/** Просмотр набора (из чата): добавить себе или убрать */
export function PackModal({ packId, onClose }: { packId: string; onClose: () => void }) {
  useStickers();
  useStore((s) => s.profile.stickerPacks);
  const [pack, setPack] = useState<StickerPack | null | undefined>(() => st.packOf(packId));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!pack) void st.fetchPack(packId).then(setPack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packId]);
  const installed = st.isInstalled(packId);
  return (
    <Modal onClose={onClose} width={460} label="Набор стикеров" className="composer-modal">
      <div className="modal-head">
        <h2>{pack === null ? 'Набор удалён' : (pack?.name ?? 'Загружаю…')}</h2>
        {pack && <p className="muted small">{pack.builtin ? 'Встроенный набор Fizion' : `${pack.stickers.length} стикеров${pack.authorId === ME ? ' · твой набор' : ''}`}</p>}
      </div>
      {pack && (
        <div className="sticker-grid big">
          {pack.stickers.map((s) => (
            <span key={s.id} className="sticker-cell">
              <StickerImage s={s} size={84} />
            </span>
          ))}
        </div>
      )}
      <div className="modal-actions">
        {pack && !pack.builtin && pack.authorId === ME && (
          <button type="button" className="btn danger-outline" disabled={busy} onClick={() => confirm('Удалить набор насовсем? Он пропадёт и у тех, кто его добавил.') && void st.deletePack(packId).then(onClose)}>
            Удалить набор
          </button>
        )}
        <button type="button" className="btn ghost" onClick={onClose}>
          Закрыть
        </button>
        {pack && !pack.builtin && (
          <button
            type="button"
            className={`btn ${installed ? '' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await (installed ? st.uninstall(packId) : st.install(packId));
              setBusy(false);
              setUi({ toast: { text: installed ? 'Набор убран' : `Набор «${pack.name}» добавлен — он в панели стикеров`, id: Date.now() } });
            }}
          >
            {installed ? 'Убрать из моих' : 'Добавить себе'}
          </button>
        )}
      </div>
    </Modal>
  );
}

const QUICK = ['🙂', '😂', '😍', '😎', '😭', '😡', '👍', '❤️', '🔥', '🤔', '😴', '🎉'];

/** Создать свой набор из картинок и гифок */
export function PackEditor({ onClose, onCreated }: { onClose: () => void; onCreated?: (p: StickerPack) => void }) {
  const [name, setName] = useState('');
  const [items, setItems] = useState<{ file: File; emoji: string }[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const previews = useMemo(() => items.map((i) => URL.createObjectURL(i.file)), [items]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const add = (files: FileList | null) => {
    if (!files) return;
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    setItems((l) => [...l, ...imgs.map((file, i) => ({ file, emoji: QUICK[(l.length + i) % QUICK.length] }))].slice(0, 60));
    setError('');
  };

  const create = async () => {
    setBusy(0);
    setError('');
    try {
      const p = await st.createPack(name, items, setBusy);
      onCreated?.(p);
      setUi({ toast: { text: `Набор «${p.name}» готов — отправляй и делись`, id: Date.now() } });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <Modal onClose={() => busy === null && onClose()} width={520} label="Свой набор стикеров" className="composer-modal">
      <div className="modal-head">
        <h2>Свой набор стикеров</h2>
        <p className="muted small">Картинки (PNG, JPG, WebP) и гифки — до 60 штук. Лучше квадратные и с прозрачным фоном. Каждому стикеру — эмодзи, по которому его узнают.</p>
      </div>
      <input className="input" aria-label="Название набора" placeholder="Название, например «Котики DIADOn»" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
      <div
        className="pack-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          add(e.dataTransfer.files);
        }}
      >
        {items.map((it, i) => (
          <div key={i} className="pack-item">
            <img src={previews[i]} alt="" />
            <select aria-label="Эмодзи стикера" value={it.emoji} onChange={(e) => setItems((l) => l.map((x, j) => (j === i ? { ...x, emoji: e.target.value } : x)))}>
              {QUICK.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
            <button type="button" className="pack-remove" aria-label="Убрать" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <label className="pack-add">
          <Icon name="plus" size={22} />
          <span className="small">Добавить</span>
          <input type="file" accept="image/*" multiple hidden aria-label="Картинки для стикеров" onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn primary" disabled={!items.length || busy !== null} onClick={() => void create()}>
          {busy !== null ? `Загружаю ${busy}/${items.length}…` : `Создать набор (${items.length})`}
        </button>
      </div>
    </Modal>
  );
}
