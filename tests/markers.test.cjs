const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const source = readFileSync(process.env.NOTES_SOURCE || path.join(__dirname, '..', 'yt-playlist-notes.user.js'), 'utf8');
const corePath = process.env.YT_CORE_PATH || path.join(__dirname, '..', '..', 'yt-core-lib', 'yt-core-lib-1.4.0.js');
const core = readFileSync(corePath, 'utf8');
const MARK = '.ytk-notes-mark';
const FIRST = 'aaaaaaaaaaa';
const SECOND = 'bbbbbbbbbbb';
const THIRD = 'ccccccccccc';
const saved = { text: 'Remember this video', at: 123456789 };
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  console.log(`Browser: ${browser.version()}`);
});

after(async () => { if (browser) await browser.close(); });

async function fixture(t, options = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url().startsWith('https://www.youtube.com/')) {
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><title>Playlist notes DOM fixture</title></head><body><ytd-app><ytd-page-manager id="fixture-pages"></ytd-page-manager></ytd-app></body></html>' });
    }
    requests.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });
  t.after(async () => {
    await context.close();
    assert.deepEqual(errors, [], 'no browser exceptions');
    assert.deepEqual(requests, [], 'the fixture must not make network requests');
  });
  await page.clock.install({ time: new Date('2026-11-20T00:00:00Z') });
  await page.goto(`https://www.youtube.com${options.url || '/playlist?list=PLfixture'}`);
  await page.clock.pauseAt(new Date('2026-11-21T00:00:00Z'));
  await page.evaluate(({ notes, settings }) => {
    window.fixtureStore = new Map([['ytk.settings', settings], ...Object.entries(notes).map(([id, note]) => ['ytk.note.' + id, note])]);
    window.fixtureDeletes = [];
    window.fixtureMenus = new Map();
    window.GM_getValue = key => structuredClone(fixtureStore.get(key));
    window.GM_setValue = (key, value) => fixtureStore.set(key, structuredClone(value));
    window.GM_deleteValue = key => { fixtureDeletes.push(key); fixtureStore.delete(key); };
    window.GM_registerMenuCommand = (name, callback) => fixtureMenus.set(name, callback);
    window.GM_xmlhttpRequest = () => { throw new Error('Unexpected network API call'); };

    // Instrument native observers; delivery and DOM matching remain browser implementations.
    const NativeObserver = window.MutationObserver;
    window.fixtureObservers = [];
    window.MutationObserver = class extends NativeObserver {
      constructor(callback) {
        const state = { targets: new Map(), callbacks: 0 };
        super((records, observer) => { state.callbacks++; callback(records, observer); });
        this.state = state;
        // Playwright also creates observers; count only those owned by the production script.
        if (new Error().stack.includes('yt-playlist-notes.user.js')) fixtureObservers.push(state);
      }
      observe(target, options) { this.state.targets.set(target, { ...options }); super.observe(target, options); }
      disconnect() { this.state.targets.clear(); super.disconnect(); }
    };

    window.fixtureRow = (id, shape = 'legacy', title = 'Fixture video') => {
      const tags = { legacy: 'ytd-playlist-video-renderer', lockup: 'yt-lockup-view-model', sidebar: 'ytd-playlist-panel-video-renderer' };
      const row = document.createElement(tags[shape]);
      row.dataset.fixtureId = id;
      row.dataset.shape = shape;
      row.style.cssText = 'display:block;padding:12px;border-bottom:1px solid #ddd';
      const holder = document.createElement('div');
      holder.className = 'fixture-title';
      const link = document.createElement('a');
      link.href = '/watch?v=' + id;
      link.textContent = title;
      if (shape === 'lockup') {
        row.contentId = id;
        row.metadata = { lockupMetadataViewModel: { title: { content: title } } };
        const metadata = document.createElement('yt-lockup-metadata-view-model');
        const heading = document.createElement('h3');
        heading.appendChild(link);
        metadata.appendChild(heading);
        holder.appendChild(metadata);
      } else {
        link.id = 'video-title';
        holder.appendChild(link);
      }
      row.appendChild(holder);
      return row;
    };
    window.fixtureMount = (shape = 'legacy', ids = ['aaaaaaaaaaa']) => {
      const surface = document.createElement(shape === 'sidebar' ? 'ytd-watch-flexy' : 'ytd-browse');
      if (shape !== 'sidebar') surface.setAttribute('page-subtype', 'playlist');
      const root = document.createElement(shape === 'sidebar' ? 'ytd-playlist-panel-renderer' : 'ytd-playlist-video-list-renderer');
      root.id = 'fixture-root';
      ids.forEach(id => root.appendChild(fixtureRow(id, shape)));
      surface.appendChild(root);
      document.querySelector('#fixture-pages').appendChild(surface);
      const recommendations = document.createElement('aside');
      recommendations.id = 'fixture-recommendations';
      recommendations.appendChild(fixtureRow(ids[0], shape, 'Recommendation outside playlist'));
      surface.appendChild(recommendations);
      return root;
    };
  }, { notes: options.notes || { [FIRST]: saved }, settings: options.settings || {} });
  if (options.root !== false) await page.evaluate(({ shape, ids }) => fixtureMount(shape, ids), { shape: options.shape || 'legacy', ids: options.ids || [FIRST] });
  await page.evaluate(js => (0, eval)(js + '\n//# sourceURL=yt-core-lib-1.4.0.js'), core);
  await page.evaluate(() => {
    window.fixtureReads = [];
    const read = Ytk.readRowNode;
    Ytk.readRowNode = node => { fixtureReads.push(node.dataset.fixtureId); return read(node); };
  });
  await page.evaluate(js => (0, eval)(js + '\n//# sourceURL=yt-playlist-notes.user.js'), source);
  await advance(page);
  return page;
}

