# geodance-reid

室内多 RTSP 摄像头行人检测与跨镜 Re-ID 展示系统。前端使用 Next.js 展示实时摄像头画面，后端使用 YOLO + Re-ID 服务按低采样率做行人检测、跨摄像头 ID 合并，并返回当前可见人数。

项目内置登录系统。每个用户登录后都有自己的摄像头管理面板，可以添加、删除 RTSP 摄像头；实时预览、识别请求和识别帧预览都会使用当前登录用户的摄像头列表。

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

## 登录与用户数据

项目没有开放注册。部署前在项目根目录 `.env.local` 中添加管理员登录信息：

```bash
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=换成至少8位的强密码
```

首次启动时，如果本地用户数据文件里还没有任何用户，Next.js 会用上面两个变量初始化管理员账号。管理员用户会复制当前默认摄像头列表，登录后可从导航栏进入 `Camera Admin` 设置页调整。

用户、密码哈希和每个用户的摄像头配置保存在本地：

```text
data/app-store.json
```

该文件已被 `.gitignore` 排除，不会提交到仓库。如果你改了 `AUTH_ADMIN_USERNAME` 或 `AUTH_ADMIN_PASSWORD`，但 `data/app-store.json` 已经存在且里面已有用户，旧用户不会自动覆盖；需要删除该文件后重启，或直接编辑/迁移数据。

需要把用户数据放到其他位置时，可设置：

```bash
AUTH_STORE_PATH=/absolute/path/to/app-store.json
```

登录成功后，浏览器会保存 HttpOnly 会话 cookie。退出登录会清除该 cookie。

## 摄像头管理

登录后可从导航栏进入 `Camera Admin` 设置页添加和删除摄像头。添加时需要：

- `ID`：只允许字母、数字、下划线和连字符，例如 `room`、`stairs_1`
- `名称`：页面显示名
- `RTSP 地址`：必须以 `rtsp://` 或 `rtsps://` 开头
- `类型`：普通、低可用、低清

当前用户的摄像头列表会同时用于：

- `/api/rtsp/<cameraId>` 实时 MJPEG 预览
- `/api/detections` 向 Python Re-ID 后端发送当前用户的摄像头列表
- `/api/detection-preview/<cameraId>` 读取同一次采样的识别帧缓存

Python 后端的 `GET /detections` 仍保留静态默认摄像头列表；Next.js 实际使用的是 `POST /detections`，请求体会携带当前用户的摄像头列表和用户命名空间，避免不同用户的预览缓存和 Re-ID 画廊混用。

## 测试数据模式

没有稳定 RTSP 或想先验证 Re-ID 流程时，可以生成本地测试帧：

```bash
cd backend/reid_service
python prepare_test_data.py
```

然后启动后端和前端，点击首页导航栏的 `Data Mode` 按钮切换到测试集模式。后端会读取 `backend/reid_service/test_data/cam_*` 作为虚拟摄像头。

## 摄像头配置

默认新用户摄像头列表来自两个静态文件：

- 前端：`lib/cameras.ts`
- 后端：`backend/reid_service/cameras_data.py`

登录后的实际摄像头列表优先使用 `data/app-store.json` 中当前用户自己的配置。若需要调整新用户初始列表，修改 `lib/cameras.ts`；若需要直接调用 Python `GET /detections`，则同步修改 `backend/reid_service/cameras_data.py`。

当前默认列表中部分低可用或低清摄像头被注释。需要默认启用时，同时取消两处对应摄像头注释：

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
