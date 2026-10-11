import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const key = join(homedir(), '.tauri', 'mozaic-update.key');
const configPath = 'src-tauri/tauri.conf.json';
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (!existsSync(key)) {
  if (config.plugins.updater.pubkey) throw new Error('The existing signing key is missing. Restore it; do not replace it.');
  await mkdir(join(homedir(), '.tauri'), { recursive: true });
  execFileSync(process.execPath, [resolve('node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'generate', '--ci', '-p', '', '-w', key], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
const publicKey = (await readFile(`${key}.pub`, 'utf8')).trim();
if (config.plugins.updater.pubkey && config.plugins.updater.pubkey !== publicKey) throw new Error('The signing key does not match this application.');
config.plugins.updater.pubkey = publicKey;
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
process.stdout.write('Update signing configured. The private key stays outside the project.\n');
