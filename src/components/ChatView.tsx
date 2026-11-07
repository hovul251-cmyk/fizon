import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { ME } from '../data';
import { Icon, type IconName } from '../icons';
import { startRecording, type Recording } from '../lib/recorder';
import { deniedText, isPermissionError } from '../lib/permissions';
import { isTouch } from '../lib/platform';
import * as host from '../plugins/host';
import { actions, setUi, useStore } from '../store';
import { ONLINE } from '../lib/appwrite';
import * as remote from '../online/remote';
import { openFile } from '../online/crypto';
import { WatchArea, WatchButton } from './Watch';
import * as social from '../online/social';
import { ForwardModal } from './Forward';
import { AttachMenu, GameView, PollComposer, PollView, RoundRecorder, RoundVideo, sendGame } from './Extras';
import { ChatBgSettings } from './ChatBg';
import { LINK_RE, openFizionLink, parseFizionLink } from './Channels';
import { StickerMessage, StickerPicker } from './Stickers';
import type { Attachment, Message, Server } from '../types';
import { Avatar, BackButton, formatDay, formatTime, IconButton, Modal, onAvatarClick, openCard, usePerson } from './common';

const EMOJIS = ['🔥', '👍', '😂', '❤️', '😮', '🎉', '👀', '💜', '✨', '🙏', '😎', '🤝', '🎮', '🎬', '💯', '😢'];
const EMPTY: Message[] = [];
const presenceText = (p: string) => ({ online: 'в сети', idle: 'отошёл', dnd: 'не беспокоить', offline: 'не в сети' })[p] ?? '';

const isService = (m: Message) => !!m.attachment?.service || (!m.attachment && /^📞 (Звонок · |Пропущенный звонок$)/.test(m.text));

function renderText(text: string, myName: string): ReactNode[] {
  // ссылки: приглашения и каналы Neon открываются прямо в приложении, остальные — в браузере
  return text.split(LINK_RE).flatMap<ReactNode>((chunk, j) => {
    if (j % 2 === 1) {
      const ours = parseFizionLink(chunk);
      return [
        <a
          key={`l${j}`}
          className={`msg-link ${ours ? 'fizion-link' : ''}`}
          href={chunk.startsWith('fizion://') ? undefined : chunk}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (openFizionLink(chunk)) e.preventDefault();
          }}
        >
          {ours ? (ours.kind === 'invite' ? '🔗 Приглашение в сообщество' : `📣 Канал @${ours.value}`) : chunk}
        </a>,
      ];
    }
    return renderMentions(chunk, myName, j);
  });
}

function renderMentions(text: string, myName: string, j: number): ReactNode[] {
  return text.split(/(@[\p{L}\p{N}_.]+|#[\p{L}\p{N}_-]+)/u).map((part, k) => {
    const i = `${j}-${k}`;
    if (part.startsWith('@') && part.length > 1) return <span key={i} className={`mention ${part.slice(1).toLowerCase() === myName.toLowerCase() ? 'me' : ''}`}>{part}</span>;
    if (part.startsWith('#') && part.length > 1) return <span key={i} className="mention">{part}</span>;
    return part;
  });
}

/** Голосовое сообщение: кнопка, «волна» и время */
function VoiceNote({ a }: { a: Attachment }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  // «волна» из имени файла — у каждого голосового своя, но всегда одинаковая
  const bars = useMemo(() => Array.from({ length: 32 }, (_, i) => 25 + ((a.name.charCodeAt(i % a.name.length) * (i + 7)) % 70)), [a.name]);
  const t = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };
  return (
    <div className="voice-note">
      <button type="button" className="vn-play" aria-label={playing ? 'Пауза' : 'Слушать голосовое'} onClick={toggle}>
        <Icon name={playing ? 'pause' : 'play'} size={18} />
      </button>
      <div
        className="vn-wave"
        onClick={(e) => {
          const el = audio.current;
          if (!el || !dur) return;
          const r = e.currentTarget.getBoundingClientRect();
          el.currentTime = ((e.clientX - r.left) / r.width) * dur;
        }}
      >
        {bars.map((h, i) => (
          <i key={i} style={{ height: `${h}%` }} className={dur && i / bars.length < pos / dur ? 'on' : ''} />
        ))}
      </div>
      <span className="vn-time">{t(playing || pos ? pos : dur)}</span>
      <audio
        ref={audio}
        src={a.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          // у записей WebM длительность иногда неизвестна до конца — узнаём её перемоткой
          if (Number.isFinite(d)) setDur(d);
          else {
            const el = e.currentTarget;
            el.currentTime = 1e9;
            el.ontimeupdate = () => {
              el.ontimeupdate = null;
              setDur(el.duration);
              el.currentTime = 0;
            };
          }
        }}
      />
    </div>
  );
}

