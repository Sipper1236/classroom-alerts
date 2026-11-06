// Development-only WebExtension harness. No credentials, network, or real browser profile.
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('./core');
const Build = require('./build');

function report(url, items = [], courses = [], extra = {}) {
  return { url, items, courses, handshake:{protocol:Build.protocol,buildId:Build.id,contentVersion:Build.version,coreBuild:Build.id,extractorBuild:Build.id,requestId:'fixture'},
    report: {version:Build.version,accountPath: new URL(url).pathname.match(/^\/u\/\d+\//)?.[0] || '',
    route: /\/details$/.test(url) ? 'detail' : /\/c\//.test(url) ? 'course' : 'home',
    counts: { items: items.length, courses: courses.length }, warning: items.length ? null : 'No supported item links found',
    truncated: false }, ...extra };
}
function item(id = 'B', courseId = 'A', extra = {}) {
  return { itemId: id, courseId, title: `Task ${id}`, type: 'assignment', status: 'assigned', source: 'summary',
    url: `https://classroom.google.com/u/1/c/${courseId}/a/${id}/details`, dueRaw: 'Nov 6, 2026, 10:00 AM', ...extra };
}
function harness(options = {}) {
  let now = options.now || Date.parse('2026-11-05T16:00:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  let state = Object.hasOwn(options,'state') ? structuredClone(options.state) : Core.emptyState();
  const extraStorage={};
  if (!Object.hasOwn(options,'state')) state.settings = { ...state.settings, profile: 'school', accountPath: '/u/1/', timezone: 'UTC',
    courses: ['A'], quietStart: 0, quietEnd: 0, digestHour: 23, notificationGapMinutes:0, webhook: '' };
  const routes = options.routes || {};
  const operations = [], requests = [], alarms = new Map(), tabs = new Map();
  let listener, startup, installed, alarm, nextId = 100;
  const browser = {
    runtime: { id: 'test', getURL: p => `moz-extension://test/${p}`, getManifest: () => ({ version: options.manifestVersion || Build.version }),
      onMessage: { addListener: fn => listener = fn }, onStartup: { addListener: fn => startup = fn }, onInstalled: { addListener: fn => installed = fn } },
    alarms: { clearAll: async () => alarms.clear(), create: (name, value) => alarms.set(name, value), onAlarm: { addListener: fn => alarm = fn } },
    storage: { local: { get: async () => ({ ...structuredClone(extraStorage),state: structuredClone(state) }), set: async value => { operations.push({kind:'storage-write'});await options.onSet?.(value);if(Object.hasOwn(value,'state'))state = structuredClone(value.state);for(const [key,v]of Object.entries(value))if(key!=='state')extraStorage[key]=structuredClone(v); }, remove:async key=>delete extraStorage[key] } },
    tabs: {
      create: async value => { const tab = { id: nextId++, status: 'complete', ...value }; tabs.set(tab.id, tab); operations.push({ kind: 'create', ...value, id: tab.id }); return { ...tab }; },
      update: async (id, value) => { const tab = tabs.get(id); if (!tab) throw Error('Tab closed'); Object.assign(tab, value); operations.push({ kind: 'update', id, ...value }); await options.onNavigate?.(tab, h); return { ...tab }; },
      get: async id => { const tab = tabs.get(id); if (!tab) throw Error('Tab closed'); return options.onGet ? options.onGet({ ...tab }, h) : { ...tab }; },
      query: async () => [...tabs.values()].map(t => ({ ...t })),
      remove: async id => { tabs.delete(id); operations.push({ kind: 'remove', id }); },
      sendMessage: async (id, message) => {
        const tab = tabs.get(id); if (!tab) throw Error('Tab closed');
        operations.push({ kind: 'collect', id, url: tab.url, message });
        const value = routes[tab.url];
        if (typeof value === 'function') return stamp(structuredClone(await value(tab, message, h)),message);
        if (value instanceof Error) throw value;
        if (!value) throw Error('Unsupported fixture page');
        return stamp(structuredClone(value),message);
      }
    }
  };
  const context = vm.createContext({ console, URL, Date: Clock, Intl, AbortSignal, structuredClone,TextEncoder,
    setTimeout: fn => { queueMicrotask(fn); return 1; }, browser,
    fetch: async (url, init) => { requests.push({ url, init }); return options.fetch ? options.fetch(url, init, h) : { ok: true }; } });
  function stamp(result,message){if(result?.handshake?.requestId==='fixture')result.handshake.requestId=message.requestId;return result;}
  for (const file of ['build.js','core.js', 'notifications.js', 'state.js', 'background.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
  vm.runInContext('globalThis.testAPI = { scanAll, readTab, reminders, deliver, startup, ingest: result => transaction(state => ingest(state,result)), flush: () => chain, isScanning: () => scanning };', context);
  const h = { api: context.testAPI, browser, routes, operations, requests, alarms, tabs,
    send: (message, sender = { id: 'test', url: 'moz-extension://test/dashboard.html' }) => listener(message, sender),
    startup: () => startup(), installed: () => installed(), alarm: name => alarm({ name }),
    state: () => structuredClone(state), mutate: fn => fn(state), advance: ms => now += ms,
    now: () => now, async settle() { for (let i = 0; i < 500; i++) { await new Promise(setImmediate); if (!context.testAPI.isScanning()) { await context.testAPI.flush(); return; } } throw Error('Scan did not settle'); } };
  return h;
}
module.exports = { harness, report, item };
