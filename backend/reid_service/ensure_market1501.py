#!/usr/bin/env python3
"""Ensure a Market-1501 dataset exists locally, downloading it if needed."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

DEFAULT_ROOT = Path("/Users/test/Downloads/Market-1501-v15.09.15")
DEFAULT_URLS = (
    "http://apache-mxnet.s3-accelerate.dualstack.amazonaws.com/gluon/dataset/Market-1501-v15.09.15.zip",
    "http://188.138.127.15:81/Datasets/Market-1501-v15.09.15.zip",
    "https://huggingface.co/datasets/tuandunghcmut/MyPublicStorage/resolve/main/Market-1501-v15.09.15.zip",
)
REQUIRED_SUBDIRS = ("query", "bounding_box_test", "bounding_box_train")


def has_market1501(root: Path) -> bool:
    return root.is_dir() and all((root / name).is_dir() for name in REQUIRED_SUBDIRS)


def find_market1501_root(base: Path) -> Path | None:
    if has_market1501(base):
        return base
    for dirpath, dirnames, _ in os.walk(base):
        p = Path(dirpath)
        if has_market1501(p):
            return p
        depth = len(p.relative_to(base).parts)
        if depth >= 3:
            dirnames[:] = []
    return None


def split_urls(raw: str) -> list[str]:
    return [item.strip() for item in raw.replace(",", "\n").splitlines() if item.strip()]


def candidate_urls(raw: str | None) -> list[str]:
    urls = split_urls(raw or "")
    for url in DEFAULT_URLS:
        if url not in urls:
            urls.append(url)
    return urls


def download_one(url: str, archive: Path) -> None:
    archive.parent.mkdir(parents=True, exist_ok=True)
    tmp = archive.with_suffix(archive.suffix + ".tmp")
    print(f"Downloading Market-1501 from {url}")
    with urllib.request.urlopen(url, timeout=600) as response:
        if response.status != 200:
            raise RuntimeError(f"download failed with HTTP {response.status}")
        with tmp.open("wb") as f:
            shutil.copyfileobj(response, f)
    tmp.replace(archive)


def download(urls: list[str], archive: Path) -> None:
    errors: list[str] = []
    tmp = archive.with_suffix(archive.suffix + ".tmp")
    for url in urls:
        try:
            if tmp.exists():
                tmp.unlink()
            download_one(url, archive)
            return
        except Exception as e:
            errors.append(f"{url}: {e}")
            print(f"WARNING: failed to download from {url}: {e}", file=sys.stderr)
    raise RuntimeError("all Market-1501 download URLs failed:\n" + "\n".join(errors))


def extract(archive: Path, root: Path) -> None:
    root.parent.mkdir(parents=True, exist_ok=True)
    print(f"Extracting {archive} to {root.parent}")
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(root.parent)

    found = find_market1501_root(root.parent)
    if found is None:
        raise RuntimeError(f"Market-1501 structure not found after extracting {archive}")
    if found != root:
        if root.exists():
            shutil.rmtree(root)
        shutil.move(str(found), str(root))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(DEFAULT_ROOT))
    parser.add_argument(
        "--url",
        default=os.environ.get("MARKET1501_DOWNLOAD_URLS") or os.environ.get("MARKET1501_DOWNLOAD_URL"),
        help="Market-1501 zip URL. Multiple URLs may be comma-separated.",
    )
    parser.add_argument("--force-download", action="store_true")
    return parser.parse_args(argv)


def main(argv: list[str]) -> None:
    args = parse_args(argv)
    root = Path(args.root).expanduser()
    archive = root.parent / "Market-1501-v15.09.15.zip"

    if has_market1501(root) and not args.force_download:
        print(f"Market-1501 already exists: {root}")
        return

    if args.force_download or not archive.is_file():
        download(candidate_urls(args.url), archive)

    extract(archive, root)
    if not has_market1501(root):
        raise SystemExit(f"Market-1501 is incomplete after setup: {root}")
    print(f"Market-1501 ready: {root}")


if __name__ == "__main__":
    main(sys.argv[1:])
