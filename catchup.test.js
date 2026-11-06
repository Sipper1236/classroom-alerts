const {test}=require('node:test');
const a=require('node:assert/strict');
const {harness,item,report}=require('./test-harness.cjs');
const edits=extra=>({status:'not-started',note:'',minutes:null,snoozeUntil:0,...extra});
async function sleeping(options={},count=3){
  const h=harness(options);
  await h.send({type:'settings',value:{...h.state().settings,webhook:'https://discord.com/api/webhooks/123/SECRET',digestEnabled:false,notifyHealth:false,notifyNew:false,notifyDeadline:false,quietStart:15,quietEnd:23}});
  const tasks=Array.from({length:count},(_,i)=>item(String(i),'A',{title:`Task ${i}`,source:'detail',dueRaw:'Nov 5, 2026, 10:00 PM'}));
  await h.api.ingest(report(tasks[0].url,tasks));await h.api.reminders();return {h,tasks};
}
test('a four-hour scheduling gap replaces missed windows with one current catch-up, acknowledges children only after success and never replays them',async()=>{
  const {h}=await sleeping();a.equal(h.state().queue.length,3);a.ok(h.state().queue.every(job=>job.windowHours===24));
  h.advance(4*3600000);await h.api.reminders();a.equal(h.requests.length,0);a.equal(h.state().queue.length,1);
  const job=h.state().queue[0];a.equal(job.kind,'catchup');a.equal(job.events.length,3);a.ok(job.events.every(event=>event.windowHours===3));a.equal(Object.keys(h.state().delivered).length,0);
  await h.send({type:'settings',value:{...h.state().settings,quietStart:0,quietEnd:0}});await h.api.reminders();a.equal(h.requests.length,1);
  const payload=JSON.parse(h.requests[0].init.body);a.match(payload.content,/Homework catch-up/);a.match(payload.content,/3 alerts combined/);a.ok(!payload.content.includes('Due within 24'));a.deepEqual(payload.allowed_mentions,{parse:[]});
  for(const event of job.events)a.ok(h.state().delivered[event.id]);a.equal(h.state().queue.length,0);
  await h.api.reminders();a.equal(h.requests.length,1);
});
test('catch-up excludes submitted, expired, snoozed, ambiguous, imported and stale-detail reminders',async()=>{
  const {h,tasks}=await sleeping({},6);
  await h.api.ingest(report(tasks[2].url,[{...tasks[2],status:'submitted'}]));
  await h.api.ingest(report(tasks[3].url,[{...tasks[3],dueRaw:'Nov 5, 2026, 5:00 PM'}]));
  await h.send({type:'local',key:'school|A|4',value:edits({snoozeUntil:h.now()+12*3600000})});
  await h.api.ingest(report(tasks[5].url,[{...tasks[5],dueRaw:'Monday'}]));
  h.advance(4*3600000);await h.api.reminders();const job=h.state().queue[0];a.equal(job.kind,'catchup');a.deepEqual(job.events.map(e=>e.itemKey),['school|A|0','school|A|1']);
  const preview=await h.send({type:'preview-discord'});a.equal(preview.queued.length,1);a.match(preview.queued[0].messages[0],/2 current task/);
  await h.send({type:'settings',value:{...h.state().settings,remindersEnabled:false}});a.equal(h.state().queue.length,0);
  h.mutate(s=>{Object.assign(s.items['school|A|0'],{source:'imported',imported:true,verificationNeeded:true,lastVerifiedAt:0,status:'unknown'});Object.assign(s.items['school|A|1'],{source:'summary',lastVerifiedAt:0});});
  await h.send({type:'settings',value:{...h.state().settings,remindersEnabled:true}});await h.api.reminders();a.equal(h.state().queue.length,0);
  const stale=await sleeping();stale.h.advance(25*3600000);await stale.h.api.reminders();a.equal(stale.h.state().queue.length,0);
});
test('catch-up preserves 429 delay and survives restart without resetting attempts, spacing or current-state checks',async()=>{
  const {h,tasks}=await sleeping({fetch:async()=>({ok:false,status:429,headers:{get:()=> '3600'}})});
  h.advance(4*3600000);await h.api.reminders();await h.send({type:'settings',value:{...h.state().settings,quietStart:0,quietEnd:0,notificationGapMinutes:15}});await h.api.reminders();
  a.equal(h.requests.length,1);a.equal(h.state().queue[0].attempts,1);const retry=h.state().queue[0].nextAt;
  const restored=harness({state:h.state(),now:h.now()});await restored.startup();await restored.api.reminders();a.equal(restored.requests.length,0);a.equal(restored.state().queue[0].nextAt,retry);
  await restored.api.ingest(report(tasks[0].url,[{...tasks[0],status:'submitted'}]));restored.advance(3600001);await restored.api.reminders();
  a.equal(restored.requests.length,1);a.ok(!JSON.parse(restored.requests[0].init.body).content.includes('**Task 0**'));a.equal(restored.state().queue.length,0);
});
test('one bounded summary combines a large missed backlog without chunk replay or academic/private data',async()=>{
  const {h}=await sleeping({},90);h.mutate(s=>{for(const task of Object.values(s.items)){task.title+=' long title '.repeat(25);task.instructions='PRIVATE BODY';task.local.note='PRIVATE NOTE';}});
  h.advance(4*3600000);await h.api.reminders();await h.send({type:'settings',value:{...h.state().settings,quietStart:0,quietEnd:0}});await h.api.reminders();
  a.equal(h.requests.length,1);const text=JSON.parse(h.requests[0].init.body).content;a.ok(text.length<=2000);a.match(text,/90 alerts combined/);a.match(text,/additional alerts were combined/);a.ok(!text.includes('PRIVATE'));a.ok(!text.includes('SECRET'));
  a.equal(h.state().queue.length,0);await h.api.reminders();a.equal(h.requests.length,1);
});
test('malformed or nested catch-up jobs cannot send raw text',async()=>{
  const {h}=await sleeping();h.advance(4*3600000);await h.api.reminders();const raw=h.state(),job=raw.queue[0];
  for(const bad of [{...job,events:[{...job.events[0],content:'RAW SCHOOL TEXT'}]},{...job,events:[{...job,events:[]}]},{...job,part:1}]){
    const state=structuredClone(raw);state.queue=[bad];const broken=harness({state,now:h.now()});await broken.startup();a.equal(broken.state().queue.length,0);a.equal(broken.requests.length,0);
  }
});
test('already accepted digest parts are not replayed by folding the remaining digest into a new catch-up',async()=>{
  const {h}=await sleeping({},30);await h.send({type:'settings',value:{...h.state().settings,digestEnabled:true,digestHour:0}});await h.api.reminders();
  h.mutate(s=>{s.queue.find(job=>job.kind==='digest').part=1;});h.advance(4*3600000);await h.api.reminders();
  a.equal(h.state().queue.find(job=>job.kind==='digest').part,1);a.ok(h.state().queue.find(job=>job.kind==='catchup').events.every(event=>event.kind!=='digest'));
});
test('missed new/deadline events are combined with reminders while each current assignment appears only once',async()=>{
  const {h,tasks}=await sleeping();h.mutate(s=>{s.courses.A={courseId:'A',name:'Math',url:'https://classroom.google.com/u/1/c/A',notificationsReadyAt:h.now()};});
  await h.send({type:'settings',value:{...h.state().settings,notifyNew:true,notifyDeadline:true}});
  const added=item('NEW','A',{title:'New practice',source:'detail',dueRaw:'Nov 5, 2026, 10:00 PM'});
  await h.api.ingest(report(tasks[0].url,[{...tasks[0],dueRaw:'Nov 6, 2026, 11:00 AM'},added]));await h.api.reminders();h.advance(4*3600000);await h.api.reminders();
  const job=h.state().queue[0];a.equal(job.kind,'catchup');a.ok(job.events.some(event=>event.kind==='new'));a.ok(job.events.some(event=>event.kind==='deadline'));
  const preview=await h.send({type:'preview-discord'}),text=preview.queued[0].messages[0];a.equal((text.match(/\*\*New practice\*\*/g)||[]).length,1);a.equal((text.match(/\*\*Task 0\*\*/g)||[]).length,1);
});
test('a catch-up changed during network delivery is not falsely acknowledged as its newer membership',async()=>{
  let release,started;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);
  const {h,tasks}=await sleeping({fetch:async()=>{started();await gate;return {ok:true};}});h.advance(4*3600000);await h.api.reminders();
  const original=h.state().queue[0];await h.send({type:'settings',value:{...h.state().settings,quietStart:0,quietEnd:0}});
  const sending=h.api.deliver();await ready;await h.api.ingest(report(tasks[0].url,[{...tasks[0],status:'submitted'}]));release();await sending;
  a.equal(h.requests.length,1);a.equal(h.state().queue[0].events.length,2);for(const event of original.events)a.equal(h.state().delivered[event.id],undefined);
});
test('catch-up honors minimum spacing and a global fractional Retry-After even when the original reminder window becomes stale',async()=>{
  const spaced=await sleeping();spaced.h.advance(4*3600000);await spaced.h.api.reminders();await spaced.h.send({type:'settings',value:{...spaced.h.state().settings,quietStart:0,quietEnd:0,notificationGapMinutes:60}});
  spaced.h.mutate(s=>{s.lastDeliveryAt=spaced.h.now();});await spaced.h.api.reminders();a.equal(spaced.h.requests.length,0);spaced.h.advance(3600001);await spaced.h.api.reminders();a.equal(spaced.h.requests.length,1);
  let limited=true;const {h}=await sleeping({fetch:async()=>limited?{ok:false,status:429,headers:{get:()=> '18000.1234'}}:{ok:true}});
  await h.send({type:'settings',value:{...h.state().settings,quietStart:0,quietEnd:0}});await h.api.deliver();const until=h.state().deliveryNotBefore;a.ok(Number.isSafeInteger(until));
  h.advance(4*3600000);await h.api.reminders();a.equal(h.requests.length,1);a.equal(h.state().queue[0].kind,'catchup');
  limited=false;h.advance(until-h.now()+1);await h.api.reminders();a.equal(h.requests.length,2);a.equal(h.state().queue.length,0);
});
