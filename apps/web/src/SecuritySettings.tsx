/**
 * [INPUT]: depends on createPairCode, listDevices, revokeDevice, PairedDevice from ./auth-client and useI18n from ./i18n
 * [OUTPUT]: exports SecuritySettings panel for generating one-time pairing codes and managing paired browser extensions
 * [POS]: Mounted in SettingsPage under /app/settings/security. Manages revocable per-device extension bearer tokens.
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useCallback, useEffect, useState } from "react";
import { createPairCode, listDevices, revokeDevice, type PairedDevice } from "./auth-client";
import { useI18n } from "./i18n";

function timeLabel(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function SecuritySettings() {
  const { locale, tx } = useI18n();
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await listDevices());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not load paired devices.", "无法加载已配对设备列表。"));
    }
  }, [tx]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  async function generatePairCode() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createPairCode();
      setPairCode(result);
      setMessage(tx("Pairing code created. Enter it in the Dockmark extension popup within 10 minutes.", "配对码已生成，请在 10 分钟内填入 Dockmark 扩展弹窗。"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not create a pairing code.", "生成配对码失败。"));
    } finally {
      setBusy(false);
    }
  }

  async function copyPairCode() {
    if (!pairCode) return;
    try {
      await navigator.clipboard.writeText(pairCode.code);
      setMessage(tx("Pairing code copied.", "已复制配对码。"));
    } catch {
      setMessage(tx("Copy is unavailable in this browser. Select the code manually.", "当前浏览器不支持剪贴板写入，请手动选中复制。"));
    }
  }

  async function revoke(device: PairedDevice) {
    const prompt = tx(
      `Revoke “${device.name}”? Its extension token will stop working immediately.`,
      `确定吊销“${device.name}”吗？该扩展令牌将立即失效。`,
    );
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await revokeDevice(device.id);
      await refreshDevices();
      setMessage(tx(`Revoked “${device.name}”.`, `已吊销“${device.name}”。`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tx("Could not revoke this device.", "吊销设备失败。"));
    } finally {
      setBusy(false);
    }
  }

  const activeDevices = devices.filter((device) => !device.revokedAt);
  const revokedDevices = devices.filter((device) => device.revokedAt);

  return (
    <section className="security-section" aria-labelledby="security-title">
      <div className="settings-heading">
        <div>
          <h2 id="security-title">{tx("Security & Paired Devices", "安全与已配对设备")}</h2>
          <p>
            {tx(
              "Web sessions use HttpOnly cookies; extensions use revocable per-device tokens issued via one-time pairing codes.",
              "网页端使用 HttpOnly Cookie 会话；浏览器扩展通过一次性配对码获取可独立吊销的设备令牌。",
            )}
          </p>
        </div>
        <div className="settings-sync-state">
          <strong>
            {tx(
              `${activeDevices.length} active device${activeDevices.length === 1 ? "" : "s"}`,
              `${activeDevices.length} 台活跃设备`,
            )}
          </strong>
          <span>{tx("Browser writes require review", "浏览器书签写入始终需人工确认")}</span>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="success-banner" role="status">{message}</div>}

      <div className="settings-grid">
        <article className="form-card settings-card">
          <div className="card-heading">
            <div>
              <h3>{tx("Pair a browser extension", "配对浏览器扩展")}</h3>
              <p>
                {tx(
                  "Create a one-time code from this signed-in session. Expires in 10 minutes and works once.",
                  "仅可在当前已登录会话中生成一次性配对码，10 分钟内有效且仅可使用一次。",
                )}
              </p>
            </div>
          </div>
          {pairCode ? (
            <div className="pair-code-panel">
              <code>{pairCode.code}</code>
              <span>{tx(`Expires ${timeLabel(pairCode.expiresAt, locale)}`, `过期时间：${timeLabel(pairCode.expiresAt, locale)}`)}</span>
              <div className="extension-actions">
                <button className="secondary" type="button" onClick={() => void copyPairCode()}>
                  {tx("Copy code", "复制配对码")}
                </button>
                <button className="primary" type="button" disabled={busy} onClick={() => void generatePairCode()}>
                  {tx("New code", "重新生成")}
                </button>
              </div>
            </div>
          ) : (
            <button className="primary" type="button" disabled={busy} onClick={() => void generatePairCode()}>
              {busy ? tx("Creating…", "生成中…") : tx("Create pairing code", "生成配对码")}
            </button>
          )}
        </article>

        <article className="form-card settings-card settings-card-wide">
          <div className="card-heading">
            <div>
              <h3>{tx("Paired devices", "已配对设备")}</h3>
              <p>
                {tx(
                  "Each extension keeps its own token. Revoking one device never signs out your Web session or other browsers.",
                  "每个扩展拥有独立令牌；吊销单台设备不会影响当前网页会话或其他浏览器。",
                )}
              </p>
            </div>
            <button className="text-action" type="button" disabled={busy} onClick={() => void refreshDevices()}>
              {tx("Refresh", "刷新")}
            </button>
          </div>
          <div className="security-device-list">
            {activeDevices.map((device) => (
              <div className="security-device" key={device.id}>
                <span>
                  <strong>{device.name}</strong>
                  <small>
                    {tx(
                      `Paired ${timeLabel(device.createdAt, locale)} · last seen ${timeLabel(device.lastSeenAt, locale)}`,
                      `配对于 ${timeLabel(device.createdAt, locale)} · 最近活跃 ${timeLabel(device.lastSeenAt, locale)}`,
                    )}
                  </small>
                </span>
                <button className="danger-button" type="button" disabled={busy} onClick={() => void revoke(device)}>
                  {tx("Revoke", "吊销")}
                </button>
              </div>
            ))}
            {!activeDevices.length && (
              <p className="empty-copy">{tx("No active paired extensions yet.", "暂无活跃的已配对扩展。")}</p>
            )}
          </div>
          {revokedDevices.length > 0 && (
            <details className="revoked-devices">
              <summary>
                {tx(
                  `${revokedDevices.length} revoked device${revokedDevices.length === 1 ? "" : "s"}`,
                  `${revokedDevices.length} 台已吊销设备`,
                )}
              </summary>
              {revokedDevices.map((device) => (
                <div className="security-device security-device-revoked" key={device.id}>
                  <span>
                    <strong>{device.name}</strong>
                    <small>
                      {device.revokedAt
                        ? tx(`Revoked ${timeLabel(device.revokedAt, locale)}`, `吊销于 ${timeLabel(device.revokedAt, locale)}`)
                        : ""}
                    </small>
                  </span>
                </div>
              ))}
            </details>
          )}
        </article>
      </div>
    </section>
  );
}
