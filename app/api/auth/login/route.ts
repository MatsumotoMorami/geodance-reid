import { NextResponse } from "next/server";
import { loginUser, SESSION_COOKIE, sessionCookieOptions } from "@/lib/authStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = loginUser(String(body.username ?? ""), String(body.password ?? ""));
  if (!result.ok) {
    return NextResponse.json({ error: "LOGIN_FAILED" }, { status: 401 });
  }

  const res = NextResponse.json({ user: result.user });
  res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions());
  return res;
}
