const {test}=require('node:test');
const a=require('node:assert/strict');
const {harness,report,item}=require('./test-harness.cjs');
const home='https://classroom.google.com/u/1/h/st';
const announcement=item('POST','A',{type:'announcement',url:'https://classroom.google.com/u/1/c/A/p/POST',instructions:'PRIVATE ANNOUNCEMENT BODY'});
const material=item('MATERIAL','A',{type:'material',url:'https://classroom.google.com/u/1/c/A/m/MATERIAL/details',instructions:'PRIVATE MATERIAL BODY'});
const task=item('B','A',{source:'detail',grade:'7 / 10 points',instructions:'PRIVATE ASSIGNMENT INSTRUCTIONS',materials:[{title:'PRIVATE SLIDES',url:'https://docs.google.com/presentation/d/fixture'}]});
test('academic categories are enforced by background settings, not only content-script filtering',async()=>{
  const h=harness();await h.api.ingest(report(home,[announcement,material,task]));
  a.equal(Object.keys(h.state().items).length,1);a.equal(h.state().items['school|A|B'].grade,undefined);a.equal(h.state().items['school|A|B'].gradeHistory,undefined);
  await h.send({type:'settings',value:{...h.state().settings,announcements:true,materials:true,grades:true}});
  await h.api.ingest(report(home,[announcement,material,task]));
  a.equal(Object.keys(h.state().items).length,3);a.equal(h.state().items['school|A|B'].grade,'7 / 10 points');a.equal(h.state().items['school|A|B'].materials.length,1);
});
test('grade history is bounded, duplicate snapshots do not grow it, and disabling grades clears history',async()=>{
  const h=harness();await h.send({type:'settings',value:{...h.state().settings,grades:true}});
  for(let i=0;i<15;i++){h.advance(1000);await h.api.ingest(report(task.url,[{...task,grade:`${i} / 20 points`,materials:[]} ]));}
  a.equal(h.state().items['school|A|B'].gradeHistory.length,10);
  await h.api.ingest(report(task.url,[{...task,grade:'14 / 20 points',materials:[]} ]));a.equal(h.state().items['school|A|B'].gradeHistory.length,10);
  await h.api.ingest(report(task.url,[{...task,grade:null,materials:[]} ]));a.equal(h.state().items['school|A|B'].grade,undefined);a.equal(h.state().items['school|A|B'].gradeHistory.length,10);
  await h.send({type:'settings',value:{...h.state().settings,grades:false}});
  a.equal(h.state().items['school|A|B'].grade,undefined);a.equal(h.state().items['school|A|B'].gradeHistory,undefined);
});
test('academic text, resource titles and grade snapshots never enter Discord digests',async()=>{
  const h=harness();await h.send({type:'settings',value:{...h.state().settings,announcements:true,materials:true,grades:true,
    webhook:'https://discord.com/api/webhooks/123/test',digestHour:0,remindersEnabled:false,notifyNew:false,notifyDeadline:false}});
  await h.api.ingest(report(home,[announcement,material,task]));await h.api.reminders();
  a.equal(h.requests.length,1);const content=JSON.parse(h.requests[0].init.body).content;
  a.ok(content.includes('Task B'));a.ok(!content.includes('PRIVATE'));a.ok(!content.includes('7 / 10'));a.ok(!content.includes('Task POST'));a.ok(!content.includes('Task MATERIAL'));
});
test('local Discord preview matches delivered digest text without queuing, writing or leaking academic content',async()=>{
  const h=harness();await h.send({type:'settings',value:{...h.state().settings,announcements:true,materials:true,grades:true,
    webhook:'https://discord.com/api/webhooks/123/SECRET',digestHour:0,remindersEnabled:false,notifyNew:false,notifyDeadline:false}});
  await h.api.ingest(report(home,[announcement,material,task]));const before=h.state(),writes=h.operations.filter(o=>o.kind==='storage-write').length;
  const preview=await h.send({type:'preview-discord'});a.deepEqual(h.state(),before);a.equal(h.operations.filter(o=>o.kind==='storage-write').length,writes);a.equal(h.requests.length,0);
  a.ok(!JSON.stringify(preview).includes('PRIVATE'));a.ok(!JSON.stringify(preview).includes('SECRET'));a.ok(!JSON.stringify(preview).includes('7 / 10'));
  await h.api.reminders();a.deepEqual(h.requests.map(request=>JSON.parse(request.init.body).content),Array.from(preview.digest));
});
