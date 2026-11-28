const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'HttpPublic/E3/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'HttpPublic/E3/index.html'), 'utf8');
function methods(start, end, globals = {}) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return vm.runInNewContext(`({${source.slice(first, last)}})`, { URLSearchParams, ...globals });
}
function app() {
  return methods('    formatManualTime(', '    isValidSearchRange(');
}

test('new and existing manual rules enable the SetManuAdd form', () => {
  const panel = methods('      get mode()', '      show()');
  for (const dataID of [0, 5]) {
    panel.d = { dataID, recSetting: {} };
    assert.equal(panel.isMode('autoaddmanual'), true);
  }
  assert.ok(!html.includes("isMode('addmanual')"));
  assert.match(html, /x-if="isMode\('autoaddmanual'\)"[\s\S]*?SetManuAdd\?id=\$\{d.dataID\}/);
});

test('manual-rule titles use text bindings in both list and table views', () => {
  const first = html.indexOf("isPage('#autoaddmanual')");
  const section = html.slice(first, html.indexOf('x-intersect="loadMore()"', html.indexOf("isTable('autoaddmanual'", first)));
  assert.equal((section.match(/x-text="d.title"/g) || []).length, 2);
  assert.ok(!section.includes('x-html="d.title"'));
});

test('manual time rendering stays within a day, including midnight and overnight end times', () => {
  const a = app();
  a.convert = methods('    convert: {', '    getLogoPath(').convert;
  assert.equal(a.formatManualTime(0), '00:00:00');
  assert.equal(a.formatManualTime(23 * 3600), '23:00:00');
  assert.equal(a.formatManualTime(25 * 3600), '01:00:00');
  assert.match(html, /name="endTime"[^>]*formatManualTime/);
  const table = html.slice(html.indexOf("isTable('autoaddmanual'"), html.indexOf("isTable('autoaddmanual'") + 2000);
  assert.ok(!table.includes('getDateHtml(d'));
  assert.ok(table.includes('formatManualTime(d.startTime)'));
  assert.ok(table.includes('recModeText[d.recSetting?.recMode]'));
  assert.ok(table.includes('d.recSetting?.priority'));
});

test('manual time validation accepts midnight and overnight ranges but rejects missing or invalid times', () => {
  const a = app();
  assert.equal(a.isValidManualTimes('00:00', '01:00:00'), true);
  assert.equal(a.isValidManualTimes('23:30:00', '00:30:00'), true);
  for (const [start, end] of [[null, '01:00'], ['', '01:00'], ['24:00', '01:00'], ['10:60', '11:00'], ['10:00:60', '11:00'], ['10:00junk', '11:00'], ['10:00', '10:00:00']]) {
    assert.equal(a.isValidManualTimes(start, end), false, `${start}/${end}`);
  }
});

test('cleared or out-of-range filter fields are rejected while valid filters and no restriction are accepted', () => {
  const a = app();
  const valid = { startDayOfWeek: 0, startHour: 23, startMin: 30, endDayOfWeek: 1, endHour: 0, endMin: 30 };
  assert.equal(a.isValidTimeFilters({}), true);
  assert.equal(a.isValidTimeFilters({ dateList: [valid] }), true);
  for (const change of [{ startMin: undefined }, { startHour: null }, { endHour: 24 }, { endMin: 60 }, { startDayOfWeek: 7 }]) {
    assert.equal(a.isValidTimeFilters({ dateList: [{ ...valid, ...change }] }), false);
  }
});

test('saveEntry keeps invalid automatic rules open and does not submit them', () => {
  for (const invalidFilter of [true, false]) {
    let sent = 0, errors = 0;
    const fd = new URLSearchParams({ startTime: '', endTime: '01:00' });
    const a = Object.assign(app(), methods('    saveEntry()', '    delEntry()', {
      document: { querySelector() { return {}; }, getElementById() { return { value: 'SetManuAdd?id=1' }; } },
    }), {
      ROOT: '', sidePanel: { s: invalidFilter ? { dateList: [{ startMin: undefined }] } : {} },
      getFormData: () => fd, apiFetch() { sent++; }, snackbar: { error() { errors++; } },
    });
    assert.equal(a.saveEntry(), false);
    assert.equal(sent, 0); assert.equal(errors, 1);
  }
  assert.ok(html.includes('if(saveEntry() && isNewEntry)close();'));
});

test('a valid manual rule is submitted with its day, service, and overnight times', () => {
  let submitted;
  const fd = new URLSearchParams({ addchg: '1', dayOfWeekFlag: '2', serviceID: '1-2-3', startTime: '23:30:00', endTime: '00:30:00' });
  const a = Object.assign(app(), methods('    saveEntry()', '    delEntry()', {
    document: { querySelector() { return {}; }, getElementById() { return { value: 'SetManuAdd?id=5' }; } },
  }), {
    ROOT: '/', sidePanel: { s: {} }, getFormData: () => fd,
    apiFetch(url, body) { submitted = { url, body }; },
  });
  assert.equal(a.saveEntry(), true);
  assert.equal(submitted.url, '/api/SetManuAdd?id=5');
  assert.equal(submitted.body.get('dayOfWeekFlag'), '2');
  assert.equal(submitted.body.get('endTime'), '00:30:00');
});
