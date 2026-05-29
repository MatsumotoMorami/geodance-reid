#!/usr/bin/env python3
"""
最小联调服务：返回与 Next 前端约定的检测 JSON（无真实推理，仅占位）。

运行：
  python3 backend/stub_detect_server.py

Next.js（.env.local）：
  REID_DETECTIONS_URL=http://127.0.0.1:8787/detections

真实后端只需对同一 URL 提供 GET JSON，字段可与 camelCase 或 snake_case 同义写法
（见项目 lib/reidBackend.ts）。
"""
from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, HTTPServer


def payload() -> dict:
    t = int(time.time() * 1000)
    return {
        "updatedAt": t,
        "sampleIntervalMs": 3000,
        "galleryUniquePersonCount": 2,
        "visibleUniquePersonCount": 2,
        "frames": [
            {
                "cameraId": "room",
                "online": True,
                "detections": [
                    {
                        "globalPersonId": 1,
                        "box": {"x": 0.25, "y": 0.2, "w": 0.22, "h": 0.55},
                    }
                ],
            },
            {
                "camera_id": "maimai",
                "online": True,
                "detections": [
                    {
                        "global_person_id": 1,
                        "bbox": {"x": 0.5, "y": 0.22, "w": 0.18, "h": 0.5},
                    },
                    {
                        "globalPersonId": 2,
                        "box": {"x": 0.1, "y": 0.35, "w": 0.2, "h": 0.45},
                    },
                ],
            },
        ],
    }


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path != "/detections":
            self.send_error(404, "use GET /detections")
            return
        body = json.dumps(payload()).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        print(fmt % args)


if __name__ == "__main__":
    host, port = "127.0.0.1", 8787
    print(f"stub REID detections at http://{host}:{port}/detections")
    HTTPServer((host, port), Handler).serve_forever()
