// ==UserScript==
// @name         YT Playlist Notes
// @namespace    https://github.com/chirag127
// @version      1.0.4
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
 * The marker is display-only: a single span after the row title, kept in place
 * across row replacements by a scoped observer. No HTML string is ever assigned.
 */

(function () {
  'use strict';

  if (typeof Ytk === 'undefined') { console.error('[yt-playlist-notes] core did not load'); return; }

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
    return location.pathname === '/watch' && (
      !!new URLSearchParams(location.search).get('list') ||
      !!document.querySelector('ytd-playlist-panel-renderer')
    );
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

  let markerRoot = null;
  let unmountToolbar = null;
  let suspended = false;
  let paintTimer = null;
  let discoveryTimer = null;
  let paintAll = false;
  const pendingRows = new Set();
  const markers = new Map();
  const rowOptions = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href'] };

  const rowObserver = new MutationObserver(function (records) {
    if (!markersEnabled() || rowRoot() !== markerRoot) { refresh(); return; }
    collectChanges(records);
    if (pendingRows.size) schedulePaint();
  });
  const ownerObserver = new MutationObserver(function () {
    if (!markerRoot || !markerRoot.isConnected || rowRoot() !== markerRoot) refresh();
    else watchParents();
  });
  const discoveryObserver = new MutationObserver(function () {
    if (!markersEnabled() || rowRoot()) refresh();
  });

  function active() {
    return !suspended && Ytk.featureOn('notes', true) && onPlaylistSurface();
  }

  function markersEnabled() { return active() && raw().notesShowMarkers !== false; }

  function collectRows(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(ROW_SEL)) pendingRows.add(node);
    node.querySelectorAll(ROW_SEL).forEach(function (row) { pendingRows.add(row); });
  }

  function collectChanges(records) {
    records.forEach(function (record) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const row = target && target.closest(ROW_SEL);
      if (row) pendingRows.add(row);
      record.addedNodes.forEach(collectRows);
      record.removedNodes.forEach(collectRows);
    });
  }

  function removeMarker(node) {
    const dot = markers.get(node);
    if (dot) dot.remove();
    markers.delete(node);
    node.querySelectorAll('.' + MARK).forEach(function (mark) { mark.remove(); });
  }

  function paintRow(node) {
    if (!node.isConnected || !markerRoot.contains(node)) { removeMarker(node); return; }
    const id = idOf(node);
    const saved = id ? readNote(id) : null;
    const host = markerAnchor(node);
    if (!saved || !host || !host.parentNode) { removeMarker(node); return; }

    let dot = node.querySelector('.' + MARK);
    const owned = markers.get(node);
    if (owned && owned !== dot) owned.remove();
    node.querySelectorAll('.' + MARK).forEach(function (mark) { if (mark !== dot) mark.remove(); });
    if (!dot) {
      dot = Ytk.h('span', {
        class: MARK,
        text: '●',
        title: saved.text,
        style: 'color:#ffd479;font-size:10px;margin-left:6px;vertical-align:middle'
      });
    }
    if (dot.getAttribute('title') !== saved.text) dot.setAttribute('title', saved.text);
    if (dot.textContent !== '●') dot.textContent = '●';
    if (host.nextSibling !== dot) host.parentNode.insertBefore(dot, host.nextSibling);
    markers.set(node, dot);
  }

  function flushPaint() {
    if (paintTimer !== null) clearTimeout(paintTimer);
    paintTimer = null;
    if (!markerRoot || !markersEnabled() || rowRoot() !== markerRoot) { refresh(); return; }

    // Keep page changes queued before this paint, but never observe our own DOM writes.
    collectChanges(rowObserver.takeRecords());
    rowObserver.disconnect();
    if (paintAll) {
      markerRoot.querySelectorAll(ROW_SEL).forEach(function (row) { pendingRows.add(row); });
      markers.forEach(function (dot, row) { if (!markerRoot.contains(row)) pendingRows.add(row); });
    }
    paintAll = false;
    const rows = Array.from(pendingRows);
    pendingRows.clear();
    try { rows.forEach(paintRow); }
    finally { rowObserver.observe(markerRoot, rowOptions); }
  }

  function paintMarkers() {
    paintAll = true;
    flushPaint();
  }

  function schedulePaint() {
    // A busy row must not keep postponing its repaint.
    if (paintTimer === null) paintTimer = setTimeout(flushPaint, 400);
  }

  function watchParents() {
    ownerObserver.disconnect();
    // Shallow ancestry watches detect root removal/reparenting without observing other subtrees.
    for (let parent = markerRoot.parentNode; parent; parent = parent.parentNode) {
      ownerObserver.observe(parent, { childList: true });
    }
  }

  function stopDiscovery() {
    discoveryObserver.disconnect();
    if (discoveryTimer !== null) clearTimeout(discoveryTimer);
    discoveryTimer = null;
  }

  function stopMarkers() {
    rowObserver.disconnect();
    ownerObserver.disconnect();
    stopDiscovery();
    if (paintTimer !== null) clearTimeout(paintTimer);
    paintTimer = null;
    paintAll = false;
    pendingRows.clear();
    markers.forEach(function (dot) { dot.remove(); });
    markers.clear();
    markerRoot = null;
  }

  function refresh() {
    if (!active()) {
      stopMarkers();
      if (unmountToolbar) { unmountToolbar(); unmountToolbar = null; }
      if (notesPanel) { notesPanel.close(); notesPanel = null; }
      bodyEl = null;
      return;
    }
    if (!unmountToolbar) unmountToolbar = Ytk.mountToolbar([{ label: 'Notes', run: openNotes }]);
    if (!markersEnabled()) { stopMarkers(); return; }

    const next = rowRoot();
    if (next !== markerRoot) {
      stopMarkers();
      markerRoot = next;
      if (markerRoot) {
        rowObserver.observe(markerRoot, rowOptions);
        watchParents();
      }
    }
    if (!markerRoot) {
      if (discoveryTimer === null) {
        discoveryObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
        // Late roots get a bounded discovery window; later page/scroll events can retry.
        discoveryTimer = setTimeout(stopDiscovery, 10000);
      }
      return;
    }
    paintAll = true;
    schedulePaint();
  }

  // ---------------------------------------------------------------- panel

  let bodyEl = null;
  let notesPanel = null;

  function openNotes() {
    if (!Ytk.featureOn('notes', true)) return;
    if (!onPlaylistSurface()) { Ytk.toast('Open a playlist first'); return; }
    if (!rowNodes().length) { Ytk.toast('No playlist rows loaded yet'); return; }
    bodyEl = null;
    notesPanel = Ytk.panel('Playlist notes', function (body) {
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
      // Core 1.4.0 saves the raw fields before passing its core-only settings view here.
      onSave: function (next) {
        Ytk.storeSet('settings', Object.assign({}, before, raw(), next));
        refresh();
      }
    });
  }

  GM_registerMenuCommand('Settings…', settingsPopup);

  // ---------------------------------------------------------------- boot

  function suspend() { suspended = true; refresh(); }
  function resume() { suspended = false; refresh(); }

  document.addEventListener('yt-navigate-start', suspend);
  document.addEventListener('yt-navigate-finish', resume);
  document.addEventListener('yt-page-data-updated', refresh);
  window.addEventListener('scroll', function () {
    // Observed rows repaint from mutations; scrolling only needs lifecycle recovery.
    if (!markerRoot || !markersEnabled() || rowRoot() !== markerRoot) refresh();
  }, { passive: true });
  window.addEventListener('storage', function (event) {
    if (event.key === null || event.key === 'ytk.settings' || event.key.indexOf('ytk.note.') === 0) refresh();
  });
  window.addEventListener('pagehide', suspend);
  window.addEventListener('pageshow', resume);
  refresh();
})();
