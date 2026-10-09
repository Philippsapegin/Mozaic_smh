import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { version } = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('release', { recursive: true });
const installer = (await readdir('src-tauri/target/release/bundle/nsis')).find((name) => name.includes(`_${version}_`) && name.endsWith('-setup.exe'));
if (!installer) throw new Error(`Windows installer ${version} was not generated`);
const artifacts = [
  ['src-tauri/target/release/mozaic.exe', `Mozaic-${version}.exe`],
  [`src-tauri/target/release/bundle/nsis/${installer}`, `Mozaic-${version}-setup.exe`],
];
const checksums = [];
for (const [source, name] of artifacts) {
  const target = resolve('release', name);
  await copyFile(source, target);
  const bytes = await readFile(target);
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  process.stdout.write(`${target} (${(bytes.length / 1024 / 1024).toFixed(1)} MiB)\n`);
}
await writeFile('release/SHA256SUMS.txt', `${checksums.join('\n')}\n`);
await writeFile('release/README.txt',
  `Mozaic\r\n\r\nMozaic-${version}.exe: запуск без установки (нужен Microsoft Edge WebView2 Runtime).\r\n`
  + `Mozaic-${version}-setup.exe: установка для текущего пользователя. WebView2 входит в установщик.\r\n`
  + '\r\nСервер, Python, ComfyUI и интернет для работы не нужны. Все модели и шрифты встроены.\r\n', 'utf8');
