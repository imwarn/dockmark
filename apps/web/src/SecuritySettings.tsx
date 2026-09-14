import { useEffect, useState } from "react";
import { createPairCode, listDevices, revokeDevice, type PairedDevice } from "./auth-client";

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function SecuritySettings() {
  const [devices, setDevices] = useState<PairedDevice[]>([]);
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshDevices() {
    try {
      setDevices(await listDevices());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load paired devices.");
    }
  }

  useEffect(() => {
    void refreshDevices();
  }, []);

  async function generatePairCode() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createPairCode();
      setPairCode(result);
      setMessage("Pairing code created. Enter it in the Dockmark extension popup within 10 minutes.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create a pairing code.");
    } finally {
      setBusy(false);
    }
  }

  async function copyPairCode() {
    if (!pairCode) return;
    try {
      await navigator.clipboard.writeText(pairCode.code);
      setMessage("Pairing code copied.");
    } catch {
      setMessage("Copy is unavailable in this browser. Select the code manually.");
    }
  }

  async function revoke(device: PairedDevice) {
    if (!window.confirm(`Revoke “${device.name}”? Its extension token will stop working immediately.`)) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await revokeDevice(device.id);
      await refreshDevices();
      setMessage(`Revoked “${device.name}”.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not revoke this device.");
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
          <p className="eyebrow">SECURITY</p>
          <h2 id="security-title">Web sessions and paired extensions.</h2>
          <p>Your Web session uses an HttpOnly cookie. Extensions use revocable per-device bearer tokens created from short-lived one-time pairing codes.</p>
        </div>
        <div className="settings-sync-state">
          <strong>{activeDevices.length} active device{activeDevices.length === 1 ? "" : "s"}</strong>
          <span>Browser writes still require explicit review.</span>
        </div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {message && <div className="success-banner" role="status">{message}</div>}

      <div className="settings-grid">
        <article className="form-card settings-card">
          <div className="card-heading">
            <div>
              <h3>Pair a browser extension</h3>
              <p>Create a one-time code only from this signed-in Web session. The code expires after 10 minutes and can be used once.</p>
            </div>
          </div>
          {pairCode ? (
            <div className="pair-code-panel">
              <code>{pairCode.code}</code>
              <span>Expires {timeLabel(pairCode.expiresAt)}</span>
              <div className="extension-actions">
                <button className="secondary" type="button" onClick={() => void copyPairCode()}>Copy code</button>
                <button className="primary" type="button" disabled={busy} onClick={() => void generatePairCode()}>New code</button>
              </div>
            </div>
          ) : (
            <button className="primary" type="button" disabled={busy} onClick={() => void generatePairCode()}>
              {busy ? "Creating…" : "Create pairing code"}
            </button>
          )}
        </article>

        <article className="form-card settings-card settings-card-wide">
          <div className="card-heading">
            <div>
              <h3>Paired devices</h3>
              <p>Each extension has its own token. Revoking one device does not sign out your Web session or other browsers.</p>
            </div>
            <button className="text-action" type="button" disabled={busy} onClick={() => void refreshDevices()}>Refresh</button>
          </div>
          <div className="security-device-list">
            {activeDevices.map((device) => (
              <div className="security-device" key={device.id}>
                <span>
                  <strong>{device.name}</strong>
                  <small>Paired {timeLabel(device.createdAt)} · last seen {timeLabel(device.lastSeenAt)}</small>
                </span>
                <button className="danger-button" type="button" disabled={busy} onClick={() => void revoke(device)}>Revoke</button>
              </div>
            ))}
            {!activeDevices.length && <p className="empty-copy">No active paired extensions yet.</p>}
          </div>
          {revokedDevices.length > 0 && (
            <details className="revoked-devices">
              <summary>{revokedDevices.length} revoked device{revokedDevices.length === 1 ? "" : "s"}</summary>
              {revokedDevices.map((device) => (
                <div className="security-device security-device-revoked" key={device.id}>
                  <span><strong>{device.name}</strong><small>Revoked {device.revokedAt ? timeLabel(device.revokedAt) : ""}</small></span>
                </div>
              ))}
            </details>
          )}
        </article>
      </div>
    </section>
  );
}
