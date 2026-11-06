// Runs the real dashboard scripts in Chromium against the real background coordinator,
// with WebExtension APIs bridged to local mocks. No network or school login.
const { test } = require('node:test');
const a = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const { harness, item,report } = require('./test-harness.cjs');
const Core=require('./core');

async function openUI(h, name = 'dashboard.html') {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/home/rayyan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('extensionMessage', message => h.send(message));
  await page.exposeFunction('extensionQuery', query => h.browser.tabs.query(query));
  await page.addInitScript(() => {
    globalThis.browser = { runtime: { sendMessage: message => globalThis.extensionMessage(message), getManifest: () => ({ version: 'test' }), openOptionsPage: async () => {} },
      tabs: { query: query => globalThis.extensionQuery(query) } };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => globalThis.copiedReport = value } });
  });
  await page.goto(pathToFileURL(path.join(__dirname, name)).href);
  await page.waitForFunction(() => !document.body.textContent.includes('Loading cached tasks'));
  if (name === 'dashboard.html') await page.waitForFunction(() => document.querySelector('#version').textContent === 'vtest');
  else await page.waitForFunction(() => document.querySelector('#delivery').textContent.length > 0);
  return { page, errors, close: () => browser.close() };
}
function withTask(count = 1) {
  const h = harness();
  h.mutate(s => {
    s.courses.A = { courseId:'A', name:'Math', url:'https://classroom.google.com/u/1/c/A' };
    for(let i=0;i<count;i++) {
      const t=item(String(i), 'A', { title: i === 0 ? '<img src=x onerror=alert(1)> Homework' : `Homework ${i}`, courseName:'Math',dueRaw:'Nov 5, 2026, 5:00 PM' });
      Core.mergeItems(s,[t],h.now());
    }
  }); return h;
}
test('labels, keyboard focus, theme/text zoom reflow and reduced-motion presentation work in dashboard and popup',async()=>{
  for(const name of ['dashboard.html','popup.html']){
    const h=withTask(),ui=await openUI(h,name);try{
      const {page}=ui;await page.setViewportSize({width:320,height:800});await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
      const light=await page.locator('section').first().evaluate(el=>getComputedStyle(el).backgroundColor);
      await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});const dark=await page.locator('section').first().evaluate(el=>getComputedStyle(el).backgroundColor);a.notEqual(light,dark);
      await page.evaluate(()=>document.documentElement.style.fontSize='30px');
      a.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,`${name}: 320px and 200% text zoom`);
      a.deepEqual(await page.locator('input,select,textarea').evaluateAll(elements=>elements.filter(el=>!el.labels?.length).map(el=>el.id)),[]);
      a.equal(await page.locator('#status').getAttribute('aria-live'),'polite');
      const target=name==='dashboard.html'?page.locator('.task summary').filter({hasText:'Local planning controls'}):page.locator('#dashboard');
      await target.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');a.equal(await target.evaluate(el=>el===document.activeElement),true);
      a.equal(await target.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
      if(name==='dashboard.html'){await page.keyboard.press('Enter');a.equal(await target.evaluate(el=>el.parentElement.open),true);}
      a.equal(await target.evaluate(el=>getComputedStyle(el).animationName),'none');a.deepEqual(ui.errors,[]);
    }finally{await ui.close();}
  }
});
test('clipboard denial exposes only the selectable redacted summary and reveal applies only to an entered replacement',async()=>{
  const h=withTask();h.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/SAVED_SECRET';s.settings.verbose=true;s.settings.verboseUntil=h.now()+3600000;s.report={route:'course',counts:{items:1},pageTitle:'PRIVATE TITLE',bodyTextSample:'PRIVATE BODY'};});
  const ui=await openUI(h);try{
    const {page}=ui;await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('Denied');};});
    await page.getByRole('button',{name:'Copy diagnostic summary',exact:true}).click();
    a.equal(await page.locator('#copy-text').evaluate(el=>el===document.activeElement&&el.selectionEnd===el.value.length),true);
    const text=await page.locator('#copy-text').inputValue();a.ok(text.includes('counts'));a.ok(!text.includes('PRIVATE'));a.ok(!text.includes('SAVED_SECRET'));a.match(await page.locator('#status').textContent(),/Clipboard denied/);
    await page.getByRole('button',{name:'Show entered webhook',exact:true}).click();a.equal(await page.locator('#webhook').inputValue(),'');a.equal(await page.locator('#webhook').getAttribute('type'),'text');
    await page.locator('#webhook').fill('https://discord.com/api/webhooks/123/REPLACEMENT');await page.getByRole('button',{name:'Hide entered webhook',exact:true}).click();a.equal(await page.locator('#webhook').getAttribute('type'),'password');
    a.ok(h.state().settings.webhook.endsWith('SAVED_SECRET'));a.equal(h.requests.length,0);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('popup distinguishes empty, running, unsupported, failed/sign-in and Discord states without a no-homework claim',async()=>{
  const h=harness(),ui=await openUI(h,'popup.html');try{
    const {page}=ui;a.match(await page.locator('#next').textContent(),/No data collected yet/);a.match(await page.locator('#delivery').textContent(),/Discord not configured/);
    for(const [status,stage,failed,expected]of [['running','Checking course',[],/Scan in progress/],['failed','Sign in to Classroom normally',[],/Sign in to Classroom/],['partial','Idle',[{courseId:'A',error:'Unsupported layout'}],/Some courses failed/]]){
      h.mutate(s=>{s.scan={status,stage,checked:0,total:1,failed};});await page.reload();await page.waitForFunction(()=>!document.querySelector('#freshness').textContent.includes('Loading cached tasks'));a.match(await page.locator('#next').textContent(),expected);
    }
    h.mutate(s=>{s.scan=null;s.report={route:'course',counts:{items:0},warning:'Unsupported layout'};s.deliveryError='Network unavailable';});await page.reload();await page.waitForFunction(()=>document.querySelector('#delivery').textContent.includes('failed'));
    a.match(await page.locator('#next').textContent(),/No recognized tasks on this page layout/);a.match(await page.locator('#delivery').textContent(),/Discord delivery failed/);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('popup storage/API failure replaces loading copy and keeps scan actions disabled',async()=>{
  const h=harness();h.send=async()=>{throw Error('Local storage unavailable');};const ui=await openUI(h,'popup.html');try{
    a.match(await ui.page.locator('#freshness').textContent(),/Cached data unavailable/);a.match(await ui.page.locator('#status').textContent(),/Local storage unavailable/);
    for(const id of ['scan','course','page'])a.equal(await ui.page.locator(`#${id}`).isDisabled(),true);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('Discord preview exposes the bounded catch-up locally and explains a global rate-limit delay',async()=>{
  const h=withTask(2);h.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/SECRET';s.settings.digestHour=0;s.settings.quietStart=15;s.settings.quietEnd=23;for(const task of Object.values(s.items)){task.source='detail';task.lastVerifiedAt=h.now();}});
  await h.api.reminders();h.advance(1800000);await h.api.reminders();h.mutate(s=>{s.deliveryNotBefore=h.now()+3600000;});
  const ui=await openUI(h);try{
    await ui.page.clock.setFixedTime(new Date(h.now()));await ui.page.getByRole('button',{name:'Refresh view',exact:true}).click();await ui.page.getByRole('button',{name:'Preview Discord messages locally',exact:true}).click();
    await ui.page.waitForFunction(()=>document.querySelector('#preview-text').textContent.includes('QUEUED catchup'));a.match(await ui.page.locator('#preview-text').textContent(),/Homework catch-up/);a.match(await ui.page.locator('#delivery').textContent(),/Discord rate limit: no requests before/);a.equal(h.requests.length,0);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('provisional inventory renders safe unverified text, course-only links and bounded pages without task controls',async()=>{
  const h=harness(),scope='https://classroom.google.com/u/1/c/A/m';await h.api.ingest(report(scope,[],[],{provisional:Array.from({length:30},(_,i)=>({courseId:'A',scopeURL:scope,title:i?'Same title':'<img src=x onerror=alert(1)>',dueRaw:'Monday'}))}));
  const ui=await openUI(h);try{
    const {page}=ui;a.equal(await page.locator('#provisional-items article').count(),25);a.equal(await page.locator('#provisional-items img').count(),0);a.equal(await page.locator('#provisional-items input,#provisional-items button').count(),0);
    a.match(await page.locator('#provisional-items').textContent(),/unverified, no stable item link/);a.equal(await page.locator('#provisional-items a').first().getAttribute('href'),scope);a.equal(await page.locator('.task').count(),0);
    await page.getByRole('button',{name:'Next provisional summaries',exact:true}).click();a.equal(await page.locator('#provisional-items article').count(),5);
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Clear provisional snapshots',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#provisional-count').textContent.includes('of 0'));
    a.equal(h.state().provisional.length,0);a.equal(h.requests.length,0);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('Discord preview renders literal message text locally without school-data transmission',async()=>{
  const h=withTask(),ui=await openUI(h);try{
    await ui.page.getByRole('button',{name:'Preview Discord messages locally'}).click();
    await ui.page.waitForFunction(()=>document.querySelector('#preview-text').textContent.includes('DIGEST SAMPLE'));
    a.match(await ui.page.locator('#preview-text').textContent(),/Homework digest/);a.equal(await ui.page.locator('#preview-text img').count(),0);
    a.equal(h.requests.length,0);a.equal(h.state().queue.length,0);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('unseen-record warning remains in the work queue, shows its checked scope, and clears on re-observation',async()=>{
  const h=withTask();h.mutate(s=>{s.items['school|A|0'].notSeenAt=h.now();s.items['school|A|0'].notSeenIn='https://classroom.google.com/u/1/c/A/m';});
  const ui=await openUI(h);try{
    a.equal(await ui.page.locator('.task').count(),1);a.match(await ui.page.locator('#tasks').textContent(),/absence does not prove removal or completion/);
    a.equal(await ui.page.getByRole('link',{name:'Open checked scope'}).getAttribute('href'),'https://classroom.google.com/u/1/c/A/m');
    const value=item('0','A');await h.api.ingest(report(value.url,[value]));await ui.page.getByRole('button',{name:'Refresh view',exact:true}).click();
    await ui.page.waitForFunction(()=>!document.querySelector('#tasks').textContent.includes('absence does not prove'));
    a.equal(await ui.page.locator('.task').count(),1);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('local planning supports today pins, chosen-time snooze, clear snooze and composable task filters',async()=>{
  const h=harness();h.mutate(s=>{s.settings.courses=['A','Z'];s.courses.A={courseId:'A',name:'Math',url:'https://classroom.google.com/u/1/c/A'};s.courses.Z={courseId:'Z',name:'Science',url:'https://classroom.google.com/u/1/c/Z'};});
  const tasks=[item('PAST','A',{title:'Past task',status:'missing',source:'detail',dueRaw:'Nov 4, 2026, 10:00 AM'}),item('FUTURE','Z',{title:'Future task',source:'detail'}),item('NONE','A',{title:'No-date task',source:'detail',dueRaw:'No due date'}),item('REVIEW','Z',{title:'Review task',dueRaw:'Monday'})];
  await h.api.ingest(report(tasks[0].url,tasks));const ui=await openUI(h);try{
    const {page}=ui;await page.clock.setFixedTime(new Date(h.now()));await page.getByRole('button',{name:'Refresh view',exact:true}).click();
    await page.locator('#task-course').selectOption('A');a.equal(await page.locator('.task').count(),2);
    await page.locator('#task-deadline').selectOption('no-date');a.equal(await page.locator('.task').count(),1);a.match(await page.locator('#tasks').textContent(),/No-date task/);
    await page.locator('.task summary').filter({hasText:'Local planning controls'}).click();await page.getByLabel("Pin for today's plan (school timezone)",{exact:true}).check();
    await page.getByRole('button',{name:'Save local edits',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Local edits saved'));
    a.equal(h.state().items['school|A|NONE'].local.pinnedDay,'2026-11-05');
    await page.locator('#task-course').selectOption('');await page.locator('#task-deadline').selectOption('all');await page.locator('#today-only').check();a.equal(await page.locator('.task').count(),1);
    await page.locator('.task summary').filter({hasText:'Local planning controls'}).click();
    await page.getByRole('button',{name:'Snooze until chosen time',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Choose a future snooze time'));
    a.equal(h.state().items['school|A|NONE'].local.snoozeUntil,0);
    const chosenAt=h.now()+2*3600000,localTime=await page.evaluate(at=>{const d=new Date(at);return new Date(at-d.getTimezoneOffset()*60000).toISOString().slice(0,16);},chosenAt);
    await page.getByLabel('Snooze until (device timezone; up to 30 days)',{exact:true}).fill(localTime);
    await page.getByRole('button',{name:'Snooze until chosen time',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('chosen time'));
    a.equal(h.state().items['school|A|NONE'].local.snoozeUntil,chosenAt);
    await page.getByRole('button',{name:'Clear snooze',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Snooze cleared'));
    a.equal(h.state().items['school|A|NONE'].local.snoozeUntil,0);
    await page.locator('#today-only').uncheck();await page.locator('#task-deadline').selectOption('overdue');a.equal(await page.locator('.task').count(),1);a.match(await page.locator('#tasks').textContent(),/Past task/);
    await page.locator('#task-deadline').selectOption('missing');a.equal(await page.locator('.task').count(),1);a.match(await page.locator('#tasks').textContent(),/Classroom: missing/);
    await page.locator('#task-deadline').selectOption('upcoming');a.equal(await page.locator('.task').count(),1);a.match(await page.locator('#tasks').textContent(),/Future task/);
    await page.locator('#task-deadline').selectOption('uncertain');a.equal(await page.locator('.task').count(),1);a.match(await page.locator('#tasks').textContent(),/Review task/);
    await page.locator('#task-deadline').selectOption('all');await page.locator('#task-review').selectOption('review');a.equal(await page.locator('.task').count(),1);
    await page.locator('#task-review').selectOption('verified');a.equal(await page.locator('.task').count(),3);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('dashboard renders safely, filters tasks, saves local edits and can restore locally complete tasks', async () => {
  const h = withTask(2), ui = await openUI(h);
  try {
    const {page}=ui;
    a.equal(await page.locator('.task').count(),2);a.equal(await page.locator('#tasks img').count(),0);
    await page.locator('#filter').fill('Homework 1');a.equal(await page.locator('.task').count(),1);
    await page.locator('.task summary').filter({hasText:'Local planning controls'}).click();
    await page.locator('.task select').selectOption('in-progress');
    await page.locator('.task textarea').fill('Do the first five questions');
    await page.locator('.task input[type=number]').fill('20');
    await page.getByRole('button',{name:'Save local edits',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Local edits saved'));
    a.equal(h.state().items['school|A|1'].local.note,'Do the first five questions');a.equal(h.state().items['school|A|1'].local.minutes,20);
    a.equal(await page.getByRole('button',{name:'Save local edits',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.locator('.task select').selectOption('complete');await page.getByRole('button',{name:'Save local edits',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.task').length===0);
    await page.locator('#show-completed').check();a.equal(await page.locator('.task').count(),1);
    await page.locator('.task summary').filter({hasText:'Local planning controls'}).click();await page.locator('.task select').selectOption('not-started');await page.getByRole('button',{name:'Save local edits',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.task select').value==='not-started');
    a.equal(h.state().items['school|A|1'].local.status,'not-started');a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('settings preserve saved webhook without displaying secret and allow disabling delivery',async()=>{
  const h=withTask();h.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/SECRET';s.queue=[{id:'old',content:'old task'}];});
  const ui=await openUI(h);
  try{
    const {page}=ui;
    a.equal(await page.locator('#webhook').inputValue(),'');a.ok(!(await page.content()).includes('SECRET'));
    await page.getByRole('button',{name:'Save settings and course selection'}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Settings saved'));
    a.equal(h.state().settings.webhook,'https://discord.com/api/webhooks/123/SECRET');
    await page.locator('#discord-enabled').uncheck();
    await page.getByRole('button',{name:'Save settings and course selection'}).click();
    await page.waitForFunction(()=>document.querySelector('#delivery').textContent.includes('Discord disabled'));
    a.equal(h.state().settings.webhook,'');a.equal(h.state().queue.length,0);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('diagnostic copy excludes raw titles/account routing and partial scan remains visible',async()=>{
  const h=withTask();h.mutate(s=>{
    s.report={route:'home',counts:{items:1},bodyTextSample:'PRIVATE SCHOOL TEXT',accountPath:'/u/1/'};
    s.scan={status:'partial',stage:'Idle',checked:1,total:2,failed:[{courseId:'Z',error:'Denied'}]};
  });
  const ui=await openUI(h);
  try{
    a.ok((await ui.page.locator('#coverage').textContent()).includes('partial'));
    await ui.page.locator('#copy').click();
    const report=await ui.page.evaluate(()=>globalThis.copiedReport);
    a.ok(report.includes('counts'));a.ok(!report.includes('PRIVATE'));a.ok(!report.includes('/u/1/'));
    a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('cached popup renders 200 task dataset without storage writes or background timers',async t=>{
  const h=withTask(200),before=h.operations.filter(o=>o.kind==='storage-write').length,ui=await openUI(h,'popup.html');
  try{
    const metrics=await ui.page.evaluate(()=>({heapBytes:performance.memory?.usedJSHeapSize,domNodes:document.querySelectorAll('*').length,loadMs:performance.now()}));
    a.ok(metrics.domNodes<100);a.equal(h.operations.filter(o=>o.kind==='storage-write').length,before);
    a.equal(h.alarms.size,0);a.deepEqual(ui.errors,[]);
    t.diagnostic(`Chromium fixture popup: ${metrics.domNodes} DOM nodes; ${Math.round(metrics.loadMs)} ms after navigation; JS heap ${metrics.heapBytes} bytes. Not a native Zen resource measurement.`);
  }finally{await ui.close();}
});
test('dashboard bounds rendered task forms and pagination stays keyboard accessible',async()=>{
  const h=withTask(200),ui=await openUI(h);
  try{
    a.equal(await ui.page.locator('.task').count(),25);
    a.match(await ui.page.locator('#page-count').textContent(),/1–25 of 200/);
    await ui.page.locator('#page-next').focus();await ui.page.keyboard.press('Enter');
    a.match(await ui.page.locator('#page-count').textContent(),/26–50 of 200/);
    await ui.page.locator('#filter').fill('Homework 199');
    a.equal(await ui.page.locator('.task').count(),1);a.match(await ui.page.locator('#page-count').textContent(),/1–1 of 1/);
    a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('notification controls save validated windows and switches and report invalid input',async()=>{
  const h=withTask(),ui=await openUI(h);
  try{
    const {page}=ui;
    await page.locator('#reminder-hours').fill('1, 24, 1, 0.5');await page.locator('#notification-gap').fill('10');
    await page.locator('#notifyNew').uncheck();await page.locator('#digestEnabled').uncheck();
    await page.getByRole('button',{name:'Save settings and course selection'}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Settings saved'));
    a.deepEqual(h.state().settings.reminderHours,[24,1,0.5]);a.equal(h.state().settings.notificationGapMinutes,10);
    a.equal(h.state().settings.notifyNew,false);a.equal(h.state().settings.digestEnabled,false);
    a.equal(await page.locator('#reminder-hours').inputValue(),'24, 1, 0.5');
    await page.locator('#reminder-hours').fill('nonsense');await page.getByRole('button',{name:'Save settings and course selection'}).click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('reminder windows'));
    a.deepEqual(h.state().settings.reminderHours,[24,1,0.5]);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('import UI previews conflicts and preserves local notes on confirmed snapshot replacement',async()=>{
  const h=withTask();h.mutate(s=>{s.items['school|A|0'].local.note='My note';});
  const data=await h.send({type:'export'});data.items['school|A|0'].title='Imported task title';data.items['school|A|0'].local.note='Other note';
  const ui=await openUI(h);
  try{
    const {page}=ui;page.on('dialog',dialog=>dialog.accept());
    await page.locator('#import-file').setInputFiles({name:'tasks.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
    await page.locator('#import-policy').selectOption('replace');await page.locator('#import-preview').click();
    await page.waitForFunction(()=>document.querySelector('#import-status').textContent.includes('1 conflicts'));
    a.equal(h.state().items['school|A|0'].local.note,'My note');
    await page.locator('#import-apply').click();await page.waitForFunction(()=>document.querySelector('#import-status').textContent.includes('Import applied'));
    a.equal(h.state().items['school|A|0'].title,'Imported task title');a.equal(h.state().items['school|A|0'].local.note,'My note');a.equal(h.state().items['school|A|0'].imported,true);
    a.equal(h.requests.length,0);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('recovery UI exposes blocked state and requires an explicit recovery action',async()=>{
  const h=withTask();h.mutate(s=>{s.items.invalid={title:'Broken'};});
  const before=h.state(),ui=await openUI(h);
  try{
    const {page}=ui;a.equal(await page.locator('#recovery').isVisible(),true);a.equal(await page.locator('#scan').isDisabled(),true);
    a.deepEqual(h.state(),before);page.on('dialog',dialog=>dialog.accept());
    await page.locator('#recover').click();await page.waitForFunction(()=>document.querySelector('#recovery').hidden);
    a.equal(h.state().items['school|A|0'].imported,true);a.equal(h.state().settings.webhook,'');a.equal(h.state().queue.length,0);a.equal(h.requests.length,0);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('retention UI saves a keep-all policy and previews cleanup before confirmation',async()=>{
  const h=withTask(),ui=await openUI(h);
  try{
    const {page}=ui;await page.locator('#completed-retention').fill('0');await page.locator('#diagnostic-retention').fill('12');await page.locator('#history-retention').fill('7');
    await page.getByRole('button',{name:'Save retention policy',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Retention policy saved'));
    a.equal(h.state().settings.completedRetentionDays,0);a.equal(h.state().settings.historyRetentionDays,7);
    await page.locator('#cleanup-preview').click();await page.waitForFunction(()=>document.querySelector('#cleanup-status').textContent.includes('Would delete 0 completed tasks'));
    a.ok(h.state().items['school|A|0']);a.equal(await page.locator('#cleanup-apply').isEnabled(),true);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('stale-script failure immediately shows reload guidance in dashboard and popup, and a good recheck clears it',async()=>{
  const home='https://classroom.google.com/u/1/h/st',h=withTask(),stale=report(home);delete stale.handshake;
  h.routes[home]=stale;await h.browser.tabs.create({url:home,active:true});
  const ui=await openUI(h);
  try{
    await ui.page.locator('#page').click();await ui.page.waitForFunction(()=>!document.querySelector('#script-versions').hidden);
    a.match(await ui.page.locator('#status').textContent(),/Reload the affected Classroom tab/);
    a.match(await ui.page.locator('#version-tabs').textContent(),/loaded unknown/);
    await ui.page.getByRole('button',{name:'Show affected tab',exact:true}).click();
    a.ok(h.operations.some(o=>o.kind==='update'&&o.active===true&&o.url===undefined));
    const popup=await openUI(h,'popup.html');
    try{a.equal(await popup.page.locator('#version-warning').isVisible(),true);a.match(await popup.page.locator('#version-warning').textContent(),/Reload affected Classroom tabs/);a.deepEqual(popup.errors,[]);}finally{await popup.close();}
    h.routes[home]=report(home,[item('FRESH')]);await ui.page.locator('#page').click();
    await ui.page.waitForFunction(()=>document.querySelector('#script-versions').hidden);a.equal(h.state().versionAlerts.length,0);a.ok(h.state().items['school|A|FRESH']);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('mixed background installation exposes extension-reload instructions and disables automatic actions',async()=>{
  const h=withTask();h.browser.runtime.getManifest=()=>({version:'99.0.0'});
  const ui=await openUI(h);
  try{
    a.equal(await ui.page.locator('#script-versions').isVisible(),true);a.match(await ui.page.locator('#build-status').textContent(),/about:debugging/);
    a.equal(await ui.page.locator('#scan').isDisabled(),true);a.equal(await ui.page.locator('#test-discord').isDisabled(),true);a.equal(h.requests.length,0);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
test('academic views show local body/resource/grade snapshots with provenance and respect opt-out',async()=>{
  const h=withTask();await h.send({type:'settings',value:{...h.state().settings,announcements:true,materials:true,grades:true}});
  const post=item('POST','A',{title:'Notice',type:'announcement',url:'https://classroom.google.com/u/1/c/A/p/POST',instructions:'<b>Library visit</b>'});
  const slides=item('SLIDES','A',{title:'Chapter slides',type:'material',url:'https://classroom.google.com/u/1/c/A/m/SLIDES/details',instructions:'Read first'});
  const graded=item('GRADE','A',{title:'Marked practice',source:'detail',grade:'9 / 10 points',materials:[{title:'Worksheet',url:'https://drive.google.com/file/d/example/view'}]});
  await h.api.ingest(report('https://classroom.google.com/u/1/h/st',[post,slides,graded]));const ui=await openUI(h);
  try{
    a.equal(await ui.page.locator('.academic-card').count(),1);a.match(await ui.page.locator('#academic-items').textContent(),/summary/);
    await ui.page.locator('.academic-card summary').click();a.match(await ui.page.locator('#academic-items').textContent(),/<b>Library visit<\/b>/);a.equal(await ui.page.locator('.academic-card b').count(),0);
    await ui.page.locator('#academic-type').selectOption('material');a.match(await ui.page.locator('#academic-items').textContent(),/Chapter slides/);
    await ui.page.locator('#academic-type').selectOption('grade');a.match(await ui.page.locator('#academic-items').textContent(),/9 \/ 10 points/);a.match(await ui.page.locator('#academic-items').textContent(),/not a course average/);
    await ui.page.locator('#grades').uncheck();await ui.page.getByRole('button',{name:'Save settings and course selection'}).click();
    await ui.page.waitForFunction(()=>document.querySelector('#academic-items').textContent.includes('Collection is disabled'));a.equal(h.state().items['school|A|GRADE'].gradeHistory,undefined);a.deepEqual(ui.errors,[]);
  }finally{await ui.close();}
});