/** Расшифрованные файлы: ссылка → blob-адрес (живёт, пока открыт Neon) */
const openedFiles = new Map<string, Promise<string>>();

/** Адрес вложения для показа. Зашифрованный файл скачивается и расшифровывается здесь, на устройстве. */
function useAttachmentUrl(a: Attachment): { url?: string; error: boolean } {
  const [state, setState] = useState<{ url?: string; error: boolean }>(() => ({ url: a.key ? undefined : a.url, error: false }));
  useEffect(() => {
    if (!a.key || !a.url) return setState({ url: a.url, error: false });
    let alive = true;
    const src = a.url;
    const fk = a.key;
    if (!openedFiles.has(src))
      openedFiles.set(
        src,
        fetch(src)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then((buf) => openFile(buf, fk))
          .then((plain) => URL.createObjectURL(new Blob([plain], { type: a.type || 'application/octet-stream' }))),
      );
    openedFiles
      .get(src)!
      .then((url) => alive && setState({ url, error: false }))
      .catch(() => {
        openedFiles.delete(src);
        if (alive) setState({ url: undefined, error: true });
      });
    return () => {
      alive = false;
    };
  }, [a.url, a.key, a.type]);
  return state;
}

/** «Сегодня в 14:05» / «Вчера в 9:12» / «03.11.2026 14:05» — как в Discord */
function formatDayTime(ts: number) {
  const d = new Date(ts);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
  const t = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (day === today) return `Сегодня в ${t}`;
  if (day === today - 86_400_000) return `Вчера в ${t}`;
  return `${d.toLocaleDateString('ru-RU')} ${t}`;
}

function AttachmentView({ a: raw, chatId, msgId, fresh, pending }: { a: Attachment; chatId: string; msgId: string; fresh: boolean; pending?: boolean }) {
  const opened = useAttachmentUrl(raw);
  if (raw.sticker) return <StickerMessage a={raw} />;
  if (raw.poll) return <PollView poll={raw.poll} chatId={chatId} messageId={msgId} pending={pending} />;
  if (raw.game) return <GameView g={raw.game} fresh={fresh} />;
  if (raw.key && !opened.url)
    return (
      <div className="attachment">
        <Icon name="lock" /> {raw.name} · {opened.error ? 'не удалось открыть' : 'расшифровываю…'}
      </div>
    );
  const a = { ...raw, url: opened.url };
  if (a.url && a.type?.startsWith('audio/')) return <VoiceNote a={a} />;
  if (a.url && a.type?.startsWith('image/'))
    return (
      <a className="att-media" href={a.url} target="_blank" rel="noreferrer">
        <img src={a.url} alt={a.name} loading="lazy" />
      </a>
    );
  if (a.url && a.round) return <RoundVideo url={a.url} />;
  if (a.url && a.type?.startsWith('video/'))
    return (
      <div className="att-media">
        <video src={a.url} controls preload="metadata" />
      </div>
    );
  const ext = (a.name.split('.').pop() ?? '').toUpperCase().slice(0, 4);
  const body = (
    <>
      <span className={`file-ico ext-${ext.toLowerCase()}`}>{ext || 'FILE'}</span>
      <span className="file-info">
        <span className="file-name ellipsis">{a.name}</span>
        <span className="muted small">
          {a.size}
          {raw.key ? ' · зашифрован' : ''}
        </span>
      </span>
      {a.url && (
        <span className="file-dl" aria-hidden="true">
          <Icon name="download" size={18} />
        </span>
      )}
    </>
  );
  return a.url ? (
    <a className="attachment file file-card" href={a.url} target={raw.key ? undefined : '_blank'} rel="noreferrer" download={a.name} title="Скачать">
      {body}
    </a>
  ) : (
    <div className="attachment">{body}</div>
  );
}

const REASONS = ['Спам или реклама', 'Оскорбления', 'Неприемлемый контент', 'Мошенничество', 'Другое'];

interface RowProps {
  /** Можно пожаловаться модераторам (сообщения других в сообществах) */
  reportable?: boolean;
  chatId: string;
  msg: Message;
  head: boolean;
  badge?: string;
  replyTo?: Message;
  myName: string;
  onReply: (m: Message) => void;
  /** Моё сообщение прочитано собеседником */
  read?: boolean;
  /** В группе: сколько человек прочитали */
  readers?: number;
  canPin?: boolean;
  pinned?: boolean;
  onForward: (m: Message) => void;
  /** Автор заблокирован — сообщение свёрнуто */
  hiddenAuthor?: boolean;
}

