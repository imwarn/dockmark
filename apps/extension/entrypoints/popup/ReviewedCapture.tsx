/**
 * [INPUT]: depends on React hooks; depends on browser from wxt/browser; depends on api helpers from ./api; depends on tx and ResolvedLocale from ../../lib/ext-locale
 * [OUTPUT]: exports ReviewedCapture component for batch-reviewing and saving open window tabs to Dockmark Inbox
 * [POS]: Multi-Tab capture workbench panel inside apps/extension/entrypoints/popup
 * [PROTOCOL]: Update this header on change, then check GEMINI.md
 */
import { useMemo, useState } from "react";
import { browser } from "wxt/browser";
import { tx, type ResolvedLocale } from "../../lib/ext-locale";
import {
  apiUrl,
  hostLabel,
  hostMonogram,
  requestJson,
  type BatchResponse,
  type ReviewItem,
  type ReviewResponse,
  type SavableTab,
} from "./api";

export function ReviewedCapture({
  serverUrl,
  tabs,
  locale,
}: {
  serverUrl: string;
  tabs: SavableTab[];
  locale: ResolvedLocale;
}) {
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set<number>());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviewableTabs = useMemo(() => {
    let dockmarkOrigin = "";
    try {
      dockmarkOrigin = new URL(serverUrl).origin;
    } catch {
      return [] as SavableTab[];
    }
    return tabs
      .filter((tab) => {
        try {
          return new URL(tab.url).origin !== dockmarkOrigin;
        } catch {
          return false;
        }
      })
      .slice(0, 100);
  }, [serverUrl, tabs]);

  const newItems = useMemo(() => review?.filter((item) => item.state === "new") ?? [], [review]);
  const duplicateCount = useMemo(
    () => review?.filter((item) => item.state === "duplicate").length ?? 0,
    [review],
  );
  const repeatedCount = useMemo(
    () => review?.filter((item) => item.state === "selection-duplicate").length ?? 0,
    [review],
  );
  const selectedItems = useMemo(
    () => newItems.filter((item) => selected.has(item.index)),
    [newItems, selected],
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : tx(locale, "Something went wrong.", "操作失败，请重试。"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function reviewWindowTabs() {
    await run(async () => {
      if (!reviewableTabs.length) {
        throw new Error(
          tx(
            locale,
            "No HTTP/HTTPS tabs outside Dockmark to review.",
            "当前窗口没有除 Dockmark 外的可审查网页标签页。",
          ),
        );
      }
      const result = await requestJson<ReviewResponse>(apiUrl(serverUrl, "/api/capture/review"), {
        method: "POST",
        body: JSON.stringify({
          items: reviewableTabs.map((tab) => ({
            title: tab.title || tab.url,
            url: tab.url,
          })),
        }),
      });
      setReview(result.items);
      setSelected(new Set(result.items.filter((item) => item.state === "new").map((item) => item.index)));
      setNotice(null);
    });
  }

  async function applyReviewedCapture() {
    await run(async () => {
      if (!selectedItems.length) {
        throw new Error(tx(locale, "Select at least one new tab before saving.", "请至少选择一个新标签页再保存。"));
      }
      const result = await requestJson<BatchResponse>(apiUrl(serverUrl, "/api/capture/batch"), {
        method: "POST",
        body: JSON.stringify({
          items: selectedItems.map((item) => ({ title: item.title, url: item.url })),
        }),
      });
      const changedDuringReview = result.duplicateCount + result.skippedCount;
      setReview(null);
      setSelected(new Set<number>());
      setNotice(
        changedDuringReview
          ? tx(
              locale,
              `Saved ${result.createdCount} to Inbox (${changedDuringReview} skipped as duplicates).`,
              `已保存 ${result.createdCount} 条到收件箱，跳过 ${changedDuringReview} 条重复项。`,
            )
          : tx(
              locale,
              `Saved ${result.createdCount} tabs to Inbox.`,
              `已保存 ${result.createdCount} 个标签页到收件箱。`,
            ),
      );
    });
  }

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function openInbox() {
    await browser.tabs.create({ url: apiUrl(serverUrl, "/app/inbox"), active: true });
  }

  return (
    <section className="card multi-capture-card" data-testid="popup-multitab">
      <div className="section-heading">
        <strong>{tx(locale, "Multi-tab capture", "批量收录窗口标签页")}</strong>
        <span className="pill neutral">
          {tx(locale, `${reviewableTabs.length} eligible`, `${reviewableTabs.length} 个可收录`)}
        </span>
      </div>

      {!review ? (
        <>
          <p className="capture-help">
            {tx(
              locale,
              "Checks normalized URLs against your library and Inbox before saving selected tabs.",
              "先按规范化网址核对书签库与收件箱去重，再由你勾选需要收录的新标签页。",
            )}
          </p>
          <button
            className="primary"
            type="button"
            disabled={busy || !reviewableTabs.length}
            onClick={() => void reviewWindowTabs()}
          >
            {busy
              ? tx(locale, "Reviewing…", "正在检查…")
              : tx(
                  locale,
                  `Review ${reviewableTabs.length} window tabs`,
                  `审查当前窗口 ${reviewableTabs.length} 个标签页`,
                )}
          </button>
        </>
      ) : (
        <>
          <div className="capture-review-summary">
            <span className="summary-pill is-new">
              <strong>{newItems.length}</strong>
              <small>{tx(locale, "New", "新增")}</small>
            </span>
            <span className="summary-pill is-existing">
              <strong>{duplicateCount}</strong>
              <small>{tx(locale, "Existing", "已存在")}</small>
            </span>
            <span className="summary-pill is-repeated">
              <strong>{repeatedCount}</strong>
              <small>{tx(locale, "Repeated", "窗口重复")}</small>
            </span>
          </div>

          <div className="capture-selection-actions">
            <button
              className="text-button"
              type="button"
              disabled={busy || !newItems.length}
              onClick={() => setSelected(new Set(newItems.map((item) => item.index)))}
            >
              {tx(locale, "Select all", "全选新增")}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy || !selected.size}
              onClick={() => setSelected(new Set<number>())}
            >
              {tx(locale, "Clear", "清空")}
            </button>
            <span className="selection-count">
              {tx(locale, `${selectedItems.length} selected`, `已选 ${selectedItems.length} 项`)}
            </span>
          </div>

          <div className="capture-review-list">
            {review.map((item) => {
              const selectable = item.state === "new";
              const existingLabel = item.duplicateState === "inbox"
                ? tx(locale, "In Inbox", "已在收件箱")
                : item.duplicateState === "library"
                  ? item.bookmark?.categoryName ?? tx(locale, "In library", "已在书签库")
                  : item.state === "selection-duplicate"
                    ? tx(locale, `Same as #${(item.duplicateOf ?? 0) + 1}`, `与第 ${(item.duplicateOf ?? 0) + 1} 项重复`)
                    : tx(locale, "New", "新增");
              return (
                <label
                  className={`capture-review-row state-${item.state}`}
                  key={`${item.index}-${item.url}`}
                >
                  <input
                    type="checkbox"
                    checked={selectable && selected.has(item.index)}
                    disabled={busy || !selectable}
                    onChange={() => toggle(item.index)}
                  />
                  <span className="row-monogram" aria-hidden="true">
                    {hostMonogram(item.url, item.title)}
                  </span>
                  <span className="row-copy">
                    <strong>{item.title}</strong>
                    <small>{hostLabel(item.url)} · {existingLabel}</small>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="capture-review-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => {
                setReview(null);
                setSelected(new Set<number>());
              }}
            >
              {tx(locale, "Cancel", "取消")}
            </button>
            <button
              className="primary"
              type="button"
              disabled={busy || !selectedItems.length}
              onClick={() => void applyReviewedCapture()}
            >
              {busy
                ? tx(locale, "Saving…", "保存中…")
                : tx(locale, `Save ${selectedItems.length} to Inbox`, `保存 ${selectedItems.length} 项到收件箱`)}
            </button>
          </div>
        </>
      )}

      {(notice || error) && (
        <div className={`capture-batch-notice ${error ? "error" : "success"}`}>
          <span>{error ?? notice}</span>
          {!error && (
            <button className="text-button" type="button" onClick={() => void openInbox()}>
              {tx(locale, "Open Inbox →", "打开收件箱 →")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
