import { FaceDetector, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { clamp, expandedFaceBox, imageUnit, normalizeRect, pointInRect, resizeCrop, rotatePoint, rotateRect } from './core.js';
import './style.css';
import { detectFacesOffline } from './offline-faces.js';
import { bindNativeDrops, chooseImage, desktop, saveImage } from './platform.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('editorCanvas');
const ctx = canvas.getContext('2d');
const fileInput = $('fileInput');
const faceList = $('faceList');
const markerList = $('markerList');
const bubbleList = $('bubbleList');
const bubbleText = $('bubbleText');
const grainRange = $('grainRange');
const brushRange = $('brushRange');
const fontRange = $('fontRange');

let sourceBitmap = null;
let sourceName = '';
let baseCanvas = null;
let faceDetectorPromise = null;
let faceLandmarkerPromise = null;
let detectionToken = 0;
let nextId = 1;
let view = { x: 0, y: 0, scale: 1, width: 0, height: 0, dpr: 1 };
let state = freshState();
let undoStack = [];
let redoStack = [];
let pointerAction = null;
let draftMarker = null;
let hover = null;
let textEditSession = false;
let renderScheduled = false;
let toastTimeout = null;

const cache = {
  pixelated: null,
  mosaicMask: null,
  mosaicOverlay: null,
  markerMask: null,
  pixelDirty: true,
  mosaicDirty: true,
  markerDirty: true,
};

function freshState() {
  return {
    tool: 'mosaic',
    rotation: 0,
    grain: 32,
    brushSize: 44,
    fontSize: 26,
    cropEnabled: false,
    cropEditing: false,
    crop: null,
    faces: [],
    strokes: [],
    markers: [],
    bubbles: [],
    selectedFaceId: null,
    selectedBubbleId: null,
  };
}

function makeCanvas(width, height) {
  const result = document.createElement('canvas');
  result.width = Math.max(1, Math.ceil(width));
  result.height = Math.max(1, Math.ceil(height));
  return result;
}

function reuseCanvas(existing, width, height) {
  if (existing && existing.width === width && existing.height === height) {
    existing.getContext('2d').clearRect(0, 0, width, height);
    return existing;
  }
  return makeCanvas(width, height);
}

function size() {
  return baseCanvas ? { w: baseCanvas.width, h: baseCanvas.height } : { w: 0, h: 0 };
}

function snapshot() {
  return structuredClone(state);
}

function remember() {
  if (!baseCanvas) return;
  undoStack.push(snapshot());
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  updateControls();
}

function restore(next) {
  const rotationChanged = state.rotation !== next.rotation;
  state = next;
  if (rotationChanged) rebuildBase();
  grainRange.value = String(state.grain);
  brushRange.value = String(state.brushSize);
  fontRange.value = String(state.fontSize);
  cache.pixelDirty = true;
  cache.mosaicDirty = true;
  cache.markerDirty = true;
  updateToolUI();
  updatePanels();
  updateControls();
  if (rotationChanged) fitView();
  requestRender();
}

function undo() {
  if (!undoStack.length) return;
  textEditSession = false;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  textEditSession = false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => element.classList.remove('visible'), 3200);
}

function rebuildBase() {
  if (!sourceBitmap) return;
  const quarter = state.rotation % 4;
  const width = quarter % 2 ? sourceBitmap.height : sourceBitmap.width;
  const height = quarter % 2 ? sourceBitmap.width : sourceBitmap.height;
  baseCanvas = makeCanvas(width, height);
  const context = baseCanvas.getContext('2d');
  context.save();
  if (quarter === 1) {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  } else if (quarter === 2) {
    context.translate(width, height);
    context.rotate(Math.PI);
  } else if (quarter === 3) {
    context.translate(0, height);
    context.rotate(-Math.PI / 2);
  }
  context.drawImage(sourceBitmap, 0, 0);
  context.restore();
  cache.pixelDirty = true;
  cache.mosaicDirty = true;
  cache.markerDirty = true;
}

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('Выберите файл изображения.');
    return;
  }
  const token = ++detectionToken;
  try {
    const bitmap = await createImageBitmap(file);
    if (token !== detectionToken) {
      bitmap.close();
      return;
    }
    if (sourceBitmap) sourceBitmap.close();
    sourceBitmap = bitmap;
    sourceName = file.name.replace(/\.[^.]+$/, '') || 'изображение';
    state = freshState();
    undoStack = [];
    redoStack = [];
    nextId = 1;
    draftMarker = null;
    pointerAction = null;
    rebuildBase();
    const { w, h } = size();
    state.crop = { x: 0, y: 0, w, h };
    $('emptyState').classList.add('hidden');
    stage.classList.remove('no-image');
    $('faceStatus').textContent = 'Ищем лица на изображении…';
    fileInput.value = '';
    fitView();
    updatePanels();
    updateControls();
    requestRender();
    await detectFaces(token);
  } catch (error) {
    console.error('Image load failed', error);
    toast('Не удалось открыть изображение.');
  }
}

function fitView() {
  if (!baseCanvas || !view.width || !view.height) return;
  const { w, h } = size();
  view.scale = Math.min((view.width - 64) / w, (view.height - 116) / h);
  view.x = (view.width - w * view.scale) / 2;
  view.y = (view.height - h * view.scale) / 2 - 14;
  requestRender();
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  view.width = rect.width;
  view.height = rect.height;
  view.dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * view.dpr));
  canvas.height = Math.max(1, Math.round(rect.height * view.dpr));
  if (baseCanvas) fitView(); else requestRender();
}

