// Ключ подписи Android-приложения: создаётся один раз и хранится у тебя (~/.tauri/fizion-android.p12).
// Все версии APK подписываются им — поэтому Android ставит обновление поверх, не удаляя данные.
// Ключ создаётся прямо в Node (node-forge), а если его нет — через keytool из Java.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export function androidKey(dir) {
  const file = `${dir}/fizion-android.p12`;
  const passFile = `${dir}/fizion-android.txt`;
  if (existsSync(file) && existsSync(passFile)) return { file, password: readFileSync(passFile, 'utf8').trim(), b64: readFileSync(file).toString('base64'), created: false };

  const password = randomBytes(18).toString('base64url');
  try {
    makeWithForge(file, password);
  } catch (e) {
    // запасной путь — keytool из Java (есть в Android Studio)
    try {
      execFileSync('keytool', ['-genkeypair', '-storetype', 'PKCS12', '-keystore', file, '-storepass', password, '-keypass', password, '-alias', 'fizion', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10950', '-dname', 'CN=Fizion, O=Fizion'], { stdio: 'pipe' });
    } catch {
      throw new Error(`не удалось создать ключ Android (${e.message}). Выполни npm install и запусти снова`);
    }
  }
  writeFileSync(passFile, password + '\n');
  return { file, password, b64: readFileSync(file).toString('base64'), created: true };
}

async function loadForge() {
  return (await import('node-forge')).default;
}

let forge;
export async function prepare() {
  forge = await loadForge().catch(() => null);
}

function makeWithForge(file, password) {
  if (!forge) throw new Error('node-forge не установлен');
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 30 * 365 * 24 * 3600 * 1000);
  const attrs = [
    { name: 'commonName', value: 'Fizion' },
    { name: 'organizationName', value: 'Fizion' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des', friendlyName: 'fizion' });
  writeFileSync(file, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
}
