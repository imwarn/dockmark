import { useEffect, useState } from "react";
import type { AppearancePreference } from "@dockmark/core";
import {
  applyAppearance,
  fetchAppearanceSettings,
  localAppearance,
  saveAppearanceSettings,
} from "./theme";

const options: Array<{ value: AppearancePreference; label: string; detail: string }> = [
  { value: "system", label: "System", detail: "Follow the browser or operating system preference." },
  { value: "light", label: "Light", detail: "Use Dockmark's light palette everywhere." },
  { value: "dark", label: "Dark", detail: "Keep the #0a0f0c Dockmark dark palette." },
];

export function AppearanceSettings() {
  const [preference, setPreference] = useState<AppearancePreference>(() => localAppearance());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAppearanceSettings()
      .then((settings) => {
        if (cancelled) return;
        setPreference(settings.preference);
        applyAppearance(settings.preference);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load appearance settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function choose(next: AppearancePreference) {
    const previous = preference;
    setPreference(next);
    setMessage(null);
    setError(null);
    applyAppearance(next);
    setSaving(true);
    try {
      const settings = await saveAppearanceSettings(next);
      setPreference(settings.preference);
      applyAppearance(settings.preference);
      setMessage("Appearance synced.");
    } catch (caught) {
      setPreference(previous);
      applyAppearance(previous);
      setError(caught instanceof Error ? caught.message : "Could not save appearance settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="browser-settings-section appearance-settings-section">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">APPEARANCE</p>
          <h2>One Dockmark, three modes.</h2>
          <p>The choice is applied locally before first paint, then synchronized through D1 for the private workspace and curated public page.</p>
        </div>
        <div className="settings-sync-state">
          <strong>{saving ? "Syncing…" : loading ? "Loading…" : "Local-first"}</strong>
          <span>{message ?? "System / Light / Dark"}</span>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <div className="settings-grid appearance-grid" role="radiogroup" aria-label="Dockmark appearance">
        {options.map((option) => (
          <button
            className={`form-card appearance-option${preference === option.value ? " active" : ""}`}
            type="button"
            role="radio"
            aria-checked={preference === option.value}
            disabled={saving}
            key={option.value}
            onClick={() => void choose(option.value)}
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
    </section>
  );
}
