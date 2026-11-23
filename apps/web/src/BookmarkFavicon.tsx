/**
 * [INPUT]: depends on useEffect, useState from react
 * [OUTPUT]: exports BookmarkFavicon component and safeDomainLabel helper
 * [POS]: shared icon renderer for web management cards, showing valid HTTP/HTTPS favicons with a crisp monogram fallback
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useState } from "react";

interface Props {
  iconUrl?: string | null | undefined;
  title: string;
  url?: string | undefined;
  className?: string | undefined;
}

function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function safeDomainLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function monogramFor(title: string, url?: string): string {
  const cleanedTitle = title.trim();
  if (cleanedTitle) return cleanedTitle.slice(0, 1).toUpperCase();
  if (url) {
    const host = safeDomainLabel(url).trim();
    if (host) return host.slice(0, 1).toUpperCase();
  }
  return "•";
}

export function BookmarkFavicon({ iconUrl, title, url, className = "bookmark-icon" }: Props) {
  const safeSrc = safeHttpUrl(iconUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [safeSrc]);

  if (safeSrc && !failed) {
    return (
      <div className={`${className} has-favicon`} aria-hidden="true">
        <img
          src={safeSrc}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className={className} aria-hidden="true">
      {monogramFor(title, url)}
    </div>
  );
}
