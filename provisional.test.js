const {test}=require('node:test');
const a=require('node:assert/strict');
const {harness,report,item}=require('./test-harness.cjs');
const scope='https://classroom.google.com/u/1/c/A/m';
const candidate=(extra={})=>({courseId:'A',scopeURL:scope,title:'PRIVATE PROVISIONAL',dueRaw:'Monday',...extra});
const page=(rows,extra={})=>report(scope,[],[],{provisional:rows,...extra});
test('provisional observations stay separate, preserve duplicate titles, never merge by title or notify, and survive restart',async()=>{
  const h=harness();await h.send({type:'settings',value:{...h.state().settings,webhook:'https://discord.com/api/webhooks/123/test',digestHour:0}});
  await h.api.ingest(page([candidate(),candidate()]));a.equal(h.state().provisional.length,2);a.equal(Object.keys(h.state().items).length,0);
  await h.api.reminders();a.equal(h.requests.length,0);a.equal((await h.send({type:'state'})).plan.length,0);
  const stable=item('B','A',{title:'PRIVATE PROVISIONAL',source:'detail'});await h.api.ingest(report(stable.url,[stable],[],{provisional:[]}));
  a.equal(h.state().provisional.length,2);a.equal(Object.keys(h.state().items).length,1);
  const preview=await h.send({type:'preview-discord'});a.equal(preview.digest.length,1);a.equal((preview.digest[0].match(/\*\*PRIVATE PROVISIONAL\*\*/g)||[]).length,1);
  const restarted=harness({state:h.state(),now:h.now()});await restarted.startup();a.equal(restarted.state().provisional.length,2);
});
test('page snapshots replace only their scope, inventory caps at 200 and clearing leaves identified tasks alone',async()=>{
  const h=harness();for(const courseId of ['A','B','C','D','E']){
    const url=`https://classroom.google.com/u/1/c/${courseId}/m`;
    await h.api.ingest(report(url,[],[],{provisional:Array.from({length:50},()=>candidate({courseId,scopeURL:url}))}));
  }
  a.equal(h.state().provisional.length,200);await h.api.ingest(page([candidate()]));a.equal(h.state().provisional.filter(row=>row.scopeURL===scope).length,1);
  await h.api.ingest(page([],{report:{...report(scope).report,truncated:true}}));a.equal(h.state().provisional.filter(row=>row.scopeURL===scope).length,1);
  await h.api.ingest(page([]));a.equal(h.state().provisional.filter(row=>row.scopeURL===scope).length,1);
  await h.api.ingest(page([],{report:{...report(scope).report,emptyStateTrusted:true,warning:null}}));a.equal(h.state().provisional.filter(row=>row.scopeURL===scope).length,0);
  await h.api.ingest(report(item().url,[item()]));await a.rejects(h.send({type:'clear-provisional'}),/Confirm/);
  await h.send({type:'clear-provisional',confirmed:true});a.equal(h.state().provisional.length,0);a.equal(Object.keys(h.state().items).length,1);
});
test('invalid scope, oversized or secret-bearing provisional payloads fail atomically; corrupt saved summaries block automation',async()=>{
  const h=harness(),before=h.state();
  for(const rows of [[candidate({scopeURL:'https://evil.test/'})],[candidate({courseId:'OTHER'})],[candidate({scopeURL:'https://classroom.google.com/u/0/c/A/m'})],[candidate({scopeURL:item().url})],[candidate({webhook:'SECRET'})],Array.from({length:51},()=>candidate())]){
    await a.rejects(h.api.ingest(page(rows)));a.deepEqual(h.state(),before);
  }
  const raw=h.state();raw.provisional=[{...candidate({scopeURL:'https://evil.test/'}),capturedAt:h.now()}];const broken=harness({state:raw,now:h.now()});
  a.equal((await broken.send({type:'state'})).recovery.blocked,true);a.deepEqual(broken.state(),raw);
});
test('JSON imports preview provisional counts and keep them unverified with explicit per-scope conflict policy',async()=>{
  const source=harness();await source.api.ingest(page([candidate()]));const data=await source.send({type:'export'}),text=JSON.stringify(data),target=harness();
  let preview=await target.send({type:'import-preview',text,policy:'keep'});a.equal(preview.provisional,1);a.equal(preview.total,0);
  await target.send({type:'import',text,policy:'keep',expectedRevision:preview.revision,confirmed:true});a.equal(target.state().provisional.length,1);a.equal(Object.keys(target.state().items).length,0);a.equal(target.state().queue.length,0);
  await target.api.ingest(page([candidate({title:'Current observation'})]));
  preview=await target.send({type:'import-preview',text,policy:'keep'});await target.send({type:'import',text,policy:'keep',expectedRevision:preview.revision,confirmed:true});a.equal(target.state().provisional[0].title,'Current observation');
  preview=await target.send({type:'import-preview',text,policy:'replace'});await target.send({type:'import',text,policy:'replace',expectedRevision:preview.revision,confirmed:true});a.equal(target.state().provisional[0].title,'PRIVATE PROVISIONAL');
  await target.send({type:'clear-history',confirmed:true});a.equal(target.state().provisional.length,0);
});
test('no-link summaries make coverage partial and cannot generate absence annotations or empty-course success',async()=>{
  const home='https://classroom.google.com/u/1/h/st',course={courseId:'A',name:'Math',url:scope,accountPath:'/u/1/'},h=harness({routes:{[home]:report(home,[],[course]),[scope]:page([candidate()])}});
  await h.api.ingest(report(item().url,[item()]));await h.api.scanAll();a.equal(h.state().scan.status,'partial');a.equal(h.state().courses.A.lastSuccessAt,undefined);a.equal(h.state().items['school|A|B'].notSeenAt,undefined);a.equal(h.state().provisional.length,1);
});
