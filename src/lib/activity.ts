// «Во что играет / где сидит»: раз в полминуты спрашиваем у Windows, какая программа на переднем плане,
// и показываем друзьям только её название. Работает, только если человек сам включил это в настройках.

import { getState, setState } from '../store';
import { savePresence } from '../online/remote';
import { IS_DESKTOP_APP } from './platform';

/** exe → понятное название. Неизвестные программы показываем по имени файла. */
const KNOWN: Record<string, string> = {
  'javaw.exe': 'Minecraft',
  'minecraft.exe': 'Minecraft',
  'cs2.exe': 'Counter-Strike 2',
  'dota2.exe': 'Dota 2',
  'valorant.exe': 'VALORANT',
  'valorant-win64-shipping.exe': 'VALORANT',
  'fortniteclient-win64-shipping.exe': 'Fortnite',
  'robloxplayerbeta.exe': 'Roblox',
  'gta5.exe': 'GTA V',
  'gta5_enhanced.exe': 'GTA V',
  'rocketleague.exe': 'Rocket League',
  'r5apex.exe': 'Apex Legends',
  'overwatch.exe': 'Overwatch 2',
  'leagueclient.exe': 'League of Legends',
  'league of legends.exe': 'League of Legends',
  'genshinimpact.exe': 'Genshin Impact',
  'eldenring.exe': 'Elden Ring',
  'rustclient.exe': 'Rust',
  'terraria.exe': 'Terraria',
  'among us.exe': 'Among Us',
  'pubg.exe': 'PUBG',
  'tslgame.exe': 'PUBG',
  'cod.exe': 'Call of Duty',
  'steam.exe': 'Steam',
  'epicgameslauncher.exe': 'Epic Games',
  'photoshop.exe': 'Photoshop',
  'afterfx.exe': 'After Effects',
  'adobe premiere pro.exe': 'Premiere Pro',
  'resolve.exe': 'DaVinci Resolve',
  'capcut.exe': 'CapCut',
  'blender.exe': 'Blender',
  'code.exe': 'VS Code',
  'obs64.exe': 'OBS Studio',
  'spotify.exe': 'Spotify',
  'chrome.exe': 'Chrome',
  'msedge.exe': 'Edge',
  'firefox.exe': 'Firefox',
  'opera.exe': 'Opera',
  'yandex.exe': 'Яндекс Браузер',
  'telegram.exe': 'Telegram',
  'discord.exe': 'Discord',
  'figma.exe': 'Figma',
  'winword.exe': 'Word',
  'excel.exe': 'Excel',
};
/** Системное и сам Neon — не показываем */
const SKIP = new Set(['explorer.exe', 'fizion.exe', 'neon.exe', 'searchhost.exe', 'shellexperiencehost.exe', 'lockapp.exe', 'applicationframehost.exe', 'startmenuexperiencehost.exe', 'taskmgr.exe', 'textinputhost.exe']);

export function appName(exe: string | null): string | null {
  if (!exe) return null;
  const k = exe.toLowerCase();
  if (SKIP.has(k)) return null;
  if (KNOWN[k]) return KNOWN[k];
  const base = exe.replace(/\.exe$/i, '').replace(/[-_]?(win64|x64|shipping|launcher)$/gi, '');
  return base ? base[0].toUpperCase() + base.slice(1) : null;
}

let timer: number | undefined;
let lastName: string | null | undefined;

async function tick() {
  const s = getState();
  if (!s.loggedIn) return;
  let name: string | null = null;
  if (s.settings.shareActivity) {
    const inv = (window as unknown as { __TAURI__?: { core: { invoke: (c: string) => Promise<string | null> } } }).__TAURI__?.core.invoke;
    name = appName((await inv?.('foreground_app').catch(() => null)) ?? null);
  }
  if (name === lastName) return;
  lastName = name;
  const liveApp = name ? { name, since: Date.now() } : null;
  setState((st) => ({ profile: { ...st.profile, liveApp } }));
  await savePresence({ ...getState().profile, liveApp }).catch(() => undefined);
}

/** Запустить проверку (только приложение для Windows) */
export function startActivity() {
  if (!IS_DESKTOP_APP || timer) return;
  timer = window.setInterval(() => void tick(), 30_000);
  window.setTimeout(() => void tick(), 5_000);
}
/** Настройку выключили — сразу убрать «Сейчас в …» */
export const refreshActivity = () => void tick();
