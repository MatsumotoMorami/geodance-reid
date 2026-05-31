import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import type { CameraDef, CameraTier } from "./cameras";
import { CAMERAS } from "./cameras";

export type PublicUser = {
  id: string;
  username: string;
  cameras: CameraDef[];
  camerasUpdatedAt: number;
};

type StoredUser = PublicUser & {
  passwordHash: string;
  passwordSalt: string;
  createdAt: number;
};

type AppStore = {
  authSecret: string;
  users: StoredUser[];
};

export const SESSION_COOKIE = "geodance_session";
const STORE_PATH = process.env.AUTH_STORE_PATH || join(process.cwd(), "data", "app-store.json");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CAMERAS_PER_USER = 32;
const VALID_TIERS: CameraTier[] = ["normal", "low_availability", "low_resolution"];
const USERNAME_RE = /^[a-z0-9_@.-]{3,40}$/;

export type AuthResult =
  | { ok: true; user: PublicUser; token: string }
  | { ok: false; message: string };

function now(): number {
  return Date.now();
}

function defaultStore(): AppStore {
  return { authSecret: randomBytes(32).toString("hex"), users: [] };
}

function configuredAdmin(): { username: string; password: string } | { error: string } | null {
  const usernameRaw = process.env.AUTH_ADMIN_USERNAME?.trim();
  const password = process.env.AUTH_ADMIN_PASSWORD ?? "";
  if (!usernameRaw && !password) return null;
  const username = normalizeUsername(usernameRaw ?? "");
  if (!USERNAME_RE.test(username)) {
    return { error: "AUTH_ADMIN_USERNAME 需为 3-40 位，只能包含字母、数字、_、-、.、@" };
  }
  if (password.length < 8) {
    return { error: "AUTH_ADMIN_PASSWORD 至少 8 位" };
  }
  return { username, password };
}

function seedConfiguredAdminIfEmpty(store: AppStore): boolean {
  if (store.users.length > 0) return false;
  const admin = configuredAdmin();
  if (!admin || "error" in admin) return false;

  const { salt, hash } = hashPassword(admin.password);
  store.users.push({
    id: randomBytes(8).toString("hex"),
    username: admin.username,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: now(),
    camerasUpdatedAt: now(),
    cameras: CAMERAS.map((c) => ({ ...c })),
  });
  return true;
}

function readStore(): AppStore {
  if (!existsSync(STORE_PATH)) {
    const st = defaultStore();
    seedConfiguredAdminIfEmpty(st);
    writeStore(st);
    return st;
  }
  const raw = readFileSync(STORE_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<AppStore>;
  const st = {
    authSecret: typeof parsed.authSecret === "string" && parsed.authSecret ? parsed.authSecret : randomBytes(32).toString("hex"),
    users: Array.isArray(parsed.users) ? (parsed.users as StoredUser[]) : [],
  };
  if (seedConfiguredAdminIfEmpty(st)) {
    writeStore(st);
  }
  return st;
}

function writeStore(store: AppStore): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  renameSync(tmp, STORE_PATH);
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): { salt: string; hash: string } {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(store: AppStore, payload: string): string {
  return createHmac("sha256", store.authSecret).update(payload).digest("base64url");
}

function serializeUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    cameras: user.cameras,
    camerasUpdatedAt: user.camerasUpdatedAt,
  };
}

function makeToken(store: AppStore, userId: string): string {
  const expiresAt = now() + SESSION_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  return `${payload}.${sign(store, payload)}`;
}

function getCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawK, ...rawV] = part.trim().split("=");
    if (rawK === name) {
      try {
        return decodeURIComponent(rawV.join("="));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function validateCameraInput(input: unknown, existingIds: Set<string>): CameraDef {
  if (!input || typeof input !== "object") {
    throw new Error("camera must be an object");
  }
  const row = input as Record<string, unknown>;
  const id = String(row.id ?? "").trim();
  const label = String(row.label ?? id).trim();
  const rtspPath = String(row.rtspPath ?? row.url ?? "").trim();
  const tier = String(row.tier ?? "normal").trim() as CameraTier;

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error("摄像头 ID 只能包含字母、数字、下划线和连字符，长度 1-64");
  }
  if (existingIds.has(id)) {
    throw new Error("摄像头 ID 已存在");
  }
  if (!label || label.length > 80) {
    throw new Error("摄像头名称长度需为 1-80");
  }
  if (!/^rtsps?:\/\/.+/i.test(rtspPath) || rtspPath.length > 500) {
    throw new Error("RTSP 地址必须以 rtsp:// 或 rtsps:// 开头");
  }
  if (!VALID_TIERS.includes(tier)) {
    throw new Error("摄像头类型无效");
  }
  return { id, label, rtspPath, tier };
}

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(expires ? { expires } : { maxAge: Math.floor(SESSION_TTL_MS / 1000) }),
  };
}

export function getUserFromCookieHeader(cookieHeader: string | null): PublicUser | null {
  const token = getCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expRaw, sig] = parts;
  const expiresAt = Number.parseInt(expRaw, 10);
  if (!userId || !Number.isFinite(expiresAt) || expiresAt < now()) return null;

  const store = readStore();
  const payload = `${userId}.${expiresAt}`;
  if (sign(store, payload) !== sig) return null;
  const user = store.users.find((u) => u.id === userId);
  return user ? serializeUser(user) : null;
}

export function loginUser(usernameRaw: string, password: string): AuthResult {
  const username = normalizeUsername(usernameRaw);
  const store = readStore();
  if (store.users.length === 0) {
    const admin = configuredAdmin();
    const detail = admin && "error" in admin ? admin.error : "请在 .env.local 设置 AUTH_ADMIN_USERNAME 和 AUTH_ADMIN_PASSWORD，然后重启 Next.js";
    return { ok: false, message: `未配置管理员账号：${detail}` };
  }
  const user = store.users.find((u) => u.username === username);
  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return { ok: false, message: "用户名或密码错误" };
  }
  return { ok: true, user: serializeUser(user), token: makeToken(store, user.id) };
}

export function addCameraForUser(userId: string, input: unknown): PublicUser {
  const store = readStore();
  const user = store.users.find((u) => u.id === userId);
  if (!user) throw new Error("用户不存在");
  if (user.cameras.length >= MAX_CAMERAS_PER_USER) {
    throw new Error(`每个用户最多 ${MAX_CAMERAS_PER_USER} 路摄像头`);
  }
  const existingIds = new Set(user.cameras.map((c) => c.id));
  const camera = validateCameraInput(input, existingIds);
  user.cameras.push(camera);
  user.camerasUpdatedAt = now();
  writeStore(store);
  return serializeUser(user);
}

export function deleteCameraForUser(userId: string, cameraId: string): PublicUser {
  const store = readStore();
  const user = store.users.find((u) => u.id === userId);
  if (!user) throw new Error("用户不存在");
  const before = user.cameras.length;
  user.cameras = user.cameras.filter((c) => c.id !== cameraId);
  if (user.cameras.length === before) throw new Error("摄像头不存在");
  user.camerasUpdatedAt = now();
  writeStore(store);
  return serializeUser(user);
}
