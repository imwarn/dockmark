/**
 * [INPUT]: depends on CommandSource, HealthPolicy, and HealthStatus types from ./models
 * [OUTPUT]: provides locale types, LOCALE_STORAGE_KEY, normalizeLocalePreference, resolveLocale, tx, formatRelativeTime, SOURCE_LABELS, HEALTH_STATUS_LABELS, and HEALTH_POLICY_LABELS
 * [POS]: shared i18n primitives and canonical bilingual dictionaries in packages/core/src; consumed by settings, web, worker, and extension
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import type { CommandSource, HealthPolicy, HealthStatus } from "./models";

export type LocalePreference = "system" | "en" | "zh-CN";
export type ResolvedLocale = "en" | "zh-CN";

export const LOCALE_STORAGE_KEY = "dockmarkLocaleV1";

export function normalizeLocalePreference(value: unknown): LocalePreference {
  if (typeof value !== "string") return "system";
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  return "system";
}

export function resolveLocale(preference: LocalePreference, browserLanguage?: string): ResolvedLocale {
  if (preference === "en" || preference === "zh-CN") return preference;
  const candidate = (browserLanguage ?? (typeof navigator !== "undefined" ? navigator.language : "en")).trim().toLowerCase();
  return candidate.startsWith("zh") ? "zh-CN" : "en";
}

export function tx(locale: ResolvedLocale, en: string, zh: string): string {
  return locale === "zh-CN" ? zh : en;
}

export function formatRelativeTime(isoValue: string | null | undefined, locale: ResolvedLocale): string {
  if (!isoValue) return tx(locale, "never", "从未");
  const timestamp = Date.parse(isoValue);
  if (!Number.isFinite(timestamp)) return tx(locale, "never", "从未");

  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return tx(locale, "just now", "刚刚");
  if (diffMinutes < 60) return tx(locale, `${diffMinutes}m ago`, `${diffMinutes} 分钟前`);

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return tx(locale, `${diffHours}h ago`, `${diffHours} 小时前`);

  const diffDays = Math.floor(diffHours / 24);
  return tx(locale, `${diffDays}d ago`, `${diffDays} 天前`);
}

export const SOURCE_LABELS: Record<ResolvedLocale, Record<CommandSource, string>> = {
  en: {
    tab: "Open tab",
    workspace: "Workspace",
    session: "Session",
    collection: "Collection",
    bookmark: "Bookmark",
    navigation: "Navigation",
    search: "Search",
  },
  "zh-CN": {
    tab: "打开的标签页",
    workspace: "工作区",
    session: "会话",
    collection: "智能合集",
    bookmark: "书签",
    navigation: "导航",
    search: "搜索",
  },
};

export const HEALTH_STATUS_LABELS: Record<ResolvedLocale, Record<HealthStatus, string>> = {
  en: {
    unknown: "Unknown",
    healthy: "Healthy",
    redirected: "Redirected",
    "auth-required": "Auth required",
    forbidden: "Forbidden",
    "rate-limited": "Rate limited",
    timeout: "Timeout",
    "dns-error": "DNS error",
    "tls-error": "TLS error",
    unavailable: "Unavailable",
    "local-only": "Local-only",
    ignored: "Ignored",
  },
  "zh-CN": {
    unknown: "未知",
    healthy: "正常",
    redirected: "已重定向",
    "auth-required": "需要认证",
    forbidden: "禁止访问",
    "rate-limited": "触发限流",
    timeout: "请求超时",
    "dns-error": "DNS 错误",
    "tls-error": "TLS 错误",
    unavailable: "无法访问",
    "local-only": "仅本地",
    ignored: "已忽略",
  },
};

export const HEALTH_POLICY_LABELS: Record<ResolvedLocale, Record<HealthPolicy | "auto", string>> = {
  en: {
    auto: "Auto",
    normal: "Normal",
    ignore: "Ignore",
    "local-only": "Local-only",
    manual: "Manual",
  },
  "zh-CN": {
    auto: "自动",
    normal: "常规",
    ignore: "忽略",
    "local-only": "仅本地",
    manual: "手动",
  },
};
