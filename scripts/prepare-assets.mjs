import { copyFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const assets = [
  'blaze_face_full_range.tflite',
  'face_landmarker.task',
  'face_yolov8m.onnx',
];
for (const asset of assets) {
  const path = resolve('public/models', asset);
  if (!(await stat(path).catch(() => null))?.isFile()) {
    throw new Error(`Missing bundled model: ${path}`);
  }
}
await mkdir('public/ort', { recursive: true });
for (const asset of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await copyFile(resolve('node_modules/onnxruntime-web/dist', asset), resolve('public/ort', asset));
}
