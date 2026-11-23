/**
 * [INPUT]: depends on DEFAULT_BROWSER_SETTINGS, normalizeBrowserSettings, BrowserSettings, SearchEngine from @dockmark/core; useI18n from ./i18n; and ./settings.css
 * [OUTPUT]: exports BrowserSettingsManager panel for local-first and cloud-synced New Tab and bookmark conflict policies
 * [POS]: Shared between SettingsPage (/app/settings/browser) and BrowserExtensionManager (/app/extension). Persists settings to localStorage and PATCH /api/settings/browser.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_BROWSER_SETTINGS,
  normalizeBrowserSettings,
  type BrowserSettings,
  type SearchEngine,
} from "@dockmark/core";
import { useI18n } from "./i18n";
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

function dateLabel(value: string | null, locale: string, tx: (en: string, zh: string) => string) {
  if (!value) return tx("Not synced yet", "尚未同步");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tx("Synced", "已同步");
  const formatted = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  return tx(`Cloud synced ${formatted}`, `云端同步于 ${formatted}`);
}

export function BrowserSettingsManager() {
  const { locale, tx } = useI18n();
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
        const reason = error instanceof Error ? error.message : tx("Could not load cloud settings.", "无法加载云端配置。");
        setMessage(tx(`${reason} Using local settings.`, `${reason} 当前使用本地配置。`));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tx]);

  const orderedEngines = useMemo(
    () => [...engines].sort((a, b) => a.position - b.position),
    [engines],
  );

  function update(next: BrowserSettings) {
    setSettings(next);
    writeLocalSettings(next);
    setDirty(true);
    setMessage(tx("Saved locally. Sync to cloud to share this policy with Dockmark New Tab.", "已在本地保存，点击同步后将推送到云端及 Dockmark New Tab。"));
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
      setMessage(tx("Settings synced. New Tab will pick them up on its next refresh.", "设置已同步，新标签页将在下次刷新时生效。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tx("Could not save settings.", "保存设置失败。"));
    } finally {
      setSaving(false);
    }
  }

  function resetLocal() {
    const defaults = normalizeBrowserSettings(DEFAULT_BROWSER_SETTINGS);
    update(defaults);
    setMessage(tx("Defaults restored locally. Sync to cloud to make them authoritative.", "已在本地恢复默认设置，点击同步以覆盖云端配置。"));
  }

  return (
    <section className="browser-settings-section" aria-labelledby="browser-settings-title">
      <div className="settings-heading">
        <div>
          <h2 id="browser-settings-title">{tx("Browser & New Tab", "浏览器与新标签页")}</h2>
          <p>
            {tx(
              "Changes apply locally right away. Sync to D1 so Dockmark New Tab and other browsers share the same defaults.",
              "修改会立即保存在本地；同步到 D1 后，Dockmark 新标签页与其他浏览器将共享同一策略。",
            )}
          </p>
        </div>
        <div className="settings-sync-state">
          <strong>{dirty ? tx("Local changes", "有未同步修改") : tx("In sync", "已同步")}</strong>
          <span>{loading ? tx("Loading cloud settings…", "正在加载云端配置…") : dateLabel(settings.updatedAt, locale, tx)}</span>
        </div>
      </div>

      <div className="settings-grid">
        <article className="form-card settings-card">
          <div className="card-heading">
            <div>
              <h3>{tx("Bookmark conflict preference", "书签冲突处理偏好")}</h3>
              <p>
                {tx(
                  "Guides reviewed conflict resolution. Prefer Browser / Prefer Dockmark highlights the matching action and enables confirmed one-sided batch apply.",
                  "用于引导书签同步审查。「优先浏览器 / 优先 Dockmark」会高亮推荐动作，并在你明确确认后支持单边变更批量应用。",
                )}
              </p>
            </div>
          </div>
          <div className="settings-segmented" role="group" aria-label={tx("Bookmark conflict preference", "书签冲突处理偏好")}>
            {([
              ["ask", tx("Ask every time", "每次询问")],
              ["browser", tx("Prefer Browser", "优先浏览器")],
              ["dockmark", tx("Prefer Dockmark", "优先 Dockmark")],
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
          <p className="settings-footnote">
            {tx(
              "Never enables background bookmark writes. Two-sided conflicts always require an individual decision.",
              "该偏好不会开启后台自动写入；双边冲突始终需要逐项确认。",
            )}
          </p>
        </article>

        <article className="form-card settings-card">
          <div className="card-heading">
            <div>
              <h3>{tx("New Tab search", "新标签页默认搜索")}</h3>
              <p>{tx("Engine used by the local launcher when no bang shortcut is entered.", "未输入快捷搜索词（如 !g）时，新标签页启动台使用的默认引擎。")}</p>
            </div>
          </div>
          <label className="settings-field">
            <span>{tx("Default search engine", "默认搜索引擎")}</span>
            <select
              value={settings.newTab.defaultSearchEngineId ?? ""}
              onChange={(event) => patchNewTab("defaultSearchEngineId", event.target.value || null)}
            >
              <option value="">{tx("Follow Dockmark default", "跟随 Dockmark 默认引擎")}</option>
              {orderedEngines.map((engine) => (
                <option key={engine.id} value={engine.id}>
                  {engine.name}
                  {engine.isDefault ? tx(" · default", " · 默认") : ""}
                </option>
              ))}
            </select>
          </label>
        </article>

        <article className="form-card settings-card settings-card-wide">
          <div className="card-heading">
            <div>
              <h3>{tx("Local launcher", "本地启动台")}</h3>
              <p>{tx("Control what Dockmark New Tab displays from its cached local snapshot.", "配置 Dockmark 新标签页从本地快照渲染的内容与数量。")}</p>
            </div>
          </div>
          <div className="settings-options-grid">
            <label className="settings-toggle">
              <span>
                <strong>{tx("Show open tabs", "显示打开的标签页")}</strong>
                <small>{tx("Include live browser tabs in command search.", "在命令搜索中包含当前已打开的标签页。")}</small>
              </span>
              <input
                type="checkbox"
                checked={settings.newTab.showOpenTabs}
                onChange={(event) => patchNewTab("showOpenTabs", event.target.checked)}
              />
            </label>
            <label className="settings-toggle">
              <span>
                <strong>{tx("Background refresh", "静默后台刷新")}</strong>
                <small>{tx("Refresh cloud data quietly whenever a New Tab opens online.", "在线打开新标签页时在后台自动更新云端快照。")}</small>
              </span>
              <input
                type="checkbox"
                checked={settings.newTab.autoRefresh}
                onChange={(event) => patchNewTab("autoRefresh", event.target.checked)}
              />
            </label>
            <label className="settings-field">
              <span>{tx("Bookmark cards", "书签卡片数量")}</span>
              <input
                type="number"
                min="0"
                max="24"
                value={settings.newTab.bookmarkLimit}
                onChange={(event) => patchNewTab("bookmarkLimit", Math.min(24, Math.max(0, Number(event.target.value) || 0)))}
              />
            </label>
            <label className="settings-field">
              <span>{tx("Workspace cards", "工作区卡片数量")}</span>
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
          <p className="settings-footnote">
            {tx(
              "Cache status, manual refresh and cache clearing stay inside the local New Tab page so they work even offline.",
              "本地快照状态、手动刷新与清除缓存位于新标签页内部，离线时也可正常操作。",
            )}
          </p>
        </div>
        <div className="extension-actions">
          <button className="secondary" type="button" onClick={resetLocal} disabled={saving}>
            {tx("Reset defaults", "恢复默认")}
          </button>
          <button className="primary" type="button" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? tx("Syncing…", "同步中…") : tx("Sync settings", "同步设置")}
          </button>
        </div>
      </div>
    </section>
  );
}
