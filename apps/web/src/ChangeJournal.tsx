import { useEffect, useState } from "react";
import {
  listChangeJournal,
  type ChangeJournalEntry,
  type ChangeJournalSnapshot,
} from "./change-journal-api";
import "./change-journal.css";

interface Props {
  revision: string;
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Could not load the change journal.";
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function stateLabel(snapshot: ChangeJournalSnapshot | null) {
  if (!snapshot) return "Deleted";
  return [
    snapshot.archived ? "Archived" : "Active",
    snapshot.inbox ? "Inbox" : "Filed",
    snapshot.published ? "Public" : "Private",
  ].join(" · ");
}

function Snapshot({ label, value }: { label: string; value: ChangeJournalSnapshot | null }) {
  return (
    <div className="journal-snapshot">
      <strong>{label}</strong>
      {!value ? <span className="journal-deleted">No bookmark record</span> : <>
        <span>Category: {value.categoryName ?? (value.categoryId ? value.categoryId : "Uncategorized")}</span>
        <span>Tags: {value.tags.length ? value.tags.map((tag) => `#${tag}`).join(" ") : "None"}</span>
        <span>Health: {value.healthPolicy} / {value.healthStatus}</span>
        <span>State: {stateLabel(value)}</span>
        <span>Position: {value.position}</span>
        {value.description && <span>Description: {value.description}</span>}
        {value.iconUrl && <span>Icon: {value.iconUrl}</span>}
      </>}
    </div>
  );
}

export function ChangeJournal({ revision }: Props) {
  const [entries, setEntries] = useState<ChangeJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listChangeJournal(30));
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [revision]);

  async function copyEntry(entry: ChangeJournalEntry) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((current) => current === entry.id ? null : current), 1800);
    } catch {
      setError("Could not copy recovery JSON. Expand Raw recovery JSON and copy it manually.");
    }
  }

  return (
    <section className="management change-journal" aria-label="Change journal">
      <div className="form-card journal-card">
        <div className="library-bulk-heading">
          <div>
            <p className="eyebrow">V5 · RECOVERY CONTEXT</p>
            <h2>Change journal</h2>
            <p>High-impact reviewed batches record before/after context in the same D1 transaction. This is an audit and manual-recovery surface, not automatic undo.</p>
          </div>
          <button className="secondary" type="button" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>

        {error && <div className="inline-form-feedback error" role="alert">{error}</div>}
        {!loading && !entries.length && <p className="empty-copy">No high-impact bulk changes have been journaled yet.</p>}

        <div className="journal-list">
          {entries.map((entry) => (
            <details className="journal-entry" key={entry.id}>
              <summary>
                <span>
                  <strong>{entry.summary}</strong>
                  <small>{displayTime(entry.createdAt)} · {entry.operation} · {entry.itemCount} item{entry.itemCount === 1 ? "" : "s"}</small>
                </span>
              </summary>
              <div className="journal-entry-body">
                <div className="journal-tools">
                  <span>Use the recorded values to manually restore or verify a later repair.</span>
                  <button className="text-action" type="button" onClick={() => void copyEntry(entry)}>{copiedId === entry.id ? "Copied" : "Copy recovery JSON"}</button>
                </div>
                <div className="journal-items">
                  {entry.items.map((item) => (
                    <article className="journal-item" key={`${entry.id}:${item.bookmarkId}`}>
                      <div className="journal-item-heading">
                        <strong>{item.title}</strong>
                        <small>{item.url}</small>
                      </div>
                      <div className="journal-snapshot-grid">
                        <Snapshot label="Before" value={item.before} />
                        <Snapshot label="After" value={item.after} />
                      </div>
                    </article>
                  ))}
                </div>
                <details className="journal-raw">
                  <summary>Raw recovery JSON</summary>
                  <pre>{JSON.stringify(entry, null, 2)}</pre>
                </details>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
