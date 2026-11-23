/**
 * [INPUT]: depends on tx and ResolvedLocale from ../../lib/ext-locale
 * [OUTPUT]: exports SetupWizard component guiding server connection and one-time device pairing
 * [POS]: onboarding surface in apps/extension/entrypoints/popup shown when the extension is unconnected or unpaired
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { tx, type ResolvedLocale } from "../../lib/ext-locale";

interface SetupWizardProps {
  locale: ResolvedLocale;
  serverUrl: string;
  deviceLabel: string;
  pairCode: string;
  connected: boolean;
  initializing: boolean;
  busy: boolean;
  onServerUrlChange: (value: string) => void;
  onDeviceLabelChange: (value: string) => void;
  onPairCodeChange: (value: string) => void;
  onConnect: () => void;
  onPairDevice: () => void;
}

export function SetupWizard(props: SetupWizardProps) {
  const { locale, connected } = props;

  return (
    <section className="card wizard-card" data-testid="popup-setup-wizard">
      <div className="wizard-intro">
        <strong>{tx(locale, "Connect Dockmark", "连接 Dockmark")}</strong>
        <span>
          {tx(
            locale,
            "Two quick steps to enable Quick Capture, Sessions, and launcher sync.",
            "两步完成连接，开启快速收录、会话保存与启动台同步。",
          )}
        </span>
      </div>

      <div className={`wizard-step${connected ? " done" : " current"}`}>
        <div className="step-header">
          <span className="step-badge">{connected ? "✓" : "1"}</span>
          <strong>{tx(locale, "Connect server URL", "连接服务器地址")}</strong>
          <small>{connected ? tx(locale, "Connected", "已连接") : tx(locale, "Step 1", "步骤 1")}</small>
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
            placeholder={tx(locale, "Main browser", "主力浏览器")}
            aria-label={tx(locale, "Device Label", "设备名称")}
          />
          <button
            className={connected ? "secondary" : "primary"}
            type="button"
            disabled={props.initializing || props.busy || !props.serverUrl.trim()}
            onClick={props.onConnect}
          >
            {props.initializing
              ? tx(locale, "Checking…", "检查中…")
              : connected
                ? tx(locale, "Reconnect", "重连")
                : tx(locale, "Connect", "连接")}
          </button>
        </div>
      </div>

      <div className={`wizard-step${connected ? " current" : " locked"}`}>
        <div className="step-header">
          <span className="step-badge">2</span>
          <strong>{tx(locale, "Pair this browser", "配对当前浏览器")}</strong>
          <small>{tx(locale, "Settings → Security", "设置 → 安全")}</small>
        </div>
        <div className="inline-fields">
          <input
            value={props.pairCode}
            onChange={(event) => props.onPairCodeChange(event.target.value.toUpperCase())}
            placeholder="ABCD-EFGH-JK"
            autoComplete="off"
            disabled={!connected || props.busy}
            aria-label={tx(locale, "One-time Pairing Code", "一次性配对码")}
          />
          <button
            className="primary"
            type="button"
            disabled={!connected || props.busy || !props.pairCode.trim()}
            onClick={props.onPairDevice}
          >
            {tx(locale, "Pair device", "配对设备")}
          </button>
        </div>
      </div>
    </section>
  );
}
