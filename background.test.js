const {test}=require('node:test');
const a=require('node:assert/strict');
const {harness:makeHarness}=require('./test-harness.cjs');
function harness(){
  const h=makeHarness();h.mutate(s=>{s.settings.webhook='https://discord.com/api/webhooks/123/test';});return h;
}
test('background rejects page-origin privileged requests and hides webhook in UI state',async()=>{
  const h=harness();a.equal(h.send({type:'reset'},{id:'test',url:'https://classroom.google.com/',tab:{id:1}}),undefined);
  const result=await h.send({type:'state'});a.equal(result.settings.webhook,'configured');
});
test('explicit Discord test suppresses mentions and persists acknowledgement',async()=>{
  const h=harness();await h.send({type:'test-discord'});
  a.equal(h.requests.length,1);const payload=JSON.parse(h.requests[0].init.body);
  a.deepEqual(payload.allowed_mentions,{parse:[]});a.equal(h.state().queue.length,0);a.ok(h.state().lastDeliveryAt);
});
test('settings reject arbitrary destinations and out-of-range polling',async()=>{
  const h=harness(),v={...h.state().settings,webhook:'https://evil.test/'};
  await a.rejects(h.send({type:'settings',value:v}),/Invalid Discord/);
  await a.rejects(h.send({type:'settings',value:{...v,webhook:'',intervalMinutes:1}}),/15–1440/);
});
