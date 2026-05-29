"""
fast-reid 重识别推理 HTTP 服务（FastAPI）。

本仓库已约定将官方库放在 ~/Documents/Fast-ReID，启动前在同目录配置 backend/reid_service/.env
（可由 env.fastreid.example 复制）。权重使用 MODEL_ZOO 中 Market1501 BoT(R50) 的 market_bot_R50.pth。

Next.js：项目根 .env.local 中 REID_DETECTIONS_URL=http://127.0.0.1:8890/detections
"""

from __future__ import annotations

import os
import traceback
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", override=False)

from runtime_bootstrap import apply as _runtime_bootstrap_apply

_runtime_bootstrap_apply()

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from pipeline import build_detections_payload, get_data_mode, set_data_mode
from preview_store import get_preview_jpeg
from test_data_source import test_dataset_has_data

app = FastAPI(title="geodance-reid fastreid", version="0.1.0")


class ModeRequest(BaseModel):
    mode: str  # "camera" | "dataset"


@app.get("/mode")
def get_mode() -> dict[str, str]:
    m = get_data_mode()
    has_data = test_dataset_has_data()
    return {"mode": m, "datasetAvailable": str(has_data).lower()}


@app.post("/mode")
def set_mode(req: ModeRequest) -> dict[str, str]:
    m = req.mode.strip().lower()
    if m not in ("camera", "dataset"):
        return JSONResponse(
            status_code=400,
            content={"error": "INVALID_MODE", "message": "mode must be 'camera' or 'dataset'"},
        )
    if m == "dataset" and not test_dataset_has_data():
        return JSONResponse(
            status_code=400,
            content={
                "error": "NO_TEST_DATA",
                "message": "Test data not found. Run: python prepare_test_data.py",
            },
        )
    set_data_mode(m)
    return {"mode": m}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/preview/{camera_id}")
def preview_frame(camera_id: str) -> Response:
    """本服务最近一次 /detections 采样时该路的 BGR 帧 JPEG（与实时 RTSP 转码流无关）。"""
    blob = get_preview_jpeg(camera_id)
    if blob is None:
        return Response(status_code=404)
    return Response(content=blob, media_type="image/jpeg")


@app.get("/detections")
def detections() -> JSONResponse:
    try:
        body = build_detections_payload()
        return JSONResponse(content=body)
    except Exception as e:
        msg = f"{e}\n{traceback.format_exc()[-4000:]}"
        return JSONResponse(status_code=500, content={"error": "REID_PIPELINE_FAILED", "message": msg})


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("REID_BIND_HOST", "0.0.0.0")
    port = int(os.environ.get("REID_BIND_PORT", "8890"))
    uvicorn.run("main:app", host=host, port=port, reload=False)
