import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const comfyHome = process.env.COMFYUI_HOME || 'D:\\AI\\ComfyUI_windows_portable';
const python = resolve(comfyHome, 'python_embeded', 'python.exe');
if (!existsSync(python)) {
  process.stderr.write(`ComfyUI Python not found: ${python}\n`);
  process.exit(1);
}
const service = spawn(python, [resolve('face_check', 'server.py')], {
  stdio: 'inherit',
  env: { ...process.env, COMFYUI_HOME: comfyHome },
});
service.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => service.kill(signal));
}
