import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** Номер версии: на GitHub его проставляет сборка (FIZION_VERSION), локально — из package.json */
const VERSION = process.env.FIZION_VERSION || (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

/** Веб-версия кладёт рядом version.json — открытые вкладки по нему узнают, что вышло обновление */
const versionFile = (): Plugin => ({
  name: 'fizion-version-file',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION, notes: (process.env.FIZION_NOTES ?? '').slice(0, 500), built: new Date().toISOString() }) });
  },
});

// Две сборки из одного кода:
//  - приложение для Windows (Tauri): npm run app / npm run release — сборка в dist/ под WebView2;
//  - веб-версия для браузеров компьютера и телефона: npm run build:web — сборка в dist-web/.

/** Политика безопасности для веб-версии (в Tauri она задаётся в tauri.conf.json).
 *  YouTube, Rutube и видео по https — для «Смотреть вместе»; api.github.com — проверка обновлений Android. */
const webCspFor = (endpoint: string) => {
  // свой сервер Appwrite (не *.appwrite.io) тоже нужно разрешить — иначе сайт к нему не подключится
  let http = '';
  let ws = '';
  try {
    const u = new URL(endpoint);
    if (!u.hostname.endsWith('.appwrite.io')) {
      http = ` ${u.origin}`;
      ws = ` ${u.origin.replace(/^http/, 'ws')}`;
    }
  } catch {
    /* адреса нет — офлайн-режим */
  }
  return [
    "default-src 'self'",
    `img-src 'self' data: blob: https://*.appwrite.io https://*.appwrite.global https://i.ytimg.com${http}`,
    "media-src 'self' blob: https:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' https://www.youtube.com https://s.ytimg.com",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://rutube.ru",
    "worker-src 'self' blob:",
    `connect-src 'self' https://*.appwrite.io wss://*.appwrite.io https://*.livekit.cloud wss://*.livekit.cloud${http}${ws}`,
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
};

const webCsp = (endpoint: string): Plugin => ({
  name: 'fizion-web-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${webCspFor(endpoint)}" />`),
});

export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), ...(web ? [webCsp(env.VITE_APPWRITE_ENDPOINT ?? ''), versionFile()] : [])],
    define: { __APP_VERSION__: JSON.stringify(VERSION) },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: true, // можно открыть с телефона в той же Wi-Fi сети
      watch: { ignored: ['**/src-tauri/**'] },
    },
    envPrefix: ['VITE_', 'TAURI_ENV_'],
    build: {
      // Windows-приложение работает на свежем Chromium; веб-версия — и на телефонах (Safari 16+, Chrome 111+)
      target: web ? ['es2020', 'safari16', 'chrome111', 'firefox115'] : 'chrome120',
      outDir: web ? 'dist-web' : 'dist',
      minify: 'esbuild',
      sourcemap: false,
    },
  };
});
