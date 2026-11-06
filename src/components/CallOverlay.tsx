import { RemoteRequestButton } from './Remote';
import { useEffect, useRef, useState } from 'react';
import { ME } from '../data';
import { Icon } from '../icons';
import { canShareScreen } from '../lib/platform';
import { actions, useStore, type State } from '../store';
import type { VideoTrackLike } from '../types';
import { Avatar, IconButton, usePerson, useSpeaking } from './common';
import { useDraggable } from './Floating';

// Звонок в личке: входящий — карточка сверху с мелодией, исходящий и разговор — плавающее окно,
// которое можно развернуть на всю рабочую область.

function CallVideo({ track, mirror, className }: { track: VideoTrackLike; mirror?: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current!;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  return <video ref={ref} className={`${className} ${mirror ? 'mirror' : ''}`} autoPlay playsInline muted />;
}

function Timer({ since }: { since?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  if (!since) return null;
  const s = Math.floor((Date.now() - since) / 1000);
  return (
    <>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </>
  );
}

const selCall = (s: State) => s.ui.call;

export function CallOverlay() {
  const call = useStore(selCall);
  const peer = usePerson(call?.userId ?? ME);
  const peerVideo = useStore((s) => (call ? s.ui.videos[call.userId] : undefined));
  const myVideo = useStore((s) => s.ui.videos[ME]);
  const isSpeaking = useSpeaking();
  const [big, setBig] = useState(false);
  const group = useStore((s) => (call?.groupId ? s.groups.find((g) => g.id === call.groupId) : undefined));
  const peers = useStore((s) => s.ui.callPeers);
  const encrypted = useStore((s) => s.ui.callEncrypted);
  // свёрнутое окно звонка можно перетаскивать куда угодно
  const drag = useDraggable('call', !big && !!call && call.state !== 'incoming');
  if (!call || !peer) return null;

  if (call.state === 'incoming')
    return (
      <div className="call-incoming" role="alertdialog" aria-label={`Входящий звонок от ${peer.name}`}>
        <div className="call-pulse">
          <Avatar person={peer} size={64} showPresence={false} story={false} />
        </div>
        <div className="grow">
          <div className="strong">{peer.name}</div>
          <div className="muted small">{group ? `звонок в «${group.name}»` : `${call.video ? 'Видеозвонок' : 'Аудиозвонок'} · звонит…`}</div>
        </div>
        <button type="button" className="call-round decline" aria-label="Отклонить звонок" onClick={actions.declineCall}>
          <Icon name="hangup" size={22} />
        </button>
        {call.video && (
          <button type="button" className="call-round accept" aria-label="Принять с видео" onClick={() => void actions.acceptCall(true)}>
            <Icon name="video" size={22} />
          </button>
        )}
        <button type="button" className="call-round accept" aria-label="Принять звонок" onClick={() => void actions.acceptCall(false)}>
          <Icon name="phone" size={22} />
        </button>
      </div>
    );

  if (call.kind === 'group' && group)
    return (
      <div ref={drag.ref} style={drag.style} onPointerDown={drag.onPointerDown} className={`call-window group ${big ? 'big' : ''} ${drag.dragging ? 'dragging' : ''}`} role="dialog" aria-label={`Звонок в группе ${group.name}`}>
        <div className="call-stage">
          <div className={`call-grid n${Math.min(peers.length + 1, 9)}`}>
            {[ME, ...peers].map((id) => (
              <CallTile key={id} userId={id} speaking={isSpeaking(id)} big={big} />
            ))}
          </div>
          <div className="call-top">
            <span className="strong">{group.name}</span>
            <span className="small">
              {peers.length ? `${peers.length + 1} в звонке · ` : 'ждём остальных · '}
              <Timer since={call.since} />
            </span>
            <button type="button" className="call-ghost" aria-label={big ? 'Свернуть окно звонка' : 'Развернуть окно звонка'} onClick={() => setBig((b) => !b)}>
              <Icon name={big ? 'shrink' : 'expand'} size={16} />
            </button>
          </div>
        </div>
        <Controls />
      </div>
    );

  return (
    <div ref={drag.ref} style={drag.style} onPointerDown={drag.onPointerDown} className={`call-window ${big ? 'big' : ''} ${drag.dragging ? 'dragging' : ''}`} role="dialog" aria-label={`Звонок с ${peer.name}`}>
      <div className="call-stage">
        {peerVideo ? (
          <CallVideo track={peerVideo.track} className={`call-peer-video ${peerVideo.screen ? 'screen' : ''}`} />
        ) : (
          <div className={`call-peer ${isSpeaking(call.userId) ? 'speaking' : ''}`}>
            <Avatar person={peer} size={big ? 140 : 88} showPresence={false} story={false} />
          </div>
        )}
        {myVideo && <CallVideo track={myVideo.track} mirror={!myVideo.screen} className="call-me-video" />}
        <div className="call-top">
          <span className="strong">{peer.name}</span>
          <span className="small">{call.state === 'outgoing' ? 'Звоню…' : <Timer since={call.since} />}</span>
          {encrypted && (
            <span className="call-e2e" title="Звонок зашифрован: слышите и видите только вы двое">
              <Icon name="lock" size={12} /> защищён
            </span>
          )}
          <button type="button" className="call-ghost" aria-label={big ? 'Свернуть окно звонка' : 'Развернуть окно звонка'} onClick={() => setBig((b) => !b)}>
            <Icon name={big ? 'shrink' : 'expand'} size={16} />
          </button>
        </div>
      </div>
      <Controls />
    </div>
  );
}

function Controls() {
  const muted = useStore((s) => s.ui.muted);
  const camera = useStore((s) => s.ui.camera);
  const sharing = useStore((s) => s.ui.sharing);
  return (
      <div className="call-controls">
      <IconButton icon={muted ? 'micOff' : 'mic'} label={muted ? 'Включить микрофон' : 'Выключить микрофон'} alert={muted} size={42} onClick={actions.toggleMute} />
      <IconButton icon="video" label={camera ? 'Выключить камеру' : 'Включить камеру'} active={camera} size={42} onClick={actions.toggleCamera} />
      <RemoteRequestButton size={42} />
      {canShareScreen() && <IconButton icon="screen" label={sharing ? 'Остановить показ экрана' : 'Показать экран'} active={sharing} size={42} onClick={actions.toggleScreen} />}
      <button type="button" className="call-round decline" aria-label="Завершить звонок" onClick={() => void actions.hangUp()}>
        <Icon name="hangup" size={22} />
      </button>
    </div>
  );
}

function CallTile({ userId, speaking, big }: { userId: string; speaking: boolean; big: boolean }) {
  const p = usePerson(userId);
  const video = useStore((s) => s.ui.videos[userId]);
  if (!p) return null;
  return (
    <div className={`call-tile ${speaking ? 'speaking' : ''}`}>
      {video ? <CallVideo track={video.track} mirror={userId === ME && !video.screen} className="call-tile-video" /> : <Avatar person={p} size={big ? 96 : 52} showPresence={false} story={false} />}
      <span className="call-tile-name">{userId === ME ? 'Ты' : p.name}</span>
    </div>
  );
}
