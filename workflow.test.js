const { test } = require('node:test');
const a = require('node:assert/strict');
const { harness, report, item } = require('./test-harness.cjs');
const Core=require('./core');
const home = 'https://classroom.google.com/u/1/h/st';
const course = { courseId: 'A', name: 'Math', url: 'https://classroom.google.com/u/1/c/A', accountPath: '/u/1/' };
const classwork = `${course.url}/m`;
function routes() {
  const task = item();
  return { [home]: report(home, [], [course]), [course.url]: report(course.url, [], [], { classworkURL: classwork }),
    [classwork]: report(classwork, [task]), [task.url]: report(task.url, [{ ...task, source: 'detail' }]) };
}
test('full scanner follows observed Classwork link, verifies detail, persists coverage and closes its sole inactive tab', async () => {
  const h = harness({ routes: routes() });
  await h.send({ type: 'scan' }); await h.settle();
  a.equal(h.state().scan.status, 'finished'); a.equal(h.state().scan.checked, 1);
  a.equal(h.state().items['school|A|B'].source, 'detail');
  a.equal(h.operations.filter(o => o.kind === 'create').length, 1);
  a.ok(h.operations.filter(o => ['create', 'update'].includes(o.kind)).every(o => o.active === false));
  a.deepEqual(h.operations.filter(o => o.kind === 'collect').map(o => o.url), [home, course.url, classwork, item().url]);
  a.equal(h.tabs.size, 0); a.equal(h.state().scan.tabId, undefined);
});
test('navigation readiness retries stale pages without accepting their records', async () => {
  let stale = 0;
  const h = harness({ routes: routes(), onGet(tab) { if (tab.url === course.url && stale++ < 2) return { ...tab, url: home }; return tab; } });
  await h.api.scanAll();
  a.equal(h.state().scan.checked, 1); a.ok(stale >= 3);
  a.equal(h.operations.filter(o => o.kind === 'collect' && o.url === home).length, 1);
});
test('failed course does not erase existing tasks and other selected courses continue', async () => {
  const second = { ...course, courseId: 'Z', name: 'Science', url: 'https://classroom.google.com/u/1/c/Z' };
  const fixtures = routes(); fixtures[home] = report(home, [], [course, second]); fixtures[second.url] = Error('Permission denied fixture');
  const h = harness({ routes: fixtures }); h.mutate(s => { s.settings.courses.push('Z'); Core.mergeItems(s,[item('OLD','A',{title:'Previously collected'})],h.now()); });
  await h.api.scanAll();
  a.equal(h.state().scan.status, 'partial'); a.equal(h.state().scan.checked, 1); a.equal(h.state().scan.failed.length, 1);
  a.equal(h.state().items['school|A|OLD'].title, 'Previously collected');
});
test('cancellation during discovery stops subsequent course navigation and closes scanner', async () => {
  const fixtures = routes(); fixtures[home] = async (tab, msg, h) => { await h.send({ type: 'cancel' }); return report(home, [], [course]); };
  const h = harness({ routes: fixtures }); await h.api.scanAll();
  a.equal(h.state().scan.status, 'cancelled'); a.equal(h.operations.filter(o => o.kind === 'update').length, 0); a.equal(h.tabs.size, 0);
});
test('different account report is rejected without importing courses or tasks', async () => {
  const h = harness({ routes: { [home]: report('https://classroom.google.com/u/0/h/st', [item()], [course]) } });
  await h.api.scanAll();
  a.equal(h.state().scan.status, 'failed'); a.equal(Object.keys(h.state().items).length, 0); a.equal(Object.keys(h.state().courses).length, 0);
});
test('restart marks interrupted run honestly, preserves records and restores browser alarms', async () => {
  const h = harness(); h.mutate(s => { s.scan = { status: 'running', tabId: 99, stage: 'Checking Math' }; Core.mergeItems(s,[item('OLD','A',{title:'Keep'})],h.now()); });
  await h.startup();
  a.equal(h.state().scan.status, 'interrupted'); a.equal(h.state().items['school|A|OLD'].title, 'Keep');
  a.ok(h.alarms.has('scan')); a.ok(h.alarms.has('reminders'));
});
test('failed details mark both course and run partial', async () => {
  const fixtures = routes(); fixtures[item().url] = Error('Unknown detail layout');
  const h = harness({ routes: fixtures }); await h.api.scanAll();
  a.equal(h.state().courses.A.coverage, 'partial'); a.equal(h.state().scan.status, 'partial');
});
test('detail budget is bounded and retry continues unverified records',async()=>{
  const fixtures=routes(),tasks=Array.from({length:31},(_,i)=>item(`B${i}`));
  fixtures[classwork]=report(classwork,tasks);
  for(const task of tasks)fixtures[task.url]=report(task.url,[{...task,source:'detail'}]);
  const h=harness({routes:fixtures});await h.api.scanAll();
  a.equal(h.state().scan.status,'partial');a.equal(h.state().courses.A.coverage,'partial');
  a.equal(h.operations.filter(o=>o.kind==='collect'&&o.url.endsWith('/details')).length,30);
  await h.api.scanAll('retry');
  a.equal(h.state().scan.status,'finished');
  a.equal(h.operations.filter(o=>o.kind==='collect'&&o.url.endsWith('/details')).length,31);
});
test('pause during navigation stops readiness waits and resume scans remaining selected course',async()=>{
  let paused=false;
  const h=harness({routes:routes(),onNavigate:async(tab,h)=>{if(tab.url===course.url&&!paused){paused=true;await h.send({type:'pause'});}}});
  await h.api.scanAll();a.equal(h.state().scan.status,'paused');a.equal(h.tabs.size,0);
  a.equal(h.operations.filter(o=>o.kind==='collect'&&o.url===course.url).length,0);
  await h.api.scanAll('resume');a.equal(h.state().scan.status,'finished');a.equal(h.state().scan.checked,1);
});
test('account redirect during course navigation imports nothing from the redirected account',async()=>{
  const h=harness({routes:routes(),onGet(tab){return tab.url===course.url?{...tab,url:'https://classroom.google.com/u/0/c/A'}:tab;}});
  await h.api.scanAll();a.equal(h.state().scan.status,'partial');a.equal(Object.keys(h.state().items).length,0);
  a.match(h.state().scan.failed[0].error,/account/);
});
test('concurrent scan requests do not spawn extra tabs', async () => {
  const h = harness({ routes: routes() });
  await Promise.all([h.api.scanAll(), h.api.scanAll()]);
  a.equal(h.operations.filter(o => o.kind === 'create').length, 1);
});
test('Discord rate limit respects retry timing, preserves queue, then acknowledges success', async () => {
  let attempts = 0;
  const h = harness({ fetch: async () => ++attempts === 1 ? { ok: false, status: 429, headers: { get: () => '120' } } : { ok: true } });
  h.mutate(s => { s.settings.webhook = 'https://discord.com/api/webhooks/123/test'; });
  await h.send({ type: 'test-discord' });
  a.equal(h.state().queue[0].nextAt, h.now() + 120000); a.equal(h.state().queue[0].attempts, 1);
  await h.api.deliver(); a.equal(attempts, 1);
  h.advance(120001); await h.api.deliver(); a.equal(attempts, 2); a.equal(h.state().queue.length, 0);
});
test('invalid webhook halts automatic retry and does not expose its secret in logs', async () => {
  const h = harness({ fetch: async () => ({ ok: false, status: 404, headers: { get: () => null } }) });
  h.mutate(s => { s.settings.webhook = 'https://discord.com/api/webhooks/123/SECRET'; });
  await h.send({ type: 'test-discord' });
  a.equal(h.state().queue[0].nextAt, Number.MAX_SAFE_INTEGER); a.ok(!JSON.stringify(h.state().activity).includes('SECRET'));
});
test('reminder windows deduplicate, respect quiet hours, and exclude submitted/stale work', async () => {
  const h = harness();
  h.mutate(s => {
    s.settings.webhook = 'https://discord.com/api/webhooks/123/test';
    for (const [id, status, verified] of [['B', 'assigned', h.now()], ['C', 'submitted', h.now()], ['D', 'assigned', h.now()-25*3600000]]) {
      Core.mergeItems(s,[item(id,'A',{status,source:'detail',dueRaw:'Nov 5, 2026, 6:00 PM'})],h.now());
      s.items[`school|A|${id}`].lastVerifiedAt=verified;
    }
    s.settings.quietStart = 15; s.settings.quietEnd = 17;
  });
  await h.api.reminders(); a.equal(h.requests.length, 0);
  h.mutate(s => { s.settings.quietStart = 0; s.settings.quietEnd = 0; });
  await h.api.reminders(); await h.api.reminders();
  a.equal(h.requests.length, 1); a.ok(JSON.parse(h.requests[0].init.body).content.includes('Task B'));
  a.ok(!JSON.parse(h.requests[0].init.body).content.includes('Task C'));
});
test('pending reminder is discarded if task is submitted before delayed retry', async () => {
  let attempts = 0;
  const h = harness({ fetch: async () => { attempts++; throw Error('Offline'); } });
  h.mutate(s => { s.settings.webhook = 'https://discord.com/api/webhooks/123/test'; Core.mergeItems(s,[item('B','A',{source:'detail',dueRaw:'Nov 5, 2026, 5:00 PM'})],h.now()); });
  await h.api.reminders(); a.equal(attempts, 1);
  h.mutate(s => { s.items['school|A|B'].status = 'submitted'; });
  h.advance(3600000); await h.api.reminders();
  a.equal(attempts, 1); a.equal(h.state().queue.length, 0);
});
test('network retry is bounded and cached UI reads are not blocked by a pending send',async()=>{
  let release;
  const gate=new Promise(resolve=>release=resolve),h=harness({fetch:()=>gate});
  h.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/test';});
  const send=h.send({type:'test-discord'});
  for(let i=0;i<20&&!h.requests.length;i++)await new Promise(setImmediate);
  a.equal(h.requests.length,1);
  const state=await h.send({type:'state'});a.equal(state.queue.length,1);
  release({ok:true});await send;a.equal(h.state().queue.length,0);
  const offline=harness({fetch:async()=>{throw Error('Offline');}});
  offline.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/test';});
  await offline.send({type:'test-discord'});
  for(let i=0;i<10;i++){offline.advance(4*3600000);await offline.api.deliver();}
  a.equal(offline.requests.length,8);a.equal(offline.state().queue[0].nextAt,Number.MAX_SAFE_INTEGER);
});
test('restart preserves a pending digest, daily deduplication and no stale next-day replay',async()=>{
  const h=harness({fetch:async()=>{throw Error('Offline');}});
  h.mutate(s=>{
    s.settings.webhook='https://discord.com/api/webhooks/123/test';s.settings.digestHour=0;
    Core.mergeItems(s,[item('B','A',{source:'detail',dueRaw:'Nov 5, 2026, 5:00 PM'})],h.now());
  });
  await h.api.reminders();const saved=h.state();a.ok(saved.queue.some(j=>j.kind==='digest'));
  const resumed=harness({state:saved,now:h.now()});await resumed.startup();resumed.advance(60001);await resumed.api.reminders();await resumed.api.reminders();
  a.equal(resumed.requests.filter(r=>JSON.parse(r.init.body).content.startsWith('Homework digest')).length,1);
  resumed.advance(86400000);await resumed.api.reminders();
  a.ok(resumed.state().queue.every(q=>q.kind!=='digest'||q.day==='2026-11-6'));
});
test('read-only UI requests never rewrite the task database',async()=>{
  const h=harness();await h.send({type:'state'});await h.send({type:'export'});await h.send({type:'state'});
  a.equal(h.operations.filter(o=>o.kind==='storage-write').length,0);
});
