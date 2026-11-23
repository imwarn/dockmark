/**
 * [INPUT]: depends on App, SettingsPage, InboxPage, SmartCollectionsPage, DuplicateReviewPage, auth-client, inbox-api, ./theme, and ./i18n
 * [OUTPUT]: exports PrivateRoot auth gate, private utility navigation shell, and 1-click theme/locale quick-toggles
 * [POS]: Top-level controller for /app* routes. Enforces session authentication and renders the sticky 46px private utility bar above active views.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { AppearancePreference } from "@dockmark/core";
import { App } from "./App";
import { DuplicateReviewPage } from "./DuplicateReviewPage";
import { InboxPage } from "./InboxPage";
import { SettingsPage } from "./SettingsPage";
import { SmartCollectionsPage } from "./SmartCollectionsPage";
import { getAuthStatus, login, logout, type AuthStatus } from "./auth-client";
import { getInboxCount, INBOX_CHANGED_EVENT } from "./inbox-api";
import { saveAppearanceAndLocale, useI18n } from "./i18n";
import { APPEARANCE_STORAGE_KEY, applyAppearance, localAppearance } from "./theme";
import "./security.css";

const THEME_CYCLE: AppearancePreference[] = ["system", "light", "dark"];

function targetView() {
  if (window.location.pathname.startsWith("/app/settings")) return "settings";
  if (window.location.pathname.startsWith("/app/inbox")) return "inbox";
  if (window.location.pathname.startsWith("/app/collections")) return "collections";
  if (window.location.pathname.startsWith("/app/duplicates")) return "duplicates";
  return "app";
}

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isWorkspacePath(pathname: string) {
  return pathname.startsWith("/app") &&
    !pathname.startsWith("/app/settings") &&
    !pathname.startsWith("/app/inbox") &&
    !pathname.startsWith("/app/collections") &&
    !pathname.startsWith("/app/duplicates");
}

function useAppearancePreference(): [AppearancePreference, (next: AppearancePreference, syncCloud: boolean) => void] {
  const [preference, setPreference] = useState<AppearancePreference>(() => localAppearance());

  useEffect(() => {
    const syncFromDom = () => setPreference(localAppearance());
    const onAppearance = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: AppearancePreference }>).detail;
      setPreference(detail?.preference ?? localAppearance());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) syncFromDom();
    };
    window.addEventListener("dockmark:appearance", onAppearance);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("dockmark:appearance", onAppearance);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const choose = useCallback((next: AppearancePreference, syncCloud: boolean) => {
    setPreference(next);
    applyAppearance(next, true);
    if (syncCloud) {
      void saveAppearanceAndLocale({ preference: next }).catch(() => undefined);
    }
  }, []);

  return [preference, choose];
}

function QuickPreferenceToggles({ syncCloud, className = "" }: { syncCloud: boolean; className?: string }) {
  const { isZh, tx, setLocalePreference } = useI18n();
  const [appearance, setAppearance] = useAppearancePreference();

  const nextAppearance = THEME_CYCLE[(THEME_CYCLE.indexOf(appearance) + 1) % THEME_CYCLE.length] ?? "system";
  const themeIcon = appearance === "light" ? "☀" : appearance === "dark" ? "☾" : "◐";
  const themeShortLabel = appearance === "light"
    ? tx("Light", "浅色")
    : appearance === "dark"
      ? tx("Dark", "深色")
      : tx("System", "跟随系统");
  const nextThemeLabel = nextAppearance === "light"
    ? tx("Light", "浅色")
    : nextAppearance === "dark"
      ? tx("Dark", "深色")
      : tx("System", "跟随系统");

  return (
    <span className={`utility-quick-group ${className}`.trim()}>
      <button
        className="utility-quick-toggle"
        type="button"
        title={tx(`Theme: ${themeShortLabel} (switch to ${nextThemeLabel})`, `主题：${themeShortLabel}（点击切换为${nextThemeLabel}）`)}
        aria-label={tx(`Theme: ${themeShortLabel}. Switch to ${nextThemeLabel}.`, `当前主题：${themeShortLabel}，切换为${nextThemeLabel}`)}
        onClick={() => setAppearance(nextAppearance, syncCloud)}
      >
        <span aria-hidden="true">{themeIcon}</span>
        <span>{themeShortLabel}</span>
      </button>
      <button
        className="utility-quick-toggle"
        type="button"
        title={tx("Switch interface language to Simplified Chinese", "将界面语言切换为 English")}
        aria-label={tx("Switch language to Simplified Chinese", "将界面语言切换为英文")}
        onClick={() => void setLocalePreference(isZh ? "en" : "zh-CN", { syncCloud }).catch(() => undefined)}
      >
        {isZh ? "EN" : "中文"}
      </button>
    </span>
  );
}

function PrivateNavigation({ children, onLogout }: { children: ReactNode; onLogout: () => Promise<void> }) {
  const { tx } = useI18n();
  const [path, setPath] = useState(window.location.pathname);
  const [inboxCount, setInboxCount] = useState<number | null>(null);

  const refreshInboxCount = useCallback(async () => {
    try {
      setInboxCount(await getInboxCount());
    } catch {
      // Keep the last known badge count when a background refresh fails.
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    void refreshInboxCount();
  }, [path, refreshInboxCount]);

  useEffect(() => {
    const onFocus = () => void refreshInboxCount();
    const onInboxChanged = () => void refreshInboxCount();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshInboxCount();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener(INBOX_CHANGED_EVENT, onInboxChanged);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(INBOX_CHANGED_EVENT, onInboxChanged);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshInboxCount]);

  const inboxLabel = inboxCount && inboxCount > 0
    ? tx(
        `Inbox, ${inboxCount} bookmark${inboxCount === 1 ? "" : "s"} waiting for review`,
        `收件箱，有 ${inboxCount} 条书签待整理`,
      )
    : tx("Inbox", "收件箱");

  return (
    <>
      <div className="private-utility-bar">
        <a href="/" className="private-utility-brand"><span>D·</span> {tx("Public page", "公开主页")}</a>
        <nav aria-label={tx("Workspace utility navigation", "工作台工具导航")}>
          <button className={isWorkspacePath(path) ? "active" : ""} type="button" onClick={() => navigate("/app")}>
            {tx("Workspace", "工作台")}
          </button>
          <button
            className={`${path.startsWith("/app/inbox") ? "active " : ""}private-inbox-nav`}
            type="button"
            aria-label={inboxLabel}
            onClick={() => navigate("/app/inbox")}
          >
            <span>{tx("Inbox", "收件箱")}</span>
            {inboxCount !== null && inboxCount > 0 && (
              <span className="private-inbox-badge" aria-hidden="true">{inboxCount > 99 ? "99+" : inboxCount}</span>
            )}
          </button>
          <button className={path.startsWith("/app/collections") ? "active" : ""} type="button" onClick={() => navigate("/app/collections")}>
            {tx("Collections", "智能合集")}
          </button>
          <button className={path.startsWith("/app/duplicates") ? "active" : ""} type="button" onClick={() => navigate("/app/duplicates")}>
            {tx("Duplicates", "重复项")}
          </button>
          <button className={path.startsWith("/app/settings") ? "active" : ""} type="button" onClick={() => navigate("/app/settings")}>
            {tx("Settings", "设置")}
          </button>
          <span className="private-utility-divider" aria-hidden="true" />
          <QuickPreferenceToggles syncCloud />
          <button type="button" onClick={() => void onLogout()}>{tx("Sign out", "退出")}</button>
        </nav>
      </div>
      {children}
    </>
  );
}

function LoginCard({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const { tx } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
      setPassword("");
      await onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not sign in.", "登录失败，请检查密码后重试。"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <a className="auth-brand" href="/"><span>D·</span><strong>Dockmark</strong></a>
      <div className="auth-quick-controls">
        <QuickPreferenceToggles syncCloud={false} />
      </div>
      <section className="auth-card">
        <p className="eyebrow">{tx("PRIVATE WORKSPACE", "私有工作台")}</p>
        <h1>{tx("Sign in to Dockmark", "登录 Dockmark")}</h1>
        <p>
          {tx(
            "The public homepage exposes only your curated list. Everything else is protected by this Web session.",
            "公开主页仅展示精选发布的书签；其余书签、工作区与会话均受当前 Web 会话保护。",
          )}
        </p>
        <form onSubmit={submit}>
          <label>
            <span>{tx("Admin password", "管理员密码")}</span>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              minLength={12}
              required
            />
          </label>
          <button className="primary" disabled={busy || password.length < 12}>
            {busy ? tx("Signing in…", "正在登录…") : tx("Sign in", "登录")}
          </button>
        </form>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <a className="text-action" href="/">{tx("← Back to public page", "← 返回公开主页")}</a>
      </section>
    </main>
  );
}

function SetupRequired({ onRetry }: { onRetry: () => Promise<void> }) {
  const { tx } = useI18n();

  return (
    <main className="auth-shell">
      <a className="auth-brand" href="/"><span>D·</span><strong>Dockmark</strong></a>
      <div className="auth-quick-controls">
        <QuickPreferenceToggles syncCloud={false} />
      </div>
      <section className="auth-card auth-setup-card">
        <p className="eyebrow">{tx("SECURITY REQUIRED", "需要安全配置")}</p>
        <h1>{tx("Private APIs are locked", "私有接口已锁定")}</h1>
        <p>
          {tx(
            "Set the Worker secret ",
            "请将 Worker 密钥 ",
          )}
          <code>DOCKMARK_ADMIN_PASSWORD</code>
          {tx(
            " to a strong value of at least 12 characters, then redeploy or restart the Worker binding. Dockmark deliberately fails closed while this secret is missing.",
            " 设置为至少 12 位的强密码，然后重新部署或重启 Worker。缺少该密钥时 Dockmark 会默认拒绝访问以保障安全。",
          )}
        </p>
        <div className="auth-setup-steps">
          <code>npx wrangler secret put DOCKMARK_ADMIN_PASSWORD</code>
          <span>
            {tx(
              "or add the same secret in Cloudflare Workers → Settings → Variables and Secrets.",
              "或在 Cloudflare Workers → Settings → Variables and Secrets 中添加同名密钥。",
            )}
          </span>
        </div>
        <button className="primary" type="button" onClick={() => void onRetry()}>
          {tx("Retry security check", "重新检查安全状态")}
        </button>
        <a className="text-action" href="/">{tx("← Public page remains available", "← 公开主页仍可访问")}</a>
      </section>
    </main>
  );
}

export function PrivateRoot() {
  const { tx } = useI18n();
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getAuthStatus());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tx("Could not reach Dockmark security service.", "无法连接 Dockmark 安全服务。"),
      );
    } finally {
      setLoading(false);
    }
  }, [tx]);

  useEffect(() => {
    void refreshStatus();
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [refreshStatus]);

  async function signOut() {
    try {
      await logout();
    } finally {
      setStatus((current) => (current ? { ...current, authenticated: false, kind: null } : current));
      navigate("/app");
    }
  }

  if (loading) {
    return (
      <main className="auth-shell">
        <div className="auth-loading">{tx("Checking private workspace…", "正在检查私有工作台…")}</div>
      </main>
    );
  }
  if (error) {
    return (
      <main className="auth-shell">
        <div className="auth-quick-controls">
          <QuickPreferenceToggles syncCloud={false} />
        </div>
        <section className="auth-card">
          <h1>{tx("Security check failed", "安全检查失败")}</h1>
          <p>{error}</p>
          <button className="primary" type="button" onClick={() => void refreshStatus()}>
            {tx("Retry", "重试")}
          </button>
        </section>
      </main>
    );
  }
  if (!status?.configured) return <SetupRequired onRetry={refreshStatus} />;
  if (!status.authenticated || status.kind !== "session") return <LoginCard onAuthenticated={refreshStatus} />;

  const view = path.startsWith("/app/settings")
    ? "settings"
    : path.startsWith("/app/inbox")
      ? "inbox"
      : path.startsWith("/app/collections")
        ? "collections"
        : path.startsWith("/app/duplicates")
          ? "duplicates"
          : targetView();

  return (
    <PrivateNavigation onLogout={signOut}>
      {view === "settings"
        ? <SettingsPage />
        : view === "inbox"
          ? <InboxPage />
          : view === "collections"
            ? <SmartCollectionsPage />
            : view === "duplicates"
              ? <DuplicateReviewPage />
              : <App />}
    </PrivateNavigation>
  );
}
