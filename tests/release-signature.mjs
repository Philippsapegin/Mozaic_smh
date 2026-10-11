import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const manifest = JSON.parse(await readFile('release/latest.json', 'utf8'));
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
assert.equal(manifest.version, config.version);
assert.equal(manifest.platforms['windows-x86_64'].url, `https://github.com/Philippsapegin/Mozaic_smh/releases/download/v${config.version}/Mozaic-setup.exe`);
const work = await mkdtemp(join(tmpdir(), 'mozaic-signature-'));
const keyPath = join(work, 'public-key.txt');
const signaturePath = join(work, 'signature.txt');
await writeFile(keyPath, config.plugins.updater.pubkey);
await writeFile(signaturePath, manifest.platforms['windows-x86_64'].signature);
const deps = resolve('src-tauri/target/release/deps');
const libraries = await readdir(deps);
const library = (prefix) => join(deps, libraries.find((name) => name.startsWith(prefix) && name.endsWith('.rlib')));
const executable = join(work, 'verify.exe');
await promisify(execFile)(join(homedir(), '.cargo/bin/rustc.exe'), [resolve('tests/verify-update.rs'), '--edition=2021', '-L', `dependency=${deps}`,
  '--extern', `minisign_verify=${library('libminisign_verify-')}`, '--extern', `base64=${library('libbase64-')}`, '-o', executable], { windowsHide: true });
const result = await promisify(execFile)(executable, [keyPath, signaturePath, resolve(`release/Mozaic-${config.version}-setup.exe`)], { windowsHide: true });
process.stdout.write(result.stdout);
