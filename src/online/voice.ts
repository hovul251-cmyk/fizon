// Голос, камера и демонстрация экрана через LiveKit.
// Доступ в комнату выдаёт серверная функция fizion-api — она проверяет, что ты участник сообщества.

import { ExternalE2EEKeyProvider, Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { getState, setUi } from '../store';
import type { VideoTrackLike } from '../types';
import { call, errorText, L, toast, trackMe } from './sync';
import { deniedText, isPermissionError } from '../lib/permissions';
import * as social from './social';
import { play } from '../lib/sound';
import { onRemoteData, resetRemote } from './remotectl';

/** Микрофон, динамики, камера и обработка звука — из настроек */
const audioPrefs = () => getState().settings.audio ?? {};
const captureOpts = () => {
  const a = audioPrefs();
  return {
    echoCancellation: a.echo ?? true,
    noiseSuppression: a.noise ?? true,
    autoGainControl: a.agc ?? true,
    ...(a.input ? { deviceId: a.input } : {}),
  };
};

let room: Room | null = null;
/** Куда подключены: голосовая комната сообщества или звонок в личке */
let target: { roomId?: string; dmId?: string; groupId?: string } | null = null;
/** Что делать, если связь со звонком оборвалась */
let onCallLost: (() => void) | null = null;
export const setCallLostHandler = (fn: () => void) => (onCallLost = fn);
const audioEls = new Set<HTMLMediaElement>();

function refreshVideos() {
  if (!room) return setUi({ videos: {} });
  const videos: Record<string, { track: VideoTrackLike; screen: boolean }> = {};
  const people: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  for (const p of people) {
    for (const pub of p.trackPublications.values()) {
      if (pub.kind !== Track.Kind.Video || !pub.track || pub.isMuted) continue;
      const id = L(p.identity);
      const screen = pub.source === Track.Source.ScreenShare;
      if (!videos[id] || screen) videos[id] = { track: pub.track as unknown as VideoTrackLike, screen };
    }
  }
  setUi({ videos });
}

function cleanup() {
  resetRemote();
  audioEls.forEach((el) => el.remove());
  audioEls.clear();
  room = null;
}

/** Кто сейчас в комнате звонка, кроме меня */
const refreshPeers = () => setUi({ callPeers: room ? [...room.remoteParticipants.values()].map((p) => L(p.identity)) : [] });

/** Шифрование звонка: ключ из общего секрета двоих собеседников, сервер LiveKit его не знает */
async function e2eeOptions(key?: ArrayBuffer | null) {
  if (!key) return null;
  try {
    const { default: E2EEWorker } = await import('livekit-client/e2ee-worker?worker');
    const keyProvider = new ExternalE2EEKeyProvider();
    await keyProvider.setKey(key);
    return { keyProvider, worker: new E2EEWorker() };
  } catch {
    return null;
  }
}

export async function connect(to: { roomId?: string; dmId?: string; groupId?: string }, e2eeKey?: ArrayBuffer | null) {
  await disconnect();
  target = to;
  const data = await call<{ token: string; url: string; canSpeak?: boolean }>('voice-token', { roomId: to.roomId, dmId: to.dmId, groupId: to.groupId });
  // сцена: слушателям микрофон не включаем, пока модератор не даст слово
  const speaker = data.canSpeak !== false;
  social.setCanSpeak(speaker);
  social.setHand(false);
  if (!speaker) setUi({ muted: true });
  if (!data?.token) throw new Error('Сервер голоса не выдал доступ');

  const e2ee = await e2eeOptions(e2eeKey);
  const r = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: captureOpts(),
    videoCaptureDefaults: audioPrefs().camera ? { deviceId: audioPrefs().camera } : undefined,
    audioOutput: audioPrefs().output ? { deviceId: audioPrefs().output } : undefined,
    ...(e2ee ? { e2ee } : {}),
  });
  if (e2ee) await r.setE2EEEnabled(true).catch(() => undefined);
  setUi({ callEncrypted: !!e2ee });
  room = r;
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.muted = getState().ui.deafened;
      el.style.display = 'none';
      document.body.appendChild(el);
      audioEls.add(el);
    }
    refreshVideos();
  })
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      track.detach().forEach((el) => {
        el.remove();
        audioEls.delete(el);
      });
      refreshVideos();
    })
    .on(RoomEvent.LocalTrackPublished, refreshVideos)
    .on(RoomEvent.LocalTrackUnpublished, refreshVideos)
    .on(RoomEvent.TrackMuted, refreshVideos)
    .on(RoomEvent.TrackUnmuted, refreshVideos)
    .on(RoomEvent.ParticipantDisconnected, () => {
      refreshVideos();
      refreshPeers();
      play('leave');
    })
    .on(RoomEvent.ParticipantConnected, () => {
      refreshPeers();
      play('join');
    })
    .on(RoomEvent.DataReceived, (payload: Uint8Array, p?: Participant) => p && onRemoteData(L(p.identity), payload))
    .on(RoomEvent.ParticipantPermissionsChanged, (_prev: unknown, p: Participant) => {
      if (p !== r.localParticipant) return;
      const can = (p as { permissions?: { canPublish?: boolean } }).permissions?.canPublish !== false;
      const was = social.mayISpeak();
      social.setCanSpeak(can);
      if (can && !was) {
        toast('Тебе дали слово — включи микрофон');
        void trackMe();
      }
      if (!can && was) setUi({ muted: true });
    })
    .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => setUi({ speaking: speakers.map((p) => L(p.identity)) }))
    .on(RoomEvent.Disconnected, () => {
      if (room !== r) return;
      const wasCall = !!(target?.dmId || target?.groupId);
      cleanup();
      setUi({ voice: null, speaking: [], videos: {}, camera: false, sharing: false });
      if (wasCall) onCallLost?.();
      void trackMe();
    });

  await r.connect(data.url, data.token);
  refreshPeers();
  const { muted } = getState().ui;
  try {
    await r.localParticipant.setMicrophoneEnabled(!muted);
  } catch (e) {
    toast(isPermissionError(e) ? deniedText('microphone') : 'Нет доступа к микрофону: ' + errorText(e));
    setUi({ muted: true });
  }
}

