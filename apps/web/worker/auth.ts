type BindValue = string | number | null;

interface D1PreparedStatementLike {
  bind(...values: BindValue[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
}

export interface AuthDatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface AuthEnv {
  DB: AuthDatabaseLike;
  DOCKMARK_ADMIN_PASSWORD?: string;
}

export type AuthPrincipal =
  | { kind: "session"; id: string }
  | { kind: "device"; id: string; name: string };

export class AuthHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const SESSION_COOKIE = "dockmark_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PAIR_TTL_MS = 10 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

async function readBody(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AuthHttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AuthHttpError(400, "invalid_body", "Request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AuthHttpError(400, "invalid_field", `${key} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AuthHttpError(400, "invalid_field", `${key} is too long.`);
  }
  return trimmed;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function safeEqual(left: string, right: string) {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function randomPairCode() {
  const data = new Uint8Array(10);
  crypto.getRandomValues(data);
  const raw = Array.from(data, (value) => PAIR_ALPHABET[value % PAIR_ALPHABET.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

function normalizePairCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const item of header.split(";")) {
    const [rawName, ...rest] = item.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function sessionCookie(token: string, maxAge = Math.floor(SESSION_TTL_MS / 1000)) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function nowIso() {
  return new Date().toISOString();
}

export function authConfigured(env: AuthEnv) {
  return typeof env.DOCKMARK_ADMIN_PASSWORD === "string" && env.DOCKMARK_ADMIN_PASSWORD.length >= 12;
}

export function requireSameOrigin(request: Request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new AuthHttpError(403, "origin_required", "State-changing Web requests must include an Origin header.");
  }
  if (origin !== new URL(request.url).origin) {
    throw new AuthHttpError(403, "origin_mismatch", "Cross-origin state-changing requests are not allowed.");
  }
}

async function touchSession(db: AuthDatabaseLike, id: string) {
  await db.prepare(
    "UPDATE auth_sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?",
  )
    .bind(nowIso(), id, new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .run();
}

async function touchDevice(db: AuthDatabaseLike, id: string) {
  await db.prepare(
    "UPDATE auth_devices SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?",
  )
    .bind(nowIso(), id, new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .run();
}

export async function authenticateRequest(request: Request, env: AuthEnv): Promise<AuthPrincipal | null> {
  if (!authConfigured(env)) return null;

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) {
      const tokenHash = await sha256(token);
      const row = await env.DB.prepare(
        "SELECT id, name FROM auth_devices WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1",
      )
        .bind(tokenHash)
        .first<{ id: string; name: string }>();
      if (row) {
        await touchDevice(env.DB, row.id);
        return { kind: "device", id: row.id, name: row.name };
      }
    }
  }

  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    "SELECT id FROM auth_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1",
  )
    .bind(tokenHash, nowIso())
    .first<{ id: string }>();
  if (!row) return null;
  await touchSession(env.DB, row.id);
  return { kind: "session", id: row.id };
}

function rateLimitIdentity(request: Request) {
  const address = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  return `${address}|${agent.slice(0, 160)}`;
}

async function assertLoginAllowed(request: Request, db: AuthDatabaseLike) {
  const keyHash = await sha256(rateLimitIdentity(request));
  const row = await db.prepare(
    "SELECT window_started_at, failures FROM auth_rate_limits WHERE key_hash = ? LIMIT 1",
  )
    .bind(keyHash)
    .first<{ window_started_at: string; failures: number }>();
  if (!row) return keyHash;
  const started = Date.parse(row.window_started_at);
  if (!Number.isFinite(started) || Date.now() - started >= LOGIN_WINDOW_MS) {
    await db.prepare("DELETE FROM auth_rate_limits WHERE key_hash = ?").bind(keyHash).run();
    return keyHash;
  }
  if (row.failures >= LOGIN_MAX_FAILURES) {
    throw new AuthHttpError(429, "login_rate_limited", "Too many failed sign-in attempts. Try again in a few minutes.");
  }
  return keyHash;
}

async function recordLoginFailure(db: AuthDatabaseLike, keyHash: string) {
  const row = await db.prepare(
    "SELECT window_started_at, failures FROM auth_rate_limits WHERE key_hash = ? LIMIT 1",
  )
    .bind(keyHash)
    .first<{ window_started_at: string; failures: number }>();
  const started = row ? Date.parse(row.window_started_at) : Number.NaN;
  if (!row || !Number.isFinite(started) || Date.now() - started >= LOGIN_WINDOW_MS) {
    await db.prepare(
      "INSERT INTO auth_rate_limits (key_hash, window_started_at, failures) VALUES (?, ?, 1) ON CONFLICT(key_hash) DO UPDATE SET window_started_at = excluded.window_started_at, failures = 1",
    )
      .bind(keyHash, nowIso())
      .run();
    return;
  }
  await db.prepare("UPDATE auth_rate_limits SET failures = failures + 1 WHERE key_hash = ?")
    .bind(keyHash)
    .run();
}

async function login(request: Request, env: AuthEnv) {
  requireSameOrigin(request);
  if (!authConfigured(env)) {
    throw new AuthHttpError(503, "security_not_configured", "Dockmark security is not configured yet.");
  }
  const keyHash = await assertLoginAllowed(request, env.DB);
  const body = await readBody(request);
  const password = requiredString(body, "password", 1024);
  if (!(await safeEqual(password, env.DOCKMARK_ADMIN_PASSWORD ?? ""))) {
    await recordLoginFailure(env.DB, keyHash);
    throw new AuthHttpError(401, "invalid_credentials", "Incorrect password.");
  }

  await env.DB.prepare("DELETE FROM auth_rate_limits WHERE key_hash = ?").bind(keyHash).run();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await env.DB.prepare(
    "INSERT INTO auth_sessions (id, token_hash, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(id, tokenHash, request.headers.get("user-agent")?.slice(0, 300) ?? null, createdAt, createdAt, expiresAt)
    .run();

  return json(
    { authenticated: true, kind: "session", expiresAt },
    { headers: { "set-cookie": sessionCookie(token) } },
  );
}

async function logout(request: Request, env: AuthEnv) {
  requireSameOrigin(request);
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  }
  return json({ authenticated: false }, { headers: { "set-cookie": clearSessionCookie() } });
}

async function authStatus(request: Request, env: AuthEnv) {
  const configured = authConfigured(env);
  const principal = configured ? await authenticateRequest(request, env) : null;
  return json({
    configured,
    authenticated: Boolean(principal),
    kind: principal?.kind ?? null,
    ...(principal?.kind === "device" ? { device: { id: principal.id, name: principal.name } } : {}),
  });
}

async function createPairCode(request: Request, env: AuthEnv, principal: AuthPrincipal | null) {
  requireSameOrigin(request);
  if (principal?.kind !== "session") {
    throw new AuthHttpError(403, "session_required", "A signed-in Web session is required to create pairing codes.");
  }
  await env.DB.prepare("DELETE FROM auth_pair_codes WHERE expires_at <= ? OR used_at IS NOT NULL")
    .bind(nowIso())
    .run();
  const code = randomPairCode();
  const codeHash = await sha256(normalizePairCode(code));
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + PAIR_TTL_MS).toISOString();
  await env.DB.prepare(
    "INSERT INTO auth_pair_codes (id, code_hash, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
  )
    .bind(crypto.randomUUID(), codeHash, createdAt, expiresAt)
    .run();
  return json({ code, expiresAt });
}

async function exchangePairCode(request: Request, env: AuthEnv) {
  if (!authConfigured(env)) {
    throw new AuthHttpError(503, "security_not_configured", "Dockmark security is not configured yet.");
  }
  const body = await readBody(request);
  const code = normalizePairCode(requiredString(body, "code", 64));
  const name = requiredString(body, "name", 120);
  if (code.length < 8) throw new AuthHttpError(400, "invalid_pair_code", "Pairing code is invalid.");
  const codeHash = await sha256(code);
  const now = nowIso();
  const row = await env.DB.prepare(
    "SELECT id FROM auth_pair_codes WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? LIMIT 1",
  )
    .bind(codeHash, now)
    .first<{ id: string }>();
  if (!row) throw new AuthHttpError(401, "invalid_pair_code", "Pairing code is invalid, expired, or already used.");
  const claimed = await env.DB.prepare(
    "UPDATE auth_pair_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
  )
    .bind(now, row.id)
    .run();
  if ((claimed.meta?.changes ?? 0) < 1) {
    throw new AuthHttpError(409, "pair_code_used", "Pairing code was already used.");
  }

  const token = randomToken();
  const tokenHash = await sha256(token);
  const deviceId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO auth_devices (id, name, token_hash, created_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, ?, NULL)",
  )
    .bind(deviceId, name, tokenHash, now, now)
    .run();
  return json({
    token,
    device: { id: deviceId, name, createdAt: now, lastSeenAt: now, revokedAt: null },
  });
}

async function listDevices(env: AuthEnv, principal: AuthPrincipal | null) {
  if (principal?.kind !== "session") {
    throw new AuthHttpError(403, "session_required", "A signed-in Web session is required to manage devices.");
  }
  const result = await env.DB.prepare(
    "SELECT id, name, created_at, last_seen_at, revoked_at FROM auth_devices ORDER BY created_at DESC",
  ).all<{ id: string; name: string; created_at: string; last_seen_at: string; revoked_at: string | null }>();
  return json({
    devices: result.results.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
    })),
  });
}

