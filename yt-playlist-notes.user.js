// ==UserScript==
// @name         YT Playlist Notes
// @namespace    https://github.com/chirag127
// @version      1.0.2
// @description  One note per video on a playlist, kept in synced storage, with a dot on every row that already has one.
// @author       chirag127
// @license      MIT
// @match        https://www.youtube.com/*
// @require      https://raw.githubusercontent.com/chirag127/yt-core-lib/main/yt-core-lib-1.4.0.js
// @downloadURL  https://raw.githubusercontent.com/chirag127/yt-playlist-notes-userscript/main/yt-playlist-notes.user.js
// @updateURL    https://raw.githubusercontent.com/chirag127/yt-playlist-notes-userscript/main/yt-playlist-notes.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      *
// @noframes
// @run-at       document-idle
// ==/UserScript==

/*
 * One storage key per video: `ytk.note.<videoId>` = { text, at }. ScriptCat's cloud
 * sync replicates script storage, so notes follow the account to another browser.
 * Nothing is ever written to YouTube.
 *
 * ONE menu entry: `Settings…` opens the shared settings popup. Writing a note is an
 * action, so it lives on the toolbar and on a row button inside the panel.
 *
 * The marker is display-only: a single span after the row title, repainted after
 * navigation and on scroll. No HTML string is ever assigned.
 */

