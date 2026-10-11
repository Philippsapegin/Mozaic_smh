import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeShortcut } from './shortcut.mjs';

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

const setup = `release/Mozaic-${version}-setup.exe`;
const signature = (await readFile(`src-tauri/target/release/bundle/nsis/${installer}.sig`, 'utf8')).trim();
await writeFile('release/Mozaic-setup.exe.sig', `${signature}\n`);
await writeFile('release/latest.json', `${JSON.stringify({
  version, notes: 'Новая версия Мозаики.', pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': { signature, url: `https://github.com/Philippsapegin/Mozaic_smh/releases/download/v${version}/Mozaic-setup.exe` },
  },
}, null, 2)}\n`);
await copyFile(setup, 'Установить Мозаику.exe');
await writeShortcut('Мозаика.lnk', '.\\Мозаика.cmd', '.\\src-tauri\\icons\\icon.ico');

const folder = resolve('release', `windows-${version}`);
await mkdir(resolve(folder, 'app'), { recursive: true });
await copyFile(`release/Mozaic-${version}.exe`, resolve(folder, 'app/Mozaic.exe'));
await copyFile('src-tauri/icons/icon.ico', resolve(folder, 'app/icon.ico'));
await copyFile('scripts/launch.ps1', resolve(folder, 'app/launch.ps1'));
await copyFile(setup, resolve(folder, 'Установить Мозаику.exe'));
await writeFile(resolve(folder, 'app/Мозаика.cmd'), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1"\r\n');
await writeShortcut(resolve(folder, 'Мозаика.lnk'), '.\\app\\Мозаика.cmd', '.\\app\\icon.ico');
await writeFile(resolve(folder, 'README.txt'),
  'Мозаика\r\n\r\nОткройте ярлык «Мозаика» для запуска.\r\nДля установки запустите «Установить Мозаику.exe».\r\n\r\nИнтернет нужен только для обновлений. Фото обрабатываются на вашем компьютере.\r\n');
await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/package-zip.ps1'),
  '-Source', folder, '-Archive', resolve('release/Mozaic-Windows.zip')], { windowsHide: true });
const zip = await readFile('release/Mozaic-Windows.zip');
await writeFile('release/SHA256SUMS.txt', `${checksums.join('\n')}\n${checksums[1].split('  ')[0]}  Mozaic-setup.exe\n${createHash('sha256').update(zip).digest('hex')}  Mozaic-Windows.zip\n`);
process.stdout.write(`Root shortcut and installer ready; Windows download: release/Mozaic-Windows.zip (${(zip.length / 1024 / 1024).toFixed(1)} MiB)\n`);
