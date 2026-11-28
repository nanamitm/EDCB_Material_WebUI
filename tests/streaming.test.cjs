const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../HttpPublic/E3/js/ts-loader.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../HttpPublic/E3/js/app.js'), 'utf8');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function environment(attrs = [], native = false) {
  const timers = new Map(), requests = [], events = [], loads = []; let sequence = 0;
  const e = { dataset: { aribb24OptionJson: '%7B%7D' }, currentTime: 0,
    hasAttribute: a => attrs.includes(a), getAttribute: () => 'token',
    canPlayType: () => native ? 'maybe' : '', addEventListener() {},
    setAttribute() {}, removeAttribute() {}, dispatchEvent(ev) { events.push(ev.type); },
    getContext: () => ({ configure() {} }) };
  class Hls {
    static isSupported() { return true; }
    static Events = { MANIFEST_PARSED: 'manifest', FRAG_PARSING_METADATA: 'metadata' };
    attachMedia() {} on() {} destroy() {} loadSource(src) { if (src) loads.push(src); }
  }
  const context = { URL, URLSearchParams, Uint8Array, Event, AbortController, Hls,
    navigator: { userAgent: '', gpu: { requestAdapter: async () => ({ requestDevice: async () => ({ destroy() {} }) }), getPreferredCanvasFormat: () => 'bgra8unorm' } },
    location: { href: 'http://localhost/E3/' }, document: { getElementById() {}, addEventListener() {} },
    console: { warn() {}, error() {} }, crypto: { getRandomValues(a) { a.fill(++sequence); } },
    aribb24js: { CanvasRenderer: class { detachMedia() {} attachMedia() {} } },
    setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    fetch(src, options) { const d = deferred(); requests.push({ src: String(src), options, ...d }); return d.promise; } };
  return { e, context, timers, requests, loads, events,
    async runTimers() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) fn(); await tick(); } };
}
function hls(attrs = ['alwaysUseHls'], native = false, supported = true) {
  const state = environment(attrs, native);
  state.context.Hls.isSupported = () => supported;
  const start = source.indexOf('const hlsMixin'), end = source.indexOf('class HlsLoader', start);
  const Loader = vm.runInNewContext(source.slice(start, end) + '\nhlsMixin()', state.context);
  state.loader = new Loader(state.e); return state;
}
const playlist = ready => ({ ok: true, text: async () => ready ? '#EXT-X-MEDIA-SEQUENCE:1' : '#EXTM3U' });

test('progressive playback sends quality, audio, seek, speed and reload identity', () => {
  const { loader, e } = hls([]);
  loader.setOption({ id: 5 }); loader.loadSource('api/xcode?recid=1');
  const load = new URL(e.src).searchParams.get('load'); assert.ok(load);
  loader.setAudioTrack(1); loader.setFast(2, 3); loader.setSeek(120);
  const p = new URL(e.src).searchParams;
  assert.equal(p.get('option'), '5'); assert.equal(p.get('audio2'), '1');
  assert.equal(p.get('ofssec'), '120'); assert.equal(p.get('fast'), '3'); assert.equal(p.get('reload'), load);
});

test('HLS prohibition overrides both hls.js and native HLS selection', () => {
  for (const native of [false, true]) {
    const { loader, e, requests } = hls(['noHls', 'alwaysUseHls'], native);
    loader.setOption(2); loader.loadSource('api/view?n=0&id=1-2-3');
    assert.equal(loader.hls, undefined); assert.equal(requests.length, 0);
    assert.equal(new URL(e.src).searchParams.get('hls'), null);
    assert.equal(new URL(e.src).searchParams.get('option'), '2');
  }
});

test('old HLS responses cannot restore a previous channel', async () => {
  for (const native of [false, true]) {
    const s = hls(native ? [] : ['alwaysUseHls'], native);
    s.loader.loadSource('api/view?id=1-2-3'); s.loader.reset(); s.loader.loadSource('api/view?id=1-2-4');
    assert.equal(s.requests[0].options.signal.aborted, true);
    s.requests[1].resolve(playlist(true)); await tick(); await s.runTimers();
    s.requests[0].resolve(playlist(true)); await tick(); await s.runTimers();
    assert.ok((native ? s.e.src : s.loads[0]).includes('id=1-2-4'));
    if (!native) assert.equal(s.loads.length, 1);
    assert.equal(s.events.includes('error'), false);
  }
});

test('native HLS starts through the handshake when hls.js is unavailable', async () => {
  const s = hls(['alwaysUseHls'], true, false);
  s.loader.loadSource('api/view?id=1-2-3');
  assert.equal(s.requests.length, 1);
  s.requests[0].resolve(playlist(true)); await tick(); await s.runTimers();
  assert.ok(new URL(s.e.src).searchParams.get('hls'));
});

test('reset/destroy cancels HLS body reads, ready delays and polling timers', async () => {
  for (const phase of ['body', 'ready', 'poll']) {
    const s = hls(), body = deferred();
    s.loader.loadSource('api/xcode?recid=1');
    s.requests[0].resolve(phase === 'body' ? { ok: true, text: () => body.promise } : playlist(phase === 'ready'));
    await tick(); s.loader.destroy(); body.resolve('#EXT-X-MEDIA-SEQUENCE:1');
    await tick(); await s.runTimers();
    assert.equal(s.loads.length, 0); assert.equal(s.requests.length, 1); assert.equal(s.events.includes('error'), false);
  }
});

