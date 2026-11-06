/* Versioned local data boundary. Invalid storage is never silently overwritten. */
(() => {
  const C=globalThis.ClassroomCore,N=globalThis.ClassroomNotifications;
  const VERSION=2,MAX_IMPORT=2*1024*1024,MAX_ITEMS=5000;
  const reserved=new Set(['__proto__','constructor','prototype']);
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.prototype.toString.call(v)==='[object Object]';
  function check(ok,code){if(!ok)throw Error(code);}
  function text(v,max,empty=true){check(typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0),'invalid text');return v;}
  function number(v,min=0,max=Number.MAX_SAFE_INTEGER){check(Number.isSafeInteger(v)&&v>=min&&v<=max,'invalid number');return v;}
  function timestamp(v){return number(v,0,Math.min(8640000000000000,Date.now()+60000));}
  function dict(v,max){check(record(v)&&Object.keys(v).length<=max,'invalid record collection');check(Object.keys(v).every(k=>!reserved.has(k)),'unsafe record key');return v;}
  function boolean(v){check(typeof v==='boolean','invalid boolean');return v;}
  function bounded(v,max){const s=JSON.stringify(v);check(typeof s==='string'&&s.length<=max,'oversized metadata');return JSON.parse(s,(k,value)=>{check(!reserved.has(k),'unsafe metadata key');return value;});}
  function settings(raw){
    check(record(raw),'invalid settings');const value={...C.defaults,...raw};
    text(value.profile,80);check(value.accountPath===''||/^\/u\/\d{1,3}\/$/.test(value.accountPath),'invalid account context');
    check(Boolean(value.profile)===Boolean(value.accountPath),'incomplete profile context');
    text(value.timezone,100,false);C.zonedParts(new Date(),value.timezone);
    check(Array.isArray(value.courses)&&value.courses.length<=200&&value.courses.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(id)&&!reserved.has(id)),'invalid selected courses');
    check(new Set(value.courses).size===value.courses.length,'duplicate selected courses');
    check(value.webhook===''||C.webhookURL(value.webhook)===value.webhook,'invalid saved webhook');
    number(value.intervalMinutes,15,1440);for(const k of ['digestHour','quietStart','quietEnd'])number(value[k],0,23);
    for(const k of ['verbose','announcements','materials','grades','shareGrades'])boolean(value[k]);
    number(value.verboseUntil);
    Object.assign(value,N.settings(value,C.defaults));
    number(value.completedRetentionDays,0,3650);number(value.diagnosticRetentionHours,1,720);number(value.historyRetentionDays,1,365);
    check(Object.keys(raw).every(k=>Object.hasOwn(C.defaults,k)),'unsupported settings field');
    return {...value,courses:[...value.courses]};
  }
  function provisional(raw,s){
    check(Array.isArray(raw)&&raw.length<=200,'invalid provisional summaries');
    return raw.map(row=>{
      check(record(row),'invalid provisional summary');const scope=C.identity(row.scopeURL);
      check(scope&&!scope.itemId&&scope.courseId===row.courseId&&scope.accountPath===s.accountPath&&scope.url===row.scopeURL,'invalid provisional scope');
      check(Object.keys(row).every(k=>['courseId','scopeURL','title','dueRaw','capturedAt'].includes(k)),'unsupported provisional field');
      return {courseId:scope.courseId,scopeURL:scope.url,title:text(row.title,300,false),dueRaw:text(row.dueRaw,200),capturedAt:timestamp(row.capturedAt)};
    });
  }
  function course(raw,id,s){
    check(record(raw),'invalid course');const identity=C.identity(raw.url);
    check(identity&&!identity.itemId&&identity.courseId===id&&raw.courseId===id&&identity.accountPath===s.accountPath,'course identity mismatch');
    const out={courseId:id,name:text(raw.name,200,false),url:identity.url,accountPath:identity.accountPath};
    for(const k of ['firstAttemptAt','attemptedAt','lastSuccessAt','notificationsReadyAt'])if(raw[k]!==undefined)out[k]=timestamp(raw[k]);
    for(const k of ['detailsChecked','detailsFailed','detailsRemaining'])if(raw[k]!==undefined)out[k]=number(raw[k],0,500);
    if(raw.coverage!==undefined){check(['partial','summary-and-bounded-details','empty-with-visible-marker','imported','not-scanned'].includes(raw.coverage),'invalid coverage');out.coverage=raw.coverage;}
    if(raw.error!==undefined)out.error=raw.error===null?null:text(raw.error,500);
    check(Object.keys(raw).every(k=>Object.hasOwn(out,k)),'unsupported course field');return out;
  }
  const dueCache=new Map();
  function parsedDue(raw,timezone,reference){
    const key=JSON.stringify([raw,timezone,reference]);
    if(!dueCache.has(key)){if(dueCache.size>=2000)dueCache.delete(dueCache.keys().next().value);dueCache.set(key,C.dueDate(raw,timezone,reference));}
    return {...dueCache.get(key)};
  }
  function item(raw,key,s,importing=false){
    check(record(raw),'invalid task');const id=C.identity(raw.url);
    check(id?.itemId&&id.accountPath===s.accountPath&&id.courseId===raw.courseId&&id.itemId===raw.itemId,'task identity mismatch');
    check(key===C.itemKey(s.profile,raw)&&(!raw.key||raw.key===key),'task key mismatch');
    check(['assignment','material','announcement'].includes(raw.type)&&id.type===raw.type,'invalid task type');
    check(['unknown','assigned','submitted','returned','missing'].includes(raw.status),'invalid submission state');
    check(['summary','detail','imported'].includes(raw.source),'invalid evidence source');
    const out={key,courseId:id.courseId,itemId:id.itemId,type:raw.type,url:id.url,title:text(raw.title,400,false),courseName:text(raw.courseName??'',200),
      dueRaw:text(raw.dueRaw??'',200),status:raw.status,source:raw.source,firstSeenAt:timestamp(raw.firstSeenAt??raw.lastSeenAt??0),lastSeenAt:timestamp(raw.lastSeenAt??0),
      lastVerifiedAt:timestamp(raw.lastVerifiedAt??0),completedAt:timestamp(raw.completedAt??0),deadlineRevision:number(raw.deadlineRevision??0),
      verificationNeeded:boolean(raw.verificationNeeded??false),imported:boolean(raw.imported??false)};
    if(raw.notSeenAt!==undefined||raw.notSeenIn!==undefined){
      const scope=C.identity(raw.notSeenIn);
      check(scope&&!scope.itemId&&scope.courseId===out.courseId&&scope.accountPath===s.accountPath&&scope.url===raw.notSeenIn,'invalid absence scope');
      out.notSeenAt=timestamp(raw.notSeenAt);check(out.notSeenAt>=out.lastSeenAt,'absence predates observation');out.notSeenIn=scope.url;
    }
    const local=raw.local??{status:'not-started',note:'',minutes:null,snoozeUntil:0};check(record(local),'invalid local edits');
    check(['not-started','in-progress','complete'].includes(local.status),'invalid local progress');
    check(local.minutes==null||Number.isInteger(local.minutes)&&local.minutes>=1&&local.minutes<=10000,'invalid effort');
    const pinnedDay=text(local.pinnedDay??'',10);
    check(pinnedDay===''||/^\d{4}-\d{2}-\d{2}$/.test(pinnedDay)&&Number.isFinite(Date.parse(pinnedDay))&&new Date(pinnedDay).toISOString().slice(0,10)===pinnedDay,'invalid pinned day');
    out.local={status:local.status,note:text(local.note??'',1000),minutes:local.minutes??null,snoozeUntil:number(local.snoozeUntil??0,0,Date.now()+30*86400000+60000),completedAt:timestamp(local.completedAt??0),pinnedDay};
    check(Object.keys(local).every(k=>Object.hasOwn(out.local,k)),'unsupported local edit');
    if(out.source!=='detail')check(out.lastVerifiedAt===0,'unverified task has detail timestamp');
    check(out.source!=='imported'||out.imported&&out.verificationNeeded,'invalid imported snapshot flags');
    check(!out.imported||out.lastVerifiedAt===0&&out.verificationNeeded,'imported snapshot claims verified evidence');
    const reference=out.lastVerifiedAt||out.firstSeenAt||out.lastSeenAt||Date.now();
    out.due=parsedDue(out.dueRaw,s.timezone,reference);
    if(raw.due!==undefined&&!importing){
      check(record(raw.due),'invalid deadline');
      for(const field of ['at','date','confidence'])if(raw.due[field]!==undefined)check(raw.due[field]===out.due[field],'deadline/evidence mismatch');
      if(raw.due.raw!==undefined)check(raw.due.raw===out.dueRaw,'deadline text mismatch');
      if(raw.due.timezone!==undefined)check(raw.due.timezone===s.timezone,'deadline timezone mismatch');
      check(Object.keys(raw.due).every(k=>['raw','timezone','confidence','at','date'].includes(k)),'unsupported deadline field');
    }
    if(raw.instructions!==undefined)out.instructions=text(raw.instructions,3000);
    if(raw.grade!==undefined&&raw.grade!==null){text(raw.grade,100);if(s.grades)out.grade=raw.grade;}
    if(raw.gradeHistory!==undefined){
      check(Array.isArray(raw.gradeHistory)&&raw.gradeHistory.length<=10,'invalid grade history');
      const history=raw.gradeHistory.map(value=>({at:timestamp(value.at),value:text(value.value,100,false)}));
      if(s.grades)out.gradeHistory=history;
    }
    if(raw.materials!==undefined){
      check(Array.isArray(raw.materials)&&raw.materials.length<=30,'invalid material links');
      const links=raw.materials.map(link=>{check(record(link),'invalid material');const u=new URL(link.url);check(u.protocol==='https:'&&['drive.google.com','docs.google.com'].includes(u.hostname)&&!u.username&&!u.password&&u.href.length<=2000,'unsafe material URL');return {title:text(link.title,150),url:u.href};});
      if(s.materials)out.materials=links;
    }
    out.revision=JSON.stringify([out.title,out.dueRaw,out.status,out.grade]);
    const known=[...Object.keys(out),'accountPath','revision','grade','gradeHistory','materials','instructions'];
    check(Object.keys(raw).every(k=>known.includes(k)),'unsupported task field');
    return out;
  }
  function scan(raw){
    if(raw===null)return null;check(record(raw),'invalid scan checkpoint');
    check(['running','interrupted','paused','cancelled','partial','finished','failed'].includes(raw.status),'invalid scan status');
    const result={status:raw.status,stage:text(raw.stage??'',300),checked:number(raw.checked??0,0,200),total:number(raw.total??0,0,200),failed:[]};
    for(const key of ['id','startedAt','finishedAt'])if(raw[key]!==undefined)result[key]=timestamp(raw[key]);
    for(const key of ['cancel','paused'])if(raw[key]!==undefined)result[key]=boolean(raw[key]);
    if(raw.tabId!==undefined)result.tabId=number(raw.tabId,0);
    for(const key of ['courseIds','completedCourseIds']){const ids=raw[key]??[];check(Array.isArray(ids)&&ids.length<=200&&ids.every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v)),'invalid checkpoint courses');result[key]=[...ids];}
    check(Array.isArray(raw.failed??[])&&(raw.failed??[]).length<=200,'invalid scan failures');
    result.failed=(raw.failed??[]).map(f=>({courseId:text(f.courseId,200),error:text(f.error,500)}));
    check(Object.keys(raw).every(k=>Object.hasOwn(result,k)),'unsupported checkpoint field');return result;
  }
  function diagnostic(raw){
    check(record(raw),'invalid report');const result=bounded(raw,20000);
    check(Object.keys(result).every(k=>['version','scannedAt','route','accountPath','scope','counts','candidates','truncated','warning','pageTitle','bodyTextSample','emptyStateTrusted','expansion'].includes(k)),'unsupported report field');
    if(result.emptyStateTrusted!==undefined)boolean(result.emptyStateTrusted);
    if(result.expansion!==undefined){dict(result.expansion,4);for(const [key,value]of Object.entries(result.expansion)){check(['expanded','skipped','budgetExhausted'].includes(key),'invalid expansion report');if(key==='budgetExhausted')boolean(value);else number(value,0,2000);}}
    if(result.scannedAt!==undefined)timestamp(result.scannedAt);
    if(result.route!==undefined)check(['home','course','detail'].includes(result.route),'invalid report route');
    if(result.accountPath!==undefined)check(/^\/u\/\d{1,3}\/$/.test(result.accountPath),'invalid report account');
    if(result.counts!==undefined){dict(result.counts,20);for(const value of Object.values(result.counts))number(value,0,1000000);}
    if(result.candidates!==undefined){check(Array.isArray(result.candidates)&&result.candidates.length<=30,'invalid diagnostic candidates');for(const value of result.candidates)bounded(value,1500);}
    if(result.truncated!==undefined)boolean(result.truncated);
    for(const [key,max]of [['version',80],['scope',80],['warning',500],['pageTitle',400],['bodyTextSample',1200]])if(result[key]!=null)text(result[key],max);
    return result;
  }
  function versionAlerts(raw){
    check(Array.isArray(raw)&&raw.length<=20,'invalid version alerts');
    return raw.map(value=>{
      check(record(value),'invalid version alert');
      const out={tabId:number(value.tabId,0),at:timestamp(value.at)};
      for(const key of ['expectedVersion','expectedBuild','actualVersion','actualBuild','reason'])out[key]=text(value[key],100,false);
      check(Object.keys(value).every(k=>Object.hasOwn(out,k)),'unsupported version alert');return out;
    });
  }
  function load(raw){
    if(raw===undefined)return {state:C.emptyState(),blocked:false,issues:[],migrated:false};
    const state=C.emptyState(),issues=[];
    const attempt=(code,fn)=>{try{return fn();}catch{issues.push(code);return undefined;}};
    if(!record(raw))return {state,blocked:true,issues:['Invalid root state; original storage was preserved.'],migrated:false};
    const compatible=[1,VERSION].includes(raw.schemaVersion);
    if(!compatible)issues.push('Unsupported storage schema; original storage was preserved.');
    const validSettings=attempt('Invalid saved settings',()=>settings(raw.settings));if(validSettings)state.settings=validSettings;
    else if(record(raw.settings)){
      // Salvage the identity context for read-only recovery, never its delivery credentials.
      try{text(raw.settings.profile,80,false);check(/^\/u\/\d{1,3}\/$/.test(raw.settings.accountPath),'invalid account');C.zonedParts(new Date(),raw.settings.timezone);
        Object.assign(state.settings,{profile:raw.settings.profile,accountPath:raw.settings.accountPath,timezone:raw.settings.timezone});
      }catch{}
    }
    if(raw.revision!==undefined||raw.schemaVersion===VERSION)state.revision=attempt('Invalid data revision',()=>number(raw.revision))??0;
    state.provisional=attempt('Invalid provisional summaries',()=>provisional(raw.provisional??[],state.settings))??[];
    for(const [key,max,validate]of [['courses',200,course],['items',MAX_ITEMS,item]]){
      const entries=attempt(`Invalid ${key} collection`,()=>Object.entries(dict(raw[key],max)));
      if(entries&&state.settings.profile)for(const [id,value]of entries){const normalized=attempt(`Invalid ${key} record`,()=>validate(value,id,state.settings));if(normalized)state[key][id]=normalized;}
    }
    if(!Array.isArray(raw.queue)||raw.queue.length>100)issues.push('Invalid notification queue collection');else state.queue=attempt('Invalid notification metadata',()=>bounded(raw.queue,2000000))??[];
    const delivered=attempt('Invalid delivery ledger',()=>dict(raw.delivered,1000));
    if(delivered)for(const [key,value]of Object.entries(delivered)){const at=attempt('Invalid delivery acknowledgement',()=>{text(key,1500,false);return timestamp(value);});if(at!==undefined)state.delivered[key]=at;}
    state.activity=attempt('Invalid activity history',()=>{check(Array.isArray(raw.activity)&&raw.activity.length<=100,'invalid activity');return raw.activity.map(event=>{check(record(event),'invalid activity');timestamp(event.at);return bounded(event,3000);});})??[];
    state.scan=attempt('Invalid scan checkpoint',()=>scan(raw.scan??null))??null;
    state.versionAlerts=attempt('Invalid script compatibility alerts',()=>versionAlerts(raw.versionAlerts??[]))??[];
    for(const key of ['lastDeliveryAt','lastMaintenanceAt','monitoringStartedAt','lastNotificationCheckAt'])if(raw[key]!==undefined){const value=attempt(`Invalid ${key}`,()=>timestamp(raw[key]));if(value!==undefined)state[key]=value;}
    if(raw.deliveryNotBefore!==undefined)state.deliveryNotBefore=attempt('Invalid delivery rate-limit checkpoint',()=>number(raw.deliveryNotBefore))??0;
    for(const key of ['deliveryError','notificationWarning'])if(raw[key]!==undefined)state[key]=attempt(`Invalid ${key}`,()=>raw[key]===null?null:text(raw[key],500));
    if(raw.report!==undefined)state.report=attempt('Invalid diagnostic report',()=>diagnostic(raw.report));
    if(state.report&&!state.settings.verbose){
      delete state.report.pageTitle;delete state.report.bodyTextSample;
      for(const candidate of state.report.candidates??[])if(record(candidate)){delete candidate.title;delete candidate.text;}
    }
    const known=[...Object.keys(state),'report','lastDeliveryAt','lastMaintenanceAt','deliveryError','notificationWarning'];
    if(Object.keys(raw).some(k=>!known.includes(k)))issues.push('Unsupported saved state field');
    if(issues.length){state.queue=[];state.settings.webhook='';state.settings.courses=[];for(const key of ['remindersEnabled','digestEnabled','notifyNew','notifyDeadline','notifyHealth'])state.settings[key]=false;}
    return {state,blocked:issues.length>0,issues:[...new Set(issues)],migrated:compatible&&raw.schemaVersion!==VERSION};
  }
  function parseImport(textValue,s){
    text(textValue,MAX_IMPORT,false);check(new TextEncoder().encode(textValue).byteLength<=MAX_IMPORT,'Import exceeds the 2 MiB byte limit');
    const data=JSON.parse(textValue,(k,v)=>{check(!reserved.has(k),'unsafe import key');return v;});
    check(record(data)&&[1,2].includes(data.schemaVersion),'Unsupported import schema');
    check(Object.keys(data).every(k=>['schemaVersion','profile','accountPath','timezone','exportedAt','courses','items','provisional'].includes(k)),'Import must contain tasks only, never settings, secrets, or queues');
    check(s.profile&&s.accountPath,'Configure the intended profile before importing');
    if(data.profile!==undefined)check(data.profile===s.profile,'Import belongs to a different local profile');
    if(data.accountPath!==undefined)check(data.accountPath===s.accountPath,'Import belongs to a different Classroom account');
    if(data.timezone!==undefined){text(data.timezone,100,false);C.zonedParts(new Date(),data.timezone);}
    if(data.exportedAt!==undefined)timestamp(data.exportedAt);
    const courses={},items={};
    for(const [id,value]of Object.entries(dict(data.courses,200))){const normalized=course(value,id,s);courses[id]={courseId:id,name:normalized.name,url:normalized.url,accountPath:s.accountPath,coverage:'imported'};}
    for(const [key,value]of Object.entries(dict(data.items,MAX_ITEMS))){
      const normalized=item(value,key,s,true);
      normalized.source='imported';normalized.imported=true;normalized.verificationNeeded=true;normalized.lastVerifiedAt=0;normalized.status='unknown';normalized.completedAt=0;
      delete normalized.notSeenAt;delete normalized.notSeenIn;
      normalized.due=parsedDue(normalized.dueRaw,s.timezone,normalized.firstSeenAt||normalized.lastSeenAt||Date.now());
      normalized.revision=JSON.stringify([normalized.title,normalized.dueRaw,normalized.status,normalized.grade]);
      items[key]=normalized;
    }
    return {courses,items,provisional:provisional(data.provisional??[],s)};
  }
  function importPlan(state,textValue,policy){
    check(['keep','replace'].includes(policy),'Choose keep-existing or replace-snapshot conflict policy');
    const parsed=parseImport(textValue,state.settings),keys=Object.keys(parsed.items),conflicts=keys.filter(key=>Object.hasOwn(state.items,key));
    check(new Set([...Object.keys(state.items),...keys]).size<=MAX_ITEMS,'Import exceeds the 5000-task limit');
    check(new Set([...Object.keys(state.courses),...Object.keys(parsed.courses)]).size<=200,'Import exceeds the 200-course limit');
    const scopes=new Set(parsed.provisional.map(row=>row.scopeURL)),existing=new Set(state.provisional.map(row=>row.scopeURL));
    check(state.provisional.filter(row=>policy!=='replace'||!scopes.has(row.scopeURL)).length+parsed.provisional.filter(row=>policy==='replace'||!existing.has(row.scopeURL)).length<=200,'Import exceeds the 200 provisional-summary limit');
    return {parsed,summary:{revision:state.revision,policy,total:keys.length,added:keys.length-conflicts.length,conflicts:conflicts.length,replaced:policy==='replace'?conflicts.length:0,kept:policy==='keep'?conflicts.length:0,courses:Object.keys(parsed.courses).length,provisional:parsed.provisional.length}};
  }
  function applyImport(state,textValue,policy,expectedRevision){
    check(expectedRevision===state.revision,'Data changed; preview the import again');
    const {parsed,summary}=importPlan(state,textValue,policy);
    for(const [id,value]of Object.entries(parsed.courses))if(!Object.hasOwn(state.courses,id))state.courses[id]=value;
    for(const [key,value]of Object.entries(parsed.items)){
      const old=state.items[key];if(old&&policy==='keep')continue;
      if(old)value.local={...old.local}; // Replacing a Classroom snapshot never overwrites personal notes/progress.
      state.items[key]=value;
    }
    const scopes=new Set(parsed.provisional.map(row=>row.scopeURL)),existing=new Set(state.provisional.map(row=>row.scopeURL));
    const incoming=parsed.provisional.filter(row=>policy==='replace'||!existing.has(row.scopeURL));
    const kept=state.provisional.filter(row=>policy!=='replace'||!scopes.has(row.scopeURL));
    check(kept.length+incoming.length<=200,'Import exceeds the 200 provisional-summary limit');state.provisional=[...kept,...incoming];
    return summary;
  }
  function retention(raw){
    check(record(raw),'Invalid retention settings');
    return {completedRetentionDays:number(raw.completedRetentionDays,0,3650),diagnosticRetentionHours:number(raw.diagnosticRetentionHours,1,720),historyRetentionDays:number(raw.historyRetentionDays,1,365)};
  }
  function cleanupPlan(state){
    const days=state.settings.completedRetentionDays;
    const keys=Object.values(state.items).filter(value=>{
      if(!days||value.imported)return false;
      const submitted=value.status==='submitted'&&value.source==='detail'&&value.lastVerifiedAt>0&&!value.verificationNeeded;
      const done=value.local.status==='complete'?value.local.completedAt:submitted?value.completedAt:0;
      return done>0&&Date.now()-done>days*86400000;
    }).map(value=>value.key);
    return {keys,completed:keys.length,diagnostics:Boolean(state.report&&Date.now()-(state.report.scannedAt??0)>state.settings.diagnosticRetentionHours*3600000),
      activity:state.activity.filter(e=>Date.now()-e.at>state.settings.historyRetentionDays*86400000).length};
  }
  function deleteKeys(state,keys){
    const touched=new Set();for(const key of keys)if(Object.hasOwn(state.items,key)){touched.add(state.items[key].courseId);delete state.items[key];}
    for(const id of touched)if(state.courses[id])delete state.courses[id].notificationsReadyAt;
    N.prune(state);return touched.size;
  }
  function cleanup(state,force=false){
    if(!force&&state.lastMaintenanceAt&&Date.now()-state.lastMaintenanceAt<3600000)return null;
    const plan=cleanupPlan(state);deleteKeys(state,plan.keys);
    if(plan.diagnostics)delete state.report;
    state.activity=state.activity.filter(e=>Date.now()-e.at<=state.settings.historyRetentionDays*86400000);
    state.lastMaintenanceAt=Date.now();return {completed:plan.completed,diagnostics:plan.diagnostics,activity:plan.activity};
  }
  function exportData(state){return {schemaVersion:VERSION,profile:state.settings.profile,accountPath:state.settings.accountPath,timezone:state.settings.timezone,courses:state.courses,items:state.items,provisional:state.provisional,exportedAt:Date.now()};}
  function exportCSV(state){
    // Spreadsheet applications must not interpret assignment titles or notes as formulas.
    const cell=value=>{let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s=`'${s}`;return `"${s.replace(/"/g,'""')}"`;};
    const rows=[['Course','Title','Classroom status','Due (original text)','Timezone','Source','Local progress','Estimated minutes','Local note','Assignment URL']];
    for(const value of Object.values(state.items))rows.push([value.courseName,value.title,value.status,value.dueRaw,state.settings.timezone,value.source,value.local.status,value.local.minutes,value.local.note,value.url]);
    return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
  }
  const api={buildId:globalThis.ClassroomBuild?.id || 'unstamped',VERSION,MAX_IMPORT,load,settings,item,course,provisional,parseImport,importPlan,applyImport,retention,cleanupPlan,cleanup,deleteKeys,exportData,exportCSV};
  globalThis.ClassroomState=api;if(typeof module!=='undefined')module.exports=api;
})();
