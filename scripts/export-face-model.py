"""One-time conversion of the existing face model; Python is not used by the app."""

import argparse
import shutil
import tempfile
from functools import partial
from pathlib import Path

import torch
from ultralytics import YOLO

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--output", type=Path, default=Path("public/models/face_yolov8m.onnx"))
args = parser.parse_args()
if not args.source.is_file():
    raise SystemExit(f"Model not found: {args.source}")

# This Ultralytics version expects the TorchScript exporter, including on newer Torch.
torch.onnx.export = partial(torch.onnx.export, dynamo=False)
with tempfile.TemporaryDirectory(prefix="mozaic-onnx-") as workspace:
    model_path = Path(workspace) / "face_yolov8m.pt"
    shutil.copyfile(args.source, model_path)
    exported = YOLO(str(model_path)).export(
        format="onnx", imgsz=1280, opset=17, simplify=False,
        dynamic=False, half=False, nms=False, device="cpu",
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(exported, args.output)
    print(f"Packaged model: {args.output.resolve()} ({args.output.stat().st_size} bytes)")
