import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
const cargoBin = join(env.USERPROFILE || env.HOME || '', '.cargo', 'bin');
if (existsSync(cargoBin)) env[pathKey] = `${cargoBin}${delimiter}${env[pathKey] || ''}`;
const child = spawn(process.execPath, [resolve('node_modules/@tauri-apps/cli/tauri.js'), ...process.argv.slice(2)], {
  stdio: 'inherit', env,
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