const MessageRow = memo(function MessageRow({ chatId, msg, head, badge, replyTo, myName, onReply, reportable, read, readers, canPin, pinned, onForward, hiddenAuthor }: RowProps) {
  const [reveal, setReveal] = useState(false);
  const isBot = useStore((s) => !!s.users[msg.authorId]?.bot);
  const [reporting, setReporting] = useState(false);
  const author = usePerson(msg.authorId);
  const replyAuthor = usePerson(replyTo?.authorId ?? ME);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.text);
  const [picker, setPicker] = useState(false);
  // на телефоне действия открываются нажатием на сообщение
  const [sel, setSel] = useState(false);
  if (!author) return null;
  const mine = msg.authorId === ME;
  // служебные сообщения программы (звонки, подарки, события) — по центру, как в Telegram
  if (isService(msg))
    return (
      <div className="msg-service" data-id={msg.id}>
        <span>
          {msg.attachment?.service ? msg.text : `${msg.text.replace(/^📞\s*/, mine ? '📞 Исходящий · ' : '📞 Входящий · ').replace(/· Звонок · /, '· ')}`}
          <time>{new Date(msg.ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</time>
        </span>
      </div>
    );

  const saveEdit = () => {
    const t = draft.trim();
    if (t && t !== msg.text) actions.editMessage(chatId, msg.id, t);
    setEditing(false);
  };

  const pinged = !mine && msg.text.toLowerCase().includes('@' + myName.toLowerCase());
  // как в Discord: у всех сообщений слева аватарка и имя, свои — тоже
  const flat = useStore((s) => (s.settings.messageStyle ?? 'flat') === 'flat');
  const showGutter = !mine || flat;
  if (hiddenAuthor && !reveal)
    return (
      <div className="msg theirs hidden-msg" id={`m-${msg.id}`}>
        <div className="msg-gutter" />
        <button type="button" className="plain muted small" onClick={() => setReveal(true)}>
          <Icon name="block" size={13} /> Сообщение от заблокированного · показать
        </button>
      </div>
    );
  return (
    <div id={`m-${msg.id}`} className={`msg ${(msg.attachment?.sticker || msg.attachment?.round || msg.attachment?.game) && !msg.text ? 'sticker-msg' : ''} ${pinned ? 'pinned' : ''} ${sel ? 'sel' : ''} ${mine ? 'mine' : 'theirs'} ${head ? 'head' : ''} ${msg.pending ? 'pending' : ''} ${pinged ? 'ping' : ''}`}>
      {showGutter && (
        <div className="msg-gutter">
          {head ? (
            <button type="button" className="plain" onClick={(e) => onAvatarClick(msg.authorId, e)} aria-label={`Профиль ${author.name}`}>
              <Avatar person={author} size={36} showPresence={false} />
            </button>
          ) : (
            <time className="gutter-time">{new Date(msg.ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</time>
          )}
        </div>
      )}
      <div className="msg-body">
        <div onClick={(e) => isTouch() && !(e.target as HTMLElement).closest('button, a, audio, video') && setSel((v) => !v)} className={`bubble ${msg.attachment && !msg.text && !msg.attachment.type?.startsWith('audio/') ? 'media-only' : ''}`}>
          {head && showGutter && (
            <div className="msg-head">
              <button type="button" className="name strong" style={author.nameStyle} onClick={(e) => openCard(msg.authorId, e)}>
                {author.name}
              </button>
              {isBot ? <span className="role-badge bot-badge">БОТ</span> : badge && <span className="role-badge">{badge}</span>}
              {flat && <span className="msg-head-time">{formatDayTime(msg.ts)}</span>}
            </div>
          )}
          {replyTo && (
            <div className="msg-reply-ref">
              <span style={replyAuthor?.nameStyle} className="strong ellipsis">
                {replyAuthor?.name}
              </span>
              <span className="ellipsis">{replyTo.text || 'Вложение'}</span>
            </div>
          )}
          {msg.attachment && <AttachmentView a={msg.attachment} chatId={chatId} msgId={msg.id} fresh={Date.now() - msg.ts < 4000} pending={msg.pending} />}
          {editing ? (
            <div className="msg-edit">
              <textarea
                className="input"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    saveEdit();
                  }
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
              <span className="small">Enter — сохранить · Esc — отмена</span>
            </div>
          ) : (
            msg.text && (
              <div className="msg-text">
                {renderText(msg.text, myName)}
                <span className="msg-meta-space" />
              </div>
            )
          )}
          <span className="msg-meta">
            {msg.encrypted && <Icon name="lock" size={11} />}
            {msg.edited && 'изменено · '}
            {formatTime(msg.ts)}
            {mine && (read ? <Icon name="checks" size={15} className="read-tick" /> : <Icon name="check" size={13} className={msg.pending ? 'pending-tick' : ''} />)}
            {mine && readers ? <span className="readers">{readers}</span> : null}
          </span>
        </div>
        {msg.failed && (
          <button type="button" className="msg-failed" onClick={() => actions.retry(chatId, msg.id)}>
            Не отправлено — нажми, чтобы повторить
          </button>
        )}
        {msg.reactions.length > 0 && (
          <div className="reactions">
            {msg.reactions.map((r) => (
              <button type="button" key={r.emoji} className={`reaction ${r.users.includes(ME) ? 'on' : ''}`} onClick={() => actions.toggleReaction(chatId, msg.id, r.emoji)}>
                {r.emoji} {r.users.length}
              </button>
            ))}
          </div>
        )}
      {!editing && (
          <div className="msg-actions">
            {['🔥', '👍', '😂'].map((e) => (
              <button type="button" key={e} className="quick-react" aria-label={`Реакция ${e}`} onClick={() => actions.toggleReaction(chatId, msg.id, e)}>
                {e}
              </button>
            ))}
            <IconButton icon="smile" label="Добавить реакцию" size={28} onClick={() => setPicker((v) => !v)} />
            <IconButton icon="reply" label="Ответить" size={28} onClick={() => onReply(msg)} />
            <IconButton icon="forward" label="Переслать" size={28} onClick={() => onForward(msg)} />
            {canPin && <IconButton icon="pin" label={pinned ? 'Открепить' : 'Закрепить'} size={28} active={pinned} onClick={() => void social.pin(chatId, msg.id, !pinned)} />}
            {mine && <IconButton icon="edit" label="Изменить" size={28} onClick={() => { setDraft(msg.text); setEditing(true); }} />}
            {mine && <IconButton icon="trash" label="Удалить" size={28} danger onClick={() => actions.deleteMessage(chatId, msg.id)} />}
          {reportable && !mine && <IconButton icon="flag" label="Пожаловаться" size={28} onClick={() => setReporting((v) => !v)} />}
          {reporting && (
            <div className="emoji-pop report-pop" onMouseLeave={() => setReporting(false)}>
              <div className="muted small">На что жалуешься?</div>
              {REASONS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={async () => {
                    setReporting(false);
                    setUi({ toast: { text: await actions.report(msg.id, r), id: Date.now() } });
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
            {picker && (
              <div className="emoji-pop" onMouseLeave={() => setPicker(false)}>
                {EMOJIS.map((e) => (
                  <button type="button" key={e} onClick={() => { actions.toggleReaction(chatId, msg.id, e); setPicker(false); }}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

interface Props {
  chatId: string;
  /** Только чтение (канал для подписчика): вместо поля ввода — эта плашка */
  readOnly?: ReactNode;
  title: string;
  icon: IconName | 'avatar' | 'community';
  avatarUserId?: string;
  /** Значок сообщества в шапке комнаты */
  community?: { short: string; color: string };
  topic?: string;
  placeholder: string;
  ownerId?: string;
  showMembersToggle?: boolean;
  crumb?: string;
  onInvite?: () => void;
  /** Личная переписка: кнопки аудио- и видеозвонка в шапке */
  onCall?: (video: boolean) => void;
  /** Комната сообщества: мут, медленный режим, жалобы */
  server?: Server;
  /** Личная переписка зашифрована сквозным шифрованием */
  encrypted?: boolean;
  /** Своя кнопка в шапке (например, участники группы) */
  extraTools?: ReactNode;
  intro: ReactNode;
}

export function ChatView({ chatId, title, icon, avatarUserId, community, topic, placeholder, ownerId, showMembersToggle, crumb, onInvite, onCall, server, encrypted, extraTools, intro, readOnly }: Props) {
  const frozen = useStore((s) => s.ui.frozen);
  const messages = useStore((s) => s.messages[chatId] ?? EMPTY);
  const atStart = useStore((s) => !!s.ui.chatEnd[chatId]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const prepend = useRef<{ height: number; top: number } | null>(null);
  const search = useStore((s) => s.ui.search);
  const showMembers = useStore((s) => s.ui.showMembers);
  const myName = useStore((s) => s.profile.displayName);
  const density = useStore((s) => s.settings.density);
  const avatarPerson = usePerson(avatarUserId ?? ME);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Message | null>(null);
  const [picker, setPicker] = useState(false);
  const [stickers, setStickers] = useState(false);
  const [menu, setMenu] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const bg = useStore((s) => s.settings.chatBgs?.[chatId] ?? s.settings.chatBg ?? null);
  const [pollOpen, setPollOpen] = useState(false);
  const [roundOpen, setRoundOpen] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const plugins = host.usePlugins();
  useSyncExternalStore(social.onSocial, social.socialVersion);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [pinIdx, setPinIdx] = useState(0);
  const privateChat = chatId.startsWith('dm:') || chatId.startsWith('g:');
  const dmPeer = chatId.startsWith('dm:') ? chatId.slice(3) : null;
  const iBlocked = !!dmPeer && social.isBlocked(dmPeer);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // поиск: сначала по загруженному, а онлайн — ещё и по всей истории на сервере
  const [serverHits, setServerHits] = useState<Message[]>([]);
  useEffect(() => {
    const q = search.trim();
    setServerHits([]);
    if (!ONLINE || q.length < 2) return;
    const t = window.setTimeout(() => {
      remote
        .searchMessages(q, chatId)
        .then((hits) => setServerHits(hits.map((h) => h.msg)))
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(t);
  }, [search, chatId]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    const local = messages.filter((m) => m.text.toLowerCase().includes(q));
    const have = new Set(local.map((m) => m.id));
    return [...local, ...serverHits.filter((m) => !have.has(m.id))].sort((a, b) => a.ts - b.ts);
  }, [messages, search, serverHits]);

  // мут и медленный режим в комнатах сообщества
  const [now, setNow] = useState(Date.now());
  const isMod = !!server && (server.ownerId === ME || !!server.roles.find((r) => r.id === server.members.find((m) => m.userId === ME)?.roleId && (r.perms.admin || r.perms.manageMessages || r.perms.kickBan)));
  const mutedUntil = server && !isMod ? (server.mutes?.[ME] ?? 0) : 0;
  const slow = !isMod ? (server?.channels.find((c) => c.id === chatId)?.slowmode ?? 0) : 0;
  const lastMine = useMemo(() => [...messages].reverse().find((m) => m.authorId === ME)?.ts ?? 0, [messages]);
  const slowLeft = slow ? Math.ceil((lastMine + slow * 1000 - now) / 1000) : 0;
  const blocked = mutedUntil > now ? 'muted' : slowLeft > 0 ? 'slow' : null;
  useEffect(() => {
    if (!mutedUntil && !slow) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [mutedUntil, slow]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prepend.current) {
      // подгрузили старые сообщения сверху — остаёмся на том же месте
      el.scrollTop = el.scrollHeight - prepend.current.height + prepend.current.top;
      prepend.current = null;
    } else el.scrollTop = el.scrollHeight;
  }, [shown.length, chatId]);

  const onScroll = async () => {
    const el = scroller.current;
    if (!el || el.scrollTop > 120 || atStart || loadingOlder || search) return;
    setLoadingOlder(true);
    prepend.current = { height: el.scrollHeight, top: el.scrollTop };
    const n = await actions.loadOlder(chatId);
    if (!n) prepend.current = null;
    setLoadingOlder(false);
  };

  useEffect(() => {
    setReply(null);
    setText('');
    setPinIdx(0);
    input.current?.focus();
    actions.loadChat(chatId);
    void social.loadPins(chatId);
    void social.loadReads(chatId);
    return () => social.stoppedTyping();
  }, [chatId]);

  // «прочитано»: чат открыт, окно на экране — отмечаем последнее чужое сообщение
  const lastTheirs = useMemo(() => [...messages].reverse().find((m) => m.authorId !== ME && !m.pending)?.ts ?? 0, [messages]);
  useEffect(() => {
    if (!privateChat || !lastTheirs) return;
    const mark = () => document.visibilityState === 'visible' && document.hasFocus() && social.markRead(chatId, lastTheirs);
    mark();
    window.addEventListener('focus', mark);
    document.addEventListener('visibilitychange', mark);
    return () => {
      window.removeEventListener('focus', mark);
      document.removeEventListener('visibilitychange', mark);
    };
  }, [chatId, lastTheirs, privateChat]);
  const readTs = privateChat ? social.readUpTo(chatId) : 0;
  const isGroup = chatId.startsWith('g:');
  const canPin = privateChat || isMod;
  const pinIds = social.pinsOf(chatId);
  const pinnedSet = new Set(pinIds);
  const typingNow = social.typingIn(chatId);

  const commands = useMemo(() => host.listCommands(plugins), [plugins]);
  const cmdQuery = /^\/([\p{L}\p{N}_-]*)$/u.exec(text)?.[1]?.toLowerCase();
  const cmdHints = cmdQuery !== undefined ? commands.filter((c) => c.name.startsWith(cmdQuery)).slice(0, 8) : [];

  const send = async () => {
    const t = text.trim();
    if (!t || blocked) return;
    const replyId = reply?.id;
    setText('');
    setReply(null);
    social.stoppedTyping();
    // «/команда» из плагина: в чат уходит то, что вернул плагин
    if (t.startsWith('/')) {
      const out = await host.runCommand(t, chatId);
      if (out !== null) {
        if (out.trim()) actions.send(chatId, out.trim(), replyId);
        return;
      }
    }
    actions.send(chatId, t, replyId);
  };

  const record = async () => {
    try {
      setRecording(await startRecording());
    } catch (e) {
      setUi({ toast: { text: isPermissionError(e) ? deniedText('microphone') : 'Не удалось включить микрофон — проверь, что он подключён', id: Date.now() } });
    }
  };
  const finishRecording = async (send: boolean) => {
    const r = recording;
    setRecording(null);
    if (!r) return;
    if (!send) return r.cancel();
    const f = await r.stop();
    if (f) void actions.sendFile(chatId, f, '');
  };
  // ушли из чата во время записи — запись выбрасываем
  const recRef = useRef<Recording | null>(null);
  recRef.current = recording;
  useEffect(
    () => () => {
      recRef.current?.cancel();
      setRecording(null);
    },
    [chatId],
  );

  const [dragOver, setDragOver] = useState(false);
  /** Отправить один или несколько файлов (текст из поля уходит подписью к первому) */
  const attach = (f: File | File[]) => {
    const list = Array.isArray(f) ? f : [f];
    list.slice(0, 10).forEach((x, i) => void actions.sendFile(chatId, x, i === 0 ? text.trim() : ''));
    if (list.length > 10) actions.toast('За раз можно отправить до 10 файлов');
    setText('');
  };

  const rows: ReactNode[] = [];
  let prev: Message | undefined;
  for (const m of shown) {
    const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
    if (newDay)
      rows.push(
        <div className="day-sep" key={'d' + m.id}>
          <span />
          {formatDay(m.ts)}
          <span />
        </div>,
      );
    const head = newDay || !prev || prev.authorId !== m.authorId || m.ts - prev.ts > 5 * 60_000 || !!m.replyTo;
    rows.push(
      <MessageRow
        key={m.id}
        reportable={ONLINE && !!server}
        chatId={chatId}
        msg={m}
        head={head}
        badge={ownerId && m.authorId === ownerId ? 'ВЛАДЕЛЕЦ' : undefined}
        replyTo={m.replyTo ? byId.get(m.replyTo) : undefined}
        myName={myName}
        onReply={(x) => {
          setReply(x);
          input.current?.focus();
        }}
        read={m.authorId === ME && !m.pending && readTs >= m.ts}
        readers={isGroup && m.authorId === ME ? social.readCount(chatId, m.ts) : undefined}
        canPin={canPin}
        pinned={pinnedSet.has(m.id)}
        onForward={setForwarding}
        hiddenAuthor={m.authorId !== ME && social.isBlocked(m.authorId)}
      />,
    );
    prev = m;
  }

  return (
    <main
      className={`chat density-${density}`}
      data-bg={bg ? '1' : undefined}
      style={bg ? ({ '--chat-bg': `url("${bg.url.replace(/"/g, '%22')}")`, '--chat-bg-dim': bg.dim / 100, '--chat-bg-blur': `${bg.blur}px` } as CSSProperties) : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        setDragOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) {
          e.preventDefault();
          attach(files);
        }
      }}
    >
      {dragOver && (
        <div className="drop-zone" aria-hidden="true">
          <Icon name="upload" size={42} />
          <b>Отпусти, чтобы отправить</b>
          <span>Любые файлы до 50 МБ, до 10 за раз{privateChat ? ' · в личных и группах файлы шифруются' : ''}</span>
        </div>
      )}
      <header className="chat-head">
        <BackButton />
        {icon === 'avatar' && avatarPerson ? (
          <button type="button" className="plain" onClick={(e) => onAvatarClick(avatarPerson.id, e)} aria-label={`Профиль ${avatarPerson.name}`}>
            <Avatar person={avatarPerson} size={38} border="var(--panel)" />
          </button>
        ) : icon === 'community' && community ? (
          <span className="community-badge big" style={{ background: community.color }}>
            {community.short}
          </span>
        ) : (
          <span className="head-icon">
            <Icon name={icon as IconName} />
          </span>
        )}
        <span className="chat-head-title">
          <span className="strong ellipsis">
            {title}
            {encrypted && (
              <span className="e2e-badge" title={chatId.startsWith('g:') ? 'Сквозное шифрование: читать могут только участники группы' : 'Сквозное шифрование: прочитать переписку можете только вы двое'}>
                <Icon name="lock" size={12} />
              </span>
            )}
          </span>
          <span className="muted small ellipsis">{[crumb, topic].filter(Boolean).join(' · ') || (icon === 'avatar' && avatarPerson ? presenceText(avatarPerson.presence) : '')}</span>
        </span>
        <div className="chat-head-tools">
          <WatchButton chatId={chatId} />
          <IconButton icon="image" label="Фон этого чата" onClick={() => setBgOpen(true)} />
          {extraTools}
          {onCall && <IconButton icon="phone" label="Позвонить" onClick={() => onCall(false)} />}
          {onCall && <IconButton icon="video" label="Видеозвонок" onClick={() => onCall(true)} />}
          {onInvite && <IconButton icon="userPlus" label="Пригласить" onClick={onInvite} />}
          {showMembersToggle && <IconButton icon="users" label="Люди" active={showMembers} onClick={() => setUi({ showMembers: !showMembers })} />}
          <label className="search">
            <Icon name="search" size={16} />
            <input aria-label="Поиск по сообщениям" placeholder="Поиск" value={search} onChange={(e) => setUi({ search: e.target.value })} />
            {search && (
              <button type="button" className="plain" aria-label="Очистить поиск" onClick={() => setUi({ search: '' })}>
                <Icon name="close" size={14} />
              </button>
            )}
          </label>
        </div>
      </header>
      <WatchArea chatId={chatId} />
      {pinIds.length > 0 && (
        <PinnedBar
          ids={pinIds}
          index={pinIdx}
          byId={byId}
          onOpen={(id) => {
            const el = document.getElementById(`m-${id}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el?.classList.add('flash');
            window.setTimeout(() => el?.classList.remove('flash'), 1400);
            setPinIdx((i) => (i + 1) % pinIds.length);
          }}
          onUnpin={canPin ? (id) => void social.pin(chatId, id, false) : undefined}
        />
      )}
      <div className="messages" ref={scroller} onScroll={() => void onScroll()}>
        <div className="messages-spacer" />
        {loadingOlder && <div className="older-loading muted small">Загружаю старые сообщения…</div>}
        {!search && (atStart || messages.length < 30) && <div className="chat-intro">{intro}</div>}
        {search && <div className="search-info muted small">Найдено: {shown.length}{ONLINE ? ' — ищу и в старых сообщениях на сервере' : ''}</div>}
        {rows}
      </div>
      <div className="composer-wrap">
        {reply && (
          <div className="reply-bar">
            Ответ на сообщение <b>{byId.get(reply.id)?.text.slice(0, 60)}</b>
            <button type="button" className="plain" aria-label="Отменить ответ" onClick={() => setReply(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {cmdHints.length > 0 && (
          <div className="cmd-hints" role="listbox" aria-label="Команды плагинов">
            {cmdHints.map((c) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={c.pluginId + c.name}
                onClick={() => {
                  setText(`/${c.name} `);
                  input.current?.focus();
                }}
              >
                <code>/{c.name}</code>
                <span className="muted ellipsis">{c.description}</span>
                <span className="muted small ml-auto">{c.pluginName}</span>
              </button>
            ))}
          </div>
        )}
        {typingNow.length > 0 && <TypingLine ids={typingNow} />}
        {iBlocked && dmPeer && (
          <div className="composer-note">
            <Icon name="block" size={15} />
            Ты заблокировал этого человека — он не может тебе писать и звонить.
            <button type="button" className="btn small" onClick={() => void social.unblock(dmPeer)}>
              Разблокировать
            </button>
          </div>
        )}
        {blocked && (
          <div className="composer-note">
            <Icon name={blocked === 'muted' ? 'lock' : 'shield'} size={15} />
            {blocked === 'muted'
              ? `Модератор запретил тебе писать до ${new Date(mutedUntil).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
              : `Медленный режим: следующее сообщение через ${slowLeft} с`}
          </div>
        )}
        {frozen ? (
          <div className="composer-readonly">
            <Icon name="snow" size={16} /> Аккаунт заморожен администрацией Neon — читать можно, писать нельзя.
          </div>
        ) : readOnly ? (
          <div className="composer-readonly">{readOnly}</div>
        ) : recording ? (
          <div className="composer recording">
            <span className="rec-dot" />
            <RecTimer since={recording.startedAt} />
            <span className="muted grow">Идёт запись голосового…</span>
            <button type="button" className="btn ghost" onClick={() => void finishRecording(false)}>
              Отмена
            </button>
            <button type="button" className="send-btn on" aria-label="Отправить голосовое" onClick={() => void finishRecording(true)}>
              <Icon name="send" size={18} />
            </button>
          </div>
        ) : (
        <div className={`composer ${reply ? 'with-reply' : ''}`}>
          <div className="rel">
            <IconButton icon="plusCircle" label="Прикрепить" active={menu} onClick={() => setMenu((v) => !v)} />
            {menu && (
              <AttachMenu
                onClose={() => setMenu(false)}
                onFile={() => file.current?.click()}
                onPoll={() => setPollOpen(true)}
                onRound={() => setRoundOpen(true)}
                onGame={(k) => !blocked && !iBlocked && sendGame(chatId, k)}
              />
            )}
          </div>
          <input ref={file} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) attach(f); e.target.value = ''; }} />
          <textarea
            ref={input}
            rows={1}
            aria-label="Сообщение"
            disabled={blocked === 'muted' || iBlocked}
            placeholder={blocked === 'muted' || iBlocked ? 'Писать пока нельзя' : placeholder}
            value={text}
            maxLength={2000}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value) social.iAmTyping(chatId);
            }}
            onPaste={(e) => {
              const f = e.clipboardData.files[0];
              if (f) {
                e.preventDefault();
                attach(f);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                // недописанная команда — Enter подставляет первую подсказку
                if (cmdHints.length && cmdQuery !== undefined && !commands.some((c) => c.name === cmdQuery)) setText(`/${cmdHints[0].name} `);
                else void send();
              }
              if (e.key === 'Escape') setReply(null);
            }}
          />
          <div className="rel composer-tools">
            <IconButton icon="sticker" label="Стикеры" active={stickers} onClick={() => (setStickers((v) => !v), setPicker(false))} />
            <IconButton icon="smile" label="Эмодзи" onClick={() => (setPicker((v) => !v), setStickers(false))} />
            {text.trim() ? (
              <button type="button" className="send-btn on" aria-label="Отправить" onClick={() => void send()}>
                <Icon name="send" size={18} />
              </button>
            ) : (
              <button type="button" className="send-btn" aria-label="Записать голосовое" title="Записать голосовое" onClick={() => void record()}>
                <Icon name="mic" size={18} />
              </button>
            )}
            {stickers && <StickerPicker chatId={chatId} onClose={() => setStickers(false)} />}
            {picker && (
              <div className="emoji-pop up">
                {EMOJIS.map((e) => (
                  <button type="button" key={e} onClick={() => { setText((t) => t + e); setPicker(false); input.current?.focus(); }}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        )}
      </div>
      {bgOpen && (
        <Modal onClose={() => setBgOpen(false)} width={520} label="Фон этого чата" className="composer-modal">
          <div className="modal-head">
            <h2>Фон этого чата</h2>
            <p className="muted small">Только для «{title}». Общий фон для всех чатов — в настройках → Внешний вид.</p>
          </div>
          <ChatBgSettings chatKey={chatId} />
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={() => setBgOpen(false)}>
              Готово
            </button>
          </div>
        </Modal>
      )}
      {pollOpen && <PollComposer chatId={chatId} onClose={() => setPollOpen(false)} />}
      {roundOpen && <RoundRecorder chatId={chatId} onClose={() => setRoundOpen(false)} />}
      {forwarding && <ForwardModal msg={forwarding} onClose={() => setForwarding(null)} />}
    </main>
  );
}

function TypingLine({ ids }: { ids: string[] }) {
  const first = usePerson(ids[0]);
  const name = first?.name ?? 'Кто-то';
  return (
    <div className="typing-line" aria-live="polite">
      <span className="typing-dots">
        <i />
        <i />
        <i />
      </span>
      {ids.length === 1 ? `${name} печатает…` : `${name} и ещё ${ids.length - 1} печатают…`}
    </div>
  );
}

function PinnedBar({ ids, index, byId, onOpen, onUnpin }: { ids: string[]; index: number; byId: Map<string, Message>; onOpen: (id: string) => void; onUnpin?: (id: string) => void }) {
  const id = ids[ids.length - 1 - (index % ids.length)];
  const m = byId.get(id);
  const author = usePerson(m?.authorId ?? ME);
  return (
    <div className="pinned-bar">
      <button type="button" className="plain pinned-main" onClick={() => onOpen(id)}>
        <Icon name="pin" size={16} />
        <span className="grow">
          <span className="pinned-title">Закреплено{ids.length > 1 ? ` · ${(index % ids.length) + 1} из ${ids.length}` : ''}</span>
          <span className="ellipsis small">{m ? `${author?.name ?? ''}: ${m.text || (m.attachment ? '📎 ' + m.attachment.name : '')}` : 'Сообщение выше — прокрути, чтобы увидеть'}</span>
        </span>
      </button>
      {onUnpin && (
        <button type="button" className="plain" aria-label="Открепить" title="Открепить" onClick={() => onUnpin(id)}>
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

function RecTimer({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.floor((now - since) / 1000);
  return (
    <span className="rec-time">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </span>
  );
}
