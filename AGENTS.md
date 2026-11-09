# AGENTS.md — yt-playlist-notes-userscript

Read the collection [`AGENTS.md`](../AGENTS.md) and [`PLAN.md`](../PLAN.md) first. Documentation
lives once in the umbrella repo at `c:\ws\docs\okf\` — do not copy it here.

## Rules for this script

1. Requires `yt-core-lib`. Never copy storage, InnerTube or UI code here.
2. **EXACTLY ONE context-menu entry**: `Settings…` calling `Ytk.openSettings({...})`. Adding and
   editing a note are *actions*, so they live on the toolbar and inside the panel — not in the menu.
3. The action button comes from `Ytk.mountToolbar`. Never draw a bar or a floating widget.
4. No `innerHTML` — YouTube enforces Trusted Types and the throw is silent inside handlers.
   Use `Ytk.h`, `Ytk.panel`, `Ytk.kv`, `Ytk.note`, `Ytk.toast`.
5. **Read-only towards YouTube.** The only write is its own note key in GM storage.
6. Storage is exactly `Ytk.storeSet('note.' + videoId, { text, at })`, which is `ytk.note.<videoId>`
   after the core's namespace. Deleting a note is `Ytk.storeDel`. Do not invent a second shape or a
   second namespace: ScriptCat's cloud sync only replicates script storage.
7. Gate on `Ytk.featureOn('notes', true)` and return early when off; then guard on the page
   (`playlistId()` first — the guard uses it, so both stay in sync).
8. Rows come in two shapes: current `yt-lockup-view-model` and legacy
   `ytd-playlist-video-renderer` / `ytd-playlist-panel-video-renderer`. Handle all of them.
9. **No MutationObserver.** Dots are painted at boot, on `yt-navigate-finish`, and after every
   note change. If that ever proves insufficient, change it in one place (`scheduleDots`) rather
   than adding a second observer.

## Verified DOM facts

- Lockup rows: id = `node.contentId`, title = `node.metadata.lockupMetadataViewModel.title.content`.
  Both are JS properties on the custom element, not attributes; fall back to `a[href*="v="]` and the
  title anchor when they are missing.
- Duration is only a string (`/^\d{1,2}:\d{2}(?::\d{2})?$/`) inside a deep walk of `content`,
  `text` and `simpleText` keys.
- Inserting the dot **after** the title anchor, never inside it, or the row's link text changes.

## Not done / uncertain

- The dot is not updated when YouTube re-renders a single row in place (e.g. the row re-cycles as it
  scrolls out of the virtualised list). It is repainted on the next navigation or note change.
- Notes are not indexed: listing "all notes across all playlists" would need `GM_listValues`, which
  this script does not request.

## Shared toolbar caveat (core 1.2.0)

Each userscript runs in its own sandbox, so the core's `toolbarEl` module state is **per script**.
With several collection scripts installed, core 1.2.0 therefore draws one `.ytk2-bar` per script, all
at `left:16px;bottom:16px` — they overlap and only the top one is clickable. Core **1.3.0** fixes it
by reusing the bar already in the DOM (`toolbarEl = document.querySelector('.ytk2-bar')`).

This repo pins the versioned `yt-core-lib-1.2.0.js` URL on purpose (immutable require, no surprise
core changes). When the collection moves to 1.3.0 on `main`, bump the `@require` here in the same
commit as the rest — do not point at the unversioned `yt-core-lib.js`.
