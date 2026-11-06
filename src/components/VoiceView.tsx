import { useEffect, useRef, useSyncExternalStore } from 'react';
import * as social from '../online/social';
import { ME } from '../data';
import { Icon } from '../icons';
import { ONLINE } from '../lib/appwrite';
import { canShareScreen } from '../lib/platform';
import { actions, useStore } from '../store';
import type { Channel, Server, VideoTrackLike } from '../types';
import { Avatar, BackButton, openCard, usePerson, useSpeaking } from './common';

function Video({ track, mirror }: { track: VideoTrackLike; mirror: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current!;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} className={`tile-video ${mirror ? 'mirror' : ''}`} autoPlay playsInline muted />;
}

function Tile({ userId, speaking }: { userId: string; speaking: boolean }) {
  const p = usePerson(userId);
  const muted = useStore((s) => (userId === ME ? s.ui.muted : false));
  const video = useStore((s) => s.ui.videos[userId]);
  const demoShare = useStore((s) => !ONLINE && userId === ME && s.ui.sharing);
  if (!p) return null;
  return (
    <button type="button" className={`tile ${speaking ? 'speaking' : ''} ${video?.screen || demoShare ? 'sharing' : ''}`} onClick={(e) => openCard(userId, e)}>
      {video ? (
        <Video track={video.track} mirror={userId === ME && !video.screen} />
      ) : demoShare ? (
        <span className="tile-screen">
          <Icon name="screen" size={40} />
          Демонстрация экрана
        </span>
      ) : (
        <Avatar person={p} size={96} showPresence={false} border="var(--bg1)" />
      )}
      <span className="tile-name">
        {p.name}
        {video?.screen && <span className="live">ЭФИР</span>}
        {muted && <Icon name="micOff" size={14} className="red" />}
      </span>
    </button>
  );
}

/** Модератор сообщества (на сцене говорит всегда) */
const isModIn = (server: Server, userId: string) => {
  if (server.ownerId === userId) return true;
  const roleId = server.members.find((m) => m.userId === userId)?.roleId;
  const r = server.roles.find((x) => x.id === roleId);
  return !!r && (r.perms.admin || r.perms.manageMessages || r.perms.kickBan);
};

function Listener({ userId, hand, canManage, roomId }: { userId: string; hand: boolean; canManage: boolean; roomId: string }) {
  const p = usePerson(userId);
  if (!p) return null;
  return (
    <div className={`listener ${hand ? 'hand' : ''}`}>
      <button type="button" className="plain" onClick={(e) => openCard(userId, e)} aria-label={p.name}>
        <Avatar person={p} size={52} showPresence={false} />
        {hand && <span className="hand-badge">✋</span>}
      </button>
      <span className="small ellipsis">{p.name}</span>
      {canManage && hand && (
        <button type="button" className="btn small primary" onClick={() => void social.setSpeaker(roomId, userId, true)}>
          Дать слово
        </button>
      )}
    </div>
  );
}

function Stage({ server, channel, people, isSpeaking }: { server: Server; channel: Channel; people: string[]; isSpeaking: (id: string) => boolean }) {
  useSyncExternalStore(social.onSocial, social.socialVersion);
  const iManage = isModIn(server, ME);
  const hands = new Set(social.handsIn(channel.id));
  if (social.handUp()) hands.add(ME);
  const speakers = people.filter((u) => isModIn(server, u) || channel.speakers?.includes(u));
  const listeners = people.filter((u) => !speakers.includes(u)).sort((a, b) => Number(hands.has(b)) - Number(hands.has(a)));
  return (
    <div className="stage">
      <div className="stage-label">
        <Icon name="stage" size={16} /> НА СЦЕНЕ · {speakers.length}
      </div>
      <div className={`tiles n${Math.min(Math.max(speakers.length, 1), 4)}`}>
        {speakers.map((u) => (
          <div key={u} className="stage-speaker">
            <Tile userId={u} speaking={isSpeaking(u)} />
            {iManage && !isModIn(server, u) && (
              <button type="button" className="btn small ghost" onClick={() => void social.setSpeaker(channel.id, u, false)}>
                Убрать со сцены
              </button>
            )}
          </div>
        ))}
        {!speakers.length && <p className="muted">На сцене пока никого — ждём ведущего</p>}
      </div>
      <div className="stage-label">
        СЛУШАТЕЛИ · {listeners.length}
        {iManage && hands.size > 0 && <span className="hand-count">✋ {hands.size} {hands.size === 1 ? 'хочет' : 'хотят'} сказать</span>}
      </div>
      <div className="listeners">
        {listeners.map((u) => (
          <Listener key={u} userId={u} hand={hands.has(u)} canManage={iManage} roomId={channel.id} />
        ))}
        {!listeners.length && <p className="muted small">Пока никто не слушает</p>}
      </div>
    </div>
  );
}

