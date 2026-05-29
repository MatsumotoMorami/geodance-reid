from __future__ import annotations

import os
import ssl
import urllib.request
from pathlib import Path
from typing import Any

import cv2
import numpy as np

_yolo: Any | None = None

_DEFAULT_YOLO_BASE = "https://github.com/ultralytics/assets/releases/download/v8.4.0"


def _service_weights_dir() -> Path:
    return Path(__file__).resolve().parent / "weights"


def _resolve_yolo_weights_path() -> Path:
    env_w = os.environ.get("YOLO_WEIGHTS", "").strip()
    if env_w:
        p = Path(env_w).expanduser()
        if p.is_file():
            return p

    name = os.environ.get("YOLO_MODEL", "yolov8n.pt").strip() or "yolov8n.pt"
    expanded = Path(name).expanduser()
    if ("/" in name or "\\" in name) and expanded.is_file():
        return expanded

    local = _service_weights_dir() / Path(name).name
    if local.is_file():
        return local
    return local


def _yolo_download_url_for(path: Path) -> str:
    custom = os.environ.get("YOLO_DOWNLOAD_URL", "").strip()
    if custom:
        return custom
    return f"{_DEFAULT_YOLO_BASE}/{path.name}"


def _download_yolo_weights(dest: Path) -> None:
    import certifi

    url = _yolo_download_url_for(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    ctx = ssl.create_default_context(cafile=certifi.where())
    req = urllib.request.Request(url, headers={"User-Agent": "geodance-reid-yolo/1.0"})
    with urllib.request.urlopen(req, context=ctx, timeout=300) as resp:
        tmp.write_bytes(resp.read())
    tmp.replace(dest)


def get_yolo():
    global _yolo
    if _yolo is None:
        from ultralytics import YOLO

        path = _resolve_yolo_weights_path()
        if not path.is_file():
            _download_yolo_weights(path)
        _yolo = YOLO(str(path))
    return _yolo


def detect_persons(frame: np.ndarray, *, max_side: int | None = None, conf: float | None = None) -> list[dict[str, Any]]:
    """
    返回 list[{ "xyxy": [x1,y1,x2,y2] 像素, "conf": float }] ，仅 COCO person(0)。
    室内/远景/花帧时若首轮为 0，会自动用更低 conf 再跑一轮（仍无则返回空）。
    """
    if conf is None:
        conf = float(os.environ.get("YOLO_CONF", "0.10"))
    if max_side is None:
        max_side = int(os.environ.get("YOLO_MAX_SIDE", "1280"))
    imgsz = int(os.environ.get("YOLO_IMGSZ", "960"))
    device = os.environ.get("YOLO_DEVICE", "cpu")

    h, w = frame.shape[:2]
    scale = 1.0
    work = frame
    m = max(h, w)
    if m > max_side:
        scale = max_side / float(m)
        work = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    yolo = get_yolo()

    def _run(c: float):
        kw: dict[str, Any] = {
            "verbose": False,
            "conf": c,
            "classes": [0],
            "device": device,
            "imgsz": imgsz,
            "agnostic_nms": os.environ.get("YOLO_AGNOSTIC_NMS", "").strip() == "1",
        }
        if str(device).lower() == "cpu":
            kw["half"] = False
        return yolo.predict(work, **kw)

    res = _run(conf)
    r0 = res[0] if res else None
    if r0 is None or r0.boxes is None or len(r0.boxes) == 0:
        low = max(0.05, min(conf * 0.45, conf - 0.02))
        if low < conf - 1e-6:
            res = _run(low)
            r0 = res[0] if res else None
    if r0 is None or r0.boxes is None or len(r0.boxes) == 0:
        return []
    out: list[dict[str, Any]] = []
    xyxy = r0.boxes.xyxy.cpu().numpy()
    scores = r0.boxes.conf.cpu().numpy()
    inv = 1.0 / scale if scale != 1.0 else 1.0
    for i in range(xyxy.shape[0]):
        x1, y1, x2, y2 = (xyxy[i] * inv).tolist()
        out.append({"xyxy": [float(x1), float(y1), float(x2), float(y2)], "conf": float(scores[i])})
    out.sort(key=lambda d: -d["conf"])
    max_det = int(os.environ.get("YOLO_MAX_PER_FRAME", "12"))
    return out[:max_det]
