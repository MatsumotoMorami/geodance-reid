import { NextResponse } from "next/server";
import { isAuthResponse, requireUser } from "@/lib/apiAuth";
import { addCameraForUser } from "@/lib/authStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = requireUser(req);
  if (isAuthResponse(user)) return user;
  return NextResponse.json({ cameras: user.cameras });
}

export async function POST(req: Request) {
  const user = requireUser(req);
  if (isAuthResponse(user)) return user;
  try {
    const body = await req.json();
    const updated = addCameraForUser(user.id, body);
    return NextResponse.json({ user: updated, cameras: updated.cameras }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "CAMERA_ADD_FAILED" }, { status: 400 });
  }
}
