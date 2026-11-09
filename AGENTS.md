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
6. **Core is required, pinned:** `@require …/yt-core-lib-1.3.0.js`. Row extraction uses
   `Ytk.lockupToItem`; nothing in the core is re-implemented.

## Why the code looks the way it does

- **Two row shapes.** Current playlists render `yt-lockup-view-model` (id in `node.contentId`,
  title in `node.metadata.lockupMetadataViewModel.title.content`); older sessions render
  `ytd-playlist-video-renderer` / `ytd-playlist-panel-video-renderer`. `idOf()` tries the lockup
  view model, then `contentId`, then an `a[href*="v="]` anchor, so neither shape is a dead end.
- **The marker must not land inside a link.** `markerAnchor()` returns the title's enclosing
  anchor when there is one and the dot is inserted *after* it, otherwise clicking the dot would
  open the video.
- **No `MutationObserver`.** Repainting is driven by `yt-navigate-finish`,
  `yt-page-data-updated` and a debounced scroll listener. That is cheap and it does not fight
  YouTube's renderer. The cost is documented in the README: a row re-rendered on hover can lose
  its dot until the next scroll.
- **`prompt()` for editing.** A text field inside the floating panel would swallow keyboard
  shortcuts and needs focus management to be usable; the browser dialog does not.
- **Script-specific settings are read from the raw blob.** `Ytk.settings()` returns only the core's
  own `DEFAULTS` keys, so every `notes*` key is read with `raw()` (`Ytk.storeGet('settings', {})`).
  Each field's `def` is seeded from the stored value for the same reason — `openSettings` resolves
  its values through `Ytk.settings()`, which cannot see `notesMaxChars`.
- **Settings survive because of `onSave`.** Core 1.3.0's `openSettings` writes
  `ytk.settings` through `saveSettings`, which starts from the core defaults and drops keys it does
  not know (`notesShowMarkers`, `notesSortFirst`, `notesMaxChars`). The `onSave` merge puts them
  back.
- **The AI grants stay.** The settings popup renders the shared AI section, which calls
  `GM_xmlhttpRequest`; without `@grant GM_xmlhttpRequest` + `@connect *` its test fails.

## Verification before claiming a change works

```bash
node --check yt-playlist-notes.user.js
grep -c "GM_registerMenuCommand('Settings…', settingsPopup);" yt-playlist-notes.user.js   # 1
grep -c "innerHTML" yt-playlist-notes.user.js                                            # 0
```

Then check it on a real playlist: add a note to a row, confirm the dot appears without a reload,
reload, confirm the dot and the note text are still there, then delete the note and confirm the
key is gone and the dot disappears. Static checks alone are not a live test.
