import { NextResponse } from "next/server";
import { getUserFromCookieHeader, type PublicUser } from "./authStore";

export function requireUser(req: Request): PublicUser | NextResponse {
  const user = getUserFromCookieHeader(req.headers.get("cookie"));
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  return user;
}

export function isAuthResponse(v: PublicUser | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}