(function () {
  'use strict';

  if (typeof Ytk === 'undefined') { console.error('[yt-playlist-notes] core did not load'); return; }
  if (!Ytk.featureOn('notes', true)) return;
  if (!onPlaylistSurface()) return;

  const KEY = 'note.';
  const MARK = 'ytk-notes-mark';
  const ROW_SEL = 'yt-lockup-view-model, ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer';
  const TITLE_SEL = 'yt-lockup-metadata-view-model h3 a, yt-lockup-metadata-view-model h3, a#video-title, #video-title';
  const ID_RE = /[?&]v=([A-Za-z0-9_-]{11})/;
  const BTN = 'font:inherit;font-size:11.5px;padding:4px 9px;border-radius:8px;cursor:pointer;'
    + 'border:1px solid #3a3a3a;background:#262626;color:#eaeaea';

  /** The playlist page, or a watch page that has a playlist in the URL or sidebar. */
  function onPlaylistSurface() {
    if (location.pathname === '/playlist') return true;
    if (new URLSearchParams(location.search).get('list')) return true;
    return !!document.querySelector('ytd-playlist-panel-renderer');
  }

  function raw() { return Ytk.storeGet('settings', {}) || {}; }

  /** Numbers live in the raw settings blob; 0 must stay 0, so never use `||`. */
  function num(key, dflt) {
    const value = parseInt(raw()[key], 10);
    return isNaN(value) ? dflt : value;
  }

  function rowRoot() {
    return location.pathname === '/playlist'
      ? document.querySelector('ytd-playlist-video-list-renderer') || document.querySelector('ytd-browse[page-subtype="playlist"]')
      : document.querySelector('ytd-playlist-panel-renderer');
  }

  /** Rendered rows, whichever DOM generation YouTube is serving today. */
  function rowNodes() {
    const root = rowRoot();
    return root ? Array.from(root.querySelectorAll(ROW_SEL)) : [];
  }

  function idOf(node) {
    const row = Ytk.readRowNode(node);
    return row && row.id ? row.id : null;
  }

  function titleOf(node) {
    const row = Ytk.readRowNode(node);
    return row && row.title ? row.title.trim() : '';
  }


  /** Saved note for a video, or null when there is nothing to show. */
  function readNote(id) {
    const saved = Ytk.storeGet(KEY + id, null);
    return saved && typeof saved.text === 'string' && saved.text ? saved : null;
  }

  function saveNote(id, text) {
    if (text) Ytk.storeSet(KEY + id, { text: text, at: Date.now() });
    else Ytk.storeDel(KEY + id);
  }

  // ---------------------------------------------------------------- row markers

  /** The title element, or the link wrapping it, so the dot never lands inside a link. */
  function markerAnchor(node) {
    const title = node.querySelector(TITLE_SEL);
    if (!title) return null;
    return title.closest('a') || title;
  }

  function paintMarkers() {
    const show = raw().notesShowMarkers !== false;
    const nodes = rowNodes();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const existing = node.querySelector('.' + MARK);
      const id = idOf(node);
      const saved = id ? readNote(id) : null;
      const host = markerAnchor(node);
      if (!show || !saved || !host || !host.parentNode) {
        if (existing) existing.remove();
        continue;
      }
      if (existing) { existing.setAttribute('title', saved.text); continue; }
      const dot = Ytk.h('span', {
        class: MARK,
        text: '●',
        title: saved.text,
        style: 'color:#ffd479;font-size:10px;margin-left:6px;vertical-align:middle'
      });
      if (host.nextSibling) host.parentNode.insertBefore(dot, host.nextSibling);
      else host.parentNode.appendChild(dot);
    }
  }

  let paintTimer = null;
  function schedulePaint() {
    if (paintTimer) clearTimeout(paintTimer);
    paintTimer = setTimeout(function () {
      paintTimer = null;
      try { paintMarkers(); } catch (e) { /* the page was mid-navigation */ }
    }, 400);
  }

  // ---------------------------------------------------------------- panel

  let bodyEl = null;

  function openNotes() {
    if (!onPlaylistSurface()) { Ytk.toast('Open a playlist first'); return; }
    if (!rowNodes().length) { Ytk.toast('No playlist rows loaded yet'); return; }
    bodyEl = null;
    Ytk.panel('Playlist notes', function (body) {
      bodyEl = body;
      render(body);
    });
  }

  function render(body) {
    const settings = raw();
    const maxChars = Math.max(40, num('notesMaxChars', 280));
    const rows = rowNodes().map(function (node) {
      return { node: node, id: idOf(node), title: titleOf(node) };
    }).filter(function (row) { return row.id; });

    const withNote = rows.filter(function (row) { return !!readNote(row.id); });
    const withoutNote = rows.filter(function (row) { return !readNote(row.id); });
    const ordered = settings.notesSortFirst ? withNote.concat(withoutNote) : rows;

    body.textContent = '';
    Ytk.kv(body, 'Rows loaded', rows.length);
    Ytk.kv(body, 'Rows with a note', withNote.length);
    Ytk.note(body, 'Each note is stored under ytk.note.[videoId], so ScriptCat cloud sync carries it between browsers. Nothing is written to YouTube.');

    if (!rows.length) {
      Ytk.note(body, 'No rows have rendered yet. Scroll the playlist and open this panel again.', 'ytk2-warn');
      return;
    }

    ordered.forEach(function (row) {
      const saved = readNote(row.id);
      const button = Ytk.h('button', { text: saved ? 'Edit' : 'Add', style: BTN });
      button.addEventListener('click', function () { edit(row, maxChars); });
      body.appendChild(Ytk.h('div', { class: 'ytk2-row' },
        Ytk.h('span', { text: saved ? '●' : '·', style: 'flex:0 0 12px;color:' + (saved ? '#ffd479' : '#4a4a4a') }),
        Ytk.h('span', { class: 'grow', text: row.title || row.id }),
        button
      ));
      if (saved) {
        body.appendChild(Ytk.h('div', {
          style: 'padding:0 0 7px 20px;color:#9a9a9a;line-height:1.5;white-space:pre-wrap',
          text: saved.text
        }));
      }
    });
  }

  function edit(row, maxChars) {
    const saved = readNote(row.id);
    const answer = prompt('Note for “' + (row.title || row.id) + '” — up to ' + maxChars + ' characters', saved ? saved.text : '');
    if (answer === null) return;
    const text = answer.trim().slice(0, maxChars);
    saveNote(row.id, text);
    paintMarkers();
    if (bodyEl) render(bodyEl);
    Ytk.toast(text ? 'Note saved' : 'Note deleted');
  }

  function clearPlaylistNotes() {
    const ids = rowNodes().map(idOf).filter(function (id) { return id && readNote(id); });
    if (!ids.length) { Ytk.toast('This playlist has no notes'); return; }
    if (!confirm('Delete ' + ids.length + ' note(s) on this playlist? This cannot be undone.')) return;
    ids.forEach(function (id) { saveNote(id, ''); });
    paintMarkers();
    if (bodyEl) render(bodyEl);
    Ytk.toast('Deleted ' + ids.length + ' note(s)');
  }

  // ---------------------------------------------------------------- settings

  function settingsPopup() {
    const before = raw();
    Ytk.openSettings({
      title: 'YT Playlist Notes',
      subtitle: 'One note per playlist video. These options change how notes are shown, never what is stored.',
      sectionTitle: 'Notes',
      fields: [
        {
          key: 'notesShowMarkers',
          label: 'Mark rows that have a note with a dot',
          type: 'checkbox',
          def: raw().notesShowMarkers !== false
        },
        {
          key: 'notesSortFirst',
          label: 'List rows that have a note first',
          type: 'checkbox',
          def: !!raw().notesSortFirst
        },
        {
          key: 'notesMaxChars',
          label: 'Longest note, in characters',
          type: 'number',
          def: num('notesMaxChars', 280),
          hint: 'Anything longer is cut when you save it. 40 is the floor.'
        }
      ],
      actions: [
        { label: 'Open the notes panel', run: openNotes },
        { label: 'Delete every note on this playlist', run: clearPlaylistNotes }
      ],
      // Core 1.3.0 rebuilds ytk.settings from its own defaults on save, so merge back.
      onSave: function (next) { Ytk.storeSet('settings', Object.assign({}, before, next)); }
    });
  }

  GM_registerMenuCommand('Settings…', settingsPopup);

  // ---------------------------------------------------------------- boot

  Ytk.mountToolbar([{ label: 'Notes', run: openNotes }]);
  schedulePaint();

  // YouTube is a single-page app: rows arrive after navigation and after scrolling.
  document.addEventListener('yt-navigate-finish', schedulePaint);
  document.addEventListener('yt-page-data-updated', schedulePaint);
  window.addEventListener('scroll', schedulePaint, { passive: true });
})();
