let worker = null;
let nextRequest = 0;
const pending = new Map();

function resetWorker(error) {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) {
    clearTimeout(request.timeout);
    request.reject(error);
  }
  pending.clear();
}

export async function detectFacesOffline(image) {
  const bitmap = await createImageBitmap(image);
  if (!worker) {
    worker = new Worker(new URL('./face-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      clearTimeout(request.timeout);
      pending.delete(data.id);
      if (data.error) request.reject(new Error(data.error));
      else request.resolve(data.faces);
    };
    worker.onerror = (event) => resetWorker(new Error(event.message || 'Face worker failed'));
  }
  const id = ++nextRequest;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resetWorker(new Error('Face detection timed out')), 120000);
    pending.set(id, { resolve, reject, timeout });
    // WebView2 can stall nested WASM workers under Tauri's asset protocol.
    // Keep inference in its own worker, using one WASM thread on desktop.
    const numThreads = isTauri() ? 1 : Math.min(4, navigator.hardwareConcurrency || 1);
    worker.postMessage({ id, bitmap, numThreads, baseUrl: new URL(import.meta.env.BASE_URL, window.location.href).href }, [bitmap]);
  });
}
import { isTauri } from '@tauri-apps/api/core';
