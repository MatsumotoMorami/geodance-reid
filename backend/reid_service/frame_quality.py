"""单帧质量检测：HEVC 花屏 / 撕裂 / 色块 / 无纹理灰块。"""

from __future__ import annotations

import os

import cv2
import numpy as np


def _half_plane_mismatch(gray: np.ndarray) -> bool:
    """检测上下半幅明显不接缝的错位/切条（HEVC 帧撕裂）。"""
    if os.environ.get("RTSP_FRAME_SLICE_CHECK", "1").strip().lower() in ("0", "false", "off", "no"):
        return False
    h, w = gray.shape[:2]
    if h < 32 or w < 32:
        return False
    small = cv2.resize(gray, (128, 72), interpolation=cv2.INTER_AREA)
    sh = small.shape[0]
    top = small[: sh // 2, :].reshape(-1).astype(np.float64)
    bot = small[sh // 2 :, :].reshape(-1).astype(np.float64)
    if top.size != bot.size or top.size < 64:
        return False
    top -= top.mean()
    bot -= bot.mean()
    denom = float(np.linalg.norm(top) * np.linalg.norm(bot) + 1e-9)
    corr = float(np.dot(top, bot) / denom)
    thr = float(os.environ.get("RTSP_FRAME_SLICE_CORR_MIN", "0.25"))
    return corr < thr


def _color_block_artifact(bgr: np.ndarray) -> bool:
    """检测 HEVC 解码失败的色块：画面被分割为大面积纯色块（绿/紫/灰）。"""
    if os.environ.get("RTSP_FRAME_COLORBLOCK_CHECK", "1").strip().lower() in ("0", "false", "off", "no"):
        return False
    h, w = bgr.shape[:2]
    if h < 64 or w < 64:
        return False
    # Divide into 8x8 grid blocks, check for blocks with near-zero variance
    block_h, block_w = h // 8, w // 8
    low_var_blocks = 0
    total_blocks = 0
    for row in range(8):
        for col in range(8):
            y1, y2 = row * block_h, min((row + 1) * block_h, h)
            x1, x2 = col * block_w, min((col + 1) * block_w, w)
            block = bgr[y1:y2, x1:x2]
            if block.size < 256:
                continue
            total_blocks += 1
            # HEVC artifacts create very flat color blocks
            std = float(block.std())
            if std < 8.0:  # Near-zero variance = solid color artifact
                low_var_blocks += 1
    if total_blocks < 16:
        return False
    # If >25% of blocks are solid color → corrupt
    return low_var_blocks > total_blocks // 4


def _edge_discontinuity(gray: np.ndarray) -> bool:
    """检测水平撕裂线：画面中间有一条明显的水平不连续线。"""
    if os.environ.get("RTSP_FRAME_TEAR_CHECK", "1").strip().lower() in ("0", "false", "off", "no"):
        return False
    h, w = gray.shape[:2]
    if h < 64 or w < 64:
        return False
    # Check horizontal gradient differences at multiple y positions
    edge = cv2.Canny(gray, 30, 100)
    # Sum edges per row
    row_sums = edge.sum(axis=1).astype(np.float64)
    if row_sums.max() < w * 0.05:
        return False  # No significant edges
    # Look for a row with abnormally high edge density relative to neighbors
    # (tear line = sudden edge across a large portion of the width)
    for y in range(h // 4, 3 * h // 4, 4):
        window = row_sums[max(0, y - 4):min(h, y + 4)]
        local_mean = window.mean() + 1e-9
        if row_sums[y] > local_mean * 3.0 and row_sums[y] > w * 0.15:
            return True
    return False


def frame_looks_corrupt(bgr: np.ndarray | None) -> bool:
    if bgr is None or bgr.size == 0:
        return True
    # Dataset mode: skip checks for pre-validated test images
    if os.environ.get("REID_FRAME_QUALITY_CHECK", "1").strip().lower() in ("0", "false", "off", "no"):
        return False

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # Std check: completely blank/gray frame
    sd = float(gray.std())
    min_sd = float(os.environ.get("RTSP_FRAME_MIN_STD", "5.5"))
    if sd < min_sd:
        return True

    # Laplacian check: blurry/low-texture (including color blocks)
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    lv = float(lap.var())
    min_lv = float(os.environ.get("RTSP_FRAME_MIN_LAPLACIAN_VAR", "18.0"))
    cap_sd = float(os.environ.get("RTSP_FRAME_CORRUPT_STD_CAP", "24.0"))
    if lv < min_lv and sd < cap_sd:
        return True

    # HEVC-specific artifact detection
    if _half_plane_mismatch(gray):
        return True
    if _color_block_artifact(bgr):
        return True
    if _edge_discontinuity(gray):
        return True
    return False
