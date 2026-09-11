import type { HealthPolicy } from "./models";

const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "::1"]);
const PRIVATE_IPV4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

export function inferHealthPolicy(rawUrl: string): HealthPolicy {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();

    if (
      LOCAL_HOSTNAMES.has(host) ||
      host.endsWith(".local") ||
      PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host)) ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    ) {
      return "local-only";
    }
  } catch {
    return "manual";
  }

  return "normal";
}
