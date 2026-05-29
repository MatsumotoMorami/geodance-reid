import { NextResponse } from "next/server";
import { buildDemoPayload } from "@/lib/mockDetections";
import { fetchDetectionsFromBackend, getReidDetectionsUrl } from "@/lib/reidBackend";

export const dynamic = "force-dynamic";

let serverTick = 0;

export async function GET() {
  const backendUrl = getReidDetectionsUrl();
  if (backendUrl) {
    try {
      const body = await fetchDetectionsFromBackend(backendUrl);
      if (process.env.REID_LOG_DETECTIONS === "1") {
        const n = body.frames.reduce((a, f) => a + f.detections.length, 0);
        // eslint-disable-next-line no-console
        console.log("[api/detections]", { boxes: n, visible: body.visibleUniquePersonCount, hasStats: !!body.stats });
      }
      return NextResponse.json({ ...body, clientSource: "reid" as const });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json(
        { error: "REID_BACKEND_FAILED", message: msg },
        { status: 502 },
      );
    }
  }

  serverTick += 1;
  const body = buildDemoPayload(serverTick);
  return NextResponse.json({ ...body, clientSource: "mock" as const });
}
