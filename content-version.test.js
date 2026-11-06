// Browser execution of the actual content script, bridged to the real coordinator's mocks.
const {test}=require('node:test');
const a=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
const Build=require('./build');
const {harness}=require('./test-harness.cjs');
const home='https://classroom.google.com/u/1/h/st';
async function fixture(){
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/home/rayyan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
  const page=await browser.newPage();
  await page.route('https://classroom.google.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Fixture - Classroom</title><main><a href="https://classroom.google.com/u/1/c/A">Math</a><article><a href="https://classroom.google.com/u/1/c/A/a/B/details">Fixture homework</a><p>Due Nov 9, 9:02 AM</p></article></main>'}));
  await page.addInitScript(version=>{
    globalThis.browser={runtime:{id:'test',getManifest:()=>({version}),onMessage:{addListener:fn=>globalThis.contentListener=fn}}};
    globalThis.domQueries=0;const query=document.querySelectorAll.bind(document);document.querySelectorAll=(...args)=>{globalThis.domQueries++;return query(...args);};
    globalThis.scrollCalls=0;window.scrollTo=()=>globalThis.scrollCalls++;
  },Build.version);
  await page.goto(home);
  return {browser,page,async load(old=false,mixed=false){
    await page.addScriptTag({path:path.join(__dirname,'build.js')});
    if(old)await page.evaluate(()=>{globalThis.ClassroomBuild=Object.freeze({version:'0.5.0',id:'0.5.0-r1',protocol:1});});
    for(const file of ['core.js','extractor.js'])await page.addScriptTag({path:path.join(__dirname,file)});
    if(mixed)await page.evaluate(()=>{globalThis.ClassroomExtractor.buildId='old-extractor';});
    await page.addScriptTag({path:path.join(__dirname,'content.js')});
    await page.evaluate(()=>{globalThis.domQueries=0;globalThis.scrollCalls=0;});
  }};
}
test('old scripts reject the current build even when runtime.getManifest reports the current extension; reload repairs the end-to-end flow',async()=>{
  const f=await fixture();
  try{
    await f.load(true);
    const h=harness({now:Date.now(),routes:{[home]:async(tab,message)=>f.page.evaluate(message=>globalThis.contentListener(message,{id:'test'}),message)}});
    const tab=await h.browser.tabs.create({url:home,active:true});
    a.equal(await f.page.evaluate(()=>browser.runtime.getManifest().version),Build.version);
    await a.rejects(h.send({type:'page',tabId:tab.id}),/content 0.5.0/);
    a.equal(await f.page.evaluate(()=>globalThis.domQueries),0);a.equal(await f.page.evaluate(()=>globalThis.scrollCalls),0);
    a.equal(Object.keys(h.state().items).length,0);a.equal(h.state().versionAlerts[0].actualVersion,'0.5.0');
    // Replacing globals cannot relabel the listener's captured old module references.
    await f.page.addScriptTag({path:path.join(__dirname,'build.js')});
    await a.rejects(h.send({type:'page',tabId:tab.id}),/content 0.5.0/);
    await f.page.reload();await f.load();await h.send({type:'page',tabId:tab.id});
    a.equal(h.state().versionAlerts.length,0);a.equal(h.state().items['school|A|B'].title,'Fixture homework');a.equal(h.state().report.version,Build.version);
  }finally{await f.browser.close();}
});
test('mixed extractor or incompatible protocol rejects collection before DOM access and scrolling',async()=>{
  const f=await fixture();
  try{
    await f.load(false,true);
    const request={type:'collect',protocol:Build.protocol,expectedBuild:Build.id,requestId:'test-current',expand:true,settings:{accountPath:'/u/1/'}};
    let result=await f.page.evaluate(message=>globalThis.contentListener(message,{id:'test'}),request);
    a.equal(result.error,'SCRIPT_VERSION_MISMATCH');a.equal(result.items,undefined);a.equal(result.handshake.extractorBuild,'old-extractor');
    a.equal(await f.page.evaluate(()=>globalThis.domQueries),0);a.equal(await f.page.evaluate(()=>globalThis.scrollCalls),0);
    await f.page.reload();await f.load();
    result=await f.page.evaluate(message=>globalThis.contentListener(message,{id:'test'}),{...request,protocol:99});
    a.equal(result.error,'SCRIPT_VERSION_MISMATCH');a.equal(await f.page.evaluate(()=>globalThis.domQueries),0);a.equal(await f.page.evaluate(()=>globalThis.scrollCalls),0);
  }finally{await f.browser.close();}
});
test('controlled read-only expansion never clicks submit/comment/form/unknown controls and is capped',async()=>{
  const f=await fixture();
  try{
    await f.load();await f.page.setContent(`<main><article data-assignment-id="B"><a href="https://classroom.google.com/u/1/c/A/a/B/details">Task</a>
      <button id="safe" aria-expanded="false" aria-controls="panel">Show details</button><div id="panel" hidden>Due Nov 9, 9:02 AM</div>
      <button id="submit" aria-expanded="false" aria-controls="submit-panel">Mark as done</button><div id="submit-panel"></div>
      <button id="comments" aria-expanded="false" aria-controls="comments-panel">Show details</button><div id="comments-panel"></div>
      <form><button id="form" aria-expanded="false" aria-controls="form-panel">Show details</button><div id="form-panel"></div></form>
      <button id="missing" aria-expanded="false" aria-controls="absent">Show details</button></article></main>`);
    await f.page.evaluate(()=>{globalThis.clicks=[];for(const button of document.querySelectorAll('button'))button.addEventListener('click',e=>{e.preventDefault();globalThis.clicks.push(button.id);if(button.id==='safe'){document.getElementById('panel').hidden=false;button.setAttribute('aria-expanded','true');}});});
    const request={type:'collect',protocol:Build.protocol,expectedBuild:Build.id,requestId:'safe-expansion',expand:true,settings:{accountPath:'/u/1/'}};
    let result=await f.page.evaluate(message=>contentListener(message,{id:'test'}),request);
    a.deepEqual(await f.page.evaluate(()=>globalThis.clicks),['safe']);a.equal(result.report.expansion.expanded,1);a.equal(result.report.expansion.skipped,4);
    await f.page.setContent('<main>'+Array.from({length:10},(_,i)=>`<article><a href="https://classroom.google.com/u/1/c/A/a/B${i}/details">Task ${i}</a><button aria-expanded="false" aria-controls="panel${i}">Show details</button><div id="panel${i}" hidden>Body</div></article>`).join('')+'</main>');
    result=await f.page.evaluate(message=>contentListener(message,{id:'test'}),request);a.equal(result.report.expansion.expanded,8);a.equal(result.report.expansion.budgetExhausted,true);a.equal(result.report.truncated,true);
  }finally{await f.browser.close();}
});
