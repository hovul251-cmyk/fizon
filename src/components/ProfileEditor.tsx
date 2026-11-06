import { useRef, useState } from 'react';
import { uid } from '../data';
import { Icon, type IconName } from '../icons';
import { errorText, toast } from '../online/sync';
import { actions, setUi, useStore } from '../store';
import type { CardStyle, Profile, Visibility, WidgetType } from '../types';
import { colors, readImage, Toggle } from './common';
import { ProfileCardView } from './Profile';

const widgetNames: Record<WidgetType, string> = {
  about: 'О себе',
  links: 'Ссылки',
  now: 'Сейчас делаю',
  showcase: 'Витрина работ',
  games: 'Любимые игры',
  badges: 'Значки',
};

const visNames: Record<Visibility, string> = { all: 'Видят все', friends: 'Только друзья', none: 'Скрыто' };

const styles: [CardStyle, string][] = [
  ['glass', 'Стекло'],
  ['matte', 'Матовый'],
  ['neon', 'Неон'],
  ['minimal', 'Минимал'],
];

const frames: [Profile['avatarFrame'], string][] = [
  ['none', 'Без рамки'],
  ['neon', 'Неон'],
  ['gold', 'Золото'],
  ['fire', 'Огонь'],
];

const cardColors = ['#1A1730', '#0F1A2E', '#1A2620', '#2A1420', '#1E222B', '#231A10'];

type Section = 'look' | 'info' | 'blocks';

