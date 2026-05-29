#!/usr/bin/env python3
"""
Download EPFL multi-camera pedestrian videos and extract frames for ReID testing.

Dataset: EPFL CVLab Multi-Camera Pedestrians
- Laboratory 6p: 4 cameras, 6 people indoor, free for research
- Terrace 1: 4 cameras, outdoor, up to 7 people
- Passageway: 4 cameras, underground, up to 13 people

Usage:
  python prepare_test_data.py              # default: lab6
  python prepare_test_data.py terrace1     # outdoor
  python prepare_test_data.py passageway   # underground station

Output: test_data/cam_{N}/ with extracted full-frame images.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

TEST_DATA_DIR = Path(__file__).resolve().parent / "test_data"
EXTRACT_EVERY_N_SEC = 1.5  # Extract one frame every N seconds
MAX_FRAMES_PER_CAM = 60

DATASETS = {
    "lab6": {
        "name": "Laboratory 6 people",
        "cameras": [
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video1/www/6p-c0.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video1/www/6p-c1.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video1/www/6p-c2.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video1/www/6p-c3.avi",
        ],
        "fps": 25,
        "description": "4 cameras, 6 people, indoor lab",
    },
    "lab4": {
        "name": "Laboratory 4 people",
        "cameras": [
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video1/www/4p-c0.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video1/www/4p-c1.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video1/www/4p-c2.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video1/www/4p-c3.avi",
        ],
        "fps": 25,
        "description": "4 cameras, 4 people, indoor lab",
    },
    "terrace1": {
        "name": "Terrace sequence 1",
        "cameras": [
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video3/www/terrace1-c0.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video3/www/terrace1-c1.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video3/www/terrace1-c2.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video3/www/terrace1-c3.avi",
        ],
        "fps": 25,
        "description": "4 cameras, outdoor terrace, up to 7 people",
    },
    "passageway": {
        "name": "Passageway",
        "cameras": [
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video2/www/passageway1-c0.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video2/www/passageway1-c1.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video2/www/passageway1-c2.avi",
            "https://documents.epfl.ch/groups/c/cv/cvlab-pom-video3/www/passageway1-c3.avi",
        ],
        "fps": 25,
        "description": "4 cameras, underground station, up to 13 people",
    },
}


def check_ffmpeg() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, timeout=5)
        return True
    except Exception:
        return False


def main() -> None:
    os.chdir(Path(__file__).resolve().parent)

    if not check_ffmpeg():
        print("Error: ffmpeg not found. Install: brew install ffmpeg")
        sys.exit(1)

    dataset_key = sys.argv[1] if len(sys.argv) > 1 else "lab6"
    if dataset_key not in DATASETS:
        print(f"Unknown dataset: {dataset_key}")
        print(f"Available: {', '.join(DATASETS.keys())}")
        sys.exit(1)

    ds = DATASETS[dataset_key]
    print(f"Dataset: {ds['name']} ({ds['description']})")
    print(f"Cameras: {len(ds['cameras'])}")

    # Clean old data
    for d in list(TEST_DATA_DIR.iterdir()):
        if d.is_dir() and d.name.startswith("cam_"):
            shutil.rmtree(d)

    dl_dir = TEST_DATA_DIR / "_downloads"
    dl_dir.mkdir(parents=True, exist_ok=True)

    # Download and extract
    frame_interval = max(1, int(ds["fps"] * EXTRACT_EVERY_N_SEC))

    for cam_idx, url in enumerate(ds["cameras"]):
        cam_name = f"cam_{cam_idx}"
        dest_dir = TEST_DATA_DIR / cam_name
        dest_dir.mkdir(parents=True, exist_ok=True)

        video_name = f"{dataset_key}_c{cam_idx}.avi"
        video_path = dl_dir / video_name

        # Download
        if not video_path.exists():
            print(f"\nDownloading camera {cam_idx}...")
            try:
                subprocess.check_call(
                    ["curl", "-L", "-o", str(video_path), url],
                    timeout=300,
                )
                size_mb = video_path.stat().st_size / (1024 * 1024)
                print(f"  Downloaded: {size_mb:.1f} MB")
            except subprocess.CalledProcessError as e:
                print(f"  Download failed: {e}")
                continue

        # Extract frames
        print(f"Extracting frames from {video_name} (1 frame every {EXTRACT_EVERY_N_SEC}s)...")
        subprocess.check_call(
            [
                "ffmpeg", "-y",
                "-i", str(video_path),
                "-vf", f"fps=1/{EXTRACT_EVERY_N_SEC}",
                "-q:v", "3",
                "-frames:v", str(MAX_FRAMES_PER_CAM),
                f"{dest_dir}/frame_%04d.jpg",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        n_frames = len(list(dest_dir.iterdir()))
        print(f"  {cam_name}: {n_frames} frames extracted")

    # Cleanup downloads
    shutil.rmtree(dl_dir, ignore_errors=True)

    # Summary
    print(f"\nTest data ready: {TEST_DATA_DIR}")
    total = 0
    for d in sorted(TEST_DATA_DIR.iterdir()):
        if d.is_dir() and d.name.startswith("cam_"):
            n = len(list(d.iterdir()))
            total += n
            print(f"  {d.name}/ : {n} full-frame images")

    print(f"\nTotal: {total} images across {len(ds['cameras'])} cameras")
    print(f"Dataset: {ds['name']}")
    print(f"\nUsage:")
    print(f"  1. Restart backend: npm run reid:serve")
    print(f"  2. Open frontend, click toggle to switch to dataset mode")
    print(f"  3. Each poll shows different frames from each camera")
    print(f"  4. YOLO detects people → OSNet extracts features → ReID matches across cameras")
    print(f"\nOther datasets: python prepare_test_data.py [terrace1|passageway|lab4]")


if __name__ == "__main__":
    main()
