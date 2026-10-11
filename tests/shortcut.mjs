import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { writeShortcut } from '../scripts/shortcut.mjs';

const work = await mkdtemp(join(tmpdir(), 'mozaic-shortcut-'));
const original = join(work, 'Original');
const relocated = join(work, 'Копия архива');
await mkdir(original);
await mkdir(relocated);
await writeFile(join(original, 'Мозаика.cmd'), '@echo off\r\necho relocated>"%~dp0proof.txt"\r\n');
await writeShortcut(join(original, 'Мозаика.lnk'), '.\\Мозаика.cmd');
await copyFile(join(original, 'Мозаика.cmd'), join(relocated, 'Мозаика.cmd'));
await copyFile(join(original, 'Мозаика.lnk'), join(relocated, 'Мозаика.lnk'));
await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('tests/shortcut-launch.ps1'),
  '-Shortcut', join(relocated, 'Мозаика.lnk'), '-WorkingDirectory', tmpdir()], { windowsHide: true });
for (let i = 0; i < 50; i++) {
  const result = await readFile(join(relocated, 'proof.txt'), 'utf8').catch(() => '');
  if (result.trim() === 'relocated') break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
assert.equal((await readFile(join(relocated, 'proof.txt'), 'utf8')).trim(), 'relocated');
assert.equal(await readFile(join(original, 'proof.txt'), 'utf8').catch(() => ''), '');
process.stdout.write('Shortcut passed: moved archive, Unicode path, unrelated working directory.\n');
