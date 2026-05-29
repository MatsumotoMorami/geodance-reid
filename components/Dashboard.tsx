"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraFrame, DemoPayload } from "@/lib/types";
import { CAMERAS, type CameraDef } from "@/lib/cameras";

function tierNote(cam: CameraDef): string {
  if (cam.tier === "low_availability") return "低可用（更长 socket 超时 + 略降帧）";
  if (cam.tier === "low_resolution") return "低清（降分辨率推流）";
  return "";
}

function DetectionOverlays({ frame }: { frame: CameraFrame }) {
  return (
    <>
      {[...frame.detections]
        .sort((a, b) => (a.lowConfidence === b.lowConfidence ? 0 : a.lowConfidence ? -1 : 1))
        .map((d, idx) => {
          const { x, y, w, h } = d.box;
          const weak = Boolean(d.lowConfidence);
          const border = weak ? "2px solid #f59e0b" : "2px solid #84cc16";
          const tagBg = weak ? "#f59e0b" : "#84cc16";
          const tagColor = weak ? "#111" : "#000";
          const confStr = d.confidence !== undefined ? ` ${(d.confidence * 100).toFixed(0)}%` : "";
          return (
            <div
              key={`${frame.cameraId}-${d.globalPersonId}-${weak ? "w" : "s"}-${idx}`}
              style={{
                position: "absolute",
                zIndex: weak ? 1 : 2,
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
                border,
                pointerEvents: "none",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  top: -18,
                  background: tagBg,
                  color: tagColor,
                  fontSize: 12,
                  padding: "0 4px",
                  fontWeight: 700,
                }}
              >
                {weak ? `低置信${confStr}` : `ID ${d.globalPersonId}`}
              </span>
            </div>
          );
        })}
    </>
  );
}

