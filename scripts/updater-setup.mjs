// Один раз: связать Fizion с GitHub, чтобы новые версии выходили сами после push.
// Запуск: npm run github:setup -- твой-логин/fizion
//
// 1. Создаёт ключ подписи обновлений (~/.tauri/fizion.key) — приложение ставит только подписанные им версии.
// 2. Прописывает открытый ключ и адрес обновлений в src-tauri/tauri.conf.json.
// 3. Делает папку git-репозиторием и привязывает к GitHub.
// 4. Если установлен GitHub CLI (gh) и ты вошёл (gh auth login) — сам создаёт репозиторий
//    и добавляет секреты. Иначе подсказывает, что вставить руками.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { androidKey, prepare as prepareAndroidKey } from './android-key.mjs';

const repo = process.argv[2];
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('\n✖ Укажи репозиторий GitHub: npm run github:setup -- логин/fizion\n');
  process.exit(1);
}
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const can = (cmd) => {
  try {
    sh(cmd);
    return true;
  } catch {
    return false;
  }
};
const step = (t) => console.log(`\n▸ ${t}`);
const ok = (t) => console.log(`  ✓ ${t}`);

// ── 1. ключ подписи
const dir = join(homedir(), '.tauri');
const key = join(dir, 'fizion.key');
mkdirSync(dir, { recursive: true });
step('Ключ подписи обновлений');
if (!existsSync(key)) {
  execSync(`npx tauri signer generate --ci -w "${key}" -p ""`, { stdio: 'inherit' });
  ok(`создан: ${key}`);
} else ok(`уже есть: ${key}`);

// ── 1б. ключ подписи Android (APK)
step('Ключ подписи Android');
await prepareAndroidKey();
const apkKey = androidKey(dir);
ok(apkKey.created ? `создан: ${apkKey.file}` : `уже есть: ${apkKey.file}`);

// ── 2. адрес обновлений
const pubkey = readFileSync(`${key}.pub`, 'utf8').trim();
const confPath = 'src-tauri/tauri.conf.json';
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.bundle.createUpdaterArtifacts = true;
conf.plugins = {
  ...(conf.plugins ?? {}),
  updater: {
    pubkey,
    endpoints: [`https://github.com/${repo}/releases/latest/download/latest.json`],
    windows: { installMode: 'passive' },
  },
};
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
step('Адрес обновлений');
ok(`https://github.com/${repo}/releases`);

// ── 3. git
step('Git-репозиторий');
if (!can('git --version')) {
  console.error('  ✖ Не найден git. Установи его: https://git-scm.com/download/win и запусти команду ещё раз.');
  process.exit(1);
}
if (!can('git rev-parse --is-inside-work-tree')) {
  sh('git init -b main');
  ok('создан');
} else ok('уже есть');
const url = `https://github.com/${repo}.git`;
if (can('git remote get-url origin')) sh(`git remote set-url origin ${url}`);
else sh(`git remote add origin ${url}`);
ok(`origin → ${url}`);

// ── 4. секреты
const readEnv = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
          .filter(Boolean)
          .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
      )
    : {};
const app = readEnv('.env');
const setup = readEnv('.env.setup');
const secrets = {
  TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8').trim(),
  VITE_APPWRITE_ENDPOINT: app.VITE_APPWRITE_ENDPOINT,
  VITE_APPWRITE_PROJECT_ID: app.VITE_APPWRITE_PROJECT_ID,
  VITE_VAPID_PUBLIC_KEY: app.VITE_VAPID_PUBLIC_KEY,
  VITE_HOOKS_URL: app.VITE_HOOKS_URL,
  VITE_WEB_URL: app.VITE_WEB_URL,
  // Android: подпись APK
  ANDROID_KEYSTORE_B64: apkKey.b64,
  ANDROID_KEYSTORE_PASSWORD: apkKey.password,
  // необязательно: с ним GitHub будет выкладывать и веб-версию
  APPWRITE_API_KEY: setup.APPWRITE_API_KEY,
};

step('Секреты GitHub');
const gh = can('gh --version') && can('gh auth status');
if (gh) {
  if (!can(`gh repo view ${repo}`)) {
    // обновления скачиваются по открытой ссылке, поэтому репозиторий публичный.
    // Ключи и пароли в код не попадают: .env и .env.setup в .gitignore, а секреты хранятся в GitHub отдельно.
    sh(`gh repo create ${repo} --public`);
    ok(`репозиторий ${repo} создан`);
  }
  for (const [name, value] of Object.entries(secrets)) {
    if (!value) continue;
    execSync(`gh secret set ${name} --repo ${repo}`, { input: value, stdio: ['pipe', 'pipe', 'pipe'] });
    ok(name);
  }
} else {
  console.log(`  GitHub CLI не найден — добавь секреты руками:
  https://github.com/${repo}/settings/secrets/actions → New repository secret

    TAURI_SIGNING_PRIVATE_KEY  — всё содержимое файла ${key}
    VITE_APPWRITE_ENDPOINT     — из файла .env
    VITE_APPWRITE_PROJECT_ID   — из файла .env
    VITE_VAPID_PUBLIC_KEY      — из файла .env
    VITE_HOOKS_URL             — из файла .env (для ботов)
    ANDROID_KEYSTORE_B64       — файл ${apkKey.file} в base64 (команда: certutil -encode в Windows или base64)
    ANDROID_KEYSTORE_PASSWORD  — из файла ${dir}/fizion-android.txt
    APPWRITE_API_KEY           — из .env.setup (необязательно: тогда GitHub выкладывает и веб-версию)

  Репозиторий создай публичным (Public): приложения скачивают обновления по открытой ссылке.`);
}

console.log(`
✔ Готово. Дальше всегда одно и то же:

  npm run push -- "что поменял"

GitHub соберёт новую версию (≈10–15 минут), и у всех в Fizion появится «Вышла новая версия» с кнопкой «Обновить».
Важно: обновляться умеют версии, собранные после этой настройки. Первый раз скачай установщик
со страницы https://github.com/${repo}/releases и поставь его — дальше всё само.

Ключи ${key} и ${apkKey.file} никому не отправляй и не теряй: без них новые версии не установятся у пользователей.
`);
