import * as ort from 'onnxruntime-web/wasm';

const INPUT_SIZE = 1280;
let sessionPromise = null;
let queue = Promise.resolve();

async function ensureSession(baseUrl, numThreads) {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = self.crossOriginIsolated ? numThreads : 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = {
      mjs: new URL('ort/ort-wasm-simd-threaded.mjs', baseUrl).href,
      wasm: new URL('ort/ort-wasm-simd-threaded.wasm', baseUrl).href,
    };
    sessionPromise = (async () => {
      const response = await fetch(new URL('models/face_yolov8m.onnx', baseUrl));
      if (!response.ok) throw new Error(`Bundled face model: ${response.status}`);
      return ort.InferenceSession.create(await response.arrayBuffer(), {
        executionProviders: ['wasm'], graphOptimizationLevel: 'all',
      });
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

function prepareInput(bitmap) {
  const ratio = Math.min(INPUT_SIZE / bitmap.width, INPUT_SIZE / bitmap.height);
  const width = Math.round(bitmap.width * ratio);
  const height = Math.round(bitmap.height * ratio);
  const padX = Math.round((INPUT_SIZE - width) / 2 - 0.1);
  const padY = Math.round((INPUT_SIZE - height) / 2 - 0.1);
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#727272';
  context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  context.drawImage(bitmap, padX, padY, width, height);
  const rgba = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
  const plane = INPUT_SIZE * INPUT_SIZE;
  const data = new Float32Array(plane * 3);
  for (let index = 0; index < plane; index++) {
    data[index] = rgba[index * 4] / 255;
    data[index + plane] = rgba[index * 4 + 1] / 255;
    data[index + plane * 2] = rgba[index * 4 + 2] / 255;
  }
  return { tensor: new ort.Tensor('float32', data, [1, 3, INPUT_SIZE, INPUT_SIZE]), ratio, padX, padY };
}

function overlap(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const intersection = width * height;
  return intersection / (a.w * a.h + b.w * b.h - intersection);
}

function decodeFaces(output, transform, imageWidth, imageHeight) {
  if (output.dims.length !== 3 || output.dims[1] !== 5) throw new Error('Unexpected face model output');
  const count = output.dims[2];
  const { data } = output;
  const { ratio, padX, padY } = transform;
  const candidates = [];
  const clamp = (value, maximum) => Math.max(0, Math.min(maximum, value));
  for (let index = 0; index < count; index++) {
    const score = data[index + count * 4];
    if (score < 0.32) continue;
    const cx = data[index];
    const cy = data[index + count];
    const width = data[index + count * 2];
    const height = data[index + count * 3];
    const left = clamp((cx - width / 2 - padX) / ratio, imageWidth);
    const top = clamp((cy - height / 2 - padY) / ratio, imageHeight);
    const right = clamp((cx + width / 2 - padX) / ratio, imageWidth);
    const bottom = clamp((cy + height / 2 - padY) / ratio, imageHeight);
    if (right > left && bottom > top) candidates.push({ x: left, y: top, w: right - left, h: bottom - top, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of candidates) {
    if (!selected.some((face) => overlap(candidate, face) > 0.7)) selected.push(candidate);
    if (selected.length >= 100) break;
  }
  return selected;
}

self.onmessage = ({ data: { id, bitmap, baseUrl, numThreads } }) => {
  queue = queue.then(async () => {
    let tensor;
    let outputs;
    try {
      const session = await ensureSession(baseUrl, numThreads);
      const transform = prepareInput(bitmap);
      tensor = transform.tensor;
      outputs = await session.run({ [session.inputNames[0]]: tensor });
      const faces = decodeFaces(outputs[session.outputNames[0]], transform, bitmap.width, bitmap.height);
      self.postMessage({ id, faces });
    } catch (error) {
      self.postMessage({ id, error: error.message || String(error) });
    } finally {
      bitmap.close();
      tensor?.dispose();
      if (outputs) Object.values(outputs).forEach((output) => output.dispose());
    }
  });
};