async function revokeDevice(request: Request, env: AuthEnv, principal: AuthPrincipal | null, id: string) {
  requireSameOrigin(request);
  if (principal?.kind !== "session") {
    throw new AuthHttpError(403, "session_required", "A signed-in Web session is required to revoke devices.");
  }
  const result = await env.DB.prepare(
    "UPDATE auth_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  )
    .bind(nowIso(), id)
    .run();
  if ((result.meta?.changes ?? 0) < 1) {
    throw new AuthHttpError(404, "device_not_found", "Active device was not found.");
  }
  return new Response(null, { status: 204 });
}

export function deviceCanAccess(request: Request, pathname: string) {
  const method = request.method.toUpperCase();
  if (method === "GET") {
    return pathname === "/api/bookmarks" ||
      pathname === "/api/categories" ||
      pathname === "/api/workspaces" || pathname.startsWith("/api/workspaces/") ||
      pathname === "/api/search-engines" ||
      pathname === "/api/settings/browser" ||
      pathname === "/api/sessions" || pathname.startsWith("/api/sessions/");
  }
  if (method === "POST" && pathname === "/api/sessions") return true;
  return false;
}

export async function handleAuthApi(request: Request, env: AuthEnv, pathname: string): Promise<Response | null> {
  if (!pathname.startsWith("/api/auth/")) return null;
  const principal = await authenticateRequest(request, env);

  if (pathname === "/api/auth/status" && request.method === "GET") return authStatus(request, env);
  if (pathname === "/api/auth/login" && request.method === "POST") return login(request, env);
  if (pathname === "/api/auth/logout" && request.method === "POST") return logout(request, env);
  if (pathname === "/api/auth/pair/code" && request.method === "POST") return createPairCode(request, env, principal);
  if (pathname === "/api/auth/pair/exchange" && request.method === "POST") return exchangePairCode(request, env);
  if (pathname === "/api/auth/devices" && request.method === "GET") return listDevices(env, principal);

  const deviceMatch = pathname.match(/^\/api\/auth\/devices\/([^/]+)$/);
  if (deviceMatch?.[1] && request.method === "DELETE") {
    return revokeDevice(request, env, principal, decodeURIComponent(deviceMatch[1]));
  }

  throw new AuthHttpError(405, "method_not_allowed", "Method not allowed for authentication route.");
}
