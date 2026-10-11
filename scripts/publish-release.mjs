import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { githubHeaders, githubRequest, repository } from './github.mjs';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = `v${version}`;
const manifest = JSON.parse(await readFile('release/latest.json', 'utf8'));
if (manifest.version !== version || !manifest.platforms['windows-x86_64'].signature) throw new Error('Build signed release artifacts first.');
const files = [
  [`release/Mozaic-${version}-setup.exe`, 'Mozaic-setup.exe', 'application/octet-stream'],
  ['release/Mozaic-Windows.zip', 'Mozaic-Windows.zip', 'application/zip'],
  ['release/Mozaic-setup.exe.sig', 'Mozaic-setup.exe.sig', 'text/plain'],
  ['release/latest.json', 'latest.json', 'application/json'],
  ['release/SHA256SUMS.txt', 'SHA256SUMS.txt', 'text/plain'],
];
for (const [path] of files) await stat(path);
let release = await githubRequest(`/releases/tags/${tag}`).catch((error) => {
  if (error.status !== 404) throw error;
  return null;
});
if (release && !release.draft) throw new Error(`${tag} is already published. Increase the application version instead of replacing it.`);
if (!release) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
  release = await githubRequest('/releases', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag, target_commitish: commit, name: `Мозаика ${version}`, draft: true, prerelease: false,
      body: 'Редактор фото и документов для журналистов.\n\nСкачайте **Mozaic-Windows.zip** и распакуйте архив. В корне находятся ярлык **«Мозаика»** и **«Установить Мозаику.exe»**.\n\nВ этой версии: мягкая тень бабблов и хвостиков, уведомления и установка подписанных обновлений, удобный запуск из корня.\n\nДля работы не нужен сервер. Фото обрабатываются локально.',
    }),
  });
}
for (const [path, name, type] of files) {
  const existing = release.assets.find((asset) => asset.name === name);
  if (existing) await githubRequest(`/releases/assets/${existing.id}`, { method: 'DELETE' });
  const { size } = await stat(path);
  let transferred = 0;
  let logged = Date.now();
  const progress = new Transform({ transform(chunk, encoding, callback) {
    transferred += chunk.length;
    if (Date.now() - logged >= 15000) {
      process.stdout.write(`${name}: ${(transferred / size * 100).toFixed(0)}% uploaded\n`);
      logged = Date.now();
    }
    callback(null, chunk);
  } });
  process.stdout.write(`Uploading ${name} (${(size / 1024 / 1024).toFixed(1)} MiB)\n`);
  const response = await fetch(`${release.upload_url.replace(/\{.*$/, '')}?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { ...githubHeaders(), 'Content-Type': type, 'Content-Length': String(size) },
    body: createReadStream(path).pipe(progress), duplex: 'half',
  });
  if (!response.ok) throw new Error(`Upload of ${name} failed (${response.status}); the release remains a draft.`);
  const asset = await response.json();
  if (asset.size !== size) throw new Error(`GitHub received an incomplete ${name}; the release remains a draft.`);
}
await githubRequest(`/releases/${release.id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ draft: false, make_latest: 'true' }),
});
process.stdout.write(`Published https://github.com/${repository}/releases/tag/${tag}\n`);
