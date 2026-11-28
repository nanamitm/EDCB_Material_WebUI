const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'HttpPublic/E3/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'HttpPublic/E3/index.html'), 'utf8');
function setup() {
  let id = 0; const timers = new Map();
  const context = vm.createContext({
    setTimeout(fn) { const key = ++id; timers.set(key, fn); return key; },
    clearTimeout(key) { timers.delete(key); },
  });
  function methods(start, end) {
    const first = source.indexOf(start), last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first);
    return vm.runInContext(`({${source.slice(first, last)}})`, context);
  }
  const start = new Date('2026-11-28T04:00:00+09:00').getTime();
  const main = { onid: 4, tsid: 1, sid: 101, subSids: [], service_name: 'main' };
  const app = Object.assign(methods('    getServiceID(', '    getTunerID('),
    methods('    loadEpg()', '    async loadWeeklyEpg()'),
    methods('    needsNowOnAirSync()', '    get serviceList()'),
    methods('    ensureOnAirNetwork()', '    // 検索UI用'), {
      now: start + 60000, params: { tab: 3 }, sets: { oneseg: false }, lastUpdated: { epg: 1, reserve: 0 },
      dashboardData: {}, epg: { epgStartTime: start, cache: 0, cacheDays: 3, loadId: 0, extraData: new Map(), servicesToDisplay: [], activeNetwork: 0 },
      allData: { epg: new Map(), service: new Map([['4-1-101', main]]), reserve: new Map() },
      getDataKey(s) { return this.getServiceID(s); }, getEpgKey: time => String(time),
      isActiveNetwork: n => n === 0, getNetworkIndex: () => 3, isGroupSub: () => false,
      $main: { scrollTo() {} },
    });
  Object.defineProperty(app, 'serviceList', Object.getOwnPropertyDescriptor(methods('    get serviceList()', '    // 現在の表示対象ネットワーク'), 'serviceList'));
  return { app, main, start, handlers: methods('\n    epg: {', '    getEpgKey(').epg, flush() {
    let calls = 0;
    while (timers.size) {
      assert.ok(++calls < 100);
      const [key, fn] = timers.entries().next().value; timers.delete(key); fn();
    }
  } };
}
function event(service, start, eid = 10, durationSecond = 3600) {
  return { ...service, eid, startTime: start, durationSecond, shortInfo: { event_name: `event ${eid}` } };
}
function range(app, start, records) {
  const grouped = new Map();
  for (const e of records) {
    const sid = app.getServiceID(e);
    if (!grouped.has(sid)) grouped.set(sid, new Map());
    grouped.get(sid).set(e.eid, e);
  }
  app.epg.extraData.set(app.getEpgKey(start), grouped);
}

test('historical services render even when absent from the core EPG cache', () => {
  const { app, main, start, flush } = setup();
  range(app, start, [event(main, start)]);
  assert.equal(app.serviceList.length, 0);
  app.loadEpg(); flush();
  assert.equal(app.epg.servicesToDisplay.length, 1);
  assert.equal(app.epg.servicesToDisplay[0].displayEvents.find(e => !e.isGap).eid, 10);
});

test('changing the range rebuilds its services instead of retaining the preceding day', () => {
  const { app, main, start, flush } = setup();
  const second = { onid: 4, tsid: 2, sid: 201 }; app.allData.service.set(app.getServiceID(second), second);
  range(app, start, [event(main, start)]); app.loadEpg(); flush();
  const tomorrow = start + 86400000;
  range(app, tomorrow, [event(second, tomorrow)]); app.epg.epgStartTime = tomorrow;
  app.loadEpg(); flush();
  assert.equal(app.epg.servicesToDisplay.length, 1);
  assert.equal(app.epg.servicesToDisplay[0].sid, 201);
});

test('empty ranges render safely and clear the previous columns', () => {
  const { app, main, start, flush } = setup();
  range(app, start, [event(main, start)]); app.loadEpg(); flush();
  range(app, start, []); app.loadEpg(); flush();
  assert.equal(app.epg.servicesToDisplay.length, 0);
});

test('subchannel programs use the selected range and service-scoped event keys', () => {
  const { app, main, start, flush } = setup();
  const sub = { onid: 4, tsid: 1, sid: 102, subCh: true };
  main.subSids = [102, 999]; app.allData.service.set(app.getServiceID(sub), sub);
  range(app, start, [event(main, start), event(sub, start)]);
  app.loadEpg(); flush();
  const programs = app.epg.servicesToDisplay[0].displayEvents.filter(e => !e.isGap);
  assert.equal(programs.length, 2);
  assert.equal(new Set(programs.map(e => app.getEventID(e))).size, 2);
  assert.equal(programs[1].total, 2);
  assert.equal((html.match(/:key="d.isGap \? 'gap-'\+idx : getEventID\(d\)"/g) || []).length, 2);
});

