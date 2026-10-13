import assert from 'node:assert/strict';
import { averageBlocks } from '../src/mosaic.js';

const image = (width, height, pixels) => ({ width, height, data: new Uint8ClampedArray(pixels.flat()) });
assert.deepEqual([...averageBlocks(image(2, 2, [
  [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255],
]), 2).data], [128, 128, 128, 255], 'Balanced colored fringes introduced a color cast');

const neutral = Array.from({ length: 32 * 32 }, (_, index) => {
  const gray = index % 256;
  return [gray, Math.min(255, gray + 2), gray, 255];
});
const gray = [...averageBlocks(image(32, 32, neutral), 32).data];
assert.ok(Math.max(...gray.slice(0, 3)) - Math.min(...gray.slice(0, 3)) <= 2, 'Near-neutral pixels gained saturation');

assert.deepEqual([...averageBlocks(image(2, 2, Array(4).fill([210, 170, 120, 255])), 2).data],
  [210, 170, 120, 255], 'A colored photo was desaturated');
assert.deepEqual([...averageBlocks(image(2, 1, [[255, 0, 0, 0], [0, 0, 255, 255]]), 2).data],
  [0, 0, 255, 128], 'Invisible pixels tinted a transparent block');
assert.deepEqual([...averageBlocks(image(3, 1, [[0, 0, 0, 255], [100, 100, 100, 255], [240, 240, 240, 255]]), 2).data],
  [50, 50, 50, 255, 240, 240, 240, 255], 'The partial block at the image edge used unrelated pixels');
process.stdout.write('Mosaic passed: neutral documents, balanced fringes, original colors, transparency, partial edge blocks.\n');
