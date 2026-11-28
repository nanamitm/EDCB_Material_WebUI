const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../HttpPublic/E3/js/app.js'), 'utf8');
const response = data => ({ ok: true, json: async () => structuredClone(data) });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  let nextId = 0;
  const timers = new Map();
  class EventSource {
    static CLOSED = 2;
    constructor() { this.readyState = 1; }
    close() { this.readyState = EventSource.CLOSED; }
  }
  const context = vm.createContext({
    URL, EventSource, window: { location: { href: 'https://example.com/E3/index.html' } },
    console: { error() {}, warn() {} },
    setTimeout(fn, ms) { const id = ++nextId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  function methods(start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first);
    return vm.runInContext(`({${source.slice(first, last)}})`, context);
  }
  const persistence = methods('    async saveEpgCache(', '    // 起動時にキャッシュを復元');
  const app = Object.assign({},
    methods('    beginRefresh(', '    // SSEの開始とメッセージ処理'),
    methods('    startSSE()', '    async refreshCtok('),
    methods('    async refreshData(', '    async getData()'),
    methods('    async loadWeeklyEpg()', '    // ネットワーク（タブ）'),
    methods('    getEpgKey(', '    isGroupSub('),
    methods('    async updateTunerStatus()', '    async loadMore()'), {
      ROOT: '', page: '#reserve', params: {}, now: Date.now(), refreshVersions: {},
      allData: { reserve: new Map(), search: new Map(), service: new Map([['1-2-3', { onid: 1, tsid: 2, sid: 3 }]]), epg: new Map(), recpreset: new Map() },
      pageMap: { '#reserve': { api: 'EnumReserveInfo' }, service: { api: 'EnumService' }, recpreset: { api: 'EnumRecPreset' } },
      lastUpdated: {}, totals: {}, dashboardData: {},
      epg: { cacheDays: 3, generation: 0, weeklyLoadId: 0, extraData: new Map(), weeklyCache: new Map(), weeklyToDisplay: [], servicesToDisplay: [] },
      dayText: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
      $main: { scrollTo() {} },
      getDataKey: v => v.reserveID ?? v.id,
      getServiceID: () => '1-2-3', getEventID: v => v.eid,
      isPage(...pages) { return pages.includes(this.page); },
      fetch: async () => { throw Error('Unexpected request'); },
      sortList() {}, syncDashboardData() {}, updateDisplayList() {}, updateNetworkMask() {}, syncNowOnAir() {},
      loadEpg() { this.renders++; }, renders: 0,
      saveCache(data) { this.saved.push(data); }, saved: [],
      saveEpgCache(data) { this.savedEpg.push(data); }, savedEpg: [],
      restoreSidePanel() { this.restores++; }, restores: 0,
      snackbar: { error() { app.errors++; } }, errors: 0,
    });
  return { app, persistence, timers, EventSource, async runTimer(ms) {
    const found = [...timers].find(([, timer]) => timer.ms === ms);
    assert.ok(found, `missing ${ms}ms timer`);
    timers.delete(found[0]);
    await found[1].fn();
  } };
}

test('out-of-order reservation responses cannot roll back memory or the saved cache', async () => {
  const { app } = setup();
  const old = deferred(), latest = deferred();
  let calls = 0;
  app.fetch = () => ++calls === 1 ? old.promise : latest.promise;
  const a = app.refreshData('#reserve'), b = app.refreshData('#reserve');
  latest.resolve(response([{ reserveID: 1, title: 'new' }])); await b;
  old.resolve(response([{ reserveID: 1, title: 'old' }])); await a;
  assert.equal(app.allData.reserve.get(1).title, 'new');
  assert.equal(app.saved.length, 1);
  assert.equal(app.saved[0].reserve[0].title, 'new');
});

test('an obsolete cache save cannot commit after a delayed database open', async () => {
  for (const method of ['saveCache', 'saveEpgCache']) {
    const { app, persistence } = setup();
    const pending = deferred();
    let transactions = 0, closed = 0;
    app.openCacheDB = () => pending.promise;
    const isCurrent = app.beginRefresh('data');
    const task = persistence[method].call(app, new Map(), isCurrent);
    app.beginRefresh('data');
    pending.resolve({ transaction() { transactions++; }, close() { closed++; } });
    await task;
    assert.equal(transactions, 0, method);
    assert.equal(closed, 1, method);
  }
});

test('EPG persistence replaces services in one transaction and closes the database', async () => {
  const { app, persistence } = setup();
  const stores = { epg: new Map([['old-service', []]]), meta: new Map() };
  let closed = false;
  app.metaSnapshot = () => ({ epgCache: 123 });
  app.openCacheDB = async () => ({
    transaction(names, mode) {
      assert.equal(mode, 'readwrite');
      assert.equal(Array.from(names).join(','), 'meta,epg');
      const tx = { objectStore(name) { return {
        clear() { stores[name].clear(); }, put(value, key) { stores[name].set(key, value); },
      }; } };
      queueMicrotask(() => tx.oncomplete());
      return tx;
    }, close() { closed = true; },
  });
  await persistence.saveEpgCache.call(app, new Map([['new-service', new Map([[1, { eid: 1 }]])]]));
  assert.equal(stores.epg.has('old-service'), false);
  assert.equal(stores.epg.has('new-service'), true);
  assert.equal(closed, true);
});

test('out-of-order core EPG responses cannot overwrite the latest generation', async () => {
  const { app } = setup();
  const old = deferred(), latest = deferred(); let calls = 0;
  app.fetch = () => ++calls === 1 ? old.promise : latest.promise;
  const a = app.refreshEpg(), b = app.refreshEpg();
  latest.resolve(response([{ eid: 2, startTime: '2026-11-28T12:00:00+09:00' }])); await b;
  old.resolve(response([{ eid: 1, startTime: '2026-11-28T12:00:00+09:00' }])); await a;
  assert.equal(app.allData.epg.get('1-2-3').has(2), true);
  assert.equal(app.epg.generation, 1);
  assert.equal(app.savedEpg.length, 1);
});

test('tab switching stores a range under the requested tab without repainting the new tab', async () => {
  const { app } = setup(); const pending = deferred(); let url;
  app.page = '#epg'; app.params.tab = 1; app.epg.epgStartTime = app.now;
  app.fetch = request => { url = request; return pending.promise; };
  const key = app.getEpgKey(app.now);
  const task = app.fetchEpgForRange(app.now);
  app.params.tab = 3;
  pending.resolve(response([{ eid: 1, startTime: new Date(app.now).toISOString() }])); await task;
  assert.ok(url.includes('tab=1'));
  assert.equal(app.epg.extraData.has(key), true);
  assert.equal(app.epg.extraData.has(app.getEpgKey(app.now)), false);
  assert.equal(app.renders, 0);
});

test('a late range response cannot repopulate caches invalidated by core EPG refresh', async () => {
  const { app } = setup(); const pending = deferred(); let calls = 0;
  app.epg.extraData.set('old', new Map()); app.epg.weeklyCache.set('old', []);
  app.fetch = () => ++calls === 1 ? pending.promise : Promise.resolve(response([]));
  const range = app.fetchEpgForRange(app.now);
  await app.refreshEpg();
  pending.resolve(response([{ eid: 1, startTime: new Date(app.now).toISOString() }])); await range;
  assert.equal(app.epg.extraData.size, 0);
  assert.equal(app.epg.weeklyCache.size, 0);
});

function weeklySetup(app) {
  const d = new Date(app.now); d.setHours(4, 0, 0, 0);
  const date = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  app.params = { id: '1-2-3', date };
  return title => [{ eid: 1, startTime: new Date(d.getTime() + 1800000).toISOString(), durationSecond: 1800, shortInfo: { event_name: title } }];
}

test('core refresh invalidates weekly data and renders changed text even when event IDs and times match', async () => {
  const { app } = setup(); const events = weeklySetup(app); let calls = 0;
  app.fetch = async () => response(events(++calls === 1 ? 'old' : 'new'));
  await app.loadWeeklyEpg();
  const shown = () => app.epg.weeklyToDisplay[0].displayEvents.find(v => !v.isGap).shortInfo.event_name;
  assert.equal(shown(), 'old');
  await app.refreshEpg(); await app.loadWeeklyEpg();
  assert.equal(calls, 3);
  assert.equal(shown(), 'new');
});

test('an obsolete weekly response does not clear the newer in-flight request', async () => {
  const { app } = setup(); const events = weeklySetup(app);
  const old = deferred(), latest = deferred(); let calls = 0;
  app.fetch = () => { calls++; return calls === 1 ? old.promise : calls === 2 ? Promise.resolve(response([])) : latest.promise; };
  const a = app.loadWeeklyEpg(); await app.refreshEpg(); const b = app.loadWeeklyEpg();
  const key = app.epg.fetchingWeekly;
  old.resolve(response(events('old'))); await a;
  assert.equal(app.epg.fetchingWeekly, key);
  assert.equal(app.loading, true);
  assert.equal(app.epg.weeklyCache.size, 0);
  latest.resolve(response(events('new'))); await b;
  assert.equal(app.epg.fetchingWeekly, null);
  assert.equal(app.epg.weeklyCache.get(key)[0].shortInfo.event_name, 'new');
});

function sseSetup() {
  const env = setup(), { app } = env;
  const calls = new Map();
  app.refreshData = async topic => calls.set(topic, (calls.get(topic) || 0) + 1);
  app.refreshEpg = async () => calls.set('epg', (calls.get('epg') || 0) + 1);
  app.updateTunerStatus = async () => calls.set('tuner', (calls.get('tuner') || 0) + 1);
  app.startSSE();
  return { ...env, calls, send: data => app.eventSource.onmessage({ data: JSON.stringify(data) }) };
}

test('failed SSE reads are retried independently while other topics synchronize', async () => {
  const { app, calls, send, runTimer } = sseSetup();
  const read = app.refreshData;
  app.refreshData = async topic => { await read(topic); if (topic === '#reserve' && calls.get(topic) === 1) throw Error('temporary failure'); };
  await send({ reserve: 1, recinfo: 1, epg: 1 });
  assert.equal(calls.get('epg'), 1);
  assert.equal(calls.get('#recinfo'), 1);
  await send({ ping: true }); await runTimer(1000);
  assert.equal(calls.get('#reserve'), 2);
  assert.equal(calls.get('#tunerreserve'), 1);
  assert.equal(calls.get('epg'), 1);
});

test('notifications received during a sync are queued rather than discarded', async () => {
  const { app, send, runTimer } = sseSetup(); const pending = deferred(); let calls = 0;
  app.refreshData = async () => { if (++calls === 1) await pending.promise; };
  const first = send({ recinfo: 1 }); await send({ recinfo: 2 });
  pending.resolve(); await first; await runTimer(1000);
  assert.equal(calls, 2);
});

test('reconnection retries failed initial data before restoring the side panel', async () => {
  const { app, calls, runTimer } = sseSetup(); const read = app.refreshData;
  app.refreshData = async topic => { await read(topic); if (topic === '#recinfo' && calls.get(topic) === 1) throw Error('temporary failure'); };
  await app.eventSource.onopen();
  assert.equal(app.restores, 0);
  await runTimer(1000);
  assert.equal(app.restores, 1);
  assert.equal(calls.get('#recinfo'), 2);
  assert.equal(calls.get('epg'), 1);
});

test('read retry backoff is bounded and stopping SSE cancels timers', async () => {
  const { app, send, runTimer, timers } = sseSetup(); let calls = 0;
  app.refreshData = async () => { calls++; throw Error('offline'); };
  await send({ recinfo: 1 });
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) await runTimer(delay);
  assert.equal(calls, 8);
  app.dataSaver = true; app.stopSSE();
  assert.equal(timers.size, 0);
  assert.equal(app.eventSource, null);
  assert.equal(app.loading, false);
});

