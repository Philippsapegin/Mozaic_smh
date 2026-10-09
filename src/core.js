export const REFERENCE_WIDTH = 1080;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function imageUnit(value, width) {
  return value * width / REFERENCE_WIDTH;
}

export function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function pointInRect(point, rect) {
  return point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.w && point.y <= rect.y + rect.h;
}

export function rotatePoint(point, width, height, clockwise) {
  return clockwise
    ? { x: height - point.y, y: point.x }
    : { x: point.y, y: width - point.x };
}

export function rotateRect(rect, width, height, clockwise) {
  const a = rotatePoint({ x: rect.x, y: rect.y }, width, height, clockwise);
  const b = rotatePoint({ x: rect.x + rect.w, y: rect.y + rect.h }, width, height, clockwise);
  return normalizeRect(a, b);
}

export function resizeCrop(initial, handle, start, current, width, height) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const minSize = Math.max(8, imageUnit(20, width));
  if (handle === 'move') {
    return {
      ...initial,
      x: clamp(initial.x + dx, 0, width - initial.w),
      y: clamp(initial.y + dy, 0, height - initial.h),
    };
  }
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.w;
  let bottom = initial.y + initial.h;
  if (handle.includes('left')) left = clamp(initial.x + dx, 0, right - minSize);
  if (handle.includes('right')) right = clamp(initial.x + initial.w + dx, left + minSize, width);
  if (handle.includes('top')) top = clamp(initial.y + dy, 0, bottom - minSize);
  if (handle.includes('bottom')) bottom = clamp(initial.y + initial.h + dy, top + minSize, height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function expandedFaceBox(box, width, height, factor = 0.22) {
  const xPad = box.w * factor;
  const yPad = box.h * factor;
  const left = clamp(box.x - xPad, 0, width);
  const top = clamp(box.y - yPad, 0, height);
  const right = clamp(box.x + box.w + xPad, 0, width);
  const bottom = clamp(box.y + box.h + yPad, 0, height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}
