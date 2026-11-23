/**
 * [INPUT]: depends on useState from react; depends on browser from wxt/browser; depends on tx and preference types from ../../lib/ext-locale
 * [OUTPUT]: exports SettingsDrawer component for theme, language, browser shortcut guide, server connection, pairing, and native bookmarks permission
 * [POS]: collapsible settings panel inside apps/extension/entrypoints/popup
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useState } from "react";
import { browser } from "wxt/browser";
import {
  tx,
  type AppearancePreference,
  type LocalePreference,
  type ResolvedLocale,
} from "../../lib/ext-locale";

const SHORTCUTS_URL = "chrome://extensions/shortcuts";

interface SettingsDrawerProps {
  locale: ResolvedLocale;
  localePreference: LocalePreference;
  appearance: AppearancePreference;
  serverUrl: string;
  deviceLabel: string;
  pairCode: string;
  connected: boolean;
  paired: boolean;
  bookmarkAccess: boolean;
  initializing: boolean;
  busy: boolean;
  onServerUrlChange: (value: string) => void;
  onDeviceLabelChange: (value: string) => void;
  onPairCodeChange: (value: string) => void;
  onConnect: () => void;
  onPairDevice: () => void;
  onUnpairLocal: () => void;
  onToggleBookmarkAccess: () => void;
  onSelectAppearance: (value: AppearancePreference) => void;
  onSelectLocale: (value: LocalePreference) => void;
  onClose: () => void;
}

const APPEARANCE_OPTIONS: Array<{ value: AppearancePreference; en: string; zh: string }> = [
  { value: "system", en: "System", zh: "跟随系统" },
  { value: "light", en: "Light", zh: "浅色" },
  { value: "dark", en: "Dark", zh: "深色" },
];

const LOCALE_OPTIONS: Array<{ value: LocalePreference; en: string; zh: string }> = [
  { value: "system", en: "System", zh: "跟随浏览器" },
  { value: "en", en: "English", zh: "English" },
  { value: "zh-CN", en: "简体中文", zh: "简体中文" },
];

export function SettingsDrawer(props: SettingsDrawerProps) {
  const { locale } = props;
  const [shortcutFeedback, setShortcutFeedback] = useState<string | null>(null);

  async function openShortcutsSettings() {
    setShortcutFeedback(null);
    try {
      await browser.tabs.create({ url: SHORTCUTS_URL });
    } catch {
      try {
        await navigator.clipboard.writeText(SHORTCUTS_URL);
        setShortcutFeedback(tx(locale, `Copied ${SHORTCUTS_URL}`, `已复制 ${SHORTCUTS_URL}`));
      } catch {
        setShortcutFeedback(SHORTCUTS_URL);
      }
    }
  }

  return (
    <div className="settings-drawer" data-testid="popup-settings">
      <div className="drawer-header">
        <strong>{tx(locale, "Extension settings", "扩展设置")}</strong>
        <button className="text-button" type="button" onClick={props.onClose}>
          {tx(locale, "Done", "完成")}
        </button>
      </div>

      <section className="card compact-card">
        <div className="pref-group">
          <div className="section-heading">
            <strong>{tx(locale, "Theme", "外观主题")}</strong>
            <span>{tx(locale, "Syncs with Web & New Tab", "与网页及新标签页同步")}</span>
          </div>
          <div className="segmented-control" role="radiogroup" aria-label={tx(locale, "Theme", "外观主题")}>
            {APPEARANCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={props.appearance === option.value}
                className={`segment-btn${props.appearance === option.value ? " active" : ""}`}
                onClick={() => props.onSelectAppearance(option.value)}
              >
                {tx(locale, option.en, option.zh)}
              </button>
            ))}
          </div>
        </div>

        <div className="pref-group">
          <div className="section-heading">
            <strong>{tx(locale, "Language", "界面语言")}</strong>
          </div>
          <div className="segmented-control" role="radiogroup" aria-label={tx(locale, "Language", "界面语言")}>
            {LOCALE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={props.localePreference === option.value}
                className={`segment-btn${props.localePreference === option.value ? " active" : ""}`}
                onClick={() => props.onSelectLocale(option.value)}
              >
                {tx(locale, option.en, option.zh)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card compact-card" data-testid="popup-shortcut-guide">
        <div className="section-heading">
          <strong>{tx(locale, "Shortcuts", "快捷入口")}</strong>
          <span>{tx(locale, "Browser commands", "浏览器指令")}</span>
        </div>
        <div className="shortcut-guide-row">
          <div className="shortcut-badges">
            <span className="shortcut-chip">
              <kbd>Alt+Shift+D</kbd>
              <em>{tx(locale, "Launcher", "启动台")}</em>
            </span>
            <span className="shortcut-chip">
              <kbd>d</kbd>
              <em>{tx(locale, "Omnibox", "地址栏")}</em>
            </span>
          </div>
          <button
            className="secondary compact-btn"
            type="button"
            onClick={() => void openShortcutsSettings()}
          >
            {tx(locale, "Customize", "自定义")}
          </button>
        </div>
        {shortcutFeedback && <p className="muted-copy">{shortcutFeedback}</p>}
      </section>

      <section className="card compact-card">
        <div className="section-heading">
          <strong>{tx(locale, "Dockmark server", "Dockmark 服务器")}</strong>
          <span className={props.connected ? "pill online" : "pill offline"}>
            {props.connected
              ? props.paired
                ? tx(locale, "Paired", "已配对")
                : tx(locale, "Connected", "已连接")
              : props.initializing
                ? tx(locale, "Checking", "检查中")
                : tx(locale, "Local", "仅本地")}
          </span>
        </div>
        <input
          value={props.serverUrl}
          onChange={(event) => props.onServerUrlChange(event.target.value)}
          placeholder="https://dockmark.example.com"
          inputMode="url"
          aria-label={tx(locale, "Dockmark Server URL", "Dockmark 服务器地址")}
        />
        <div className="inline-fields">
          <input
            value={props.deviceLabel}
            onChange={(event) => props.onDeviceLabelChange(event.target.value)}
            placeholder={tx(locale, "Main MacBook", "主力设备")}
            aria-label={tx(locale, "Device Label", "设备名称")}
          />
          <button
            className="secondary"
            type="button"
            disabled={props.initializing || props.busy || !props.serverUrl.trim()}
            onClick={props.onConnect}
          >
            {props.initializing
              ? tx(locale, "Checking…", "检查中…")
              : props.connected
                ? tx(locale, "Reconnect", "重新连接")
                : tx(locale, "Connect", "连接")}
          </button>
        </div>

        {props.connected && (
          <div className="drawer-divider">
            <div className="section-heading">
              <strong>{tx(locale, "Device pairing", "设备配对")}</strong>
              <span className={props.paired ? "pill online" : "pill offline"}>
                {props.paired ? tx(locale, "Active", "已授权") : tx(locale, "Required", "待配对")}
              </span>
            </div>
            {props.paired ? (
              <div className="inline-action-row">
                <p className="muted-copy">
                  {tx(
                    locale,
                    "Revocable token for launcher cache, Inbox capture, and Sessions.",
                    "可随时撤销的设备令牌，用于启动台缓存、收件箱收录与会话保存。",
                  )}
                </p>
                <button className="secondary danger-subtle" type="button" disabled={props.busy} onClick={props.onUnpairLocal}>
                  {tx(locale, "Unpair", "解除配对")}
                </button>
              </div>
            ) : (
              <div className="inline-fields">
                <input
                  value={props.pairCode}
                  onChange={(event) => props.onPairCodeChange(event.target.value.toUpperCase())}
                  placeholder="ABCD-EFGH-JK"
                  autoComplete="off"
                  aria-label={tx(locale, "Pairing Code", "配对码")}
                />
                <button className="primary" type="button" disabled={props.busy || !props.pairCode.trim()} onClick={props.onPairDevice}>
                  {tx(locale, "Pair", "配对")}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card compact-card">
        <div className="section-heading">
          <strong>{tx(locale, "Native bookmarks", "浏览器原生书签")}</strong>
          <span className={props.bookmarkAccess ? "pill online" : "pill offline"}>
            {props.bookmarkAccess ? tx(locale, "Enabled", "已开启") : tx(locale, "Optional", "可选")}
          </span>
        </div>
        <div className="inline-action-row">
          <p className="muted-copy">
            {tx(
              locale,
              "Optional permission for reviewed bookmark import and explicit Web writeback.",
              "可选权限：仅用于审查导入浏览器书签，以及你在网页端显式触发的回写。",
            )}
          </p>
          <button
            className="secondary"
            type="button"
            disabled={props.initializing || props.busy}
            onClick={props.onToggleBookmarkAccess}
          >
            {props.bookmarkAccess ? tx(locale, "Disable", "关闭") : tx(locale, "Enable", "开启")}
          </button>
        </div>
      </section>
    </div>
  );
}
