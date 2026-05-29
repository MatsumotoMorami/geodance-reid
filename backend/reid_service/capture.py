from __future__ import annotations

import atexit
import os
import shutil
import socket
import subprocess
import threading
from urllib.parse import urlparse

import cv2
import numpy as np

from frame_quality import frame_looks_corrupt

# HEVC 花屏：ffmpeg nokey / OpenCV 持久 + 花屏重试；见 frame_quality.frame_looks_corrupt。

_persist_caps: dict[str, cv2.VideoCapture] = {}
_persist_locks: dict[str, threading.Lock] = {}
_persist_locks_guard = threading.Lock()


def _persist_lock(camera_id: str) -> threading.Lock:
    with _persist_locks_guard:
        if camera_id not in _persist_locks:
            _persist_locks[camera_id] = threading.Lock()
        return _persist_locks[camera_id]


def _release_persist(camera_id: str) -> None:
    cap = _persist_caps.pop(camera_id, None)
    if cap is not None:
        try:
            cap.release()
        except Exception:
            pass


def _close_all_persist() -> None:
    with _persist_locks_guard:
        keys = list(_persist_caps.keys())
    for k in keys:
        _release_persist(k)


atexit.register(_close_all_persist)


def rtsp_describe_status_code(url: str) -> int | None:
    """
    对 RTSP 发一条 DESCRIBE，读取首行状态码（如 200、404）。
    连接失败、超时或非 RTSP 时返回 None，由调用方决定是否仍尝试 OpenCV。
    """
    if os.environ.get("SKIP_RTSP_DESCRIBE_PROBE", "").strip() == "1":
        return None
    if not url.lower().startswith("rtsp://"):
        return None
    ms_raw = os.environ.get("RTSP_DESCRIBE_TIMEOUT_MS", "").strip()
    if ms_raw:
        timeout = max(0.5, float(ms_raw) / 1000.0)
    else:
        timeout = float(os.environ.get("RTSP_DESCRIBE_TIMEOUT_SEC", "2.5"))
    try:
        parsed = urlparse(url)
        host = parsed.hostname
        if not host:
            return None
        port = parsed.port or 554
        sock = socket.create_connection((host, port), timeout=timeout)
        try:
            sock.settimeout(timeout)
            req = (
                f"DESCRIBE {url} RTSP/1.0\r\n"
                f"CSeq: 1\r\n"
                f"User-Agent: geodance-reid-rtsp-probe/1.0\r\n"
                f"\r\n"
            )
            sock.sendall(req.encode("ascii", errors="strict"))
            buf = b""
            while b"\r\n" not in buf and len(buf) < 4096:
                chunk = sock.recv(2048)
                if not chunk:
                    break
                buf += chunk
        finally:
            sock.close()
    except OSError:
        return None
    except UnicodeEncodeError:
        return None

    first = buf.split(b"\r\n", 1)[0].decode("ascii", errors="ignore").strip()
    parts = first.split()
    if len(parts) < 2 or not parts[0].upper().startswith("RTSP/"):
        return None
    try:
        return int(parts[1])
    except ValueError:
        return None


def rtsp_probe_is_404(url: str) -> bool:
    """DESCRIBE 明确 404 时返回 True，其余情况（含探测失败）返回 False。"""
    return rtsp_describe_status_code(url) == 404


def _apply_cap_timeouts(cap: cv2.VideoCapture) -> None:
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    timeout_ms = int(os.environ.get("RTSP_OPEN_TIMEOUT_MS", "5000"))
    try:
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms)
    except Exception:
        pass
    read_to = getattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC", None)
    if read_to is not None:
        try:
            cap.set(read_to, int(os.environ.get("RTSP_READ_TIMEOUT_MS", "8000")))
        except Exception:
            pass


def _open_rtsp_cap(url: str) -> cv2.VideoCapture | None:
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    if not cap.isOpened():
        return None
    _apply_cap_timeouts(cap)
    return cap


def _frame_looks_corrupt(bgr: np.ndarray) -> bool:
    return frame_looks_corrupt(bgr)


def _grab_rtsp_ephemeral(url: str, discard: int) -> np.ndarray | None:
    """每次新建连接、读若干帧后关闭。"""
    cap = _open_rtsp_cap(url)
    if cap is None:
        return None
    try:
        frame = None
        for _ in range(max(1, discard + 1)):
            ok, fr = cap.read()
            if ok and fr is not None:
                frame = fr
        return frame
    finally:
        cap.release()


def _grab_rtsp_persistent(camera_id: str, url: str) -> np.ndarray | None:
    lock = _persist_lock(camera_id)
    retries = int(os.environ.get("RTSP_CORRUPT_RETRY_READS", "15"))
    retries = max(1, min(60, retries))
    with lock:
        cap = _persist_caps.get(camera_id)
        if cap is None or not cap.isOpened():
            _release_persist(camera_id)
            cap = _open_rtsp_cap(url)
            if cap is None:
                return None
            _persist_caps[camera_id] = cap
            # Skip more frames on fresh connection to reach stable decode state
            warm = int(os.environ.get("RTSP_HEVC_OPEN_SKIP_FRAMES", "48"))
            warm = max(0, min(180, warm))
            for _ in range(warm):
                cap.read()
        # Drain stale buffer aggressively before grabbing
        drain = int(os.environ.get("RTSP_PERSISTENT_DRAIN_GRABS", "8"))
        drain = max(0, min(40, drain))
        # Try to get a clean frame: grab multiple, keep the best (highest laplacian variance)
        best_frame: np.ndarray | None = None
        best_score = -1.0
        for attempt in range(retries):
            for _ in range(drain):
                cap.grab()
            ok, fr = cap.read()
            if not ok or fr is None:
                continue
            if not _frame_looks_corrupt(fr):
                return fr
            # Track best frame in case all are marked corrupt
            gray = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
            score = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            if score > best_score:
                best_score = score
                best_frame = fr
        # If no frame passed the check but we have a reasonable best candidate
        if best_frame is not None and best_score > 8.0:
            return best_frame
        # Connection seems broken, reconnect next time
        _release_persist(camera_id)
        return None


