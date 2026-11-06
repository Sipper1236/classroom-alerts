const {test}=require('node:test');
const a=require('node:assert/strict');
const {harness,report,item}=require('./test-harness.cjs');
const home='https://classroom.google.com/u/1/h/st';
const course={courseId:'A',name:'Math',url:'https://classroom.google.com/u/1/c/A',accountPath:'/u/1/'};
function enabled(options={}){
  const h=harness(options);h.mutate(s=>{
    s.settings.webhook='https://discord.com/api/webhooks/123/SECRET';
    s.settings.digestEnabled=false;s.settings.remindersEnabled=false;
    s.courses.A={...course,notificationsReadyAt:h.now()-1000};
  });return h;
}
async function save(h,change){return h.send({type:'settings',value:{...h.state().settings,...change}});}
async function ingest(h,value){return h.api.ingest(report(value.url,[value]));}
function detail(id='B',dueRaw='Nov 6, 2026, 10:00 AM'){return item(id,'A',{source:'detail',dueRaw,courseName:'Math'});}

test('reminder configuration is normalized, bounded and rejects invalid values atomically',async()=>{
  const h=enabled();
  await save(h,{reminderHours:[1,24,1,0.5],notificationGapMinutes:5,remindersEnabled:true});
  a.deepEqual(h.state().settings.reminderHours,[24,1,0.5]);
  for(const value of [[0],[-1],[NaN],['24'],Array(9).fill(1),[721]]){
    await a.rejects(save(h,{reminderHours:value}),/reminder windows/);
    a.deepEqual(h.state().settings.reminderHours,[24,1,0.5]);
  }
  await a.rejects(save(h,{notifyNew:'yes'}),/notifyNew/);
  await a.rejects(save(h,{notificationGapMinutes:-1}),/spacing/);
});
test('settings changes invalidate pending windows without replaying delivered ones',async()=>{
  const h=enabled();await save(h,{notifyNew:false,remindersEnabled:true,reminderHours:[24,3]});
  await ingest(h,detail()); // 18 hours away, so the 24-hour window is eligible.
  h.mutate(s=>{s.settings.quietStart=15;s.settings.quietEnd=17;});
  await h.api.reminders();a.equal(h.state().queue[0].windowHours,24);a.equal(h.requests.length,0);
  await save(h,{reminderHours:[3]});a.equal(h.state().queue.length,0);
  await save(h,{reminderHours:[24],quietStart:0,quietEnd:0});
  await h.api.reminders();a.equal(h.requests.length,1);
  await save(h,{remindersEnabled:false});await save(h,{remindersEnabled:true});
  await h.api.reminders();a.equal(h.requests.length,1);
});
test('initial course synchronization establishes a baseline without new-assignment flood',async()=>{
  const t=detail();const h=enabled({routes:{[home]:report(home,[],[course]),[course.url]:report(course.url,[{...t,source:'summary'}]),[t.url]:report(t.url,[t])}});
  h.mutate(s=>{delete s.courses.A.notificationsReadyAt;});
  await h.api.scanAll();a.equal(h.state().scan.status,'finished');a.equal(h.requests.length,0);a.equal(h.state().queue.length,0);
  a.ok(h.state().courses.A.notificationsReadyAt);
  await ingest(h,detail('C'));await h.api.deliver();
  a.equal(h.requests.length,1);a.match(JSON.parse(h.requests[0].init.body).content,/New assignment discovered/);
});
test('new assignment alert uses latest detail evidence, deduplicates rescans, and survives restart',async()=>{
  const h=enabled();await ingest(h,{...detail(),source:'summary',dueRaw:''});
  a.equal(h.state().queue.length,1);a.equal(h.state().queue[0].kind,'new');a.equal(h.state().queue[0].content,undefined);
  await ingest(h,{...detail(),title:'Latest title'});a.equal(h.state().queue.length,1);
  const resumed=harness({state:h.state(),now:h.now()});await resumed.startup();await resumed.api.deliver();
  a.equal(resumed.requests.length,1);a.match(JSON.parse(resumed.requests[0].init.body).content,/Latest title/);
  await ingest(resumed,{...detail(),title:'Latest title'});await resumed.api.deliver();
  a.equal(resumed.requests.length,1);
});
test('deadline changes require distinct normalized detail evidence and invalidate superseded events',async()=>{
  const h=enabled();await save(h,{notifyNew:false});
  await ingest(h,detail());
  await ingest(h,detail('B','Fri, Nov 6, 2026, 10:00 AM'));a.equal(h.state().queue.length,0);
  await ingest(h,{...detail('B','Nov 7, 2026, 10:00 AM'),source:'summary'});a.equal(h.state().queue.length,0);
  await ingest(h,detail('B','Nov 7, 2026, 10:00 AM'));a.equal(h.state().queue.length,1);
  a.equal(h.state().queue[0].deadlineRevision,1);
  await ingest(h,detail('B','Nov 8, 2026, 10:00 AM'));a.equal(h.state().queue.length,1);
  a.equal(h.state().queue[0].deadlineRevision,2);
  await ingest(h,{...detail('B','Nov 8, 2026, 10:00 AM'),title:'Renamed task'});
  a.equal(h.state().queue.length,1);
  await h.api.deliver();a.equal(h.requests.length,1);
  const content=JSON.parse(h.requests[0].init.body).content;a.match(content,/Deadline changed/);a.match(content,/Renamed task/);a.match(content,/Nov 8/);
  await ingest(h,detail('B','Nov 6, 2026, 10:00 AM'));await h.api.deliver();a.equal(h.requests.length,2); // Moving back is a new revision, not a forever-suppressed signature.
});
test('disabling event types drops pending alerts and re-enabling does not replay history',async()=>{
  const h=enabled();await ingest(h,detail());a.equal(h.state().queue.length,1);
  await save(h,{notifyNew:false});a.equal(h.state().queue.length,0);
  await save(h,{notifyNew:true});await ingest(h,detail());await h.api.deliver();a.equal(h.requests.length,0);
  await ingest(h,detail('B','Nov 8, 2026, 10:00 AM'));a.equal(h.state().queue.length,1);
  await save(h,{notifyDeadline:false});a.equal(h.state().queue.length,0);
  await save(h,{notifyDeadline:true});await ingest(h,detail('B','Nov 8, 2026, 10:00 AM'));await h.api.deliver();a.equal(h.requests.length,0);
});
test('stale new events are invalidated by submission, snooze, course deselection and expiry',async()=>{
  for(const change of ['submitted','snoozed','deselected','expired']){
    const h=enabled();await ingest(h,detail());
    if(change==='submitted')await ingest(h,{...detail(),status:'submitted'});
    if(change==='snoozed')await h.send({type:'local',key:'school|A|B',value:{status:'not-started',note:'',minutes:null,snoozeUntil:h.now()+3600000}});
    if(change==='deselected')await save(h,{courses:[]});
    if(change==='expired')h.advance(49*3600000);
    await h.api.deliver();a.equal(h.requests.length,0,change);a.equal(h.state().queue.length,0,change);
  }
});
test('persisted queue schema fails closed for unknown kinds, raw content, wrong identities and retry metadata',async()=>{
  const h=enabled();await ingest(h,detail());const job=h.state().queue[0];
  const malformed=[null,{}, {...job,kind:'arbitrary'}, {...job,content:'INJECTED SCHOOL TEXT'}, {...job,id:'wrong'}, {...job,attempts:-1}, {...job,nextAt:NaN}, {...job,part:200}, {...job,fingerprint:'wrong'}];
  h.mutate(s=>s.queue=malformed);
  await h.startup();await h.api.deliver();
  a.equal(h.requests.length,0);a.equal(h.state().queue.length,0);a.equal(h.state().activity[0].code,'notification-queue-pruned');
});
test('legacy jobs cannot replay raw stored content; malformed notification configuration is disabled visibly',async()=>{
  const h=enabled();h.mutate(s=>{s.settings.reminderHours='every minute';s.settings.notifyNew='true';s.queue=[{id:'legacy',content:'PRIVATE',kind:'new',itemKey:'school|A|B'}];});
  const before=h.state();await h.startup();const view=await h.send({type:'state'});
  a.equal(view.recovery.blocked,true);a.equal(view.settings.notifyNew,false);a.equal(view.queue.length,0);
  a.deepEqual(h.state(),before);a.equal(h.requests.length,0);a.equal(h.alarms.size,0);
});
test('minimum automatic spacing is enforced, but an explicit test message is exempt',async()=>{
  const h=enabled();await save(h,{notificationGapMinutes:15});await ingest(h,detail('B'));await ingest(h,detail('C'));
  await h.api.deliver();await h.api.deliver();a.equal(h.requests.length,1);
  await h.send({type:'test-discord'});a.equal(h.requests.length,2);
  h.advance(15*60000);await h.api.deliver();a.equal(h.requests.length,3);
});
test('network errors do not leak the configured webhook into job errors or diagnostics',async()=>{
  const h=enabled({fetch:async url=>{throw new Error(`Fetch failed for ${url}`);}});
  await h.send({type:'test-discord'});
  a.ok(!JSON.stringify(h.state().queue).includes('SECRET'));a.ok(!JSON.stringify(h.state().activity).includes('SECRET'));
  a.match(h.state().deliveryError,/network request failed/);
});
test('multi-part digest resumes at the persisted cursor without repeating accepted parts',async()=>{
  const h=enabled();await save(h,{notifyNew:false,digestEnabled:true,digestHour:0});
  for(let i=0;i<15;i++)await ingest(h,{...detail(String(i)),title:`Task ${i} ${'x'.repeat(250)}`});
  await h.api.reminders();const saved=h.state();a.equal(saved.queue[0].kind,'digest');a.equal(saved.queue[0].part,1);
  const first=JSON.parse(h.requests[0].init.body).content;
  const resumed=harness({state:saved,now:h.now()});await resumed.startup();
  for(let i=0;i<20&&resumed.state().queue.length;i++)await resumed.api.deliver();
  a.equal(resumed.state().queue.length,0);a.ok(resumed.requests.every(r=>JSON.parse(r.init.body).content!==first));
  a.ok(resumed.requests.every(r=>JSON.parse(r.init.body).content.length<=2000));
});
test('unverified summary deadline changes suspend alerts until confirmed details arrive',async()=>{
  const h=enabled();await save(h,{notifyNew:false,remindersEnabled:true,reminderHours:[24]});await ingest(h,detail());
  h.mutate(s=>{s.settings.quietStart=15;s.settings.quietEnd=17;});
  await h.api.reminders();a.equal(h.state().queue.length,1);
  await ingest(h,{...detail('B','Nov 8, 2026, 10:00 AM'),source:'summary'});
  a.equal(h.state().items['school|A|B'].verificationNeeded,true);a.equal(h.state().queue.length,0);
  await ingest(h,detail('B','Nov 8, 2026, 10:00 AM'));
  a.equal(h.state().items['school|A|B'].verificationNeeded,false);a.equal(h.state().queue[0].kind,'deadline');
});
test('saving unrelated settings never shifts relative deadlines to the current day',async()=>{
  const h=enabled();await save(h,{notifyNew:false});await ingest(h,detail('B','Tomorrow, 9:00 AM'));
  const original=h.state().items['school|A|B'].due.at;
  h.advance(86400000);await save(h,{notificationGapMinutes:10});
  a.equal(h.state().items['school|A|B'].due.at,original);
  await save(h,{timezone:'America/Halifax'});
  a.equal(h.state().items['school|A|B'].due.date,'2026-11-06');
});
test('an item updated during network delivery is not falsely acknowledged as the newer event',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const h=enabled({fetch:()=>gate});await ingest(h,detail());
  const sending=h.api.deliver();for(let i=0;i<20&&!h.requests.length;i++)await new Promise(setImmediate);
  await ingest(h,{...detail(),title:'Updated while sending'});release({ok:true});await sending;
  a.equal(h.state().queue.length,1);a.equal(Object.keys(h.state().delivered).length,0);
  a.equal(h.state().activity[0].code,'notification-changed-during-delivery');
});
