const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'HttpPublic/E3/js/app.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(root, 'HttpPublic/E3/sw.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'HttpPublic/E3/js/ts-loader.js'), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
function methods(first, last, context = {}) {
  const a = source.indexOf(first), b = source.indexOf(last, a); assert.ok(a >= 0 && b > a);
  return vm.runInNewContext(`({${source.slice(a, b)}})`, { URL, URLSearchParams, console: { warn() {}, error() {} }, ...context });
}
function routing() {
  const timers = new Map(), callbacks = {}; let timerId = 0;
  const window = { location: new URL('https://example.test/E3/#reserve'), addEventListener: (name, fn) => callbacks[name] = fn };
  const history = { pushState(_, __, url) { window.location = new URL(url, window.location); }, replaceState(_, __, url) { window.location = new URL(url, window.location); } };
  const context = { window, history, clearInterval: id => timers.delete(id), setInterval: fn => { timers.set(++timerId, fn); return timerId; } };
  const a = Object.assign(methods('    updateParams()', '    google(', context), methods('    handleLocationChange()', '    loadPreferences()', context));
  Object.assign(a, { routeUrl: window.location.href, page: '#reserve', params: {}, sidePanelRestoreId: 0, detailRequestId: 0,
    sidePanel: { el: { open: false } }, loads: 0, isPage(...pages) { return pages.includes(this.page); }, loadAll() { this.loads++; },
    allData: { reserve: new Map() }, opened: [], openProgramDetail(d) { this.opened.push(d); },
  });
  return { a, window, context, timers, callbacks };
}

test('back/forward hash changes preserve query parameters and load the route once', () => {
  const { a, window } = routing();
  window.location = new URL('https://example.test/E3/?id=1-2-3-4&date=1#epg');
  a.handleLocationChange(); a.handleLocationChange();
  assert.equal(a.params.id, '1-2-3-4'); assert.equal(a.params.date, '1'); assert.equal(a.loads, 1);
  assert.equal(window.location.search, '?id=1-2-3-4&date=1');
  window.location = new URL('https://example.test/E3/?recid=9#watch');
  a.handleLocationChange(); a.handleLocationChange(); assert.equal(a.params.recid, '9'); assert.equal(a.loads, 2);
});

