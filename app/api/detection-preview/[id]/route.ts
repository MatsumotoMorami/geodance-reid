import { NextResponse } from "next/server";
import { getReidPreviewUpstreamUrl } from "@/lib/reidBackend";

export const dynamic = "force-dynamic";

function previewFetchTimeoutMs(): number {
  const raw = process.env.REID_PREVIEW_FETCH_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 3000) return Math.min(n, 120_000);
  return 15_000;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id || id.includes("..") || id.includes("/")) {
    return NextResponse.json({ error: "INVALID_ID" }, { status: 400 });
  }
  const upstream = getReidPreviewUpstreamUrl(id);
  if (!upstream) {
    return NextResponse.json(
      { error: "NO_REID_BACKEND", message: "未设置 REID_DETECTIONS_URL（模拟模式无识别帧）" },
      { status: 404 },
    );
  }
  const ms = previewFetchTimeoutMs();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(upstream, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!r.ok) {
      return new NextResponse(null, { status: r.status === 404 ? 404 : 502 });
    }
    const buf = await r.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return new NextResponse(null, { status: 504 });
  } finally {
    clearTimeout(t);
  }
}
