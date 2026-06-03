FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/reid_service/requirements.txt /tmp/requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision \
    && python -m pip install -r /tmp/requirements.txt

COPY backend/reid_service /app/backend/reid_service

WORKDIR /app/backend/reid_service
RUN python download_osnet_weights.py

ENV REID_EMBED_BACKEND=torchreid
ENV TORCHREID_MODEL=osnet_ain_x1_0
ENV TORCHREID_WEIGHTS=/app/backend/reid_service/weights/osnet_ain_x1_0_msmt17_combineall.pth.tar
ENV TORCHREID_DEVICE=cpu
ENV YOLO_DEVICE=cpu
ENV YOLO_MODEL=yolov8n.pt
ENV REID_BIND_HOST=0.0.0.0
ENV REID_BIND_PORT=8890

EXPOSE 8890

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8890/health', timeout=3)"

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8890"]
