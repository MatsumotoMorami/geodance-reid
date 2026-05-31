import { NextResponse } from "next/server";
import { isAuthResponse, requireUser } from "@/lib/apiAuth";
import { deleteCameraForUser } from "@/lib/authStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = requireUser(req);
  if (isAuthResponse(user)) return user;

  const { id } = await ctx.params;
  if (!id || id.includes("/") || id.includes("..")) {
    return NextResponse.json({ error: "INVALID_ID", message: "摄像头 ID 无效" }, { status: 400 });
  }

  try {
    const updated = deleteCameraForUser(user.id, id);
    return NextResponse.json({ user: updated, cameras: updated.cameras });
  } catch (e) {
    return NextResponse.json(
      { error: "CAMERA_DELETE_FAILED", message: e instanceof Error ? e.message : String(e) },
      { status: 404 },
    );
  }
}

