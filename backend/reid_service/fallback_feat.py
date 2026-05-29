"""Re-ID 失败时的降级向量：固定 2048 维 L2 归一化；混入 camera_id 与框坐标，避免不同目标哈希全撞成同一 ID。"""

from __future__ import annotations

import hashlib

import cv2
import numpy as np


def fallback_reid_vector(
    crop_bgr: np.ndarray,
    *,
    camera_id: str,
    box_xyxy: tuple[int, int, int, int],
) -> np.ndarray:
    small = cv2.resize(crop_bgr, (48, 96), interpolation=cv2.INTER_AREA)
    x1, y1, x2, y2 = box_xyxy
    meta = f"{camera_id}:{x1},{y1},{x2},{y2}:{small.shape[0]}x{small.shape[1]}".encode("utf-8", errors="replace")
    payload = small.tobytes() + meta
    digest = hashlib.sha256(payload).digest()
    buf = (digest * 64)[:2048]
    v = np.frombuffer(buf, dtype=np.uint8).astype(np.float32)
    n = float(np.linalg.norm(v)) + 1e-12
    return (v / n).astype(np.float32)