async function advance(page, milliseconds = 450) {
  await page.evaluate(() => Promise.resolve());
  await page.clock.runFor(milliseconds);
}

async function state(page) {
  return page.evaluate(() => ({
    reads: fixtureReads.slice(),
    callbacks: fixtureObservers.reduce((sum, observer) => sum + observer.callbacks, 0),
    targets: fixtureObservers.flatMap(observer => Array.from(observer.targets, ([target, options]) => ({
      tag: target.nodeName, id: target.id || '', subtree: !!options.subtree
    })))
  }));
}

async function screenshot(page, name) {
  if (!process.env.NOTES_ARTIFACTS) return;
  mkdirSync(process.env.NOTES_ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.NOTES_ARTIFACTS, `${process.env.NOTES_RUN_LABEL || 'run'}-${name}.png`) });
}

for (const shape of ['legacy', 'lockup', 'sidebar']) {
  for (const replacement of ['row', 'title']) {
    test(`restores a ${shape} marker after ${replacement} replacement without scroll or navigation`, async t => {
      const page = await fixture(t, { shape, url: shape === 'sidebar' ? '/watch?v=aaaaaaaaaaa&list=PLfixture' : undefined });
      assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1, 'initial marker');
      await page.evaluate(() => {
        window.fixtureEvents = [];
        ['yt-navigate-finish', 'yt-page-data-updated'].forEach(name => document.addEventListener(name, () => fixtureEvents.push(name)));
        window.addEventListener('scroll', () => fixtureEvents.push('scroll'));
      });
      if (shape === 'legacy' && replacement === 'row') await screenshot(page, 'before-remount');
      await page.evaluate(({ id, shape, replacement }) => {
        const row = document.querySelector('#fixture-root > [data-fixture-id]');
        const next = fixtureRow(id, shape);
        if (replacement === 'row') row.replaceWith(next);
        else row.querySelector('.fixture-title').replaceWith(next.querySelector('.fixture-title'));
      }, { id: FIRST, shape, replacement });
      assert.equal(await page.locator('#fixture-root ' + MARK).count(), 0, 'replacement removes the original dot');
      await advance(page, 1000);
      const markers = await page.locator('#fixture-root ' + MARK).count();
      console.log(JSON.stringify({ shape, replacement, initial: 1, immediatelyAfterReplacement: 0, after1000ms: markers, events: await page.evaluate(() => fixtureEvents) }));
      if (shape === 'legacy' && replacement === 'row') await screenshot(page, 'after-remount');
      assert.deepEqual(await page.evaluate(() => fixtureEvents), [], 'no fallback repaint event was dispatched');
      assert.equal(markers, 1, 'the replacement must regain exactly one dot');
      assert.equal(await page.locator('#fixture-root ' + MARK).getAttribute('title'), saved.text);
      assert.equal(await page.locator('#fixture-recommendations ' + MARK).count(), 0);
      assert.equal(await page.locator('#fixture-root a ' + MARK).count(), 0, 'a marker is outside the video link');
    });
  }
}

