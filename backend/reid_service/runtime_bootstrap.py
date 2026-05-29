"""
进程启动最早执行：修复 macOS 上 Python SSL 证书链、为 OpenCV/FFmpeg RTSP 设置较短超时与 TCP 传输。
须在 import cv2 / ultralytics 之前调用（见 main.py）。
"""

from __future__ import annotations

import os


def apply() -> None:
    try:
        import certifi

        ca = certifi.where()
        os.environ.setdefault("SSL_CERT_FILE", ca)
        os.environ.setdefault("REQUESTS_CA_BUNDLE", ca)
        os.environ.setdefault("CURL_CA_BUNDLE", ca)
    except ImportError:
        pass

    # 若未配置或缺少 stimeout，则注入 TCP + 超时，避免 RTSP 404/断流卡默认 ~30s
    st_us = int(os.environ.get("RTSP_FFMPEG_STIMEOUT_US", "7000000"))
    max_delay = int(os.environ.get("RTSP_FFMPEG_MAX_DELAY_US", "500000"))
    base = f"rtsp_transport;tcp|stimeout;{st_us}|max_delay;{max_delay}"
    cur = os.environ.get("OPENCV_FFMPEG_CAPTURE_OPTIONS", "").strip()
    if not cur or "stimeout" not in cur:
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"{base}|{cur}" if cur else base
