/**
 * [INPUT]: depends on React 19, browser from wxt/browser, ext-locale helpers from ../../lib/ext-locale, and popup submodules (api, OpenTabsPanel, ReviewedCapture, SessionsPanel, SettingsDrawer, SetupWizard)
 * [OUTPUT]: mounts the state-aware Dockmark browser extension popup workbench (384px) with EN/zh-CN localization and light/dark themes
 * [POS]: primary popup UI entrypoint in apps/extension/entrypoints/popup
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import {
  applyExtensionAppearance,
  applyExtensionLocale,
  hydrateExtensionPreferences,
  readLocalAppearance,
  readLocalLocalePreference,
  subscribeExtensionPreferences,
  tx,
  type AppearancePreference,
  type LocalePreference,
  type ResolvedLocale,
} from "../../lib/ext-locale";
import {
  DEVICE_KEY,
  DockmarkRequestError,
  SERVER_KEY,
  TOKEN_KEY,
  apiUrl,
  hostLabel,
  hostMonogram,
  hostPattern,
  normalizeServerUrl,
  patchRemoteAppearance,
  requestJson,
  type CaptureResult,
  type RemoteAppearanceResponse,
  type SavableTab,
  type SessionSummary,
  type TabSummary,
} from "./api";
import { OpenTabsPanel } from "./OpenTabsPanel";
import { ReviewedCapture } from "./ReviewedCapture";
import { SessionsPanel } from "./SessionsPanel";
import { SettingsDrawer } from "./SettingsDrawer";
import { SetupWizard } from "./SetupWizard";
import "./style.css";

const initialAppearance = applyExtensionAppearance(readLocalAppearance(), false);
const initialLocaleState = applyExtensionLocale(readLocalLocalePreference(), false);

type WorkbenchTab = "capture" | "multitab" | "sessions";

function defaultSessionName(locale: ResolvedLocale) {
  const formatted = new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  return tx(locale, `Window · ${formatted}`, `窗口 · ${formatted}`);
}

function Popup() {
  const [appearance, setAppearance] = useState<AppearancePreference>(initialAppearance);
  const [localePreference, setLocalePreference] = useState<LocalePreference>(initialLocaleState.preference);
  const [locale, setLocale] = useState<ResolvedLocale>(initialLocaleState.locale);
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("capture");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [tabs, setTabs] = useState<TabSummary[]>([]);
  const [serverUrl, setServerUrl] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("Main browser");
  const [pairCode, setPairCode] = useState("");
  const [sessionName, setSessionName] = useState(() => defaultSessionName(initialLocaleState.locale));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [captureResult, setCaptureResult] = useState<CaptureResult | null>(null);
  const [connected, setConnected] = useState(false);
  const [paired, setPaired] = useState(false);
  const [bookmarkAccess, setBookmarkAccess] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const savableTabs = useMemo(
    () => tabs.filter((tab): tab is SavableTab => Boolean(tab.url && /^https?:\/\//i.test(tab.url))),
    [tabs],
  );
  const activeSavableTab = useMemo(
    () => savableTabs.find((tab) => tab.active) ?? null,
    [savableTabs],
  );

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeExtensionPreferences({
      onAppearance: (pref) => { if (!cancelled) setAppearance(pref); },
      onLocale: (pref, resolved) => {
        if (!cancelled) {
          setLocalePreference(pref);
          setLocale(resolved);
        }
      },
    });

    void (async () => {
      try {
        const [hydrated, openTabs, hasBookmarks, stored] = await Promise.all([
          hydrateExtensionPreferences(),
          browser.runtime.sendMessage({ type: "dockmark:get-open-tabs" }),
          browser.permissions.contains({ permissions: ["bookmarks"] }),
          browser.storage.local.get([SERVER_KEY, DEVICE_KEY, TOKEN_KEY]),
        ]);
        if (cancelled) return;

        setAppearance(hydrated.appearance);
        setLocalePreference(hydrated.localePreference);
        setLocale(hydrated.locale);
        setSessionName(defaultSessionName(hydrated.locale));
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
            void syncAppearanceFromServer(storedServer, () => cancelled);
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
      unsubscribe();
    };
  }, []);

  async function syncAppearanceFromServer(origin: string, isCancelled: () => boolean) {
    try {
      const payload = await requestJson<RemoteAppearanceResponse>(apiUrl(origin, "/api/settings/appearance"));
      if (isCancelled() || !payload?.settings) return;
      if (payload.settings.preference) setAppearance(applyExtensionAppearance(payload.settings.preference, true));
      if (payload.settings.locale) {
        const applied = applyExtensionLocale(payload.settings.locale, true);
        setLocalePreference(applied.preference);
        setLocale(applied.locale);
      }
    } catch {
      // Cloud appearance read is best-effort.
    }
  }

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
      setError(caught instanceof Error ? caught.message : tx(locale, "Something went wrong.", "操作失败，请重试。"));
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setStatus(null);
    setError(null);
    setCaptureResult(null);

    try {
      const origin = normalizeServerUrl(serverUrl);
      // Call permissions.request synchronously on user gesture with no await beforehand.
      const granted = await browser.permissions.request({ origins: [hostPattern(origin)] });
      if (!granted) throw new Error(tx(locale, "Dockmark site access was not granted.", "未授予 Dockmark 站点访问权限。"));

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
          setStatus(tx(locale, "Connected and paired.", "已连接并完成配对。"));
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
      setStatus(tx(locale, "Site access granted. Enter a pairing code from Settings → Security.", "站点权限已连接，请输入设置 → 安全中的一次性配对码。"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx(locale, "Something went wrong.", "操作失败，请重试。"));
    } finally {
      setBusy(false);
    }
  }

  async function pairDevice() {
    await run(async () => {
      if (!connected) throw new Error(tx(locale, "Connect this Dockmark origin first.", "请先连接 Dockmark 服务器。"));
      const code = pairCode.trim();
      if (!code) throw new Error(tx(locale, "Enter the pairing code from Settings → Security.", "请输入设置 → 安全中的配对码。"));
      const label = deviceLabel.trim() || "Main browser";
      const result = await requestJson<{ token: string; device: { id: string; name: string } }>(
        apiUrl(serverUrl, "/api/auth/pair/exchange"),
        { method: "POST", body: JSON.stringify({ code, name: label }) },
        false,
      );
      await browser.storage.local.set({ [TOKEN_KEY]: result.token, [DEVICE_KEY]: label });
      setDeviceLabel(label);
      setPairCode("");
      setPaired(true);
      setSettingsOpen(false);
      await refreshSessions();
      void syncAppearanceFromServer(serverUrl, () => false);
      setStatus(tx(locale, `Paired as “${result.device.name}”.`, `已配对设备“${result.device.name}”。`));
    });
  }

  async function unpairLocal() {
    await run(async () => {
      await browser.storage.local.remove(TOKEN_KEY);
      setPaired(false);
      setSessions([]);
      setCaptureResult(null);
      setStatus(tx(locale, "Removed local device token. Revoke in Settings → Security to invalidate copies.", "已清除本地设备令牌。如需彻底作废，请在设置 → 安全中撤销该设备。"));
    });
  }

  async function toggleBookmarkAccess() {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      if (bookmarkAccess) {
        const removed = await browser.permissions.remove({ permissions: ["bookmarks"] });
        setBookmarkAccess(!removed);
        setStatus(removed ? tx(locale, "Native bookmark access disabled.", "已关闭浏览器原生书签权限。") : tx(locale, "Native bookmark access is still enabled.", "浏览器原生书签权限仍处于开启状态。"));
      } else {
        const granted = await browser.permissions.request({ permissions: ["bookmarks"] });
        if (!granted) throw new Error(tx(locale, "Native bookmark access was not granted.", "未授予浏览器原生书签权限。"));
        setBookmarkAccess(true);
        setStatus(tx(locale, "Native bookmark access enabled.", "已开启浏览器原生书签权限。"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx(locale, "Something went wrong.", "操作失败，请重试。"));
    } finally {
      setBusy(false);
    }
  }

  function handleSelectAppearance(next: AppearancePreference) {
    const applied = applyExtensionAppearance(next, true);
    setAppearance(applied);
    if (connected && paired && serverUrl) void patchRemoteAppearance(serverUrl, { preference: applied });
  }

  function handleSelectLocale(next: LocalePreference) {
    const applied = applyExtensionLocale(next, true);
    setLocalePreference(applied.preference);
    setLocale(applied.locale);
    if (connected && paired && serverUrl) void patchRemoteAppearance(serverUrl, { locale: applied.preference });
  }

  async function saveCurrentTab() {
    await run(async () => {
      if (!connected) throw new Error(tx(locale, "Connect the extension to Dockmark first.", "请先连接 Dockmark 服务器。"));
      if (!paired) throw new Error(tx(locale, "Pair this extension before Quick Capture.", "请先配对设备后再使用快速收录。"));
      if (!activeSavableTab?.url) throw new Error(tx(locale, "Current tab is not a savable HTTP/HTTPS page.", "当前标签页不是可收录的 HTTP/HTTPS 网页。"));
      if (new URL(activeSavableTab.url).origin === normalizeServerUrl(serverUrl)) {
        throw new Error(tx(locale, "Dockmark does not capture its own management page.", "Dockmark 不会收录自身的管理页面。"));
      }
      const result = await requestJson<CaptureResult>(apiUrl(serverUrl, "/api/capture/bookmark"), {
        method: "POST",
        body: JSON.stringify({ title: activeSavableTab.title || activeSavableTab.url, url: activeSavableTab.url }),
      });
      setCaptureResult(result);
      setStatus(result.result === "created" ? tx(locale, "Saved to Inbox.", "已保存到收件箱。") : null);
    });
  }

  async function saveWindow() {
    await run(async () => {
      if (!connected) throw new Error(tx(locale, "Connect the extension to Dockmark first.", "请先连接 Dockmark 服务器。"));
      if (!paired) throw new Error(tx(locale, "Pair this extension before saving Sessions.", "请先配对设备后再保存会话。"));
      if (!savableTabs.length) throw new Error(tx(locale, "This window has no HTTP/HTTPS tabs to save.", "当前窗口没有可保存的 HTTP/HTTPS 标签页。"));
      const name = sessionName.trim();
      if (!name) throw new Error(tx(locale, "Give this session a name.", "请输入会话名称。"));
      await requestJson<{ session: SessionSummary }>(apiUrl(serverUrl, "/api/sessions"), {
        method: "POST",
        body: JSON.stringify({
          name,
          sourceDevice: deviceLabel.trim() || "Main browser",
          items: savableTabs.map((tab, position) => ({ title: tab.title || tab.url, url: tab.url, pinned: tab.pinned, position })),
        }),
      });
      await refreshSessions();
      setSessionName(defaultSessionName(locale));
      setStatus(tx(locale, `Saved ${savableTabs.length} tabs as Session.`, `已将 ${savableTabs.length} 个标签页保存为会话。`));
    });
  }

  async function restoreSession(session: SessionSummary) {
    await run(async () => {
      const result = (await browser.runtime.sendMessage({
        type: "dockmark:restore-session",
        items: [...session.items].sort((a, b) => a.position - b.position).map((item) => ({ url: item.url, pinned: item.pinned })),
      })) as { opened?: number } | undefined;
      const count = result?.opened ?? session.items.length;
      setStatus(tx(locale, `Restored ${count} tabs.`, `已恢复 ${count} 个标签页。`));
    });
  }

  const connectionLabel = connected
    ? paired ? tx(locale, "Paired", "已配对") : tx(locale, "Connected", "已连接")
    : initializing ? tx(locale, "Checking", "检查中") : tx(locale, "Local", "仅本地");
  const isDailyReady = connected && paired;

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="popup-brand">
          <span className="brand-mark" aria-hidden="true">D·</span>
          <div className="brand-meta">
            <strong>Dockmark</strong>
            <span className={`status-pill ${isDailyReady ? "paired" : connected ? "connected" : "local"}`}>
              <i className="status-dot" aria-hidden="true" />
              {connectionLabel}
            </span>
          </div>
        </div>
        <div className="header-actions">
          {connected && serverUrl && (
            <button
              className="icon-btn"
              type="button"
              title={tx(locale, "Open Dockmark Web", "打开 Dockmark 网页端")}
              aria-label={tx(locale, "Open Dockmark Web", "打开 Dockmark 网页端")}
              onClick={() => void browser.tabs.create({ url: apiUrl(serverUrl, "/app"), active: true })}
            >↗</button>
          )}
          <button
            className={`icon-btn${settingsOpen ? " active" : ""}`}
            type="button"
            aria-pressed={settingsOpen}
            title={tx(locale, "Extension settings", "扩展设置")}
            aria-label={tx(locale, "Extension settings", "扩展设置")}
            onClick={() => setSettingsOpen((open) => !open)}
          >⚙</button>
        </div>
      </header>

      {settingsOpen ? (
        <SettingsDrawer
          locale={locale}
          localePreference={localePreference}
          appearance={appearance}
          serverUrl={serverUrl}
          deviceLabel={deviceLabel}
          pairCode={pairCode}
          connected={connected}
          paired={paired}
          bookmarkAccess={bookmarkAccess}
          initializing={initializing}
          busy={busy}
          onServerUrlChange={(value) => { setServerUrl(value); setConnected(false); setPaired(false); setCaptureResult(null); }}
          onDeviceLabelChange={setDeviceLabel}
          onPairCodeChange={setPairCode}
          onConnect={() => void connect()}
          onPairDevice={() => void pairDevice()}
          onUnpairLocal={() => void unpairLocal()}
          onToggleBookmarkAccess={() => void toggleBookmarkAccess()}
          onSelectAppearance={handleSelectAppearance}
          onSelectLocale={handleSelectLocale}
          onClose={() => setSettingsOpen(false)}
        />
      ) : (
        <>
          {!isDailyReady ? (
            <SetupWizard
              locale={locale}
              serverUrl={serverUrl}
              deviceLabel={deviceLabel}
              pairCode={pairCode}
              connected={connected}
              initializing={initializing}
              busy={busy}
              onServerUrlChange={(value) => { setServerUrl(value); setConnected(false); setPaired(false); setCaptureResult(null); }}
              onDeviceLabelChange={setDeviceLabel}
              onPairCodeChange={setPairCode}
              onConnect={() => void connect()}
              onPairDevice={() => void pairDevice()}
            />
          ) : (
            <nav className="segmented-tabs" role="tablist" aria-label={tx(locale, "Popup views", "扩展视图")}>
              <button type="button" role="tab" aria-selected={activeTab === "capture"} className={`tab-trigger${activeTab === "capture" ? " active" : ""}`} onClick={() => setActiveTab("capture")}>
                {tx(locale, "Capture", "收录与标签页")}
              </button>
              <button type="button" role="tab" aria-selected={activeTab === "multitab"} className={`tab-trigger${activeTab === "multitab" ? " active" : ""}`} onClick={() => setActiveTab("multitab")}>
                {tx(locale, "Multi-Tab", "批量收录")}
              </button>
              <button type="button" role="tab" aria-selected={activeTab === "sessions"} className={`tab-trigger${activeTab === "sessions" ? " active" : ""}`} onClick={() => setActiveTab("sessions")}>
                {tx(locale, "Sessions", "会话")}
                {sessions.length > 0 && <em className="tab-badge">{sessions.length}</em>}
              </button>
            </nav>
          )}

          {isDailyReady && activeTab === "capture" && (
            <section className="card capture-card" data-testid="popup-quick-capture">
              <div className="section-heading">
                <strong>{tx(locale, "Quick Capture", "快速收录")}</strong>
                <span>{tx(locale, "Active tab → Inbox", "当前标签页 → 收件箱")}</span>
              </div>
              {activeSavableTab ? (
                <div className="capture-current-row">
                  <span className="row-monogram accent" aria-hidden="true">{hostMonogram(activeSavableTab.url, activeSavableTab.title)}</span>
                  <div className="capture-current">
                    <strong>{activeSavableTab.title || activeSavableTab.url}</strong>
                    <small>{hostLabel(activeSavableTab.url)}</small>
                  </div>
                  <button className="primary compact-btn" type="button" disabled={busy} onClick={() => void saveCurrentTab()}>
                    {tx(locale, "Save to Inbox", "存至收件箱")}
                  </button>
                </div>
              ) : (
                <p className="empty">{tx(locale, "Open an HTTP/HTTPS page to capture it.", "打开一个 HTTP/HTTPS 网页即可快速收录。")}</p>
              )}

              {captureResult && (
                <div className={`capture-review ${captureResult.result}`}>
                  <div className="capture-review-copy">
                    <span>{captureResult.result === "created" ? tx(locale, "Saved to Inbox", "已存入收件箱") : tx(locale, "Duplicate review", "检测到重复书签")}</span>
                    <strong>{captureResult.bookmark.title}</strong>
                    <small>
                      {captureResult.bookmark.categoryName ?? (captureResult.duplicateState === "inbox" ? tx(locale, "Already waiting in Inbox", "已在收件箱待整理") : tx(locale, "Already in Dockmark library", "已在 Dockmark 书签库"))}
                    </small>
                  </div>
                  <button className="secondary compact-btn" type="button" onClick={() => void browser.tabs.create({ url: apiUrl(serverUrl, captureResult.duplicateState === "library" ? "/app" : "/app/inbox"), active: true })}>
                    {captureResult.duplicateState === "library" ? tx(locale, "Open Web", "打开网页端") : tx(locale, "Open Inbox", "打开收件箱")}
                  </button>
                </div>
              )}
            </section>
          )}

          {isDailyReady && activeTab === "multitab" && <ReviewedCapture serverUrl={serverUrl} tabs={savableTabs} locale={locale} />}

          {isDailyReady && activeTab === "sessions" && (
            <SessionsPanel
              locale={locale}
              sessionName={sessionName}
              savableTabCount={savableTabs.length}
              sessions={sessions}
              busy={busy}
              onSessionNameChange={setSessionName}
              onSaveWindow={() => void saveWindow()}
              onRestoreSession={(session) => void restoreSession(session)}
            />
          )}

          {(!isDailyReady || activeTab === "capture") && <OpenTabsPanel tabs={tabs} locale={locale} />}
        </>
      )}

      {(status || error) && (
        <div className={`notice ${error ? "error" : "success"}`} role="status">{error ?? status}</div>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<StrictMode><Popup /></StrictMode>);
