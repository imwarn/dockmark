import { useEffect, useMemo, useState } from "react";
import {
  getDuplicateReview,
  type DuplicateCandidateKind,
  type DuplicateReviewCandidate,
  type DuplicateReviewResult,
} from "./duplicate-review-api";
import "./duplicate-review.css";

const kindLabels: Record<DuplicateCandidateKind, string> = {
  canonical: "Canonical target",
  resolved: "Resolved target",
  normalized: "URL variant",
};

const kindDescriptions: Record<DuplicateCandidateKind, string> = {
  canonical: "Strong metadata evidence",
  resolved: "Redirect / final-URL evidence",
  normalized: "Conservative URL normalization",
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Could not load duplicate review.";
}

function matches(candidate: DuplicateReviewCandidate, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const haystack = [
    candidate.left.title,
    candidate.left.url,
    candidate.left.categoryName ?? "",
    candidate.right.title,
    candidate.right.url,
    candidate.right.categoryName ?? "",
    candidate.evidenceUrl ?? "",
  ].join("\n").toLocaleLowerCase();
  return normalized.split(/\s+/).every((token) => haystack.includes(token));
}

function MemberCard({ side, candidate }: { side: "left" | "right"; candidate: DuplicateReviewCandidate }) {
  const bookmark = candidate[side];
  return (
    <article className="duplicate-member">
      <div className="duplicate-member-heading">
        <span>{side === "left" ? "A" : "B"}</span>
        <div>
          <strong>{bookmark.title}</strong>
          <small>{bookmark.categoryName ?? "Uncategorized"} · {bookmark.healthPolicy} · {bookmark.healthStatus}</small>
        </div>
      </div>
      <a className="duplicate-url" href={bookmark.url} target="_blank" rel="noreferrer">{bookmark.url}</a>
      {bookmark.description && <p>{bookmark.description}</p>}
      <div className="duplicate-member-evidence">
        {bookmark.canonicalUrl && <div><span>Canonical</span><code>{bookmark.canonicalUrl}</code></div>}
        {bookmark.finalUrl && <div><span>Resolved</span><code>{bookmark.finalUrl}</code></div>}
        {bookmark.metadataFetchedAt && <small>Metadata fetched {new Date(bookmark.metadataFetchedAt).toLocaleString()}</small>}
      </div>
    </article>
  );
}

export function DuplicateReviewPage() {
  const [result, setResult] = useState<DuplicateReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | DuplicateCandidateKind>("all");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setResult(await getDuplicateReview());
      setHiddenIds(new Set());
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const visible = useMemo(() => (result?.candidates ?? []).filter((candidate) =>
    !hiddenIds.has(candidate.id) &&
    (kind === "all" || candidate.kind === kind) &&
    matches(candidate, query),
  ), [hiddenIds, kind, query, result]);

  function hide(id: string) {
    setHiddenIds((current) => new Set(current).add(id));
  }

  const stats = result?.stats;

  return (
    <main className="duplicate-shell">
      <section className="duplicate-hero">
        <div>
          <p className="eyebrow">V5 · DUPLICATE REVIEW</p>
          <h1>Evidence first.<br />No silent cleanup.</h1>
          <p>Dockmark compares saved URLs with metadata canonical and resolved targets, then surfaces conservative duplicate candidates for human review. This workspace never merges, edits or deletes bookmarks.</p>
        </div>
        <button className="secondary" type="button" disabled={loading} onClick={() => void refresh()}>{loading ? "Analyzing…" : "Refresh review"}</button>
      </section>

      {error && <div className="error-banner" role="alert">{error}</div>}

      <section className="duplicate-stats" aria-label="Duplicate review summary">
        <div><strong>{stats?.totalCandidates ?? 0}</strong><span>candidate pairs</span></div>
        <div><strong>{stats?.canonicalCandidates ?? 0}</strong><span>canonical</span></div>
        <div><strong>{stats?.resolvedCandidates ?? 0}</strong><span>resolved</span></div>
        <div><strong>{stats?.normalizedCandidates ?? 0}</strong><span>URL variants</span></div>
        <div><strong>{stats?.metadataBookmarks ?? 0}/{stats?.analyzedBookmarks ?? 0}</strong><span>with metadata</span></div>
      </section>

      {(stats?.bookmarkAnalysisTruncated || stats?.candidateListTruncated) && (
        <div className="inline-form-feedback" role="status">
          {stats.bookmarkAnalysisTruncated && <>Analysis is limited to the most recently updated {stats.analyzedBookmarks} bookmarks. </>}
          {stats.candidateListTruncated && <>Showing the first {result?.candidates.length ?? 0} of {stats.totalCandidates} candidate pairs.</>}
        </div>
      )}

      <section className="duplicate-toolbar panel">
        <label>
          <span>Search review queue</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, URL, category or evidence target…" />
        </label>
        <label>
          <span>Evidence</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as "all" | DuplicateCandidateKind)}>
            <option value="all">All evidence</option>
            <option value="canonical">Canonical target</option>
            <option value="resolved">Resolved target</option>
            <option value="normalized">URL variant</option>
          </select>
        </label>
        <div className="duplicate-toolbar-state">
          <strong>{visible.length} visible</strong>
          {hiddenIds.size > 0 && <button className="text-action" type="button" onClick={() => setHiddenIds(new Set())}>Restore {hiddenIds.size} hidden</button>}
        </div>
      </section>

      <section className="duplicate-list">
        {loading && !result ? <div className="panel duplicate-empty">Analyzing saved bookmark and metadata evidence…</div> : visible.map((candidate) => (
          <article className={`panel duplicate-candidate kind-${candidate.kind}`} key={candidate.id}>
            <header className="duplicate-candidate-heading">
              <div>
                <div className="duplicate-kind-row">
                  <span className="duplicate-kind">{kindLabels[candidate.kind]}</span>
                  <small>{kindDescriptions[candidate.kind]}</small>
                </div>
                <p>{candidate.reason}</p>
                {candidate.evidenceUrl && <code className="duplicate-evidence-url">{candidate.evidenceUrl}</code>}
              </div>
              <button className="text-action muted-action" type="button" onClick={() => hide(candidate.id)}>Hide for now</button>
            </header>
            <div className="duplicate-pair">
              <MemberCard side="left" candidate={candidate} />
              <div className="duplicate-vs" aria-hidden="true">≈</div>
              <MemberCard side="right" candidate={candidate} />
            </div>
            <footer className="duplicate-candidate-footer">
              <span>Recommendation only — decide in Library / Metadata & Health before changing anything.</span>
              <div>
                <a className="secondary" href={candidate.left.url} target="_blank" rel="noreferrer">Open A</a>
                <a className="secondary" href={candidate.right.url} target="_blank" rel="noreferrer">Open B</a>
              </div>
            </footer>
          </article>
        ))}
        {!loading && result && visible.length === 0 && (
          <div className="panel duplicate-empty">
            <strong>{result.stats.totalCandidates ? "No candidates match this view." : "No duplicate candidates found."}</strong>
            <span>{result.stats.metadataBookmarks < result.stats.analyzedBookmarks ? "Fetching metadata for public bookmarks can reveal additional canonical or resolved-target evidence." : "Current URL and metadata evidence does not suggest duplicate pairs."}</span>
          </div>
        )}
      </section>
    </main>
  );
}