test('HLS polls with GET after one POST and reports only current failures', async () => {
  const s = hls(); s.loader.loadSource('api/xcode?recid=1');
  assert.equal(s.requests[0].options.method, 'POST');
  s.requests[0].resolve(playlist(false)); await tick(); await s.runTimers();
  assert.equal(s.requests[1].options.method, undefined);
  assert.equal(s.requests[1].options.body, undefined);
  s.requests[1].resolve({ ok: false, status: 404 }); await tick();
  assert.equal(s.events.filter(v => v === 'error').length, 1);
  s.loader.loadSource('api/xcode?recid=2'); s.loader.reset();
  s.requests[2].reject(new Error('obsolete')); await tick();
  assert.equal(s.events.filter(v => v === 'error').length, 1);
});

function tsLive() {
  const s = environment(), wasm = deferred();
  s.context.createWasmModule = () => wasm.promise;
  s.context.window = { createWasmModule: s.context.createWasmModule };
  const end = source.indexOf('class TsLive extends');
  const Loader = vm.runInNewContext(source.slice(source.indexOf('const tsliveMixin'), end) + '\ntsliveMixin()', s.context);
  s.loader = new Loader(s.e);
  s.ready = async () => { wasm.resolve({ setAudioGain() {}, setDetelecineMode() {}, pause() {}, resume() {}, setCaptionCallback() {}, setStatsCallback() {}, reset() {} }); await tick(); };
  return s;
}

test('destroyed TS-Live initialization cannot start a stream', async () => {
  const s = tsLive(); s.loader.loadSource('api/view?id=1-2-3');
  await tick(); s.loader.destroy(); await s.ready(); await s.runTimers();
  assert.equal(s.requests.length, 0); assert.equal(s.timers.size, 0);
});

test('TS-Live initialization keeps only the latest requested source and respects reset', async () => {
  for (const reset of [false, true]) {
    const s = tsLive(); s.loader.loadSource('api/view?id=1-2-3'); s.loader.loadSource('api/view?id=1-2-4');
    if (reset) s.loader.reset(); await s.ready();
    assert.equal(s.requests.length, reset ? 0 : 1);
    if (!reset) assert.ok(s.requests[0].src.includes('id=1-2-4'));
  }
});

test('destroying TS-Live aborts its stream and ignores the late HTTP response', async () => {
  const s = tsLive(); await s.ready(); s.loader.loadSource('api/view?id=1-2-3');
  s.loader.destroy(); assert.equal(s.requests[0].options.signal.aborted, true);
  s.requests[0].resolve({ ok: true, body: { getReader() { throw new Error('obsolete reader must not open'); } } });
  await tick(); assert.equal(s.events.includes('error'), false);
});

function player() {
  const s = environment(), start = appSource.indexOf('\n    player: {'), end = appSource.indexOf('\n    nvram:', start);
  const p = vm.runInNewContext(`({${appSource.slice(start, end)}}).player`, { ...s.context,
    config: { xcode: [] }, Alpine: { raw: x => x }, window: { location: {} }, history: {},
    document: { createElement: () => ({ canPlayType: () => '' }) } });
  p.vid = { reset() {}, destroy() {}, loadSource: src => s.loads.push(src) };
  p.video = { setAttribute() {} }; p.chap = { reset() {}, destroy() {}, setChapters: () => [[], []] };
  p.set = { nwtv: 0 };
  p.app = { ROOT: '', page: '#watch', params: {}, ctok: { xcode: 'xcode', view: 'view' }, $refs: {},
    isPage(page) { return this.page === page; }, fetch: s.context.fetch, updateParams() {} };
  return { ...s, player: p };
}
const video = name => ({ ok: true, json: async () => ({ path: `/media/${name}.ts`, name }) });

test('old video metadata cannot replace a newer recording or live channel', async () => {
  for (const live of [false, true]) {
    const s = player(), p = s.player, task = p.loadVideo({ h: 'A', i: 1 });
    if (live) p.loadLive('1-2-3'); else await p.loadVideo({ recid: 9 });
    s.requests[0].resolve(video('A')); await task;
    assert.equal(s.loads.length, 1); assert.equal(p.videoInfo, null);
    assert.ok(s.loads[0].includes(live ? 'id=1-2-3' : 'recid=9'));
  }
});

test('video metadata commits only the latest response and obsolete errors keep its spinner', async () => {
  const s = player(), p = s.player;
  const a = p.loadVideo({ h: 'A' }), b = p.loadVideo({ h: 'B' });
  s.requests[0].reject(new Error('old')); await a; assert.equal(p.app.loading, true);
  s.requests[1].resolve(video('B')); await b;
  assert.equal(p.videoInfo.name, 'B'); assert.equal(p.app.loading, false); assert.equal(s.loads.length, 1);
});

test('leaving the player invalidates metadata during JSON decoding', async () => {
  for (const destroy of [false, true]) {
    const s = player(), p = s.player, body = deferred(), task = p.loadVideo({ h: 'A' });
    s.requests[0].resolve({ ok: true, json: () => body.promise }); await tick();
    p.app.page = '#library';
    if (destroy) p.destroy();
    else {
      const start = appSource.indexOf('    async loadAll() {') + '    async loadAll() {'.length;
      const end = appSource.indexOf('      if (this.searchLoading)', start);
      vm.runInNewContext(`(function(){${appSource.slice(start, end)}})`).call({ player: p });
    }
    body.resolve({ path: '/media/A.ts' }); await task;
    assert.equal(s.loads.length, 0); assert.equal(p.videoInfo, null); assert.equal(p.app.loading, false);
  }
});

test('current video detail errors do not restart the previous stream', async () => {
  for (const res of [{ ok: false, status: 500 }, { ok: true, json: async () => ({ err: 'missing' }) }]) {
    const s = player(), p = s.player, task = p.loadVideo({ h: 'A' });
    s.requests[0].resolve(res); await task;
    assert.equal(s.loads.length, 0); assert.equal(p.videoInfo, null);
    assert.equal(p.app.loading, false); assert.equal(p.isLoading, false);
  }
});