test('repairs a removed marker and repositions a surviving marker after a new title', async t => {
  const page = await fixture(t);
  await page.evaluate(() => document.querySelector('.ytk-notes-mark').remove());
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  await page.evaluate(() => {
    const row = document.querySelector('#fixture-root > [data-fixture-id]');
    const old = row.querySelector('.fixture-title');
    const next = fixtureRow('aaaaaaaaaaa').querySelector('.fixture-title');
    old.querySelector('a').remove();
    row.appendChild(next);
  });
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('#fixture-root a').nextSibling?.className), 'ytk-notes-mark');
});

for (const shape of ['legacy', 'lockup', 'sidebar']) {
  test(`updates and removes stale notes when the same ${shape} row is recycled`, async t => {
    const page = await fixture(t, { shape, notes: { [FIRST]: saved, [SECOND]: { text: 'Second video note', at: 2 } }, url: shape === 'sidebar' ? '/watch?v=aaaaaaaaaaa&list=PLfixture' : undefined });
    async function recycle(id) {
      await page.evaluate(id => {
        const row = document.querySelector('#fixture-root > [data-fixture-id]');
        row.dataset.fixtureId = id;
        if (row.dataset.shape === 'lockup') row.contentId = id;
        row.querySelector('a').href = '/watch?v=' + id;
      }, id);
      await advance(page);
    }
    await recycle(SECOND);
    assert.equal(await page.locator('#fixture-root ' + MARK).getAttribute('title'), 'Second video note');
    await recycle(THIRD);
    assert.equal(await page.locator('#fixture-root ' + MARK).count(), 0, 'an unnoted video must not inherit the previous note');
    await recycle(FIRST);
    assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  });
}

test('cleans markers on removed rows without deleting their saved notes', async t => {
  const page = await fixture(t);
  await page.evaluate(() => document.querySelector('#fixture-recommendations').appendChild(document.querySelector('#fixture-root > [data-fixture-id]')));
  await advance(page);
  assert.equal(await page.locator(MARK).count(), 0);
  assert.deepEqual(await page.evaluate(() => Ytk.storeGet('note.aaaaaaaaaaa')), saved);
  await page.evaluate(() => document.querySelector('#fixture-root').appendChild(document.querySelector('#fixture-recommendations > [data-fixture-id]:last-child')));
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
});

test('scopes mutations to changed playlist rows and stays idle after its own writes', async t => {
  const ids = Array.from({ length: 100 }, (_, i) => String(i).padStart(11, '0'));
  const page = await fixture(t, { ids, notes: Object.fromEntries(ids.map(id => [id, saved])) });
  const before = await state(page);
  assert.ok(before.targets.length > 0, 'native mutation observation is active');
  assert.equal(before.targets.some(target => ['BODY', 'HTML', '#document'].includes(target.tag) && target.subtree), false, 'no document-wide subtree observer after root attachment');
  await page.evaluate(() => {
    const row = document.querySelector('#fixture-root > [data-fixture-id]');
    row.querySelector('.fixture-title').replaceWith(fixtureRow(row.dataset.fixtureId).querySelector('.fixture-title'));
  });
  await advance(page);
  const painted = await state(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 100);
  assert.deepEqual(painted.reads.slice(before.reads.length), [ids[0]], 'one changed row should not rescan 100 rows');
  await advance(page, 5000);
  const idle = await state(page);
  assert.deepEqual(idle.reads, painted.reads, 'no repeating paint timers');
  assert.equal(idle.callbacks, painted.callbacks, 'marker insertion does not feed the observer');
  await page.evaluate(() => document.querySelector('#fixture-recommendations').appendChild(fixtureRow('bbbbbbbbbbb')));
  await advance(page);
  assert.deepEqual((await state(page)).reads, painted.reads, 'recommendation mutations do not trigger playlist reads');
});