def _ffmpeg_snapshot(url: str, *, skip_token: str | None) -> np.ndarray | None:
    ff = shutil.which("ffmpeg")
    if not ff:
        return None
    st_us = int(os.environ.get("RTSP_FFMPEG_CLI_STIMEOUT_US", "12000000"))
    deadline = float(os.environ.get("RTSP_FFMPEG_CLI_DEADLINE_SEC", "25"))
    probe = os.environ.get("RTSP_FFMPEG_PROBESIZE", "10M").strip() or "10M"
    analyze = os.environ.get("RTSP_FFMPEG_ANALYZEDURATION", "10M").strip() or "10M"
    max_delay = os.environ.get("RTSP_FFMPEG_MAX_DELAY_US", "8000000").strip() or "8000000"
    cmd: list[str] = [
        ff,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-err_detect",
        "explode",  # Abort on decode errors, don't pass corrupt frames
        "-fflags",
        "+discardcorrupt+genpts+igndts",
        "-ec",
        "favor_inter+deblock",  # Error concealment: prefer interpolation over green blocks
        "-rtsp_transport",
        "tcp",
        "-stimeout",
        str(st_us),
        "-max_delay",
        max_delay,
        "-probesize",
        probe,
        "-analyzeduration",
        analyze,
        "-max_error_rate",
        "0.3",  # Allow some errors but abort if >30% of frame is corrupt
    ]
    if skip_token and skip_token.lower() not in ("none", "off", "0"):
        cmd.extend(["-skip_frame", skip_token])
    cmd.extend(
        [
            "-i",
            url,
            "-an",
            "-sn",
            "-dn",
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ]
    )
    try:
        p = subprocess.run(cmd, capture_output=True, timeout=deadline, check=False)
        if p.returncode != 0 or not p.stdout:
            return None
        arr = np.frombuffer(p.stdout, dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except (subprocess.TimeoutExpired, OSError, ValueError):
        return None


def grab_rtsp_frame_ffmpeg(url: str) -> np.ndarray | None:
    """
    子进程 ffmpeg 抽 1 帧 PNG。默认先 nokey；仍判花屏或失败时可再试不跳帧（RTSP_FFMPEG_NOKEY_FALLBACK）。
    """
    reject = os.environ.get("RTSP_FFMPEG_REJECT_CORRUPT", "1").strip().lower() not in ("0", "false", "off", "no")
    skip_default = os.environ.get("RTSP_FFMPEG_SKIP_FRAME", "nokey").strip()
    fb = os.environ.get("RTSP_FFMPEG_NOKEY_FALLBACK", "1").strip().lower() not in ("0", "false", "off", "no")

    def _ok(im: np.ndarray | None) -> bool:
        if im is None:
            return False
        if reject and _frame_looks_corrupt(im):
            return False
        return True

    im = _ffmpeg_snapshot(url, skip_token=skip_default)
    if _ok(im):
        return im
    if fb and skip_default and skip_default.lower() not in ("none", "off", "0"):
        im2 = _ffmpeg_snapshot(url, skip_token=None)
        if _ok(im2):
            return im2
    return None


def _default_grab_backend(url: str) -> str:
    raw = os.environ.get("RTSP_GRAB_BACKEND", "").strip().lower()
    if raw in ("ffmpeg", "opencv"):
        return raw
    if url.lower().startswith("rtsp://") and shutil.which("ffmpeg"):
        return "ffmpeg"
    return "opencv"


def grab_rtsp_frame(url: str, *, camera_id: str | None = None, discard: int | None = None) -> np.ndarray | None:
    """
    拉取一路 RTSP 的一帧 BGR。
    RTSP_GRAB_BACKEND：ffmpeg（默认在存在 ffmpeg 且为 rtsp 时）或 opencv。
    ffmpeg 路径失败时自动回退 OpenCV 持久抓帧。
    """
    backend = _default_grab_backend(url)
    if backend == "ffmpeg" and url.lower().startswith("rtsp://"):
        im = grab_rtsp_frame_ffmpeg(url)
        if im is not None:
            return im

    persist = os.environ.get("RTSP_PERSISTENT_CAPTURE", "1").strip().lower() not in ("0", "false", "off", "no")
    if persist and camera_id:
        return _grab_rtsp_persistent(camera_id, url)
    d = discard if discard is not None else int(os.environ.get("RTSP_GRAB_DISCARD_FRAMES", "18"))
    d = max(0, min(80, d))
    return _grab_rtsp_ephemeral(url, d)
