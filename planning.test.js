const {test}=require('node:test');
const a=require('node:assert/strict');
const C=require('./core');
const {harness,item,report}=require('./test-harness.cjs');
const edits=(extra={})=>({status:'in-progress',note:'Read chapter 2',minutes:20,snoozeUntil:0,...extra});
test('today pins use the school day, expire at its midnight and cannot override snooze or completion',()=>{
  const state=C.emptyState(),now=Date.parse('2026-11-06T03:30:00Z');
  Object.assign(state.settings,{profile:'school',accountPath:'/u/1/',courses:['A'],timezone:'America/Halifax'});
  C.mergeItems(state,[item('URGENT','A',{dueRaw:'Nov 6, 2026, 1:00 AM'}),item('PIN','A',{dueRaw:'No due date'}),item('SNOOZED','A',{dueRaw:'No due date'})],now);
  a.equal(C.schoolDay(state.settings.timezone,now),'2026-11-05');
  state.items['school|A|PIN'].local.pinnedDay='2026-11-05';
  Object.assign(state.items['school|A|SNOOZED'].local,{pinnedDay:'2026-11-05',snoozeUntil:now+3600000});
  a.deepEqual(C.plan(state,now).map(i=>i.itemId),['PIN','URGENT','SNOOZED']);
  a.match(C.plan(state,now)[2].reason,/Snoozed until/);
  a.equal(C.plan(state,now+3600000)[0].itemId,'URGENT');a.equal(C.plan(state,now+3600000).some(i=>i.pinnedToday),false);
  state.items['school|A|PIN'].local.status='complete';a.ok(!C.plan(state,now).some(i=>i.itemId==='PIN'));
});
test('local pins and chosen snooze persist through scans, restart and backups without changing Classroom status',async()=>{
  const h=harness(),task=item('B','A',{source:'detail'});await h.api.ingest(report(task.url,[task]));
  const until=h.now()+2*3600000;await h.send({type:'local',key:'school|A|B',value:edits({pinToday:true,snoozeUntil:until})});
  a.equal(h.state().items['school|A|B'].local.pinnedDay,'2026-11-05');
  await h.api.ingest(report(task.url,[task]));a.equal(h.state().items['school|A|B'].status,'assigned');a.equal(h.state().items['school|A|B'].local.snoozeUntil,until);
  const restarted=harness({state:h.state(),now:h.now()});await restarted.startup();
  const backup=await restarted.send({type:'export'});a.equal(backup.items['school|A|B'].local.pinnedDay,'2026-11-05');a.equal(backup.items['school|A|B'].local.note,'Read chapter 2');
  await restarted.send({type:'local',key:'school|A|B',value:edits()});a.equal(restarted.state().items['school|A|B'].local.pinnedDay,'2026-11-05');
  await restarted.send({type:'local',key:'school|A|B',value:edits({pinToday:false})});a.equal(restarted.state().items['school|A|B'].local.pinnedDay,'');
});
test('invalid chosen snooze and pin requests fail atomically, and invalid persisted pin dates block automation',async()=>{
  const h=harness(),task=item();await h.api.ingest(report(task.url,[task]));const before=h.state();
  for(const value of [edits({pinToday:'yes'}),edits({snoozeUntil:NaN}),edits({snoozeUntil:-1}),edits({snoozeUntil:h.now()+31*86400000}),edits({snoozeUntil:1.5})]){
    await a.rejects(h.send({type:'local',key:'school|A|B',value}));a.deepEqual(h.state(),before);
  }
  const bad=h.state();bad.items['school|A|B'].local.pinnedDay='2026-02-30';const broken=harness({state:bad,now:h.now()});
  a.equal((await broken.send({type:'state'})).recovery.blocked,true);a.deepEqual(broken.state(),bad);
});
