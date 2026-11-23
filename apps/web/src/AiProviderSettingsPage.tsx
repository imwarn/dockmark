/**
 * [INPUT]: depends on DEFAULT_AI_SETTINGS and AiSettings from @dockmark/core; fetchAiSettings, saveCloudAiSettings, getAiProviderStatus, MIN_AI_TIMEOUT_SECONDS, MAX_AI_TIMEOUT_SECONDS from ./ai-organization; useI18n from ./i18n
 * [OUTPUT]: exports AiProviderSettingsPage component for /app/settings/ai configuration and Worker secret diagnostics
 * [POS]: Mounted by SettingsPage under /app/settings/ai. Manages D1-synced non-secret AI endpoint/model/timeout settings and DOCKMARK_AI_API_KEY readiness checks.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@dockmark/core";
import {
  fetchAiSettings,
  getAiProviderStatus,
  MAX_AI_TIMEOUT_SECONDS,
  MIN_AI_TIMEOUT_SECONDS,
  saveCloudAiSettings,
} from "./ai-organization";
import { useI18n } from "./i18n";

interface ProviderPreset {
  id: string;
  labelEn: string;
  labelZh: string;
  endpoint: string;
  defaultModel: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    labelEn: "OpenAI",
    labelZh: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "deepseek",
    labelEn: "DeepSeek",
    labelZh: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    defaultModel: "deepseek-chat",
  },
  {
    id: "openrouter",
    labelEn: "OpenRouter",
    labelZh: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
  },
  {
    id: "siliconflow",
    labelEn: "SiliconFlow",
    labelZh: "SiliconFlow 硅基流动",
    endpoint: "https://api.siliconflow.cn/v1/chat/completions",
    defaultModel: "Qwen/Qwen2.5-72B-Instruct",
  },
  {
    id: "gemini",
    labelEn: "Gemini",
    labelZh: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    defaultModel: "gemini-2.5-flash",
  },
  {
    id: "groq",
    labelEn: "Groq",
    labelZh: "Groq",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "llama-3.3-70b-versatile",
  },
];

const WRANGLER_SECRET_COMMAND = "npx wrangler secret put DOCKMARK_AI_API_KEY";

function navigateApp(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function formatSyncTime(value: string | null, locale: string, tx: (en: string, zh: string) => string) {
  if (!value) return tx("Not saved to cloud yet", "尚未保存到云端");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tx("Synced", "已同步");
  const formatted = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
  return tx(`Synced ${formatted}`, `同步于 ${formatted}`);
}

export function AiProviderSettingsPage() {
  const { locale, tx } = useI18n();
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [endpoint, setEndpoint] = useState(DEFAULT_AI_SETTINGS.endpoint);
  const [model, setModel] = useState(DEFAULT_AI_SETTINGS.model);
  const [timeoutSeconds, setTimeoutSeconds] = useState(DEFAULT_AI_SETTINGS.timeoutSeconds);
  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingKey, setCheckingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cloudSettings, status] = await Promise.all([
        fetchAiSettings(),
        getAiProviderStatus().catch(() => null),
      ]);
      setSettings(cloudSettings);
      setEndpoint(cloudSettings.endpoint);
      setModel(cloudSettings.model);
      setTimeoutSeconds(cloudSettings.timeoutSeconds);
      setApiKeyConfigured(status ? status.apiKeyConfigured : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not load AI settings.", "无法加载 AI 服务配置。"));
    } finally {
      setLoading(false);
    }
  }, [tx]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const onSettingsChanged = (event: Event) => {
      const detail = (event as CustomEvent<AiSettings | undefined>).detail;
      if (!detail) return;
      setSettings(detail);
      setEndpoint(detail.endpoint);
      setModel(detail.model);
      setTimeoutSeconds(detail.timeoutSeconds);
    };
    window.addEventListener("dockmark:ai-settings", onSettingsChanged);
    return () => window.removeEventListener("dockmark:ai-settings", onSettingsChanged);
  }, []);

  async function recheckStatus() {
    setCheckingKey(true);
    setError(null);
    try {
      const status = await getAiProviderStatus();
      setApiKeyConfigured(status.apiKeyConfigured);
      setNotice(
        status.apiKeyConfigured
          ? tx("Worker secret DOCKMARK_AI_API_KEY is configured and ready.", "检测到 Worker 密钥 DOCKMARK_AI_API_KEY 已配置就绪。")
          : tx("Worker secret DOCKMARK_AI_API_KEY is not configured yet.", "尚未检测到 Worker 密钥 DOCKMARK_AI_API_KEY。"),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not verify Worker secret status.", "检测 Worker 密钥状态失败。"));
    } finally {
      setCheckingKey(false);
    }
  }

  function applyPreset(preset: ProviderPreset) {
    setEndpoint(preset.endpoint);
    if (!model.trim() || PROVIDER_PRESETS.some((candidate) => candidate.defaultModel === model.trim())) {
      setModel(preset.defaultModel);
    }
    setNotice(null);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    const trimmedEndpoint = endpoint.trim();
    const clampedTimeout = Math.min(
      MAX_AI_TIMEOUT_SECONDS,
      Math.max(MIN_AI_TIMEOUT_SECONDS, Math.round(Number(timeoutSeconds) || DEFAULT_AI_SETTINGS.timeoutSeconds)),
    );
    try {
      const saved = await saveCloudAiSettings({
        endpoint: trimmedEndpoint,
        model: model.trim(),
        timeoutSeconds: clampedTimeout,
      });
      setSettings(saved);
      setEndpoint(saved.endpoint);
      setModel(saved.model);
      setTimeoutSeconds(saved.timeoutSeconds);
      setNotice(
        tx(
          "AI settings saved to D1 and synced locally across Inbox and Bookmarks.",
          "AI 配置已保存至 D1 并同步到本地，收件箱与书签整理将立即生效。",
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not save AI settings.", "保存 AI 配置失败。"));
    } finally {
      setSaving(false);
    }
  }

  async function copySecretCommand() {
    try {
      await navigator.clipboard.writeText(WRANGLER_SECRET_COMMAND);
      setCopiedCmd(true);
      window.setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      setError(tx("Could not copy command automatically. Copy it manually from the box.", "无法自动复制命令，请手动选中复制。"));
    }
  }

  const normalizedEndpoint = endpoint.trim();
  const isDirty =
    normalizedEndpoint !== settings.endpoint ||
    model.trim() !== settings.model ||
    Number(timeoutSeconds) !== settings.timeoutSeconds;

  return (
    <section className="ai-service-section" aria-labelledby="ai-service-settings-title">
      <div className="settings-heading">
        <div>
          <h2 id="ai-service-settings-title">{tx("AI Service", "AI 服务")}</h2>
          <p>
            {tx(
              "Configure your OpenAI-compatible Chat Completions endpoint and model once. Settings sync via D1 while your API key stays strictly inside Cloudflare Worker secrets.",
              "统一配置 OpenAI 兼容的 Chat Completions 接口与模型。非敏感配置通过 D1 跨设备同步，API 密钥仅保留在 Cloudflare Worker Secret 中。",
            )}
          </p>
        </div>
        <div className="settings-sync-state">
          <strong>{isDirty ? tx("Unsaved edits", "有未保存修改") : tx("Cloud synced", "云端已同步")}</strong>
          <span>{loading ? tx("Loading AI settings…", "正在加载配置…") : formatSyncTime(settings.updatedAt, locale, tx)}</span>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="success-banner" role="status">{notice}</div>}

      <div className="ai-service-grid">
        <article className="form-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Provider Endpoint & Model", "服务商接口与模型")}</h2>
              <p>
                {tx(
                  "Pick a 1-click preset or enter any HTTPS OpenAI-compatible Chat Completions URL.",
                  "可一键填入常用服务商预设，或手动填写任意 HTTPS OpenAI 兼容接口地址。",
                )}
              </p>
            </div>
          </div>

          <div className="ai-preset-block">
            <span className="ai-preset-label">{tx("Quick Presets", "快捷预设")}</span>
            <div className="ai-preset-chips" role="group" aria-label={tx("AI provider presets", "AI 服务商预设")}>
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`ai-preset-chip${normalizedEndpoint === preset.endpoint ? " active" : ""}`}
                  onClick={() => applyPreset(preset)}
                >
                  {tx(preset.labelEn, preset.labelZh)}
                </button>
              ))}
            </div>
          </div>

          <form className="ai-service-form" onSubmit={(event) => void handleSubmit(event)}>
            <label className="settings-field">
              <span>{tx("Chat Completions Endpoint (HTTPS)", "Chat Completions 接口地址（HTTPS）")}</span>
              <input
                type="url"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://api.openai.com/v1/chat/completions"
                maxLength={500}
              />
            </label>

            <div className="ai-service-form-row">
              <label className="settings-field">
                <span>{tx("Model", "模型名称")}</span>
                <input
                  type="text"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="gpt-4o-mini / deepseek-chat / gemini-2.5-flash"
                  maxLength={160}
                />
              </label>

              <label className="settings-field">
                <span>{tx(`Timeout (${MIN_AI_TIMEOUT_SECONDS}–${MAX_AI_TIMEOUT_SECONDS}s)`, `超时时间（${MIN_AI_TIMEOUT_SECONDS}–${MAX_AI_TIMEOUT_SECONDS} 秒）`)}</span>
                <input
                  type="number"
                  min={MIN_AI_TIMEOUT_SECONDS}
                  max={MAX_AI_TIMEOUT_SECONDS}
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(Number(event.target.value) || DEFAULT_AI_SETTINGS.timeoutSeconds)}
                />
              </label>
            </div>

            <div className="ai-service-form-actions">
              <p className="settings-footnote">
                {tx(
                  "API keys are never submitted by the browser or stored in D1.",
                  "浏览器从不提交 API 密钥，D1 数据库也绝不存储任何密钥。",
                )}
              </p>
              <div>
                <button
                  className="secondary"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setEndpoint(DEFAULT_AI_SETTINGS.endpoint);
                    setTimeoutSeconds(DEFAULT_AI_SETTINGS.timeoutSeconds);
                  }}
                >
                  {tx("Default URL", "恢复默认地址")}
                </button>
                <button className="primary" type="submit" disabled={saving || loading}>
                  {saving ? tx("Saving…", "保存中…") : tx("Save AI Settings", "保存 AI 配置")}
                </button>
              </div>
            </div>
          </form>
        </article>

        <article className="form-card ai-secret-card">
          <div className="card-heading">
            <div>
              <h2>{tx("Worker Secret Status", "Worker 密钥状态")}</h2>
              <p>{tx("Bound server-side via Cloudflare Workers secrets.", "由 Cloudflare Workers 服务端密钥安全注入。")}</p>
            </div>
          </div>

          <div className="ai-status-row">
            <span
              className={`ai-status-badge ${
                apiKeyConfigured === true
                  ? "is-ready"
                  : apiKeyConfigured === false
                    ? "is-missing"
                    : ""
              }`}
            >
              <span className="status-dot" aria-hidden="true" />
              {apiKeyConfigured === true
                ? tx("DOCKMARK_AI_API_KEY · Ready", "DOCKMARK_AI_API_KEY · 已配置 Ready")
                : apiKeyConfigured === false
                  ? tx("DOCKMARK_AI_API_KEY · Missing", "DOCKMARK_AI_API_KEY · 未配置 Missing")
                  : tx("Checking status…", "正在检测状态…")}
            </span>
            <button
              className="secondary"
              type="button"
              disabled={checkingKey || loading}
              onClick={() => void recheckStatus()}
            >
              {checkingKey ? tx("Checking…", "检测中…") : tx("Recheck status", "重新检测状态")}
            </button>
          </div>

          <div className="ai-secret-cmd">
            <code>{WRANGLER_SECRET_COMMAND}</code>
            <button className="secondary" type="button" onClick={() => void copySecretCommand()}>
              {copiedCmd ? tx("Copied", "已复制") : tx("Copy", "复制")}
            </button>
          </div>

          <p className="settings-footnote">
            {tx(
              "Run the Wrangler command above in your Dockmark deployment directory. Your API key stays encrypted inside Cloudflare Workers and never leaves the server.",
              "在部署目录执行上方 Wrangler 命令即可写入密钥。密钥全程加密保存在 Cloudflare Workers 运行时内，不会暴露给前端或浏览器。",
            )}
          </p>

          <div className="ai-quick-links">
            <button className="ai-quick-link" type="button" onClick={() => navigateApp("/app/inbox")}>
              <span>{tx("Open Capture Inbox AI Triage", "前往「收件箱 AI 分拣」")}</span>
              <span aria-hidden="true">→</span>
            </button>
            <button className="ai-quick-link" type="button" onClick={() => navigateApp("/app/bookmarks")}>
              <span>{tx("Open Bookmarks → Bulk & AI Organize", "前往「书签库 → 批量与 AI 整理」")}</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
