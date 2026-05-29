"""缓存每路用于 YOLO/Re-ID 的那一帧 JPEG，供 /preview/<cameraId> 拉取（与实时 MJPEG 分离）。"""

from __future__ import annotations

import threading

_lock = threading.Lock()
_jpeg_by_camera: dict[str, bytes] = {}


def set_preview_jpeg(camera_id: str, data: bytes | None) -> None:
    with _lock:
        if data is None:
            _jpeg_by_camera.pop(camera_id, None)
        else:
            _jpeg_by_camera[camera_id] = data


def get_preview_jpeg(camera_id: str) -> bytes | None:
    with _lock:
        return _jpeg_by_camera.get(camera_id)
