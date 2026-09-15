import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { App } from "./App";
import { InboxPage } from "./InboxPage";
import { SettingsPage } from "./SettingsPage";
import { getAuthStatus, login, logout, type AuthStatus } from "./auth-client";
import "./security.css";

function targetView() {
  if (window.location.pathname.startsWith("/app/settings")) return "settings";
  if (window.location.pathname.startsWith("/app/inbox")) return "inbox";
  return "app";
}

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function PrivateNavigation({ children, onLogout }: { children: ReactNode; onLogout: () => Promise<void> }) {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <>
      <div className="private-utility-bar">
        <a href="/" className="private-utility-brand"><span>D·</span> Public page</a>
        <nav>
          <button className={path === "/app" ? "active" : ""} type="button" onClick={() => navigate("/app")}>Workspace</button>
          <button className={path.startsWith("/app/inbox") ? "active" : ""} type="button" onClick={() => navigate("/app/inbox")}>Inbox</button>
          <button className={path.startsWith("/app/settings") ? "active" : ""} type="button" onClick={() => navigate("/app/settings")}>Settings</button>
          <button type="button" onClick={() => void onLogout()}>Sign out</button>
        </nav>
      </div>
      {children}
    </>
  );
}

function LoginCard({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
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
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <a className="auth-brand" href="/"><span>D·</span><strong>Dockmark</strong></a>
      <section className="auth-card">
        <p className="eyebrow">PRIVATE WORKSPACE</p>
        <h1>Sign in to manage Dockmark.</h1>
        <p>The public homepage exposes only your curated list. Everything else is protected by this Web session.</p>
        <form onSubmit={submit}>
          <label>
            <span>Admin password</span>
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
          <button className="primary" disabled={busy || password.length < 12}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <a className="text-action" href="/">← Back to public page</a>
      </section>
    </main>
  );
}

function SetupRequired({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <main className="auth-shell">
      <a className="auth-brand" href="/"><span>D·</span><strong>Dockmark</strong></a>
      <section className="auth-card auth-setup-card">
        <p className="eyebrow">SECURITY REQUIRED</p>
        <h1>Private APIs are locked.</h1>
        <p>Set the Worker secret <code>DOCKMARK_ADMIN_PASSWORD</code> to a strong value of at least 12 characters, then redeploy or restart the Worker binding. Dockmark deliberately fails closed while this secret is missing.</p>
        <div className="auth-setup-steps">
          <code>npx wrangler secret put DOCKMARK_ADMIN_PASSWORD</code>
          <span>or add the same secret in Cloudflare Workers → Settings → Variables and Secrets.</span>
        </div>
        <button className="primary" type="button" onClick={() => void onRetry()}>Retry security check</button>
        <a className="text-action" href="/">← Public page remains available</a>
      </section>
    </main>
  );
}

export function PrivateRoot() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [path, setPath] = useState(window.location.pathname);
  const [error, setError] = useState<string | null>(null);

  async function refreshStatus() {
    setLoading(true);
    setError(null);
    try {
      setStatus(await getAuthStatus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not reach Dockmark security service.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  async function signOut() {
    try {
      await logout();
    } finally {
      setStatus((current) => current ? { ...current, authenticated: false, kind: null } : current);
      navigate("/app");
    }
  }

  if (loading) {
    return <main className="auth-shell"><div className="auth-loading">Checking private workspace…</div></main>;
  }
  if (error) {
    return (
      <main className="auth-shell"><section className="auth-card"><h1>Security check failed.</h1><p>{error}</p><button className="primary" onClick={() => void refreshStatus()}>Retry</button></section></main>
    );
  }
  if (!status?.configured) return <SetupRequired onRetry={refreshStatus} />;
  if (!status.authenticated || status.kind !== "session") return <LoginCard onAuthenticated={refreshStatus} />;

  const view = path.startsWith("/app/settings")
    ? "settings"
    : path.startsWith("/app/inbox")
      ? "inbox"
      : targetView();
  return (
    <PrivateNavigation onLogout={signOut}>
      {view === "settings" ? <SettingsPage /> : view === "inbox" ? <InboxPage /> : <App />}
    </PrivateNavigation>
  );
}
