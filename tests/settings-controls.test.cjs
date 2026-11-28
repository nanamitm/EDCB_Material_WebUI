const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../HttpPublic/E3/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../HttpPublic/E3/index.html'), 'utf8');
function methods(first, last) {
  const a = source.indexOf(first), b = source.indexOf(last, a);
  assert.ok(a >= 0 && b > a);
  return vm.runInNewContext(`({${source.slice(a, b)}})`, {
    URLSearchParams, console: { error() {} }, ui() {}, document: { querySelector: () => ({}) },
    NVRAM_REGION: { 1: { zip: '0010000' } },
  });
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
const response = data => ({ ok: true, json: async () => data });
function app() {
  const a = Object.assign(methods('    beginRefresh(', '    stopSSE('),
    methods('    async saveSetting(', '    parsePlugin('), methods('    parsePlugin(', '\n    settings: {'),
    methods('\n    settings: {', '\n    recname: {'));
  Object.assign(a, { ROOT: '', refreshVersions: {}, errors: [], messages: [], $refs: { form: {}, recPreset: {}, recNamePlugin: {}, writePlugin: {} },
    getFormData() { return new URLSearchParams({ presetID: this.settings.presetID, recMode: this.settings.r?.recMode }); },
    allData: { recpreset: new Map() }, lastUpdated: {}, saveCache() {}, getDataKey: p => p.id,
    clone: data => JSON.parse(JSON.stringify(data)),
    snackbar: { error(message) { a.errors.push(message); }, add(message) { a.messages.push(message); } },
  });
  return a;
}

test('older settings GETs cannot replace a successful save or its loading indicator', async () => {
  for (const fail of [false, true]) {
    const a = app(), get = deferred(), post = deferred();
    a.settings.data = { value: 'initial' }; a.fetch = () => get.promise; a.fetchWithToken = () => post.promise;
    const old = a.loadSetting(), save = a.saveSetting('form');
    if (fail) get.reject(new Error('obsolete')); else get.resolve(response({ value: 'old' }));
    await old; assert.equal(a.loading, true); assert.equal(a.errors.length, 0);
    post.resolve(response({ value: 'saved' })); await save;
    assert.equal(a.settings.data.value, 'saved'); assert.equal(a.loading, false);
  }
});

test('a settings response whose body finishes after saving remains obsolete', async () => {
  const a = app(), body = deferred();
  a.fetch = async () => ({ ok: true, json: () => body.promise });
  a.fetchWithToken = async () => response({ value: 'saved' });
  const old = a.loadSetting(); await Promise.resolve(); await a.saveSetting('form');
  body.resolve({ value: 'old' }); await old; assert.equal(a.settings.data.value, 'saved');
});

test('settings reads and repeated saves are held while a write is pending', async () => {
  const a = app(), post = deferred(); let writes = 0, reads = 0;
  a.fetchWithToken = () => { writes++; return post.promise; }; a.fetch = () => { reads++; };
  const task = a.saveSetting('form'); await a.loadSetting(); await a.saveSetting('form');
  assert.equal(writes, 1); assert.equal(reads, 0);
  post.resolve(response({ value: 'saved' })); await task; assert.equal(a.settings.saving, false);
});

test('only the latest settings read commits, and current HTTP failures are reported', async () => {
  const a = app(), old = deferred(), latest = deferred(); let calls = 0;
  a.fetch = () => ++calls === 1 ? old.promise : latest.promise;
  const x = a.loadSetting(), y = a.loadSetting(); latest.resolve(response({ value: 'new' })); await y;
  old.resolve(response({ value: 'old' })); await x; assert.equal(a.settings.data.value, 'new');
  a.fetch = async () => ({ ok: false, status: 500 }); await a.loadSetting();
  assert.equal(a.settings.data.value, 'new'); assert.equal(a.errors.length, 1);
});

test('deletion resets the editor and bound selection to a valid default after renumbering', async () => {
  const a = app(), presets = [{ id: 0, recSetting: { recMode: 0 } }, { id: 1, recSetting: { recMode: 1 } }, { id: 2, recSetting: { recMode: 2 } }];
  presets.forEach(p => a.allData.recpreset.set(p.id, p)); a.loadPreset(1);
  a.fetchWithToken = async () => response([presets[0], { ...presets[2], id: 1 }]);
  await a.removePreset(); assert.equal(a.settings.presetID, 0); assert.equal(a.settings.r.recMode, 0);
  assert.equal(a.allData.recpreset.get(1).recSetting.recMode, 2);
  a.settings.r.recMode = 9; assert.equal(a.allData.recpreset.get(0).recSetting.recMode, 0);
  assert.match(html, /<select x-model\.number="presetID" @change="loadPreset\(\$el.value\)">/);
});

test('default deletion sends nothing, failed deletion preserves editing state', async () => {
  const a = app(); a.settings.presetID = 0; a.fetchWithToken = () => { throw new Error('must not send'); };
  await a.removePreset(); a.settings.presetID = 1; a.settings.r = { recMode: 1 };
  a.fetchWithToken = async () => response({ err: 'failure' }); await a.removePreset();
  assert.equal(a.settings.presetID, 1); assert.equal(a.settings.r.recMode, 1); assert.equal(a.errors[0], 'failure');
});

test('preset mutations cannot overlap and delete a second renumbered preset', async () => {
  const a = app(), post = deferred(); let calls = 0;
  a.settings.presetID = 1; a.settings.r = { recMode: 1 };
  a.fetchWithToken = () => { calls++; return post.promise; };
  const first = a.removePreset(); await a.removePreset(); await a.savePreset();
  assert.equal(calls, 1);
  post.resolve(response([{ id: 0, recSetting: { recMode: 0 } }])); await first;
  assert.equal(a.settings.presetSaving, false); assert.equal(a.settings.presetID, 0);
});

test('only the selected plugin response commits and subsequent saves target that plugin', async () => {
  const a = app(), old = deferred(), latest = deferred(); let calls = 0, saved;
  a.fetch = () => ++calls === 1 ? old.promise : latest.promise;
  const x = a.loadPlugIn(1, 'A.dll'), y = a.loadPlugIn(1, 'B & C.dll');
  assert.equal(a.settings.recNamePlugin, null); await a.savePlugIn(1);
  latest.resolve(response({ name: 'B & C.dll' })); await y; old.resolve(response({ name: 'A.dll' })); await x;
  a.fetchWithToken = async url => { saved = url; return response({ name: 'B & C.dll' }); };
  await a.savePlugIn(1); assert.equal(new URL(saved, 'http://localhost').searchParams.get('item'), 'B & C.dll');
  assert.equal(a.settings.recNamePlugin.name, 'B & C.dll');
});

test('obsolete plugin errors and saves cannot overwrite a newer selection', async () => {
  const a = app(), old = deferred(), latest = deferred(); let calls = 0;
  a.fetch = () => ++calls === 1 ? old.promise : latest.promise;
  const x = a.loadPlugIn(1, 'A.dll'), y = a.loadPlugIn(1, 'B.dll');
  old.reject(new Error('obsolete')); await x; assert.equal(a.loading, true); assert.equal(a.errors.length, 0);
  latest.resolve(response({ name: 'B.dll' })); await y;
  const save = deferred(); a.fetchWithToken = () => save.promise;
  const task = a.savePlugIn(1); a.fetch = async () => response({ name: 'C.dll' }); await a.loadPlugIn(1, 'C.dll');
  save.resolve(response({ name: 'B.dll' })); await task;
  assert.equal(a.settings.recNamePlugin.name, 'C.dll'); assert.equal(a.settings.pluginSaving[1], false);
});

test('plugin kinds use independent request generations', async () => {
  const a = app(), rec = deferred(), write = deferred();
  a.fetch = url => url.includes('mode=1') ? rec.promise : write.promise;
  const x = a.loadPlugIn(1, 'Rec.dll'), y = a.loadPlugIn(2, 'Write.dll');
  write.resolve(response({ name: 'Write.dll' })); await y; rec.resolve(response({ name: 'Rec.dll' })); await x;
  assert.equal(a.settings.recNamePlugin.name, 'Rec.dll'); assert.equal(a.settings.writePlugin.name, 'Write.dll');
});

test('current plugin HTTP errors leave no stale editable target', async () => {
  const a = app(); a.settings.recNamePlugin = { name: 'old.dll' };
  a.fetch = async () => ({ ok: false, status: 500 }); await a.loadPlugIn(1, 'new.dll');
  assert.equal(a.settings.recNamePlugin, null); assert.equal(a.errors.length, 1);
});

test('postal lookup uses the API nvram object and preserves leading zeros', () => {
  const a = app(); a.settings.data = { webui: {}, nvram: { region: 1, zip: '' } };
  a.settings.regionToZip(); assert.equal(a.settings.data.nvram.zip, '0010000');
});

function log() {
  const { log } = methods('\n    log: {', '    setThemeColor('); log.opened = true; return log;
}
const logResponse = text => ({ ok: true, text: async () => text });
test('log type and page cannot display an older response', async () => {
  const a = log(), old = deferred(), latest = deferred(); let calls = 0;
  a.app = { ROOT: '', fetch: () => ++calls === 1 ? old.promise : latest.promise };
  const x = a.load(0); a.debug = true; const y = a.load(1);
  latest.resolve(logResponse('2026/11/28 12:00:00 current')); await y;
  old.resolve(logResponse('2026/11/28 11:00:00 old')); await x;
  assert.equal(a.page, 1); assert.equal(a.debug, true); assert.equal(a.data[0].text, 'current');
});

test('closing the log invalidates pending body reads and errors', async () => {
  for (const fail of [false, true]) {
    const a = log(), body = deferred(); a.app = { ROOT: '', fetch: async () => ({ ok: true, text: () => body.promise }) };
    const task = a.load(); await Promise.resolve(); a.close();
    if (fail) body.reject(new Error('obsolete')); else body.resolve('old'); await task;
    assert.equal(a.data.length, 0); assert.equal(a.page, 0);
  }
});

test('log formatting remains compatible and HTTP errors are visible', async () => {
  const a = log(); a.app = { ROOT: '', fetch: async () => logResponse('[261128120000.123] debug\nraw') };
  await a.load(); assert.equal(a.data[0].time, '2026/11/28 12:00:00.123'); assert.equal(a.data[1].text, 'raw');
  a.app.fetch = async () => ({ ok: false, status: 404 }); await a.load();
  assert.equal(a.data[0].text, 'ログの取得ができませんでした');
});
