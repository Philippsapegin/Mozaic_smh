import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';

export const desktop = isTauri();
const imageTypes = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp',
};
let sourcePath = null;

async function imageFromPath(path) {
  const name = path.split(/[\\/]/).at(-1);
  const extension = name.split('.').at(-1).toLowerCase();
  if (!imageTypes[extension]) throw new Error('Выберите файл изображения.');
  const bytes = await readFile(path);
  sourcePath = path;
  return new File([bytes], name, { type: imageTypes[extension] });
}

export async function chooseImage() {
  const path = await open({
    title: 'Открыть изображение', multiple: false, directory: false,
    filters: [{ name: 'Изображения', extensions: Object.keys(imageTypes) }],
  });
  return path ? imageFromPath(path) : null;
}

export async function saveImage(blob, name) {
  if (desktop) {
    const directory = sourcePath?.replace(/[^\\/]+$/, '') || '';
    const path = await save({
      title: 'Сохранить PNG', defaultPath: `${directory}${name}`,
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

export function bindNativeDrops(onFile, onHover, onError) {
  return getCurrentWebview().onDragDropEvent(async ({ payload }) => {
    onHover(payload.type === 'enter' || payload.type === 'over');
    if (payload.type !== 'drop') return;
    const path = payload.paths.find((item) => imageTypes[item.split('.').at(-1).toLowerCase()]);
    try {
      if (!path) throw new Error('Перетащите файл изображения.');
      await onFile(await imageFromPath(path));
    } catch (error) {
      onError(error);
    }
  });
}
