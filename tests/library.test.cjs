const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../HttpPublic/E3/js/app.js'), 'utf8');
function setup() {
  const start = source.indexOf('\n    library: {');
  const end = source.indexOf('    thumb:', start);
  const library = vm.runInNewContext(`({${source.slice(start, end)}}).library`, { URLSearchParams, console: { error() {} } });
  const app = library.app = {
    params: { i: 1, d: 'A', p: 'parent,child' }, page: '#library', ROOT: '',
    sets: { sort: { library: { order: 'name', asc: true } } },
    isPage(page) { return this.page === page; }, rollThumbLeave() {},
    openPage(page, params) { this.opened = { page, params }; },
    errors: [], snackbar: { error(message) { app.errors.push(message); } },
  };
  return { library, app };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const data = name => ({ dirname: name, index: 1, dirhash: name, file: [{ name: 'episode.mp4', hash: 'same-name' }] });
const response = value => ({ ok: true, json: async () => value });

test('folder response and playback parameters stay together when requests finish out of order', async () => {
  const { library, app } = setup(), a = deferred(), b = deferred(); let calls = 0;
  app.fetch = () => ++calls === 1 ? a.promise : b.promise;
  const first = library.load(); app.params = { i: 1, d: 'B' }; const second = library.load();
  b.resolve(response(data('B'))); await second;
  a.resolve(response(data('A'))); await first;
  assert.equal(library.data.dirname, 'B');
  library.play(library.data.file[0]);
  assert.equal(app.opened.params.d, 'B'); assert.equal(app.opened.params.h, 'same-name');
});

test('stale failures do not replace a newer listing or clear its loading indicator', async () => {
  const { library, app } = setup(), a = deferred(), b = deferred(); let calls = 0;
  app.fetch = () => ++calls === 1 ? a.promise : b.promise;
  const first = library.load(); app.params = { i: 1, d: 'B' }; const second = library.load();
  a.reject(new Error('old request')); await first;
  assert.equal(app.loading, true); assert.equal(library.data.err, undefined);
  b.resolve(response(data('B'))); await second;
  assert.equal(app.loading, false); assert.equal(library.data.dirname, 'B');
});

test('leaving the library through loadAll invalidates a pending JSON body', async () => {
  const { library, app } = setup(), body = deferred();
  app.fetch = async () => ({ ok: true, json: () => body.promise });
  const task = library.load(); await Promise.resolve();
  app.page = '#watch';
  const start = source.indexOf('    async loadAll() {') + '    async loadAll() {'.length;
  const end = source.indexOf('      if (this.searchLoading)', start);
  vm.runInNewContext(`(function(){${source.slice(start, end)}})`).call({ library });
  assert.equal(app.loading, false);
  body.resolve(data('A')); await task;
  assert.equal(library.data.dirname, undefined);
  assert.equal(library.lastParams.home, 1);
});

test('nested folder parameters are preserved for playback and cache reuse', async () => {
  const { library, app } = setup(); let calls = 0;
  app.fetch = async url => {
    calls++; assert.deepEqual(new URL(url, 'http://localhost').searchParams.getAll('p'), ['parent', 'child']);
    return response(data('A'));
  };
  await library.load(); await library.load();
  assert.equal(calls, 1); assert.equal(library.data.p_raw, 'parent,child');
  library.play(library.data.file[0]); assert.equal(app.opened.params.p, 'parent,child');
});

test('current API and HTTP errors are reported without retaining a playable listing', async () => {
  for (const result of [response({ err: 'missing folder' }), { ok: false, status: 500 }]) {
    const { library, app } = setup(); app.fetch = async () => result;
    await library.load();
    assert.equal(library.data.file.length, 0); assert.equal(app.loading, false);
    assert.ok(library.data.err);
    if (result.ok) assert.deepEqual(app.errors, ['missing folder']);
  }
});
