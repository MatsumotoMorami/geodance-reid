"""
MJPEG proxy: OpenCV reads RTSP → HTTP multipart MJPEG stream.
Workaround for ffmpeg 8.0.1 incompatibility with some RTSP servers.
"""

from __future__ import annotations

import os
import threading
import time
from io import BytesIO

import cv2
import numpy as np

from cameras_data import CAMERAS

# Per-camera: persistent OpenCV capture → JPEG buffer
_state: dict[str, dict] = {}
_lock = threading.Lock()


def _get_or_open(camera_id: str) -> dict | None:
    with _lock:
        if camera_id in _state:
            s = _state[camera_id]
            # Check if still alive
            if s["cap"].isOpened():
                return s
            # Reopen
            s["cap"].release()

        cam = next((c for c in CAMERAS if c["id"] == camera_id), None)
        if not cam:
            return None

        url = cam["url"]
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            return None

        # Apply timeouts
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        try:
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
        except Exception:
            pass
        read_to = getattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC", None)
        if read_to is not None:
            try:
                cap.set(read_to, 5000)
            except Exception:
                pass

        # Skip initial frames to stabilize
        for _ in range(24):
            cap.read()

        quality = int(os.environ.get("MJPEG_QUALITY", "55"))
        quality = max(20, min(95, quality))
        fps = int(os.environ.get("MJPEG_FPS", "10"))
        scale_w = int(os.environ.get("MJPEG_SCALE_W", "960"))

        s = {
            "cap": cap,
            "quality": quality,
            "fps": fps,
            "scale_w": scale_w,
            "last_jpeg": None,
            "last_ts": 0,
            "url": url,
        }
        _state[camera_id] = s
        return s


def grab_jpeg(camera_id: str) -> bytes | None:
    """Grab a frame and return JPEG bytes. Non-blocking with rate limiting."""
    s = _get_or_open(camera_id)
    if s is None:
        return None

    # Rate limit
    interval = 1.0 / max(1, s["fps"])
    now = time.monotonic()
    if now - s["last_ts"] < interval:
        # Return cached frame
        return s["last_jpeg"]
    s["last_ts"] = now

    cap = s["cap"]
    retries = 3
    for _ in range(retries):
        ok, frame = cap.read()
        if not ok or frame is None:
            continue
        if frame.size == 0:
            continue
        # Resize to target width (maintain aspect ratio)
        h, w = frame.shape[:2]
        target_w = s["scale_w"]
        if w > target_w:
            scale = target_w / w
            new_w = target_w
            new_h = int(h * scale)
            frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

        # Encode to JPEG
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, s["quality"]])
        if ok and buf is not None:
            data = bytes(buf)
            s["last_jpeg"] = data
            return data

    return s["last_jpeg"]


def mjpeg_stream_generator(camera_id: str):
    """Generator yielding multipart MJPEG chunks for a single camera."""
    boundary = b"--mjpeg\r\n"
    while True:
        jpeg = grab_jpeg(camera_id)
        if jpeg is None:
            # No frame yet, send a short wait and retry
            time.sleep(0.1)
            continue
        yield boundary
        yield b"Content-Type: image/jpeg\r\n"
        yield f"Content-Length: {len(jpeg)}\r\n".encode()
        yield b"\r\n"
        yield jpeg
        yield b"\r\n"
        time.sleep(1.0 / max(1, int(os.environ.get("MJPEG_FPS", "10"))))
