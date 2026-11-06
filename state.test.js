const {test}=require('node:test');
const a=require('node:assert/strict');
const {harness,item,report}=require('./test-harness.cjs');
const Core=require('./core');
const detail=(id='B',extra={})=>item(id,'A',{source:'detail',courseName:'Math',...extra});
async function seed(h,value=detail()){
  h.mutate(s=>{s.courses.A={courseId:'A',name:'Math',url:'https://classroom.google.com/u/1/c/A',accountPath:'/u/1/'};});
  await h.api.ingest(report(value.url,[value]));
}
const exported=h=>h.send({type:'export'});
test('verbose troubleshooting expires across restart, does not extend on unrelated saves, and clears its report',async()=>{
  const h=harness();await h.send({type:'settings',value:{...h.state().settings,verbose:true,verboseUntil:Number.MAX_SAFE_INTEGER}});
  const until=h.now()+3600000;a.equal(h.state().settings.verboseUntil,until);
  h.advance(1800000);await h.send({type:'settings',value:{...h.state().settings,verbose:true}});a.equal(h.state().settings.verboseUntil,until);
  h.mutate(s=>{s.report={route:'course',pageTitle:'PRIVATE TITLE',bodyTextSample:'PRIVATE BODY'};});
  const running=harness({state:h.state(),now:h.now()});await running.startup();a.equal(running.state().settings.verbose,true);
  running.advance(1800001);const view=await running.send({type:'state'});a.equal(view.settings.verbose,false);a.equal(view.report,undefined);
  await running.startup();a.equal(running.state().settings.verbose,false);a.equal(running.state().settings.verboseUntil,0);a.equal(running.state().report,undefined);
  const task=detail();await running.api.ingest(report(task.url,[task],[],{report:{...report(task.url).report,pageTitle:'PRIVATE TITLE',bodyTextSample:'PRIVATE BODY',candidates:[{reason:'structured-link',title:'PRIVATE TITLE',text:'PRIVATE TEXT'}]}}));
  a.ok(!JSON.stringify(running.state().report).includes('PRIVATE'));a.equal(running.state().report.candidates[0].reason,'structured-link');
  await running.send({type:'settings',value:{...running.state().settings,verbose:true}});a.equal(running.state().settings.verboseUntil,running.now()+3600000);
  await running.send({type:'settings',value:{...running.state().settings,verbose:false}});a.equal(running.state().settings.verboseUntil,0);
});
test('legacy indefinite verbose sessions expire safely without blocking saved tasks',async()=>{
  const original=harness();await seed(original);const raw=original.state();raw.settings.verbose=true;delete raw.settings.verboseUntil;raw.report={bodyTextSample:'PRIVATE'};
  const h=harness({state:raw,now:original.now()});await h.startup();const view=await h.send({type:'state'});
  a.equal(view.recovery.blocked,false);a.equal(view.settings.verbose,false);a.equal(view.report,undefined);a.equal(Object.keys(view.items).length,1);
});
async function importPreview(h,data,policy='keep'){return h.send({type:'import-preview',text:JSON.stringify(data),policy});}
async function apply(h,data,policy='keep'){
  const preview=await importPreview(h,data,policy);
  return h.send({type:'import',text:JSON.stringify(data),policy,expectedRevision:preview.revision,confirmed:true});
}
test('known v1 migration preserves tasks, notes and settings, and does not send alerts',async()=>{
  const original=harness();await seed(original);await original.send({type:'local',key:'school|A|B',value:{status:'in-progress',note:'Keep this note',minutes:20,snoozeUntil:0}});
  const legacy=original.state();legacy.schemaVersion=1;delete legacy.revision;
  for(const k of ['completedRetentionDays','diagnosticRetentionHours','historyRetentionDays'])delete legacy.settings[k];
  const h=harness({state:legacy,now:original.now()});await h.startup();
  a.equal(h.state().schemaVersion,2);a.equal(h.state().items['school|A|B'].local.note,'Keep this note');
  a.equal(h.state().settings.completedRetentionDays,0);a.equal(h.requests.length,0);
});
test('incompatible schema blocks automation without rewriting original data and still permits safe export',async()=>{
  const original=harness();await seed(original);const raw=original.state();raw.schemaVersion=99;raw.settings.webhook='https://discord.com/api/webhooks/123/SECRET';
  const h=harness({state:raw,now:original.now()});await h.startup();
  await a.rejects(h.send({type:'scan'}),/blocked/);await a.rejects(h.send({type:'test-discord'}),/invalid or incompatible/);
  const view=await h.send({type:'state'});a.equal(view.recovery.blocked,true);a.equal(view.recovery.validTasks,1);
  const backup=await exported(h);a.equal(backup.items['school|A|B'].title,'Task B');a.ok(!JSON.stringify(backup).includes('SECRET'));
  a.deepEqual(h.state(),raw);a.equal(h.requests.length,0);a.equal(h.operations.filter(o=>o.kind==='storage-write').length,0);a.equal(h.alarms.size,0);
  await a.rejects(h.send({type:'recover',confirmed:true}),/incompatible data stays untouched/);a.deepEqual(h.state(),raw);
});
test('corrupt mandatory records, derived deadlines, settings or root cannot alert or erase valid records',async()=>{
  const original=harness();await seed(original);const good=original.state();good.settings.webhook='https://discord.com/api/webhooks/123/SECRET';
  const cases=[null,[],{...good,items:{...good.items,broken:{title:'Invalid record'}}},structuredClone(good),structuredClone(good),structuredClone(good)];
  cases[3].items['school|A|B'].due.at+=3600000;
  cases[4].settings.intervalMinutes=1;
  cases[5].items['school|A|B'].url='https://evil.test/private';
  for(const raw of cases){
    const h=harness({state:raw,now:original.now()});await h.startup();
    const view=await h.send({type:'state'});a.equal(view.recovery.blocked,true);
    await a.rejects(h.send({type:'retry-delivery'}),/invalid or incompatible/);
    a.deepEqual(h.state(),raw);a.equal(h.requests.length,0);a.equal(h.alarms.size,0);
  }
});
test('explicit supported-schema recovery backs up original data and disables all delivery',async()=>{
  const original=harness();await seed(original);const raw=original.state();raw.items.bad={title:'Broken'};
  raw.settings.webhook='https://discord.com/api/webhooks/123/SECRET';
  const h=harness({state:raw,now:original.now()});await a.rejects(h.send({type:'recover'}),/confirmation/);
  await h.send({type:'recover',confirmed:true});
  a.equal(h.state().items['school|A|B'].title,'Task B');a.equal(h.state().items['school|A|B'].imported,true);
  a.equal(h.state().settings.webhook,'');a.deepEqual(h.state().settings.courses,[]);a.equal(h.state().queue.length,0);
  const stored=await h.browser.storage.local.get('recoveryBackup');a.deepEqual(stored.recoveryBackup.state,raw);
  await a.rejects(h.send({type:'delete-recovery-backup'}),/Confirm/);
  await h.send({type:'delete-recovery-backup',confirmed:true});a.equal((await h.browser.storage.local.get('recoveryBackup')).recoveryBackup,undefined);
});
test('import rejects oversized, foreign-account, unsupported, unsafe-key and secret-bearing files atomically',async()=>{
  const h=harness();await seed(h);const data=await exported(h),before=h.state();
  const cases=[{...data,schemaVersion:77},{...data,settings:{webhook:'SECRET'}},{...data,accountPath:'/u/0/'},{...data,profile:'Someone else'}];
  for(const value of cases)await a.rejects(importPreview(h,value));
  await a.rejects(h.send({type:'import-preview',policy:'keep',text:'{"schemaVersion":2,"__proto__":{"polluted":true}}'}),/unsafe import/);
  await a.rejects(h.send({type:'import-preview',policy:'keep',text:'x'.repeat(2*1024*1024+1)}),/invalid text/);
  const bad=structuredClone(data);bad.items['school|A|B'].url='https://classroom.google.com/u/0/c/A/a/B/details';await a.rejects(importPreview(h,bad),/identity mismatch/);
  a.deepEqual(h.state(),before);a.equal(h.requests.length,0);a.equal({}.polluted,undefined);
});
test('import preview is read-only, conflicts are explicit and replacement preserves local edits',async()=>{
  const h=harness();await seed(h);await h.send({type:'local',key:'school|A|B',value:{status:'in-progress',note:'My own plan',minutes:35,snoozeUntil:0}});
  const data=await exported(h);data.items['school|A|B'].title='Incoming title';data.items['school|A|B'].local.note='Imported note';
  const before=h.state();const preview=await importPreview(h,data);a.equal(preview.conflicts,1);a.equal(preview.kept,1);a.deepEqual(h.state(),before);
  await apply(h,data,'keep');a.equal(h.state().items['school|A|B'].title,'Task B');
  await apply(h,data,'replace');const task=h.state().items['school|A|B'];
  a.equal(task.title,'Incoming title');a.equal(task.local.note,'My own plan');a.equal(task.local.minutes,35);a.equal(task.status,'unknown');a.equal(task.lastVerifiedAt,0);a.equal(task.imported,true);
});
test('stale import previews cannot overwrite new local edits',async()=>{
  const h=harness();await seed(h);const data=await exported(h),preview=await importPreview(h,data,'replace');
  await h.send({type:'local',key:'school|A|B',value:{status:'in-progress',note:'Edited since preview',minutes:null,snoozeUntil:0}});
  const before=h.state();await a.rejects(h.send({type:'import',text:JSON.stringify(data),policy:'replace',expectedRevision:preview.revision,confirmed:true}),/preview the import again/);
  a.deepEqual(h.state(),before);
});
test('imported snapshots never alert until detail verification and do not enable settings or selection',async()=>{
  const source=harness();await seed(source);const data=await exported(source);
  const h=harness();h.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/SECRET';s.settings.digestHour=0;s.courses.A={courseId:'A',name:'Math',url:'https://classroom.google.com/u/1/c/A',accountPath:'/u/1/',notificationsReadyAt:h.now()};});
  await apply(h,data);await h.api.reminders();a.equal(h.requests.length,0);a.equal(h.state().items['school|A|B'].imported,true);
  await h.api.ingest(report(detail().url,[{...detail(),source:'summary'}]));await h.api.reminders();a.equal(h.requests.length,0);
  await h.api.ingest(report(detail().url,[detail()]));a.equal(h.state().items['school|A|B'].imported,false);
  await h.api.reminders();a.equal(h.requests.length,1);a.equal(h.state().settings.webhook,'https://discord.com/api/webhooks/123/SECRET');
});
test('retention deletes only aged completed work and diagnostics, never unfinished or unknown-status tasks',async()=>{
  const h=harness();await seed(h,detail('DONE',{status:'submitted'}));await seed(h,detail('OPEN'));await seed(h,detail('UNKNOWN',{status:'unknown',dueRaw:''}));
  h.advance(40*86400000);await h.send({type:'retention',confirmed:true,value:{completedRetentionDays:30,diagnosticRetentionHours:24,historyRetentionDays:30}});
  const preview=await h.send({type:'cleanup-preview'});a.equal(preview.completed,1);a.equal(preview.diagnostics,true);
  await h.send({type:'cleanup',expectedRevision:preview.revision,confirmed:true});
  a.equal(h.state().items['school|A|DONE'],undefined);a.ok(h.state().items['school|A|OPEN']);a.ok(h.state().items['school|A|UNKNOWN']);a.equal(h.state().report,undefined);
});
test('default retention keeps completed tasks and rescans do not reset completion age',async()=>{
  const h=harness();await seed(h,detail('DONE',{status:'submitted'}));const completed=h.state().items['school|A|DONE'].completedAt;
  h.advance(40*86400000);await h.api.ingest(report(detail('DONE').url,[detail('DONE',{source:'summary',status:'unknown'})]));
  a.equal(h.state().items['school|A|DONE'].completedAt,completed);
  a.equal((await h.send({type:'cleanup-preview'})).completed,0);
});
test('history and individual deletion require confirmation, remove orphan jobs and preserve preferences',async()=>{
  const h=harness();await seed(h);const settings=h.state().settings;
  await a.rejects(h.send({type:'delete-item',key:'school|A|B'}),/Confirm/);
  await h.send({type:'delete-item',key:'school|A|B',confirmed:true});a.equal(Object.keys(h.state().items).length,0);
  await seed(h);await a.rejects(h.send({type:'clear-history'}),/Confirm/);await h.send({type:'clear-history',confirmed:true});
  a.deepEqual(h.state().settings,settings);a.equal(h.state().queue.length,0);a.equal(h.state().scan,null);
});
test('stale cleanup previews and invalid retention settings cannot delete any records',async()=>{
  const h=harness();await seed(h);const preview=await h.send({type:'cleanup-preview'});
  await h.send({type:'retention',value:{completedRetentionDays:0,diagnosticRetentionHours:10,historyRetentionDays:10}});
  const before=h.state();await a.rejects(h.send({type:'cleanup',expectedRevision:preview.revision,confirmed:true}),/Preview and confirm/);
  await a.rejects(h.send({type:'retention',value:{completedRetentionDays:-1,diagnosticRetentionHours:0,historyRetentionDays:1}}));a.deepEqual(h.state(),before);
  await a.rejects(h.send({type:'retention',value:{completedRetentionDays:10,diagnosticRetentionHours:10,historyRetentionDays:10}}),/Confirm enabling/);a.deepEqual(h.state(),before);
});
test('storage write failures preserve migration sources and pre-import local records',async()=>{
  const original=harness();await seed(original);const legacy=original.state();legacy.schemaVersion=1;
  const migration=harness({state:legacy,now:original.now(),onSet:async()=>{throw Error('Quota failure');}});
  await migration.startup();a.deepEqual(migration.state(),legacy);a.equal(migration.alarms.size,0);
  let fail=false;const target=harness({onSet:async()=>{if(fail)throw Error('Quota failure');}});await seed(target);
  const data=await exported(original);data.items['school|A|B'].title='Incoming';
  const preview=await importPreview(target,data,'replace'),before=target.state();fail=true;
  await a.rejects(target.send({type:'import',text:JSON.stringify(data),policy:'replace',expectedRevision:preview.revision,confirmed:true}),/Quota failure/);
  a.deepEqual(target.state(),before);a.equal(target.requests.length,0);
});
test('import byte limits include UTF-8 expansion, not just JavaScript character count',async()=>{
  const h=harness();await seed(h);const before=h.state(),text='😀'.repeat(530000);
  a.ok(text.length<2*1024*1024);
  await a.rejects(h.send({type:'import-preview',text,policy:'keep'}),/2 MiB byte limit/);a.deepEqual(h.state(),before);
});
test('CSV export escapes formulas, quotes and newlines, excludes secrets, and never writes storage',async()=>{
  const h=harness();await seed(h,detail('B',{title:'=HYPERLINK("unsafe")'}));
  await h.send({type:'local',key:'school|A|B',value:{status:'not-started',note:' @command\nnext line',minutes:null,snoozeUntil:0}});
  h.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/SECRET';});
  const before=h.state(),writes=h.operations.filter(o=>o.kind==='storage-write').length,csv=await h.send({type:'export-csv'});
  a.ok(csv.includes(`"'=HYPERLINK(""unsafe"")"`));a.ok(csv.includes(`"' @command\nnext line"`));a.ok(!csv.includes('SECRET'));
  a.equal(h.operations.filter(o=>o.kind==='storage-write').length,writes);a.deepEqual(h.state(),before);
});
