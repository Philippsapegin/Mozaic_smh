import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import { promisify } from 'node:util';

// MS-SHLLINK: relative target, Unicode StringData, no machine-specific paths.
export async function writeShortcut(path, target, icon = '') {
  const work = await mkdtemp(join(tmpdir(), 'mozaic-link-'));
  const template = join(work, 'template.lnk');
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('scripts/create-shortcut.ps1'),
    '-Shortcut', template, '-Target', win32.basename(target)], { windowsHide: true });
  const native = await readFile(template);
  const flags = native.readUInt32LE(20);
  let offset = 76;
  if (flags & 1) offset += 2 + native.readUInt16LE(offset);
  if (flags & 2) offset += native.readUInt32LE(offset);
  const prefix = Buffer.from(native.subarray(0, offset));
  prefix.writeUInt32LE((flags & 3) | 0x88 | (icon ? 0x40 : 0), 20);
  const stringData = (value) => {
    const length = Buffer.alloc(2);
    length.writeUInt16LE(value.length);
    return Buffer.concat([length, Buffer.from(value, 'utf16le')]);
  };
  // Keep Windows' native target metadata, replace the path with a relative one,
  // and omit tracking blocks and working directories tied to this computer.
  await writeFile(path, Buffer.concat([prefix, stringData(target), ...(icon ? [stringData(icon)] : []), Buffer.alloc(4)]));
}
