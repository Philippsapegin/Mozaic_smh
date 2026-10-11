import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { desktop } from './platform.js';

// Dependencies are injected in UI tests; real checks only run in the desktop app.
export function bindUpdates({ hasImage, enabled = desktop, checkUpdate = check, restart = relaunch }) {
  if (!enabled) return;
  const notice = document.getElementById('updateNotice');
  const title = document.getElementById('updateTitle');
  const message = document.getElementById('updateMessage');
  const button = document.getElementById('updateButton');
  const dismiss = document.getElementById('updateDismiss');
  const save = document.getElementById('updateSaveButton');
  const progress = document.getElementById('updateProgress');
  let pending = null;
  let checking = false;
  let busy = false;
  let downloaded = false;
  let confirmed = false;
  let deferredVersion = null;
  let lastCheck = 0;

  async function refresh() {
    if (checking || busy || pending) return;
    checking = true;
    lastCheck = Date.now();
    try {
      const update = await checkUpdate({ timeout: 15000 });
      if (!update) return;
      if (update.version === deferredVersion) { await update.close(); return; }
      pending = update;
      title.textContent = `Мозаика ${update.version} доступна`;
      message.textContent = 'Новая версия готова к установке.';
      notice.classList.remove('hidden');
    } catch {
      // No connection or no published release: keep the editor available offline.
    } finally {
      checking = false;
    }
  }

  dismiss.addEventListener('click', async () => {
    if (busy) return;
    notice.classList.add('hidden');
    deferredVersion = pending?.version;
    const update = pending;
    pending = null;
    downloaded = false;
    confirmed = false;
    progress.classList.add('hidden');
    save.classList.add('hidden');
    button.textContent = 'Обновить';
    await update?.close().catch(() => {});
  });
  save.addEventListener('click', () => document.getElementById('saveButton').click());

  button.addEventListener('click', async () => {
    if (!pending || busy) return;
    if (hasImage() && !confirmed) {
      message.textContent = 'Приложение перезапустится. Сохраните текущую картинку перед обновлением.';
      save.classList.remove('hidden');
      button.textContent = 'Обновить и перезапустить';
      confirmed = true;
      return;
    }
    busy = true;
    button.disabled = true;
    dismiss.disabled = true;
    save.classList.add('hidden');
    try {
      if (!downloaded) {
        let total = 0;
        let received = 0;
        progress.classList.remove('hidden');
        progress.removeAttribute('value');
        message.textContent = 'Скачиваем обновление…';
        button.textContent = 'Загрузка…';
        await pending.download((event) => {
          if (event.event === 'Started') total = event.data.contentLength || 0;
          if (event.event === 'Progress') received += event.data.chunkLength;
          if (total) {
            progress.max = total;
            progress.value = received;
            message.textContent = `Скачиваем обновление… ${Math.min(100, Math.round(received / total * 100))}%`;
          }
        });
        downloaded = true;
      }
      message.textContent = 'Устанавливаем обновление…';
      button.textContent = 'Установка…';
      await pending.install();
      await restart();
    } catch {
      message.textContent = 'Не удалось обновить. Попробуйте ещё раз позже.';
      button.textContent = 'Повторить';
      progress.classList.add('hidden');
      if (hasImage()) save.classList.remove('hidden');
    } finally {
      busy = false;
      button.disabled = false;
      dismiss.disabled = false;
    }
  });

  const timer = setTimeout(refresh, 2500);
  const interval = setInterval(refresh, 4 * 60 * 60 * 1000);
  const onFocus = () => { if (Date.now() - lastCheck >= 60 * 60 * 1000) refresh(); };
  window.addEventListener('focus', onFocus);
  return { refresh, dispose: () => {
    clearTimeout(timer);
    clearInterval(interval);
    window.removeEventListener('focus', onFocus);
    pending?.close().catch(() => {});
  } };
}
