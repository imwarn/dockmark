function isLikelyLocalBareUrl(value: string) {
  const lower = value.toLowerCase();
  const authority = lower.replace(/^\/\//, "").split(/[/?#]/, 1)[0] ?? lower;
  const host = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":", 1)[0] ?? authority;

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.startsWith("[::1]") ||
    /^\[(?:fc|fd|fe8|fe9|fea|feb)/.test(host)
  );
}

export function normalizeBookmarkUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new TypeError("URL is empty.");
  if (trimmed.length > 4096) throw new TypeError("URL is too long.");

  const hasScheme = /^https?:\/\//i.test(trimmed);
  const candidate = hasScheme
    ? trimmed
    : `${isLikelyLocalBareUrl(trimmed) ? "http" : "https"}://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new TypeError("URL is not a valid HTTP or HTTPS address.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Only HTTP and HTTPS bookmarks are supported.");
  }

  return parsed.toString();
}
