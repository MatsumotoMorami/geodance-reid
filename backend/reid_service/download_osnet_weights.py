#!/usr/bin/env python3
"""Download OSNet-AIN weights from torchreid model zoo via gdown."""
from __future__ import annotations

import os
import sys
from pathlib import Path

WEIGHTS_DIR = Path(__file__).resolve().parent / "weights"

# osnet_ain_x1_0 trained on MSMT17 (combineall=True) — best cross-domain generalization
MODEL_ID = "1SigwBE6mPdqiJMqhuIY4aqC7--5CsMal"
MODEL_FILENAME = "osnet_ain_x1_0_msmt17_combineall.pth.tar"


def main() -> None:
    WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
    dest = WEIGHTS_DIR / MODEL_FILENAME
    if dest.is_file():
        print(f"Weight already exists: {dest}")
        return

    try:
        import gdown
    except ImportError:
        print("Installing gdown...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "gdown"])
        import gdown

    url = f"https://drive.google.com/uc?id={MODEL_ID}"
    print(f"Downloading OSNet-AIN weights from Google Drive...")
    gdown.download(url, str(dest), quiet=False)

    if dest.is_file():
        size_mb = dest.stat().st_size / (1024 * 1024)
        print(f"Downloaded: {dest} ({size_mb:.1f} MB)")
    else:
        print("Download failed. Please download manually:")
        print(f"  https://drive.google.com/file/d/{MODEL_ID}/view")
        print(f"  Save to: {dest}")
        sys.exit(1)


if __name__ == "__main__":
    main()
