/**
 * [INPUT]: depends on HEALTH_POLICY_LABELS, HEALTH_STATUS_LABELS, HealthPolicy, HealthStatus from @dockmark/core; listChangeJournal, ChangeJournalEntry, ChangeJournalSnapshot from ./change-journal-api; useI18n from ./i18n
 * [OUTPUT]: exports ChangeJournal component
 * [POS]: History tab view inside BookmarkManager displaying transaction-recorded before/after snapshots for manual audit and recovery
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */

import { useEffect, useState } from "react";
import {
  HEALTH_POLICY_LABELS,
  HEALTH_STATUS_LABELS,
  type HealthPolicy,
  type HealthStatus,
  type ResolvedLocale,
} from "@dockmark/core";
import {
  listChangeJournal,
  type ChangeJournalEntry,
  type ChangeJournalSnapshot,
} from "./change-journal-api";
import { useI18n } from "./i18n";
import "./change-journal.css";

interface Props {
  revision: string;
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function displayTime(value: string, locale: ResolvedLocale) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatHealthPolicy(value: string, locale: ResolvedLocale) {
  const map = HEALTH_POLICY_LABELS[locale] as Record<string, string>;
  return map[value as HealthPolicy] ?? value;
}

function formatHealthStatus(value: string, locale: ResolvedLocale) {
  const map = HEALTH_STATUS_LABELS[locale] as Record<string, string>;
  return map[value as HealthStatus] ?? value;
}

function Snapshot({ label, value }: { label: string; value: ChangeJournalSnapshot | null }) {
  const { locale, tx } = useI18n();

  const stateText = !value
    ? tx("Deleted", "已删除")
    : [
        value.archived ? tx("Archived", "已归档") : tx("Active", "活跃"),
        value.inbox ? tx("Inbox", "收件箱") : tx("Filed", "已归类"),
        value.published ? tx("Public", "公开") : tx("Private", "私密"),
      ].join(" · ");

  return (
    <div className="journal-snapshot">
      <strong>{label}</strong>
      {!value ? (
        <span className="journal-deleted">{tx("No bookmark record", "无书签记录")}</span>
      ) : (
        <>
          <span>
            {tx("Category:", "分类：")}{" "}
            {value.categoryName ?? (value.categoryId ? value.categoryId : tx("Uncategorized", "未分类"))}
          </span>
          <span>
            {tx("Tags:", "标签：")}{" "}
            {value.tags.length ? value.tags.map((tag) => `#${tag}`).join(" ") : tx("None", "无")}
          </span>
          <span>
            {tx("Health:", "健康：")}{" "}
            {formatHealthPolicy(value.healthPolicy, locale)} / {formatHealthStatus(value.healthStatus, locale)}
          </span>
          <span>{tx("State:", "状态：")} {stateText}</span>
          <span>{tx("Position:", "排序位置：")} {value.position}</span>
          {value.description && <span>{tx("Description:", "描述：")} {value.description}</span>}
          {value.iconUrl && <span>{tx("Icon:", "图标：")} {value.iconUrl}</span>}
        </>
      )}
    </div>
  );
}

export function ChangeJournal({ revision }: Props) {
  const { locale, tx } = useI18n();
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
      setError(messageFrom(caught, tx("Could not load the change journal.", "无法加载变更记录。")));
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
      setError(tx(
        "Could not copy recovery JSON. Expand Raw recovery JSON and copy it manually.",
        "复制恢复 JSON 失败，请展开下方原始 JSON 后手动复制。",
      ));
    }
  }

  return (
    <section className="management change-journal" aria-label={tx("Change journal", "变更记录")}>
      <div className="form-card journal-card">
        <div className="library-bulk-heading">
          <div>
            <h2>{tx("Change journal", "变更记录")}</h2>
            <p>
              {tx(
                "High-impact reviewed batches record before/after snapshots in the same transaction for audit and manual recovery.",
                "高影响批量操作会在同一事务中记录变更前后快照，供审计与手动恢复使用。",
              )}
            </p>
          </div>
          <button className="secondary" type="button" disabled={loading} onClick={() => void refresh()}>
            {loading ? tx("Refreshing…", "刷新中…") : tx("Refresh", "刷新")}
          </button>
        </div>

        {error && <div className="inline-form-feedback error" role="alert">{error}</div>}
        {!loading && !entries.length && (
          <p className="empty-copy">{tx("No high-impact bulk changes have been recorded yet.", "暂无批量变更记录。")}</p>
        )}

        <div className="journal-list">
          {entries.map((entry) => (
            <details className="journal-entry" key={entry.id}>
              <summary>
                <span>
                  <strong>{entry.summary}</strong>
                  <small>
                    {displayTime(entry.createdAt, locale)} · {entry.operation} ·{" "}
                    {tx(`${entry.itemCount} item${entry.itemCount === 1 ? "" : "s"}`, `${entry.itemCount} 项`)}
                  </small>
                </span>
              </summary>
              <div className="journal-entry-body">
                <div className="journal-tools">
                  <span>
                    {tx(
                      "Use the recorded values to manually restore or verify a repair.",
                      "可参考记录的变更前后字段进行人工核对或恢复。",
                    )}
                  </span>
                  <button className="text-action" type="button" onClick={() => void copyEntry(entry)}>
                    {copiedId === entry.id ? tx("Copied", "已复制") : tx("Copy recovery JSON", "复制恢复 JSON")}
                  </button>
                </div>
                <div className="journal-items">
                  {entry.items.map((item) => (
                    <article className="journal-item" key={`${entry.id}:${item.bookmarkId}`}>
                      <div className="journal-item-heading">
                        <strong>{item.title}</strong>
                        <small>{item.url}</small>
                      </div>
                      <div className="journal-snapshot-grid">
                        <Snapshot label={tx("Before", "变更前")} value={item.before} />
                        <Snapshot label={tx("After", "变更后")} value={item.after} />
                      </div>
                    </article>
                  ))}
                </div>
                <details className="journal-raw">
                  <summary>{tx("Raw recovery JSON", "原始恢复 JSON")}</summary>
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
