import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import "./style.css";

type TabSummary = {
  id?: number;
  title: string;
  url?: string;
  pinned: boolean;
  active: boolean;
};

type SessionItem = {
  id: string;
  title: string;
  url: string;
  pinned: boolean;
  position: number;
};

type SessionSummary = {
  id: string;
  name: string;
  sourceDevice?: string;
  createdAt: string;
  items: SessionItem[];
};

const SERVER_KEY = "dockmarkServerUrl";
const DEVICE_KEY = "dockmarkDeviceLabel";
const TOKEN_KEY = "dockmarkDeviceToken";

class DockmarkRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function defaultSessionName() {
  return `Window · ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date())}`;
}

function normalizeServerUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Dockmark URL must use HTTP or HTTPS.");
  }
  return url.origin;
}

function hostPattern(origin: string) {
  return `${origin}/*`;
}

function apiUrl(origin: string, path: string) {
  return new URL(path, `${origin}/`).toString();
}

async function requestJson<T>(url: string, init: RequestInit = {}, includeDeviceToken = true): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  if (includeDeviceToken) {
    const stored = await browser.storage.local.get(TOKEN_KEY);
    const token = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new DockmarkRequestError(response.status, body.error?.message ?? `Dockmark request failed (${response.status}).`);
  }
  return body;
}

