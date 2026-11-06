const {test}=require('node:test');
const a=require('node:assert/strict');
const fs=require('node:fs');
const Build=require('./build');
const {harness,report,item}=require('./test-harness.cjs');
const home='https://classroom.google.com/u/1/h/st';
const course={courseId:'A',name:'Math',url:'https://classroom.google.com/u/1/c/A',accountPath:'/u/1/'};
async function open(h){return h.browser.tabs.create({url:home,active:true});}

test('legacy responses are rejected even when getManifest-style report version claims the current install',async()=>{
  const stale=report(home,[item('STALE')],[course]);delete stale.handshake;
  const h=harness({routes:{[home]:stale}}),tab=await open(h);
  const before=h.state();await a.rejects(h.send({type:'page',tabId:tab.id}),/Reload the affected Classroom tab/);
  a.deepEqual(h.state().items,before.items);a.deepEqual(h.state().courses,before.courses);a.deepEqual(h.state().queue,[]);a.equal(h.requests.length,0);
  a.equal(h.operations.filter(o=>o.kind==='collect').length,1); // No futile readiness retries for a known stale build.
  a.equal(h.state().versionAlerts[0].reason,'missing-handshake');a.equal(h.state().versionAlerts[0].expectedBuild,Build.id);
});
test('build, module, protocol, report-version and nonce mismatches cannot reach ingestion',async()=>{
  for(const [field,value,reason]of [['buildId','old-build','build-mismatch'],['contentVersion','0.5.0','build-mismatch'],['coreBuild','unstamped','module-mismatch'],['extractorBuild','old','module-mismatch'],['protocol',99,'protocol-mismatch'],['requestId','replayed-request','request-mismatch'],['report.version','0.5.0','report-version-mismatch']]){
    const response=report(home,[item('STALE')],[course]);
    if(field==='report.version')response.report.version=value;else response.handshake[field]=value;
    const h=harness({routes:{[home]:response}}),tab=await open(h);
    await a.rejects(h.send({type:'page',tabId:tab.id}),/Reload/);
    a.equal(Object.keys(h.state().items).length,0,field);a.equal(Object.keys(h.state().courses).length,0,field);a.equal(h.state().versionAlerts[0].reason,reason,field);
    a.equal(h.operations.filter(o=>o.kind==='collect').length,1,field);
  }
});
test('ingestion itself rejects unstamped data without changing records or queue',async()=>{
  const h=harness(),fresh=report(home,[item('GOOD')],[course]);await h.api.ingest(fresh);const before=h.state();
  const stale=report(home,[item('BAD')],[course]);delete stale.handshake;
  await a.rejects(h.api.ingest(stale),/outdated or mixed/);a.deepEqual(h.state(),before);
});
test('successful reload clears only the successfully rechecked tab warning',async()=>{
  const stale=report(home);delete stale.handshake;
  const h=harness({routes:{[home]:stale}}),first=await open(h),second=await open(h);
  await a.rejects(h.send({type:'page',tabId:first.id}));await a.rejects(h.send({type:'page',tabId:second.id}));a.equal(h.state().versionAlerts.length,2);
  h.routes[home]=report(home,[item('GOOD')],[course]);await h.send({type:'page',tabId:first.id});
  a.ok(h.state().items['school|A|GOOD']);a.equal(h.state().versionAlerts.length,1);a.equal(h.state().versionAlerts[0].tabId,second.id);
});
test('scan records a partial failure for stale course scripts, never ingests their assignments, and closes its scanner tab',async()=>{
  const stale=report(course.url,[item('BAD')]);delete stale.handshake;
  const h=harness({routes:{[home]:report(home,[],[course]),[course.url]:stale}});await h.api.scanAll();
  a.equal(h.state().scan.status,'partial');a.match(h.state().scan.failed[0].error,/Reload/);a.equal(Object.keys(h.state().items).length,0);a.equal(h.tabs.size,0);a.equal(h.state().versionAlerts.length,1);
});
test('mixed background/manifest installation blocks automation but exposes a read-only reload instruction',async()=>{
  const h=harness({manifestVersion:'9.9.9'}),before=h.state();await h.startup();
  await a.rejects(h.send({type:'scan'}),/Reload Classroom Alerts/);await a.rejects(h.send({type:'test-discord'}),/mixed or outdated/);
  const view=await h.send({type:'state'});a.equal(view.build.compatible,false);a.equal(view.build.version,Build.version);a.equal(view.build.manifestVersion,'9.9.9');
  a.deepEqual(h.state(),before);a.equal(h.requests.length,0);a.equal(h.alarms.size,0);
});
test('show-affected-tab action only focuses known Classroom warnings and never navigates or reloads automatically',async()=>{
  const stale=report(home);delete stale.handshake;const h=harness({routes:{[home]:stale}}),tab=await open(h);
  await a.rejects(h.send({type:'page',tabId:tab.id}));await a.rejects(h.send({type:'focus-version-tab',tabId:999}),/No version warning/);
  await h.send({type:'focus-version-tab',tabId:tab.id});const focus=h.operations.filter(o=>o.kind==='update');a.equal(focus.length,1);a.equal(focus[0].active,true);a.equal(focus[0].url,undefined);
  await h.browser.tabs.update(tab.id,{url:'https://example.test/'});await a.rejects(h.send({type:'focus-version-tab',tabId:tab.id}),/no longer/);
  await h.browser.tabs.remove(tab.id);await a.rejects(h.send({type:'focus-version-tab',tabId:tab.id}),/tab has closed/);
});
test('manifest loads build metadata before every stamped module and matches the release version',()=>{
  const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
  a.equal(manifest.version,Build.version);a.equal(manifest.background.scripts[0],'build.js');a.equal(manifest.content_scripts[0].js[0],'build.js');a.equal(Build.protocol,1);
});
