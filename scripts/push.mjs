// Отправить изменения на GitHub одной командой: npm run push -- "что поменял"
// GitHub сам соберёт новую версию, а приложения предложат обновиться (≈10–15 минут на сборку).
// Без выпуска версии: npm run push -- "мелочь [skip release]"

import { execSync } from 'node:child_process';

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', ...opts }).trim();
const msg = process.argv.slice(2).join(' ').trim() || 'Обновление Fizion';

try {
  sh('git rev-parse --is-inside-work-tree');
} catch {
  console.error('\n✖ Это ещё не git-репозиторий. Сначала один раз: npm run github:setup -- логин/fizion\n');
  process.exit(1);
}

// секреты никогда не уходят на GitHub
for (const f of ['.env', '.env.setup']) {
  if (sh(`git ls-files ${f}`)) {
    console.error(`\n✖ Файл ${f} попал в git — его нельзя отправлять. Выполни: git rm --cached ${f}\n`);
    process.exit(1);
  }
}

sh('git add -A');
if (!sh('git status --porcelain')) console.log('▸ Новых изменений нет — просто отправляю, что уже закоммичено');
else {
  execSync('git commit -F -', { input: msg, stdio: ['pipe', 'inherit', 'inherit'] });
}
const branch = sh('git rev-parse --abbrev-ref HEAD');
execSync(`git push -u origin ${branch}`, { stdio: 'inherit' });

let repo = '';
try {
  const url = sh('git remote get-url origin');
  if (/github\.com[:/]/.test(url)) repo = url.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
} catch {
  /* нет origin */
}
console.log(`\n✔ Отправлено. ${msg.includes('[skip release]') ? 'Версия не выпускается.' : 'Сборка новой версии началась.'}`);
if (repo) console.log(`  Следить: https://github.com/${repo}/actions\n`);
