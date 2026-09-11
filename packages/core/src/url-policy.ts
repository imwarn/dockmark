import type { HealthPolicy } from "./models";

const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const PRIVATE_IPV4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
];

function stripIpv6Brackets(host: string) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function isPrivateIpv4(host: string) {
  return PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(host));
}

function isPrivateIpv6(host: string) {
  const normalized = stripIpv6Brackets(host);
  if (!normalized.includes(":")) return false;
  if (normalized === "::1") return true;

  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }

  const firstSegment = normalized.split(":", 1)[0];
  if (!firstSegment) return false;

  const firstHextet = Number.parseInt(firstSegment, 16);
  if (Number.isNaN(firstHextet)) return false;

  const isUniqueLocal = (firstHextet & 0xfe00) === 0xfc00;
  const isLinkLocal = (firstHextet & 0xffc0) === 0xfe80;
  return isUniqueLocal || isLinkLocal;
}

export function inferHealthPolicy(rawUrl: string): HealthPolicy {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const unbracketedHost = stripIpv6Brackets(host);

    if (
      LOCAL_HOSTNAMES.has(unbracketedHost) ||
      unbracketedHost.endsWith(".localhost") ||
      unbracketedHost.endsWith(".local") ||
      isPrivateIpv4(unbracketedHost) ||
      isPrivateIpv6(unbracketedHost)
    ) {
      return "local-only";
    }
  } catch {
    return "manual";
  }

  return "normal";
}
