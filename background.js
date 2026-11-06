/* One serialized state writer and one inactive scan tab; no per-page polling. */
const C=ClassroomCore;
const N=ClassroomNotifications;
const S=ClassroomState;
const B=globalThis.ClassroomBuild || {version:'unknown',id:'unstamped',protocol:0};
let chain=Promise.resolve(), scanning=false, delivering=false;
let requestSequence=0;
function buildStatus(){return {version:B.version,buildId:B.id,manifestVersion:browser.runtime.getManifest().version,
  compatible:B.version===browser.runtime.getManifest().version&&[C,N,S].every(module=>module.buildId===B.id)};}
function assertBackgroundBuild(){if(!buildStatus().compatible)throw new Error('Extension scripts are mixed or outdated. Reload Classroom Alerts in about:debugging, then reload open Classroom tabs.');}
function versionError(result,reason){
  const header=result?.handshake;
  const label=(v,fallback)=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(v)?v:fallback;
  const versions={expectedVersion:B.version,expectedBuild:B.id,actualVersion:label(header?.contentVersion,'unknown'),actualBuild:label(header?.buildId,'missing'),reason};
  const error=new Error(`Classroom scripts are outdated or mixed (content ${versions.actualVersion}, background ${B.version}). Reload the affected Classroom tab; after an extension update reload all open Classroom tabs, then scan again.`);
  error.code='SCRIPT_VERSION_MISMATCH';error.versions=versions;return error;
}
function validateHandshake(result,requestId){
  const header=result?.handshake;
  if(!header||typeof header!=='object')throw versionError(result,'missing-handshake');
  if(header.protocol!==B.protocol)throw versionError(result,'protocol-mismatch');
  if(header.buildId!==B.id||header.contentVersion!==B.version)throw versionError(result,'build-mismatch');
  if(header.coreBuild!==B.id||header.extractorBuild!==B.id)throw versionError(result,'module-mismatch');
  if(result.report&&result.report.version!==B.version)throw versionError(result,'report-version-mismatch');
  if(typeof header.requestId!=='string'||!header.requestId||header.requestId.length>100||(requestId!==undefined&&header.requestId!==requestId))throw versionError(result,'request-mismatch');
  if(result.error==='SCRIPT_VERSION_MISMATCH')throw versionError(result,'request-build-mismatch');
}
async function recordVersionIssue(tabId,error){
  await transaction(state=>{
    state.versionAlerts=[{tabId,at:Date.now(),...error.versions},...state.versionAlerts.filter(v=>v.tabId!==tabId)].slice(0,20);
    log(state,'content-script-version-mismatch',{tabId,reason:error.versions.reason});
  }).catch(()=>{});
}
function transaction(fn,write=true) {
  const run=chain.then(async()=>{
    const stored=await browser.storage.local.get('state');
    const loaded=S.load(stored.state),state=loaded.state;
    if(state.settings.verbose&&(!state.settings.verboseUntil||state.settings.verboseUntil<=Date.now()||state.settings.verboseUntil>Date.now()+3600000)){
      state.settings.verbose=false;state.settings.verboseUntil=0;delete state.report;
    }
    if(write)assertBackgroundBuild();
    if(write&&loaded.blocked)throw new Error('Saved data is invalid or incompatible. Automation is blocked; review Data recovery in Dashboard. Original storage is untouched.');
    N.prepare(state);
    const result=await fn(state,loaded);
    if(write){
      state.revision++;
      const checked=S.load(state);
      if(checked.blocked)throw new Error(`Changes failed validation (${checked.issues.join('; ')}); original storage is untouched.`);
      await browser.storage.local.set({state:checked.state});
    }
    return result;
  });
  chain=run.catch(()=>{}); return run;
}
function log(state,code,extra={}) { state.activity.unshift({at:Date.now(),code,...extra}); state.activity=state.activity.slice(0,100); }
function extensionPage(sender) { return sender.id===browser.runtime.id && !sender.tab && sender.url?.startsWith(browser.runtime.getURL('')); }
function validateReport(result,expected,requestId) {
  validateHandshake(result,requestId);
  if (!result || !Array.isArray(result.items) || result.items.length>500 || !Array.isArray(result.courses) || result.courses.length>200) throw new Error('Invalid page response');
  if(result.report?.accountPath!==expected)throw new Error('Classroom account changed. Confirm the account in Settings before scanning');
  for(const item of result.items) {
    const id=C.identity(item.url);
    if(!id || id.accountPath!==expected || typeof item.title!=='string' || item.title.length>400 || !['assignment','material','announcement'].includes(item.type)) throw new Error('Invalid item response');
  }
  if(result.provisional!==undefined){
    if(!Array.isArray(result.provisional)||result.provisional.length>50)throw new Error('Invalid provisional summaries');
    if(result.provisional.some(row=>row.scopeURL!==C.classroomURL(result.url)?.href))throw new Error('Provisional summary scope does not match scanned page');
    S.provisional(result.provisional.map(row=>({...row,capturedAt:Date.now()})),{accountPath:expected});
  }
  return result;
}
async function collect(tabId,settings,expand=false) {
  const requestId=`${Date.now()}-${++requestSequence}`;
  const result=await browser.tabs.sendMessage(tabId,{type:'collect',protocol:B.protocol,expectedBuild:B.id,requestId,
    settings:{accountPath:settings.accountPath,courseName:settings.courseName,verbose:settings.verbose,
      grades:settings.grades,announcements:settings.announcements,materials:settings.materials},expand});
  return validateReport(result,settings.accountPath,requestId);
}
async function readTab(tabId,settings,expand=false) {
  // Wait for injected content script readiness; bounded retries do not inspect authentication secrets.
  for(let attempt=0;attempt<12;attempt++) {
    if(settings.scanId && await transaction(state=>state.scan?.id!==settings.scanId || state.scan.cancel))throw new Error('Scan cancelled');
    const tab=await browser.tabs.get(tabId);
    if(tab.status==='complete' && (!C.classroomURL(tab.url) || !new URL(tab.url).pathname.startsWith(settings.accountPath)))throw new Error('Sign-in or account changed; open the intended Classroom account normally');
    if(tab.status==='complete' && (!settings.expectedURL || C.classroomURL(tab.url)?.pathname===C.classroomURL(settings.expectedURL)?.pathname)) {
      if(!C.classroomURL(tab.url)) throw new Error('Sign in to Classroom normally, then retry');
      if(!new URL(tab.url).pathname.startsWith(settings.accountPath))throw new Error('Unexpected Classroom account; confirm the selected account');
      try {
        const result=validateReport(await collect(tabId,settings,expand),settings.accountPath);
        if(settings.expectedURL && C.classroomURL(result.url)?.pathname!==C.classroomURL(settings.expectedURL)?.pathname)throw new Error('Waiting for target page navigation');
        return {...result,sourceTabId:tabId};
      }
      catch(error) { if(error.code==='SCRIPT_VERSION_MISMATCH'){await recordVersionIssue(tabId,error);throw error;}if(attempt===11) throw error; }
    }
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  throw new Error('Page readiness timed out');
}
async function ingest(state,result) {
  // A second gate protects every ingestion path, including future callers.
  validateReport(result,state.settings.accountPath);
  if(Number.isInteger(result.sourceTabId))state.versionAlerts=state.versionAlerts.filter(v=>v.tabId!==result.sourceTabId);
  for(const course of result.courses) {
    const id=C.identity(course.url);
    if(id && !id.itemId && id.accountPath===state.settings.accountPath && typeof course.name==='string')
      state.courses[course.courseId]={...state.courses[course.courseId],...course};
  }
  const allowedItems=result.items.filter(item=>item.type==='assignment'||item.type==='announcement'&&state.settings.announcements||item.type==='material'&&state.settings.materials);
  const changes=C.mergeItems(state,allowedItems);
  if(result.provisional&&(result.provisional.length||!result.report.truncated&&(result.items.length||result.report.emptyStateTrusted))){
    const incoming=S.provisional(result.provisional.map(row=>({...row,capturedAt:Date.now()})),state.settings);
    state.provisional=[...state.provisional.filter(row=>row.scopeURL!==result.url),...incoming].slice(-200);
  }
  N.events(state,changes);
  state.report=result.report;
  log(state,'scan-page',{items:result.items.length,changes:changes.length,route:result.report.route});
  return changes;
}
async function configureAlarms(settings) {
  await browser.alarms.clearAll();
  if(settings.profile && settings.accountPath) {
    browser.alarms.create('scan',{delayInMinutes:settings.intervalMinutes,periodInMinutes:settings.intervalMinutes});
    browser.alarms.create('reminders',{delayInMinutes:1,periodInMinutes:5});
  }
}
async function scanAll(mode='all',courseId=null) {
  if(scanning) return;
  scanning=true;
  let tabId=null;
  try {
    const settings=await transaction(state=>{
      if(!state.settings.profile || !/^\/u\/\d+\/$/.test(state.settings.accountPath)) throw new Error('Confirm your local account profile in Settings first');
      let courses=state.settings.courses;
      if(mode==='retry')courses=courses.filter(id=>state.scan?.failed?.some(f=>f.courseId===id)||state.courses[id]?.coverage==='partial');
      if(mode==='resume')courses=courses.filter(id=>state.scan?.courseIds?.includes(id) && !state.scan?.completedCourseIds?.includes(id));
      if(mode==='course')courses=courses.filter(id=>id===courseId);
      if(mode!=='all' && !courses.length)throw new Error('No matching selected courses to scan');
      state.monitoringStartedAt ||= Date.now();
      state.scan={id:Date.now(),status:'running',checked:0,total:courses.length,courseIds:courses,completedCourseIds:[],failed:[],stage:'Discovering courses',startedAt:Date.now(),cancel:false};
      return {...state.settings,courses,scanId:state.scan.id};
    });
    const tab=await browser.tabs.create({url:`https://classroom.google.com${settings.accountPath}h/st`,active:false}); tabId=tab.id;
    await transaction(state=>{state.scan.tabId=tabId;});
    const discovered=await readTab(tabId,{...settings,expectedURL:`https://classroom.google.com${settings.accountPath}h/st`});
    await transaction(state=>ingest(state,discovered));
    const selected=await transaction(state=>settings.courses.map(id=>state.courses[id]).filter(Boolean));
    const selectedMissing=settings.courses.filter(id=>!selected.some(c=>c.courseId===id));
    for(const id of selectedMissing) await transaction(state=>{state.scan.failed.push({courseId:id,error:'Course not discovered; check account and course selection'});});
    for(const course of selected) {
      const cancelled=await transaction(state=>Boolean(state.scan.cancel)); if(cancelled) break;
      try {
        await transaction(state=>{state.scan.stage=`Checking ${course.name}`;const stored=state.courses[course.courseId];stored.firstAttemptAt ||= stored.attemptedAt||Date.now();stored.attemptedAt=Date.now();});
        const current=await browser.tabs.get(tabId);
        if(!C.classroomURL(current.url)) throw new Error('Scanner tab left Classroom');
        await browser.tabs.update(tabId,{url:course.url,active:false});
        let result=await readTab(tabId,{...settings,courseName:course.name,expectedURL:course.url},true);
        // Classwork route is taken from the observed navigation, never an internal Google endpoint.
        const classworkId=C.identity(result.classworkURL);
        if(result.classworkURL && classworkId?.courseId===course.courseId && classworkId.accountPath===settings.accountPath) {
          await browser.tabs.update(tabId,{url:result.classworkURL,active:false});
          result=await readTab(tabId,{...settings,courseName:course.name,expectedURL:result.classworkURL},true);
        }
        const listingCheckedAt=Date.now();
        await transaction(state=>ingest(state,result));
        const staleDetails=await transaction(state=>result.items.filter(item=>{
          const known=state.items[C.itemKey(settings.profile,item)];
          return item.type==='assignment' && (!known?.lastVerifiedAt || Date.now()-known.lastVerifiedAt>6*3600000 ||
            (item.dueRaw && item.dueRaw!==known.dueRaw) || (item.status!=='unknown' && item.status!==known.status));
        }));
        const details=staleDetails.slice(0,30);
        let detailFailures=0,detailVisits=0;
        for(const item of details) {
          if(await transaction(state=>state.scan.cancel)) break;
          detailVisits++;
          try {
            await browser.tabs.update(tabId,{url:item.url,active:false});
            const detail=await readTab(tabId,{...settings,courseName:course.name,expectedURL:item.url});
            if(!detail.items.some(i=>i.itemId===item.itemId && i.source==='detail')) throw new Error('Detail layout not recognized');
            await transaction(state=>ingest(state,detail));
          } catch { detailFailures++; }
        }
        await transaction(state=>{
          const stored=state.courses[course.courseId];
          const partial=detailFailures || result.report.truncated || result.provisional?.length || result.items.length===0&&!result.report.emptyStateTrusted || staleDetails.length>detailVisits || state.scan.cancel;
          stored.detailsChecked=detailVisits;stored.detailsFailed=detailFailures;stored.detailsRemaining=Math.max(0,staleDetails.length-detailVisits);
          stored.coverage=partial ? 'partial' : result.report.emptyStateTrusted?'empty-with-visible-marker':'summary-and-bounded-details';
          stored.error=detailFailures ? `${detailFailures} detail pages failed` : staleDetails.length>details.length ? 'Detail budget exhausted; retry to continue remaining records' : state.scan.cancel ? 'Cancelled during course' : result.report.warning;
          if(!partial){
            stored.lastSuccessAt=Date.now();stored.notificationsReadyAt ||= Date.now();state.scan.completedCourseIds.push(course.courseId);
            const scope=C.identity(result.url),seen=new Set(result.items.map(item=>C.itemKey(settings.profile,item)));
            if(scope&&!scope.itemId&&scope.courseId===course.courseId&&scope.accountPath===state.settings.accountPath){
              for(const item of Object.values(state.items))if(item.courseId===course.courseId&&!seen.has(item.key)&&item.lastSeenAt<=listingCheckedAt&&
                (item.type==='assignment'||item.type==='announcement'&&state.settings.announcements||item.type==='material'&&state.settings.materials)){
                item.notSeenAt=listingCheckedAt;item.notSeenIn=scope.url;
              }
            }
          }
          else state.scan.failed.push({courseId:course.courseId,error:stored.error || 'Content loading/coverage limit reached'});
          state.scan.checked++;
        });
      } catch(error) {
        await transaction(state=>{state.scan.failed.push({courseId:course.courseId,error:error.message});state.courses[course.courseId].error=error.message;});
      }
    }
    await transaction(state=>{state.scan.status=state.scan.cancel?(state.scan.paused?'paused':'cancelled'):state.scan.failed.length?'partial':'finished';state.scan.finishedAt=Date.now();state.scan.stage='Idle';});
    await reminders();
  } catch(error) { await transaction(state=>{if(state.scan){state.scan.status=state.scan.cancel?(state.scan.paused?'paused':'cancelled'):'failed';state.scan.finishedAt=Date.now();state.scan.stage=error.message;}log(state,'scan-failed',{error:error.message});}).catch(()=>{}); }
  finally {
    scanning=false;
    if(tabId!==null) await browser.tabs.remove(tabId).catch(()=>{});
    await transaction(state=>{if(state.scan)delete state.scan.tabId;}).catch(()=>{});
  }
}
async function reminders() {
  if(!scanning)await transaction(state=>S.cleanup(state));
  await transaction(state=>N.schedule(state));
  await deliver();
}
async function deliver() {
  if(delivering)return;
  delivering=true;
  try {
    const pending=await transaction(state=>{
      N.prune(state);
       if(!C.webhookURL(state.settings.webhook)||C.quiet(state.settings)||state.deliveryNotBefore>Date.now())return null;
      const job=state.queue.find(q=>q.nextAt<=Date.now() && (q.kind==='test'||!state.lastDeliveryAt||Date.now()-state.lastDeliveryAt>=state.settings.notificationGapMinutes*60000));
      if(!job)return null;
      const texts=N.render(state,job),content=texts[job.part];
      if(typeof content!=='string'||content.length>2000){state.queue=state.queue.filter(q=>q.id!==job.id);log(state,'notification-render-rejected');return null;}
      return {job:{...job},content,partCount:texts.length,webhook:state.settings.webhook};
    });
    if(!pending)return;
    const {job,webhook,content,partCount}=pending;
    let failure=null,nextAt=0;
    try {
      // Do not hold the state writer while the network runs: cached UI stays responsive.
      const response=await fetch(webhook,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({content,allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(15000)});
      if(!response.ok) {
        if([401,403,404].includes(response.status)) {nextAt=Number.MAX_SAFE_INTEGER; throw new Error('Webhook unavailable; replace it in Settings');}
        const retry=Number(response.headers.get('retry-after'));
        if(response.status===429 && Number.isFinite(retry))nextAt=Math.min(Number.MAX_SAFE_INTEGER,Math.ceil(Date.now()+Math.max(1000,retry*1000)));
        throw new Error(`Discord returned HTTP ${response.status}`);
      }
    } catch(error) { failure=/^Discord returned HTTP \d{3}$/.test(error.message) || error.message==='Webhook unavailable; replace it in Settings'
      ? error.message : 'Discord network request failed or timed out; retry is queued'; }
    await transaction(state=>{
      const stored=state.queue.find(q=>q.id===job.id);
      if(state.settings.webhook!==webhook)return; // Destination/reset changed during the request.
      if(failure==='Discord returned HTTP 429'&&nextAt)state.deliveryNotBefore=Math.max(state.deliveryNotBefore,nextAt);
      if(!stored)return;
      if(!failure){
        if(stored.fingerprint!==job.fingerprint || stored.part!==job.part){state.lastDeliveryAt=Date.now();log(state,'notification-changed-during-delivery');return;}
        stored.part++;stored.attempts=0;stored.nextAt=Date.now();delete stored.error;
        if(stored.part>=partCount){state.delivered[job.id]=Date.now();if(job.kind==='catchup')for(const event of job.events)state.delivered[event.id]=Date.now();state.queue=state.queue.filter(q=>q.id!==job.id);}
        state.lastDeliveryAt=Date.now();state.deliveryError=null;
        state.delivered=Object.fromEntries(Object.entries(state.delivered).slice(-1000));log(state,'discord-delivered');
      }else{
        stored.attempts++;stored.error=failure;
        stored.nextAt=stored.attempts>=8?Number.MAX_SAFE_INTEGER:nextAt || Date.now()+Math.min(3600000,30000*2**Math.min(stored.attempts,7));
        state.deliveryError=failure;log(state,'discord-failed',{error:failure});
      }
    });
  } finally { delivering=false; }
}
browser.runtime.onMessage.addListener((message,sender)=>{
  if(!extensionPage(sender))return undefined;
  if(!message || typeof message.type!=='string')return Promise.reject(new Error('Invalid message'));
  if(message.type==='state')return transaction((state,loaded)=>({...state,build:buildStatus(),settings:{...state.settings,webhook:state.settings.webhook?'configured':''},plan:C.plan(state),
    recovery:{blocked:loaded.blocked,issues:loaded.issues,migrated:loaded.migrated,validTasks:Object.keys(state.items).length,validCourses:Object.keys(state.courses).length}}),false);
  if(message.type==='preview-discord')return transaction((state,loaded)=>{if(loaded.blocked)throw new Error('Review Data recovery before previewing messages');return N.preview(state);},false);
  if(message.type==='settings')return transaction(async state=>{
    const v=message.value;
    if(!v || typeof v.profile!=='string' || !v.profile.trim() || v.profile.length>80 || !/^\/u\/\d+\/$/.test(v.accountPath))throw new Error('Enter a local profile label and account number');
    try{C.zonedParts(new Date(),v.timezone);}catch{throw new Error('Use a valid IANA timezone, such as America/Halifax');}
    if(!Array.isArray(v.courses)||v.courses.length>200||v.courses.some(id=>typeof id!=='string'||id.length>200))throw new Error('Invalid selected courses');
    if(v.webhook && v.webhook!=='configured' && !C.webhookURL(v.webhook))throw new Error('Invalid Discord webhook URL');
    if(!Number.isInteger(v.intervalMinutes)||v.intervalMinutes<15||v.intervalMinutes>1440)throw new Error('Scan interval must be 15–1440 minutes');
    for(const k of ['digestHour','quietStart','quietEnd'])if(!Number.isInteger(v[k])||v[k]<0||v[k]>23)throw new Error('Hours must be 0–23');
    const notificationSettings=N.settings(v,state.settings);
    const retentionSettings=S.retention({...state.settings,...v});
    if(retentionSettings.completedRetentionDays>0&&(!state.settings.completedRetentionDays||retentionSettings.completedRetentionDays<state.settings.completedRetentionDays)&&message.confirmRetention!==true)throw new Error('Confirm enabling or shortening completed-task retention');
    if(state.settings.profile && (state.settings.profile!==v.profile || state.settings.accountPath!==v.accountPath))throw new Error('Reset local data before switching profile/account to avoid mixing school records');
    const webhook=v.webhook==='configured'?state.settings.webhook:v.webhook;
    const previousTimezone=state.settings.timezone;
    const verboseUntil=v.verbose?(state.settings.verbose?state.settings.verboseUntil:Date.now()+3600000):0;
    if(JSON.stringify(v.courses)!==JSON.stringify(state.settings.courses))state.monitoringStartedAt=Date.now();
    if(webhook!==state.settings.webhook){state.queue=[];state.deliveryError=null;state.deliveryNotBefore=0;log(state,'discord-destination-changed',{pendingCleared:true});}
    state.settings={...state.settings,profile:v.profile.trim(),accountPath:v.accountPath,timezone:v.timezone,courses:v.courses,webhook,
      intervalMinutes:v.intervalMinutes,digestHour:v.digestHour,quietStart:v.quietStart,quietEnd:v.quietEnd,
      verbose:Boolean(v.verbose),verboseUntil,announcements:Boolean(v.announcements),materials:Boolean(v.materials),grades:Boolean(v.grades),...notificationSettings,...retentionSettings};
    delete state.notificationWarning;
    if(previousTimezone!==state.settings.timezone)for(const item of Object.values(state.items))if(item.dueRaw!==undefined)item.due=C.dueDate(item.dueRaw,state.settings.timezone,item.lastVerifiedAt||item.firstSeenAt||Date.now());
    N.prune(state);
    if(!state.settings.verbose)delete state.report;
    if(!state.settings.grades)for(const item of Object.values(state.items)){delete item.grade;delete item.gradeHistory;}
    if(!state.settings.materials)for(const item of Object.values(state.items))delete item.materials;
    await configureAlarms(state.settings);return {ok:true};
  });
  if(message.type==='page')return (async()=>{
    const tab=Number.isInteger(message.tabId)?await browser.tabs.get(message.tabId):(await browser.tabs.query({active:true,currentWindow:true}))[0];
    if(!C.classroomURL(tab?.url))throw new Error('Open a signed-in Classroom tab, then use Scan this page');
    const settings=await transaction(state=>state.settings);
    if(!settings.accountPath || !settings.profile)throw new Error('Confirm your profile/account in Settings first');
    const result=await readTab(tab.id,settings);
    await transaction(state=>ingest(state,result));return result.report;
  })();
  if(message.type==='scan'){
    if(message.mode && !['all','retry','resume','course'].includes(message.mode))return Promise.reject(new Error('Invalid scan scope'));
    return transaction((state,loaded)=>{assertBackgroundBuild();if(loaded.blocked)throw new Error('Automation blocked by invalid saved data; review Data recovery');if(message.mode==='course'&&!state.settings.courses.includes(message.courseId))throw new Error('Select this course and save Settings before scanning it');return true;},false).then(()=>{scanAll(message.mode || 'all',message.courseId);return {ok:true};});
  }
  if(message.type==='scan-current-course')return (async()=>{
    const [tab]=await browser.tabs.query({active:true,currentWindow:true}),id=C.identity(tab?.url);
    await transaction((state,loaded)=>{assertBackgroundBuild();if(loaded.blocked)throw new Error('Automation blocked; review Data recovery');if(!id||id.accountPath!==state.settings.accountPath)throw new Error('Open a Classroom course page in the selected account');if(!state.settings.courses.includes(id.courseId))throw new Error('Select this course and save Settings first');},false);
    scanAll('course',id.courseId);return {ok:true};
  })();
  if(message.type==='cancel'||message.type==='pause')return transaction(state=>{if(state.scan){state.scan.cancel=true;state.scan.paused=message.type==='pause';}});
  if(message.type==='test-discord')return transaction(state=>{if(!C.webhookURL(state.settings.webhook))throw new Error('Save a valid webhook first');N.enqueue(state,`test|${Date.now()}`,{kind:'test'});return {ok:true};}).then(()=>deliver());
  if(message.type==='retry-delivery')return transaction(state=>{N.prune(state);for(const q of state.queue){q.nextAt=Date.now();q.attempts=0;}}).then(()=>deliver());
  if(message.type==='local')return transaction(state=>{
    const item=state.items[message.key],v=message.value;if(!item||!v)throw new Error('Unknown task');
    if(!['not-started','in-progress','complete'].includes(v.status)||typeof v.note!=='string'||v.note.length>1000)throw new Error('Invalid local task edits');
    if(v.minutes!==null&&(!Number.isInteger(v.minutes)||v.minutes<1||v.minutes>10000))throw new Error('Effort must be 1–10000 minutes');
    if(v.pinToday!==undefined&&typeof v.pinToday!=='boolean')throw new Error('Invalid plan pin');
    if(!Number.isSafeInteger(v.snoozeUntil)||v.snoozeUntil<0||v.snoozeUntil>Date.now()+30*86400000)throw new Error('Snooze must be a valid time within 30 days');
    item.local={status:v.status,note:v.note,minutes:v.minutes,snoozeUntil:v.snoozeUntil,
      pinnedDay:v.pinToday===undefined?item.local.pinnedDay||'':v.pinToday?C.schoolDay(state.settings.timezone):'',
      completedAt:v.status==='complete'?(item.local.completedAt || Date.now()):0};
    N.prune(state);
  });
  if(message.type==='clear-diagnostics')return transaction(state=>{delete state.report;state.activity=[];});
  if(message.type==='clear-provisional')return transaction(state=>{if(scanning)throw new Error('Wait for scanning to stop before clearing provisional snapshots');if(message.confirmed!==true)throw new Error('Confirm clearing provisional snapshots');state.provisional=[];});
  if(message.type==='export')return transaction(state=>S.exportData(state),false);
  if(message.type==='export-csv')return transaction(state=>S.exportCSV(state),false);
  if(message.type==='import-preview')return transaction(state=>S.importPlan(state,message.text,message.policy).summary,false);
  if(message.type==='import')return transaction(state=>{if(scanning||delivering)throw new Error('Wait for scanning/delivery to stop before importing');if(message.confirmed!==true)throw new Error('Confirm the import first');const summary=S.applyImport(state,message.text,message.policy,message.expectedRevision);N.prune(state);log(state,'tasks-imported',{added:summary.added,replaced:summary.replaced});return summary;});
  if(message.type==='retention')return transaction(state=>{const value=S.retention(message.value);if(value.completedRetentionDays>0&&(!state.settings.completedRetentionDays||value.completedRetentionDays<state.settings.completedRetentionDays)&&message.confirmed!==true)throw new Error('Confirm enabling or shortening completed-task retention');Object.assign(state.settings,value);log(state,'retention-policy-saved');});
  if(message.type==='cleanup-preview')return transaction(state=>({...S.cleanupPlan(state),revision:state.revision}),false);
  if(message.type==='cleanup')return transaction(state=>{if(scanning||delivering)throw new Error('Wait for scanning/delivery to stop before deleting history');if(message.confirmed!==true||message.expectedRevision!==state.revision)throw new Error('Preview and confirm cleanup again');const result=S.cleanup(state,true);log(state,'retention-cleanup',result);return result;});
  if(message.type==='delete-item')return transaction(state=>{if(scanning||delivering)throw new Error('Wait for scanning/delivery to stop before deleting tasks');if(message.confirmed!==true||!Object.hasOwn(state.items,message.key))throw new Error('Confirm a known task deletion');S.deleteKeys(state,[message.key]);log(state,'task-deleted');});
  if(message.type==='clear-history')return transaction(state=>{if(scanning||delivering)throw new Error('Wait for scanning/delivery to stop before clearing history');if(message.confirmed!==true)throw new Error('Confirm clearing task history');S.deleteKeys(state,Object.keys(state.items));state.provisional=[];state.queue=[];state.delivered={};state.scan=null;for(const course of Object.values(state.courses)){delete course.notificationsReadyAt;delete course.lastSuccessAt;course.coverage='not-scanned';}log(state,'task-history-cleared');});
  if(message.type==='reset'||message.type==='recover')return (async()=>{
    if(message.confirmed!==true)throw new Error('Explicit confirmation required');if(scanning||delivering)throw new Error('Wait for scanning/delivery to stop first');
    // Serialize recovery too, but do not route it through a blocked normal write transaction.
    const action=chain.then(async()=>{
      const stored=await browser.storage.local.get('state'),loaded=S.load(stored.state);
      if(message.type==='recover'){
        if(!loaded.blocked||![1,2].includes(stored.state?.schemaVersion))throw new Error('Only supported-schema damaged data can be recovered; incompatible data stays untouched');
        const state=loaded.state;
        state.queue=[];state.delivered={};state.scan=null;state.settings.webhook='';state.settings.courses=[];
        for(const item of Object.values(state.items)){item.source='imported';item.imported=true;item.verificationNeeded=true;item.lastVerifiedAt=0;item.status='unknown';item.due=C.dueDate(item.dueRaw,state.settings.timezone,item.firstSeenAt||item.lastSeenAt||Date.now());}
        for(const course of Object.values(state.courses))delete course.notificationsReadyAt;
        state.revision++;const checked=S.load(state);if(checked.blocked)throw new Error('Validated recovery failed; original data is untouched');
        await browser.storage.local.set({recoveryBackup:{createdAt:Date.now(),state:stored.state},state:checked.state});
      }else await browser.storage.local.set({state:C.emptyState()});
      await browser.alarms.clearAll();return {ok:true};
    });chain=action.catch(()=>{});return action;
  })();
  if(message.type==='delete-recovery-backup')return (async()=>{if(message.confirmed!==true)throw new Error('Confirm backup deletion');await browser.storage.local.remove('recoveryBackup');return {ok:true};})();
  if(message.type==='focus-version-tab')return (async()=>{
    const known=await transaction(state=>state.versionAlerts.some(v=>v.tabId===message.tabId),false);
    if(!known)throw new Error('No version warning for this tab');
    let tab;try{tab=await browser.tabs.get(message.tabId);}catch{throw new Error('That tab has closed. Open or reload Classroom and scan again.');}
    const settings=await transaction(state=>state.settings,false),url=C.classroomURL(tab.url);
    if(!url?.pathname.startsWith(settings.accountPath))throw new Error('This is no longer the affected Classroom account tab');
    await browser.tabs.update(tab.id,{active:true});return {ok:true};
  })();
  return Promise.reject(new Error('Unsupported request'));
});
browser.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='scan')scanAll();if(alarm.name==='reminders')reminders().catch(()=>{});});
async function startup(){try{await transaction(async state=>{const dropped=N.prune(state);if(dropped)log(state,'notification-queue-pruned',{dropped});if(state.scan?.status==='running'){state.scan.status='interrupted';state.scan.stage='Interrupted by restart; retry scan';delete state.scan.tabId;}S.cleanup(state);await configureAlarms(state.settings);});}catch{await browser.alarms.clearAll();}}
browser.runtime.onStartup.addListener(startup);
browser.runtime.onInstalled.addListener(startup);
