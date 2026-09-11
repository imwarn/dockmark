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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `Dockmark request failed (${response.status}).`);
  }
  return body;
}

function Popup() {
  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [serverUrl, setServerUrl] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("Main browser");
  const [sessionName, setSessionName] = useState(defaultSessionName);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savableTabs = useMemo(
    () => tabs.filter((tab): tab is TabSummary & { url: string } => Boolean(tab.url && /^https?:\/\//i.test(tab.url))),
    [tabs],
  );

  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: "dockmark:get-open-tabs" })
      .then((value) => setTabs((value as TabSummary[]) ?? []));

    void browser.storage.local.get([SERVER_KEY, DEVICE_KEY]).then(async (stored) => {
      const storedServer = typeof stored[SERVER_KEY] === "string" ? stored[SERVER_KEY] : "";
      const storedDevice = typeof stored[DEVICE_KEY] === "string" ? stored[DEVICE_KEY] : "Main browser";
      setServerUrl(storedServer);
      setDeviceLabel(storedDevice);
      if (!storedServer) return;

      try {
        const allowed = await browser.permissions.contains({ origins: [hostPattern(storedServer)] });
        if (!allowed) return;
        setConnected(true);
        await refreshSessions(storedServer);
      } catch {
        setConnected(false);
      }
    });
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
    await run(async () => {
      const origin = normalizeServerUrl(serverUrl);
      const granted = await browser.permissions.request({ origins: [hostPattern(origin)] });
      if (!granted) throw new Error("Dockmark site access was not granted.");

      const label = deviceLabel.trim() || "Main browser";
      await browser.storage.local.set({ [SERVER_KEY]: origin, [DEVICE_KEY]: label });
      setServerUrl(origin);
      setDeviceLabel(label);
      setConnected(true);
      await refreshSessions(origin);
      setStatus("Connected to Dockmark.");
    });
  }

  async function saveWindow() {
    await run(async () => {
      if (!connected) throw new Error("Connect the extension to your Dockmark site first.");
      if (!savableTabs.length) throw new Error("This window has no HTTP/HTTPS tabs to save.");
      const name = sessionName.trim();
      if (!name) throw new Error("Give this session a name.");

      await requestJson<{ session: SessionSummary }>(apiUrl(serverUrl, "/api/sessions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
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
        <div className="section-heading"><strong>Cloud connection</strong><span className={connected ? "online" : "offline"}>{connected ? "Connected" : "Local only"}</span></div>
        <input value={serverUrl} onChange={(event) => { setServerUrl(event.target.value); setConnected(false); }} placeholder="https://dockmark.example.com" inputMode="url" />
        <div className="inline-fields">
          <input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="Main MacBook" />
          <button className="secondary" disabled={busy || !serverUrl.trim()} onClick={() => void connect()}>Connect</button>
        </div>
      </section>

      {connected && (
        <section className="card save-card">
          <div className="section-heading"><strong>Save current window</strong><span>{savableTabs.length} web tabs</span></div>
          <input value={sessionName} onChange={(event) => setSessionName(event.target.value)} maxLength={120} />
          <button className="primary" disabled={busy || !sessionName.trim() || !savableTabs.length} onClick={() => void saveWindow()}>Save as Session</button>
        </section>
      )}

      {(status || error) && <div className={`notice ${error ? "error" : "success"}`}>{error ?? status}</div>}

      {connected && (
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
