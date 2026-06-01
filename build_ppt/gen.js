const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");

// ---------- palette ----------
const INK = "0F1A2E";       // dark bg
const NAVY = "21295C";
const DEEP = "0A3D62";
const TEAL = "1C7293";
const CYAN = "2DD4BF";      // accent
const SKY = "38BDF8";
const LIGHT = "F4F7FB";     // light content bg
const CARD = "FFFFFF";
const TEXT = "1E293B";
const MUTED = "64748B";
const LINE = "DCE5EF";

const HFONT = "Trebuchet MS";
const BFONT = "Calibri";

async function icon(Comp, color = "#FFFFFF", size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { color, size: String(size) })
  );
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + png.toString("base64");
}
const hex = (h) => "#" + h;

(async () => {
  const p = new pptxgen();
  p.layout = "LAYOUT_WIDE"; // 13.33 x 7.5
  p.author = "geodance-reid";
  p.title = "geodance-reid 项目汇报";
  const W = 13.33, H = 7.5;

  // pre-render icons
  const IC = {
    cam: await icon(fa.FaVideo, hex(CYAN)),
    users: await icon(fa.FaUsers, hex(CYAN)),
    link: await icon(fa.FaProjectDiagram, hex(CYAN)),
    bolt: await icon(fa.FaBolt, hex(CYAN)),
    brain: await icon(fa.FaBrain, hex(CYAN)),
    server: await icon(fa.FaServer, hex(CYAN)),
    react: await icon(fa.FaReact, hex(SKY)),
    python: await icon(fa.FaPython, hex(SKY)),
    eye: await icon(fa.FaEye, hex(CYAN)),
    fingerprint: await icon(fa.FaFingerprint, hex(CYAN)),
    filter: await icon(fa.FaFilter, hex(CYAN)),
    shield: await icon(fa.FaShieldAlt, hex(CYAN)),
    lock: await icon(fa.FaLock, hex(CYAN)),
    sliders: await icon(fa.FaSlidersH, hex(CYAN)),
    image: await icon(fa.FaImages, hex(CYAN)),
    check: await icon(fa.FaCheckCircle, hex(CYAN)),
    layers: await icon(fa.FaLayerGroup, hex(CYAN)),
    exch: await icon(fa.FaExchangeAlt, hex(CYAN)),
    wrench: await icon(fa.FaWrench, hex(CYAN)),
    low: await icon(fa.FaSignal, hex(CYAN)),
    broken: await icon(fa.FaExclamationTriangle, hex(CYAN)),
  };

  const shadow = () => ({ type: "outer", color: "0B1220", blur: 9, offset: 3, angle: 90, opacity: 0.16 });

  // ---- helpers ----
  function pageTitle(slide, kicker, title) {
    slide.addText(kicker, { x: 0.7, y: 0.42, w: 11, h: 0.32, fontFace: HFONT, fontSize: 12, color: TEAL, bold: true, charSpacing: 3, margin: 0 });
    slide.addText(title, { x: 0.7, y: 0.72, w: 12, h: 0.7, fontFace: HFONT, fontSize: 30, color: NAVY, bold: true, margin: 0 });
  }

  // ============ SLIDE 1: TITLE ============
  {
    const s = p.addSlide();
    s.background = { color: INK };
    // decorative concentric rings (camera/scan motif) on right
    s.addShape(p.shapes.OVAL, { x: 9.0, y: -1.6, w: 6.4, h: 6.4, fill: { type: "solid", color: NAVY, transparency: 35 }, line: { color: TEAL, width: 1, transparency: 40 } });
    s.addShape(p.shapes.OVAL, { x: 10.1, y: -0.5, w: 4.2, h: 4.2, fill: { color: DEEP, transparency: 55 }, line: { color: CYAN, width: 1, transparency: 30 } });
    s.addShape(p.shapes.OVAL, { x: 11.0, y: 0.35, w: 2.4, h: 2.4, fill: { color: CYAN, transparency: 70 }, line: { type: "none" } });
    s.addImage({ data: IC.cam, x: 11.75, y: 1.1, w: 0.9, h: 0.9 });

    s.addText("项目技术汇报", { x: 0.85, y: 1.9, w: 8, h: 0.4, fontFace: HFONT, fontSize: 14, color: CYAN, bold: true, charSpacing: 4, margin: 0 });
    s.addText("室内多摄像头\n跨镜行人 Re-ID 系统", { x: 0.8, y: 2.35, w: 9.2, h: 1.9, fontFace: HFONT, fontSize: 46, color: "FFFFFF", bold: true, lineSpacingMultiple: 1.02, margin: 0 });
    s.addText("geodance-reid · 基于 YOLO + ByteTrack 思路 + Fast-ReID 的全栈实时人数感知系统",
      { x: 0.85, y: 4.55, w: 9.5, h: 0.5, fontFace: BFONT, fontSize: 16, color: "C7D6E8", margin: 0 });
    s.addShape(p.shapes.LINE, { x: 0.88, y: 5.25, w: 3.2, h: 0, line: { color: CYAN, width: 2.5 } });
    s.addText([
      { text: "Next.js 15 + React 19   ·   ", options: { color: "8FA8C4" } },
      { text: "FastAPI + PyTorch   ·   ", options: { color: "8FA8C4" } },
      { text: "9 路 RTSP 摄像头", options: { color: CYAN, bold: true } },
    ], { x: 0.85, y: 5.55, w: 10, h: 0.4, fontFace: BFONT, fontSize: 13, margin: 0 });
    s.addText("汇报日期：2026-06-02", { x: 0.85, y: 6.7, w: 6, h: 0.3, fontFace: BFONT, fontSize: 11, color: "6E86A3", margin: 0 });
  }

  // ============ SLIDE 2: BACKGROUND & GOALS ============
  {
    const s = p.addSlide();
    s.background = { color: LIGHT };
    pageTitle(s, "BACKGROUND  /  项目背景与目标", "把多路摄像头里的“同一个人”数清楚");

    s.addText("室内场景部署了多路 RTSP 摄像头，部分摄像头视野存在重叠。同一个人会以不同角度同时出现在多个画面中，简单地把每路人数相加会严重重复计数。本项目要在低采样率下完成检测、跨镜身份合并，并实时渲染画面。",
      { x: 0.7, y: 1.65, w: 12, h: 0.95, fontFace: BFONT, fontSize: 15, color: TEXT, lineSpacingMultiple: 1.15, margin: 0 });

    const goals = [
      [IC.cam, "实时画面渲染", "9 路 RTSP 转 MJPEG 在前端实时显示，识别可低采样（约每 3 秒一次）"],
      [IC.users, "跨镜唯一身份", "同一人在不同摄像头获得同一个全局 ID，画面上叠加人框与编号"],
      [IC.link, "重叠视野去重", "对配置为视野重叠的摄像头对做去重，避免同一人被重复统计"],
      [IC.check, "全局总人数", "合并所有摄像头身份后，输出当前室内实际可见总人数"],
    ];
    const cw = 2.92, gap = 0.22, x0 = 0.7, y0 = 2.95, ch = 3.05;
    goals.forEach(([ic, t, d], i) => {
      const x = x0 + i * (cw + gap);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: y0, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, rectRadius: 0.09, shadow: shadow() });
      s.addShape(p.shapes.OVAL, { x: x + 0.32, y: y0 + 0.32, w: 0.95, h: 0.95, fill: { color: NAVY } });
      s.addImage({ data: ic, x: x + 0.56, y: y0 + 0.56, w: 0.47, h: 0.47 });
      s.addText(t, { x: x + 0.28, y: y0 + 1.45, w: cw - 0.56, h: 0.4, fontFace: HFONT, fontSize: 16, bold: true, color: NAVY, margin: 0 });
      s.addText(d, { x: x + 0.28, y: y0 + 1.9, w: cw - 0.56, h: 1.0, fontFace: BFONT, fontSize: 12.5, color: MUTED, lineSpacingMultiple: 1.12, margin: 0 });
    });
  }

  // ============ SLIDE 3: ARCHITECTURE ============
  {
    const s = p.addSlide();
    s.background = { color: LIGHT };
    pageTitle(s, "ARCHITECTURE  /  系统总体架构", "前端实时渲染 + 后端低频识别的双层结构");

    // three column blocks: Cameras -> Frontend -> Backend
    const blocks = [
      { x: 0.7, w: 3.0, color: TEAL, ic: IC.cam, head: "RTSP 摄像头层", lines: ["9 路室内摄像头", "rtsp://geo.7sref.com:1989", "普通 / 低可用 / 低清三类"] },
      { x: 4.1, w: 4.55, color: NAVY, ic: IC.react, head: "Next.js 前端 / API 层", lines: ["/api/rtsp/<id> ffmpeg 实时转 MJPEG", "/api/detections 轮询识别结果并叠框", "/api/detection-preview 识别帧预览", "登录鉴权 · 每用户摄像头管理"] },
      { x: 9.05, w: 3.58, color: DEEP, ic: IC.python, head: "Python Re-ID 后端", lines: ["FastAPI + Uvicorn (:8890)", "YOLO 行人检测 + 姿态", "Fast-ReID / OSNet 特征", "跨镜画廊匹配全局 ID"] },
    ];
    const by = 1.9, bh = 3.0;
    blocks.forEach((b) => {
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: b.x, y: by, w: b.w, h: bh, fill: { color: CARD }, line: { color: LINE, width: 1 }, rectRadius: 0.08, shadow: shadow() });
      s.addShape(p.shapes.RECTANGLE, { x: b.x, y: by, w: b.w, h: 0.62, fill: { color: b.color } });
      s.addImage({ data: b.ic, x: b.x + 0.22, y: by + 0.12, w: 0.38, h: 0.38 });
      s.addText(b.head, { x: b.x + 0.68, y: by, w: b.w - 0.78, h: 0.62, fontFace: HFONT, fontSize: 14.5, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
      s.addText(b.lines.map((t, i) => ({ text: t, options: { bullet: { code: "2022", indent: 12 }, breakLine: true, paraSpaceAfter: 6 } })),
        { x: b.x + 0.28, y: by + 0.85, w: b.w - 0.5, h: bh - 1.0, fontFace: BFONT, fontSize: 12.5, color: TEXT, valign: "top", margin: 0 });
    });
    // arrows
    s.addText("►", { x: 3.7, y: by + 1.2, w: 0.4, h: 0.5, fontSize: 22, color: CYAN, bold: true, align: "center", margin: 0 });
    s.addText("◄ ►", { x: 8.55, y: by + 1.2, w: 0.55, h: 0.5, fontSize: 16, color: CYAN, bold: true, align: "center", margin: 0 });

    // bottom band: data flow
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.7, y: 5.25, w: 11.93, h: 1.55, fill: { color: NAVY }, rectRadius: 0.08 });
    s.addText("数据流", { x: 0.95, y: 5.42, w: 2, h: 0.35, fontFace: HFONT, fontSize: 13, bold: true, color: CYAN, margin: 0 });
    const flow = ["RTSP 拉流", "ffmpeg 解码", "YOLO 检测", "Re-ID 特征", "画廊匹配 ID", "重叠去重", "前端叠框 + 总人数"];
    const fx0 = 0.95, fw = 1.52, fgap = 0.18, fy = 5.95;
    flow.forEach((t, i) => {
      const x = fx0 + i * (fw + fgap);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: fy, w: fw, h: 0.62, fill: { color: DEEP }, line: { color: TEAL, width: 1 }, rectRadius: 0.3 });
      s.addText(t, { x, y: fy, w: fw, h: 0.62, fontFace: BFONT, fontSize: 11, bold: true, color: "E6F1FB", align: "center", valign: "middle", margin: 0 });
      if (i < flow.length - 1) s.addText("›", { x: x + fw - 0.02, y: fy, w: fgap + 0.04, h: 0.62, fontSize: 16, color: CYAN, bold: true, align: "center", valign: "middle", margin: 0 });
    });
  }

  // ============ SLIDE 4: TECH STACK ============
  {
    const s = p.addSlide();
    s.background = { color: LIGHT };
    pageTitle(s, "TECH STACK  /  技术栈", "全栈选型：实时性、识别精度与可维护性的平衡");

    const cats = [
      { ic: IC.react, head: "前端", color: NAVY, items: ["Next.js 15 (App Router)", "React 19 · TypeScript", "MJPEG 实时预览 + Canvas 叠框", "HttpOnly 会话鉴权"] },
      { ic: IC.python, head: "后端服务", color: DEEP, items: ["FastAPI + Uvicorn", "Python 3.10+ (建议 3.12)", "OpenCV 帧抓取与质量检测", "ffmpeg 硬解 / 软解兜底"] },
      { ic: IC.brain, head: "检测与识别", color: TEAL, items: ["YOLOv8 行人检测 + Pose", "Fast-ReID (Market BoT-R50)", "torchreid / OSNet 备选", "色彩直方图混合特征"] },
      { ic: IC.layers, head: "跨镜逻辑", color: "0F766E", items: ["每路 IoU + 位移 + 余弦跟踪", "多原型余弦画廊匹配", "重叠摄像头对去重", "休眠池重识别复活"] },
    ];
    const cw = 2.92, gap = 0.22, x0 = 0.7, y0 = 1.95, ch = 4.6;
    cats.forEach((c, i) => {
      const x = x0 + i * (cw + gap);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: y0, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, rectRadius: 0.09, shadow: shadow() });
      s.addShape(p.shapes.OVAL, { x: x + cw / 2 - 0.55, y: y0 + 0.4, w: 1.1, h: 1.1, fill: { color: c.color } });
      s.addImage({ data: c.ic, x: x + cw / 2 - 0.28, y: y0 + 0.67, w: 0.56, h: 0.56 });
      s.addText(c.head, { x, y: y0 + 1.65, w: cw, h: 0.4, fontFace: HFONT, fontSize: 17, bold: true, color: NAVY, align: "center", margin: 0 });
      s.addShape(p.shapes.LINE, { x: x + cw / 2 - 0.4, y: y0 + 2.12, w: 0.8, h: 0, line: { color: CYAN, width: 2 } });
      s.addText(c.items.map((t) => ({ text: t, options: { bullet: { code: "2022", indent: 12 }, breakLine: true, paraSpaceAfter: 8 } })),
        { x: x + 0.3, y: y0 + 2.35, w: cw - 0.55, h: ch - 2.55, fontFace: BFONT, fontSize: 12, color: TEXT, valign: "top", margin: 0 });
    });
  }

  // ============ SLIDE 5: PIPELINE ============
  {
    const s = p.addSlide();
    s.background = { color: LIGHT };
    pageTitle(s, "PIPELINE  /  核心处理流程", "一次 /detections 采样：从原始帧到全局人数");

    const steps = [
      [IC.eye, "1 · 抓帧与质检", "按低采样率从每路 RTSP 抓帧，frame_quality 过滤 HEVC 花屏、撕裂、灰块等坏帧"],
      [IC.cam, "2 · YOLO 检测", "YOLOv8 检出 person 框，person_filters 做置信度/形状过滤，box_nms 去重叠框"],
      [IC.fingerprint, "3 · Re-ID 特征", "对每个人框提取 Fast-ReID/OSNet 深度特征，叠加上下半身色彩直方图与姿态描述"],
      [IC.exch, "4 · 跟踪 + 画廊匹配", "每路用 IoU+位移+余弦关联轨迹复用 ID；新框统一排序后进余弦画廊匹配全局 ID"],
      [IC.link, "5 · 重叠去重", "对配置重叠的摄像头对，同一 globalPersonId 只保留一路框，避免重复计数"],
      [IC.users, "6 · 输出人数", "汇总去重后的全局 ID 集合，返回各路叠框数据与当前可见总人数"],
    ];
    const cw = 3.86, gap = 0.18, ch = 2.18;
    const xs = [0.7, 0.7 + cw + gap, 0.7 + 2 * (cw + gap)];
    steps.forEach(([ic, t, d], i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = xs[col], y = 1.95 + row * (ch + 0.25);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, rectRadius: 0.08, shadow: shadow() });
      s.addShape(p.shapes.RECTANGLE, { x, y, w: 0.1, h: ch, fill: { color: CYAN } });
      s.addShape(p.shapes.OVAL, { x: x + 0.3, y: y + 0.3, w: 0.8, h: 0.8, fill: { color: NAVY } });
      s.addImage({ data: ic, x: x + 0.5, y: y + 0.5, w: 0.4, h: 0.4 });
      s.addText(t, { x: x + 1.25, y: y + 0.28, w: cw - 1.45, h: 0.75, fontFace: HFONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", margin: 0 });
      s.addText(d, { x: x + 0.35, y: y + 1.12, w: cw - 0.65, h: 0.95, fontFace: BFONT, fontSize: 11.8, color: MUTED, lineSpacingMultiple: 1.12, margin: 0 });
    });
  }

  // ============ SLIDE 6: REID MATCHING (key innovation) ============
  {
    const s = p.addSlide();
    s.background = { color: INK };
    s.addText("CORE ALGORITHM  /  跨镜 Re-ID 匹配", { x: 0.7, y: 0.42, w: 11, h: 0.32, fontFace: HFONT, fontSize: 12, color: CYAN, bold: true, charSpacing: 3, margin: 0 });
    s.addText("多原型余弦画廊：让“背面 / 侧面 / 跨镜”的同一人对得上", { x: 0.7, y: 0.74, w: 12, h: 0.7, fontFace: HFONT, fontSize: 28, color: "FFFFFF", bold: true, margin: 0 });

    const left = [
      [IC.layers, "每人多条原型", "每个全局 ID 保留至多 K 条 L2 归一化原型（正面/侧面/背面多视角），匹配取与 query 的最大余弦，避免单向量 EMA 把多视角“平均糊掉”"],
      [IC.sliders, "阈值 + 间隔判定", "余弦超过阈值且与次优 ID 间隔足够才合并；最像原型仍偏低时追加新视角原型，而非强行覆盖"],
      [IC.brain, "跟踪 + 休眠复活", "每路用 IoU+中心位移+Re-ID 余弦关联本地轨迹复用 ID；人离开进休眠池，再入画时用偏外观的宽松匹配复活为同一人"],
    ];
    const y0 = 1.85, ch = 1.55;
    left.forEach(([ic, t, d], i) => {
      const y = y0 + i * (ch + 0.2);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.7, y, w: 7.0, h: ch, fill: { color: NAVY }, line: { color: TEAL, width: 1 }, rectRadius: 0.08 });
      s.addShape(p.shapes.OVAL, { x: 0.95, y: y + 0.32, w: 0.85, h: 0.85, fill: { color: DEEP } });
      s.addImage({ data: ic, x: 1.16, y: y + 0.53, w: 0.43, h: 0.43 });
      s.addText(t, { x: 2.0, y: y + 0.18, w: 5.5, h: 0.4, fontFace: HFONT, fontSize: 15, bold: true, color: CYAN, margin: 0 });
      s.addText(d, { x: 2.0, y: y + 0.55, w: 5.5, h: 0.95, fontFace: BFONT, fontSize: 11.5, color: "C7D6E8", lineSpacingMultiple: 1.1, margin: 0 });
    });

    // right: params panel
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 8.0, y: 1.85, w: 4.63, h: 4.95, fill: { color: "13233D" }, line: { color: TEAL, width: 1 }, rectRadius: 0.08 });
    s.addText("关键可调参数", { x: 8.3, y: 2.05, w: 4, h: 0.4, fontFace: HFONT, fontSize: 15, bold: true, color: "FFFFFF", margin: 0 });
    const params = [
      ["REID_MATCH_THRESHOLD", "0.60", "跨镜合并余弦阈值"],
      ["REID_PROTOTYPES_PER_PERSON", "5", "每人最多原型数"],
      ["REID_GALLERY_EMA", "0.12", "原型滑动更新系数"],
      ["REID_MIN_MARGIN", "0.03", "与次优 ID 最小间隔"],
      ["REID_PER_CAMERA_TRACK", "1", "每路轨迹跟踪开关"],
      ["REID_GLOBAL_MATCH_ORDER", "1", "全路统一排序进画廊"],
    ];
    let py = 2.62;
    params.forEach(([k, v, d]) => {
      s.addText([{ text: k, options: { color: SKY, bold: true } }, { text: "  = " + v, options: { color: CYAN, bold: true } }],
        { x: 8.3, y: py, w: 4.1, h: 0.3, fontFace: "Consolas", fontSize: 11.5, margin: 0 });
      s.addText(d, { x: 8.3, y: py + 0.27, w: 4.1, h: 0.3, fontFace: BFONT, fontSize: 10.5, color: "8FA8C4", margin: 0 });
      py += 0.69;
    });
  }

  // ============ SLIDE 7: HARD CAMERAS ============
  {
    const s = p.addSlide();
    s.background = { color: LIGHT };
    pageTitle(s, "ROBUSTNESS  /  难点摄像头处理", "低可用、低清与坏帧：让系统在真实环境里稳得住");

    const cards = [
      { ic: IC.broken, head: "HEVC 花屏 / 撕裂帧", color: TEAL, items: ["frame_quality 检测上下半幅错位、色块、无纹理灰块", "ffmpeg nokey + OpenCV 持久抓取，遇花屏自动重试"] },
      { ic: IC.low, head: "低可用 / 低清摄像头", color: DEEP, items: ["stairs_1/2 低可用：404 探测 + 容错重连", "iidx 低清：色彩直方图混合特征，40px 下仍可区分"] },
      { ic: IC.filter, head: "误检与重复框", color: NAVY, items: ["person_filters 置信度/形状过滤（默认偏宽松不漏框）", "box_nms 同路去重叠框，region_dedupe 合并输出层"] },
      { ic: IC.image, head: "测试数据模式", color: "0F766E", items: ["无稳定 RTSP 时用 prepare_test_data 生成本地帧", "前端一键切换 Data Mode 验证完整 Re-ID 流程"] },
    ];
    const cw = 6.0, gap = 0.3, ch = 2.18, x0 = 0.7, y0 = 2.0;
    cards.forEach((c, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = x0 + col * (cw + gap), y = y0 + row * (ch + 0.25);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w: cw, h: ch, fill: { color: CARD }, line: { color: LINE, width: 1 }, rectRadius: 0.08, shadow: shadow() });
      s.addShape(p.shapes.OVAL, { x: x + 0.32, y: y + 0.38, w: 0.95, h: 0.95, fill: { color: c.color } });
      s.addImage({ data: c.ic, x: x + 0.56, y: y + 0.62, w: 0.47, h: 0.47 });
      s.addText(c.head, { x: x + 1.45, y: y + 0.32, w: cw - 1.7, h: 0.55, fontFace: HFONT, fontSize: 16.5, bold: true, color: NAVY, valign: "middle", margin: 0 });
      s.addText(c.items.map((t) => ({ text: t, options: { bullet: { code: "2022", indent: 12 }, breakLine: true, paraSpaceAfter: 6 } })),
        { x: x + 0.42, y: y + 1.0, w: cw - 0.8, h: 1.05, fontFace: BFONT, fontSize: 12.2, color: TEXT, lineSpacingMultiple: 1.1, valign: "top", margin: 0 });
    });
  }

  // ============ SLIDE 8: FRONTEND & USERS ============
  {
    const s = p.addSlide();
    s.background = { color: LIGHT };
    pageTitle(s, "PRODUCT  /  前端功能与用户系统", "可登录、可管理、可实时观测的完整产品形态");

    const feats = [
      [IC.lock, "登录与会话", "不开放注册，部署前用环境变量初始化管理员；登录后下发 HttpOnly 会话 cookie"],
      [IC.sliders, "每用户摄像头管理", "Camera Admin 面板增删 RTSP 摄像头，按用户命名空间隔离预览缓存与 Re-ID 画廊"],
      [IC.eye, "实时预览叠框", "/api/rtsp 实时 MJPEG，/api/detections 轮询并在画面叠加人框与全局 ID"],
      [IC.image, "识别帧预览", "/api/detection-preview 读取同一次采样的识别帧缓存，对照检测效果"],
    ];
    const y0 = 2.0, rh = 1.12;
    feats.forEach(([ic, t, d], i) => {
      const y = y0 + i * (rh + 0.16);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 0.7, y, w: 7.4, h: rh, fill: { color: CARD }, line: { color: LINE, width: 1 }, rectRadius: 0.08, shadow: shadow() });
      s.addShape(p.shapes.OVAL, { x: 0.95, y: y + 0.24, w: 0.66, h: 0.66, fill: { color: NAVY } });
      s.addImage({ data: ic, x: 1.11, y: y + 0.4, w: 0.34, h: 0.34 });
      s.addText(t, { x: 1.8, y: y + 0.16, w: 6.1, h: 0.4, fontFace: HFONT, fontSize: 15, bold: true, color: NAVY, margin: 0 });
      s.addText(d, { x: 1.8, y: y + 0.55, w: 6.15, h: 0.5, fontFace: BFONT, fontSize: 11.8, color: MUTED, lineSpacingMultiple: 1.08, margin: 0 });
    });

    // right stat panel
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: 8.45, y: 2.0, w: 4.18, h: 5.0, fill: { color: NAVY }, rectRadius: 0.09, shadow: shadow() });
    s.addText("数据与隔离", { x: 8.75, y: 2.25, w: 3.6, h: 0.4, fontFace: HFONT, fontSize: 16, bold: true, color: CYAN, margin: 0 });
    const stats = [["9", "路室内 RTSP 摄像头"], ["3", "类摄像头（普通/低可用/低清）"], ["1", "份本地 app-store.json 用户数据"], ["~3s", "识别采样周期，画面实时渲染"]];
    let sy = 2.95;
    stats.forEach(([n, l]) => {
      s.addText(n, { x: 8.75, y: sy, w: 3.6, h: 0.6, fontFace: HFONT, fontSize: 34, bold: true, color: "FFFFFF", margin: 0 });
      s.addText(l, { x: 8.75, y: sy + 0.62, w: 3.6, h: 0.4, fontFace: BFONT, fontSize: 12, color: "C7D6E8", margin: 0 });
      sy += 1.02;
    });
  }

  // ============ SLIDE 9: SUMMARY ============
  {
    const s = p.addSlide();
    s.background = { color: INK };
    s.addShape(p.shapes.OVAL, { x: -1.5, y: 4.2, w: 5.5, h: 5.5, fill: { color: NAVY, transparency: 45 }, line: { type: "none" } });
    s.addShape(p.shapes.OVAL, { x: 10.5, y: -2.0, w: 5.5, h: 5.5, fill: { color: DEEP, transparency: 50 }, line: { type: "none" } });

    s.addText("SUMMARY  /  总结与展望", { x: 0.85, y: 0.9, w: 11, h: 0.4, fontFace: HFONT, fontSize: 13, color: CYAN, bold: true, charSpacing: 3, margin: 0 });
    s.addText("一套端到端、可落地的跨镜人数感知系统", { x: 0.8, y: 1.35, w: 11.5, h: 0.8, fontFace: HFONT, fontSize: 32, color: "FFFFFF", bold: true, margin: 0 });

    const sums = [
      [IC.check, "完成项", "实时多路渲染、低频识别、跨镜全局 ID 合并与重叠去重的全栈闭环已跑通"],
      [IC.shield, "鲁棒性", "针对花屏、低可用、低清摄像头做了质检、容错与混合特征处理"],
      [IC.users, "产品化", "登录鉴权 + 每用户摄像头管理 + 识别帧预览，具备可部署的产品形态"],
    ];
    const cw = 3.84, gap = 0.2, x0 = 0.85, y0 = 2.5, ch = 2.0;
    sums.forEach(([ic, t, d], i) => {
      const x = x0 + i * (cw + gap);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: y0, w: cw, h: ch, fill: { color: "13233D" }, line: { color: TEAL, width: 1 }, rectRadius: 0.08 });
      s.addShape(p.shapes.OVAL, { x: x + 0.3, y: y0 + 0.32, w: 0.8, h: 0.8, fill: { color: DEEP } });
      s.addImage({ data: ic, x: x + 0.5, y: y0 + 0.52, w: 0.4, h: 0.4 });
      s.addText(t, { x: x + 1.25, y: y0 + 0.42, w: cw - 1.4, h: 0.5, fontFace: HFONT, fontSize: 17, bold: true, color: CYAN, valign: "middle", margin: 0 });
      s.addText(d, { x: x + 0.32, y: y0 + 1.25, w: cw - 0.6, h: 0.7, fontFace: BFONT, fontSize: 11.8, color: "C7D6E8", lineSpacingMultiple: 1.12, margin: 0 });
    });

    s.addText("后续方向", { x: 0.85, y: 4.85, w: 4, h: 0.35, fontFace: HFONT, fontSize: 14, bold: true, color: CYAN, margin: 0 });
    s.addText([
      { text: "引入真正的 ByteTrack / BoT-SORT 在线跟踪以提升轨迹连续性   ·   ", options: {} },
      { text: "GPU 推理加速提升采样频率   ·   ", options: {} },
      { text: "重叠摄像头自动标定与几何约束", options: {} },
    ], { x: 0.85, y: 5.2, w: 11.6, h: 0.7, fontFace: BFONT, fontSize: 13, color: "C7D6E8", lineSpacingMultiple: 1.15, margin: 0 });

    s.addShape(p.shapes.LINE, { x: 0.88, y: 6.35, w: 11.6, h: 0, line: { color: TEAL, width: 1 } });
    s.addText("geodance-reid   ·   室内多摄像头跨镜行人 Re-ID 系统   ·   感谢观看", { x: 0.85, y: 6.55, w: 11.6, h: 0.4, fontFace: HFONT, fontSize: 13, bold: true, color: "8FA8C4", align: "center", margin: 0 });
  }

  await p.writeFile({ fileName: "S:/Github/geodance-reid/geodance-reid-汇报.pptx" });
  console.log("DONE");
})();
