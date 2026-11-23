# apps/web/worker/
> L2 | Parent: /GEMINI.md

Cloudflare Worker HTTP API layer backed by D1 (`DB`), mounted at `router.ts` and delegating core CRUD and SPA fallback to `index.ts`.

## Member list
router.ts: Top-level Worker `fetch` dispatcher enforcing auth/device access, CSRF same-origin checks, public route exemptions (`/api/health`, `GET /api/settings/appearance`, `GET /api/public/bookmarks`), and domain handler routing
index.ts: Base Worker handling `/api/health`, `/api/categories`, `/api/bookmarks`, workspace delegation, health checks, and static asset fallback
auth.ts: Session cookie and paired-device bearer token authentication, PBKDF2 password hashing, device pairing exchange, and `/api/auth/*` endpoints
settings.ts: `/api/settings/browser` and `/api/settings/appearance` persistence in `app_settings` (theme `preference` + `locale`) plus browser bootstrap payloads
ai-organization.ts: `/api/ai/status` and `/api/ai/organize` OpenAI-compatible proxy with SSRF/redirect guards, `HealthPolicy === "normal"` gating, and locale-aware (`en` / `zh-CN`) prompt instructions
ai-batch-apply.ts: `/api/ai/apply` transactional D1 batch updater applying reviewed AI title, description, category, and tag suggestions
bookmark-details.ts: `/api/bookmarks/with-tags` and `/api/bookmarks/:id/with-tags` composite bookmark + tag create/update endpoints
capture-inbox.ts: `/api/capture/review`, `/api/inbox`, `/api/inbox/count`, and inbox triage/dismissal routes
capture-write.ts: `/api/capture/bookmark` and `/api/capture/batch` extension-authenticated capture write routes with duplicate handling
change-journal.ts: `/api/library/change-journal` audit log reader and journal entry recorder for reversible library mutations
duplicate-review.ts: `/api/library/duplicates` duplicate URL group detection and reviewed merge/archive actions
health-check.ts: Server-side bookmark reachability probing respecting `HealthPolicy` and recording `health_checks` rows
library-batch-maintenance.ts: Active/archived bookmark listing (`/api/bookmarks`, `/api/bookmarks/archived`) and `/api/bookmarks/batch-maintenance` bulk archive/restore/policy updates
library-batch-organize.ts: `/api/bookmarks/batch-organize` bulk category and tag assignment for selected bookmarks
local-health-result.ts: Extension-reported local-network bookmark health probe ingestion
metadata.ts: Safe public URL title/description/icon fetcher for bookmark metadata enrichment
public-bookmarks.ts: `/api/public/bookmarks` public curated listing and `/api/public/bookmarks/selection` owner curation controls
reorder.ts: `/api/categories/reorder` and `/api/bookmarks/reorder` position persistence
search-engines.ts: `/api/search-engines` CRUD and default engine selection backed by `@dockmark/core` keyword/template validation
sessions.ts: `/api/sessions` saved browser tab-window snapshots and item CRUD
smart-collections.ts: `/api/smart-collections` saved filter collection CRUD
tags.ts: `/api/bookmark-tags` and `/api/bookmarks/:id/tags` normalized tag association endpoints
workspaces.ts: `/api/workspaces` named workspace and workspace item CRUD with open-mode and URL policy normalization

[PROTOCOL]: Update this header on change, then check GEMINI.md