function Popup() {
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [serverUrl, setServerUrl] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("Main browser");
  const [pairCode, setPairCode] = useState("");
  const [sessionName, setSessionName] = useState(defaultSessionName);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [paired, setPaired] = useState(false);
  const [bookmarkAccess, setBookmarkAccess] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savableTabs = useMemo(
    () => tabs.filter((tab): tab is TabSummary & { url: string } => Boolean(tab.url && /^https?:\/\//i.test(tab.url))),
    [tabs],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [openTabs, hasBookmarks, stored] = await Promise.all([
          browser.runtime.sendMessage({ type: "dockmark:get-open-tabs" }),
          browser.permissions.contains({ permissions: ["bookmarks"] }),
          browser.storage.local.get([SERVER_KEY, DEVICE_KEY, TOKEN_KEY]),
        ]);
        if (cancelled) return;

        setTabs((openTabs as TabSummary[]) ?? []);
        setBookmarkAccess(hasBookmarks);

        const storedServer = typeof stored[SERVER_KEY] === "string" ? stored[SERVER_KEY] : "";
        const storedDevice = typeof stored[DEVICE_KEY] === "string" ? stored[DEVICE_KEY] : "Main browser";
        const storedToken = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
        setServerUrl(storedServer);
        setDeviceLabel(storedDevice);
        if (!storedServer) return;

        const allowed = await browser.permissions.contains({ origins: [hostPattern(storedServer)] });
        if (!allowed || cancelled) return;
        await browser.runtime.sendMessage({ type: "dockmark:configure-bridge", origin: storedServer });
        if (cancelled) return;
        setConnected(true);

        if (storedToken) {
          try {
            await refreshSessions(storedServer);
            if (!cancelled) setPaired(true);
          } catch (caught) {
            if (caught instanceof DockmarkRequestError && (caught.status === 401 || caught.status === 403)) {
              await browser.storage.local.remove(TOKEN_KEY);
              if (!cancelled) {
                setPaired(false);
                setSessions([]);
              }
            } else {
              throw caught;
            }
          }
        }
      } catch {
        if (!cancelled) setConnected(false);
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshSessions(origin = serverUrl) {
    if (!origin) return;
    const payload = await requestJson<{ sessions: SessionSummary[] }>(apiUrl(origin, "/api/sessions"));
    setSessions(payload.sessions);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setStatus(null);
    setError(null);

    try {
      const origin = normalizeServerUrl(serverUrl);

      // Firefox requires permissions.request to run directly from the user gesture.
      // Do not await storage or any other async work before this request.
      const granted = await browser.permissions.request({ origins: [hostPattern(origin)] });
      if (!granted) throw new Error("Dockmark site access was not granted.");

      const stored = await browser.storage.local.get([SERVER_KEY, TOKEN_KEY]);
      const previousOrigin = typeof stored[SERVER_KEY] === "string" ? stored[SERVER_KEY] : "";
      const existingToken = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
      const label = deviceLabel.trim() || "Main browser";

      if (previousOrigin && previousOrigin !== origin) {
        await browser.storage.local.remove(TOKEN_KEY);
        setPaired(false);
        setSessions([]);
      }
      await browser.storage.local.set({ [SERVER_KEY]: origin, [DEVICE_KEY]: label });
      setServerUrl(origin);
      setDeviceLabel(label);

      await browser.runtime.sendMessage({ type: "dockmark:configure-bridge", origin });

      if (previousOrigin && previousOrigin !== origin) {
        await browser.permissions.remove({ origins: [hostPattern(previousOrigin)] }).catch(() => false);
      }

      setConnected(true);
      if (previousOrigin === origin && existingToken) {
        try {
          await refreshSessions(origin);
          setPaired(true);
          setStatus("Connected and paired. Browser bridge and private cloud access are ready.");
          return;
        } catch (caught) {
          if (caught instanceof DockmarkRequestError && (caught.status === 401 || caught.status === 403)) {
            await browser.storage.local.remove(TOKEN_KEY);
            setPaired(false);
          } else {
            throw caught;
          }
        }
      }
      setStatus("Site access connected. Create a pairing code in Dockmark Settings → Security, then enter it below for private cloud access.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function pairDevice() {
    await run(async () => {
      if (!connected) throw new Error("Connect this Dockmark origin first.");
      const code = pairCode.trim();
      if (!code) throw new Error("Enter the pairing code from Dockmark Settings → Security.");
      const label = deviceLabel.trim() || "Main browser";
      const result = await requestJson<{ token: string; device: { id: string; name: string } }>(
        apiUrl(serverUrl, "/api/auth/pair/exchange"),
        {
          method: "POST",
          body: JSON.stringify({ code, name: label }),
        },
        false,
      );
      await browser.storage.local.set({ [TOKEN_KEY]: result.token, [DEVICE_KEY]: label });
      setDeviceLabel(label);
      setPairCode("");
      setPaired(true);
      await refreshSessions();
      setStatus(`Paired as “${result.device.name}”. Private cloud refresh and Session save are enabled.`);
    });
  }

  async function unpairLocal() {
    await run(async () => {
      await browser.storage.local.remove(TOKEN_KEY);
      setPaired(false);
      setSessions([]);
      setStatus("Removed this device token locally. To invalidate a copied token everywhere, revoke this device from Dockmark Settings → Security.");
    });
  }

  async function enableBookmarkAccess() {
    await run(async () => {
      const granted = await browser.permissions.request({ permissions: ["bookmarks"] });
      if (!granted) throw new Error("Native bookmark access was not granted.");
      setBookmarkAccess(true);
      setStatus("Native bookmark access enabled. Dockmark can review imports and mapping changes, and can update a mapped bookmark title/URL only after an explicit Web review action.");
    });
  }

  async function disableBookmarkAccess() {
    await run(async () => {
      const removed = await browser.permissions.remove({ permissions: ["bookmarks"] });
      setBookmarkAccess(!removed);
      setStatus(removed ? "Native bookmark access disabled." : "Native bookmark access is still enabled.");
    });
  }

  async function saveWindow() {
    await run(async () => {
      if (!connected) throw new Error("Connect the extension to your Dockmark site first.");
      if (!paired) throw new Error("Pair this extension before saving private cloud Sessions.");
      if (!savableTabs.length) throw new Error("This window has no HTTP/HTTPS tabs to save.");
      const name = sessionName.trim();
      if (!name) throw new Error("Give this session a name.");

      await requestJson<{ session: SessionSummary }>(apiUrl(serverUrl, "/api/sessions"), {
        method: "POST",
        body: JSON.stringify({
          name,
          sourceDevice: deviceLabel.trim() || "Main browser",
          items: savableTabs.map((tab, position) => ({
            title: tab.title || tab.url,
            url: tab.url,
            pinned: tab.pinned,
            position,
          })),
        }),
      });

      await refreshSessions();
      setSessionName(defaultSessionName());
      setStatus(`Saved ${savableTabs.length} tabs.`);
    });
  }

  async function restoreSession(session: SessionSummary) {
    await run(async () => {
      const result = await browser.runtime.sendMessage({
        type: "dockmark:restore-session",
        items: [...session.items]
          .sort((a, b) => a.position - b.position)
          .map((item) => ({ url: item.url, pinned: item.pinned })),
      }) as { opened?: number } | undefined;
      setStatus(`Restored ${result?.opened ?? session.items.length} tabs.`);
    });
  }

  return (
    <main>
      <header>
        <div><strong>Dockmark</strong><small>Browser bridge</small></div>
        <span>{tabs.length} tabs</span>
      </header>

      <section className="card connection-card">
        <div className="section-heading">
          <strong>Dockmark site</strong>
          <span className={connected ? "online" : "offline"}>{connected ? paired ? "Paired" : "Connected" : initializing ? "Checking" : "Local only"}</span>
        </div>
        <input value={serverUrl} onChange={(event) => { setServerUrl(event.target.value); setConnected(false); setPaired(false); }} placeholder="https://dockmark.example.com" inputMode="url" />
        <div className="inline-fields">
          <input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="Main MacBook" />
          <button className="secondary" disabled={initializing || busy || !serverUrl.trim()} onClick={() => void connect()}>
            {initializing ? "Checking…" : connected ? "Reconnect" : "Connect"}
          </button>
        </div>
      </section>

      {connected && (
        <section className="card permission-card">
          <div className="section-heading"><strong>Private cloud pairing</strong><span className={paired ? "online" : "offline"}>{paired ? "Authenticated" : "Required"}</span></div>
          {paired ? (
            <>
              <p>This extension holds a revocable per-device token. It can read launcher data and save Sessions, but it cannot use its token to edit Dockmark bookmarks, settings or public-page selection.</p>
              <button className="secondary" disabled={busy} onClick={() => void unpairLocal()}>Remove local device token</button>
            </>
          ) : (
            <>
              <p>Open <strong>Dockmark → Settings → Security</strong>, create a one-time pairing code, then enter it here. Pair codes expire after 10 minutes and work once.</p>
              <div className="inline-fields">
                <input value={pairCode} onChange={(event) => setPairCode(event.target.value.toUpperCase())} placeholder="ABCD-EFGH-JK" autoComplete="off" />
                <button className="primary" disabled={busy || !pairCode.trim()} onClick={() => void pairDevice()}>Pair device</button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="card permission-card">
        <div className="section-heading"><strong>Native bookmarks</strong><span className={bookmarkAccess ? "online" : "offline"}>{bookmarkAccess ? "Enabled" : "Optional"}</span></div>
        <p>Used to read your browser bookmark tree for reviewed import/mapping and, only when you explicitly choose <strong>Write Dockmark → Browser</strong> in the Web review UI, update that mapped bookmark's title and URL. Dockmark never writes browser bookmarks in the background.</p>
        <button className="secondary" disabled={initializing || busy} onClick={() => void (bookmarkAccess ? disableBookmarkAccess() : enableBookmarkAccess())}>
          {bookmarkAccess ? "Disable bookmark access" : "Enable bookmark access"}
        </button>
      </section>

      {connected && paired && (
        <section className="card save-card">
          <div className="section-heading"><strong>Save current window</strong><span>{savableTabs.length} web tabs</span></div>
          <input value={sessionName} onChange={(event) => setSessionName(event.target.value)} maxLength={120} />
          <button className="primary" disabled={busy || !sessionName.trim() || !savableTabs.length} onClick={() => void saveWindow()}>Save as Session</button>
        </section>
      )}

      {(status || error) && <div className={`notice ${error ? "error" : "success"}`}>{error ?? status}</div>}

      {connected && paired && (
        <section className="session-section">
          <div className="section-heading"><strong>Recent sessions</strong><span>{sessions.length}</span></div>
          <div className="session-list">
            {sessions.slice(0, 4).map((session) => (
              <button className="session-row" key={session.id} disabled={busy || !session.items.length} onClick={() => void restoreSession(session)}>
                <span><strong>{session.name}</strong><small>{session.items.length} tabs{session.sourceDevice ? ` · ${session.sourceDevice}` : ""}</small></span>
                <em>Restore</em>
              </button>
            ))}
            {!sessions.length && <p className="empty">No cloud sessions yet.</p>}
          </div>
        </section>
      )}

      <section className="open-tabs-section">
        <div className="section-heading"><strong>Open tabs</strong><span>{tabs.length}</span></div>
        <div className="tabs">
          {tabs.slice(0, 6).map((tab) => (
            <button
              className="tab-row"
              key={tab.id ?? tab.url}
              disabled={tab.id == null}
              onClick={() => browser.runtime.sendMessage({ type: "dockmark:activate-tab", tabId: tab.id })}
            >
              <span>{tab.title}</span>
              <small>{tab.active ? "Current" : "Switch"}</small>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<StrictMode><Popup /></StrictMode>);
