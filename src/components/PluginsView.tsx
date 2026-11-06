import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../icons';
import { EXAMPLES } from '../plugins/examples';
import * as host from '../plugins/host';
import { PERMS, type PluginRecord } from '../plugins/host';
import { ONLINE } from '../lib/appwrite';
import * as remote from '../online/remote';
import { Toggle, usePerson } from './common';

// Раздел «Плагины»: установленные плагины слева, справа — добавление (вставить код или открыть файл),
// готовые примеры, инструкция для авторов и карточка выбранного плагина.

const cmdCount = (n: number) => (n === 0 ? 'без команд' : `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'команда' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'команды' : 'команд'}`);

type Tab = 'add' | 'examples' | 'docs' | 'catalog' | { plugin: string };

function PermList({ perms, unknown = [] }: { perms: host.Perm[]; unknown?: string[] }) {
  if (!perms.length && !unknown.length) return <p className="muted small">Особых разрешений не просит.</p>;
  return (
    <ul className="perm-list">
      {perms.map((p) => (
        <li key={p} className={p === 'messages:send' ? 'warn' : ''}>
          <b>{PERMS[p].title}</b> — {PERMS[p].risk}
        </li>
      ))}
      {unknown.map((p) => (
        <li key={p} className="muted">
          «{p}» — такого разрешения нет, оно будет пропущено
        </li>
      ))}
    </ul>
  );
}

