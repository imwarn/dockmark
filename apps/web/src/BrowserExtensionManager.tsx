import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BRIDGE_PROTOCOL_VERSION,
  getRawBridgeStatus,
  onBridgeEvent,
  type BrowserBridgeStatus,
} from "./browser-bridge";
import {
  CHROME_NEW_TAB_WEB_STORE_URL,
  CHROME_WEB_STORE_URL,
  EXTENSION_DOWNLOAD_URL,
  EXTENSION_RELEASE_URL,
  EXTENSION_RELEASE_VERSION,
  FIREFOX_EXTENSION_DOWNLOAD_URL,
  NEW_TAB_EXTENSION_DOWNLOAD_URL,
  compareExtensionVersions,
} from "./extension-distribution";
import { BrowserSettingsManager } from "./BrowserSettingsManager";
import "./extension.css";

const capabilityLabels: Array<[keyof BrowserBridgeStatus["capabilities"], string]> = [
  ["openTabs", "Open tabs"],
  ["activateTabs", "Switch to existing tabs"],
  ["workspaceReuse", "Workspace reuse"],
  ["workspacePinned", "Pinned workspace tabs"],
  ["sessionRestore", "Session restore"],
  ["sessionPinned", "Pinned session restore"],
  ["nativeBookmarks", "Native bookmarks"],
  ["nativeBookmarkSync", "Native bookmark mapping sync"],
  ["nativeBookmarkWriteback", "Manual bookmark writeback"],
  ["localHealth", "Local URL health checks"],
];

