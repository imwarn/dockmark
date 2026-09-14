export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  kind: "session" | "device" | null;
  device?: { id: string; name: string };
}

export interface PairedDevice {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function authRequest<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => ({})) as T & ErrorEnvelope;
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `Request failed (${response.status}).`);
  }
  return payload;
}

export function getAuthStatus() {
  return authRequest<AuthStatus>("/api/auth/status");
}

export function login(password: string) {
  return authRequest<{ authenticated: true; kind: "session"; expiresAt: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function logout() {
  return authRequest<{ authenticated: false }>("/api/auth/logout", { method: "POST" });
}

export function createPairCode() {
  return authRequest<{ code: string; expiresAt: string }>("/api/auth/pair/code", { method: "POST", body: "{}" });
}

export async function listDevices() {
  const payload = await authRequest<{ devices: PairedDevice[] }>("/api/auth/devices");
  return payload.devices;
}

export function revokeDevice(id: string) {
  return authRequest<void>(`/api/auth/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
}
