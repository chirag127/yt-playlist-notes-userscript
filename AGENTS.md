# AGENTS.md — YT Playlist Notes

Read the collection rules first: [`../AGENTS.md`](../AGENTS.md). Documentation lives once in
`c:\ws\docs\okf\` — do not create an `okf/` copy here.

## What this repo is

One userscript, one job: keep a text note per video on a playlist and show it next to the row.
Read-only towards YouTube.

## Non-negotiables

1. **Exactly one context-menu entry**, `Settings…`, calling `Ytk.openSettings` — nothing else.
2. **No `innerHTML`.** Panel content uses `Ytk.kv`, `Ytk.note` and `Ytk.h` only.
3. **Shared toolbar and shared panel only.** The one button is registered with
   `Ytk.mountToolbar([{ label: 'Notes', run: openNotes }])`. No second bar, no floating widget.
4. **One storage key per video**: `ytk.note.<videoId>` = `{ text, at }` via
   `Ytk.storeSet` / `Ytk.storeDel`. Deleting a note removes the key; it does not store an empty
   object.
5. **No YouTube writes.** This script never calls `addVideos`, `removeVideos`, `createPlaylist`
   or any other endpoint.
6. **Core is required, pinned:** `@require …/yt-core-lib-1.4.0.js`. Row extraction uses
   `Ytk.readRowNode`; nothing in the core is re-implemented.

## Why the code looks the way it does

- **Two row shapes.** Current playlists render `yt-lockup-view-model` (id in `node.contentId`,
  title in `node.metadata.lockupMetadataViewModel.title.content`); older sessions render
  `ytd-playlist-video-renderer` / `ytd-playlist-panel-video-renderer`. Both id and title lookups
  delegate to the pinned core's `Ytk.readRowNode`.
- **The marker must not land inside a link.** `markerAnchor()` returns the title's enclosing
  anchor when there is one and the dot is inserted *after* it, otherwise clicking the dot would
  open the video.
- **Scoped marker observation replaces the old event-only tradeoff.** A single-row or title
  replacement need not emit navigation or scroll events. Observe the playlist root, collect
  affected rows, and coalesce paints without postponing them on each mutation. Drain pending
  records before disconnecting during marker writes to prevent feedback and lost page changes.
- **Observation has an owner and a lifetime.** Shallow ancestry watches detect root replacement.
  Missing roots get a ten-second discovery window, retried by later page/scroll events. Release
  observers, queued rows and owned dots on root changes, disabling markers, navigation or
  `pagehide`. Feature disable/navigation also unmount this script's shared toolbar contribution;
  `pageshow` and playlist arrival can mount it again.
- **Scroll is a recovery signal.** Reconcile missing/replaced roots and disabled markers on scroll;
  an unchanged observed root relies on affected-row mutations instead of whole-playlist scans.
  Page/settings events and note edits still refresh markers.
- **`prompt()` for editing.** A text field inside the floating panel would swallow keyboard
  shortcuts and needs focus management to be usable; the browser dialog does not.
- **Script-specific settings are read from the raw blob.** `Ytk.settings()` returns only the core's
  own `DEFAULTS` keys, so every `notes*` key is read with `raw()` (`Ytk.storeGet('settings', {})`).
  Each field's `def` is seeded from that blob.
- **Preserve the just-saved settings.** Core 1.4.0's `openSettings` saves raw fields, then passes
  its core-only settings view to `onSave`. Merge the current raw blob as well as the prior values
  and callback argument, or saving the marker toggle restores its old value. Refresh the marker
  lifecycle after saving; preserve unknown keys.
- **The AI grants stay.** The settings popup renders the shared AI section, which calls
  `GM_xmlhttpRequest`; without `@grant GM_xmlhttpRequest` + `@connect *` its test fails.

## Verification before claiming a change works

```bash
node --check yt-playlist-notes.user.js
grep -c "GM_registerMenuCommand('Settings…', settingsPopup);" yt-playlist-notes.user.js   # 1
grep -c "innerHTML" yt-playlist-notes.user.js                                            # 0
node --test tests/markers.test.cjs
```

The browser tests need Playwright with `page.clock` support and an installed Chromium browser.
They load the production script and the sibling `yt-core-lib/yt-core-lib-1.4.0.js`, use native DOM
and mutation delivery, and mock GM storage/menu APIs in a fresh context with network requests
fulfilled locally or blocked. For an isolated worktree, set `YT_CORE_PATH` to the existing pinned
core file. `PLAYWRIGHT_MODULE` can point to an existing Playwright package directory, and
`PLAYWRIGHT_CHANNEL=chrome` selects installed Chrome. `NOTES_SOURCE` selects a baseline script;
`NOTES_ARTIFACTS` optionally saves screenshots. These fixtures are not a live YouTube test.

Then check it on a real playlist: add a note to a row, confirm the dot appears without a reload,
reload, confirm the dot and the note text are still there, then delete the note and confirm the
key is gone and the dot disappears. Static checks alone are not a live test.
