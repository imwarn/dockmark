/**
 * [INPUT]: depends on AppearancePreference and LocalePreference from @dockmark/core; theme helpers from ./theme; locale helpers and useI18n from ./i18n
 * [OUTPUT]: exports AppearanceSettings panel for switching and cloud-syncing Theme (System/Light/Dark) and Language (System/English/简体中文)
 * [POS]: Default tab in SettingsPage (/app/settings/appearance). Applies theme and locale locally before syncing to D1 via PATCH /api/settings/appearance.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useEffect, useState } from "react";
import type { AppearancePreference, LocalePreference } from "@dockmark/core";
import {
  applyLocalePreference,
  saveAppearanceAndLocale,
  useI18n,
} from "./i18n";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  fetchAppearanceSettings,
  localAppearance,
} from "./theme";

export function AppearanceSettings() {
  const { localePreference, tx } = useI18n();
  const [preference, setPreference] = useState<AppearancePreference>(() => localAppearance());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onAppearance = (event: Event) => {
      const detail = (event as CustomEvent<{ preference?: AppearancePreference }>).detail;
      setPreference(detail?.preference ?? localAppearance());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) setPreference(localAppearance());
    };
    window.addEventListener("dockmark:appearance", onAppearance);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("dockmark:appearance", onAppearance);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAppearanceSettings()
      .then((settings) => {
        if (cancelled) return;
        setPreference(settings.preference);
        applyAppearance(settings.preference);
        applyLocalePreference(settings.locale);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : tx("Could not load appearance settings.", "无法加载外观与语言设置。"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tx]);

  async function chooseTheme(next: AppearancePreference) {
    const previous = preference;
    setPreference(next);
    setMessage(null);
    setError(null);
    applyAppearance(next);
    setSaving(true);
    try {
      const settings = await saveAppearanceAndLocale({ preference: next });
      setPreference(settings.preference);
      applyAppearance(settings.preference);
      setMessage(tx("Theme synced.", "主题偏好已同步。"));
    } catch (caught) {
      setPreference(previous);
      applyAppearance(previous);
      setError(caught instanceof Error ? caught.message : tx("Could not save appearance settings.", "无法保存主题设置。"));
    } finally {
      setSaving(false);
    }
  }

  async function chooseLocale(next: LocalePreference) {
    const previous = localePreference;
    setMessage(null);
    setError(null);
    applyLocalePreference(next);
    setSaving(true);
    try {
      const settings = await saveAppearanceAndLocale({ locale: next });
      applyLocalePreference(settings.locale);
      setMessage(
        settings.locale === "zh-CN"
          ? "语言偏好已同步。"
          : settings.locale === "en"
            ? "Language synced."
            : tx("Language synced.", "语言偏好已同步。"),
      );
    } catch (caught) {
      applyLocalePreference(previous);
      setError(caught instanceof Error ? caught.message : tx("Could not save language setting.", "无法保存语言设置。"));
    } finally {
      setSaving(false);
    }
  }

  const themeOptions: Array<{ value: AppearancePreference; label: string; detail: string }> = [
    {
      value: "system",
      label: tx("System", "跟随系统"),
      detail: tx("Match your browser or OS color scheme.", "自动跟随系统或浏览器外观设置。"),
    },
    {
      value: "light",
      label: tx("Light", "浅色"),
      detail: tx("Clean sage-tinted light surfaces.", "清爽柔和的浅色界面。"),
    },
    {
      value: "dark",
      label: tx("Dark", "深色"),
      detail: tx("Deep #0a0f0c Dockmark dark theme.", "深邃的 #0a0f0c 暗色主题。"),
    },
  ];

  const localeOptions: Array<{ value: LocalePreference; badge: string; label: string; detail: string }> = [
    {
      value: "system",
      badge: "AUTO",
      label: tx("System", "跟随浏览器"),
      detail: tx("Follow browser language automatically.", "自动匹配当前浏览器语言设置。"),
    },
    {
      value: "en",
      badge: "EN",
      label: "English",
      detail: tx("Always use English for the workspace and AI suggestions.", "工作台与 AI 整理建议始终使用英文。"),
    },
    {
      value: "zh-CN",
      badge: "中文",
      label: "简体中文",
      detail: tx("Always use Simplified Chinese across the workspace and AI suggestions.", "工作台与 AI 整理建议始终使用简体中文。"),
    },
  ];

  return (
    <section className="browser-settings-section appearance-settings-section">
      <div className="settings-heading">
        <div>
          <h2>{tx("Appearance & Language", "外观与语言")}</h2>
          <p>
            {tx(
              "Applied locally before first paint, then synced through D1 across your workspace and extension.",
              "在首屏渲染前即刻生效，并通过 D1 在工作台与浏览器扩展之间同步。",
            )}
          </p>
        </div>
        <div className="settings-sync-state">
          <strong>{saving ? tx("Syncing…", "同步中…") : loading ? tx("Loading…", "加载中…") : tx("Local-first", "本地优先")}</strong>
          <span>{message ?? tx("Theme & locale synced", "主题与语言自动同步")}</span>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="appearance-group">
        <div className="appearance-group-head">
          <h3>{tx("Theme", "主题模式")}</h3>
          <span>{tx("System / Light / Dark", "跟随系统 / 浅色 / 深色")}</span>
        </div>
        <div className="settings-grid appearance-grid" role="radiogroup" aria-label={tx("Dockmark theme", "Dockmark 主题模式")}>
          {themeOptions.map((option) => (
            <button
              className={`form-card appearance-option${preference === option.value ? " active" : ""}`}
              type="button"
              role="radio"
              aria-checked={preference === option.value}
              disabled={saving}
              key={option.value}
              onClick={() => void chooseTheme(option.value)}
            >
              <span className={`appearance-preview appearance-preview-${option.value}`} aria-hidden="true">
                <span className="appearance-preview-bar" />
                <span className="appearance-preview-card" />
                <span className="appearance-preview-dot" />
              </span>
              <span className="appearance-option-copy">
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
              <span className="appearance-check" aria-hidden="true">{preference === option.value ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="appearance-group">
        <div className="appearance-group-head">
          <h3>{tx("Language", "界面语言")}</h3>
          <span>{tx("System / English / 简体中文", "跟随浏览器 / English / 简体中文")}</span>
        </div>
        <div className="settings-grid appearance-grid" role="radiogroup" aria-label={tx("Dockmark language", "Dockmark 界面语言")}>
          {localeOptions.map((option) => (
            <button
              className={`form-card appearance-option locale-option${localePreference === option.value ? " active" : ""}`}
              type="button"
              role="radio"
              aria-checked={localePreference === option.value}
              disabled={saving}
              key={option.value}
              onClick={() => void chooseLocale(option.value)}
            >
              <span className="locale-preview-badge" aria-hidden="true">{option.badge}</span>
              <span className="appearance-option-copy">
                <strong>{option.label}</strong>
                <small>{option.detail}</small>
              </span>
              <span className="appearance-check" aria-hidden="true">{localePreference === option.value ? "✓" : ""}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