export function VoiceView({ server, channel }: { server: Server; channel: Channel }) {
  const voice = useStore((s) => s.ui.voice);
  const muted = useStore((s) => s.ui.muted);
  const deafened = useStore((s) => s.ui.deafened);
  const camera = useStore((s) => s.ui.camera);
  const sharing = useStore((s) => s.ui.sharing);
  const isSpeaking = useSpeaking();
  const joined = voice?.channelId === channel.id;
  const others = (server.voice[channel.id] ?? []).filter((u) => u !== ME);
  // себя показываем сразу после нажатия «Подключиться», не дожидаясь сервера
  const people = joined ? [ME, ...others] : server.voice[channel.id] ?? [];

  return (
    <main className="voice">
      <header className="voice-head">
        <BackButton />
        <span className="community-badge big" style={{ background: server.color }}>
          {server.short}
        </span>
        <span className="chat-head-title">
          <span className="strong ellipsis">
            {channel.name}
            {channel.stage && <span className="tag-soft">сцена</span>}
          </span>
          <span className="muted small">
            {server.name} · {people.length ? `${people.length} в комнате` : 'пока никого'}
          </span>
        </span>
      </header>
      {people.length === 0 ? (
        <div className="voice-empty">
          <div className="voice-empty-icon">
            <Icon name="speaker" size={40} />
          </div>
          <h2>В комнате никого нет</h2>
          <p className="muted">Зайди первым — друзья увидят, что ты на связи</p>
          <button type="button" className="btn primary" onClick={() => actions.joinVoice(server.id, channel.id)}>
            Подключиться
          </button>
        </div>
      ) : channel.stage ? (
        <Stage server={server} channel={channel} people={people} isSpeaking={isSpeaking} />
      ) : (
        <div className={`tiles n${Math.min(people.length, 4)}`}>
          {people.map((u) => (
            <Tile key={u} userId={u} speaking={isSpeaking(u)} />
          ))}
        </div>
      )}
      <div className="voice-bar">
        {joined ? (
          <>
            <button type="button" className={`round-btn ${muted ? 'off' : ''}`} aria-label={muted ? 'Включить микрофон' : 'Выключить микрофон'} onClick={actions.toggleMute}>
              <Icon name={muted ? 'micOff' : 'mic'} />
            </button>
            {channel.stage && !isModIn(server, ME) && !channel.speakers?.includes(ME) && <HandButton />}
            <button type="button" className={`round-btn ${deafened ? 'off' : ''}`} aria-label={deafened ? 'Включить звук' : 'Выключить звук'} onClick={actions.toggleDeafen}>
              <Icon name={deafened ? 'headphonesOff' : 'headphones'} />
            </button>
            <button type="button" className={`round-btn ${camera ? 'on' : ''}`} aria-label={camera ? 'Выключить камеру' : 'Включить камеру'} onClick={actions.toggleCamera}>
              <Icon name="video" />
            </button>
            {canShareScreen() && (
              <button type="button" className={`round-btn ${sharing ? 'on' : ''}`} aria-label={sharing ? 'Остановить демонстрацию' : 'Показать экран'} onClick={actions.toggleScreen}>
                <Icon name="screen" />
              </button>
            )}
            <button type="button" className="round-btn hang" aria-label="Отключиться" onClick={() => void actions.leaveVoice()}>
              <Icon name="hangup" />
            </button>
          </>
        ) : (
          people.length > 0 && (
            <button type="button" className="btn primary" onClick={() => actions.joinVoice(server.id, channel.id)}>
              Подключиться
            </button>
          )
        )}
      </div>
      {!ONLINE && <p className="voice-note muted small">Офлайн-режим: звук и видео работают, когда подключён сервер (см. README)</p>}
    </main>
  );
}

function HandButton() {
  useSyncExternalStore(social.onSocial, social.socialVersion);
  const up = social.handUp();
  if (social.mayISpeak() && !up) return null;
  return (
    <button type="button" className={`round-btn ${up ? 'on' : ''}`} aria-label={up ? 'Опустить руку' : 'Поднять руку'} title={up ? 'Опустить руку' : 'Поднять руку — попросить слово'} onClick={() => social.setHand(!up)}>
      <Icon name="hand" />
    </button>
  );
}