test('data saver prevents retry scheduling when it stops an in-flight sync', async () => {
  const { app, send, timers } = sseSetup(); const pending = deferred();
  app.refreshData = () => pending.promise;
  const task = send({ recinfo: 1 });
  app.dataSaver = true; app.stopSSE();
  pending.reject(Error('late failure')); await task;
  assert.equal(timers.size, 0);
});

test('heartbeat timeout recovers on ping and stale connection callbacks cannot change status', async () => {
  const { app, send, runTimer, timers } = sseSetup();
  await send({ ping: true }); assert.equal(app.isOnline, true);
  const oldHeartbeat = [...timers.values()].find(t => t.ms === 15000).fn;
  await runTimer(15000); assert.equal(app.isOnline, false);
  await send({ ping: true }); assert.equal(app.isOnline, true);
  const old = app.eventSource;
  app.startSSE(); await send({ ping: true });
  oldHeartbeat(); old.onerror(); old.onmessage({ data: '{"ping":true}' });
  assert.equal(app.isOnline, true);
  app.eventSource.readyState = 2; app.eventSource.onerror();
  assert.equal(app.isOnline, false);
});

test('a zero notification counter is processed and malformed messages do not break synchronization', async () => {
  const { app, calls, send } = sseSetup();
  await app.eventSource.onmessage({ data: 'invalid JSON' });
  await send({ recinfo: 0 });
  assert.equal(calls.get('#recinfo'), 1);
});

test('HTTP errors preserve existing reservations instead of caching an error payload', async () => {
  const { app } = setup(); app.allData.reserve.set(1, { title: 'existing' });
  app.fetch = async () => ({ ok: false, status: 503, json: async () => ({ err: 'unavailable' }) });
  await assert.rejects(app.refreshData('#reserve'), /503/);
  assert.equal(app.allData.reserve.get(1).title, 'existing');
  assert.equal(app.saved.length, 0);
});
