import type { HealthPolicy } from "./models";

const LOCAL_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);

function stripIpv6Brackets(host: string) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return numbers;
}

function isNonPublicIpv4(host: string) {
  const parts = parseIpv4(host);
  if (!parts) return false;
  const [a = 0, b = 0, c = 0] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isNonPublicIpv6(host: string) {
  const normalized = stripIpv6Brackets(host).toLowerCase();
  if (!normalized.includes(":")) return false;
  if (normalized === "::" || normalized === "::1") return true;

  if (normalized.startsWith("::ffff:")) {
    return isNonPublicIpv4(normalized.slice("::ffff:".length));
  }

  const firstSegment = normalized.split(":", 1)[0];
  if (!firstSegment) return false;
  const firstHextet = Number.parseInt(firstSegment, 16);
  if (Number.isNaN(firstHextet)) return false;

  return (
    (firstHextet & 0xfe00) === 0xfc00 ||
    (firstHextet & 0xffc0) === 0xfe80 ||
    (firstHextet & 0xff00) === 0xff00 ||
    normalized.startsWith("2001:db8:")
  );
}

export function inferHealthPolicy(rawUrl: string): HealthPolicy {
  try {
    const url = new URL(rawUrl);
    const host = stripIpv6Brackets(url.hostname.toLowerCase());

    if (
      LOCAL_HOSTNAMES.has(host) ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".lan") ||
      host.endsWith(".internal") ||
      host.endsWith(".home.arpa") ||
      isNonPublicIpv4(host) ||
      isNonPublicIpv6(host)
    ) {
      return "local-only";
    }
  } catch {
    return "manual";
  }

  return "normal";
}
