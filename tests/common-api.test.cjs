const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'HttpPublic/E3/js/app.js'), 'utf8');
// Load the actual methods without initializing Alpine or making requests to EDCB.
function methods(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return Function(`return ({${source.slice(from, to)}})`)();
}
const convert = methods('      text(a) {', '      title(a) {');

test('program descriptions escape markup, attributes and existing entities', () => {
  assert.equal(convert.text('<img src=x onerror="alert(1)"> & \'quoted\''),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;');
  assert.equal(convert.text('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
  assert.equal(convert.text(undefined), '');
});

test('program descriptions preserve line breaks and safe HTTP links', () => {
  assert.equal(convert.text('A\r\nhttps://example.com:8080/a+b?x=1&y=2\nB'),
    'A<br><a class="link underline" href="https://example.com:8080/a+b?x=1&amp;y=2" target="_blank" rel="noreferrer">https://example.com:8080/a+b?x=1&amp;y=2</a><br>B');
  const html = convert.text('https://example.com/" onclick="alert(1)');
  assert.ok(html.includes('href="https://example.com/" target="_blank"'));
  assert.ok(html.includes('&quot; onclick=&quot;alert(1)'));
  assert.ok(!convert.text('javascript:alert(1)').includes('<a'));
});

test('the EPG description uses the same escaped formatter', () => {
  const html = fs.readFileSync(path.join(root, 'HttpPublic/E3/index.html'), 'utf8');
  assert.ok(!/x-html="[^"\n]*text_char\.replace/.test(html));
  assert.ok(html.includes('x-html="convert.text(d.shortInfo?.text_char)"'));
});

function client(fetch) {
  return Object.assign(methods('    async fetchWithToken(', '    // クエリパラメータを解析'), {
    ctok: { setautoadd: 'old' },
    getTokenKey: () => 'setautoadd',
    fetch,
    refreshes: 0,
    async refreshCtok() { this.refreshes++; this.ctok.setautoadd = 'new'; },
    snackbar: { error() {} },
  });
}

test('a lost response does not replay an already committed addition', async () => {
  let mutations = 0;
  const error = new TypeError('Connection lost after server commit');
  const app = client(async () => { mutations++; throw error; });
  await assert.rejects(app.fetchWithToken('/api/SetAutoAdd', {
    method: 'POST', body: new URLSearchParams({ addchg: '1' }),
  }), e => e === error);
  assert.equal(mutations, 1);
  assert.equal(app.refreshes, 1);
  let token;
  app.fetch = async (url, options) => { token = options.body.get('ctok'); return { ok: true }; };
  await app.fetchWithToken('/api/SetAutoAdd', { method: 'POST', body: new URLSearchParams() });
  assert.equal(token, 'new');
});

test('GET mutations are not replayed after connection loss either', async () => {
  let calls = 0;
  const error = new TypeError('Connection lost');
  const app = client(async () => { calls++; throw error; });
  // URL construction requires the same location base used in the browser.
  global.window = { location: { href: 'https://example.com/E3/index.html' } };
  try {
    await assert.rejects(app.fetchWithToken('/api/SetReserve?oneclick=1'), e => e === error);
    assert.equal(calls, 1);
  } finally {
    delete global.window;
  }
});

test('timeouts and HTTP errors are surfaced without replay', async () => {
  for (const response of [new DOMException('Timed out', 'TimeoutError'), { ok: false, status: 403 }]) {
    let calls = 0;
    const app = client(async () => { calls++; if (response instanceof Error) throw response; return response; });
    await assert.rejects(app.fetchWithToken('/api/SetAutoAdd', { method: 'POST' }));
    assert.equal(calls, 1);
    assert.equal(app.refreshes, 0);
  }
});
