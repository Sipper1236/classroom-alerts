const {test}=require('node:test');
const a=require('node:assert/strict');
const {harness,report,item}=require('./test-harness.cjs');
const home='https://classroom.google.com/u/1/h/st';
const course={courseId:'A',name:'PRIVATE COURSE NAME',url:'https://classroom.google.com/u/1/c/A',accountPath:'/u/1/'};
function stale(){const h=harness();h.mutate(s=>{
  s.settings.webhook='https://discord.com/api/webhooks/123/test';s.settings.digestEnabled=false;s.settings.remindersEnabled=false;
  s.courses.A={...course,firstAttemptAt:h.now()-26*3600000,attemptedAt:h.now()-1000};
});return h;}
test('scan-health warning is daily, count-only and remains independent of homework rows',async()=>{
  const h=stale();await h.api.reminders();await h.api.reminders();a.equal(h.requests.length,1);
  const content=JSON.parse(h.requests[0].init.body).content;a.match(content,/1 selected course/);a.ok(!content.includes('PRIVATE COURSE NAME'));a.ok(!content.includes('/c/A'));
  h.advance(86400000);await h.api.reminders();a.equal(h.requests.length,2);
});
test('health jobs obey quiet hours, thresholds, disable controls, recovery and restart invalidation',async()=>{
  const h=stale();h.mutate(s=>{s.settings.quietStart=15;s.settings.quietEnd=17;});await h.api.reminders();a.equal(h.requests.length,0);a.equal(h.state().queue[0].kind,'health');
  await h.send({type:'settings',value:{...h.state().settings,healthStaleHours:48}});a.equal(h.state().queue.length,0);
  await h.send({type:'settings',value:{...h.state().settings,healthStaleHours:24}});await h.api.reminders();a.equal(h.state().queue.length,1);
  await h.send({type:'settings',value:{...h.state().settings,notifyHealth:false}});a.equal(h.state().queue.length,0);
  await h.send({type:'settings',value:{...h.state().settings,notifyHealth:true}});await h.api.reminders();
  const restored=harness({state:h.state(),now:h.now()});restored.mutate(s=>{s.courses.A.lastSuccessAt=restored.now();});await restored.startup();a.equal(restored.state().queue.length,0);a.equal(restored.requests.length,0);
  await a.rejects(h.send({type:'settings',value:{...h.state().settings,healthStaleHours:0}}),/1–168/);
});
test('health does not warn before monitoring starts or within its grace period',async()=>{
  const h=harness();h.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/test';});await h.api.reminders();a.equal(h.requests.length,0);
  h.mutate(s=>{s.monitoringStartedAt=h.now();});h.advance(23*3600000);await h.api.reminders();a.equal(h.requests.length,0);
  h.advance(3600001);await h.api.reminders();a.equal(h.requests.length,1);
});
test('explicit empty UI evidence records a successful scoped empty course; bare zero results stay partial',async()=>{
  const empty=report(course.url,[],[],{report:{...report(course.url).report,emptyStateTrusted:true,warning:null}});
  const h=harness({routes:{[home]:report(home,[],[course]),[course.url]:empty}});await h.api.scanAll();
  a.equal(h.state().scan.status,'finished');a.equal(h.state().courses.A.coverage,'empty-with-visible-marker');a.ok(h.state().courses.A.lastSuccessAt);a.equal(h.state().courses.A.detailsChecked,0);
  const unknown=harness({routes:{[home]:report(home,[],[course]),[course.url]:report(course.url)}});await unknown.api.scanAll();a.equal(unknown.state().scan.status,'partial');a.equal(unknown.state().courses.A.lastSuccessAt,undefined);
});
test('current-course control scans only the active approved course and retains the original tab',async()=>{
  const second={...course,courseId:'Z',url:'https://classroom.google.com/u/1/c/Z'},task=item();
  const h=harness({routes:{[home]:report(home,[],[course,second]),[course.url]:report(course.url,[task]),[task.url]:report(task.url,[{...task,source:'detail'}])}});
  h.mutate(s=>{s.settings.courses=['A','Z'];});const tab=await h.browser.tabs.create({url:course.url,active:true});
  await h.send({type:'scan-current-course'});await h.settle();a.deepEqual(h.state().scan.courseIds,['A']);a.equal(h.state().scan.checked,1);a.ok(h.tabs.has(tab.id));
  a.equal(h.operations.filter(o=>o.kind==='update'&&o.url===second.url).length,0);
  a.equal(h.state().courses.A.detailsChecked,1);a.equal(h.state().courses.A.detailsFailed,0);a.equal(h.state().courses.A.detailsRemaining,0);
  await a.rejects(h.send({type:'scan',mode:'course',courseId:'NOT_SELECTED'}),/Select this course/);
});
test('successful bounded course scan annotates unseen records without changing status, dates, notes or retention',async()=>{
  const visible=item('VISIBLE','A',{source:'detail'}),old=item('OLD','A',{source:'detail',dueRaw:'',status:'unknown'}),other=item('OTHER','Z');
  const h=harness({routes:{[home]:report(home,[],[course]),[course.url]:report(course.url,[visible])}});
  await h.api.ingest(report(old.url,[old,other]));
  await h.send({type:'local',key:'school|A|OLD',value:{status:'in-progress',note:'Keep working',minutes:20,snoozeUntil:0}});
  const before=h.state().items['school|A|OLD'];h.advance(1000);await h.api.scanAll();
  const after=h.state().items['school|A|OLD'];a.equal(h.state().scan.status,'finished');a.equal(after.notSeenAt,h.now());a.equal(after.notSeenIn,course.url);
  const {notSeenAt,notSeenIn,...unchanged}=after;a.deepEqual(unchanged,before);a.equal(h.state().items['school|Z|OTHER'].notSeenAt,undefined);
  const view=await h.send({type:'state'});a.ok(view.plan.some(task=>task.key===after.key&&task.reason.includes('not proof of removal or completion')));
  const restarted=harness({state:h.state(),now:h.now()});await restarted.startup();a.equal(restarted.state().items[after.key].notSeenAt,notSeenAt);
  const backup=await restarted.send({type:'export'});a.equal(backup.items[after.key].notSeenIn,course.url);
  const target=harness({now:h.now()}),text=JSON.stringify(backup),preview=await target.send({type:'import-preview',text,policy:'keep'});
  await target.send({type:'import',text,policy:'keep',expectedRevision:preview.revision,confirmed:true});a.equal(target.state().items[after.key].notSeenAt,undefined);
  h.advance(1000);await h.api.ingest(report(old.url,[old]));a.equal(h.state().items[after.key].notSeenAt,undefined);a.equal(h.state().items[after.key].notSeenIn,undefined);a.deepEqual(h.state().items[after.key].local,before.local);
});
test('explicit successful empty course can annotate old records, but bare zero, truncation, failure and cancellation cannot',async()=>{
  const empty=report(course.url,[],[],{report:{...report(course.url).report,emptyStateTrusted:true,warning:null}});
  for(const mode of ['empty','unknown','truncated','failed','cancelled']){
    const result=mode==='empty'?empty:mode==='truncated'?{...empty,report:{...empty.report,truncated:true}}:report(course.url);
    const h=harness({routes:{[home]:report(home,[],[course]),[course.url]:async(tab,message,api)=>{
      if(mode==='failed')throw Error('Offline');if(mode==='cancelled')await api.send({type:'cancel'});return result;
    }}});
    await h.api.ingest(report(item().url,[item()]));h.advance(1000);await h.api.scanAll();
    a.equal(Boolean(h.state().items['school|A|B'].notSeenAt),mode==='empty',mode);a.equal(h.state().items['school|A|B'].status,'assigned',mode);a.equal(h.state().items['school|A|B'].local.status,'not-started',mode);
  }
});
test('absence metadata rejects foreign/item scopes, missing pairs and times before the last sighting',async()=>{
  const h=harness();await h.api.ingest(report(item().url,[item()]));const base=h.state();
  for(const annotation of [{notSeenAt:h.now(),notSeenIn:'https://classroom.google.com/u/0/c/A'},
    {notSeenAt:h.now(),notSeenIn:item().url},{notSeenAt:h.now()},
    {notSeenIn:course.url},{notSeenAt:h.now()-1,notSeenIn:course.url}]){
    const raw=structuredClone(base);Object.assign(raw.items['school|A|B'],annotation);const corrupt=harness({state:raw,now:h.now()});
    const view=await corrupt.send({type:'state'});a.equal(view.recovery.blocked,true);a.deepEqual(corrupt.state(),raw);
  }
});
test('detail failures cannot create absence annotations and a newer concurrent sighting beats an older listing',async()=>{
  for(const failure of [true,false]){
    const old=item('OLD'),visible=item('VISIBLE');
    const h=harness({routes:{[home]:report(home,[],[course]),[course.url]:report(course.url,[visible]),[visible.url]:async(tab,message,api)=>{
      if(failure)throw Error('Unsupported detail');api.advance(1000);await api.api.ingest(report(old.url,[old]));return report(visible.url,[{...visible,source:'detail'}]);
    }}});
    await h.api.ingest(report(old.url,[old]));h.advance(1000);await h.api.scanAll();
    a.equal(h.state().scan.status,failure?'partial':'finished');a.equal(h.state().items['school|A|OLD'].notSeenAt,undefined);
  }
});