test('one-seg visibility remains respected when rendering additional ranges', () => {
  const { app, main, start, flush } = setup(); main.partialReceptionFlag = true;
  const normal = { ...main, sid: 201, partialReceptionFlag: false };
  app.allData.service.set(app.getServiceID(normal), normal);
  range(app, start, [event(main, start), event(normal, start)]); app.loadEpg(); flush();
  assert.equal(app.epg.servicesToDisplay.length, 1);
  app.sets.oneseg = true; app.loadEpg(); flush();
  assert.equal(app.epg.servicesToDisplay.length, 2);
});

test('same-EID programs on different services do not share selection or hover expansion', () => {
  const { app, main, start, handlers, flush } = setup();
  handlers.set = { hover: false }; handlers.getEventID = app.getEventID.bind(app);
  const a = event(main, start), b = event({ ...main, sid: 102 }, start);
  handlers.onEventClick(a); flush();
  assert.equal(handlers.getEventClass(a)['large-elevate'], true);
  assert.equal(handlers.getEventClass(b)['large-elevate'], false);
  handlers.onEventClick(b); flush();
  assert.equal(handlers.getEventClass(a)['large-elevate'], false);
  assert.equal(handlers.getEventClass(b)['large-elevate'], true);
  handlers.set.hover = true; handlers.onPointerEnter(a);
  assert.equal(handlers.active, app.getEventID(a));
  handlers.onPointerLeave(); assert.equal(handlers.active, null);
  assert.ok(html.includes('active === getEventID(d)'));
});

test('a started program with unknown duration retains its title without inventing an end time', () => {
  const { app, main, start } = setup();
  const unknown = event(main, start); delete unknown.durationSecond;
  app.allData.epg.set(app.getServiceID(main), new Map([[unknown.eid, unknown]]));
  app.syncNowOnAir();
  const result = app.dashboardData.nowOnAir[app.getServiceID(main)];
  assert.equal(result.current.shortInfo.event_name, 'event 10');
  assert.equal(result.current.durationSecond, undefined);
  assert.equal(result.current.isDummy, undefined); assert.equal(result.next, null);
  assert.equal(app.needsNowOnAirSync(), false);
});

test('unknown-duration broadcasts switch at the next scheduled start even without an EPG notification', () => {
  const { app, main, start } = setup();
  const unknown = event(main, start); delete unknown.durationSecond;
  const next = event(main, start + 3600000, 11);
  app.allData.epg.set(app.getServiceID(main), new Map([[10, unknown], [11, next]]));
  app.syncNowOnAir(); assert.equal(app.needsNowOnAirSync(), false);
  app.now = next.startTime; assert.equal(app.needsNowOnAirSync(), true);
  app.syncNowOnAir(); assert.equal(app.dashboardData.nowOnAir[app.getServiceID(main)].current.eid, 11);
});

test('known-duration gaps still produce a placeholder followed by the next program', () => {
  const { app, main, start } = setup();
  app.allData.epg.set(app.getServiceID(main), new Map([[10, event(main, start, 10, 60)], [11, event(main, start + 3600000, 11)]]));
  app.now = start + 120000; app.syncNowOnAir();
  const result = app.dashboardData.nowOnAir[app.getServiceID(main)];
  assert.equal(result.current.isDummy, true); assert.equal(result.next.eid, 11);
  assert.ok(Number.isFinite(result.current.durationSecond));
});

test('on-air network selection chooses an available network and preserves valid choices', () => {
  const { app } = setup();
  app.onairNetwork = null; app.selectableNetworks = [{ index: 3 }];
  app.ensureOnAirNetwork(); assert.equal(app.onairNetwork, 3);
  app.selectableNetworks = [{ index: 1 }, { index: 3 }]; app.ensureOnAirNetwork(); assert.equal(app.onairNetwork, 3);
  app.selectableNetworks = [{ index: 1 }]; app.ensureOnAirNetwork(); assert.equal(app.onairNetwork, 1);
  app.selectableNetworks = []; app.ensureOnAirNetwork(); assert.equal(app.onairNetwork, null);
  app.selectableNetworks = [{ index: 5 }]; app.ensureOnAirNetwork(); assert.equal(app.onairNetwork, 5);
  assert.ok(html.includes('x-effect="ensureOnAirNetwork()"'));
  assert.ok(!html.includes('onairNetwork: 1'));
});
