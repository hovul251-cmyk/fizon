// Проставить номер версии во все места сразу: node scripts/set-version.mjs 0.9.12
// Вызывается GitHub Actions перед сборкой; руками запускать не нужно.

import { readFileSync, writeFileSync } from 'node:fs';

const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v ?? '')) {
  console.error('✖ Укажи версию вида 0.9.12');
  process.exit(1);
}

const json = (path, edit) => {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
};

json('package.json', (p) => (p.version = v));
json('src-tauri/tauri.conf.json', (c) => (c.version = v));
const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8').replace(/^version = ".*"$/m, `version = "${v}"`);
writeFileSync('src-tauri/Cargo.toml', cargo);
console.log(`✓ версия ${v}`);
