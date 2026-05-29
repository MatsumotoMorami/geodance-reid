"""
Hybrid ReID embedder: OSNet deep features + color histogram features.
Color features help discriminate people at low resolution where OSNet
struggles (different clothing colors remain distinguishable even at 40px).

Strategy:
- Split person crop into upper/lower body halves
- Extract CIE Lab color histograms (perceptually uniform)
- Concatenate with OSNet features → single L2-normalized vector
- Color feature weight adapts to crop quality (larger crop → more OSNet weight)
"""

from __future__ import annotations

import os

import cv2
import numpy as np


def extract_color_features(crop_bgr: np.ndarray) -> np.ndarray:
    """
    Extract clothing color features from a person crop.
    Returns L2-normalized feature vector capturing upper/lower body color distribution.
    """
    h, w = crop_bgr.shape[:2]
    if h < 10 or w < 5:
        return np.zeros(96, dtype=np.float32)

    # Split into upper body (top 40%) and lower body (bottom 40%)
    # Skip middle 20% (transition zone)
    upper = crop_bgr[: max(1, h * 2 // 5), :]
    lower = crop_bgr[max(1, h * 3 // 5):, :]

    feats = []
    for region in [upper, lower]:
        if region.size == 0:
            feats.append(np.zeros(48, dtype=np.float32))
            continue
        # Convert to CIE Lab (perceptually uniform, separates luminance from color)
        lab = cv2.cvtColor(region, cv2.COLOR_BGR2Lab)

        # Compute histograms for each channel (a and b capture color, L captures brightness)
        hist_parts = []
        for ch in range(3):
            hist = cv2.calcHist([lab], [ch], None, [16], [0, 256])
            hist = hist.reshape(-1).astype(np.float32)
            hist /= (hist.sum() + 1e-9)
            hist_parts.append(hist)

        # Concatenate channel histograms for this body region
        region_feat = np.concatenate(hist_parts)  # 48-dim
        feats.append(region_feat)

    combined = np.concatenate(feats)  # 96-dim
    # L2 normalize
    n = np.linalg.norm(combined) + 1e-12
    return (combined / n).astype(np.float32)


def fuse_features(
    osnet_feat: np.ndarray,
    color_feat: np.ndarray,
    crop_h: int = 128,
) -> np.ndarray:
    """
    Fuse OSNet and color features with adaptive weighting.
    Smaller crops → higher color weight (OSNet less reliable).
    Larger crops → higher OSNet weight (deep features are richer).
    """
    # Color weight: higher for small crops (OSNet less reliable), lower for large crops
    # Range: ~0.40 at 40px → ~0.12 at 200px
    color_weight = float(np.clip(1.0 - (crop_h - 40) / 160.0, 0.12, 0.45))

    osnet_norm = osnet_feat / (np.linalg.norm(osnet_feat) + 1e-12)
    color_norm = color_feat / (np.linalg.norm(color_feat) + 1e-12)

    osnet_w = 1.0 - color_weight
    fused = np.concatenate([
        osnet_norm * osnet_w,
        color_norm * color_weight,
    ])
    fused /= np.linalg.norm(fused) + 1e-12
    return fused.astype(np.float32)


def color_augmented_embed(
    base_embedder,
    crop_bgr: np.ndarray,
    crop_h: int | None = None,
    *,
    tta: bool = True,
) -> np.ndarray:
    """
    Extract fused features: OSNet + color histogram.
    If tta=False, uses base embedder without its internal horizontal TTA
    (caller handles TTA at a higher level, e.g., for gallery max-TTA).
    """
    if crop_h is None:
        crop_h = crop_bgr.shape[0]

    # Temporarily disable TTA if caller handles it
    prev_tta = os.environ.get("REID_TTA_HORIZONTAL")
    if not tta:
        os.environ["REID_TTA_HORIZONTAL"] = "0"
    try:
        osnet = base_embedder.embed_crop_bgr(crop_bgr)
    finally:
        if not tta:
            if prev_tta is not None:
                os.environ["REID_TTA_HORIZONTAL"] = prev_tta
            else:
                os.environ.pop("REID_TTA_HORIZONTAL", None)

    color = extract_color_features(crop_bgr)
    return fuse_features(osnet, color, crop_h)