/** 仅实时 MJPEG，不在画面上叠检测框 */
function CameraStreamTile({
  cam,
  streamIndex,
  debugStat,
}: {
  cam: CameraDef;
  streamIndex: number;
  debugStat?: {
    yoloPersons: number;
    yoloRawPersons?: number;
    outputBoxes: number;
    embedFailures: number;
    online: boolean;
    passedConf?: number;
    passedMinSide?: number;
    passedShape?: number;
    weakOutputBoxes?: number;
    activeTracks?: number;
    dormantTracks?: number;
  };
}) {
  const [streamKey, setStreamKey] = useState(0);
  const [streamError, setStreamError] = useState(false);
  /** 生产环境立即挂 img，避免首屏长期停在「准备拉流」；dev 仍错峰拉流 */
  const [streamReady, setStreamReady] = useState(() => process.env.NODE_ENV !== "development");

  const staggerMs = process.env.NODE_ENV === "development" ? streamIndex * 220 : 0;

  useEffect(() => {
    if (staggerMs === 0) {
      setStreamReady(true);
      return;
    }
    const t = setTimeout(() => setStreamReady(true), staggerMs);
    return () => clearTimeout(t);
  }, [staggerMs]);

  const streamSrc = `/api/rtsp/${cam.id}?r=${streamKey}`;

  return (
    <div
      style={{
        position: "relative",
        border: "1px solid #444",
        background: "#000",
        minHeight: 180,
        overflow: "visible",
      }}
    >
      <div style={{ padding: "4px 6px", fontSize: 12, borderBottom: "1px solid #333" }}>
        <strong>{cam.label}</strong>
        {tierNote(cam) ? <span style={{ color: "#888", marginLeft: 6 }}>{tierNote(cam)}</span> : null}
        <div style={{ color: "#666", fontSize: 10, wordBreak: "break-all" }}>{cam.rtspPath}</div>
        {debugStat ? (
          <div style={{ color: "#6a9", fontSize: 10, marginTop: 2 }}>
            调试: online={String(debugStat.online)} YOLO
            {debugStat.yoloRawPersons !== undefined
              ? `原始=${debugStat.yoloRawPersons} NMS后=${debugStat.yoloPersons}`
              : `=${debugStat.yoloPersons}`}
            {debugStat.passedConf !== undefined
              ? ` 过置信度=${debugStat.passedConf} 过边=${debugStat.passedMinSide ?? "?"} 过形=${debugStat.passedShape ?? "?"}`
              : null}{" "}
            框={debugStat.outputBoxes}
            {debugStat.weakOutputBoxes !== undefined ? ` 低置信框=${debugStat.weakOutputBoxes}` : ""}{" "}
            ReID失败={debugStat.embedFailures}
            {debugStat.activeTracks !== undefined ? ` 轨迹=${debugStat.activeTracks}` : ""}
            {debugStat.dormantTracks !== undefined ? ` 休眠=${debugStat.dormantTracks}` : ""}
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          minHeight: 158,
          background: "#222",
          overflow: "hidden",
        }}
      >
        {streamReady ? (
          <img
            src={streamSrc}
            alt=""
            loading="eager"
            decoding="async"
            onLoad={() => setStreamError(false)}
            onError={() => setStreamError(true)}
            style={{
              position: "relative",
              zIndex: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
              filter: cam.tier === "low_resolution" ? "blur(0.6px) contrast(0.95)" : undefined,
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#888",
              fontSize: 12,
              padding: 8,
              textAlign: "center",
            }}
          >
            {process.env.NODE_ENV === "development"
              ? "拉流排队中（避免 dev 下多路长连接与热更新抢 chunk）…"
              : "准备拉流…"}
          </div>
        )}

        {streamError ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 3,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              background: "rgba(0,0,0,0.75)",
              color: "#f88",
              fontSize: 13,
              padding: 8,
              textAlign: "center",
            }}
          >
            <div>RTSP 拉流失败（检查网络、ffmpeg 是否在 PATH、服务端能否访问该 RTSP）</div>
            <button
              type="button"
              onClick={() => {
                setStreamReady(true);
                setStreamKey((k) => k + 1);
              }}
            >
              重试
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 与 /detections 同一次采样缓存的 JPEG + 归一化框（不在监控流上画） */
function DetectionPreviewTile({ cam, payload }: { cam: CameraDef; payload: DemoPayload | null }) {
  const frame = payload?.frames.find((f) => f.cameraId === cam.id);
  const isMock = payload?.clientSource === "mock";
  const bust = payload?.updatedAt ?? 0;
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    setImgErr(false);
  }, [bust, cam.id]);

  return (
    <div
      style={{
        position: "relative",
        border: "1px solid #555",
        background: "#111",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "4px 6px", fontSize: 11, borderBottom: "1px solid #333", color: "#aaa" }}>
        识别帧 · {cam.label}
      </div>
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#1a1a1a" }}>
        {isMock ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
              fontSize: 12,
              padding: 8,
              textAlign: "center",
            }}
          >
            内置模拟无实拍识别帧
          </div>
        ) : imgErr ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#a77",
              fontSize: 12,
              padding: 8,
              textAlign: "center",
            }}
          >
            无识别帧缓存（该路离线或识别后端尚未返回该路 JPEG）
          </div>
        ) : (
          <img
            src={`/api/detection-preview/${encodeURIComponent(cam.id)}?v=${bust}`}
            alt=""
            onError={() => setImgErr(true)}
            style={{
              position: "relative",
              zIndex: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
        {!isMock && !imgErr && frame && frame.detections.length > 0 ? <DetectionOverlays frame={frame} /> : null}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<DemoPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollMsRef = useRef(8000);
  const pullInFlight = useRef(false);
  const [dataMode, setDataMode] = useState<"camera" | "dataset">("camera");
  const [datasetAvailable, setDatasetAvailable] = useState(false);
  const [modeSwitching, setModeSwitching] = useState(false);

  // Fetch current mode on mount
  useEffect(() => {
    let cancelled = false;
    fetch("/api/mode", { cache: "no-store" })
      .then((r) => r.json())
      .then((info) => {
        if (cancelled) return;
        setDataMode(info.mode === "dataset" ? "dataset" : "camera");
        setDatasetAvailable(info.datasetAvailable === true || info.datasetAvailable === "true");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleModeToggle = useCallback(async () => {
    const target = dataMode === "camera" ? "dataset" : "camera";
    setModeSwitching(true);
    try {
      const r = await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: target }),
        cache: "no-store",
      });
      if (!r.ok) {
        const ej = await r.json().catch(() => ({}));
        throw new Error((ej as { message?: string }).message || `HTTP ${r.status}`);
      }
      setDataMode(target);
      setData(null);
      setErr(null);
    } catch (e) {
      setErr(`模式切换失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setModeSwitching(false);
    }
  }, [dataMode]);

  const pull = useCallback(async () => {
    if (pullInFlight.current) return;
    pullInFlight.current = true;
    try {
      const r = await fetch("/api/detections", { cache: "no-store" });
      const j: unknown = await r.json().catch(() => null);
      if (!r.ok) {
        const msg =
          j &&
          typeof j === "object" &&
          j !== null &&
          "message" in j &&
          typeof (j as { message: unknown }).message === "string"
            ? (j as { message: string }).message
            : `HTTP ${r.status}`;
        throw new Error(msg);
      }
      if (j === null || typeof j !== "object") {
        throw new Error("invalid JSON");
      }
      const payload = j as DemoPayload;
      setData(payload);
      if (typeof payload.sampleIntervalMs === "number" && payload.sampleIntervalMs >= 2000) {
        pollMsRef.current = Math.min(60_000, Math.max(3000, payload.sampleIntervalMs + 2000));
      }
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    } finally {
      pullInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loop() {
      while (!cancelled) {
        await pull();
        if (cancelled) break;
        await new Promise<void>((resolve) => setTimeout(resolve, pollMsRef.current));
      }
    }
    void loop();
    return () => {
      cancelled = true;
    };
  }, [pull]);

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
    gap: 8,
  } as const;

  return (
    <main>
      <header style={{ marginBottom: 12 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 20 }}>多路摄像头 + 跨镜 Re-ID（Demo）</h1>
        <p style={{ margin: 0, fontSize: 13, color: "#aaa", maxWidth: 960 }}>
          上行：每路 <code>{`/api/rtsp/<cameraId>`}</code> 实时 MJPEG，不在画面上叠框。下行：与{" "}
          <code>/api/detections</code> 同一次采样的静态 JPEG（<code>/api/detection-preview/&lt;id&gt;</code>
          转发识别服务缓存帧）上绘制框与 ID。未设置 <code>REID_DETECTIONS_URL</code> 时为内置模拟（无实拍识别帧）。
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#666" }}>
          无摄像头时可设环境变量 <code>DISABLE_RTSP_PROXY=1</code> 关闭代理（接口 503）；本地调试勿部署到不支持长连接的
          Serverless。若出现 <code>Cannot find module &apos;./xxx.js&apos;</code>：先停 dev，执行{" "}
          <code>npm run dev:clean</code>，或多路稳定观看用 <code>npm run build && npm start</code>。
        </p>
        <div style={{ marginTop: 8, fontSize: 14 }}>
          场馆内当前人数（本采样各路画面里检出、跨镜 Re-ID 去重）：
          <strong style={{ color: "#8f8", marginLeft: 8 }}>{data?.visibleUniquePersonCount ?? "—"}</strong>
          <span style={{ marginLeft: 16, color: "#aaa" }}>
            Re-ID 画廊累计 id（历史上曾分配过的全局人数，含已离开画面）：
            <strong style={{ color: "#aaf" }}>{data?.galleryUniquePersonCount ?? "—"}</strong>
          </span>
          {data ? (
            <span style={{ color: "#666", marginLeft: 12 }}>
              lastUpdate: {new Date(data.updatedAt).toLocaleTimeString()}
            </span>
          ) : null}
          {data?.clientSource ? (
            <span style={{ color: "#888", marginLeft: 10, fontSize: 12 }}>
              数据源: {data.clientSource === "reid" ? "识别后端" : "内置模拟"}
            </span>
          ) : null}
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#aaa" }}>数据源:</span>
          <button
            type="button"
            disabled={modeSwitching}
            onClick={handleModeToggle}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: modeSwitching ? "not-allowed" : "pointer",
              background: dataMode === "camera" ? "#2563eb" : "#7c3aed",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              opacity: modeSwitching ? 0.6 : 1,
            }}
          >
            {modeSwitching ? "切换中..." : dataMode === "camera" ? "📷 摄像头" : "📊 测试集"}
          </button>
          {datasetAvailable ? (
            <span style={{ fontSize: 11, color: "#6a9" }}>测试集就绪</span>
          ) : (
            <span style={{ fontSize: 11, color: "#c98" }}>
              测试集未准备：运行 <code>python prepare_test_data.py</code>
            </span>
          )}
        </div>
        {err ? <p style={{ color: "#f66" }}>接口错误: {err}</p> : null}
        {data?.stats?.cameras?.length ? (
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "#7a7", fontFamily: "ui-monospace, monospace" }}>
            后端调试 stats：YOLO（IoU 去重前）{" "}
            {data.stats.cameras.reduce((a, c) => a + (c.yoloRawPersons ?? c.yoloPersons), 0)}，去重后{" "}
            {data.stats.cameras.reduce((a, c) => a + c.yoloPersons, 0)}
            {data.stats.cameras.some((c) => c.passedConf !== undefined) ? (
              <>
                ，过置信度 {data.stats.cameras.reduce((a, c) => a + (c.passedConf ?? 0), 0)}，过最小边{" "}
                {data.stats.cameras.reduce((a, c) => a + (c.passedMinSide ?? 0), 0)}，过形状{" "}
                {data.stats.cameras.reduce((a, c) => a + (c.passedShape ?? 0), 0)}
              </>
            ) : null}
            ，Re-ID 框 {data.stats.cameras.reduce((a, c) => a + c.outputBoxes, 0)}
            {data.stats.cameras.some((c) => c.weakOutputBoxes !== undefined) ? (
              <>
                ，低置信展示框{" "}
                {data.stats.cameras.reduce((a, c) => a + (c.weakOutputBoxes ?? 0), 0)}
              </>
            ) : null}
            ，Re-ID 推理失败{" "}
            {data.stats.cameras.reduce((a, c) => a + c.embedFailures, 0)}。若 YOLO 原始人数大于 0 而 Re-ID 框为 0：看每路过置信度/过形是否在某步归零，可调{" "}
            <code>backend/reid_service/.env</code> 中 <code>YOLO_KEEP_MIN_CONF</code>、<code>PERSON_AR_*</code>、
            <code>CROP_MIN_SIDE</code>，或临时 <code>PERSON_USE_SHAPE_FILTER=0</code> 排查。若全路 YOLO 原始=0：多为小人/暗光/花帧，可调低{" "}
            <code>YOLO_CONF</code>、提高 <code>YOLO_IMGSZ</code> 与 <code>YOLO_MAX_SIDE</code>，或 <code>YOLO_MODEL=yolov8s.pt</code>。终端{" "}
            <code>Could not find ref with POC</code> 多为 HEVC 参考帧丢失，与 stats 无关。
          </p>
        ) : data?.clientSource === "reid" ? (
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "#c98" }}>
            未收到后端 <code>stats</code>（前端不显示每路调试行）。请确认识别进程已读{" "}
            <code>backend/reid_service/.env</code> 且含 <code>DETECTIONS_STATS=1</code>（默认已开），并<strong>重启</strong>
            <code> npm run reid:serve</code>；若仍无，检查 Python 返回 JSON 是否含 <code>stats.cameras</code> 数组。
          </p>
        ) : null}
      </header>

      {dataMode === "camera" ? (
        <>
          <h2 style={{ margin: "0 0 8px", fontSize: 15, color: "#ccc" }}>实时预览（无检测框）</h2>
          <section style={{ ...gridStyle, marginBottom: 16 }}>
            {CAMERAS.map((cam, i) => (
              <CameraStreamTile
                key={cam.id}
                cam={cam}
                streamIndex={i}
                debugStat={data?.stats?.cameras?.find((s) => s.cameraId === cam.id)}
              />
            ))}
          </section>
        </>
      ) : (
        <p style={{ margin: "12px 0", fontSize: 13, color: "#888" }}>
          测试集模式：下方显示测试图像及 Re-ID 结果。实时 RTSP 流已隐藏。
        </p>
      )}

      <h2 style={{ margin: "0 0 8px", fontSize: 15, color: "#ccc" }}>
        本采样识别帧（框与 ID 仅画在此行，与上行实时流时刻可能不一致）
      </h2>
      <section style={gridStyle}>
        {dataMode === "dataset" && data
          ? data.frames
              .filter((f) => f.online)
              .map((f) => {
                const cam: CameraDef = {
                  id: f.cameraId,
                  label: f.cameraId.replace("cam_", "虚拟摄像头 "),
                  rtspPath: "",
                  tier: "normal",
                };
                return (
                  <DetectionPreviewTile key={`det-${f.cameraId}`} cam={cam} payload={data} />
                );
              })
          : CAMERAS.map((cam) => (
              <DetectionPreviewTile key={`det-${cam.id}`} cam={cam} payload={data} />
            ))}
      </section>
    </main>
  );
}