function stagePoint(event) {
  const rect = stage.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function screenToDoc(point) {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
}

function docToScreen(point) {
  return { x: view.x + point.x * view.scale, y: view.y + point.y * view.scale };
}

function clampDoc(point) {
  const { w, h } = size();
  return { x: clamp(point.x, 0, w), y: clamp(point.y, 0, h) };
}

function inDocument(point) {
  const { w, h } = size();
  return point.x >= 0 && point.y >= 0 && point.x <= w && point.y <= h;
}

function setTool(tool) {
  state.tool = tool;
  state.cropEditing = false;
  updateToolUI();
  updateControls();
  requestRender();
}

function updateToolUI() {
  for (const button of document.querySelectorAll('[data-tool]')) {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('mosaicPanel').classList.toggle('hidden', state.tool !== 'mosaic');
  $('markerPanel').classList.toggle('hidden', state.tool !== 'marker');
  $('bubblePanel').classList.toggle('hidden', state.tool !== 'bubble');
  $('stageHint').textContent = state.cropEditing
    ? 'Перетаскивайте края рамки · Сохранится область внутри неё'
    : state.tool === 'mosaic'
      ? 'ЛКМ — мозаика · ПКМ — стереть · Колесо — размер кисти'
      : state.tool === 'marker'
        ? 'ЛКМ — прямоугольник · ПКМ — удалить последний'
        : 'Клик — новый баббл · перетаскивайте тело и кончик отдельно';
}

function updateControls() {
  const loaded = Boolean(baseCanvas);
  for (const id of ['cropButton', 'rotateLeftButton', 'rotateRightButton', 'saveButton']) {
    $(id).disabled = !loaded;
  }
  $('cropButton').classList.toggle('active', state.cropEnabled);
  $('cropButton').setAttribute('aria-pressed', String(state.cropEnabled));
  $('resetCropButton').classList.toggle('hidden', !state.cropEnabled);
  $('resetCropButton').disabled = !loaded || !state.cropEnabled;
}

function setFaceStatus(message) {
  $('faceStatus').textContent = message;
}

function sameFace(a, b) {
  const overlapWidth = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const overlapHeight = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const smallerArea = Math.min(a.w * a.h, b.w * b.h);
  const centerDistance = Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2);
  return (smallerArea > 0 && overlapWidth * overlapHeight / smallerArea > 0.5)
    || centerDistance < Math.min(a.w, a.h, b.w, b.h) * 0.3;
}

async function ensureDetector() {
  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      const wasmPath = `${import.meta.env.BASE_URL}wasm`;
      const modelPath = `${import.meta.env.BASE_URL}models/blaze_face_full_range.tflite`;
      const vision = await FilesetResolver.forVisionTasks(wasmPath);
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.42,
      });
    })().catch((error) => {
      faceDetectorPromise = null;
      throw error;
    });
  }
  return faceDetectorPromise;
}

