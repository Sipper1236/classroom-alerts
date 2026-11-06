/* Pure, validated notification jobs. Persist metadata; render school text from current records only. */
(() => {
  const C=globalThis.ClassroomCore;
  const flags=['remindersEnabled','digestEnabled','notifyNew','notifyDeadline','notifyHealth'];
  function windows(value) {
    if(!Array.isArray(value)||value.length>8||value.some(h=>typeof h!=='number'||!Number.isFinite(h)||h<0.25||h>720))throw new Error('Use up to 8 reminder windows between 0.25 and 720 hours');
    return [...new Set(value)].sort((a,b)=>b-a);
  }
  function settings(value,current) {
    const result={};
    for(const key of flags){
      const v=value[key]===undefined?current[key]??C.defaults[key]:value[key];
      if(typeof v!=='boolean')throw new Error(`Invalid ${key} notification option`);
      result[key]=v;
    }
    result.reminderHours=windows(value.reminderHours===undefined?current.reminderHours??C.defaults.reminderHours:value.reminderHours);
    result.notificationGapMinutes=value.notificationGapMinutes??current.notificationGapMinutes??C.defaults.notificationGapMinutes;
    if(!Number.isInteger(result.notificationGapMinutes)||result.notificationGapMinutes<0||result.notificationGapMinutes>1440)throw new Error('Notification spacing must be 0–1440 minutes');
    result.healthStaleHours=value.healthStaleHours??current.healthStaleHours??C.defaults.healthStaleHours;
    if(!Number.isInteger(result.healthStaleHours)||result.healthStaleHours<1||result.healthStaleHours>168)throw new Error('Scan-health threshold must be 1–168 hours');
    return result;
  }
  function prepare(state) {
    // Missing fields are an upgrade; malformed saved notification options fail closed.
    const issues=[];
    for(const key of flags){
      if(state.settings[key]===undefined)state.settings[key]=C.defaults[key];
      else if(typeof state.settings[key]!=='boolean'){state.settings[key]=false;issues.push(key);}
    }
    try{state.settings.reminderHours=windows(state.settings.reminderHours??C.defaults.reminderHours);}catch{state.settings.reminderHours=[];issues.push('reminderHours');}
    if(state.settings.notificationGapMinutes===undefined)state.settings.notificationGapMinutes=C.defaults.notificationGapMinutes;
    else if(!Number.isInteger(state.settings.notificationGapMinutes)||state.settings.notificationGapMinutes<0||state.settings.notificationGapMinutes>1440){state.settings.notificationGapMinutes=1440;issues.push('notificationGapMinutes');}
    if(issues.length)state.notificationWarning=`Invalid saved notification settings disabled/restricted: ${issues.join(', ')}. Review and save Settings.`;
    if(!Array.isArray(state.queue)){state.queue=[];state.notificationWarning='Invalid saved notification queue discarded. Review Settings.';}
  }
  function tasks(state) {return C.plan(state).filter(i=>!i.imported&&!(i.local?.snoozeUntil>Date.now())).slice(0,100);}
  function taskFingerprint(item){return JSON.stringify([item.key,item.title,item.courseName||'',item.url,item.dueRaw||'',item.status]);}
  function digestFingerprint(items){return JSON.stringify(items.map(taskFingerprint));}
  function day(state){const p=C.zonedParts(new Date(),state.settings.timezone);return `${p.year}-${p.month}-${p.day}`;}
  function staleCourses(state){return state.settings.courses.filter(id=>{
    const course=state.courses[id],since=course?.lastSuccessAt||course?.firstAttemptAt||state.monitoringStartedAt||0;
    return since>0&&Date.now()-since>=state.settings.healthStaleHours*3600000;
  }).sort();}
  function healthFingerprint(state){return JSON.stringify(staleCourses(state).map(id=>[id,state.courses[id]?.lastSuccessAt||0,state.courses[id]?.firstAttemptAt||state.monitoringStartedAt||0]));}
  function eligible(state,item){
    const id=C.identity(item?.url);
    return Boolean(item && id?.accountPath===state.settings.accountPath && id.courseId===item.courseId && id.itemId===item.itemId &&
      item.key===C.itemKey(state.settings.profile,item) && item.type==='assignment' && state.settings.courses.includes(item.courseId) &&
      item.status!=='submitted' && item.local?.status!=='complete' && !item.imported && !item.verificationNeeded && !(item.local?.snoozeUntil>Date.now()));
  }
  function schema(job){
    if(!job||typeof job!=='object'||Array.isArray(job)||job.schemaVersion!==1||typeof job.id!=='string'||!job.id||job.id.length>1500||
      !Number.isSafeInteger(job.createdAt)||job.createdAt<0||!Number.isInteger(job.attempts)||job.attempts<0||job.attempts>8||
      !Number.isSafeInteger(job.nextAt)||job.nextAt<0||!Number.isInteger(job.part)||job.part<0||job.part>99)return false;
    const fields={test:[],digest:['day','fingerprint'],health:['day','fingerprint'],catchup:['events','fingerprint'],reminder:['itemKey','dueAt','windowHours'],new:['itemKey','firstSeenAt','fingerprint'],deadline:['itemKey','deadlineRevision','fingerprint','previousDeadline']};
    if(!Object.hasOwn(fields,job.kind))return false;
    const common=['schemaVersion','id','kind','createdAt','attempts','nextAt','part','error'];
    if(Object.keys(job).some(key=>!common.includes(key)&&!fields[job.kind].includes(key)))return false;
    if(job.error!==undefined&&(typeof job.error!=='string'||job.error.length>200))return false;
    if(job.kind==='test')return job.part===0 && job.id===`test|${job.createdAt}`;
    if(job.kind==='catchup')return job.part===0&&job.id===`catchup|${job.createdAt}`&&typeof job.fingerprint==='string'&&/^\d{1,12}$/.test(job.fingerprint)&&
      Array.isArray(job.events)&&job.events.length>0&&job.events.length<=100&&new Set(job.events.map(e=>e?.id)).size===job.events.length&&
      job.events.every(e=>['digest','reminder','new','deadline'].includes(e?.kind)&&e.part===0&&schema(e));
    if(job.kind==='digest'||job.kind==='health')return typeof job.day==='string'&&/^\d{4}-\d{1,2}-\d{1,2}$/.test(job.day)&&job.id===`${job.kind}|${job.day}`&&typeof job.fingerprint==='string'&&job.fingerprint.length<=200000;
    if(typeof job.itemKey!=='string'||job.itemKey.length>600||job.part!==0)return false;
    if(job.kind==='reminder')return Number.isSafeInteger(job.dueAt)&&job.dueAt>0&&typeof job.windowHours==='number'&&job.windowHours>=0.25&&job.windowHours<=720&&job.id===`due|${job.itemKey}|${job.dueAt}|${job.windowHours}`;
    if(typeof job.fingerprint!=='string'||job.fingerprint.length>6000)return false;
    if(job.kind==='new')return Number.isSafeInteger(job.firstSeenAt)&&job.firstSeenAt>=0&&job.id===`new|${job.itemKey}|${job.firstSeenAt}`;
    return Number.isSafeInteger(job.deadlineRevision)&&job.deadlineRevision>0&&typeof job.previousDeadline==='string'&&/^(?:instant:\d{1,15}|date:\d{4}-\d{2}-\d{2}|no-date)$/.test(job.previousDeadline)&&job.id===`deadline|${job.itemKey}|${job.deadlineRevision}`;
  }
  function valid(state,job){
    if(!schema(job)||job.createdAt>Date.now()+60000)return false;
    if(job.kind==='test')return Date.now()-job.createdAt<48*3600000;
    if(job.kind==='catchup')return Date.now()-job.createdAt<48*3600000&&job.events.some(event=>valid(state,event)&&!state.delivered[event.id]);
    if(job.kind==='digest')return state.settings.digestEnabled && job.day===day(state) && job.fingerprint===digestFingerprint(tasks(state));
    if(job.kind==='health')return state.settings.notifyHealth&&job.day===day(state)&&staleCourses(state).length>0&&job.fingerprint===healthFingerprint(state);
    const item=state.items[job.itemKey];
    if(!eligible(state,item))return false;
    if(job.kind==='reminder'){
      const hours=(item.due?.at-Date.now())/3600000;
      const currentWindow=state.settings.reminderHours.filter(h=>hours<=h).sort((a,b)=>a-b)[0];
      return state.settings.remindersEnabled && job.windowHours===currentWindow && item.due?.at===job.dueAt && hours>0 &&
        item.lastVerifiedAt>0&&Date.now()-item.lastVerifiedAt<=24*3600000;
    }
    if(Date.now()-job.createdAt>48*3600000 || job.fingerprint!==taskFingerprint(item))return false;
    return job.kind==='new'?state.settings.notifyNew && item.firstSeenAt===job.firstSeenAt:
      state.settings.notifyDeadline && item.deadlineRevision===job.deadlineRevision;
  }
  function prune(state){
    const seen=new Set();let removed=0;
    for(const job of state.queue)if(job?.kind==='catchup'&&schema(job)){
      const events=job.events.map(event=>{
        const item=state.items[event.itemKey];
        if(item&&(event.kind==='new'||event.kind==='deadline'&&event.deadlineRevision===item.deadlineRevision))return {...event,fingerprint:taskFingerprint(item)};
        return event;
      }).filter(event=>valid(state,event)&&!state.delivered[event.id]);
      if(JSON.stringify(events)!==JSON.stringify(job.events)){job.events=events;job.fingerprint=String(Number(job.fingerprint)+1);}
    }
    state.queue=state.queue.filter(job=>{if(!valid(state,job)||seen.has(job.id)||state.delivered[job.id]){removed++;return false;}seen.add(job.id);return true;}).slice(0,100);
    return removed;
  }
  function enqueue(state,id,metadata){
    const createdAt=Date.now();if(metadata.kind==='test')id=`test|${createdAt}`;
    if(state.delivered[id]||state.queue.some(j=>j.id===id||j.kind==='catchup'&&j.events.some(event=>event.id===id)))return;
    if(state.queue.length>=100){state.notificationWarning='Notification queue reached its 100-job limit; extra events suppressed. Check delivery settings.';return;}
    const job={schemaVersion:1,id,createdAt,attempts:0,nextAt:createdAt,part:0,...metadata};
    if(valid(state,job))state.queue.push(job);
  }
  function events(state,changes){
    // Refresh pending new-item summaries with detail evidence before any send.
    for(const job of state.queue){
      const item=state.items[job?.itemKey];
      if(item&&schema(job)&&(job.kind==='new'||job.kind==='deadline'&&job.deadlineRevision===item.deadlineRevision))job.fingerprint=taskFingerprint(item);
    }
    prune(state);
    if(!state.settings.webhook)return;
    for(const change of changes){
      const item=state.items[change.key];if(!eligible(state,item))continue;
      if(change.type==='new'&&state.settings.notifyNew&&state.courses[item.courseId]?.notificationsReadyAt){
        enqueue(state,`new|${item.key}|${item.firstSeenAt}`,{kind:'new',itemKey:item.key,firstSeenAt:item.firstSeenAt,fingerprint:taskFingerprint(item)});
      }else if(change.deadlineChanged&&state.settings.notifyDeadline&&!state.queue.some(j=>j.kind==='new'&&j.itemKey===item.key)){
        enqueue(state,`deadline|${item.key}|${item.deadlineRevision}`,{kind:'deadline',itemKey:item.key,deadlineRevision:item.deadlineRevision,previousDeadline:change.previousDeadline,fingerprint:taskFingerprint(item)});
      }
    }
  }
  function aggregate(state,afterGap){
    const pending=state.queue.find(job=>job.kind==='catchup');
    const events=state.queue.filter(job=>['digest','reminder','new','deadline'].includes(job.kind)&&job.part===0&&job.nextAt<Number.MAX_SAFE_INTEGER&&job.attempts<8);
    if(!pending&&(!afterGap||events.length<2)||!events.length)return;
    const combined=[...(pending?.events||[]),...events].slice(0,100),ids=new Set(combined.map(event=>event.id));
    const job=pending||{schemaVersion:1,id:`catchup|${Date.now()}`,kind:'catchup',createdAt:Date.now(),attempts:0,nextAt:Date.now(),part:0,fingerprint:'0',events:[]};
    job.events=combined;job.fingerprint=String(Number(job.fingerprint)+1);
    job.nextAt=Math.max(job.nextAt,...combined.map(event=>event.nextAt));job.attempts=Math.max(job.attempts,...combined.map(event=>event.attempts));
    state.queue=state.queue.filter(event=>event.id!==job.id&&!ids.has(event.id));state.queue.unshift(job);
  }
  function schedule(state){
    // A missed-alarm gap is observable; no sleep/profile telemetry is needed.
    const previous=state.lastNotificationCheckAt||Math.min(Date.now(),...state.queue.map(job=>job.createdAt).filter(Number.isSafeInteger));
    const afterGap=Date.now()-previous>=30*60000;state.lastNotificationCheckAt=Date.now();
    prune(state);if(!state.settings.webhook)return;
    const list=tasks(state),p=C.zonedParts(new Date(),state.settings.timezone),today=day(state);
    if(state.settings.notifyHealth&&staleCourses(state).length)enqueue(state,`health|${today}`,{kind:'health',day:today,fingerprint:healthFingerprint(state)});
    if(state.settings.digestEnabled&&p.hour>=state.settings.digestHour&&list.length)enqueue(state,`digest|${today}`,{kind:'digest',day:today,fingerprint:digestFingerprint(list)});
    if(state.settings.remindersEnabled)for(const item of list){
      if(!eligible(state,item)||!item.due?.at||item.due.at<=Date.now()||!item.lastVerifiedAt||Date.now()-item.lastVerifiedAt>24*3600000)continue;
      const hours=(item.due.at-Date.now())/3600000;
      const windowHours=state.settings.reminderHours.filter(h=>hours<=h).sort((a,b)=>a-b)[0];
      if(windowHours)enqueue(state,`due|${item.key}|${item.due.at}|${windowHours}`,{kind:'reminder',itemKey:item.key,dueAt:item.due.at,windowHours});
    }
    aggregate(state,afterGap);
  }
  function digestMessages(state){return C.messages(tasks(state),`Homework digest · ${state.scan?.checked || 0}/${state.settings.courses.length} courses checked`);}
  function preview(state){return {digest:digestMessages(state),queued:state.queue.map(job=>({kind:job.kind,messages:render(state,job)})).filter(job=>job.messages.length)};}
  function render(state,job){
    if(!valid(state,job))return [];
    if(job.kind==='test')return ['Classroom Alerts test — no school data included.'];
    if(job.kind==='health')return [`Classroom scan health: ${staleCourses(state).length} selected course(s) have not had a successful scoped check for at least ${state.settings.healthStaleHours} hours. Open Zen, sign in normally if needed, and retry failed courses. This does not mean there is no homework.`];
    if(job.kind==='digest')return digestMessages(state);
    if(job.kind==='catchup'){
      const events=job.events.filter(event=>valid(state,event)&&!state.delivered[event.id]),items=new Map();
      for(const event of events)for(const item of event.kind==='digest'?tasks(state):[state.items[event.itemKey]])items.set(item.key,item);
      const chunks=C.messages([...items.values()],`Homework catch-up · ${items.size} current task(s) · ${events.length} alerts combined. Check Classroom; cached records may be stale.`);
      // One summary acknowledges the whole backlog; never turn its overflow back into alert spam.
      return chunks.length?[chunks[0]+(chunks.length>1?'\nMore current work is in Dashboard; additional alerts were combined, not replayed.':'')]:[];
    }
    const item=state.items[job.itemKey];
    const previous=job.previousDeadline?.startsWith('instant:')?new Intl.DateTimeFormat('en-US',{timeZone:state.settings.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(Number(job.previousDeadline.slice(8)))):job.previousDeadline?.replace(/^date:/,'');
    const heading=job.kind==='new'?'New assignment discovered':job.kind==='deadline'?`Deadline changed · previously ${previous}`:`Due within ${job.windowHours} hours · verify status if stale`;
    return C.messages([item],heading);
  }
  const api={buildId:globalThis.ClassroomBuild?.id || 'unstamped',windows,settings,prepare,schema,valid,prune,enqueue,events,schedule,render,preview,taskFingerprint};
  globalThis.ClassroomNotifications=api;if(typeof module!=='undefined')module.exports=api;
})();
