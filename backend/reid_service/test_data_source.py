"""
Test dataset frame source — reads person images from local directories
as virtual cameras, bypassing RTSP entirely.

Directory structure:
  test_data/
    cam_0/          → virtual camera 0
      img001.jpg
      img002.jpg
    cam_1/          → virtual camera 1
      img001.jpg
    ...

Each poll rotates through available images per camera directory.
"""

from __future__ import annotations

import os
import random
from pathlib import Path
from typing import Any

import cv2
import numpy as np

TEST_DATA_DIR = Path(__file__).resolve().parent / "test_data"

# Per-camera index for rotating through images
_state: dict[str, int] = {}


def _test_camera_dirs() -> list[Path]:
    """List all cam_* directories under test_data/."""
    if not TEST_DATA_DIR.is_dir():
        return []
    dirs = sorted(
        [d for d in TEST_DATA_DIR.iterdir() if d.is_dir() and d.name.startswith("cam_")],
        key=lambda d: d.name,
    )
    return dirs


def test_camera_list() -> list[dict[str, str]]:
    """Return a CAMERAS-style list for the test dataset."""
    dirs = _test_camera_dirs()
    return [{"id": d.name, "url": str(d)} for d in dirs]


def grab_test_frame(camera_id: str) -> np.ndarray | None:
    """Read next image for the virtual camera, rotating round-robin."""
    cam_dir = TEST_DATA_DIR / camera_id
    if not cam_dir.is_dir():
        return None

    exts = (".jpg", ".jpeg", ".png", ".bmp")
    images = sorted(
        [f for f in cam_dir.iterdir() if f.suffix.lower() in exts],
        key=lambda f: f.name,
    )
    if not images:
        return None

    # Skip initial empty frames: start 10% into the sequence
    if camera_id not in _state:
        _state[camera_id] = max(1, len(images) // 10)

    idx = _state[camera_id] % len(images)
    _state[camera_id] = idx + 1

    path = images[idx]
    frame = cv2.imread(str(path))
    if frame is None or frame.size == 0:
        _state[camera_id] = idx + 1
        next_path = images[(idx + 1) % len(images)]
        frame = cv2.imread(str(next_path))
    return frame


def test_dataset_has_data() -> bool:
    """Check if test data directories contain images."""
    dirs = _test_camera_dirs()
    if not dirs:
        return False
    for d in dirs:
        exts = (".jpg", ".jpeg", ".png", ".bmp")
        if any(f.suffix.lower() in exts for f in d.iterdir()):
            return True
    return False


def reset_test_state() -> None:
    """Reset per-camera rotation indices."""
    _state.clear()
