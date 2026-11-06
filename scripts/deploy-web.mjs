// Выложить веб-версию Fizion в интернет на Appwrite Sites одной командой: npm run web:deploy
// Собирает сайт, загружает его, включает и добавляет адрес сайта в разрешённые платформы проекта.
// Нужен тот же .env.setup, что и для npm run setup (ключ API с правами sites, rules, platforms).

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Adapter, BuildRuntime, Client, Framework, ID, Project, Proxy, Query, Sites } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';

const env = (k) => {
  const v = process.env[k]?.trim();
  if (!v) {
    console.error(`\n✖ Не задано ${k} в .env.setup — см. README.\n`);
    process.exit(1);
  }
  return v;
};

const client = new Client().setEndpoint(env('APPWRITE_ENDPOINT')).setProject(env('APPWRITE_PROJECT_ID')).setKey(env('APPWRITE_API_KEY'));
const sites = new Sites(client);
const proxy = new Proxy(client);
const project = new Project(client);
const SITE = 'fizion-web';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (t) => console.log(`\n▸ ${t}`);
const ok = (t) => console.log(`  ✓ ${t}`);

async function main() {
  if (!existsSync('.env')) throw new Error('Нет файла .env — сначала выполни npm run setup');

  step('Сборка веб-версии');
  execSync('npm run build:web', { stdio: 'inherit' });

  step('Сайт в Appwrite');
  const site = {
    siteId: SITE,
    name: 'Fizion Web',
    framework: Framework.Other,
    buildRuntime: BuildRuntime.Static1,
    adapter: Adapter.Static,
    outputDirectory: './',
    installCommand: '',
    buildCommand: '',
    // все адреса внутри приложения открывают index.html
    fallbackFile: 'index.html',
  };
  try {
    await sites.get({ siteId: SITE });
    await sites.update(site);
  } catch (e) {
    if (e?.code !== 404) throw e;
    await sites.create(site);
  }
  ok('fizion-web');

  step('Загрузка');
  const archive = join(mkdtempSync(join(tmpdir(), 'fizion-web-')), 'site.tar.gz');
  execSync(`tar -czf "${archive}" -C dist-web .`, { stdio: 'inherit' });
  const dep = await sites.createDeployment({ siteId: SITE, code: InputFile.fromPath(archive, 'site.tar.gz'), activate: true, outputDirectory: './' });
  for (let i = 0; i < 90; i++) {
    const d = await sites.getDeployment({ siteId: SITE, deploymentId: dep.$id });
    if (d.status === 'ready') break;
    if (d.status === 'failed') throw new Error('Appwrite не смог выложить сайт — смотри Sites → fizion-web → Deployments в консоли');
    await sleep(2000);
  }
  ok('выложено');

  step('Адрес сайта');
  const rules = await proxy.listRules({ queries: [Query.equal('deploymentResourceId', SITE), Query.limit(25)] });
  const domains = [...new Set(rules.rules.map((r) => r.domain))];
  if (!domains.length) console.warn('  ! адрес пока не появился — посмотри его в консоли: Sites → fizion-web → Domains');
  domains.forEach((d) => ok(`https://${d}`));

  step('Разрешаю вход с этого адреса');
  try {
    const have = (await project.listPlatforms({ queries: [Query.limit(100)] })).platforms.map((p) => /** @type {{ hostname?: string }} */ (p).hostname);
    for (const d of domains) {
      if (have.includes(d)) continue;
      await project.createWebPlatform({ platformId: ID.unique(), name: `Fizion Web (${d})`, hostname: d });
      ok(d);
    }
  } catch (e) {
    console.warn(`  ! не получилось (${e.message}). Добавь вручную: Overview → Apps → Add app → Web, hostname — адрес сайта без https://`);
  }

  console.log(`\n✔ Готово. Открой ${domains[0] ? `https://${domains[0]}` : 'адрес сайта'} на компьютере или телефоне.`);
  console.log('  На телефоне: меню браузера → «Добавить на главный экран» — Fizion откроется как приложение.\n');
}

main().catch((e) => {
  console.error(`\n✖ ${e.message}\n`);
  if (e?.code === 401) console.error('У ключа API нет нужных прав: добавь sites, rules и platforms (чтение и запись) — см. README.\n');
  process.exit(1);
});
