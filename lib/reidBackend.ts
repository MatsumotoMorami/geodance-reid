import type { CameraFrame, DemoPayload, Detection, NormBox } from "./types";
import { CAMERAS, type CameraDef } from "./cameras";

export type ReidBackendCameraRequest = {
  namespace: string;
  idPrefix: string;
  cameras: Array<{ id: string; url: string }>;
};

/**
 * 识别后端 → 前端 的 JSON 约定（GET 返回体）。
 *
 * 推荐与前端完全一致（camelCase）：
 * {
 *   "updatedAt": number,
 *   "sampleIntervalMs": number,
 *   "galleryUniquePersonCount": number,  // Re-ID 画廊已分配过的全局 id 数（历史累计）
 *   "visibleUniquePersonCount": number, // 本采样各路在线画面中检出、跨镜去重后的当前在场人数
 *   "frames": [{
 *     "cameraId": string,
 *     "online": boolean,
 *     "detections": [{ "globalPersonId": number, "box": { "x","y","w","h" } 归一化 0~1 }]
 *   }]
 * }
 *
 * 亦支持 snake_case 同义字段（见 normalize 实现）。
 *
 * 环境变量（仅服务端）：`REID_DETECTIONS_URL` 设为完整 GET 地址，例如
 * `http://127.0.0.1:8787/detections`（占位）或 `http://127.0.0.1:8890/detections`（本仓库 backend/reid_service + fast-reid）。
 * 识别帧 JPEG：`GET /api/detection-preview/<cameraId>` 会转发到同源的 `.../preview/<cameraId>`（Python 在每次 /detections 采样后写入缓存）。
 *
 * 转发超时由环境变量 `REID_BACKEND_FETCH_MS` 控制（默认 180000ms）。九路 RTSP+推理很慢，勿沿用短超时。
 */

