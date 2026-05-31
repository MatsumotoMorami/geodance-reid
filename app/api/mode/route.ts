import { NextResponse } from "next/server";
import { isAuthResponse, requireUser } from "@/lib/apiAuth";
import { fetchReidMode, setReidMode } from "@/lib/reidBackend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = requireUser(req);
  if (isAuthResponse(user)) return user;

  try {
    const info = await fetchReidMode();
    return NextResponse.json(info);
  } catch (e) {
    return NextResponse.json(
      { error: "MODE_FETCH_FAILED", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const user = requireUser(req);
  if (isAuthResponse(user)) return user;

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode;
    if (mode !== "camera" && mode !== "dataset") {
      return NextResponse.json(
        { error: "INVALID_MODE", message: "mode must be 'camera' or 'dataset'" },
        { status: 400 },
      );
    }
    const result = await setReidMode(mode);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "MODE_SWITCH_FAILED", message: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
