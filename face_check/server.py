"""Local secondary face detector using the Python and model already in ComfyUI."""

import asyncio
import os
from pathlib import Path

import cv2
import numpy as np
from aiohttp import web
from ultralytics import YOLO


COMFY_HOME = Path(os.environ.get("COMFYUI_HOME", r"D:\AI\ComfyUI_windows_portable"))
MODEL_PATH = Path(
    os.environ.get(
        "FACE_MODEL_PATH",
        str(COMFY_HOME / "ComfyUI" / "models" / "ultralytics" / "bbox" / "face_yolov8m.pt"),
    )
)
HOST = "127.0.0.1"
PORT = int(os.environ.get("FACE_CHECK_PORT", "8765"))

if not MODEL_PATH.is_file():
    raise SystemExit(f"Face model not found: {MODEL_PATH}")

model = YOLO(str(MODEL_PATH))
model_lock = asyncio.Lock()


def detect(image: np.ndarray) -> list[dict]:
    result = model.predict(image, device="cpu", imgsz=1280, conf=0.32, max_det=100, verbose=False)[0]
    if result.boxes is None:
        return []
    coordinates = result.boxes.xyxy.cpu().numpy()
    confidences = result.boxes.conf.cpu().numpy()
    return [
        {
            "x": float(left),
            "y": float(top),
            "w": float(right - left),
            "h": float(bottom - top),
            "score": float(score),
        }
        for (left, top, right, bottom), score in zip(coordinates, confidences)
    ]


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"ready": True, "model": MODEL_PATH.name})


async def check_faces(request: web.Request) -> web.Response:
    if not request.content_type.startswith("multipart/form-data"):
        raise web.HTTPUnsupportedMediaType(text="Expected multipart image upload")
    data = await request.post()
    uploaded = data.get("image")
    if not isinstance(uploaded, web.FileField):
        raise web.HTTPBadRequest(text="Missing image")
    raw = uploaded.file.read()
    if len(raw) > 50 * 1024 * 1024:
        raise web.HTTPRequestEntityTooLarge(max_size=50 * 1024 * 1024, actual_size=len(raw))
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise web.HTTPBadRequest(text="Invalid image")
    async with model_lock:
        faces = await asyncio.to_thread(detect, image)
    return web.json_response({"faces": faces, "width": image.shape[1], "height": image.shape[0]})


app = web.Application(client_max_size=50 * 1024 * 1024)
app.router.add_get("/health", health)
app.router.add_post("/api/face-check", check_faces)

if __name__ == "__main__":
    print(f"Face check ready on http://{HOST}:{PORT} ({MODEL_PATH.name})", flush=True)
    web.run_app(app, host=HOST, port=PORT, print=None)
