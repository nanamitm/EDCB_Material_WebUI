const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../HttpPublic/E3/js/app.js'), 'utf8');
function methods(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return vm.runInNewContext(`({${source.slice(first, last)}})`, { ui() {}, console: { error() {} }, document: { getElementById() { return null; } } });
}
function deferred() {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
const response = data => ({ ok: true, json: async () => data });
function app() {
  const a = Object.assign(methods('    beginDetailRequest()', '    sidePanel:'), methods('    async openRecinfoDetail(', '    formatManualTime('), {
    ROOT: '', detailRequestId: 0, detailFetchId: null, params: {}, errors: 0, shown: 0,
    pageMap: { '#recinfo': { api: 'EnumRecInfo' } }, allData: { recinfo: new Map([[1, { id: 1 }], [2, { id: 2 }]]) },
    parseProgramInfo: () => ({}), updateQueryParam(p) { Object.assign(this.params, p); },
    sidePanel: {}, snackbar: { error() { a.errors++; } },
  });
  a.sidePanel.show = () => { a.shown++; };
  return a;
}

test('an older recording detail response cannot replace a newer recording or mutate its cache', async () => {
  const a = app(), old = deferred(), latest = deferred(); let calls = 0;
  a.fetch = () => ++calls === 1 ? old.promise : latest.promise;
  const first = a.openRecinfoDetail({ id: 1 }), second = a.openRecinfoDetail({ id: 2 });
  assert.equal(a.shown, 0);
  latest.resolve(response({ id: 2, programInfo: 'B' })); await second;
  old.resolve(response({ id: 1, programInfo: 'A' })); await first;
  assert.equal(a.detail.id, 2); assert.equal(a.params.id, 2); assert.equal(a.shown, 1);
  assert.equal(a.allData.recinfo.get(1).programInfo, undefined);
});

test('closing a pending recording detail clears the loading state and prevents reopening', async () => {
  const a = app(), pending = deferred(); a.fetch = () => pending.promise;
  const task = a.openRecinfoDetail({ id: 1 }); assert.equal(a.loading, true);
  const panel = methods('    sidePanel: {', '    isServiceModeDef(').sidePanel;
  panel.app = a; panel.el = { close() {}, previousElementSibling: { classList: { remove() {} } } };
  panel.close(false); assert.equal(a.loading, false);
  pending.resolve(response({ id: 1, programInfo: 'A' })); await task;
  assert.equal(a.shown, 0); assert.equal(a.detail, undefined);
});

test('cached detail selection invalidates pending reads and retains subsequent edits', async () => {
  const a = app(), pending = deferred(); a.fetch = () => pending.promise;
  const task = a.openRecinfoDetail({ id: 1 });
  await a.openRecinfoDetail({ id: 2, programInfo: 'B', recFilePath: '/B.ts' });
  assert.equal(a.loading, false);
  a.detail.recFilePath = '/edited-B.ts';
  pending.resolve(response({ id: 1, programInfo: 'A' })); await task;
  assert.equal(a.detail.recFilePath, '/edited-B.ts');
});

test('obsolete read errors do not change the newer loading state or show errors', async () => {
  const a = app(), old = deferred(), latest = deferred(); let calls = 0;
  a.fetch = () => ++calls === 1 ? old.promise : latest.promise;
  const first = a.openRecinfoDetail({ id: 1 }), second = a.openRecinfoDetail({ id: 2 });
  old.reject(Error('old connection failed')); await first;
  assert.equal(a.errors, 0); assert.equal(a.loading, true);
  latest.resolve(response({ id: 2, programInfo: 'B' })); await second;
  assert.equal(a.loading, false);
});

test('missing or failed details never expose a stale deletion or path-edit target', async () => {
  for (const result of [response({ err: 'missing' }), response({ id: 2, programInfo: 'wrong ID' }), { ok: false, status: 500 }]) {
    const a = app(); a.fetch = async () => result;
    await a.openRecinfoDetail({ id: 1 });
    assert.equal(a.shown, 0); assert.equal(a.errors, 1); assert.equal(a.loading, false);
    assert.equal(a.params.id, undefined);
  }
});

test('valid recording details preserve the numeric timestamp used by the list cache', async () => {
  const a = app(), startTime = '2026-11-28T12:00:00+09:00';
  a.fetch = async () => response({ id: 1, programInfo: 'A', startTime });
  await a.openRecinfoDetail({ id: 1 });
  assert.equal(a.detail.startTime, new Date(startTime).getTime());
  assert.equal(a.allData.recinfo.get(1), a.detail);
});
