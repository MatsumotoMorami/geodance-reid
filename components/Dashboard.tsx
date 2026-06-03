"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CameraFrame, DemoPayload, DetectionsDebugCamera } from "@/lib/types";
import type { CameraDef, CameraTier } from "@/lib/cameras";

export type AuthUser = {
  id: string;
  username: string;
  cameras: CameraDef[];
  camerasUpdatedAt: number;
};

const CAMERA_TIERS: Array<{ value: CameraTier; label: string }> = [
  { value: "normal", label: "普通" },
  { value: "low_availability", label: "低可用" },
  { value: "low_resolution", label: "低清" },
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
      if (!r.ok) throw new Error("登录失败");
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
    } catch {
      setErr("添加失败");
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
    } catch {
      setErr("删除失败");
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
        <input className="input" placeholder="ID" value={id} onChange={(e) => setId(e.target.value)} />
        <input className="input" placeholder="名称" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input input-wide" placeholder="RTSP" value={rtspPath} onChange={(e) => setRtspPath(e.target.value)} />
        <select className="input" value={tier} onChange={(e) => setTier(e.target.value as CameraTier)}>
          {CAMERA_TIERS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
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
            Loading
          </div>
        )}

        {streamError ? (
          <div className="media-error">
            <p>RTSP</p>
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
          <div className="media-placeholder">N/A</div>
        ) : imgErr ? (
          <div className="media-placeholder warn">N/A</div>
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

function StatCard({
  label,
  value,
  tone = "default",
  compactValue = false,
}: {
  label: string;
  value: string | number;
  tone?: "default" | "primary" | "muted";
  compactValue?: boolean;
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <p>{label}</p>
      <strong className={compactValue ? "compact-value" : undefined}>{value}</strong>
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
    return <main className="loading-shell">Loading</main>;
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
        </div>
        <div className="hero-stats">
          <StatCard label="当前用户" value={user.username} tone="muted" compactValue />
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
  const [datasetAvailable, setDatasetAvailable] = useState(false);
  const pollMsRef = useRef(8000);
  const pullInFlight = useRef(false);
  const [dataMode, setDataMode] = useState<"camera" | "dataset">("camera");
  const [modeSwitching, setModeSwitching] = useState(false);

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
        setDatasetAvailable(Boolean(info.datasetAvailable));
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
        const msg =
          typeof (ej as { message?: unknown }).message === "string" ? (ej as { message: string }).message : `HTTP ${r.status}`;
        throw new Error(msg || `HTTP ${r.status}`);
      }
      setDataMode(target);
      if (target === "dataset") {
        setDatasetAvailable(true);
      }
      setData(null);
      setErr(null);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "切换失败");
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
        if (r.status === 401) {
          setUser(null);
          throw new Error("登录失效");
        }
        throw new Error(`HTTP ${r.status}`);
      }
      if (j === null || typeof j !== "object") throw new Error("invalid JSON");
      const payload = j as DemoPayload;
      setData(payload);
      if (typeof payload.sampleIntervalMs === "number" && payload.sampleIntervalMs >= 2000) {
        pollMsRef.current = Math.min(60_000, Math.max(3000, payload.sampleIntervalMs + 2000));
      }
      setErr(null);
    } catch {
      setErr("获取失败");
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
    return <main className="loading-shell">Loading</main>;
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
            disabled={modeSwitching || (dataMode === "camera" && !datasetAvailable)}
            onClick={handleModeToggle}
          >
            {modeSwitching ? "..." : dataMode === "camera" ? "摄像头" : "测试集"}
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
        </div>
        <div className="hero-stats">
          <StatCard label="当前人数" value={data?.visibleUniquePersonCount ?? "—"} tone="primary" />
          <StatCard label="画廊累计" value={data?.galleryUniquePersonCount ?? "—"} />
          <StatCard label="摄像头" value={cameras.length} tone="muted" />
          <StatCard label="数据源" value={data?.clientSource === "reid" ? "识别后端" : data?.clientSource === "mock" ? "模拟" : "—"} />
        </div>
      </header>

      {dataMode === "camera" && !datasetAvailable ? (
        <div className="alert alert-warning">测试集模式尚未可用：请先在 reid 服务生成 backend/reid_service/test_data，或在该目录挂载数据。</div>
      ) : null}

      {err ? <div className="alert alert-error">{err}</div> : null}

      <section className="panel-section top-section">
        <div className="section-head">
          <div>
            <p className="eyebrow">Detection Preview</p>
            <h2>本采样识别帧</h2>
          </div>
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
        </div>
      </section>

      {dataMode === "camera" ? (
        <section className="panel-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Live Streams</p>
              <h2>实时预览</h2>
            </div>
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
          </div>
        </section>
      ) : null}
    </main>
  );
}