function backendFetchTimeoutMs(): number {
  const raw = process.env.REID_BACKEND_FETCH_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 5000) return Math.min(n, 600_000);
  return 180_000;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function pickNum(r: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const n = num(r[k]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function normBoxFrom(r: Record<string, unknown>): NormBox | null {
  const x = pickNum(r, "x", "X");
  const y = pickNum(r, "y", "Y");
  const w = pickNum(r, "w", "width", "W");
  const h = pickNum(r, "h", "height", "H");
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function detectionFrom(r: Record<string, unknown>): Detection | null {
  const gid =
    pickNum(r, "globalPersonId", "global_person_id", "personId", "person_id", "reid_id", "gallery_id") ?? undefined;
  if (gid === undefined) return null;
  const boxRaw = r.box ?? r.bbox ?? r.rect;
  if (!isRecord(boxRaw)) return null;
  const box = normBoxFrom(boxRaw);
  if (!box) return null;
  const conf = pickNum(r, "confidence", "conf", "score");
  const lowRaw = r.lowConfidence ?? r.low_confidence;
  const lowConfidence =
    lowRaw === true || lowRaw === 1 || (typeof lowRaw === "string" && lowRaw.toLowerCase() === "true");
  return {
    globalPersonId: Math.trunc(gid),
    box,
    ...(conf !== undefined ? { confidence: conf } : {}),
    ...(lowConfidence ? { lowConfidence: true } : {}),
  };
}

function frameFrom(r: Record<string, unknown>): CameraFrame | null {
  const cameraId = r.cameraId ?? r.camera_id;
  if (typeof cameraId !== "string" || !cameraId) return null;
  const online = typeof r.online === "boolean" ? r.online : true;
  const rawDets = r.detections;
  if (!Array.isArray(rawDets)) return { cameraId, online, detections: [] };
  const detections: Detection[] = [];
  for (const d of rawDets) {
    if (!isRecord(d)) continue;
    const det = detectionFrom(d);
    if (det) detections.push(det);
  }
  return { cameraId, online, detections };
}

function computeCounts(frames: CameraFrame[]): { gallery: number; visible: number } {
  const visibleIds = new Set<number>();
  for (const f of frames) {
    if (!f.online) continue;
    for (const d of f.detections) {
      if (d.globalPersonId > 0) visibleIds.add(d.globalPersonId);
    }
  }
  return { gallery: visibleIds.size, visible: visibleIds.size };
}

function optionalStats(raw: Record<string, unknown>): DemoPayload["stats"] | undefined {
  const s = raw.stats;
  if (!isRecord(s)) return undefined;
  const cams = s.cameras ?? s.camera_list ?? s.cameras_list;
  if (!Array.isArray(cams)) return undefined;
  const cameras: NonNullable<DemoPayload["stats"]>["cameras"] = [];
  for (const row of cams) {
    if (!isRecord(row)) continue;
    const cameraId = row.cameraId ?? row.camera_id;
    if (typeof cameraId !== "string" || !cameraId) continue;
    const passedConf = pickNum(row, "passedConf", "passed_conf");
    const passedMinSide = pickNum(row, "passedMinSide", "passed_min_side");
    const passedShape = pickNum(row, "passedShape", "passed_shape");
    const yoloRaw = pickNum(row, "yoloRawPersons", "yolo_raw_persons");
    cameras.push({
      cameraId,
      online: typeof row.online === "boolean" ? row.online : true,
      yoloPersons: Math.max(0, Math.trunc(pickNum(row, "yoloPersons", "yolo_persons") ?? 0)),
      ...(yoloRaw !== undefined ? { yoloRawPersons: Math.max(0, Math.trunc(yoloRaw)) } : {}),
      outputBoxes: Math.max(0, Math.trunc(pickNum(row, "outputBoxes", "output_boxes") ?? 0)),
      embedFailures: Math.max(0, Math.trunc(pickNum(row, "embedFailures", "embed_failures") ?? 0)),
      ...(pickNum(row, "weakOutputBoxes", "weak_output_boxes") !== undefined
        ? { weakOutputBoxes: Math.max(0, Math.trunc(pickNum(row, "weakOutputBoxes", "weak_output_boxes")!)) }
        : {}),
      ...(pickNum(row, "activeTracks", "active_tracks") !== undefined
        ? { activeTracks: Math.max(0, Math.trunc(pickNum(row, "activeTracks", "active_tracks")!)) }
        : {}),
      ...(pickNum(row, "dormantTracks", "dormant_tracks") !== undefined
        ? { dormantTracks: Math.max(0, Math.trunc(pickNum(row, "dormantTracks", "dormant_tracks")!)) }
        : {}),
      ...(passedConf !== undefined ? { passedConf: Math.max(0, Math.trunc(passedConf)) } : {}),
      ...(passedMinSide !== undefined ? { passedMinSide: Math.max(0, Math.trunc(passedMinSide)) } : {}),
      ...(passedShape !== undefined ? { passedShape: Math.max(0, Math.trunc(passedShape)) } : {}),
    });
  }
  return cameras.length > 0 ? { cameras } : undefined;
}

/** 将后端任意 JSON 规范化为前端使用的 DemoPayload */
export function normalizeDetectionsPayload(raw: unknown): DemoPayload {
  if (!isRecord(raw)) {
    throw new Error("backend JSON must be an object");
  }

  const framesRaw = raw.frames ?? raw.cameras;
  if (!Array.isArray(framesRaw)) {
    throw new Error("backend JSON must include frames: CameraFrame[]");
  }

  const frames: CameraFrame[] = [];
  for (const fr of framesRaw) {
    if (!isRecord(fr)) continue;
    const f = frameFrom(fr);
    if (f) frames.push(f);
  }

  const updatedAt = pickNum(raw, "updatedAt", "updated_at") ?? Date.now();
  const sampleIntervalMs = pickNum(raw, "sampleIntervalMs", "sample_interval_ms") ?? 3000;

  const computed = computeCounts(frames);
  const galleryRaw = pickNum(raw, "galleryUniquePersonCount", "gallery_unique_person_count");
  const visibleRaw = pickNum(raw, "visibleUniquePersonCount", "visible_unique_person_count");

  const visible = visibleRaw !== undefined ? Math.max(0, Math.trunc(visibleRaw)) : computed.visible;
  const gallery =
    galleryRaw !== undefined ? Math.max(0, Math.trunc(galleryRaw)) : Math.max(computed.gallery, visible);

  const stats = optionalStats(raw);
  return {
    updatedAt: Math.trunc(updatedAt),
    sampleIntervalMs: Math.trunc(sampleIntervalMs),
    galleryUniquePersonCount: gallery,
    visibleUniquePersonCount: visible,
    frames,
    ...(stats ? { stats } : {}),
  };
}

function stripCameraIdPrefix(body: DemoPayload, prefix: string): DemoPayload {
  if (!prefix) return body;
  const strip = (cameraId: string) => (cameraId.startsWith(prefix) ? cameraId.slice(prefix.length) : cameraId);
  return {
    ...body,
    frames: body.frames.map((f) => ({ ...f, cameraId: strip(f.cameraId) })),
    ...(body.stats
      ? { stats: { cameras: body.stats.cameras.map((c) => ({ ...c, cameraId: strip(c.cameraId) })) } }
      : {}),
  };
}

/** 补全当前用户摄像头列表中缺失的路（保留 payload 中原有的未知摄像头） */
export function ensureAllCameras(body: DemoPayload, cameras: CameraDef[] = CAMERAS): DemoPayload {
  const existing = new Map(body.frames.map((f) => [f.cameraId, f]));
  const merged: CameraFrame[] = [];
  // First, emit all payload frames (includes test cameras like cam_0, etc.)
  for (const f of body.frames) {
    merged.push(f);
  }
  // Then, add any missing configured cameras
  for (const c of cameras) {
    if (!existing.has(c.id)) {
      merged.push({ cameraId: c.id, online: false, detections: [] });
    }
  }
  return { ...body, frames: merged };
}

export async function fetchDetectionsFromBackend(
  url: string,
  cameras: CameraDef[] = CAMERAS,
  backendCameras?: ReidBackendCameraRequest,
): Promise<DemoPayload> {
  const ms = backendFetchTimeoutMs();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const method = backendCameras ? "POST" : "GET";
    const r = await fetch(url, {
      method,
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        ...(backendCameras ? { "Content-Type": "application/json" } : {}),
      },
      ...(backendCameras
        ? { body: JSON.stringify({ namespace: backendCameras.namespace, cameras: backendCameras.cameras }) }
        : {}),
    });
    const text = await r.text();
    if (!r.ok) {
      throw new Error(`backend HTTP ${r.status}: ${text.slice(0, 200)}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new Error("backend response is not JSON");
    }
    let payload = normalizeDetectionsPayload(json);
    if (backendCameras) {
      payload = stripCameraIdPrefix(payload, backendCameras.idPrefix);
    }
    return ensureAllCameras(payload, cameras);
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && (e.name === "AbortError" || e.message.includes("aborted")));
    if (aborted) {
      throw new Error(
        `识别后端请求超时（>${ms}ms，可用环境变量 REID_BACKEND_FETCH_MS 调大）。九路 RTSP+YOLO+Re-ID 通常远超过 8 秒。`,
      );
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export function getReidDetectionsUrl(): string | undefined {
  const u = process.env.REID_DETECTIONS_URL?.trim();
  return u || undefined;
}

function getReidBaseUrl(): string | undefined {
  const d = getReidDetectionsUrl();
  if (!d) return undefined;
  try {
    const u = new URL(d);
    u.pathname = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export async function fetchReidMode(): Promise<{ mode: string; datasetAvailable: boolean }> {
  const base = getReidBaseUrl();
  if (!base) return { mode: "camera", datasetAvailable: false };
  const r = await fetch(`${base}/mode`, { cache: "no-store" });
  if (!r.ok) return { mode: "camera", datasetAvailable: false };
  return r.json() as Promise<{ mode: string; datasetAvailable: boolean }>;
}

export async function setReidMode(mode: "camera" | "dataset"): Promise<{ mode: string }> {
  const base = getReidBaseUrl();
  if (!base) throw new Error("ReID backend URL not configured");
  const r = await fetch(`${base}/mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
    cache: "no-store",
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ message: `HTTP ${r.status}` }));
    throw new Error((err as { message?: string }).message || `HTTP ${r.status}`);
  }
  return r.json() as Promise<{ mode: string }>;
}

/** 识别后端最近一次采样时该路的 JPEG（/preview/<cameraId>），仅服务端可用。 */
export function getReidPreviewUpstreamUrl(cameraId: string, upstreamCameraId = cameraId): string | undefined {
  const d = getReidDetectionsUrl();
  if (!d) return undefined;
  try {
    const u = new URL(d);
    u.pathname = `/preview/${encodeURIComponent(upstreamCameraId)}`;
    u.search = "";
    return u.toString();
  } catch {
    return undefined;
  }
}