test('normal navigation clears old query parameters while both location events use one handler', () => {
  const { a, window, context, callbacks } = routing(); let click;
  a.pageMap = { '#recinfo': {} };
  const start = source.indexOf("      window.addEventListener('hashchange'");
  const end = source.indexOf("      window.addEventListener('resize'", start);
  vm.runInNewContext(`(function(){${source.slice(start, end)}})`, { ...context, document: { addEventListener: (_, fn) => click = fn } }).call(a);
  window.location = new URL('https://example.test/E3/?id=1-2-3-4#epg');
  callbacks.popstate(); callbacks.hashchange(); assert.equal(a.params.id, '1-2-3-4');
  let prevented = false;
  click({ button: 0, target: { closest: () => ({ getAttribute: () => '#recinfo', hasAttribute: () => false }) }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(window.location.search, ''); assert.equal(a.page, '#recinfo');
});

test('stale detail lookups cannot replace the newer program or survive a manual detail selection', async () => {
  const { a } = routing(), first = deferred(), last = deferred(); let calls = 0;
  a.params.id = '1-2-3-4'; a.getEpgById = () => ++calls === 1 ? first.promise : last.promise;
  const old = a.restoreSidePanel(); a.params.id = '1-2-3-5'; const latest = a.restoreSidePanel();
  last.resolve({ eid: 5 }); await latest; first.resolve({ eid: 4 }); await old;
  assert.equal(a.opened.length, 1); assert.equal(a.opened[0].eid, 5);
  const pending = deferred(); a.getEpgById = () => pending.promise;
  const task = a.restoreSidePanel(); a.detailRequestId++; pending.resolve({ eid: 6 }); await task;
  assert.equal(a.opened.length, 1);
});

test('reservation restoration timers are cancelled without clearing the newer timer', async () => {
  const { a, timers } = routing();
  a.params.id = '10'; await a.restoreSidePanel(); const queuedOld = [...timers.values()][0];
  a.params.id = '20'; await a.restoreSidePanel(); assert.equal(timers.size, 1);
  queuedOld(); assert.equal(timers.size, 1);
  a.allData.reserve.set(20, { reserveID: 20 }); [...timers.values()][0]();
  assert.equal(a.opened[0].reserveID, 20); assert.equal(timers.size, 0);
});

test('service names are escaped at the HTML sink while the logo and count remain', () => {
  const a = methods('    getServiceListText(', '    getGenreListText(');
  a.getServiceName = () => '<img src=x onerror="alert(1)"> & \'station\''; a.getLogoPath = () => '../api/logo?id=1';
  const html = a.getServiceListText({ searchInfo: { serviceList: [{}, {}] } });
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;station&#39;'));
  assert.ok(html.includes('<small>+1ch</small>')); assert.equal((html.match(/<img /g) || []).length, 1);
});

function preferences(raw, blocked = false) {
  const a = methods('    loadPreferences()', '    async init()', { localStorage: { getItem() { if (blocked) throw new Error('blocked'); return raw; } } });
  a.sets = { theme: '#6750A4', mode: 'auto', dataSaver: true, player: { volume: 1, quality: 1 }, view: { library: 'grid', reserve: 'list' } };
  return a;
}
test('malformed, blocked and wrongly typed saved settings fall back to defaults', () => {
  for (const raw of ['{broken', 'null', '[]', '{"player":null,"view":0,"dataSaver":"false"}']) {
    const a = preferences(raw); a.loadPreferences(); assert.equal(a.sets.player.volume, 1); assert.equal(a.sets.view.library, 'grid'); assert.equal(a.sets.dataSaver, true);
  }
  const a = preferences(null, true); assert.doesNotThrow(() => a.loadPreferences());
});
test('valid preferences merge known fields and invalid values or prototype keys are ignored', () => {
  const a = preferences('{"player":{"volume":2,"quality":3},"mode":"invalid","theme":"bad","view":{"library":"bad"},"dataSaver":false,"__proto__":{"polluted":true}}');
  a.loadPreferences(); assert.equal(a.sets.player.volume, 1); assert.equal(a.sets.player.quality, 3);
  assert.equal(a.sets.mode, 'auto'); assert.equal(a.sets.theme, '#6750A4'); assert.equal(a.sets.view.library, 'grid'); assert.equal(a.sets.dataSaver, false);
  assert.equal({}.polluted, undefined);
});

function sw(fail = false) {
  const handlers = {}, scope = 'https://example.test/E3/', stores = new Map([['e3-pwa-cache-v15', new Map([['old-shell', 'working']])]]);
  const state = { skipped: 0, claimed: 0, opened: [], windows: [] };
  const context = vm.createContext({ URL, console, navigator: {}, AbortSignal,
    self: { registration: { scope }, addEventListener: (name, fn) => handlers[name] = fn,
      skipWaiting: async () => { state.skipped++; }, clients: { claim: async () => { state.claimed++; }, matchAll: async () => state.windows, openWindow: async url => state.opened.push(url) } },
    caches: { async open(name) { if (!stores.has(name)) stores.set(name, new Map()); return {
      async addAll(assets) { if (fail) throw new Error('download failure'); for (const asset of assets) stores.get(name).set(new URL(asset, scope).href, asset); },
    }; }, keys: async () => [...stores.keys()], delete: async name => stores.delete(name) },
  });
  vm.runInContext(workerSource, context);
  return { handlers, stores, state, context, scope, assets: vm.runInContext('ASSETS', context), name: vm.runInContext('CACHE_NAME', context) };
}
function lifecycle(handler) { let task; handler({ waitUntil(p) { task = p; } }); return task; }
test('failed installation retains the old offline shell and never skips waiting', async () => {
  const s = sw(true); await assert.rejects(lifecycle(s.handlers.install), /download failure/);
  assert.equal(s.state.skipped, 0); assert.equal(s.stores.has('e3-pwa-cache-v15'), true); assert.equal(s.stores.has(s.name), false);
});
test('successful installation caches existing boot dependencies before activation', async () => {
  const s = sw(); await lifecycle(s.handlers.install);
  for (const asset of s.assets) assert.equal(fs.existsSync(path.join(root, 'HttpPublic/E3', asset)), true, asset);
  assert.ok(s.assets.includes('./js/ts-loader.js')); assert.equal(s.state.skipped, 1);
  await lifecycle(s.handlers.activate); assert.equal(s.state.claimed, 1); assert.equal(s.stores.has('e3-pwa-cache-v15'), false);
  // Evaluate the required cached scripts without fetching anything or initializing EDCB.
  let factory, initialize;
  const browser = vm.createContext({ navigator: { userAgent: 'node' }, window: { location: { hash: '', search: '' } },
    HTMLCanvasElement: class {}, HTMLVideoElement: class {}, customElements: { define() {} },
    document: { addEventListener: (_, fn) => initialize = fn, getElementById: () => ({}) }, Alpine: { data: (_, fn) => factory = fn },
  });
  vm.runInContext(loaderSource, browser); vm.runInContext(source, browser); initialize();
  assert.doesNotThrow(() => factory({}));
});

test('notification clicks reuse a scoped window or open the program route', async () => {
  const s = sw(); let navigated, focused = false;
  s.state.windows = [{ url: s.scope, navigate: async url => { navigated = url; return { focus: async () => { focused = true; } }; } }];
  const event = () => ({ notification: { data: { eventId: '1-2-3-4' }, close() {} } });
  await lifecycle(e => s.handlers.notificationclick({ ...event(), waitUntil: e.waitUntil }));
  assert.equal(new URL(navigated).searchParams.get('id'), '1-2-3-4'); assert.equal(new URL(navigated).hash, '#epg'); assert.equal(focused, true);
  s.state.windows = []; await lifecycle(e => s.handlers.notificationclick({ ...event(), waitUntil: e.waitUntil }));
  assert.equal(s.state.opened.length, 1);
  let waited = false; s.handlers.notificationclick({ notification: { data: { eventId: 'https://evil.test' }, close() {} }, waitUntil() { waited = true; } });
  assert.equal(waited, false);
});

function reminder(registration) {
  const Notification = class { static permission = 'granted'; constructor() { throw new TypeError('mobile constructor'); } };
  const { reminder } = methods('\n    reminder: {', '\n    snackbar: {', { Notification,
    window: { Notification, location: { href: 'https://example.test/E3/' } }, navigator: { serviceWorker: { getRegistration: async () => registration } },
  });
  reminder.app = { convert: { date: () => 'date' }, snackbar: { error() {} } }; return reminder;
}
test('mobile reminders use the service worker and propagate notification failure safely', async () => {
  let options; const r = reminder({ active: {}, showNotification: async (_, data) => options = data });
  assert.equal(await r.notify({ id: '1-2-3-4', title: 'test', startTime: 0 }), true); assert.equal(options.data.eventId, '1-2-3-4');
  const noWorker = reminder(null); assert.equal(await noWorker.notify({ id: '1', title: 'test', startTime: 0 }), false);
});
test('desktop notification fallback retains click behavior when no worker is active', async () => {
  let shown, focused = false, opened;
  class Notification {
    static permission = 'granted';
    constructor(title, options) { this.title = title; this.options = options; shown = this; }
    close() { this.closed = true; }
  }
  const { reminder: r } = methods('\n    reminder: {', '\n    snackbar: {', { Notification,
    window: { Notification, location: { href: 'https://example.test/E3/' }, focus() { focused = true; } }, navigator: {}, setTimeout() {},
  });
  r.app = { convert: { date: () => 'date' }, getEpgById: async id => ({ id }), openProgramDetail: epg => opened = epg, snackbar: { error() {} } };
  assert.equal(await r.notify({ id: '1-2-3-4', title: 'desktop', startTime: 0 }), true);
  shown.onclick(); await Promise.resolve();
  assert.equal(focused, true); assert.equal(shown.closed, true); assert.equal(opened.id, '1-2-3-4');
});
test('failed reminder delivery is retained with backoff; success preserves reminders added during delivery', async () => {
  const r = reminder(null), now = Date.now(), item = { id: '1', startTime: now }; r.list = [item]; r.save = () => {};
  let calls = 0; r.notify = async () => { calls++; return false; };
  await r.check(); await r.check(); assert.equal(calls, 1); assert.equal(r.list.length, 1);
  r.retryAfter.clear(); const delivered = deferred(); r.notify = () => delivered.promise;
  const task = r.check(), next = { id: '2', startTime: now + 120000 }; r.list.push(next);
  delivered.resolve(true); await task; assert.equal(r.list.length, 1); assert.equal(r.list[0].id, '2');
});