function external(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function BrowserExtensionManager() {
  const [status, setStatus] = useState<BrowserBridgeStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const webStoreUrl = CHROME_WEB_STORE_URL;
  const newTabWebStoreUrl = CHROME_NEW_TAB_WEB_STORE_URL;

  const refresh = useCallback(async () => {
    setChecking(true);
    setError(null);
    try {
      setStatus(await getRawBridgeStatus());
    } catch (caught) {
      setStatus(null);
      setError(caught instanceof Error ? caught.message : "Dockmark browser extension was not detected.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onBridgeEvent((event) => {
      if (event === "ready" || event === "tabs-changed" || event === "bookmarks-changed" || event === "capabilities-changed") {
        void refresh();
      }
    });
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    void refresh();
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const protocolCompatible = status?.protocolVersion === BRIDGE_PROTOCOL_VERSION;
  const updateAvailable = Boolean(
    status && compareExtensionVersions(status.extensionVersion, EXTENSION_RELEASE_VERSION) < 0,
  );
  const nativeBookmarksGranted = Boolean(status?.permissions?.nativeBookmarks);

  const state = useMemo(() => {
    if (checking) return { label: "Checking", tone: "neutral" } as const;
    if (!status) return { label: "Not connected", tone: "warning" } as const;
    if (!protocolCompatible) return { label: "Update required", tone: "danger" } as const;
    if (updateAvailable) return { label: "Update available", tone: "warning" } as const;
    if (!nativeBookmarksGranted) return { label: "Connected · bookmarks off", tone: "warning" } as const;
    return { label: "Connected", tone: "success" } as const;
  }, [checking, nativeBookmarksGranted, protocolCompatible, status, updateAvailable]);

  return (
    <section className="extension-page">
      <div className="management-heading">
        <div>
          <p className="eyebrow">BROWSER INTEGRATION</p>
          <h1>Choose the Dockmark<br />browser profile you want.</h1>
        </div>
        <span className={`extension-state extension-state-${state.tone}`}>{state.label}</span>
      </div>

      <div className="extension-hero-card">
        <div className="extension-hero-copy">
          <span className="extension-version">Chromium + Firefox · v{EXTENSION_RELEASE_VERSION}</span>
          <h2>{status ? `Extension ${status.extensionVersion} detected` : "One Browser Bridge, explicit browser profiles"}</h2>
          <p>
            Chromium keeps the Standard and local-first New Tab profiles. Firefox joins v1.0 with a Standard MV3 preview using the same reviewed Browser Bridge, native-bookmark permission model and local-health safety boundaries.
          </p>
          {status && protocolCompatible && !nativeBookmarksGranted && (
            <div className="extension-permission-callout">
              <strong>Native bookmarks are not enabled.</strong>
              <span>Open the Dockmark extension popup and choose <b>Enable bookmark access</b>. This permission is used for reviewed import/sync and explicit manual writeback; Dockmark never writes browser bookmarks in the background.</span>
            </div>
          )}
          <div className="extension-actions">
            <button className="secondary" type="button" onClick={() => setGuideOpen((open) => !open)}>Installation Guide</button>
            <button className="text-action" type="button" disabled={checking} onClick={() => void refresh()}>
              {checking ? "Checking…" : "Refresh diagnostics"}
            </button>
          </div>
        </div>
        <div className="extension-mark" aria-hidden="true">D·</div>
      </div>

      <section className="extension-profiles" aria-label="Dockmark browser profiles">
        <article className="extension-profile extension-profile-recommended">
          <div className="extension-profile-heading">
            <div>
              <span className="extension-profile-kicker">CHROMIUM · RECOMMENDED</span>
              <h2>Dockmark New Tab</h2>
            </div>
            <span className="extension-profile-badge">LOCAL FIRST</span>
          </div>
          <p>Make every new tab an instant local Dockmark launcher. Cached bookmarks, Workspaces, search engines and open tabs appear before the network is needed; cloud data refreshes quietly in the background.</p>
          <ul>
            <li>Fast extension-local startup — no redirect to your Workers URL.</li>
            <li>Last-known-good cache keeps search and launch available offline.</li>
            <li>Same Bridge, Sessions and bookmark sync/writeback features as Standard.</li>
          </ul>
          <div className="extension-actions">
            {newTabWebStoreUrl && <button className="primary" type="button" onClick={() => external(newTabWebStoreUrl)}>Add Dockmark New Tab</button>}
            <button className={newTabWebStoreUrl ? "secondary" : "primary"} type="button" onClick={() => external(NEW_TAB_EXTENSION_DOWNLOAD_URL)}>
              {updateAvailable ? `Download New Tab v${EXTENSION_RELEASE_VERSION}` : "Download New Tab"}
            </button>
          </div>
        </article>

        <article className="extension-profile">
          <div className="extension-profile-heading">
            <div>
              <span className="extension-profile-kicker">CHROMIUM · STANDARD</span>
              <h2>Dockmark Extension</h2>
            </div>
            <span className="extension-profile-badge">NEW TAB UNCHANGED</span>
          </div>
          <p>Keep your browser's existing New Tab page while adding Dockmark's Browser Bridge and reviewed bookmark integration.</p>
          <ul>
            <li>Never declares a browser New Tab override.</li>
            <li>Open tabs, Workspace reuse, Sessions and native bookmark mapping.</li>
            <li>Manual Dockmark → Browser title/URL writeback only when you choose it.</li>
          </ul>
          <div className="extension-actions">
            {webStoreUrl && <button className="primary" type="button" onClick={() => external(webStoreUrl)}>Add Standard Extension</button>}
            <button className={webStoreUrl ? "secondary" : "primary"} type="button" onClick={() => external(EXTENSION_DOWNLOAD_URL)}>
              {updateAvailable || (!protocolCompatible && Boolean(status)) ? `Download Standard v${EXTENSION_RELEASE_VERSION}` : "Download Standard"}
            </button>
          </div>
        </article>

        <article className="extension-profile extension-profile-firefox">
          <div className="extension-profile-heading">
            <div>
              <span className="extension-profile-kicker">FIREFOX · PREVIEW</span>
              <h2>Dockmark Extension for Firefox</h2>
            </div>
            <span className="extension-profile-badge">MV3 STANDARD</span>
          </div>
          <p>The Firefox package intentionally starts with the Standard profile. It targets Manifest V3 so Dockmark can keep the same dynamic, explicitly authorized bridge registration model instead of falling back to a broader MV2 permission surface.</p>
          <ul>
            <li>Same open-tab, Workspace, Session and reviewed native-bookmark capabilities.</li>
            <li>Bookmark access stays optional; local/private health access stays per-host and explicit.</li>
            <li>No New Tab override yet — Firefox New Tab parity waits for real-browser validation.</li>
          </ul>
          <div className="extension-actions">
            <button className="primary" type="button" onClick={() => external(FIREFOX_EXTENSION_DOWNLOAD_URL)}>
              Download Firefox v{EXTENSION_RELEASE_VERSION}
            </button>
          </div>
        </article>
      </section>

      <p className="extension-profile-note">
        Install <strong>one Chromium profile only</strong>. For an existing unpacked Chromium installation, replace the files in the same extension folder and click <strong>Reload</strong> in <code>chrome://extensions</code>; keeping the same folder preserves the extension ID, mappings and New Tab cache. The Firefox GitHub ZIP is an unsigned validation build and is intended for temporary loading through <code>about:debugging</code> until signed distribution is configured.
      </p>

      {(guideOpen || !status) && (
        <article className="extension-guide form-card">
          <div className="card-heading">
            <div><h2>Manual installation</h2><p>Release ZIP installation for Chromium and Firefox validation.</p></div>
            <a className="text-action" href={EXTENSION_RELEASE_URL} target="_blank" rel="noreferrer">Release page ↗</a>
          </div>
          <div className="extension-guide-columns">
            <div>
              <h3>Chromium</h3>
              <ol>
                <li>Choose either <code>dockmark-newtab-chrome-v{EXTENSION_RELEASE_VERSION}.zip</code> or <code>dockmark-chrome-v{EXTENSION_RELEASE_VERSION}.zip</code>, then unzip it.</li>
                <li>Open <code>chrome://extensions</code> (or the equivalent extensions page in your Chromium browser).</li>
                <li>Enable <strong>Developer mode</strong>, choose <strong>Load unpacked</strong>, then select the folder containing <code>manifest.json</code>.</li>
                <li>Open the Dockmark popup, set this site as the server, grant site access, then separately enable bookmark access if you need reviewed browser bookmark sync/writeback.</li>
              </ol>
            </div>
            <div>
              <h3>Firefox preview</h3>
              <ol>
                <li>Download <code>dockmark-firefox-v{EXTENSION_RELEASE_VERSION}.zip</code> and unzip it.</li>
                <li>Open <code>about:debugging#/runtime/this-firefox</code> and choose <strong>Load Temporary Add-on…</strong>.</li>
                <li>Select the extracted <code>manifest.json</code>. The temporary add-on is removed when Firefox restarts.</li>
                <li>Configure the Dockmark origin in the popup, approve only that site, then test bookmark access and local-health host permission separately.</li>
              </ol>
            </div>
          </div>
        </article>
      )}

      <BrowserSettingsManager />

      <div className="extension-diagnostics-grid">
        <article className="form-card extension-diagnostic-card">
          <div className="card-heading"><div><h2>Connection</h2><p>Live handshake between this Dockmark origin and the browser extension.</p></div></div>
          <dl className="diagnostic-list">
            <div><dt>Current Dockmark origin</dt><dd>{window.location.origin}</dd></div>
            <div><dt>Extension</dt><dd>{status ? `v${status.extensionVersion}` : "Not detected"}</dd></div>
            <div><dt>Bridge protocol</dt><dd>{status ? `${status.protocolVersion} / Web ${BRIDGE_PROTOCOL_VERSION}` : `Web ${BRIDGE_PROTOCOL_VERSION}`}</dd></div>
            <div><dt>Compatibility</dt><dd>{status ? protocolCompatible ? "Compatible" : "Update required" : "Waiting for extension"}</dd></div>
            <div><dt>Native bookmark permission</dt><dd>{status?.permissions?.nativeBookmarks ? "Granted" : status ? "Not granted" : "Unavailable"}</dd></div>
          </dl>
          {error && <p className="extension-diagnostic-note">{error}</p>}
        </article>

        <article className="form-card extension-diagnostic-card">
          <div className="card-heading"><div><h2>Capabilities</h2><p>Capabilities are reported by the connected extension, not assumed by the Web app.</p></div></div>
          <div className="capability-list">
            {capabilityLabels.map(([key, label]) => {
              const enabled = Boolean(status?.capabilities[key]);
              return <div key={key}><span>{label}</span><strong className={enabled ? "capability-on" : "capability-off"}>{enabled ? "Available" : status ? "Not available" : "—"}</strong></div>;
            })}
          </div>
        </article>
      </div>
    </section>
  );
}
