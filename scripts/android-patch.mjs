// После `tauri android init`: права Android-приложения, без которых не работают голос, камера и уведомления.
// Запускается сам (npm run android:init и сборка на GitHub).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const file = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';
if (!existsSync(file)) {
  console.error('✖ Нет Android-проекта — сначала npm run android:init');
  process.exit(1);
}
const need = ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'];
let xml = readFileSync(file, 'utf8');
const missing = need.filter((p) => !xml.includes(`"${p}"`));
if (missing.length) {
  xml = xml.replace(/(\s*)<application/, (m, ws) => `${missing.map((p) => `${ws}<uses-permission android:name="${p}" />`).join('')}${m}`);
  writeFileSync(file, xml);
}
console.log(`✓ права Android: ${need.length - missing.length} уже были, добавлено ${missing.length}`);
