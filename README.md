# YT Playlist Notes

One note per video on a playlist — "skip to 4:20", "part 2 of the series", "the good version".

- A small **●** appears after the title of every row that already has a note.
- The **Notes** button on the shared toolbar opens a panel with every row on the page, the saved
  note shown inline, and an **Add** / **Edit** button per row.
- Notes live in ScriptCat storage as `ytk.note.<videoId>` = `{ text, at }`, so ScriptCat's cloud
  sync carries them to another browser. The `at` timestamp is the moment the note was last saved.
- Nothing is written to YouTube: no playlist edit, no comment, no like, no request.

A note belongs to the video, not to the playlist. The same video in two playlists shows the same
note, and deleting a row from a playlist does not delete the note.

## Where it runs

- `youtube.com/playlist?list=…`
- a watch page that has a playlist in the URL or in the sidebar

## Settings

One entry — **Settings…** — opens the shared settings popup.

| Field | Key | Default | Purpose |
|---|---|---|---|
| Mark rows that have a note with a dot | `notesShowMarkers` | on | turns the ● marker on or off |
| List rows that have a note first | `notesSortFirst` | off | the panel groups noted rows at the top |
| Longest note, in characters | `notesMaxChars` | 280 | longer text is cut when it is saved; 40 is the floor |

The popup also has two buttons: **Open the notes panel**, and **Delete every note on this
playlist** (asks first, and only touches the notes for the rows currently on the page).

## Editing

Writing a note is an action, not a setting, so it is a button — not a context-menu entry. Both
the add and the edit path use the browser's `prompt()`, which keeps the script small and stops it
from swallowing keyboard shortcuts while you type. An empty note deletes the stored key.

## What it does not do

- It does not read notes from, or write them to, a YouTube playlist description.
- It does not sync through any server of its own. ScriptCat cloud sync is the only transport.
- It does not scan a playlist you have not scrolled. The panel lists the rows YouTube has
  rendered, so scroll first on a long playlist.

## Known rough edge

The marker is repainted after an in-app navigation and on scroll, not by a mutation observer. If
YouTube re-renders a single row on hover, that row's dot can disappear until the next scroll.

## Install

Follow the [install guide](https://github.com/chirag127/userscript-install-guide). The script
`@require`s [yt-core-lib](https://github.com/chirag127/yt-core-lib), which is never installed on
its own.

## Docs

Collection documentation is single-sourced in the workspace bundle: `c:\ws\docs\okf\`.
