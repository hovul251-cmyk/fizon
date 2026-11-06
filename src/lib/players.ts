// Плееры для «Смотреть вместе»: одинаковое управление для YouTube, Rutube и обычного видеофайла.
// Каждый плеер сообщает о действиях человека (запуск, пауза, перемотка) и умеет выполнить их по команде.

export type WatchKind = 'youtube' | 'rutube' | 'file' | 'local';

export interface ParsedVideo {
  kind: WatchKind;
  /** id ролика (YouTube/Rutube) или адрес файла */
  src: string;
  /** с какой секунды начать, если она была в ссылке */
  start: number;
  title: string;
}

const seconds = (t: string | null) => {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

/** Разобрать ссылку. null — такую ссылку синхронно смотреть не получится. */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const start = seconds(u.searchParams.get('t') ?? u.searchParams.get('start'));
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? { kind: 'youtube', src: id, start, title: 'YouTube' } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v') ?? /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
    return v && /^[\w-]{11}$/.test(v) ? { kind: 'youtube', src: v, start, title: 'YouTube' } : null;
  }
  if (host === 'rutube.ru') {
    const id = /^\/(?:video|play\/embed|shorts)\/([a-f0-9]{32})/i.exec(u.pathname)?.[1];
    return id ? { kind: 'rutube', src: id.toLowerCase(), start, title: 'Rutube' } : null;
  }
  // прямая ссылка на видеофайл (или файл из хранилища Neon)
  if (/\.(mp4|webm|ogv|ogg|mov|m4v|mkv)$/i.test(u.pathname) || /\/storage\/buckets\/.+\/files\/.+\/view/.test(u.pathname)) {
    const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? 'Видео');
    return { kind: 'file', src: u.href, start, title: /^view$/.test(name) ? 'Видео' : name };
  }
  return null;
}

export type PlayerEvent = { type: 'ready' | 'play' | 'pause' | 'seek' | 'ended'; time: number };

export interface Player {
  play(): Promise<boolean>;
  pause(): void;
  seek(time: number): void;
  time(): number;
  playing(): boolean;
  destroy(): void;
}

/* ---------- обычный видеофайл ---------- */

function htmlPlayer(src: string, host: HTMLElement, on: (e: PlayerEvent) => void): Player {
  const v = document.createElement('video');
  v.src = src;
  v.controls = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.className = 'watch-video';
  host.appendChild(v);
  let quiet = 0; // события от наших же команд не пересылаем
  const fire = (type: PlayerEvent['type']) => Date.now() > quiet && on({ type, time: v.currentTime });
  v.addEventListener('loadedmetadata', () => on({ type: 'ready', time: v.currentTime }));
  v.addEventListener('play', () => fire('play'));
  v.addEventListener('pause', () => !v.seeking && !v.ended && fire('pause'));
  v.addEventListener('seeked', () => fire('seek'));
  v.addEventListener('ended', () => on({ type: 'ended', time: v.currentTime }));
  const hush = () => (quiet = Date.now() + 400);
  return {
    async play() {
      hush();
      try {
        await v.play();
        return true;
      } catch {
        return false;
      }
    },
    pause() {
      hush();
      v.pause();
    },
    seek(t) {
      hush();
      v.currentTime = t;
    },
    time: () => v.currentTime,
    playing: () => !v.paused && !v.ended,
    destroy() {
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
    },
  };
}

/* ---------- YouTube (IFrame API) ---------- */

interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(t: number, allow: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}
type YTNamespace = { Player: new (el: HTMLElement, opts: unknown) => YTPlayer };

let ytLoading: Promise<YTNamespace> | null = null;
function loadYouTube(): Promise<YTNamespace> {
  const w = window as unknown as { YT?: YTNamespace & { loaded?: number }; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  ytLoading ??= new Promise((resolve, reject) => {
    w.onYouTubeIframeAPIReady = () => resolve(w.YT!);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      ytLoading = null;
      reject(new Error('YouTube не загрузился'));
    };
    document.head.appendChild(s);
  });
  return ytLoading;
}

