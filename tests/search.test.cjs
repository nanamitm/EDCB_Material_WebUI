const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'HttpPublic/E3/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'HttpPublic/E3/index.html'), 'utf8');
function methods(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return vm.runInNewContext(`({${source.slice(first, last)}})`, { URLSearchParams, ui() {}, console: { error() {} } });
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
const item = (eid, startTime = '2026-11-29T12:00:00+09:00') => ({ onid: 1, tsid: 2, sid: 3, eid, startTime, shortInfo: { event_name: `event ${eid}` } });
const response = data => ({ ok: true, json: async () => data });
function app() {
  const a = Object.assign(methods('    beginRefresh(', '    // SSEの開始とメッセージ処理'),
    methods('    getDataKey(', '    async getEpgById('), methods('    getServiceID(', '    getTunerID('),
    methods('    applySearchResults(', '    async searchOlympic('), methods('    async loadAll()', '    ensureActiveTuner()'), {
      ROOT: '', page: '#search', params: {}, refreshVersions: {}, detailRequestId: 0, history: [],
      search: { searchInfo: { andKey: 'previous' } }, totals: { search: 1 },
      pageMap: { '#search': { itemKey: d => `${d.onid}-${d.tsid}-${d.sid}-${d.eid}` } },
      allData: { search: new Map([['old', item(99)]]), reserve: new Map() },
      player: {}, $main: { scrollTo() {} }, rollThumbLeave() {},
      isPage(...pages) { return pages.includes(this.page); }, getDefSearchService: () => [], updateDisplayList() {},
      sidePanel: { close() { a.closed++; } }, closed: 0, snackbar: { error() { a.errors++; } }, errors: 0,
    });
  return a;
}

test('ordinary searches commit conditions and results together and discard older responses', async () => {
  const a = app(), old = deferred(), latest = deferred(); let calls = 0;
  a.fetchWithToken = () => ++calls === 1 ? old.promise : latest.promise;
  const first = a.searchEvent('A'), second = a.searchEvent('B');
  latest.resolve(response([item(2)])); await second;
  old.resolve(response([item(1)])); await first;
  assert.equal(a.search.searchInfo.andKey, 'B');
  assert.equal([...a.allData.search.values()][0].eid, 2); assert.equal(a.closed, 1);
});

test('ordinary and preset searches share the same response generation', async () => {
  for (const presetFirst of [false, true]) {
    const a = app(), old = deferred(), latest = deferred(); let calls = 0;
    a.fetch = a.fetchWithToken = () => ++calls === 1 ? old.promise : latest.promise;
    const first = presetFirst ? a.searchPreset(1) : a.searchEvent('old');
    const second = presetFirst ? a.searchEvent('new') : a.searchPreset(2);
    old.resolve(response(presetFirst ? { items: [item(1)], searchInfo: { andKey: 'old preset' } } : [item(1)])); await first;
    assert.equal(a.loading, true);
    latest.resolve(response(presetFirst ? [item(2)] : { items: [item(2)], searchInfo: { andKey: 'new preset', serviceList: [{ onid: 1, tsid: 2, sid: 3 }], days: 3 } })); await second;
    assert.equal([...a.allData.search.values()][0].eid, 2);
    assert.equal(a.search.searchInfo.andKey, presetFirst ? 'new' : 'new preset');
    if (!presetFirst) assert.equal(a.search.searchInfo.days, 3);
  }
});

test('leaving the search page cancels pending result and panel updates', async () => {
  const a = app(), pending = deferred(); a.fetchWithToken = () => pending.promise;
  const task = a.searchEvent('A'); a.page = '#onair'; await a.loadAll();
  assert.equal(a.loading, false); const closed = a.closed;
  pending.resolve(response([item(1)])); await task;
  assert.equal(a.closed, closed); assert.equal(a.search.searchInfo.andKey, 'previous');
  assert.equal(a.allData.search.has('old'), true);
});

test('a failed preset preserves prior conditions and results', async () => {
  const a = app(); a.fetch = async () => response({ err: 'preset missing' });
  await a.searchPreset(1);
  assert.equal(a.errors, 1); assert.equal(a.search.searchInfo.andKey, 'previous');
  assert.equal(a.allData.search.has('old'), true);
});

test('completed searches do not close a detail panel opened while the request was pending', async () => {
  const a = app(), pending = deferred(); a.fetchWithToken = () => pending.promise;
  const task = a.searchEvent('A'); a.detailRequestId++;
  pending.resolve(response([item(1)])); await task;
  assert.equal(a.closed, 0); assert.equal(a.search.searchInfo.andKey, 'A');
});

test('archive and past markers both prevent current reservation metadata from being attached', () => {
  for (const marker of ['archive', 'past']) {
    const a = app(), past = { ...item(10, '2026-10-01T12:00:00+09:00'), [marker]: true };
    a.allData.reserve.set(a.getEventID(past), { reserveID: 99, startTime: Date.parse('2026-11-29T12:00:00+09:00'), recSetting: {} });
    a.applySearchResults([past], { searchInfo: {} });
    const result = [...a.allData.search.values()][0];
    assert.equal(result.startTime, Date.parse(past.startTime)); assert.equal(result.reserveID, undefined);
    assert.equal(result.past, true); assert.equal(result.recSetting, undefined);
  }
});

test('different archived broadcasts sharing an EID survive in both the map and UI keys', () => {
  const a = app();
  a.applySearchResults([
    { ...item(10, '2026-10-01T12:00:00+09:00'), archive: true },
    { ...item(10, '2026-11-01T12:00:00+09:00'), archive: true },
  ], { searchInfo: {} });
  assert.equal(a.totals.search, 2);
  assert.equal(new Set([...a.allData.search.values()].map(v => a.getDataKey(v, 'search'))).size, 2);
  assert.equal((html.match(/:key="getDataKey\(d, 'search'\)"/g) || []).length, 2);
});

test('past result identity is the start-time identity used by detail navigation', () => {
  const a = app(), past = { ...item(10, '2026-10-01T12:00:00+09:00'), past: true };
  assert.equal(a.getDataKey(past, 'search'), `1-2-3-${Date.parse(past.startTime) / 1000 + 32400}`);
});

test('upcoming results still receive the matching current reservation', () => {
  const a = app(), upcoming = item(10);
  a.allData.reserve.set(a.getEventID(upcoming), { reserveID: 99, recSetting: { recEnabled: true } });
  a.applySearchResults([upcoming], { searchInfo: { andKey: 'A' } });
  assert.equal([...a.allData.search.values()][0].reserveID, 99);
});