async function ensureLandmarker() {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}wasm`);
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate: 'CPU' },
        runningMode: 'IMAGE',
        numFaces: 1,
        minFaceDetectionConfidence: 0.35,
        minFacePresenceConfidence: 0.35,
      });
    })().catch((error) => {
      faceLandmarkerPromise = null;
      throw error;
    });
  }
  return faceLandmarkerPromise;
}

function faceContourForBox(landmarker, image, box) {
  const crop = expandedFaceBox(box, image.width, image.height, 0.35);
  const scale = 384 / Math.max(crop.w, crop.h);
  const sample = makeCanvas(crop.w * scale, crop.h * scale);
  sample.getContext('2d').drawImage(image, crop.x, crop.y, crop.w, crop.h, 0, 0, sample.width, sample.height);
  const landmarks = landmarker.detect(sample).faceLandmarks[0];
  if (!landmarks) return null;
  const points = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.map(({ start }) => landmarks[start]).filter(Boolean)
    .map((point) => ({ x: crop.x + point.x * crop.w, y: crop.y + point.y * crop.h }));
  if (points.length !== FaceLandmarker.FACE_LANDMARKS_FACE_OVAL.length) return null;
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const expected = expandedFaceBox(box, image.width, image.height, 0.25);
  if (!pointInRect({ x: centerX, y: centerY }, expected)
    || right - left < box.w * 0.35 || bottom - top < box.h * 0.35) return null;
  // The landmark oval hugs the skin; this margin also hides the ears and hairline.
  return points.map((point) => ({
    x: clamp(centerX + (point.x - centerX) * 1.2, 0, image.width),
    y: clamp(centerY + (point.y - centerY) * 1.2, 0, image.height),
  }));
}

async function detectFaces(expectedToken = ++detectionToken) {
  if (!baseCanvas) return;
  setFaceStatus('Ищем лица на изображении…');
  const image = baseCanvas;
  const primary = ensureDetector().then((detector) => {
    const result = detector.detect(image);
    return (result.detections || []).map((entry) => entry.boundingBox).filter(Boolean).map((box) => ({
      x: box.originX, y: box.originY, w: box.width, h: box.height,
    }));
  });
  const secondary = detectFacesOffline(image);
  const [mediapipe, yolo] = await Promise.allSettled([primary, secondary]);
  if (expectedToken !== detectionToken || !baseCanvas) return;
  if (mediapipe.status === 'rejected') console.error('MediaPipe detection failed', mediapipe.reason);
  if (yolo.status === 'rejected') console.warn('Offline face check unavailable', yolo.reason);
  const candidates = [
    ...(mediapipe.status === 'fulfilled' ? mediapipe.value : []),
    ...(yolo.status === 'fulfilled' ? yolo.value : []),
  ];
  const unique = [];
  for (const box of candidates) {
    if (box.w > 0 && box.h > 0 && !unique.some((existing) => sameFace(box, existing))) unique.push(box);
  }
  const { w, h } = size();
  let landmarker = null;
  if (unique.length) {
    try {
      landmarker = await ensureLandmarker();
    } catch (error) {
      console.warn('Face contours unavailable', error);
    }
  }
  if (expectedToken !== detectionToken || !baseCanvas) return;
  const faces = [];
  for (const box of unique) {
    if (expectedToken !== detectionToken || !baseCanvas) return;
    let contour = null;
    if (landmarker) {
      try {
        contour = faceContourForBox(landmarker, image, box);
      } catch (error) {
        console.warn('Face contour detection failed', error);
        landmarker = null;
      }
    }
    faces.push({ id: nextId++, box: expandedFaceBox(box, w, h), contour, enabled: true });
    if (faces.length % 4 === 0) await new Promise(requestAnimationFrame);
  }
  if (expectedToken !== detectionToken || !baseCanvas) return;
  state.faces = faces;
  state.selectedFaceId = null;
  cache.mosaicDirty = true;
  setFaceStatus(
    mediapipe.status === 'rejected' && yolo.status === 'rejected'
      ? 'Поиск лиц недоступен. Используйте кисть.'
      : yolo.status === 'rejected'
        ? 'Дополнительный поиск недоступен; показаны результаты MediaPipe.'
        : state.faces.length ? '' : 'Лица не найдены.',
  );
  updatePanels();
  requestRender();
}

function makeFaceThumb(box) {
  const thumb = makeCanvas(106, 98);
  const thumbCtx = thumb.getContext('2d');
  thumbCtx.fillStyle = '#e7eae3';
  thumbCtx.fillRect(0, 0, thumb.width, thumb.height);
  const side = Math.max(box.w, box.h);
  const sx = clamp(box.x + box.w / 2 - side / 2, 0, Math.max(0, baseCanvas.width - side));
  const sy = clamp(box.y + box.h / 2 - side / 2, 0, Math.max(0, baseCanvas.height - side));
  thumbCtx.drawImage(baseCanvas, sx, sy, Math.min(side, baseCanvas.width - sx), Math.min(side, baseCanvas.height - sy), 0, 0, 106, 98);
  return thumb.toDataURL('image/png');
}

function updatePanels() {
  $('grainValue').textContent = state.grain;
  $('brushValue').textContent = state.brushSize;
  $('fontValue').textContent = state.fontSize;
  $('faceCount').textContent = state.faces.length;
  $('markerCount').textContent = state.markers.length;
  $('bubbleCount').textContent = state.bubbles.length;

  faceList.replaceChildren();
  state.faces.forEach((face, index) => {
    const row = document.createElement('div');
    row.className = `face-row${face.id === state.selectedFaceId ? ' selected' : ''}`;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Показать лицо ${index + 1}`);
    const thumb = document.createElement('img');
    thumb.className = 'face-thumb';
    thumb.src = makeFaceThumb(face.box);
    thumb.alt = '';
    const label = document.createElement('span');
    label.className = 'face-name';
    label.textContent = `Лицо ${index + 1}`;
    const toggle = document.createElement('label');
    toggle.className = 'switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = face.enabled;
    input.setAttribute('aria-label', `Закрыть мозаикой лицо ${index + 1}`);
    input.addEventListener('change', () => {
      remember();
      face.enabled = input.checked;
      cache.mosaicDirty = true;
      requestRender();
      updateControls();
    });
    const track = document.createElement('span');
    toggle.append(input, track);
    row.append(thumb, label, toggle);
    row.addEventListener('click', (event) => {
      if (event.target.closest('.switch')) return;
      state.selectedFaceId = face.id;
      updatePanels();
      requestRender();
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        state.selectedFaceId = face.id;
        updatePanels();
        requestRender();
      }
    });
    faceList.append(row);
  });

  markerList.replaceChildren();
  if (!state.markers.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = 'Пока нет выделений';
    markerList.append(empty);
  } else {
    state.markers.forEach((marker, index) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      const name = document.createElement('span');
      name.textContent = `Выделение ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Удалить выделение ${index + 1}`;
      remove.addEventListener('click', () => {
        remember();
        state.markers = state.markers.filter((entry) => entry.id !== marker.id);
        cache.markerDirty = true;
        updatePanels();
        requestRender();
      });
      row.append(name, remove);
      markerList.append(row);
    });
  }
  bubbleList.replaceChildren();
  if (!state.bubbles.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-list';
    empty.textContent = 'Кликните по изображению, чтобы добавить баббл';
    bubbleList.append(empty);
  } else {
    state.bubbles.forEach((bubble, index) => {
      const row = document.createElement('div');
      row.className = `list-row${bubble.id === state.selectedBubbleId ? ' selected' : ''}`;
      row.tabIndex = 0;
      const name = document.createElement('span');
      name.textContent = bubble.text.trim().split('\n')[0].slice(0, 27) || `Баббл ${index + 1}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = `Удалить баббл ${index + 1}`;
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteBubble(bubble.id);
      });
      row.addEventListener('click', () => selectBubble(bubble.id));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectBubble(bubble.id);
        }
      });
      row.append(name, remove);
      bubbleList.append(row);
    });
  }
  const selected = state.bubbles.find((bubble) => bubble.id === state.selectedBubbleId);
  bubbleText.disabled = !selected;
  bubbleText.value = selected?.text ?? '';
  fontRange.disabled = !selected;
  fontRange.value = String(selected?.fontSize ?? state.fontSize);
  $('fontValue').textContent = selected?.fontSize ?? state.fontSize;
  $('boldButton').disabled = !selected;
  $('boldButton').classList.toggle('active', Boolean(selected?.bold));
  $('boldButton').setAttribute('aria-pressed', String(Boolean(selected?.bold)));
}

function drawStroke(context, stroke) {
  const points = stroke.points;
  if (!points.length) return;
  context.save();
  context.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over';
  context.strokeStyle = '#fff';
  context.fillStyle = '#fff';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = stroke.size;
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) context.lineTo(points[i].x, points[i].y);
    context.stroke();
  }
  context.restore();
}

function traceFacePath(context, face) {
  context.beginPath();
  if (!face.contour?.length) {
    const { x, y, w, h } = face.box;
    context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    return;
  }
  const points = face.contour;
  const last = points.at(-1);
  context.moveTo((last.x + points[0].x) / 2, (last.y + points[0].y) / 2);
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  context.closePath();
}

function ensurePixelated() {
  if (!cache.pixelDirty && cache.pixelated) return;
  const { w, h } = size();
  const cell = Math.max(2, Math.round(imageUnit(state.grain, w)));
  const small = makeCanvas(Math.ceil(w / cell), Math.ceil(h / cell));
  small.getContext('2d').drawImage(baseCanvas, 0, 0, small.width, small.height);
  cache.pixelated = makeCanvas(w, h);
  const pixelCtx = cache.pixelated.getContext('2d');
  pixelCtx.imageSmoothingEnabled = false;
  pixelCtx.drawImage(small, 0, 0, w, h);
  cache.pixelDirty = false;
  cache.mosaicDirty = true;
}

function ensureMosaicOverlay() {
  if (!cache.mosaicDirty && cache.mosaicOverlay) return;
  ensurePixelated();
  const { w, h } = size();
  cache.mosaicMask = reuseCanvas(cache.mosaicMask, w, h);
  const maskCtx = cache.mosaicMask.getContext('2d');
  maskCtx.fillStyle = '#fff';
  for (const face of state.faces) {
    if (face.enabled) {
      traceFacePath(maskCtx, face);
      maskCtx.fill();
    }
  }
  for (const stroke of state.strokes) drawStroke(maskCtx, stroke);
  cache.mosaicOverlay = reuseCanvas(cache.mosaicOverlay, w, h);
  const overlayCtx = cache.mosaicOverlay.getContext('2d');
  overlayCtx.globalCompositeOperation = 'source-over';
  overlayCtx.drawImage(cache.pixelated, 0, 0);
  overlayCtx.globalCompositeOperation = 'destination-in';
  overlayCtx.drawImage(cache.mosaicMask, 0, 0);
  overlayCtx.globalCompositeOperation = 'source-over';
  cache.mosaicDirty = false;
}

function ensureMarkerMask() {
  if (!cache.markerDirty && cache.markerMask) return;
  const { w, h } = size();
  cache.markerMask = reuseCanvas(cache.markerMask, w, h);
  const markerCtx = cache.markerMask.getContext('2d');
  markerCtx.fillStyle = '#ff4400';
  for (const marker of state.markers) markerCtx.fillRect(marker.x, marker.y, marker.w, marker.h);
  if (draftMarker) markerCtx.fillRect(draftMarker.x, draftMarker.y, draftMarker.w, draftMarker.h);
  cache.markerDirty = false;
}

function bubbleMetrics(context, bubble, placeholder = true) {
  const { w } = size();
  const font = imageUnit(bubble.fontSize, w);
  const lineHeight = font * 1.18;
  const padX = imageUnit(16, w);
  const padY = imageUnit(12, w);
  context.font = `${bubble.bold ? 700 : 400} ${font}px "Roboto Condensed", Arial, sans-serif`;
  const text = bubble.text || (placeholder ? 'Текст' : '');
  const lines = text.split('\n');
  const measurements = lines.map((line) => context.measureText(line));
  const maxLine = Math.max(imageUnit(34, w), ...measurements.map((item) => item.width));
  const firstInk = Math.min(...measurements.map((item, index) =>
    index * lineHeight - (item.actualBoundingBoxAscent || font * 0.8)));
  const lastInk = Math.max(...measurements.map((item, index) =>
    index * lineHeight + (item.actualBoundingBoxDescent || (item.actualBoundingBoxAscent ? 0 : font * 0.2))));
  return {
    lines,
    font,
    lineHeight,
    padX,
    padY,
    firstBaseline: padY - firstInk,
    rect: { x: bubble.x, y: bubble.y, w: maxLine + padX * 2, h: lastInk - firstInk + padY * 2 },
  };
}

function keepBubbleInFrame(bubble) {
  const { w, h } = size();
  const rect = bubbleMetrics(ctx, bubble).rect;
  bubble.x = clamp(bubble.x, 0, Math.max(0, w - rect.w));
  bubble.y = clamp(bubble.y, 0, Math.max(0, h - rect.h));
}

function tailBase(rect, tip) {
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  const radius = Math.min(rect.w, rect.h) / 2;
  const dx = tip.x - centerX;
  const dy = tip.y - centerY;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared <= radius * radius) return null;
  const base = radius * radius / distanceSquared;
  const tangent = radius * Math.sqrt(distanceSquared - radius * radius) / distanceSquared;
  return [
    { x: centerX + base * dx - tangent * dy, y: centerY + base * dy + tangent * dx },
    { x: centerX + base * dx + tangent * dy, y: centerY + base * dy - tangent * dx },
  ];
}

function drawBubble(context, bubble, isExport = false) {
  if (isExport && !bubble.text.trim()) return;
  context.save();
  const metrics = bubbleMetrics(context, bubble);
  const { rect, lines, font, lineHeight, padX, firstBaseline } = metrics;
  context.fillStyle = '#fff';
  const base = tailBase(rect, bubble.tip);
  if (base) {
    context.beginPath();
    context.moveTo(base[0].x, base[0].y);
    context.lineTo(base[1].x, base[1].y);
    context.lineTo(bubble.tip.x, bubble.tip.y);
    context.closePath();
    context.fill();
  }
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.w, rect.h, imageUnit(10, size().w));
  context.fill();
  context.fillStyle = bubble.text ? '#303030' : '#a5aaa5';
  context.textBaseline = 'alphabetic';
  context.font = `${bubble.bold ? 700 : 400} ${font}px "Roboto Condensed", Arial, sans-serif`;
  lines.forEach((line, index) => context.fillText(line, rect.x + padX, rect.y + firstBaseline + index * lineHeight));
  context.restore();
}

function renderDocument(context, isExport = false) {
  context.drawImage(baseCanvas, 0, 0);
  ensureMosaicOverlay();
  context.drawImage(cache.mosaicOverlay, 0, 0);
  ensureMarkerMask();
  context.save();
  context.globalCompositeOperation = 'hard-light';
  context.globalAlpha = 0.27;
  context.drawImage(cache.markerMask, 0, 0);
  context.restore();
  for (const bubble of state.bubbles) drawBubble(context, bubble, isExport);
}

function cropScreenRect() {
  if (!state.crop) return null;
  return { x: view.x + state.crop.x * view.scale, y: view.y + state.crop.y * view.scale, w: state.crop.w * view.scale, h: state.crop.h * view.scale };
}

function drawCropUI(context) {
  const rect = cropScreenRect();
  if (!rect) return;
  const image = { x: view.x, y: view.y, w: baseCanvas.width * view.scale, h: baseCanvas.height * view.scale };
  context.save();
  context.fillStyle = 'rgba(12, 18, 13, .48)';
  context.fillRect(image.x, image.y, image.w, Math.max(0, rect.y - image.y));
  context.fillRect(image.x, rect.y + rect.h, image.w, Math.max(0, image.y + image.h - rect.y - rect.h));
  context.fillRect(image.x, rect.y, Math.max(0, rect.x - image.x), rect.h);
  context.fillRect(rect.x + rect.w, rect.y, Math.max(0, image.x + image.w - rect.x - rect.w), rect.h);
  context.strokeStyle = '#fff';
  context.lineWidth = 1.5;
  context.strokeRect(rect.x, rect.y, rect.w, rect.h);
  context.fillStyle = '#fff';
  const handles = [
    [rect.x, rect.y], [rect.x + rect.w / 2, rect.y], [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h / 2], [rect.x + rect.w, rect.y + rect.h / 2],
    [rect.x, rect.y + rect.h], [rect.x + rect.w / 2, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h],
  ];
  for (const [x, y] of handles) {
    context.fillRect(x - 4, y - 4, 8, 8);
    context.strokeStyle = '#eb5d33';
    context.strokeRect(x - 4, y - 4, 8, 8);
  }
  const label = `${Math.round(state.crop.w)} × ${Math.round(state.crop.h)} px`;
  context.font = '12px Arial';
  context.fillStyle = '#fff';
  context.fillText(label, rect.x + 2, Math.max(16, rect.y - 10));
  context.restore();
}

function requestRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(render);
}

function render() {
  renderScheduled = false;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  if (!baseCanvas) return;
  const { w, h } = size();
  ctx.save();
  ctx.shadowColor = 'rgba(35, 45, 34, .22)';
  ctx.shadowBlur = 25;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = '#fff';
  ctx.fillRect(view.x, view.y, w * view.scale, h * view.scale);
  ctx.restore();
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  renderDocument(ctx);
  ctx.restore();

  if (state.tool === 'mosaic' && state.selectedFaceId && !state.cropEditing) {
    const selected = state.faces.find((face) => face.id === state.selectedFaceId);
    if (selected) {
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.scale, view.scale);
      ctx.strokeStyle = '#ff6b38';
      ctx.lineWidth = 2 / view.scale;
      ctx.setLineDash([7 / view.scale, 5 / view.scale]);
      traceFacePath(ctx, selected);
      ctx.stroke();
      ctx.restore();
    }
  }
  if (state.tool === 'bubble' && state.selectedBubbleId && !state.cropEditing) {
    const selected = state.bubbles.find((bubble) => bubble.id === state.selectedBubbleId);
    if (selected) {
      const metrics = bubbleMetrics(ctx, selected);
      const r = metrics.rect;
      ctx.save();
      ctx.strokeStyle = '#ed653c';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(view.x + r.x * view.scale, view.y + r.y * view.scale, r.w * view.scale, r.h * view.scale);
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
  if (state.tool === 'bubble' && !state.cropEditing && hover) {
    const hit = bubbleAt(hover);
    if (hit?.part === 'tip') {
      const tip = docToScreen(hit.bubble.tip);
      ctx.save();
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff825d';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }
  if (state.cropEditing) drawCropUI(ctx);
  if (state.tool === 'mosaic' && !state.cropEditing && hover && inDocument(screenToDoc(hover))) {
    const radius = imageUnit(state.brushSize, w) * view.scale / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = '#303a31';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

function cropHandleAt(point) {
  if (!state.cropEditing || !state.crop) return null;
  const r = cropScreenRect();
  const handles = [
    ['top-left', r.x, r.y], ['top', r.x + r.w / 2, r.y], ['top-right', r.x + r.w, r.y],
    ['left', r.x, r.y + r.h / 2], ['right', r.x + r.w, r.y + r.h / 2],
    ['bottom-left', r.x, r.y + r.h], ['bottom', r.x + r.w / 2, r.y + r.h], ['bottom-right', r.x + r.w, r.y + r.h],
  ];
  for (const [name, x, y] of handles) {
    if (Math.abs(point.x - x) <= 12 && Math.abs(point.y - y) <= 12) return name;
  }
  if (pointInRect(point, r)) return 'move';
  return null;
}

function bubbleAt(point) {
  const doc = screenToDoc(point);
  for (let i = state.bubbles.length - 1; i >= 0; i--) {
    const bubble = state.bubbles[i];
    const tip = docToScreen(bubble.tip);
    if (Math.hypot(point.x - tip.x, point.y - tip.y) <= 14) return { bubble, part: 'tip' };
  }
  for (let i = state.bubbles.length - 1; i >= 0; i--) {
    const bubble = state.bubbles[i];
    if (pointInRect(doc, bubbleMetrics(ctx, bubble).rect)) return { bubble, part: 'body' };
  }
  return null;
}

function selectBubble(id) {
  state.selectedBubbleId = id;
  textEditSession = false;
  updatePanels();
  requestRender();
}

function deleteBubble(id = state.selectedBubbleId) {
  if (id == null) return;
  remember();
  state.bubbles = state.bubbles.filter((bubble) => bubble.id !== id);
  if (state.selectedBubbleId === id) state.selectedBubbleId = state.bubbles.at(-1)?.id ?? null;
  updatePanels();
  requestRender();
}

function createBubble(tip) {
  remember();
  const { w, h } = size();
  const bubble = {
    id: nextId++, text: '', fontSize: state.fontSize, bold: false,
    x: tip.x + imageUnit(30, w),
    y: tip.y - imageUnit(100, w),
    tip: { ...tip },
  };
  const measured = bubbleMetrics(ctx, bubble).rect;
  bubble.x = clamp(bubble.x, 0, Math.max(0, w - measured.w));
  bubble.y = clamp(bubble.y, 0, Math.max(0, h - measured.h));
  state.bubbles.push(bubble);
  state.selectedBubbleId = bubble.id;
  updatePanels();
  requestRender();
  bubbleText.focus();
}

function startPointer(event) {
  if (!baseCanvas) return;
  if (![0, 1, 2].includes(event.button)) return;
  event.preventDefault();
  const screen = stagePoint(event);
  const doc = screenToDoc(screen);
  hover = screen;
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 1) return;
  if (event.button === 2) {
    if (state.cropEditing) return;
    if (state.tool === 'marker') {
      if (state.markers.length) {
        remember();
        state.markers.pop();
        cache.markerDirty = true;
        updatePanels();
        requestRender();
      }
      return;
    }
    if (state.tool !== 'mosaic' || !inDocument(doc)) return;
    remember();
    const stroke = { id: nextId++, mode: 'erase', size: imageUnit(state.brushSize, size().w), points: [clampDoc(doc)] };
    state.strokes.push(stroke);
    pointerAction = { type: 'stroke', stroke };
    cache.mosaicDirty = true;
    requestRender();
    return;
  }
  if (state.cropEditing) {
    const handle = cropHandleAt(screen);
    if (handle) {
      remember();
      pointerAction = { type: 'crop', handle, start: doc, initial: { ...state.crop } };
    }
    return;
  }
  if (!inDocument(doc)) return;
  if (state.tool === 'mosaic') {
    remember();
    const stroke = { id: nextId++, mode: 'add', size: imageUnit(state.brushSize, size().w), points: [clampDoc(doc)] };
    state.strokes.push(stroke);
    pointerAction = { type: 'stroke', stroke };
    cache.mosaicDirty = true;
    requestRender();
  } else if (state.tool === 'marker') {
    pointerAction = { type: 'marker', start: clampDoc(doc) };
    draftMarker = { ...clampDoc(doc), w: 0, h: 0 };
    cache.markerDirty = true;
    requestRender();
  } else if (state.tool === 'bubble') {
    const hit = bubbleAt(screen);
    if (hit) {
      state.selectedBubbleId = hit.bubble.id;
      pointerAction = {
        type: 'bubble', part: hit.part, bubble: hit.bubble, recorded: false,
        start: doc, initial: { x: hit.bubble.x, y: hit.bubble.y, tip: { ...hit.bubble.tip } },
      };
      updatePanels();
      requestRender();
    } else {
      createBubble(clampDoc(doc));
    }
  }
}

function movePointer(event) {
  if (!baseCanvas) return;
  const screen = stagePoint(event);
  const doc = clampDoc(screenToDoc(screen));
  hover = screen;
  if (pointerAction) {
    if (pointerAction.type === 'stroke') {
      const points = pointerAction.stroke.points;
      const last = points.at(-1);
      if (Math.hypot(doc.x - last.x, doc.y - last.y) > 1 / view.scale) {
        points.push(doc);
        cache.mosaicDirty = true;
      }
    } else if (pointerAction.type === 'marker') {
      draftMarker = normalizeRect(pointerAction.start, doc);
      cache.markerDirty = true;
    } else if (pointerAction.type === 'crop') {
      const { w, h } = size();
      state.crop = resizeCrop(pointerAction.initial, pointerAction.handle, pointerAction.start, doc, w, h);
    } else if (pointerAction.type === 'bubble') {
      const { w, h } = size();
      const dx = doc.x - pointerAction.start.x;
      const dy = doc.y - pointerAction.start.y;
      if (!pointerAction.recorded && Math.hypot(dx, dy) > 0.5 / view.scale) {
        remember();
        pointerAction.recorded = true;
      }
      if (!pointerAction.recorded) return;
      if (pointerAction.part === 'tip') {
        pointerAction.bubble.tip.x = clamp(pointerAction.initial.tip.x + dx, 0, w);
        pointerAction.bubble.tip.y = clamp(pointerAction.initial.tip.y + dy, 0, h);
      } else {
        const bubble = pointerAction.bubble;
        const metrics = bubbleMetrics(ctx, bubble);
        bubble.x = clamp(pointerAction.initial.x + dx, 0, Math.max(0, w - metrics.rect.w));
        bubble.y = clamp(pointerAction.initial.y + dy, 0, Math.max(0, h - metrics.rect.h));
      }
    }
    requestRender();
    return;
  }
  if (state.cropEditing) {
    const handle = cropHandleAt(screen);
    canvas.style.cursor = handle === 'move' ? 'move'
      : handle === 'top' || handle === 'bottom' ? 'ns-resize'
        : handle === 'left' || handle === 'right' ? 'ew-resize'
          : handle === 'top-left' || handle === 'bottom-right' ? 'nwse-resize'
            : handle ? 'nesw-resize' : 'default';
  } else if (state.tool === 'mosaic' && inDocument(screenToDoc(screen))) canvas.style.cursor = 'none';
  else if (state.tool === 'bubble') canvas.style.cursor = bubbleAt(screen) ? 'move' : 'crosshair';
  else canvas.style.cursor = inDocument(screenToDoc(screen)) ? 'crosshair' : 'default';
  requestRender();
}

function finishPointer(event) {
  if (!pointerAction) return;
  if (pointerAction.type === 'marker') {
    if (draftMarker && draftMarker.w >= 2 && draftMarker.h >= 2) {
      remember();
      state.markers.push({ id: nextId++, ...draftMarker });
    }
    draftMarker = null;
    cache.markerDirty = true;
    updatePanels();
  }
  pointerAction = null;
  canvas.style.cursor = 'default';
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  updateControls();
  requestRender();
}

function rotateDocument(clockwise) {
  if (!baseCanvas) return;
  remember();
  const oldWidth = baseCanvas.width;
  const oldHeight = baseCanvas.height;
  const bubbleCenters = state.bubbles.map((bubble) => {
    const rect = bubbleMetrics(ctx, bubble).rect;
    return rotatePoint({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, oldWidth, oldHeight, clockwise);
  });
  state.rotation = (state.rotation + (clockwise ? 1 : 3)) % 4;
  state.faces = state.faces.map((face) => ({
    ...face,
    box: rotateRect(face.box, oldWidth, oldHeight, clockwise),
    contour: face.contour?.map((point) => rotatePoint(point, oldWidth, oldHeight, clockwise)) ?? null,
  }));
  state.markers = state.markers.map((marker) => ({ ...marker, ...rotateRect(marker, oldWidth, oldHeight, clockwise) }));
  state.strokes = state.strokes.map((stroke) => ({
    ...stroke,
    size: stroke.size * oldHeight / oldWidth,
    points: stroke.points.map((point) => rotatePoint(point, oldWidth, oldHeight, clockwise)),
  }));
  if (state.crop) state.crop = rotateRect(state.crop, oldWidth, oldHeight, clockwise);
  state.bubbles.forEach((bubble) => { bubble.tip = rotatePoint(bubble.tip, oldWidth, oldHeight, clockwise); });
  rebuildBase();
  state.bubbles.forEach((bubble, index) => {
    const rect = bubbleMetrics(ctx, bubble).rect;
    bubble.x = clamp(bubbleCenters[index].x - rect.w / 2, 0, Math.max(0, baseCanvas.width - rect.w));
    bubble.y = clamp(bubbleCenters[index].y - rect.h / 2, 0, Math.max(0, baseCanvas.height - rect.h));
  });
  const detecting = $('faceStatus').textContent.includes('Ищем');
  detectionToken++;
  if (detecting) detectFaces();
  fitView();
  updatePanels();
  updateControls();
  requestRender();
}

async function savePng() {
  if (!baseCanvas) return;
  await Promise.all([
    document.fonts.load('400 26px "Roboto Condensed"'),
    document.fonts.load('700 26px "Roboto Condensed"'),
  ]);
  const { w, h } = size();
  const crop = state.cropEnabled && state.crop ? state.crop : { x: 0, y: 0, w, h };
  const left = clamp(Math.round(crop.x), 0, w - 1);
  const top = clamp(Math.round(crop.y), 0, h - 1);
  const right = clamp(Math.round(crop.x + crop.w), left + 1, w);
  const bottom = clamp(Math.round(crop.y + crop.h), top + 1, h);
  const output = makeCanvas(right - left, bottom - top);
  const outputCtx = output.getContext('2d');
  outputCtx.translate(-left, -top);
  renderDocument(outputCtx, true);
  const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/png'));
  if (!blob) {
    toast('Не удалось сохранить PNG.');
    return;
  }
  try {
    if (await saveImage(blob, `${sourceName}-mozaic.png`)) {
      toast(`Сохранено: ${output.width} × ${output.height} px`);
    }
  } catch (error) {
    console.error('PNG save failed', error);
    toast('Не удалось сохранить PNG.');
  }
}

function bindRange(range, onValue) {
  let editing = false;
  range.addEventListener('input', () => {
    if (!editing && baseCanvas) {
      remember();
      editing = true;
    }
    onValue(Number(range.value));
    requestRender();
  });
  range.addEventListener('change', () => { editing = false; updateControls(); });
  range.addEventListener('blur', () => { editing = false; });
}

function bindEvents() {
  const openImage = async () => {
    if (!desktop) { fileInput.click(); return; }
    try {
      const file = await chooseImage();
      if (file) await loadFile(file);
    } catch (error) {
      console.error('Image open failed', error);
      toast('Не удалось открыть изображение.');
    }
  };
  $('uploadButton').addEventListener('click', openImage);
  $('emptyUploadButton').addEventListener('click', openImage);
  stage.addEventListener('click', (event) => {
    if (!baseCanvas && !event.target.closest('button')) openImage();
  });
  fileInput.addEventListener('change', () => loadFile(fileInput.files?.[0]));
  if (desktop) {
    bindNativeDrops(loadFile, (active) => stage.classList.toggle('drag-over', active), (error) => {
      console.error('Image drop failed', error);
      toast(error.message || 'Не удалось открыть изображение.');
    }).catch((error) => console.error('Native file drop unavailable', error));
  }

  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (event.dataTransfer?.files.length) event.preventDefault();
  });
  stage.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    stage.classList.add('drag-over');
  });
  stage.addEventListener('dragleave', (event) => {
    if (!stage.contains(event.relatedTarget)) stage.classList.remove('drag-over');
  });
  stage.addEventListener('drop', (event) => {
    event.preventDefault();
    stage.classList.remove('drag-over');
    const file = [...(event.dataTransfer?.files ?? [])].find((entry) => entry.type.startsWith('image/'));
    if (file) loadFile(file);
    else toast('Перетащите файл изображения.');
  });

  document.querySelectorAll('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
  $('cropButton').addEventListener('click', () => {
    if (!baseCanvas) return;
    remember();
    if (!state.cropEnabled) {
      state.cropEnabled = true;
      state.cropEditing = true;
    } else {
      state.cropEditing = !state.cropEditing;
    }
    if (!state.crop) state.crop = { x: 0, y: 0, w: baseCanvas.width, h: baseCanvas.height };
    updateToolUI();
    updateControls();
    requestRender();
  });
  $('resetCropButton').addEventListener('click', () => {
    if (!baseCanvas || !state.cropEnabled) return;
    remember();
    state.cropEnabled = false;
    state.cropEditing = false;
    state.crop = { x: 0, y: 0, w: baseCanvas.width, h: baseCanvas.height };
    updateToolUI();
    updateControls();
    requestRender();
  });
  $('rotateLeftButton').addEventListener('click', () => rotateDocument(false));
  $('rotateRightButton').addEventListener('click', () => rotateDocument(true));
  $('saveButton').addEventListener('click', savePng);
  $('boldButton').addEventListener('click', () => {
    const selected = state.bubbles.find((bubble) => bubble.id === state.selectedBubbleId);
    if (!selected) return;
    remember();
    selected.bold = !selected.bold;
    keepBubbleInFrame(selected);
    updatePanels();
    requestRender();
  });

  bindRange(grainRange, (value) => {
    state.grain = value;
    $('grainValue').textContent = value;
    cache.pixelDirty = true;
    cache.mosaicDirty = true;
  });
  bindRange(brushRange, (value) => {
    state.brushSize = value;
    $('brushValue').textContent = value;
  });
  bindRange(fontRange, (value) => {
    const selected = state.bubbles.find((bubble) => bubble.id === state.selectedBubbleId);
    state.fontSize = value;
    if (selected) {
      selected.fontSize = value;
      keepBubbleInFrame(selected);
    }
    $('fontValue').textContent = value;
  });
  bubbleText.addEventListener('focus', () => { textEditSession = false; });
  bubbleText.addEventListener('blur', () => { textEditSession = false; updatePanels(); });
  bubbleText.addEventListener('input', () => {
    const selected = state.bubbles.find((bubble) => bubble.id === state.selectedBubbleId);
    if (!selected) return;
    if (!textEditSession) {
      remember();
      textEditSession = true;
    }
    selected.text = bubbleText.value;
    keepBubbleInFrame(selected);
    const row = [...bubbleList.children].find((item) => item.classList.contains('selected'));
    if (row) row.firstChild.textContent = selected.text.trim().split('\n')[0].slice(0, 27) || 'Баббл';
    requestRender();
  });

  canvas.addEventListener('pointerdown', startPointer);
  canvas.addEventListener('pointermove', movePointer);
  canvas.addEventListener('pointerup', finishPointer);
  canvas.addEventListener('pointercancel', finishPointer);
  canvas.addEventListener('pointerleave', () => { hover = null; requestRender(); });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('dblclick', () => {
    if (state.tool === 'bubble' && state.selectedBubbleId) bubbleText.focus();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (!baseCanvas || state.tool !== 'mosaic' || state.cropEditing) return;
    const ticks = Math.max(1, Math.round(Math.abs(event.deltaY) / 100));
    state.brushSize = clamp(state.brushSize + (event.deltaY < 0 ? 1 : -1) * ticks * 4, 8, 180);
    brushRange.value = String(state.brushSize);
    $('brushValue').textContent = state.brushSize;
    requestRender();
  }, { passive: false });

  window.addEventListener('keydown', (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && !event.altKey && (event.code === 'KeyZ' || key === 'z')) {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (modifier && !event.altKey && (event.code === 'KeyY' || key === 'y')) {
      event.preventDefault();
      redo();
      return;
    }
    const editing = event.target instanceof HTMLElement && Boolean(event.target.closest('input, textarea, [contenteditable="true"]'));
    if (editing) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && state.tool === 'bubble' && state.selectedBubbleId) {
      event.preventDefault();
      deleteBubble();
      return;
    }
    if (event.key === '1') setTool('mosaic');
    if (event.key === '2') setTool('marker');
    if (event.key === '3') setTool('bubble');
  });
  new ResizeObserver(resizeCanvas).observe(stage);
  document.fonts.ready.then(requestRender);
}

stage.classList.add('no-image');
bindEvents();
updateToolUI();
updatePanels();
updateControls();
resizeCanvas();
