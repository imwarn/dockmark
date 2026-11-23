/**
 * [INPUT]: depends on SessionSummary from ./api; depends on tx and ResolvedLocale from ../../lib/ext-locale
 * [OUTPUT]: exports SessionsPanel component for saving the active browser window and restoring recent cloud Sessions
 * [POS]: Sessions tab panel inside apps/extension/entrypoints/popup
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { tx, type ResolvedLocale } from "../../lib/ext-locale";
import type { SessionSummary } from "./api";

interface SessionsPanelProps {
  locale: ResolvedLocale;
  sessionName: string;
  savableTabCount: number;
  sessions: SessionSummary[];
  busy: boolean;
  onSessionNameChange: (value: string) => void;
  onSaveWindow: () => void;
  onRestoreSession: (session: SessionSummary) => void;
}

export function SessionsPanel(props: SessionsPanelProps) {
  const { locale } = props;

  return (
    <div className="sessions-view" data-testid="popup-sessions">
      <section className="card compact-card">
        <div className="section-heading">
          <strong>{tx(locale, "Save current window", "保存当前窗口")}</strong>
          <span className="pill neutral">
            {tx(locale, `${props.savableTabCount} tabs`, `${props.savableTabCount} 个标签页`)}
          </span>
        </div>
        <div className="inline-fields">
          <input
            value={props.sessionName}
            onChange={(event) => props.onSessionNameChange(event.target.value)}
            maxLength={120}
            aria-label={tx(locale, "Session name", "会话名称")}
          />
          <button
            className="primary"
            type="button"
            disabled={props.busy || !props.sessionName.trim() || !props.savableTabCount}
            onClick={props.onSaveWindow}
          >
            {tx(locale, "Save", "保存")}
          </button>
        </div>
      </section>

      <section className="session-section">
        <div className="section-heading">
          <strong>{tx(locale, "Recent sessions", "最近会话")}</strong>
          <span>{props.sessions.length}</span>
        </div>
        <div className="session-list">
          {props.sessions.map((session) => (
            <button
              className="session-row"
              type="button"
              key={session.id}
              disabled={props.busy || !session.items.length}
              onClick={() => props.onRestoreSession(session)}
            >
              <span>
                <strong>{session.name}</strong>
                <small>
                  {tx(
                    locale,
                    `${session.items.length} tab${session.items.length === 1 ? "" : "s"}`,
                    `${session.items.length} 个标签页`,
                  )}
                  {session.sourceDevice ? ` · ${session.sourceDevice}` : ""}
                </small>
              </span>
              <em>{tx(locale, "Restore", "恢复")}</em>
            </button>
          ))}
          {!props.sessions.length && (
            <p className="empty">{tx(locale, "No cloud sessions yet.", "暂无云端会话。")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