/** Общая часть для встроенных плееров: узнаём о перемотке по скачку времени */
function jumpWatcher(getTime: () => number, isPlaying: () => boolean, on: (e: PlayerEvent) => void) {
  let last = getTime();
  let lastAt = performance.now();
  let quiet = 0;
  const timer = window.setInterval(() => {
    const t = getTime();
    const now = performance.now();
    const expected = last + (isPlaying() ? (now - lastAt) / 1000 : 0);
    if (Math.abs(t - expected) > 1.5 && now > quiet) on({ type: 'seek', time: t });
    last = t;
    lastAt = now;
  }, 500);
  return {
    hush(t?: number) {
      quiet = performance.now() + 1200;
      if (t !== undefined) {
        last = t;
        lastAt = performance.now();
      }
    },
    quiet: () => performance.now() < quiet,
    stop: () => window.clearInterval(timer),
  };
}

function youtubePlayer(id: string, start: number, host: HTMLElement, on: (e: PlayerEvent) => void): Player {
  const box = document.createElement('div');
  host.appendChild(box);
  let yt: YTPlayer | null = null;
  let state = -1;
  let destroyed = false;
  const jumps = jumpWatcher(() => yt?.getCurrentTime() ?? 0, () => state === 1, on);
  void loadYouTube()
    .then((YT) => {
      if (destroyed) return;
      yt = new YT.Player(box, {
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(start), origin: location.origin },
        events: {
          onReady: () => on({ type: 'ready', time: yt?.getCurrentTime() ?? 0 }),
          onStateChange: (e: { data: number }) => {
            const was = state;
            state = e.data;
            if (jumps.quiet()) return;
            const t = yt?.getCurrentTime() ?? 0;
            if (e.data === 1 && was !== 1) on({ type: 'play', time: t });
            if (e.data === 2 && was === 1) on({ type: 'pause', time: t });
            if (e.data === 0) on({ type: 'ended', time: t });
          },
        },
      });
    })
    .catch(() => on({ type: 'ended', time: 0 }));
  return {
    async play() {
      jumps.hush();
      yt?.playVideo();
      return true;
    },
    pause() {
      jumps.hush();
      yt?.pauseVideo();
    },
    seek(t) {
      jumps.hush(t);
      yt?.seekTo(t, true);
    },
    time: () => yt?.getCurrentTime() ?? 0,
    playing: () => state === 1 || state === 3,
    destroy() {
      destroyed = true;
      jumps.stop();
      yt?.destroy();
      box.remove();
    },
  };
}

/* ---------- Rutube (postMessage API плеера) ---------- */

function rutubePlayer(id: string, start: number, host: HTMLElement, on: (e: PlayerEvent) => void): Player {
  const frame = document.createElement('iframe');
  frame.src = `https://rutube.ru/play/embed/${id}${start ? `?t=${Math.floor(start)}` : ''}`;
  frame.allow = 'autoplay; fullscreen; picture-in-picture; clipboard-write';
  frame.allowFullscreen = true;
  frame.className = 'watch-frame';
  host.appendChild(frame);
  let time = start;
  let state = 'paused';
  const send = (type: string, data: Record<string, unknown> = {}) => frame.contentWindow?.postMessage(JSON.stringify({ type, data }), '*');
  const jumps = jumpWatcher(() => time, () => state === 'playing', on);
  const onMsg = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow) return;
    let m: { type?: string; data?: { time?: number; state?: string } };
    try {
      m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (m.type === 'player:ready') on({ type: 'ready', time });
    if (m.type === 'player:currentTime' && typeof m.data?.time === 'number') time = m.data.time;
    if (m.type === 'player:changeState' && m.data?.state) {
      const was = state;
      state = m.data.state;
      if (jumps.quiet()) return;
      if (state === 'playing' && was !== 'playing') on({ type: 'play', time });
      if (state === 'paused' && was === 'playing') on({ type: 'pause', time });
    }
    if (m.type === 'player:playComplete') on({ type: 'ended', time });
  };
  window.addEventListener('message', onMsg);
  return {
    async play() {
      jumps.hush();
      send('player:play');
      return true;
    },
    pause() {
      jumps.hush();
      send('player:pause');
    },
    seek(t) {
      jumps.hush(t);
      time = t;
      send('player:setCurrentTime', { time: t });
    },
    time: () => time,
    playing: () => state === 'playing',
    destroy() {
      jumps.stop();
      window.removeEventListener('message', onMsg);
      frame.remove();
    },
  };
}

export function createPlayer(kind: WatchKind, src: string, start: number, host: HTMLElement, on: (e: PlayerEvent) => void): Player {
  if (kind === 'youtube') return youtubePlayer(src, start, host, on);
  if (kind === 'rutube') return rutubePlayer(src, start, host, on);
  return htmlPlayer(src, host, on);
}
