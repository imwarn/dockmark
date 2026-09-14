import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BRIDGE_PROTOCOL_VERSION,
  getRawBridgeStatus,
  onBridgeEvent,
  type BrowserBridgeStatus,
} from "./browser-bridge";
import {
  CHROME_WEB_STORE_URL,
  EXTENSION_DOWNLOAD_URL,
  EXTENSION_RELEASE_URL,
  EXTENSION_RELEASE_VERSION,
  compareExtensionVersions,
} from "./extension-distribution";
import "./extension.css";

const capabilityLabels: Array<[keyof BrowserBridgeStatus["capabilities"], string]> = [
  ["openTabs", "Open tabs"],
  ["activateTabs", "Switch to existing tabs"],
  ["workspaceReuse", "Workspace reuse"],
  ["workspacePinned", "Pinned workspace tabs"],
  ["sessionRestore", "Session restore"],
  ["sessionPinned", "Pinned session restore"],
  ["nativeBookmarks", "Native bookmarks"],
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
      if (event === "ready" || event === "tabs-changed") void refresh();
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

  const state = useMemo(() => {
    if (checking) return { label: "Checking", tone: "neutral" } as const;
    if (!status) return { label: "Not connected", tone: "warning" } as const;
    if (!protocolCompatible) return { label: "Update required", tone: "danger" } as const;
    if (updateAvailable) return { label: "Update available", tone: "warning" } as const;
    return { label: "Connected", tone: "success" } as const;
  }, [checking, protocolCompatible, status, updateAvailable]);

  return (
    <section className="extension-page">
      <div className="management-heading">
        <div>
          <p className="eyebrow">BROWSER INTEGRATION</p>
          <h1>Dockmark in your browser,<br />without losing Web mode.</h1>
        </div>
        <span className={`extension-state extension-state-${state.tone}`}>{state.label}</span>
      </div>

      <div className="extension-hero-card">
        <div className="extension-hero-copy">
          <span className="extension-version">Chromium · v{EXTENSION_RELEASE_VERSION}</span>
          <h2>{status ? `Extension ${status.extensionVersion} detected` : "Unlock native browser actions"}</h2>
          <p>
            Search and activate open tabs, reuse Workspace tabs, restore pinned Sessions and review native browser bookmarks before importing them into Dockmark.
          </p>
          <div className="extension-actions">
            {webStoreUrl ? (
              <button className="primary" type="button" onClick={() => external(webStoreUrl)}>Add to Chrome</button>
            ) : (
              <button className="primary" type="button" onClick={() => external(EXTENSION_DOWNLOAD_URL)}>
                {updateAvailable || (!protocolCompatible && Boolean(status)) ? "Download latest extension" : "Download Extension"}
              </button>
            )}
            {webStoreUrl ? (
              <button className="secondary" type="button" onClick={() => external(EXTENSION_DOWNLOAD_URL)}>Download Extension</button>
            ) : (
              <button className="secondary" type="button" onClick={() => setGuideOpen((open) => !open)}>Installation Guide</button>
            )}
            <button className="text-action" type="button" disabled={checking} onClick={() => void refresh()}>
              {checking ? "Checking…" : "Refresh diagnostics"}
            </button>
          </div>
          <p className="extension-channel-note">
            Manual download stays available even after the Chrome Web Store release. It works with Chrome, Edge and other Chromium-based browsers that support unpacked extensions.
          </p>
        </div>
        <div className="extension-mark" aria-hidden="true">D·</div>
      </div>

      {(guideOpen || !status) && (
        <article className="extension-guide form-card">
          <div className="card-heading">
            <div><h2>Manual installation</h2><p>Early Access installation from the GitHub Release ZIP.</p></div>
            <a className="text-action" href={EXTENSION_RELEASE_URL} target="_blank" rel="noreferrer">Release page ↗</a>
          </div>
          <ol>
            <li>Download <code>dockmark-chrome-v{EXTENSION_RELEASE_VERSION}.zip</code> and unzip it.</li>
            <li>Open <code>chrome://extensions</code> (or the equivalent extensions page in your Chromium browser).</li>
            <li>Enable <strong>Developer mode</strong>, then choose <strong>Load unpacked</strong>.</li>
            <li>Select the extracted Dockmark extension folder containing <code>manifest.json</code>.</li>
            <li>Open the Dockmark extension popup, set this site as the server, then grant site access when prompted.</li>
          </ol>
        </article>
      )}

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
