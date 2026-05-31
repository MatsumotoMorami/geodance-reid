"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CameraFrame, DemoPayload, DetectionsDebugCamera } from "@/lib/types";
import type { CameraDef, CameraTier } from "@/lib/cameras";

export type AuthUser = {
  id: string;
  username: string;
  cameras: CameraDef[];
  camerasUpdatedAt: number;
};

const CAMERA_TIERS: Array<{ value: CameraTier; label: string; hint: string }> = [
  { value: "normal", label: "普通", hint: "标准拉流" },
  { value: "low_availability", label: "低可用", hint: "更长超时" },
  { value: "low_resolution", label: "低清", hint: "低清优化" },
];

function tierLabel(tier: CameraTier): string {
  return CAMERA_TIERS.find((t) => t.value === tier)?.label ?? "普通";
}

function slugFromValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^rtsps?:\/\//, "")
    .split("/")
    .pop()
    ?.replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "";
}

function debugSummary(stat?: DetectionsDebugCamera): string | null {
  if (!stat) return null;
  const raw = stat.yoloRawPersons !== undefined ? `原始 ${stat.yoloRawPersons} / NMS ${stat.yoloPersons}` : `YOLO ${stat.yoloPersons}`;
  const passed = stat.passedConf !== undefined
    ? `过检 ${stat.passedConf}/${stat.passedMinSide ?? "?"}/${stat.passedShape ?? "?"}`
    : "";
  const tracks = stat.activeTracks !== undefined ? `轨迹 ${stat.activeTracks}` : "";
  const dormant = stat.dormantTracks !== undefined ? `休眠 ${stat.dormantTracks}` : "";
  return [raw, passed, `框 ${stat.outputBoxes}`, `弱框 ${stat.weakOutputBoxes ?? 0}`, `失败 ${stat.embedFailures}`, tracks, dormant]
    .filter(Boolean)
    .join(" · ");
}

