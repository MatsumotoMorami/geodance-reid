import { NextResponse } from "next/server";
import { isAuthResponse, requireUser } from "@/lib/apiAuth";
import { fetchReidMode, setReidMode } from "@/lib/reidBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isReidModeError(value: unknown): value is Error & { status: number } {
  return (
    value instanceof Error &&
    typeof (value as { status?: unknown }).status === "number" &&
    Number.isFinite((value as { status?: number }).status as number)
  );
}

export async function GET(req: Request) {
  const user = requireUser(req);
  if (isAuthResponse(user)) return user;

  try {
    const info = await fetchReidMode();
    return NextResponse.json(info);
  } catch (e) {
    if (isReidModeError(e)) {
      return NextResponse.json({ error: "MODE_FETCH_FAILED", message: e.message }, { status: e.status || 502 });
    }
    return NextResponse.json({ error: "MODE_FETCH_FAILED" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const user = requireUser(req);
  if (isAuthResponse(user)) return user;

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode;
    if (mode !== "camera" && mode !== "dataset") {
      return NextResponse.json({ error: "INVALID_MODE" }, { status: 400 });
    }
    const result = await setReidMode(mode);
    return NextResponse.json(result);
  } catch (e) {
    if (isReidModeError(e)) {
      return NextResponse.json(
        { error: "MODE_SWITCH_FAILED", message: e.message },
        { status: e.status || 502 },
      );
    }
    return NextResponse.json({ error: "MODE_SWITCH_FAILED" }, { status: 502 });
  }
}
