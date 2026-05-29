import * as net from "net";

/**
 * 对 RTSP URL 发 DESCRIBE，返回首行状态码（如 200、404），失败返回 null。
 * 与 Python backend/reid_service/capture.py 行为一致。
 */
export async function rtspDescribeStatusCode(
  rtspUrl: string,
  timeoutMs = 2500,
): Promise<number | null> {
  if (process.env.SKIP_RTSP_DESCRIBE_PROBE === "1") return null;
  if (!rtspUrl.toLowerCase().startsWith("rtsp://")) return null;

  let u: URL;
  try {
    u = new URL(rtspUrl);
  } catch {
    return null;
  }
  const host = u.hostname;
  const port = u.port ? Number.parseInt(u.port, 10) : 554;
  if (!host) return null;

  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (v: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(v);
    };

    const timer = setTimeout(() => done(null), timeoutMs);
    let buf = "";

    sock.setTimeout(timeoutMs);
    sock.once("connect", () => {
      const req = `DESCRIBE ${rtspUrl} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: geodance-next-rtsp-probe/1.0\r\n\r\n`;
      sock.write(req, "ascii");
    });
    sock.on("data", (chunk) => {
      buf += chunk.toString("ascii");
      const idx = buf.indexOf("\r\n");
      if (idx >= 0) {
        const first = buf.slice(0, idx);
        const m = /^RTSP\/\d\.\d\s+(\d{3})\b/i.exec(first);
        done(m ? Number.parseInt(m[1], 10) : null);
      }
    });
    sock.once("error", () => done(null));
    sock.once("timeout", () => done(null));

    sock.connect(port, host);
  });
}