test('coalesces continuous row mutations without starving the repaint', async t => {
  const page = await fixture(t);
  await page.evaluate(() => document.querySelector('.ytk-notes-mark').remove());
  for (let i = 0; i < 5; i++) {
    await page.evaluate(i => { document.querySelector('#fixture-root a').firstChild.data = 'Title ' + i; }, i);
    await advance(page, 100);
  }
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1, 'repeated changes must not postpone painting indefinitely');
});

test('waits for a late playlist root and then stops broad discovery', async t => {
  const page = await fixture(t, { root: false });
  await advance(page, 2000);
  await page.evaluate(() => fixtureMount());
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  assert.equal((await state(page)).targets.filter(target => target.subtree).every(target => target.id === 'fixture-root'), true);
});

test('caps root discovery and retries on a later YouTube page event', async t => {
  const page = await fixture(t, { root: false });
  await advance(page, 11000);
  assert.deepEqual((await state(page)).targets, [], 'a missing playlist does not leave an indefinite subtree observer');
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-page-data-updated'));
    fixtureMount();
  });
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
});

test('finds a title inserted after its row', async t => {
  const page = await fixture(t, { notes: { [FIRST]: saved, [SECOND]: saved } });
  await page.evaluate(() => {
    const row = fixtureRow('bbbbbbbbbbb');
    row.replaceChildren();
    document.querySelector('#fixture-root').appendChild(row);
  });
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  await page.evaluate(() => document.querySelector('#fixture-root > [data-fixture-id="bbbbbbbbbbb"]').appendChild(fixtureRow('bbbbbbbbbbb').firstChild));
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 2);
});

test('follows a replaced playlist root and releases the detached root', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const root = document.querySelector('#fixture-root');
    window.fixtureOldRoot = root;
    const next = root.cloneNode(false);
    next.appendChild(fixtureRow('aaaaaaaaaaa'));
    root.replaceWith(next);
  });
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  assert.equal(await page.evaluate(() => fixtureOldRoot.querySelectorAll('.ytk-notes-mark').length), 0);
  const before = await state(page);
  await page.evaluate(() => fixtureOldRoot.appendChild(fixtureRow('aaaaaaaaaaa')));
  await advance(page);
  assert.deepEqual((await state(page)).reads, before.reads, 'detached root mutations are no longer observed');
  assert.equal(await page.locator('.ytk2-bar button').count(), 1);
});

test('starts on SPA playlist arrival, cancels queued paints on leave, and remounts once', async t => {
  const page = await fixture(t, { root: false, url: '/' });
  assert.deepEqual((await state(page)).targets, []);
  assert.equal(await page.locator('.ytk2-bar').count(), 0);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/playlist?list=PLfixture');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    fixtureMount();
  });
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  await page.evaluate(() => document.querySelector('.ytk-notes-mark').remove());
  await advance(page, 100);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    history.pushState({}, '', '/');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await advance(page, 2000);
  assert.equal(await page.locator(MARK).count(), 0);
  assert.equal(await page.locator('.ytk2-bar').count(), 0);
  assert.deepEqual((await state(page)).targets, []);
  await page.evaluate(() => {
    history.pushState({}, '', '/playlist?list=PLfixture');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  assert.equal(await page.locator('.ytk2-bar button').count(), 1);
});

