# YT Playlist Notes

One note per video on a playlist, kept in ScriptCat storage so its cloud sync carries them
between browsers. Rows that already have a note get a small ● dot.

## Where it runs

Playlist pages (`/playlist?list=…`) and the watch page when a playlist sidebar is open.

## Install

Read the [install guide](https://github.com/chirag127/userscript-install-guide), then:

```
https://github.com/chirag127/yt-playlist-notes-userscript/raw/main/yt-playlist-notes.user.js
```

Requires [`yt-core-lib`](https://github.com/chirag127/yt-core-lib), pulled in with `@require`.
You do not install the core yourself.

## Use it

One toolbar button, **Notes**, opens a panel listing the playlist's rows:

- **Add** / **Edit** writes a note for that row (a prompt is enough — no new UI for a one-line string).
- Empty text deletes the note.
- The bottom of the panel lists every note on this playlist, so you can read them without scrolling
  the page.

## Settings

Exactly one context-menu entry, called **Settings…**. It opens the shared in-page popup with:

| Setting | Default | Meaning |
|---|---|---|
| Mark rows that already have a note with a dot | on | the ● marker on the page |
| In the panel, list only rows that have a note | off | compact view |
| Rows in the panel | 100 | how many rows the panel draws |

The same popup carries the shared AI section and every other script's settings.

## Storage

| Key | Value |
|---|---|
| `ytk.note.<videoId>` | `{ text, at }` — `at` is the epoch ms the note was saved |

Nothing else is stored, and nothing is ever sent anywhere. ScriptCat's cloud sync replicates
script storage, so the same notes appear on every browser you run it in.

## What it does NOT do

- It never modifies the playlist, the video, or your account — this script is read-only towards YouTube.
- It does not extract notes from comments, descriptions or the AI section.
- It does not sync anywhere except through ScriptCat's own storage sync.

## License

MIT
