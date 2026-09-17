# V5 reviewed Browser ↔ Dockmark synchronization

V5 closes the deferred two-way bookmark-sync question by keeping synchronization reviewed and directional rather than enabling silent background mutation.

## Adopted model

- Browser bookmark events only mark the Transfer snapshot as stale; they never mutate Dockmark automatically.
- **Apply safe changes** remains an explicit Browser → Dockmark action for one-sided browser title/URL drift, stale mapping metadata, and browser-side deletion cleanup.
- A browser-side deletion may unlink the extension-local mapping, but it never deletes the Dockmark bookmark.
- A one-sided Dockmark title/URL change may be resolved with an explicit **Write Dockmark → Browser** action. Browser folders are never moved by writeback.
- `Prefer Browser` / `Prefer Dockmark` are review guidance. Applying the preferred policy still requires a click, and true two-sided conflicts remain per-item decisions.
- Re-link changes only the extension-local mapping; it does not edit either bookmark.
- No setting enables continuous or background Browser ↔ Dockmark writes.

## Archive / delete boundary

The active Library intentionally hides archived bookmarks. Therefore a mapped bookmark whose Dockmark target is archived or permanently deleted appears to Transfer as `DOCKMARK MISSING`.

`DOCKMARK MISSING` is **not** safe to apply. Dockmark must never recreate that target automatically from the browser because doing so would override an explicit archive/delete decision.

Recovery is reviewed instead:

1. If the bookmark was archived intentionally, restore it from the Library and refresh the browser snapshot. The original mapping can become healthy again because the bookmark id is preserved by archive/restore.
2. If the Dockmark bookmark was deliberately deleted, unlink the stale mapping. If the browser bookmark should point at Dockmark again, use the normal reviewed import/map flow after unlinking.
3. If the user truly wants the browser bookmark imported again after deletion, that import/map step is an explicit new decision rather than a side effect of Safe Apply.

## Safety invariants

- Safe Apply never writes browser bookmarks.
- Explicit browser writeback changes only the mapped bookmark title + URL.
- Browser deletion never deletes Dockmark data.
- Dockmark archive/delete never causes automatic browser-driven recreation.
- Folder/category divergence and genuine two-sided drift remain review-only.
- Extension-local mappings and metadata baselines are not authoritative cloud records and can be unlinked without deleting either side.

## Manual validation targets

These behaviors depend on a real browser bookmark tree, extension permission, local extension storage and bridge events, so CI build/type checks cannot fully prove them:

1. Change a mapped browser bookmark title, refresh Transfer, confirm `BROWSER CHANGED`, apply safe changes, and verify Dockmark updates while the browser bookmark is untouched.
2. Change a mapped Dockmark title, refresh Transfer, confirm `DOCKMARK CHANGED`, explicitly write Dockmark → Browser, and verify only that mapped browser bookmark title/URL changes.
3. Delete a mapped browser bookmark, refresh, apply safe changes, and verify the mapping is removed while the Dockmark bookmark remains.
4. Archive a mapped Dockmark bookmark, refresh Transfer, confirm `DOCKMARK MISSING` is excluded from Safe changes. Restore it in Library, refresh Transfer, and confirm the mapping reconnects without creating a duplicate.
5. Permanently delete an archived mapped Dockmark bookmark, refresh Transfer, confirm Safe Apply does not recreate it. Unlink the stale mapping explicitly.
6. Change both sides differently and confirm the row remains `REVIEW` and no batch/preference action resolves it silently.
