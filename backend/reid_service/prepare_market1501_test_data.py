#!/usr/bin/env python3
"""
Build a small Market-1501 virtual-camera dataset for geodance-reid dataset mode.

Market-1501 stores cropped person images named like:
  0001_c1s1_001051_00.jpg

This script selects identities that appear in multiple cameras and writes
cam_1..cam_6 folders whose sorted frame order is identity-aligned. The default
selection strategy picks visually diverse identities for small smoke tests.
The default canvas mode pastes each crop onto a 1920x1080 neutral frame so the
existing YOLO -> ReID pipeline can run without treating crop files as a special
case.

Usage:
  python prepare_market1501_test_data.py /path/to/Market-1501-v15.09.15
  TEST_DATA_DIR=test_data_market1501 YOLO_MAX_PER_FRAME=1 REID_PER_CAMERA_TRACK=0 REID_USE_POSE=0 npm run reid:serve
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

SERVICE_DIR = Path(__file__).resolve().parent
DEFAULT_MARKET_ROOT = Path("/Users/test/Downloads/Market-1501-v15.09.15")
DEFAULT_OUTPUT = SERVICE_DIR / "test_data_market1501"
MARKET_SUBDIRS = ("query", "bounding_box_test", "bounding_box_train")
NAME_RE = re.compile(r"^(?P<pid>-?\d+)_c(?P<cam>\d)s\d+_\d+_\d+\.jpg$", re.IGNORECASE)


def _resolve_output(raw: str) -> Path:
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = SERVICE_DIR / p
    return p


def _scan_market(root: Path) -> dict[str, dict[str, list[Path]]]:
    by_pid: dict[str, dict[str, list[Path]]] = defaultdict(lambda: defaultdict(list))
    for subdir in MARKET_SUBDIRS:
        d = root / subdir
        if not d.is_dir():
            continue
        for path in sorted(d.glob("*.jpg")):
            m = NAME_RE.match(path.name)
            if not m:
                continue
            pid = m.group("pid")
            if pid in ("-1", "0000"):
                continue
            cam_id = f"cam_{m.group('cam')}"
            by_pid[pid][cam_id].append(path)
    return by_pid


def _crop_signature(path: Path) -> np.ndarray:
    img = cv2.imread(str(path))
    if img is None or img.size == 0:
        return np.zeros(48, dtype=np.float32)
    img = cv2.resize(img, (64, 128), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
    parts = []
    for ch in range(3):
        hist = cv2.calcHist([lab], [ch], None, [16], [0, 256]).reshape(-1).astype(np.float32)
        hist /= hist.sum() + 1e-9
        parts.append(hist)
    feat = np.concatenate(parts)
    feat /= np.linalg.norm(feat) + 1e-12
    return feat.astype(np.float32)


def _identity_signature(cams: dict[str, list[Path]]) -> np.ndarray:
    feats = [_crop_signature(paths[0]) for _, paths in sorted(cams.items()) if paths]
    if not feats:
        return np.zeros(48, dtype=np.float32)
    feat = np.mean(np.stack(feats, axis=0), axis=0)
    feat /= np.linalg.norm(feat) + 1e-12
    return feat.astype(np.float32)


def _selected_identities(
    by_pid: dict[str, dict[str, list[Path]]],
    *,
    identities: int,
    min_cameras: int,
    selection: str,
) -> list[tuple[str, dict[str, list[Path]]]]:
    candidates = [
        (pid, cams)
        for pid, cams in by_pid.items()
        if len(cams) >= min_cameras
    ]
    candidates.sort(key=lambda item: (-len(item[1]), item[0]))
    if selection == "first" or len(candidates) <= identities:
        return candidates[:identities]

    signatures = {pid: _identity_signature(cams) for pid, cams in candidates}
    selected: list[tuple[str, dict[str, list[Path]]]] = [candidates[0]]
    remaining = candidates[1:]
    while remaining and len(selected) < identities:
        selected_pids = [pid for pid, _ in selected]

        def score(item: tuple[str, dict[str, list[Path]]]) -> tuple[float, int, str]:
            pid, cams = item
            sig = signatures[pid]
            min_dist = min(
                1.0 - float(np.dot(sig, signatures[selected_pid]))
                for selected_pid in selected_pids
            )
            return (min_dist, len(cams), pid)

        best = max(remaining, key=score)
        selected.append(best)
        remaining.remove(best)

    selected.sort(key=lambda item: item[0])
    return selected


def _make_canvas(
    crop: np.ndarray,
    *,
    width: int,
    height: int,
    person_height: int,
) -> np.ndarray:
    canvas = np.full((height, width, 3), 232, dtype=np.uint8)
    ch, cw = crop.shape[:2]
    if ch <= 0 or cw <= 0:
        raise ValueError("empty crop")
    scale = min(person_height / float(ch), (width * 0.72) / float(cw))
    new_w = max(1, int(round(cw * scale)))
    new_h = max(1, int(round(ch * scale)))
    person = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

    x1 = (width - new_w) // 2
    y1 = max(0, height - new_h - int(height * 0.08))
    x2 = min(width, x1 + new_w)
    y2 = min(height, y1 + new_h)
    canvas[y1:y2, x1:x2] = person[: y2 - y1, : x2 - x1]

    # A faint floor line gives YOLO a little scene context without distracting ReID.
    floor_y = min(height - 1, y2 + 8)
    cv2.line(canvas, (0, floor_y), (width, floor_y), (210, 210, 210), 2)
    return canvas


def _prepare_output(output: Path, *, force: bool) -> None:
    existing_cam_dirs = [d for d in output.glob("cam_*") if d.is_dir()]
    if existing_cam_dirs and not force:
        raise SystemExit(
            f"{output} already has cam_* folders. Re-run with --force to replace generated data."
        )
    output.mkdir(parents=True, exist_ok=True)
    for d in existing_cam_dirs:
        shutil.rmtree(d)
    manifest = output / "manifest.json"
    if manifest.exists() and force:
        manifest.unlink()


def build_dataset(args: argparse.Namespace) -> None:
    source = Path(args.source).expanduser()
    if not source.is_dir():
        raise SystemExit(f"Market-1501 directory not found: {source}")

    output = _resolve_output(args.output)
    by_pid = _scan_market(source)
    selected = _selected_identities(
        by_pid,
        identities=args.identities,
        min_cameras=args.min_cameras,
        selection=args.selection,
    )
    if not selected:
        raise SystemExit(
            f"No identities found with at least {args.min_cameras} cameras under {source}"
        )

    _prepare_output(output, force=args.force)

    manifest: dict[str, object] = {
        "source": str(source),
        "mode": args.mode,
        "selection": args.selection,
        "identities": [],
        "cameras": {},
    }

    written = 0
    for frame_idx, (pid, cams) in enumerate(selected, start=1):
        cam_ids = sorted(cams.keys())
        manifest["identities"].append({"frame": frame_idx, "personId": pid, "cameras": cam_ids})  # type: ignore[index]
        for cam_id in cam_ids:
            cam_dir = output / cam_id
            cam_dir.mkdir(parents=True, exist_ok=True)
            samples = cams[cam_id][: args.samples_per_camera]
            for sample_idx, src in enumerate(samples, start=1):
                out_name = f"frame_{frame_idx:04d}_sample_{sample_idx:02d}_pid_{pid}_{src.name}"
                dst = cam_dir / out_name
                if args.mode == "symlink":
                    dst.symlink_to(src)
                else:
                    crop = cv2.imread(str(src))
                    if crop is None or crop.size == 0:
                        continue
                    canvas = _make_canvas(
                        crop,
                        width=args.canvas_width,
                        height=args.canvas_height,
                        person_height=args.person_height,
                    )
                    ok = cv2.imwrite(str(dst), canvas, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
                    if not ok:
                        raise RuntimeError(f"failed to write {dst}")
                written += 1
                manifest["cameras"].setdefault(cam_id, []).append(  # type: ignore[union-attr]
                    {"frame": frame_idx, "personId": pid, "file": dst.name, "source": str(src)}
                )

    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Market-1501 source: {source}")
    print(f"Output: {output}")
    print(f"Selected identities: {len(selected)}")
    print(f"Images written: {written}")
    for cam_dir in sorted(output.glob("cam_*")):
        n = len(list(cam_dir.glob("*.jpg")))
        print(f"  {cam_dir.name}: {n} images")
    print("")
    print("Run backend with:")
    print(
        "  TEST_DATA_DIR="
        f"{output} YOLO_MAX_PER_FRAME=1 REID_PER_CAMERA_TRACK=0 "
        "REID_GLOBAL_MATCH_ORDER=1 REID_USE_POSE=0 REID_MATCH_THRESHOLD=0.60 "
        "npm run reid:serve"
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", nargs="?", default=str(DEFAULT_MARKET_ROOT))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--identities", type=int, default=24)
    parser.add_argument("--min-cameras", type=int, default=6)
    parser.add_argument("--samples-per-camera", type=int, default=1)
    parser.add_argument("--selection", choices=("diverse", "first"), default="diverse")
    parser.add_argument("--mode", choices=("canvas", "symlink"), default="canvas")
    parser.add_argument("--canvas-width", type=int, default=1920)
    parser.add_argument("--canvas-height", type=int, default=1080)
    parser.add_argument("--person-height", type=int, default=760)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(argv)


if __name__ == "__main__":
    build_dataset(parse_args(sys.argv[1:]))
