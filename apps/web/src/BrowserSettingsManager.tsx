import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_BROWSER_SETTINGS,
  normalizeBrowserSettings,
  type BrowserSettings,
  type SearchEngine,
} from "@dockmark/core";
import "./settings.css";

const LOCAL_SETTINGS_KEY = "dockmarkBrowserSettingsV1";

function readLocalSettings() {
  try {
    const raw = window.localStorage.getItem(LOCAL_SETTINGS_KEY);
    return raw ? normalizeBrowserSettings(JSON.parse(raw)) : normalizeBrowserSettings(DEFAULT_BROWSER_SETTINGS);
  } catch {
    return normalizeBrowserSettings(DEFAULT_BROWSER_SETTINGS);
  }
}

function writeLocalSettings(settings: BrowserSettings) {
  window.localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
}

async function fetchCloudSettings() {
  const response = await fetch("/api/settings/browser", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Settings request failed with ${response.status}.`);
  const payload = await response.json() as { settings?: unknown };
  return normalizeBrowserSettings(payload.settings);
}

async function fetchSearchEngines() {
  const response = await fetch("/api/search-engines", {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) return [] as SearchEngine[];
  const payload = await response.json() as { engines?: SearchEngine[] };
  return Array.isArray(payload.engines) ? payload.engines : [];
}

async function saveCloudSettings(settings: BrowserSettings) {
  const response = await fetch("/api/settings/browser", {
    method: "PATCH",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      conflictPreference: settings.conflictPreference,
      newTab: settings.newTab,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `Settings save failed with ${response.status}.`);
  }
  const payload = await response.json() as { settings?: unknown };
  return normalizeBrowserSettings(payload.settings);
}

function dateLabel(value: string | null) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Synced" : `Cloud synced ${date.toLocaleString()}`;
}

export function BrowserSettingsManager() {
  const [settings, setSettings] = useState<BrowserSettings>(() => readLocalSettings());
  const [engines, setEngines] = useState<SearchEngine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchCloudSettings(), fetchSearchEngines()])
      .then(([cloud, nextEngines]) => {
        if (cancelled) return;
        setSettings(cloud);
        setEngines(nextEngines);
        writeLocalSettings(cloud);
        setDirty(false);
        setMessage(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setMessage(`${error instanceof Error ? error.message : "Could not load cloud settings."} Using local settings.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const orderedEngines = useMemo(
    () => [...engines].sort((a, b) => a.position - b.position),
    [engines],
  );

  function update(next: BrowserSettings) {
    setSettings(next);
    writeLocalSettings(next);
    setDirty(true);
    setMessage("Saved locally. Sync to cloud to share this policy with Dockmark New Tab.");
  }

  function patchNewTab<K extends keyof BrowserSettings["newTab"]>(
    key: K,
    value: BrowserSettings["newTab"][K],
  ) {
    update({
      ...settings,
      newTab: {
        ...settings.newTab,
        [key]: value,
      },
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveCloudSettings(settings);
      setSettings(saved);
      writeLocalSettings(saved);
      setDirty(false);
      setMessage("Settings synced. New Tab will pick them up on its next refresh.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  function resetLocal() {
    const defaults = normalizeBrowserSettings(DEFAULT_BROWSER_SETTINGS);
    update(defaults);
    setMessage("Defaults restored locally. Sync to cloud to make them authoritative.");
  }

  return (
    <section className="browser-settings-section" aria-labelledby="browser-settings-title">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">BROWSER / NEW TAB SETTINGS</p>
          <h2 id="browser-settings-title">Local first, cloud synced.</h2>
          <p>Changes are written to this browser immediately. Sync them to D1 so the New Tab profile and future devices use the same policy.</p>
        </div>
        <div className="settings-sync-state">
          <strong>{dirty ? "Local changes" : "In sync"}</strong>
          <span>{loading ? "Loading cloud settings…" : dateLabel(settings.updatedAt)}</span>
        </div>
      </div>

      <div className="settings-grid">
        <article className="form-card settings-card">
          <div className="card-heading">
            <div>
              <h3>Bookmark conflict preference</h3>
              <p>This remains a reviewed action in the current release; the preference is the policy foundation for later automatic sync.</p>
            </div>
          </div>
          <div className="settings-segmented" role="group" aria-label="Bookmark conflict preference">
            {([
              ["ask", "Ask every time"],
              ["browser", "Prefer Browser"],
              ["dockmark", "Prefer Dockmark"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                className={settings.conflictPreference === value ? "active" : ""}
                type="button"
                onClick={() => update({ ...settings, conflictPreference: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings-footnote">No browser or Dockmark bookmark is changed automatically by this setting yet.</p>
        </article>

        <article className="form-card settings-card">
          <div className="card-heading">
            <div>
              <h3>New Tab search</h3>
              <p>Choose the engine used by the local launcher when no bang/keyword is entered.</p>
            </div>
          </div>
          <label className="settings-field">
            <span>Default search engine</span>
            <select
              value={settings.newTab.defaultSearchEngineId ?? ""}
              onChange={(event) => patchNewTab("defaultSearchEngineId", event.target.value || null)}
            >
              <option value="">Follow Dockmark default</option>
              {orderedEngines.map((engine) => (
                <option key={engine.id} value={engine.id}>{engine.name}{engine.isDefault ? " · default" : ""}</option>
              ))}
            </select>
          </label>
        </article>

        <article className="form-card settings-card settings-card-wide">
          <div className="card-heading">
            <div>
              <h3>Local launcher</h3>
              <p>Tune what Dockmark New Tab renders from its last-known-good local snapshot.</p>
            </div>
          </div>
          <div className="settings-options-grid">
            <label className="settings-toggle">
              <span><strong>Show open tabs</strong><small>Include live browser tabs in command search.</small></span>
              <input
                type="checkbox"
                checked={settings.newTab.showOpenTabs}
                onChange={(event) => patchNewTab("showOpenTabs", event.target.checked)}
              />
            </label>
            <label className="settings-toggle">
              <span><strong>Background refresh</strong><small>Refresh cloud data quietly whenever a New Tab opens online.</small></span>
              <input
                type="checkbox"
                checked={settings.newTab.autoRefresh}
                onChange={(event) => patchNewTab("autoRefresh", event.target.checked)}
              />
            </label>
            <label className="settings-field">
              <span>Bookmark cards</span>
              <input
                type="number"
                min="0"
                max="24"
                value={settings.newTab.bookmarkLimit}
                onChange={(event) => patchNewTab("bookmarkLimit", Math.min(24, Math.max(0, Number(event.target.value) || 0)))}
              />
            </label>
            <label className="settings-field">
              <span>Workspace cards</span>
              <input
                type="number"
                min="0"
                max="12"
                value={settings.newTab.workspaceLimit}
                onChange={(event) => patchNewTab("workspaceLimit", Math.min(12, Math.max(0, Number(event.target.value) || 0)))}
              />
            </label>
          </div>
        </article>
      </div>

      <div className="settings-actions-row">
        <div>
          {message && <p className="settings-message">{message}</p>}
          <p className="settings-footnote">New Tab cache status, manual refresh and cache clearing are available directly in the local launcher so they still work when the Dockmark server is offline.</p>
        </div>
        <div className="extension-actions">
          <button className="secondary" type="button" onClick={resetLocal} disabled={saving}>Reset defaults</button>
          <button className="primary" type="button" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? "Syncing…" : "Sync settings"}
          </button>
        </div>
      </div>
    </section>
  );
}
