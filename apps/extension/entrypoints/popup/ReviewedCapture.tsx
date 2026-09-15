import { useMemo, useState } from "react";
import { browser } from "wxt/browser";

const TOKEN_KEY = "dockmarkDeviceToken";

type CaptureTab = {
  id?: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
};

type CaptureBookmark = {
  id: string;
  title: string;
  url: string;
  categoryName?: string;
  inboxAt?: string;
};

type ReviewItem = {
  index: number;
  title: string;
  url: string;
  state: "new" | "duplicate" | "selection-duplicate";
  duplicateOf?: number;
  duplicateState?: "inbox" | "library";
  bookmark?: CaptureBookmark;
};

type ReviewResponse = {
  items: ReviewItem[];
};

type BatchResponse = {
  result: "batch";
  createdCount: number;
  duplicateCount: number;
  skippedCount: number;
};

class DockmarkRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function apiUrl(origin: string, path: string) {
  return new URL(path, `${origin}/`).toString();
}

function hostLabel(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  const stored = await browser.storage.local.get(TOKEN_KEY);
  const token = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new DockmarkRequestError(response.status, body.error?.message ?? `Dockmark request failed (${response.status}).`);
  }
  return body;
}

export function ReviewedCapture({ serverUrl, tabs }: { serverUrl: string; tabs: CaptureTab[] }) {
  const [review, setReview] = useState<ReviewItem[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviewableTabs = useMemo(() => {
    let dockmarkOrigin = "";
    try {
      dockmarkOrigin = new URL(serverUrl).origin;
    } catch {
      return [] as CaptureTab[];
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
  const duplicateCount = useMemo(() => review?.filter((item) => item.state === "duplicate").length ?? 0, [review]);
  const repeatedCount = useMemo(() => review?.filter((item) => item.state === "selection-duplicate").length ?? 0, [review]);
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
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewWindowTabs() {
    await run(async () => {
      if (!reviewableTabs.length) throw new Error("This window has no HTTP/HTTPS tabs outside Dockmark to review.");
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
      if (!selectedItems.length) throw new Error("Select at least one new tab before saving.");
      const result = await requestJson<BatchResponse>(apiUrl(serverUrl, "/api/capture/batch"), {
        method: "POST",
        body: JSON.stringify({
          items: selectedItems.map((item) => ({ title: item.title, url: item.url })),
        }),
      });
      const changedDuringReview = result.duplicateCount + result.skippedCount;
      setReview(null);
      setSelected(new Set());
      setNotice(
        changedDuringReview
          ? `Saved ${result.createdCount} tabs to Inbox; ${changedDuringReview} were skipped after a final duplicate recheck.`
          : `Saved ${result.createdCount} reviewed tabs to Dockmark Inbox.`,
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
    <section className="card multi-capture-card">
      <div className="section-heading">
        <strong>Reviewed multi-tab capture</strong>
        <span>{reviewableTabs.length} eligible</span>
      </div>
      {!review ? (
        <>
          <p className="capture-help">Review the current window first. Dockmark checks exact normalized URLs without writing anything, then you choose which new tabs are allowed into Inbox.</p>
          <button className="secondary" disabled={busy || !reviewableTabs.length} onClick={() => void reviewWindowTabs()}>
            {busy ? "Reviewing…" : `Review ${reviewableTabs.length} window tabs`}
          </button>
        </>
      ) : (
        <>
          <div className="capture-review-summary">
            <span><strong>{newItems.length}</strong> new</span>
            <span><strong>{duplicateCount}</strong> existing</span>
            <span><strong>{repeatedCount}</strong> repeated</span>
          </div>
          <div className="capture-selection-actions">
            <button className="text-button" type="button" disabled={busy || !newItems.length} onClick={() => setSelected(new Set(newItems.map((item) => item.index)))}>Select all new</button>
            <button className="text-button" type="button" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
          <div className="capture-review-list">
            {review.map((item) => {
              const selectable = item.state === "new";
              const existingLabel = item.duplicateState === "inbox"
                ? "Already in Inbox"
                : item.duplicateState === "library"
                  ? item.bookmark?.categoryName ?? "Already in library"
                  : item.state === "selection-duplicate"
                    ? `Repeated tab · same as #${(item.duplicateOf ?? 0) + 1}`
                    : "New";
              return (
                <label className={`capture-review-row state-${item.state}`} key={`${item.index}-${item.url}`}>
                  <input
                    type="checkbox"
                    checked={selectable && selected.has(item.index)}
                    disabled={busy || !selectable}
                    onChange={() => toggle(item.index)}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>{hostLabel(item.url)} · {existingLabel}</small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="capture-review-actions">
            <button className="secondary" type="button" disabled={busy} onClick={() => { setReview(null); setSelected(new Set()); }}>Cancel review</button>
            <button className="primary" type="button" disabled={busy || !selectedItems.length} onClick={() => void applyReviewedCapture()}>
              {busy ? "Saving…" : `Save ${selectedItems.length} selected`}
            </button>
          </div>
        </>
      )}
      {(notice || error) && (
        <div className={`capture-batch-notice ${error ? "error" : "success"}`}>
          <span>{error ?? notice}</span>
          {!error && <button className="text-button" type="button" onClick={() => void openInbox()}>Open Inbox →</button>}
        </div>
      )}
    </section>
  );
}