function AddPlugin({ onInstalled, initial }: { onInstalled: (id: string) => void; initial?: { code: string; file: string; catalogId?: string } }) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [file, setFile] = useState(initial?.file ?? '');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { records } = host.usePlugins();
  const m = useMemo(() => (code.trim() ? host.parseManifest(code, file) : null), [code, file]);
  const exists = m?.name && records.some((r) => r.name === m.name);

  const doInstall = () => {
    const r = host.install(code, file, initial?.catalogId);
    if (!r.ok) return setError(r.error);
    setCode('');
    setFile('');
    onInstalled(r.id);
  };

  return (
    <div className="plug-pane">
      <h2>Добавить плагин</h2>
      <p className="muted">Вставь код плагина или открой файл: <b>.js</b> — плагин, <b>.css</b> — тема оформления. Ставь только плагины тех, кому доверяешь.</p>
      <div className="plug-editor">
        <textarea
          className="input code"
          aria-label="Код плагина"
          spellCheck={false}
          placeholder={'// @name Мой плагин\n// @permissions commands\n\nfizion.command(\'hi\', \'Поздороваться\', () => \'Привет! 👋\');'}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError('');
          }}
        />
        <div className="plug-editor-bar">
          <button type="button" className="btn small" onClick={() => input.current?.click()}>
            <Icon name="upload" size={15} /> Открыть файл
          </button>
          {file && <span className="muted small">{file}</span>}
          <span className="muted small ml-auto">{code.length ? `${Math.ceil(code.length / 1024)} КБ` : ''}</span>
        </div>
        <input
          ref={input}
          type="file"
          accept=".js,.css,.txt,text/javascript,text/css"
          hidden
          aria-label="Файл плагина"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            if (f.size > host.MAX_CODE) return setError('Файл больше 200 КБ');
            setFile(f.name);
            setCode(await f.text());
          }}
        />
      </div>
      {m && (
        <div className="plug-preview">
          <div className="plug-preview-head">
            <span className={`plug-icon ${m.kind}`}>
              <Icon name={m.kind === 'theme' ? 'star' : 'puzzle'} size={20} />
            </span>
            <span className="grow">
              <span className="strong">{m.name || 'Без названия'}</span>
              <span className="muted small">
                {m.kind === 'theme' ? 'Тема' : 'Плагин'} · версия {m.version}
                {m.author && ` · ${m.author}`}
              </span>
            </span>
          </div>
          {m.description && <p>{m.description}</p>}
          {m.kind === 'script' && (
            <>
              <div className="cat">ПЛАГИН СМОЖЕТ</div>
              <PermList perms={m.permissions} unknown={m.unknownPerms} />
            </>
          )}
          {!m.name && <p className="form-error">Добавь в начало строку «// @name Название» — без неё плагин не установится.</p>}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn primary" disabled={!m?.name} onClick={doInstall}>
          {exists ? 'Обновить плагин' : 'Установить'}
        </button>
      </div>
    </div>
  );
}

function Examples({ onPick }: { onPick: (code: string, file: string) => void }) {
  const { records } = host.usePlugins();
  return (
    <div className="plug-pane">
      <h2>Примеры</h2>
      <p className="muted">Готовые плагины — поставь в один клик или открой код и сделай свой на их основе.</p>
      <div className="plug-grid">
        {EXAMPLES.map((ex) => {
          const m = host.parseManifest(ex.code, ex.file);
          const installed = records.some((r) => r.name === m.name);
          return (
            <div key={ex.file} className="plug-card">
              <div className="plug-preview-head">
                <span className={`plug-icon ${m.kind}`}>
                  <Icon name={m.kind === 'theme' ? 'star' : 'puzzle'} size={20} />
                </span>
                <span className="grow">
                  <span className="strong">{m.name}</span>
                  <span className="muted small">{m.kind === 'theme' ? 'Тема' : m.permissions.map((p) => PERMS[p].title).join(' · ')}</span>
                </span>
              </div>
              <p className="muted small">{m.description}</p>
              <div className="plug-card-actions">
                <button type="button" className="btn small ghost" onClick={() => onPick(ex.code, ex.file)}>
                  Код
                </button>
                <button
                  type="button"
                  className="btn small primary"
                  disabled={installed}
                  onClick={() => void host.install(ex.code, ex.file)}
                >
                  {installed ? 'Установлен' : 'Установить'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DOC_SAMPLE = `// @name Привет
// @version 1.0
// @author твоё имя
// @description Отвечает на /hi и считает сообщения
// @permissions commands, messages:read

// команда в поле ввода: /hi Kira
fizion.command('hi', 'Поздороваться', (args, ctx) => {
  return 'Привет, ' + (args || 'всем') + '! 👋'; // этот текст уйдёт в чат
});

// новые сообщения во всех открытых чатах
let n = fizion.storage.get('count') || 0;
fizion.on('message', (m) => {
  n++;
  fizion.storage.set('count', n);
  fizion.panel([{ type: 'stat', label: 'Сообщений увидел', value: String(n) }]);
});`;

function Docs() {
  return (
    <div className="plug-pane docs">
      <h2>Как написать плагин</h2>
      <p>
        Плагин — это обычный JavaScript-файл. В начале — описание в комментариях, дальше код, который работает с объектом <code>fizion</code>. Плагин запускается в
        песочнице: у него нет доступа к окну приложения, твоей сессии и интернету, только к тому, что разрешено ниже.
      </p>
      <pre className="code-block">{DOC_SAMPLE}</pre>
      <h3>Заголовок</h3>
      <table className="doc-table">
        <tbody>
          <tr>
            <td>
              <code>@name</code>
            </td>
            <td>Название — обязательно. По нему плагин обновляется при повторной установке</td>
          </tr>
          <tr>
            <td>
              <code>@version</code>, <code>@author</code>, <code>@description</code>
            </td>
            <td>Версия, автор и описание — показываются в списке</td>
          </tr>
          <tr>
            <td>
              <code>@permissions</code>
            </td>
            <td>
              Через запятую: <code>commands</code>, <code>messages:read</code>, <code>messages:send</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>@type theme</code>
            </td>
            <td>Для тем в CSS (или просто файл .css). Цвета меняются через переменные --accent, --panel, --bg1, --bubble-in и другие</td>
          </tr>
        </tbody>
      </table>
      <h3>Что умеет объект fizion</h3>
      <table className="doc-table">
        <tbody>
          <tr>
            <td>
              <code>fizion.command(name, описание, fn)</code>
            </td>
            <td>
              Команда <code>/name</code>. <code>fn(args, ctx)</code> получает текст после команды и <code>ctx.chatId</code>, <code>ctx.chat</code>. Вернёшь строку — она уйдёт в чат; вернёшь <code>null</code> —
              ничего не отправится. Нужно <code>commands</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>fizion.on('message', fn)</code>
            </td>
            <td>
              Каждое новое сообщение: <code>{'{ id, chatId, chat, text, author, mine, ts }'}</code>. Нужно <code>messages:read</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>fizion.send(chatId, текст)</code>
            </td>
            <td>
              Отправить сообщение от твоего имени, не больше 5 за 10 секунд. Нужно <code>messages:send</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>fizion.panel([...])</code>
            </td>
            <td>
              Своя панель в карточке плагина: <code>{"{ type: 'title' | 'text', text }"}</code>, <code>{"{ type: 'stat', label, value }"}</code>, <code>{"{ type: 'button', label, id }"}</code>. Нажатие кнопки
              приходит в <code>fizion.on('button', id =&gt; …)</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>fizion.storage.get / set / remove / all</code>
            </td>
            <td>Свои данные плагина на этом компьютере, до 100 КБ</td>
          </tr>
          <tr>
            <td>
              <code>fizion.toast(текст)</code>, <code>fizion.log(...)</code>
            </td>
            <td>Уведомление в приложении и запись в журнал плагина (console.log тоже попадает туда)</td>
          </tr>
          <tr>
            <td>
              <code>fizion.on('ready', fn)</code>, <code>fizion.me</code>
            </td>
            <td>Плагин запущен; имя и @username того, кто пользуется приложением</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">Ошибки и вывод плагина видны в его карточке, в разделе «Журнал». Плагины хранятся на этом компьютере.</p>
    </div>
  );
}

function PluginDetail({ rec, onRemoved }: { rec: PluginRecord; onRemoved: () => void }) {
  const { runtime } = host.usePlugins();
  const rt = runtime[rec.id];
  const [showCode, setShowCode] = useState(false);
  return (
    <div className="plug-pane">
      <div className="plug-detail-head">
        <span className={`plug-icon big ${rec.kind}`}>
          <Icon name={rec.kind === 'theme' ? 'star' : 'puzzle'} size={26} />
        </span>
        <span className="grow">
          <h2>{rec.name}</h2>
          <span className="muted small">
            {rec.kind === 'theme' ? 'Тема' : 'Плагин'} · версия {rec.version}
            {rec.author && ` · ${rec.author}`}
          </span>
        </span>
        <Toggle checked={rec.enabled} onChange={(v) => host.setEnabled(rec.id, v)} label={rec.enabled ? 'Выключить плагин' : 'Включить плагин'} />
      </div>
      {rec.description && <p>{rec.description}</p>}
      <div className={`plug-status ${rt?.status ?? 'stopped'}`}>
        {rt?.status === 'running' ? 'Работает' : rt?.status === 'error' ? 'Ошибка — смотри журнал' : 'Выключен'}
      </div>
      {!!rt?.panel.length && (
        <div className="plug-panel">
          {rt.panel.map((it, i) =>
            it.type === 'title' ? (
              <div key={i} className="cat">
                {it.text}
              </div>
            ) : it.type === 'stat' ? (
              <div key={i} className="plug-stat">
                <span className="ellipsis">{it.label}</span>
                <b>{it.value}</b>
              </div>
            ) : it.type === 'button' ? (
              <button key={i} type="button" className="btn small" onClick={() => host.clickButton(rec.id, it.id)}>
                {it.label}
              </button>
            ) : (
              <p key={i}>{it.text}</p>
            ),
          )}
        </div>
      )}
      {!!rt?.commands.length && (
        <>
          <div className="cat">КОМАНДЫ</div>
          <ul className="plug-cmds">
            {rt.commands.map((c) => (
              <li key={c.name}>
                <code>/{c.name}</code> <span className="muted">{c.description}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {rec.kind === 'script' && (
        <>
          <div className="cat">РАЗРЕШЕНИЯ</div>
          <PermList perms={rec.permissions} />
          <div className="cat">ЖУРНАЛ</div>
          <div className="plug-log" aria-label="Журнал плагина">
            {rt?.log.length ? (
              rt.log.map((l, i) => (
                <div key={i} className={l.level}>
                  <span className="muted">{new Date(l.ts).toLocaleTimeString('ru-RU')}</span> {l.text}
                </div>
              ))
            ) : (
              <span className="muted">Пусто</span>
            )}
          </div>
        </>
      )}
      {ONLINE && <CatalogBlock rec={rec} />}
      <div className="plug-detail-actions">
        <button type="button" className="btn small ghost" onClick={() => setShowCode((v) => !v)}>
          {showCode ? 'Скрыть код' : 'Показать код'}
        </button>
        <button
          type="button"
          className="btn small danger-outline"
          onClick={() => {
            host.remove(rec.id);
            onRemoved();
          }}
        >
          Удалить
        </button>
      </div>
      {showCode && <pre className="code-block">{rec.code}</pre>}
    </div>
  );
}

export function PluginsView() {
  const { records, runtime } = host.usePlugins();
  const [tab, setTab] = useState<Tab>(records.length ? { plugin: records[0].id } : 'examples');
  const [draft, setDraft] = useState<{ code: string; file: string; catalogId?: string } | undefined>();
  const selected = typeof tab === 'object' ? records.find((r) => r.id === tab.plugin) : undefined;

  return (
    <main className="plugins">
      <aside className="plugins-side">
        <h1>Плагины</h1>
        <div className="plugins-nav">
          <button type="button" className={tab === 'add' ? 'on' : ''} onClick={() => { setDraft(undefined); setTab('add'); }}>
            <Icon name="plus" size={16} /> Добавить плагин
          </button>
          <button type="button" className={tab === 'catalog' ? 'on' : ''} onClick={() => setTab('catalog')}>
            <Icon name="compass" size={16} /> Каталог
          </button>
          <button type="button" className={tab === 'examples' ? 'on' : ''} onClick={() => setTab('examples')}>
            <Icon name="star" size={16} /> Примеры
          </button>
          <button type="button" className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>
            <Icon name="code" size={16} /> Как написать плагин
          </button>
        </div>
        <div className="cat">УСТАНОВЛЕНЫ · {records.length}</div>
        <div className="plugins-list">
          {records.map((r) => (
            <button key={r.id} type="button" className={`plug-row ${selected?.id === r.id ? 'on' : ''}`} onClick={() => setTab({ plugin: r.id })}>
              <span className={`plug-icon ${r.kind}`}>
                <Icon name={r.kind === 'theme' ? 'star' : 'puzzle'} size={17} />
              </span>
              <span className="grow">
                <span className="strong ellipsis">{r.name}</span>
                <span className="muted small">{r.kind === 'theme' ? 'Тема' : cmdCount(runtime[r.id]?.commands.length ?? 0)}</span>
              </span>
              <span className={`plug-dot ${r.enabled ? runtime[r.id]?.status ?? 'stopped' : 'stopped'}`} title={r.enabled ? 'Включён' : 'Выключен'} />
            </button>
          ))}
          {!records.length && <p className="muted small">Пока ничего не установлено — начни с примеров.</p>}
        </div>
      </aside>
      <section className="plugins-main">
        {tab === 'add' ? (
          <AddPlugin key={draft?.file ?? 'new'} initial={draft} onInstalled={(id) => setTab({ plugin: id })} />
        ) : tab === 'examples' ? (
          <Examples
            onPick={(code, file) => {
              setDraft({ code, file });
              setTab('add');
            }}
          />
        ) : tab === 'docs' ? (
          <Docs />
        ) : tab === 'catalog' ? (
          <Catalog
            onPick={(code, file, catalogId) => {
              setDraft({ code, file, catalogId });
              setTab('add');
            }}
          />
        ) : selected ? (
          <PluginDetail key={selected.id} rec={selected} onRemoved={() => setTab(records.length > 1 ? { plugin: records.find((r) => r.id !== selected.id)!.id } : 'examples')} />
        ) : (
          <Examples onPick={(code, file) => { setDraft({ code, file }); setTab('add'); }} />
        )}
      </section>
    </main>
  );
}

/* ---------- каталог ---------- */

function Stars({ value, onRate, size = 16 }: { value: number; onRate?: (n: number) => void; size?: number }) {
  return (
    <span className={`stars ${onRate ? 'rate' : ''}`} aria-label={`Оценка ${value.toFixed(1)} из 5`}>
      {[1, 2, 3, 4, 5].map((n) =>
        onRate ? (
          <button type="button" key={n} aria-label={`${n} из 5`} className={n <= value ? 'on' : ''} onClick={() => onRate(n)} style={{ fontSize: size }}>
            ★
          </button>
        ) : (
          <span key={n} className={n <= Math.round(value) ? 'on' : ''} style={{ fontSize: size }}>
            ★
          </span>
        ),
      )}
    </span>
  );
}

function AuthorName({ userId }: { userId: string }) {
  const p = usePerson(userId);
  return <>{p?.name ?? 'автор'}</>;
}

function Catalog({ onPick }: { onPick: (code: string, file: string, catalogId: string) => void }) {
  const [items, setItems] = useState<remote.CatalogItem[] | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'top' | 'popular' | 'new'>('top');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ONLINE) return;
    remote.loadCatalog().then(setItems).catch((e) => setError((e as Error).message));
  }, []);
  if (!ONLINE)
    return (
      <div className="plug-pane">
        <h2>Каталог</h2>
        <p className="muted">Каталог плагинов работает в онлайн-режиме — войди через почту.</p>
      </div>
    );
  const shown = (items ?? [])
    .filter((i) => !q || (i.name + ' ' + i.description).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === 'new' ? b.ts - a.ts : sort === 'popular' ? b.installs - a.installs : b.rating * Math.min(1, b.votes / 3) - a.rating * Math.min(1, a.votes / 3) || b.installs - a.installs));
  return (
    <div className="plug-pane">
      <h2>Каталог</h2>
      <p className="muted">Плагины и темы от других людей в Fizion. Перед установкой видно, что плагин сможет делать. Свой плагин можно опубликовать из его карточки.</p>
      <div className="row gap-s wrap">
        <label className="search grow">
          <Icon name="search" size={16} />
          <input aria-label="Поиск в каталоге" placeholder="Поиск плагинов" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="seg">
          {(
            [
              ['top', 'Лучшие'],
              ['popular', 'Популярные'],
              ['new', 'Новые'],
            ] as const
          ).map(([k, l]) => (
            <button type="button" key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {items === null && !error && <p className="muted">Загружаю…</p>}
      {items?.length === 0 && <p className="muted">В каталоге пока пусто — опубликуй свой плагин первым.</p>}
      <div className="plug-grid">
        {shown.map((i) => (
          <div key={i.id} className="plug-card">
            <div className="plug-preview-head">
              <span className={`plug-icon ${i.kind}`}>
                <Icon name={i.kind === 'theme' ? 'star' : 'puzzle'} size={20} />
              </span>
              <span className="grow">
                <span className="strong">{i.name}</span>
                <span className="muted small">
                  v{i.version} · <AuthorName userId={i.authorId} />
                </span>
              </span>
            </div>
            <p className="muted small">{i.description}</p>
            <div className="row gap-s small">
              <Stars value={i.rating} />
              <span className="muted">
                {i.votes ? i.rating.toFixed(1) : 'нет оценок'} · {i.installs} устан.
              </span>
            </div>
            {!!i.permissions.length && <div className="muted small">Просит: {i.permissions.map((p) => PERMS[p as host.Perm]?.title ?? p).join(', ')}</div>}
            <div className="plug-card-actions">
              <button
                type="button"
                className="btn small primary"
                onClick={async () => {
                  try {
                    const code = await remote.fetchPluginCode(i);
                    onPick(code, `${i.name}.${i.kind === 'theme' ? 'css' : 'js'}`, i.id);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Посмотреть и установить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** В карточке установленного плагина: оценить (если из каталога) или опубликовать свой */
function CatalogBlock({ rec }: { rec: PluginRecord }) {
  const [stars, setStars] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  if (rec.catalogId)
    return (
      <div className="plug-panel">
        <div className="cat">ОЦЕНИ ПЛАГИН</div>
        <Stars
          value={stars}
          size={22}
          onRate={async (n) => {
            setStars(n);
            await remote.ratePlugin(rec.catalogId!, n).catch(() => undefined);
            setMsg('Спасибо за оценку!');
          }}
        />
        {msg && <span className="muted small">{msg}</span>}
      </div>
    );
  return (
    <div className="plug-panel">
      <div className="cat">КАТАЛОГ FIZION</div>
      <p className="muted small">Опубликуй плагин — его смогут найти и поставить все. Повторная публикация обновит версию в каталоге.</p>
      <button
        type="button"
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await remote.publishPlugin({ name: rec.name, version: rec.version, description: rec.description, kind: rec.kind, permissions: rec.permissions, code: rec.code, fileName: `${rec.id}.${rec.kind === 'theme' ? 'css' : 'js'}` });
            setMsg('Опубликовано в каталоге');
          } catch (e) {
            setMsg((e as Error).message);
          }
          setBusy(false);
        }}
      >
        <Icon name="upload" size={15} /> Опубликовать в каталоге
      </button>
      {msg && <span className="muted small">{msg}</span>}
    </div>
  );
}