export async function disconnect() {
  const r = room;
  if (!r) return;
  room = null;
  target = null;
  await r.disconnect();
  cleanup();
  setUi({ speaking: [], videos: {}, camera: false, sharing: false, callPeers: [], callEncrypted: false });
}

export async function setMic(on: boolean) {
  play(on ? 'unmute' : 'mute');
  try {
    await room?.localParticipant.setMicrophoneEnabled(on);
  } catch (e) {
    toast(isPermissionError(e) ? deniedText('microphone') : errorText(e));
  }
}

export function setDeafened(deaf: boolean) {
  audioEls.forEach((el) => (el.muted = deaf));
}

export async function setCamera(on: boolean) {
  try {
    await room?.localParticipant.setCameraEnabled(on);
    setUi({ camera: on });
  } catch (e) {
    toast(isPermissionError(e) ? deniedText('camera') : 'Не удалось включить камеру: ' + errorText(e));
    setUi({ camera: false });
  }
  refreshVideos();
}

export async function setScreen(on: boolean) {
  try {
    await room?.localParticipant.setScreenShareEnabled(on, { audio: true, resolution: { width: 1920, height: 1080, frameRate: 60 } });
    setUi({ sharing: on });
  } catch (e) {
    // отмена окна выбора экрана — не ошибка
    if (!/Permission denied|NotAllowedError/i.test(String(e))) toast('Не удалось показать экран: ' + errorText(e));
    setUi({ sharing: false });
  }
  refreshVideos();
}

/** Сменить микрофон, динамики или камеру прямо во время звонка */
export async function switchDevice(kind: 'audioinput' | 'audiooutput' | 'videoinput', deviceId: string) {
  if (!room) return;
  try {
    await room.switchActiveDevice(kind, deviceId);
  } catch (e) {
    toast('Не удалось переключить устройство: ' + errorText(e));
  }
}

/** Включить/выключить шумодав, эхоподавление, автоусиление — перезапускаем микрофон */
export async function applyAudioProcessing() {
  const r = room;
  if (!r) return;
  const on = r.localParticipant.isMicrophoneEnabled;
  if (!on) return;
  await r.localParticipant.setMicrophoneEnabled(false);
  await r.localParticipant.setMicrophoneEnabled(true, captureOpts()).catch((e) => toast(isPermissionError(e) ? deniedText('microphone') : errorText(e)));
}

/** Отправить данные участникам звонка (удалённое управление) */
export async function sendData(data: Uint8Array, to?: string[], reliable = true) {
  await room?.localParticipant.publishData(new Uint8Array(data), { reliable, destinationIdentities: to });
}
export const currentRoom = () => room;