for (const setting of ['notesShowMarkers', 'feature']) {
  test(`disconnects while ${setting} is disabled and resumes after a settings event`, async t => {
    const page = await fixture(t);
    await page.evaluate(setting => {
      Ytk.storeSet('settings', setting === 'feature' ? { features: { notes: false } } : { notesShowMarkers: false });
      window.dispatchEvent(new StorageEvent('storage', { key: 'ytk.settings' }));
    }, setting);
    await advance(page);
    assert.equal(await page.locator(MARK).count(), 0);
    assert.deepEqual((await state(page)).targets, []);
    assert.equal(await page.locator('.ytk2-bar button').count(), setting === 'feature' ? 0 : 1);
    const before = await state(page);
    await page.evaluate(() => document.querySelector('#fixture-root > [data-fixture-id]').replaceWith(fixtureRow('aaaaaaaaaaa')));
    await advance(page);
    assert.deepEqual((await state(page)).reads, before.reads);
    await page.evaluate(() => {
      Ytk.storeSet('settings', { notesShowMarkers: true, features: { notes: true } });
      window.dispatchEvent(new StorageEvent('storage', { key: 'ytk.settings' }));
    });
    await advance(page);
    assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
    assert.equal(await page.locator('.ytk2-bar button').count(), 1);
  });
}

test('can activate after starting with the notes feature disabled', async t => {
  const page = await fixture(t, { settings: { features: { notes: false } } });
  assert.equal(await page.locator(MARK).count(), 0);
  assert.equal(await page.locator('.ytk2-bar').count(), 0);
  assert.deepEqual((await state(page)).targets, []);
  await page.evaluate(() => {
    Ytk.setFeature('notes', true);
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
});

test('tears down on pagehide and resumes after pageshow without duplicate UI', async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await advance(page, 1000);
  assert.deepEqual((await state(page)).targets, []);
  assert.equal(await page.locator(MARK).count(), 0);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1);
  assert.equal(await page.locator('.ytk2-bar button').count(), 1);
});

test('saves, retains, and deletes notes through the real core panel and storage API', async t => {
  const page = await fixture(t, { notes: {} });
  assert.equal(await page.locator(MARK).count(), 0);
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  page.once('dialog', dialog => dialog.accept('  Saved through the real panel  '));
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const note = await page.evaluate(() => Ytk.storeGet('note.aaaaaaaaaaa'));
  assert.equal(note.text, 'Saved through the real panel');
  assert.equal(typeof note.at, 'number');
  assert.equal(await page.locator('#fixture-root ' + MARK).count(), 1, 'saving paints immediately');
  await page.evaluate(() => document.querySelector('#fixture-root > [data-fixture-id]').replaceWith(fixtureRow('aaaaaaaaaaa')));
  await advance(page);
  assert.equal(await page.locator('#fixture-root ' + MARK).getAttribute('title'), note.text);
  page.once('dialog', dialog => dialog.accept(''));
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.locator(MARK).count(), 0);
  assert.equal(await page.evaluate(() => fixtureStore.has('ytk.note.aaaaaaaaaaa')), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('ytk.note.aaaaaaaaaaa')), null);
  assert.deepEqual(await page.evaluate(() => fixtureDeletes), ['ytk.note.aaaaaaaaaaa']);
  await advance(page, 2000);
  assert.equal(await page.locator(MARK).count(), 0, 'observer must not resurrect a deleted note');
});

test('uses the shared settings popup and preserves the saved marker toggle and unknown keys', async t => {
  const page = await fixture(t, { settings: { notesShowMarkers: true, notesMaxChars: 400, unrelatedSetting: 'keep' } });
  assert.deepEqual(await page.evaluate(() => Array.from(fixtureMenus.keys())), ['Settings…']);
  await page.evaluate(() => fixtureMenus.get('Settings…')());
  await page.getByRole('checkbox', { name: 'Mark rows that have a note with a dot' }).uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const stored = await page.evaluate(() => Ytk.storeGet('settings'));
  assert.equal(stored.notesShowMarkers, false, 'the onSave merge must retain the value written by core 1.4.0');
  assert.equal(stored.notesMaxChars, 400);
  assert.equal(stored.unrelatedSetting, 'keep');
  assert.equal(await page.locator(MARK).count(), 0);
  assert.deepEqual((await state(page)).targets, []);
  // Core schedules a reload after Save; assert the immediate cleanup before that timer.
});
