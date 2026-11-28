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
  return vm.runInNewContext(`({${source.slice(first, last)}})`, { ui() {}, URLSearchParams, document: { getElementById() { return null; } } });
}
const clone = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve; const promise = new Promise(yes => { resolve = yes; });
  return { resolve, promise };
}

test('subtitle and data controls are submitted by the production form serializer', () => {
  const form = methods('    getFormData(', '    saveEntry()');
  for (const suffix of ['', '(r)']) {
    const tags = [...html.matchAll(/<input\b[^>]*>/g)].map(m => m[0]);
    const inputs = [1, 2].map(bit => {
      const tag = tags.find(t => t.includes(`name="serviceMode_${bit}"`) && t.includes(`:disabled="isServiceModeDef${suffix || '()'}"`));
      assert.ok(tag, `missing named control ${bit} ${suffix}`);
      return { name: `serviceMode_${bit}`, type: 'checkbox', checked: true };
    });
    const fd = form.getFormData({ querySelectorAll: () => inputs });
    assert.equal(fd.get('serviceMode_1'), '1');
    assert.equal(fd.get('serviceMode_2'), '1');
    inputs[0].checked = false;
    assert.equal(form.getFormData({ querySelectorAll: () => inputs }).has('serviceMode_1'), false);
  }
});

test('applying a default preset removes old optional margins and does not mutate the preset', () => {
  const setting = { priority: 3, recFolderList: [{ recFolder: 'original' }] };
  const panel = Object.assign(methods('      applyPreset(', '      title()'), {
    d: { recSetting: { startMargin: 60, endMargin: 120 } },
    app: { clone, detail: {}, allData: { recpreset: new Map([[0, { recSetting: setting }]]) } },
  });
  panel.applyPreset(0);
  assert.equal(panel.d.recSetting.startMargin, undefined);
  assert.equal(panel.d.recSetting.endMargin, undefined);
  panel.d.recSetting.recFolderList[0].recFolder = 'edited';
  assert.equal(setting.recFolderList[0].recFolder, 'original');
  panel.app.detail.recSetting = { priority: 1 };
  panel.d.recSetting.startMargin = 30;
  panel.applyPreset(65535);
  assert.deepEqual(panel.d.recSetting, { priority: 1 });
});

test('tuner selection follows actual IDs while preserving a valid selection', () => {
  const app = Object.assign(methods('    ensureActiveTuner()', '    updateDisplayList()'), {
    activeTunerId: null, allData: { tunerreserve: new Map([[65537, {}], [65538, {}]]) },
  });
  app.ensureActiveTuner(); assert.equal(app.activeTunerId, 65537);
  app.activeTunerId = 65538; app.ensureActiveTuner(); assert.equal(app.activeTunerId, 65538);
  app.allData.tunerreserve.delete(65538); app.ensureActiveTuner(); assert.equal(app.activeTunerId, 65537);
  app.allData.tunerreserve.clear(); app.ensureActiveTuner(); assert.equal(app.activeTunerId, null);
  app.allData.tunerreserve.set(-1, {}); app.ensureActiveTuner(); assert.equal(app.activeTunerId, -1);
});

function detailApp() {
  return Object.assign(methods('    beginDetailRequest()', '    sidePanel:'), methods('    async openProgramDetailById(', '    openAutoaddDetail('), {
    detailRequestId: 0, now: Date.now(), params: {},
    sidePanel: { show() {} }, isPage: () => true,
    getEventID: d => `1-2-3-${d.eid}`,
    updateQueryParam(p) { Object.assign(this.params, p); },
  });
}
function reservation(app, id) {
  return { reserveID: id, eid: id + 10, startTime: app.now + 3600000, durationSecond: 600, recSetting: { priority: id } };
}

test('late reservation details cannot replace the newer selection or its URL', async () => {
  const app = detailApp(), a = deferred(), b = deferred(); let calls = 0;
  app.getEpgById = () => ++calls === 1 ? a.promise : b.promise;
  const first = app.openProgramDetail(reservation(app, 1));
  const second = app.openProgramDetail(reservation(app, 2));
  b.resolve({ shortInfo: { event_name: 'B' } }); await second;
  app.detail.recSetting.priority = 5;
  a.resolve({ shortInfo: { event_name: 'A' } }); await first;
  assert.equal(app.detail.reserveID, 2);
  assert.equal(app.params.id, 2);
  assert.equal(app.detail.recSetting.priority, 5);
});

test('closing the panel invalidates a pending detail request', async () => {
  const app = detailApp(), pending = deferred(); let shown = false;
  app.getEpgById = () => pending.promise;
  app.sidePanel.show = () => { shown = true; };
  const task = app.openProgramDetail(reservation(app, 1));
  const panel = Object.assign(methods('    sidePanel: {', '    isServiceModeDef(').sidePanel, {
    app, el: { close() {}, previousElementSibling: { classList: { remove() {} } } },
  });
  panel.close(false);
  pending.resolve({}); await task;
  assert.equal(shown, false);
  assert.equal(app.detail, undefined);
});

test('late ID lookup cannot reopen a reservation after another detail selection', async () => {
  const app = detailApp(), pending = deferred();
  app.getEpgById = () => pending.promise;
  const task = app.openProgramDetailById('1-2-3-11');
  await app.openProgramDetail({ reserveID: 2, eid: 65535 });
  pending.resolve(reservation(app, 1)); await task;
  assert.equal(app.detail.reserveID, 2);
  assert.equal(app.params.id, 2);
});

test('program reservation forms submit an end date as well as an end time', () => {
  assert.match(html, /name="enddate"[^>]*d\.durationSecond/);
  const start = new Date('2026-11-28T10:00:00+09:00');
  const end = new Date(start.getTime() + 25 * 3600000);
  assert.equal(end.getTime() - start.getTime(), 90000000);
});

test('changing the program start date moves the end date by the same number of days', () => {
  const tag = [...html.matchAll(/<input\b[^>]*name="startdate"[^>]*>/g)].map(m => m[0])[0];
  assert.ok(tag, 'missing startdate input');
  const expr = tag.match(/@change="([^"]*)"/)?.[1];
  assert.ok(expr, 'startdate must update the end date on change');
  assert.ok(/<input\b[^>]*name="enddate"[^>]*x-ref="enddate"/.test(html));
  const run = (start, end, next) => {
    const scope = { startDay: start, $el: { value: next }, $refs: { enddate: { value: end } } };
    Function('scope', `with (scope) { ${expr} }`)(scope);
    return [scope.$refs.enddate.value, scope.startDay];
  };
  // 日またぎの予約は翌日終了のまま全体が移動する
  assert.deepEqual(run('2026-11-28', '2026-11-29', '2026-11-30'), ['2026-12-01', '2026-11-30']);
  // 同日の予約・月末や年末をまたぐ移動
  assert.deepEqual(run('2026-11-28', '2026-11-28', '2026-12-31'), ['2026-12-31', '2026-12-31']);
  assert.deepEqual(run('2026-12-31', '2027-01-01', '2026-12-30'), ['2026-12-31', '2026-12-30']);
  // 開始日を消した場合は終了日を変更しない
  assert.deepEqual(run('2026-11-28', '2026-11-29', ''), ['2026-11-29', '2026-11-28']);
});
