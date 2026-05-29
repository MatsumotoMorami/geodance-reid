# geodance-reid

室内多 RTSP 摄像头行人检测与跨镜 Re-ID 展示系统。前端使用 Next.js 展示实时摄像头画面，后端使用 YOLO + Re-ID 服务按低采样率做行人检测、跨摄像头 ID 合并，并返回当前可见人数。

## 运行环境

- Node.js 20+
- Python 3.10+，建议 3.12
- ffmpeg
- 可访问 RTSP 源：`rtsp://geo.7sref.com:1989/<device_name>`

macOS 可先安装 ffmpeg：

```bash
brew install ffmpeg
```

## 安装依赖

前端依赖：

```bash
npm install
```

后端建议使用虚拟环境：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/reid_service/requirements.txt
```

如果使用默认 `fastreid` 后端，还需要另行安装 Fast-ReID，并准备对应权重：

```bash
cd ~/Documents
git clone https://github.com/JDAI-CV/fast-reid.git Fast-ReID
cd Fast-ReID
pip install -r docs/requirements.txt
pip install -e .
```

如果不想先接 Fast-ReID，可以用 `torchreid` 后端，配置见下面的 `backend/reid_service/.env`。

## 配置环境变量

### 1. 前端 `.env.local`

在项目根目录创建 `.env.local`：

```bash
REID_DETECTIONS_URL=http://127.0.0.1:8890/detections
REID_BACKEND_FETCH_MS=180000

# 可选：RTSP 转 MJPEG 参数
RTSP_FFMPEG_HWACCEL=videotoolbox
RTSP_FFMPEG_PROBESIZE=10M
RTSP_FFMPEG_ANALYZEDURATION=10M
RTSP_FFMPEG_MAX_DELAY_US=8000000
RTSP_MJPEG_Q=6
```

如果只想看前端模拟数据，可以不设置 `REID_DETECTIONS_URL`。

### 2. 后端 `backend/reid_service/.env`

先复制示例：

```bash
cp backend/reid_service/env.fastreid.example backend/reid_service/.env
```

使用 Fast-ReID 时，至少修改这些路径：

```bash
FASTREID_ROOT=/Users/你的用户名/Documents/Fast-ReID
FASTREID_CONFIG=/Users/你的用户名/Documents/Fast-ReID/configs/Market1501/bagtricks_R50.yml
FASTREID_WEIGHTS=/Users/你的用户名/Documents/Fast-ReID/weights/market_bot_R50.pth
FASTREID_DEVICE=cpu
YOLO_DEVICE=cpu
REID_BIND_HOST=0.0.0.0
REID_BIND_PORT=8890
```

使用 torchreid/OSNet 时，可改成：

```bash
REID_EMBED_BACKEND=torchreid
TORCHREID_MODEL=osnet_ain_x1_0
TORCHREID_WEIGHTS=/path/to/osnet_ain_x1_0_msmt17.pth.tar
TORCHREID_DEVICE=cpu
YOLO_DEVICE=cpu
REID_BIND_HOST=0.0.0.0
REID_BIND_PORT=8890
```

YOLO 权重可以放在 `backend/reid_service/weights/`，或用 `YOLO_WEIGHTS=/absolute/path/to/yolov8n.pt` 指定。未指定且本地缺失时，后端会尝试下载默认 YOLO 模型。

## 启动

需要开两个终端。

终端 1：启动 Re-ID 后端：

```bash
source .venv/bin/activate
npm run reid:serve
```

健康检查：

```bash
curl http://127.0.0.1:8890/health
```

终端 2：启动 Next.js 前端：

```bash
npm run dev
```

浏览器打开：

```text
http://localhost:3000
```

前端会通过 `/api/rtsp/<cameraId>` 实时转码 RTSP 画面，通过 `/api/detections` 轮询后端识别结果，并在画面上叠加人框和全局 ID。

## 测试数据模式

没有稳定 RTSP 或想先验证 Re-ID 流程时，可以生成本地测试帧：

```bash
cd backend/reid_service
python prepare_test_data.py
```

然后启动后端和前端，在页面里切换到 dataset/test data 模式。后端会读取 `backend/reid_service/test_data/cam_*` 作为虚拟摄像头。

## 摄像头配置

摄像头列表在两个地方保持一致：

- 前端：`lib/cameras.ts`
- 后端：`backend/reid_service/cameras_data.py`

当前代码中部分低可用或低清摄像头被注释。需要启用时，同时取消两处对应摄像头注释：

- `stairs_1`
- `stairs_2`
- `iidx`
- `room`
- `mahjong`

## 常见问题

### 页面有画面但没有框

先确认后端接口：

```bash
curl http://127.0.0.1:8890/detections
```

如果返回错误，优先检查 `backend/reid_service/.env` 中的 Re-ID 权重路径、YOLO 权重路径和设备配置。

### RTSP 某路 404 或长期离线

检查摄像头是否在 `lib/cameras.ts` 和 `backend/reid_service/cameras_data.py` 中启用，并确认 RTSP 地址可访问。低可用摄像头可能会间歇性失败，服务会把该路标记为 offline。

### HEVC 花屏、灰块或首帧异常

可在 `backend/reid_service/.env` 调整：

```bash
RTSP_PERSISTENT_CAPTURE=1
RTSP_HEVC_OPEN_SKIP_FRAMES=48
RTSP_PERSISTENT_DRAIN_GRABS=8
RTSP_GRAB_BACKEND=ffmpeg
RTSP_FFMPEG_NOKEY_FALLBACK=1
```

### 识别太慢

CPU 跑九路 RTSP + YOLO + Re-ID 会比较慢。可以先减少启用摄像头数量，或把 `FASTREID_DEVICE`、`YOLO_DEVICE`、`TORCHREID_DEVICE` 改成可用 GPU 设备。

### 前端只显示模拟数据

说明根目录 `.env.local` 没有设置 `REID_DETECTIONS_URL`，或设置后需要重启 `npm run dev`。

## 构建

```bash
npm run build
npm run start
```

生产环境仍需要单独启动 Python Re-ID 后端，并保证 `REID_DETECTIONS_URL` 指向该服务。