function Swatches({ value, onChange, list = colors, label }: { value: string; onChange: (c: string) => void; list?: string[]; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {list.map((c) => (
        <button type="button" key={c} role="radio" aria-checked={value === c} aria-label={c} className={`sw ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <label className="sw custom" title="Свой цвет">
        <Icon name="plus" size={14} />
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: свой цвет`} />
      </label>
    </div>
  );
}

export function ProfileEditor() {
  const saved = useStore((s) => s.profile);
  const [p, setP] = useState<Profile>(saved);
  const [section, setSection] = useState<Section>('look');
  const [stranger, setStranger] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newLink, setNewLink] = useState({ label: '', url: '' });
  const [newItem, setNewItem] = useState('');
  const [newGame, setNewGame] = useState('');
  const avatarFile = useRef<HTMLInputElement>(null);
  const bannerFile = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(p) !== JSON.stringify(saved);

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((x) => ({ ...x, [k]: v }));
  const close = () => setUi({ modal: null });

  const moveWidget = (i: number, d: -1 | 1) => {
    const w = [...p.widgets];
    const j = i + d;
    if (j < 0 || j >= w.length) return;
    [w[i], w[j]] = [w[j], w[i]];
    set('widgets', w);
  };

  const nav: [Section, string, IconName][] = [
    ['look', 'Внешний вид', 'user'],
    ['info', 'О себе и статус', 'smile'],
    ['blocks', 'Блоки и приватность', 'lock'],
  ];

  return (
    <div className="fullscreen" role="dialog" aria-modal="true" aria-label="Редактор профиля">
      <nav className="settings-nav">
        <div className="cat">ПРОФИЛЬ</div>
        {nav.map(([k, l, i]) => (
          <button type="button" key={k} className={`nav-item ${section === k ? 'on' : ''}`} onClick={() => setSection(k)}>
            <Icon name={i} size={18} /> {l}
          </button>
        ))}
      </nav>
      <main className="settings-main editor-main">
        <div className="settings-head">
          <h1>{nav.find((n) => n[0] === section)?.[1]}</h1>
        </div>

        {section === 'look' && (
          <div className="ed-grid">
            <div className="box">
              <div className="cat">АВАТАР</div>
              <div className="row gap">
                <button type="button" className="btn primary" onClick={() => avatarFile.current?.click()}>
                  Загрузить картинку
                </button>
                {p.avatarImage && (
                  <button type="button" className="btn" onClick={() => set('avatarImage', null)}>
                    Убрать
                  </button>
                )}
                <input ref={avatarFile} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('avatarImage', await readImage(f, 256, 256)); e.target.value = ''; }} />
              </div>
              {!p.avatarImage && <Swatches label="Цвет аватара" value={p.avatarColor} onChange={(c) => set('avatarColor', c)} />}
              <div className="chips">
                {frames.map(([k, l]) => (
                  <button type="button" key={k} className={`chip ${p.avatarFrame === k ? 'on' : ''}`} onClick={() => set('avatarFrame', k)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="box">
              <div className="cat">БАННЕР</div>
              <div className="row gap">
                <button type="button" className="btn primary" onClick={() => bannerFile.current?.click()}>
                  Загрузить картинку
                </button>
                {p.bannerImage && (
                  <button type="button" className="btn" onClick={() => set('bannerImage', null)}>
                    Убрать
                  </button>
                )}
                <input ref={bannerFile} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('bannerImage', await readImage(f, 960, 360)); e.target.value = ''; }} />
              </div>
              {!p.bannerImage && (
                <>
                  <Swatches label="Основной цвет баннера" value={p.bannerColor} onChange={(c) => set('bannerColor', c)} list={['#0B3A44', '#2E1F5E', '#3B1230', '#14352A', '#1F2A44', '#3F2A0B']} />
                  <Swatches label="Второй цвет баннера" value={p.bannerColor2} onChange={(c) => set('bannerColor2', c)} />
                </>
              )}
            </div>
            <div className="box">
              <div className="cat">ЦВЕТ ИМЕНИ</div>
              <Swatches label="Цвет имени" value={p.nameColor} onChange={(c) => set('nameColor', c)} list={['#A78BFA', '#22D3EE', '#F472B6', '#FBBF24', '#34D399', '#60A5FA', '#F87171', '#ECEEF3']} />
              <div className="row between">
                <span>Градиент</span>
                <Toggle label="Градиент имени" checked={p.nameGradient} onChange={(v) => set('nameGradient', v)} />
              </div>
              {p.nameGradient && <Swatches label="Второй цвет имени" value={p.nameColor2} onChange={(c) => set('nameColor2', c)} list={['#22D3EE', '#A78BFA', '#F472B6', '#FBBF24', '#34D399', '#60A5FA']} />}
              <div className="row between">
                <span>Свечение</span>
                <Toggle label="Свечение имени" checked={p.nameEffect === 'glow'} onChange={(v) => set('nameEffect', v ? 'glow' : 'none')} />
              </div>
            </div>
            <div className="box">
              <div className="cat">СТИЛЬ КАРТОЧКИ</div>
              <div className="opts">
                {styles.map(([k, l]) => (
                  <button type="button" key={k} className={`opt ${p.cardStyle === k ? 'on' : ''}`} onClick={() => set('cardStyle', k)}>
                    {l}
                  </button>
                ))}
              </div>
              {p.cardStyle !== 'minimal' && <Swatches label="Цвет карточки" value={p.cardColor} onChange={(c) => set('cardColor', c)} list={cardColors} />}
            </div>
          </div>
        )}

        {section === 'info' && (
          <div className="ed-col">
            <label className="field">
              ОТОБРАЖАЕМОЕ ИМЯ
              <input className="input" value={p.displayName} maxLength={32} onChange={(e) => set('displayName', e.target.value)} />
            </label>
            <div className="row gap">
              <label className="field grow">
                ИМЯ ПОЛЬЗОВАТЕЛЯ
                <input className="input" value={p.username} maxLength={32} onChange={(e) => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9._]/g, ''))} />
              </label>
              <label className="field grow">
                МЕСТОИМЕНИЯ
                <input className="input" value={p.pronouns} maxLength={20} placeholder="например, он/его" onChange={(e) => set('pronouns', e.target.value)} />
              </label>
            </div>
            <label className="field">
              СТАТУС
              <input className="input" value={p.status} maxLength={60} placeholder="Что сейчас делаешь?" onChange={(e) => set('status', e.target.value)} />
            </label>
            <label className="field">
              СЕЙЧАС ДЕЛАЮ
              <input className="input" value={p.activity} maxLength={60} placeholder="Монтаж видео · CapCut" onChange={(e) => set('activity', e.target.value)} />
            </label>
            <label className="field">
              О СЕБЕ <span className="muted normal">{p.about.length}/400</span>
              <textarea className="input area" value={p.about} maxLength={400} onChange={(e) => set('about', e.target.value)} />
            </label>
            <div className="field">
              ССЫЛКИ
              {p.links.map((l) => (
                <div className="list-row" key={l.id}>
                  <Icon name="link" size={16} />
                  <b>{l.label}</b>
                  <span className="muted ellipsis">{l.url}</span>
                  <button type="button" className="plain red" aria-label={`Удалить ${l.label}`} onClick={() => set('links', p.links.filter((x) => x.id !== l.id))}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
              {p.links.length < 6 && (
                <form
                  className="row gap"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newLink.label.trim() || !newLink.url.trim()) return;
                    const url = /^https?:\/\//.test(newLink.url) ? newLink.url : `https://${newLink.url}`;
                    set('links', [...p.links, { id: uid(), label: newLink.label.trim(), url }]);
                    setNewLink({ label: '', url: '' });
                  }}
                >
                  <input className="input" aria-label="Название ссылки" placeholder="Название" value={newLink.label} onChange={(e) => setNewLink({ ...newLink, label: e.target.value })} />
                  <input className="input grow" aria-label="Адрес ссылки" placeholder="tiktok.com/@..." value={newLink.url} onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
                  <button type="submit" className="btn">
                    Добавить
                  </button>
                </form>
              )}
            </div>
            <div className="row gap top">
              <div className="field grow">
                ВИТРИНА РАБОТ
                <div className="chips">
                  {p.showcase.map((s, i) => (
                    <button type="button" key={s + i} className="chip on" title="Удалить" onClick={() => set('showcase', p.showcase.filter((_, j) => j !== i))}>
                      {s} ×
                    </button>
                  ))}
                </div>
                {p.showcase.length < 12 && (
                  <form className="row gap" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) { set('showcase', [...p.showcase, newItem.trim()]); setNewItem(''); } }}>
                    <input className="input grow" aria-label="Новая работа" placeholder="Название работы" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
                    <button type="submit" className="btn">+</button>
                  </form>
                )}
              </div>
              <div className="field grow">
                ЛЮБИМЫЕ ИГРЫ
                <div className="chips">
                  {p.games.map((g) => (
                    <button type="button" key={g} className="chip on" title="Удалить" onClick={() => set('games', p.games.filter((x) => x !== g))}>
                      {g} ×
                    </button>
                  ))}
                </div>
                <form className="row gap" onSubmit={(e) => { e.preventDefault(); if (newGame.trim() && !p.games.includes(newGame.trim())) { set('games', [...p.games, newGame.trim()]); setNewGame(''); } }}>
                  <input className="input grow" aria-label="Новая игра" placeholder="Название игры" value={newGame} onChange={(e) => setNewGame(e.target.value)} />
                  <button type="submit" className="btn">+</button>
                </form>
              </div>
            </div>
          </div>
        )}

        {section === 'blocks' && (
          <div className="ed-col">
            <p className="muted">Порядок блоков — это порядок в полном профиле. Для каждого блока выбери, кто его видит.</p>
            {p.widgets.map((w, i) => (
              <div className="list-row big" key={w.type}>
                <span className="updown">
                  <button type="button" className="plain" aria-label="Выше" disabled={i === 0} onClick={() => moveWidget(i, -1)}>
                    <Icon name="up" size={16} />
                  </button>
                  <button type="button" className="plain" aria-label="Ниже" disabled={i === p.widgets.length - 1} onClick={() => moveWidget(i, 1)}>
                    <Icon name="down" size={16} />
                  </button>
                </span>
                <b>{widgetNames[w.type]}</b>
                <select
                  className="select"
                  aria-label={`Кто видит: ${widgetNames[w.type]}`}
                  value={w.visible}
                  onChange={(e) => set('widgets', p.widgets.map((x) => (x.type === w.type ? { ...x, visible: e.target.value as Visibility } : x)))}
                >
                  {(Object.keys(visNames) as Visibility[]).map((v) => (
                    <option key={v} value={v}>
                      {visNames[v]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className={`save-bar ${dirty ? 'show' : ''}`}>
          <span>{dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены'}</span>
          <button type="button" className="btn ghost" disabled={!dirty} onClick={() => setP(saved)}>
            Сбросить
          </button>
          <button
            type="button"
            className="btn green"
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              try {
                setP(await actions.saveProfile({ ...p, displayName: p.displayName.trim() || saved.displayName, username: p.username.length >= 2 ? p.username : saved.username }));
              } catch (e) {
                toast(errorText(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </main>
      <aside className="preview">
        <div className="row between">
          <span className="cat flat">ПРЕДПРОСМОТР</span>
          <span className="muted small">{stranger ? 'как видит незнакомец' : 'как видят друзья'}</span>
        </div>
        <ProfileCardView profile={p} asStranger={stranger} />
        <label className="row gap muted small">
          <Toggle label="Показать как видит незнакомец" checked={stranger} onChange={setStranger} />
          Показать как видит незнакомец
        </label>
      </aside>
      <button
        type="button"
        className="close-round"
        aria-label="Закрыть редактор"
        onClick={() => {
          if (!dirty || confirm('Выйти без сохранения изменений?')) close();
        }}
      >
        <Icon name="close" />
        <span>ESC</span>
      </button>
    </div>
  );
}