function DetectionOverlays({ frame }: { frame: CameraFrame }) {
  return (
    <>
      {[...frame.detections]
        .sort((a, b) => (a.lowConfidence === b.lowConfidence ? 0 : a.lowConfidence ? -1 : 1))
        .map((d, idx) => {
          const { x, y, w, h } = d.box;
          const weak = Boolean(d.lowConfidence);
          const confStr = d.confidence !== undefined ? ` ${(d.confidence * 100).toFixed(0)}%` : "";
          return (
            <div
              className={`reid-box ${weak ? "is-weak" : "is-strong"}`}
              key={`${frame.cameraId}-${d.globalPersonId}-${weak ? "w" : "s"}-${idx}`}
              style={{
                left: `${x * 100}%`,
                top: `${y * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
              }}
            >
              <span>{weak ? `低置信${confStr}` : `ID ${d.globalPersonId}`}</span>
            </div>
          );
        })}
    </>
  );
}

function LoginPanel({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setErr(null);
    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { message?: string }).message || `HTTP ${r.status}`);
      onAuthed((j as { user: AuthUser }).user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card card">
        <div className="brand-stack">
          <div className="brand-mark">Gd</div>
          <p className="eyebrow">GeoDance Re-ID</p>
          <h1>欢迎回来</h1>
        </div>

        <div className="form-stack">
          <label>
            <span>用户名</span>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="admin"
            />
          </label>
          <label>
            <span>密码</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="至少 8 位"
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </label>
          <button className="btn btn-primary" type="button" disabled={loading} onClick={() => void submit()}>
            {loading ? "登录中..." : "登录"}
          </button>
          {err ? <div className="alert alert-error">{err}</div> : null}
        </div>
      </section>
    </main>
  );
}

function CameraAdminPanel({
  user,
  cameras,
  onUserChanged,
}: {
  user: AuthUser;
  cameras: CameraDef[];
  onUserChanged: (user: AuthUser) => void;
}) {
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [rtspPath, setRtspPath] = useState("");
  const [tier, setTier] = useState<CameraTier>("normal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addCamera = async () => {
    setErr(null);
    setBusy(true);
    try {
      const finalId = id.trim() || slugFromValue(label || rtspPath);
      const r = await fetch("/api/cameras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: finalId, label: label.trim() || finalId, rtspPath, tier }),
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { message?: string }).message || `HTTP ${r.status}`);
      onUserChanged((j as { user: AuthUser }).user);
      setId("");
      setLabel("");
      setRtspPath("");
      setTier("normal");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteCamera = async (cameraId: string) => {
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}`, {
        method: "DELETE",
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { message?: string }).message || `HTTP ${r.status}`);
      onUserChanged((j as { user: AuthUser }).user);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card control-card">
      <div className="section-head">
        <div>
          <p className="eyebrow">Camera Admin</p>
          <h2>我的摄像头</h2>
        </div>
        <span className="badge badge-info">{user.username} · {cameras.length} 路</span>
      </div>

      <div className="camera-form">
        <input className="input" placeholder="ID，如 room" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="input" placeholder="名称" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input input-wide" placeholder="rtsp://..." value={rtspPath} onChange={(e) => setRtspPath(e.target.value)} />
        <select className="input" value={tier} onChange={(e) => setTier(e.target.value as CameraTier)}>
          {CAMERA_TIERS.map((t) => (
            <option key={t.value} value={t.value}>{t.label} · {t.hint}</option>
          ))}
        </select>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void addCamera()}>
          添加
        </button>
      </div>

      {err ? <div className="alert alert-error compact">{err}</div> : null}

      <div className="camera-list">
        {cameras.map((cam) => (
          <div className="camera-row" key={cam.id}>
            <div className="camera-main">
              <strong>{cam.label}</strong>
              <span>{cam.id} · {tierLabel(cam.tier)}</span>
            </div>
            <code>{cam.rtspPath}</code>
            <button className="btn btn-danger" type="button" disabled={busy} onClick={() => void deleteCamera(cam.id)}>
              删除
            </button>
          </div>
        ))}
        {cameras.length === 0 ? <div className="empty-line">当前用户还没有摄像头。</div> : null}
      </div>
    </section>
  );
}

function CameraStreamTile({
  cam,
  streamIndex,
  debugStat,
}: {
  cam: CameraDef;
  streamIndex: number;
  debugStat?: DetectionsDebugCamera;
}) {
  const [streamKey, setStreamKey] = useState(0);
  const [streamError, setStreamError] = useState(false);
  const [streamReady, setStreamReady] = useState(() => process.env.NODE_ENV !== "development");

  const staggerMs = process.env.NODE_ENV === "development" ? streamIndex * 220 : 0;
  const debug = debugSummary(debugStat);

  useEffect(() => {
    if (staggerMs === 0) {
      setStreamReady(true);
      return;
    }
    const t = setTimeout(() => setStreamReady(true), staggerMs);
    return () => clearTimeout(t);
  }, [staggerMs]);

  return (
    <article className="media-card">
      <div className="tile-head">
        <div>
          <h3>{cam.label}</h3>
          <code>{cam.rtspPath}</code>
        </div>
        <span className={`badge ${cam.tier === "normal" ? "badge-info" : "badge-warning"}`}>{tierLabel(cam.tier)}</span>
      </div>

      <div className="video-frame">
        {streamReady ? (
          <img
            src={`/api/rtsp/${cam.id}?r=${streamKey}`}
            alt=""
            loading="eager"
            decoding="async"
            onLoad={() => setStreamError(false)}
            onError={() => setStreamError(true)}
            className={cam.tier === "low_resolution" ? "low-res-stream" : undefined}
          />
        ) : (
          <div className="media-placeholder">
            {process.env.NODE_ENV === "development" ? "拉流排队中..." : "准备拉流..."}
          </div>
        )}

        {streamError ? (
          <div className="media-error">
            <p>RTSP 拉流失败</p>
            <span>检查网络、ffmpeg 和 RTSP 可达性</span>
            <button
              className="btn btn-secondary compact"
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

      {debug ? <div className="debug-line">{debug}</div> : null}
    </article>
  );
}

function DetectionPreviewTile({ cam, payload }: { cam: CameraDef; payload: DemoPayload | null }) {
  const frame = payload?.frames.find((f) => f.cameraId === cam.id);
  const isMock = payload?.clientSource === "mock";
  const bust = payload?.updatedAt ?? 0;
  const [imgErr, setImgErr] = useState(false);

  useEffect(() => {
    setImgErr(false);
  }, [bust, cam.id]);

  return (
    <article className="media-card preview-card">
      <div className="tile-head compact-head">
        <h3>识别帧 · {cam.label}</h3>
        <span className="badge badge-plain">{frame?.detections.length ?? 0} 框</span>
      </div>
      <div className="video-frame">
        {isMock ? (
          <div className="media-placeholder">内置模拟无实拍识别帧</div>
        ) : imgErr ? (
          <div className="media-placeholder warn">无识别帧缓存</div>
        ) : (
          <img
            src={`/api/detection-preview/${encodeURIComponent(cam.id)}?v=${bust}`}
            alt=""
            onError={() => setImgErr(true)}
          />
        )}
        {!isMock && !imgErr && frame && frame.detections.length > 0 ? <DetectionOverlays frame={frame} /> : null}
      </div>
    </article>
  );
}

function StatCard({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "primary" | "muted" }) {
  return (
    <div className={`stat-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function useAuthUser() {
  const [authLoading, setAuthLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) return null;
        return (await r.json()) as { user: AuthUser };
      })
      .then((body) => {
        if (!cancelled) setUser(body?.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", cache: "no-store" }).catch(() => {});
    setUser(null);
  }, []);

  return { authLoading, user, setUser, logout };
}

export function SettingsPage() {
  const { authLoading, user, setUser, logout } = useAuthUser();

  const handleUserChanged = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
  }, [setUser]);

  if (authLoading) {
    return <main className="loading-shell">正在检查登录状态...</main>;
  }

  if (!user) {
    return <LoginPanel onAuthed={handleUserChanged} />;
  }

  return (
    <main className="app-shell noise-overlay">
      <nav className="top-nav card">
        <div className="top-brand">
          <div className="brand-mark small">Gd</div>
          <div>
            <p className="eyebrow">GeoDance Re-ID</p>
            <strong>Camera Admin</strong>
          </div>
        </div>
        <div className="top-actions">
          <Link className="btn btn-secondary compact" href="/">
            主页
          </Link>
          <span className="badge badge-plain">{user.username}</span>
          <button className="btn btn-secondary compact" type="button" onClick={() => void logout()}>
            退出
          </button>
        </div>
      </nav>

      <header className="hero-card card settings-hero">
        <div className="hero-copy">
          <p className="eyebrow">Settings</p>
          <h1>Camera Admin</h1>
          <p>添加、删除当前用户的 RTSP 摄像头。这里的列表会同步用于首页实时预览、后端识别和采样帧缓存。</p>
        </div>
        <div className="hero-stats">
          <StatCard label="当前用户" value={user.username} tone="muted" />
          <StatCard label="摄像头" value={user.cameras.length} tone="primary" />
        </div>
      </header>

      <CameraAdminPanel user={user} cameras={user.cameras} onUserChanged={handleUserChanged} />
    </main>
  );
}

export default function Dashboard() {
  const { authLoading, user, setUser, logout } = useAuthUser();
  const cameras = user?.cameras ?? [];
  const [data, setData] = useState<DemoPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pollMsRef = useRef(8000);
  const pullInFlight = useRef(false);
  const [dataMode, setDataMode] = useState<"camera" | "dataset">("camera");
  const [datasetAvailable, setDatasetAvailable] = useState(false);
  const [modeSwitching, setModeSwitching] = useState(false);

  const statsTotal = useMemo(() => {
    const rows = data?.stats?.cameras ?? [];
    return {
      raw: rows.reduce((a, c) => a + (c.yoloRawPersons ?? c.yoloPersons), 0),
      output: rows.reduce((a, c) => a + c.outputBoxes, 0),
      weak: rows.reduce((a, c) => a + (c.weakOutputBoxes ?? 0), 0),
      failed: rows.reduce((a, c) => a + c.embedFailures, 0),
    };
  }, [data?.stats?.cameras]);

  const handleUserChanged = useCallback((nextUser: AuthUser) => {
    setUser(nextUser);
    setData(null);
    setErr(null);
  }, [setUser]);

  const handleLogout = useCallback(async () => {
    await logout();
    setData(null);
    setErr(null);
  }, [logout]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetch("/api/mode", { cache: "no-store" })
      .then((r) => r.json())
      .then((info) => {
        if (cancelled) return;
        setDataMode(info.mode === "dataset" ? "dataset" : "camera");
        setDatasetAvailable(info.datasetAvailable === true || info.datasetAvailable === "true");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

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
    if (!user || pullInFlight.current) return;
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
        if (r.status === 401) {
          setUser(null);
          throw new Error("登录已失效，请重新登录");
        }
        throw new Error(msg);
      }
      if (j === null || typeof j !== "object") throw new Error("invalid JSON");
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
  }, [user]);

  useEffect(() => {
    if (!user) return;
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
  }, [pull, user]);

  if (authLoading) {
    return <main className="loading-shell">正在检查登录状态...</main>;
  }

  if (!user) {
    return <LoginPanel onAuthed={handleUserChanged} />;
  }

  return (
    <main className="app-shell noise-overlay">
      <nav className="top-nav card">
        <div className="top-brand">
          <div className="brand-mark small">Gd</div>
          <div>
            <p className="eyebrow">GeoDance Re-ID</p>
            <strong>跨镜摄像头控制台</strong>
          </div>
        </div>
        <div className="top-actions">
          <Link className="btn btn-secondary compact" href="/settings">
            Camera Admin
          </Link>
          <button
            className="btn btn-primary compact"
            type="button"
            disabled={modeSwitching}
            onClick={handleModeToggle}
            title={datasetAvailable ? "切换数据源" : "测试集未准备"}
          >
            {modeSwitching ? "切换中..." : dataMode === "camera" ? "Data Mode: 摄像头" : "Data Mode: 测试集"}
          </button>
          <span className="badge badge-plain">{user.username}</span>
          <button className="btn btn-secondary compact" type="button" onClick={() => void handleLogout()}>
            退出
          </button>
        </div>
      </nav>

      <header className="hero-card card">
        <div className="hero-copy">
          <p className="eyebrow">Realtime Vision</p>
          <h1>
            多路摄像头 + <span>跨镜 Re-ID</span>
          </h1>
          <p>
            实时 MJPEG 用于监看，后端按采样周期抓帧做 YOLO 与 Re-ID。当前用户的摄像头列表会独立参与拉流、识别和预览缓存。
          </p>
        </div>
        <div className="hero-stats">
          <StatCard label="当前人数" value={data?.visibleUniquePersonCount ?? "—"} tone="primary" />
          <StatCard label="画廊累计" value={data?.galleryUniquePersonCount ?? "—"} />
          <StatCard label="摄像头" value={cameras.length} tone="muted" />
          <StatCard label="数据源" value={data?.clientSource === "reid" ? "识别后端" : data?.clientSource === "mock" ? "模拟" : "—"} />
        </div>
      </header>

      {err ? <div className="alert alert-error">{err}</div> : null}

      {data?.stats?.cameras?.length ? (
        <section className="card stats-card">
          <div className="section-head inline-head">
            <div>
              <p className="eyebrow">Backend Stats</p>
              <h2>后端识别状态</h2>
            </div>
            <span className="badge badge-plain">{data ? new Date(data.updatedAt).toLocaleTimeString() : "等待数据"}</span>
          </div>
          <div className="stats-grid">
              <StatCard label="YOLO 原始" value={statsTotal.raw} />
              <StatCard label="Re-ID 框" value={statsTotal.output} tone="primary" />
              <StatCard label="低置信框" value={statsTotal.weak} />
              <StatCard label="推理失败" value={statsTotal.failed} tone="muted" />
            </div>
          <p className="muted tiny">
            如果 YOLO 原始人数大于 0 而 Re-ID 框为 0，可调 `YOLO_KEEP_MIN_CONF`、`PERSON_AR_*`、`CROP_MIN_SIDE` 或临时关闭形状过滤排查。
          </p>
        </section>
      ) : data?.clientSource === "reid" ? (
        <div className="alert alert-warning">
          未收到后端 stats。确认 `backend/reid_service/.env` 中 `DETECTIONS_STATS=1`，并重启 `npm run reid:serve`。
        </div>
      ) : null}

      <section className="panel-section top-section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Detection Preview</p>
            <h2>本采样识别帧</h2>
          </div>
          <span className="badge badge-plain">框与 ID 仅画在采样帧上</span>
        </div>
        <div className="media-grid">
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
                  return <DetectionPreviewTile key={`det-${f.cameraId}`} cam={cam} payload={data} />;
                })
            : cameras.map((cam) => <DetectionPreviewTile key={`det-${cam.id}`} cam={cam} payload={data} />)}
          {dataMode !== "dataset" && cameras.length === 0 ? <div className="empty-line">没有可显示的识别帧。</div> : null}
        </div>
      </section>

      {dataMode === "camera" ? (
        <section className="panel-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Live Streams</p>
              <h2>实时预览</h2>
            </div>
            <span className="badge badge-plain">无检测框</span>
          </div>
          <div className="media-grid">
            {cameras.map((cam, i) => (
              <CameraStreamTile
                key={cam.id}
                cam={cam}
                streamIndex={i}
                debugStat={data?.stats?.cameras?.find((s) => s.cameraId === cam.id)}
              />
            ))}
            {cameras.length === 0 ? <div className="empty-line">先到 Camera Admin 添加 RTSP 地址。</div> : null}
          </div>
        </section>
      ) : (
        <div className="alert alert-info">测试集模式：实时 RTSP 流已隐藏，下方只显示测试图像及 Re-ID 结果。</div>
      )}
    </main>
  );
}
