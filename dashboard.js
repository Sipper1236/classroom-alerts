const $=id=>document.getElementById(id), call=(type,extra={})=>browser.runtime.sendMessage({type,...extra});
let state, diagnostic='',taskPage=0,academicPage=0,provisionalPage=0,importText='',importPreview=null,cleanupPreview=null;
function show(message){$('status').textContent=message;}
function node(tag,text){const e=document.createElement(tag);e.textContent=text;return e;}
function renderProvisional(){
  const rows=state.provisional.filter(row=>state.settings.courses.includes(row.courseId));
  provisionalPage=Math.max(0,Math.min(provisionalPage,Math.ceil(rows.length/25)-1));$('provisional-items').replaceChildren();
  $('provisional-prev').disabled=provisionalPage===0;$('provisional-next').disabled=(provisionalPage+1)*25>=rows.length;
  $('provisional-count').textContent=`${rows.length?provisionalPage*25+1:0}–${Math.min((provisionalPage+1)*25,rows.length)} of ${rows.length} unverified summaries`;
  if(!rows.length)$('provisional-items').append(node('p','No provisional summaries saved for selected courses. This does not establish complete coverage.'));
  for(const row of rows.slice(provisionalPage*25,(provisionalPage+1)*25)){
    const article=node('article','');article.append(node('h3',row.title),node('p',`${state.courses[row.courseId]?.name||row.courseId} · ${row.dueRaw||'No deadline text captured'} · observed ${new Date(row.capturedAt).toLocaleString()} · unverified, no stable item link`));
    const link=node('a','Open checked course scope to verify');link.href=row.scopeURL;link.target='_blank';link.rel='noopener noreferrer';article.append(link);$('provisional-items').append(article);
  }
}
function absenceNote(item){
  const note=node('p',`Not seen in the successful bounded course scan at ${new Date(item.notSeenAt).toLocaleString()}. This record is retained; absence does not prove removal or completion. `);
  const link=node('a','Open checked scope');link.href=item.notSeenIn;link.target='_blank';link.rel='noopener noreferrer';note.append(link);return note;
}
function academicDetails(item){
  const details=document.createElement('details');details.append(node('summary','Collected instructions and resource links'));
  details.append(node('p',item.instructions || 'No supported instruction/body region was found. Open Classroom for the full content.'));
  if(state.settings.materials)for(const resource of item.materials || []){
    const link=node('a',resource.title || 'Open Google Drive resource');link.href=resource.url;link.target='_blank';link.rel='noopener noreferrer';const row=node('p','');row.append(link);details.append(row);
  }
  return details;
}
function renderAcademic(){
  $('academic-items').replaceChildren();const type=$('academic-type').value,query=$('academic-filter').value.toLowerCase();
  const enabled=type==='grade'?state.settings.grades:type==='announcement'?state.settings.announcements:state.settings.materials;
  const rows=enabled?Object.values(state.items).filter(item=>state.settings.courses.includes(item.courseId)&&
    (type==='grade'?Boolean(item.grade||item.gradeHistory?.length):item.type===type)&&`${item.title} ${item.courseName}`.toLowerCase().includes(query)).sort((a,b)=>b.lastSeenAt-a.lastSeenAt):[];
  academicPage=Math.max(0,Math.min(academicPage,Math.ceil(rows.length/25)-1));
  $('academic-prev').disabled=academicPage===0;$('academic-next').disabled=(academicPage+1)*25>=rows.length;
  $('academic-count').textContent=`${rows.length?academicPage*25+1:0}–${Math.min((academicPage+1)*25,rows.length)} of ${rows.length} snapshots`;
  if(!enabled)$('academic-items').append(node('p','Collection is disabled for this category. Enable it in Settings before scanning.'));
  else if(!rows.length)$('academic-items').append(node('p','No matching snapshots collected within the checked scope. Open the relevant Classroom pages and check scan coverage.'));
  for(const item of rows.slice(academicPage*25,(academicPage+1)*25)){
    const article=node('article','');article.className='academic-card';const heading=node('h3',''),link=node('a',item.title);
    link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';heading.append(link);
    article.append(heading,node('p',`${item.courseName || item.courseId} · ${item.source}${item.imported?' · unverified imported snapshot':''} · seen ${new Date(item.lastSeenAt).toLocaleString()}`));
    if(item.notSeenAt)article.append(absenceNote(item));
    if(type==='grade'){
      article.append(node('p',item.grade?`Visible grade snapshot: ${item.grade} (not a course average)`:'No current grade visible; any earlier local snapshots are shown below.'));
      if(item.gradeHistory?.length){const history=document.createElement('details');history.append(node('summary','Local grade snapshot history'));for(const value of item.gradeHistory)history.append(node('p',`${new Date(value.at).toLocaleString()} — ${value.value}`));article.append(history);}
    }else article.append(academicDetails(item));
    $('academic-items').append(article);
  }
}
function renderTasks(){
  $('tasks').replaceChildren();const query=$('filter').value.toLowerCase(),budget=Number($('budget').value)||null;
  const completed=$('show-completed').checked?Object.values(state.items).filter(i=>i.type==='assignment' && state.settings.courses.includes(i.courseId) && (i.status==='submitted'||i.local?.status==='complete')).map(i=>({...i,reason:'Completed locally or submitted in Classroom; local edits do not change Classroom status.'})):[];
  const today=ClassroomCore.schoolDay(state.settings.timezone),now=Date.now();
  const tasks=[...state.plan,...completed].filter(i=>{
    const deadline=$('task-deadline').value,noDate=!i.dueRaw||/^no due date$/i.test(i.dueRaw);
    const review=i.source!=='detail'||i.verificationNeeded||i.imported||i.notSeenAt||i.status==='unknown'||!noDate&&i.due?.at==null;
    return `${i.title} ${i.courseName}`.toLowerCase().includes(query)&&(!budget||!i.local.minutes||i.local.minutes<=budget)&&
      (!$('task-course').value||i.courseId===$('task-course').value)&&(!$('today-only').checked||i.local.pinnedDay===today)&&
      ($('task-review').value==='all'||($('task-review').value==='review'?review:!review))&&
      (deadline==='all'||deadline==='missing'&&i.status==='missing'||deadline==='no-date'&&noDate||deadline==='uncertain'&&!noDate&&i.due?.at==null||deadline==='overdue'&&i.due?.at!=null&&i.due.at<now||deadline==='upcoming'&&i.due?.at!=null&&i.due.at>=now);
  });
  const pageSize=25;taskPage=Math.max(0,Math.min(taskPage,Math.ceil(tasks.length/pageSize)-1));
  $('page-prev').disabled=taskPage===0;$('page-next').disabled=(taskPage+1)*pageSize>=tasks.length;
  $('page-count').textContent=`${tasks.length?taskPage*pageSize+1:0}–${Math.min((taskPage+1)*pageSize,tasks.length)} of ${tasks.length} matching tasks`;
  if(!tasks.length)$('tasks').append(node('p',state.plan.length||completed.length?'No tasks match these filters. Change filters to review other collected work.':ClassroomCore.emptyMessage(state)));
  for(const item of tasks.slice(taskPage*pageSize,(taskPage+1)*pageSize)){
    const box=node('article','');box.className='task';const h=node('h3',''),a=node('a',item.title);a.href=item.url;a.target='_blank';a.rel='noopener';h.append(a);box.append(h,node('p',`${item.courseName || item.courseId} · ${item.dueRaw || 'No recognized deadline'}`),node('p',item.reason),node('small',`Last seen ${new Date(item.lastSeenAt).toLocaleString()} · ${item.source}`));
    box.dataset.key=item.key;
    if(item.notSeenAt)box.append(absenceNote(item));
    const form=document.createElement('form');
    const label=node('label','Local progress (does not submit work)');const select=document.createElement('select');
    for(const [value,text]of [['not-started','Not started'],['in-progress','In progress'],['complete','Locally complete']]){const o=node('option',text);o.value=value;select.append(o);}select.value=item.local.status;label.append(select);
    const effortLabel=node('label','Your estimate in minutes');const effort=document.createElement('input');effort.type='number';effort.min=1;effort.max=10000;effort.value=item.local.minutes || '';effortLabel.append(effort);
    const noteLabel=node('label','Next action / local note');const note=document.createElement('textarea');note.maxLength=1000;note.value=item.local.note;noteLabel.append(note);
    const save=node('button','Save local edits'),snooze=node('button','Snooze reminders for one hour');snooze.type='button';
    const pinLabel=node('label',"Pin for today's plan (school timezone)"),pin=document.createElement('input');pin.type='checkbox';pin.checked=item.local.pinnedDay===today;pinLabel.prepend(pin);
    const untilLabel=node('label','Snooze until (device timezone; up to 30 days)'),until=document.createElement('input');until.type='datetime-local';untilLabel.append(until);
    if(item.local.snoozeUntil>now){const date=new Date(item.local.snoozeUntil);until.value=new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    const chosen=node('button','Snooze until chosen time'),clear=node('button','Clear snooze');chosen.type=clear.type='button';
    const value=()=>({status:select.value,note:note.value,minutes:effort.value?Number(effort.value):null,snoozeUntil:item.local.snoozeUntil,pinToday:pin.checked});
    form.onsubmit=async e=>{e.preventDefault();try{await call('local',{key:item.key,value:value()});show('Local edits saved. Classroom is unchanged.');await refresh(false);}catch(e){show(e.message);}};
    snooze.onclick=async()=>{try{await call('local',{key:item.key,value:{...value(),snoozeUntil:Date.now()+3600000}});show('Reminders snoozed for one hour.');await refresh(false);}catch(e){show(e.message);}};
    chosen.onclick=async()=>{try{const at=new Date(until.value).getTime();if(!Number.isFinite(at)||at<=Date.now()||at>Date.now()+30*86400000)throw new Error('Choose a future snooze time within 30 days in your device timezone');await call('local',{key:item.key,value:{...value(),snoozeUntil:at}});show('Reminders snoozed until the chosen time.');await refresh(false);}catch(e){show(e.message);}};
    clear.onclick=async()=>{try{await call('local',{key:item.key,value:{...value(),snoozeUntil:0}});show('Snooze cleared.');await refresh(false);}catch(e){show(e.message);}};
    form.append(label,effortLabel,noteLabel,pinLabel,save,untilLabel,chosen,clear,snooze);const details=document.createElement('details');details.append(node('summary','Local planning controls'),form);box.append(details);$('tasks').append(box);
    box.append(academicDetails(item));
    const remove=node('button','Delete local record');remove.type='button';remove.className='danger';remove.onclick=async()=>{if(!confirm('Delete this local task record and its notes? It may reappear after a Classroom scan.'))return;try{await call('delete-item',{key:item.key,confirmed:true});show('Local record deleted. Classroom is unchanged.');await refresh(false);}catch(e){show(e.message);}};details.append(remove);
  }
}
async function refresh(settings=true){
  const focused=document.activeElement,task=focused?.closest('.task'),focusKey=task?.dataset.key,focusIndex=task?[...task.querySelectorAll('button,input,select,textarea,summary,a')].indexOf(focused):-1;
  state=await call('state');$('version').textContent=`v${browser.runtime.getManifest().version}`;
  const s=state.settings;
  $('script-versions').hidden=state.build?.compatible===true&&!state.versionAlerts?.length;
  $('build-status').textContent=state.build?.compatible===true?`Background ${state.build.version}, build ${state.build.buildId}.`:'Background scripts are mixed/outdated. Reload Classroom Alerts in about:debugging before reloading Classroom tabs.';
  $('version-tabs').replaceChildren();
  for(const issue of state.versionAlerts || []){
    const row=node('p',`Classroom tab #${issue.tabId}: loaded ${issue.actualVersion} (${issue.actualBuild}); expected ${issue.expectedVersion} (${issue.expectedBuild}). `);
    const focus=node('button','Show affected tab');focus.onclick=async()=>{try{await call('focus-version-tab',{tabId:issue.tabId});}catch(e){show(e.message);}};row.append(focus);$('version-tabs').append(row);
  }
  $('recovery').hidden=!state.recovery?.blocked;
  $('recovery-status').textContent=state.recovery?.blocked?`${state.recovery.issues.join('; ')}. ${state.recovery.validTasks} valid tasks and ${state.recovery.validCourses} courses available for recovery.`:'';
  for(const id of ['scan','page','test-discord','retry-delivery','import-preview','cleanup-preview'])$(id).disabled=Boolean(state.recovery?.blocked)||state.build?.compatible!==true;
  $('coverage').textContent=state.scan?`${state.scan.status}: ${state.scan.stage} · ${state.scan.checked}/${state.scan.total} courses checked · ${state.scan.failed.length} failures. Detail visits are capped; this is not proof of complete Classroom coverage.`:'No course scan yet. Cached records may be incomplete.';
  if(settings){
    for(const [id,key]of [['profile','profile'],['timezone','timezone'],['interval','intervalMinutes'],['digest','digestHour'],['quiet-start','quietStart'],['quiet-end','quietEnd']])$(id).value=s[key];
    $('account').value=s.accountPath.match(/\d+/)?.[0] || '';
    $('webhook').value='';$('webhook').placeholder=s.webhook?'Saved — leave unchanged or enter a replacement':'No webhook saved';
    $('webhook').type='password';$('reveal-webhook').textContent='Show entered webhook';$('reveal-webhook').setAttribute('aria-pressed','false');
    $('discord-enabled').checked=Boolean(s.webhook);
    for(const id of ['digestEnabled','remindersEnabled','notifyNew','notifyDeadline','notifyHealth'])$(id).checked=s[id];
    $('health-hours').value=s.healthStaleHours;
    $('reminder-hours').value=s.reminderHours.join(', ');$('notification-gap').value=s.notificationGapMinutes;
    $('completed-retention').value=s.completedRetentionDays;$('diagnostic-retention').value=s.diagnosticRetentionHours;$('history-retention').value=s.historyRetentionDays;
    for(const id of ['verbose','announcements','materials','grades'])$(id).checked=s[id];
    $('course-list').replaceChildren();
    for(const course of Object.values(state.courses)){
      const label=node('label',''),input=document.createElement('input');input.type='checkbox';input.value=course.courseId;input.checked=s.courses.includes(course.courseId);label.append(input,document.createTextNode(` ${course.name} · ${course.coverage || 'Not scanned'}${course.error?` · ${course.error}`:''}`));
      const row=node('div',''),scan=node('button','Scan this course');scan.onclick=async()=>{try{await call('scan',{mode:'course',courseId:course.courseId});show(`Scanning only ${course.name}.`);await refresh(false);}catch(e){show(e.message);}};
      const attempted=course.attemptedAt?new Date(course.attemptedAt).toLocaleString():'never',success=course.lastSuccessAt?new Date(course.lastSuccessAt).toLocaleString():'never';
      row.append(label,scan,node('p',`Last attempt: ${attempted} · Last success: ${success} · Details checked ${course.detailsChecked??0}, failed ${course.detailsFailed??0}, remaining ${course.detailsRemaining??0}`));$('course-list').append(row);
    }
  }
  $('delivery').textContent=`${state.settings.webhook?'Webhook configured':'Discord disabled'} · ${state.queue.length} queued · ${state.deliveryError || (state.lastDeliveryAt?`Last delivered ${new Date(state.lastDeliveryAt).toLocaleString()}`:'No delivery verified')}${state.notificationWarning?` · ${state.notificationWarning}`:''}`;
  if(state.deliveryNotBefore>Date.now())$('delivery').textContent+=` · Discord rate limit: no requests before ${new Date(state.deliveryNotBefore).toLocaleString()}`;
  // The shareable default excludes URLs, candidate text, titles, account routing, and grades.
  diagnostic=JSON.stringify({version:browser.runtime.getManifest().version,build:state.build,scriptCompatibility:state.versionAlerts?.map(v=>({expectedBuild:v.expectedBuild,actualBuild:v.actualBuild,reason:v.reason})),scan:state.scan?{status:state.scan.status,checked:state.scan.checked,total:state.scan.total,failures:state.scan.failed.length}:null,report:state.report?{route:state.report.route,counts:state.report.counts,truncated:state.report.truncated,warning:state.report.warning}:null},null,2);
  $('report').textContent=JSON.stringify(state.report || {message:'No page report yet'},null,2);
  const selectedCourse=$('task-course').value;$('task-course').replaceChildren();const all=node('option','All selected courses');all.value='';$('task-course').append(all);
  for(const id of state.settings.courses){const option=node('option',state.courses[id]?.name||id);option.value=id;$('task-course').append(option);}if(state.settings.courses.includes(selectedCourse))$('task-course').value=selectedCourse;
  $('activity').textContent=JSON.stringify(state.activity.slice(0,30),null,2);renderTasks();renderAcademic();renderProvisional();
  if(focusKey){const row=[...$('tasks').children].find(row=>row.dataset.key===focusKey),control=row?.querySelectorAll('button,input,select,textarea,summary,a')[focusIndex];if(control){const details=control.closest('details');if(details)details.open=true;control.focus();}else $('filter').focus();}
}
function resetTasks(){taskPage=0;renderTasks();}
$('filter').oninput=resetTasks;$('budget').oninput=resetTasks;$('show-completed').onchange=resetTasks;
for(const id of ['task-course','task-deadline','task-review','today-only'])$(id).onchange=resetTasks;
$('page-prev').onclick=()=>{taskPage--;renderTasks();};$('page-next').onclick=()=>{taskPage++;renderTasks();};
$('academic-type').onchange=()=>{academicPage=0;renderAcademic();};$('academic-filter').oninput=()=>{academicPage=0;renderAcademic();};
$('academic-prev').onclick=()=>{academicPage--;renderAcademic();};$('academic-next').onclick=()=>{academicPage++;renderAcademic();};
$('provisional-prev').onclick=()=>{provisionalPage--;renderProvisional();};$('provisional-next').onclick=()=>{provisionalPage++;renderProvisional();};
$('clear-provisional').onclick=async()=>{if(!confirm('Clear only the local provisional snapshots? Identified tasks and Classroom are unchanged.'))return;try{await call('clear-provisional',{confirmed:true});show('Provisional snapshots cleared.');await refresh(false);}catch(e){show(e.message);}};
$('settings-form').onsubmit=async event=>{
  event.preventDefault();try{
    const value={profile:$('profile').value,accountPath:`/u/${Number($('account').value)}/`,timezone:$('timezone').value,
      intervalMinutes:Number($('interval').value),digestHour:Number($('digest').value),quietStart:Number($('quiet-start').value),quietEnd:Number($('quiet-end').value),
      webhook:$('discord-enabled').checked?$('webhook').value || (state.settings.webhook?'configured':''):'',courses:[...$('course-list').querySelectorAll('input:checked')].map(i=>i.value)};
    for(const id of ['verbose','announcements','materials','grades'])value[id]=$(id).checked;
    for(const id of ['digestEnabled','remindersEnabled','notifyNew','notifyDeadline','notifyHealth'])value[id]=$(id).checked;
    value.healthStaleHours=Number($('health-hours').value);
    value.reminderHours=$('reminder-hours').value.trim()?$('reminder-hours').value.split(',').map(v=>Number(v.trim())):[];
    value.notificationGapMinutes=Number($('notification-gap').value);
    await call('settings',{value});show('Settings saved. Verify your selected Classroom account before scanning.');await refresh();
  }catch(e){show(e.message);}
};
for(const id of ['scan','pause','resume','retry-scan','cancel','page','test-discord','retry-delivery','clear-diagnostics'])$(id).onclick=async()=>{try{
  if(id==='page'){
    const tabs=await browser.tabs.query({currentWindow:true});const classroom=tabs.find(t=>t.url?.startsWith(`https://classroom.google.com${state.settings.accountPath}`));
    if(!classroom)throw new Error('Open your signed-in Classroom page in this window first');
    await call('page',{tabId:classroom.id});
  }else if(id==='resume'||id==='retry-scan')await call('scan',{mode:id==='resume'?'resume':'retry'});
  else await call(id);
  show(id==='scan'?'Scan started in one inactive tab. Use Refresh view for progress.':'Request finished; check scan/delivery status below.');await refresh();
}catch(e){await refresh(false).catch(()=>{});show(e.message);}};
$('refresh').onclick=()=>refresh().catch(e=>show(e.message));
$('preview-discord').onclick=async()=>{try{const preview=await call('preview-discord');$('preview-text').textContent=[`DIGEST SAMPLE\n${preview.digest.join('\n\n')||'No eligible tasks for a digest.'}`,...preview.queued.map(job=>`QUEUED ${job.kind}\n${job.messages.join('\n\n')}`)].join('\n\n');$('message-preview').hidden=false;$('message-preview').open=true;show('Local preview only. No messages sent.');}catch(e){show(e.message);}};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(diagnostic);$('copy-fallback').hidden=true;show('Redacted diagnostic summary copied. Review before sharing.');}catch{$('copy-fallback').hidden=false;$('copy-text').value=diagnostic;$('copy-text').focus();$('copy-text').select();show('Clipboard denied. The redacted summary is selected below; use your keyboard copy command.');}};
$('reveal-webhook').onclick=()=>{const reveal=$('webhook').type==='password';$('webhook').type=reveal?'text':'password';$('reveal-webhook').setAttribute('aria-pressed',String(reveal));$('reveal-webhook').textContent=reveal?'Hide entered webhook':'Show entered webhook';};
$('export').onclick=async()=>{try{const data=await call('export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=node('a','');a.href=url;a.download='classroom-tasks.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){show(e.message);}};
$('export-csv').onclick=async()=>{try{const data=await call('export-csv'),url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));const a=node('a','');a.href=url;a.download='classroom-tasks.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){show(e.message);}};
$('reset').onclick=async()=>{if(!confirm('Clear ALL primary local tasks, settings, secrets, and queued reminders? Classroom is not changed; recovery backups are deleted separately.'))return;try{if(!state.recovery?.blocked)await call('cancel');await call('reset',{confirmed:true});show('Local data reset.');await refresh();}catch(e){show(e.message);}};
function invalidateImport(){importPreview=null;$('import-apply').disabled=true;}
$('import-file').onchange=()=>{importText='';invalidateImport();$('import-status').textContent='Choose Preview import to validate this file.';};
$('import-policy').onchange=invalidateImport;
$('import-preview').onclick=async()=>{try{
  invalidateImport();const file=$('import-file').files[0];if(!file||file.size>2*1024*1024)throw new Error('Choose a JSON file no larger than 2 MiB');
  importText=await file.text();importPreview=await call('import-preview',{text:importText,policy:$('import-policy').value});
  $('import-status').textContent=`${importPreview.total} tasks: ${importPreview.added} new, ${importPreview.conflicts} conflicts; ${importPreview.replaced} snapshots replaced, ${importPreview.kept} kept. ${importPreview.provisional} unverified provisional summaries (not identified assignments). Settings and alert delivery are unchanged. Imported records need Classroom verification.`;
  $('import-apply').disabled=false;
}catch(e){$('import-status').textContent=e.message;}};
$('import-apply').onclick=async()=>{if(!importPreview||!confirm('Apply this previewed import? Existing local notes/progress are preserved; imported snapshots stay unverified.'))return;try{
  await call('import',{text:importText,policy:importPreview.policy,expectedRevision:importPreview.revision,confirmed:true});invalidateImport();$('import-status').textContent='Import applied locally. No settings changed and no alerts were sent.';await refresh(false);
}catch(e){invalidateImport();$('import-status').textContent=e.message;}};
$('retention-form').onsubmit=async event=>{event.preventDefault();const completed=Number($('completed-retention').value);if(completed>0&&!confirm(`Enable automatic deletion of completed local tasks after ${completed} days? Unfinished tasks are kept.`))return;try{
  await call('retention',{confirmed:completed>0,value:{completedRetentionDays:completed,diagnosticRetentionHours:Number($('diagnostic-retention').value),historyRetentionDays:Number($('history-retention').value)}});
  cleanupPreview=null;$('cleanup-apply').disabled=true;show('Retention policy saved.');await refresh(false);
}catch(e){show(e.message);}};
$('cleanup-preview').onclick=async()=>{try{cleanupPreview=await call('cleanup-preview');$('cleanup-status').textContent=`Would delete ${cleanupPreview.completed} completed tasks, ${cleanupPreview.activity} old activity events, and ${cleanupPreview.diagnostics?'the expired diagnostic report':'no diagnostic report'}. Unfinished work is kept.`;$('cleanup-apply').disabled=false;}catch(e){$('cleanup-status').textContent=e.message;}};
$('cleanup-apply').onclick=async()=>{if(!cleanupPreview||!confirm('Apply the previewed local cleanup? This cannot be undone unless you exported a backup.'))return;try{await call('cleanup',{confirmed:true,expectedRevision:cleanupPreview.revision});cleanupPreview=null;$('cleanup-apply').disabled=true;$('cleanup-status').textContent='Cleanup applied locally.';await refresh(false);}catch(e){cleanupPreview=null;$('cleanup-apply').disabled=true;$('cleanup-status').textContent=e.message;}};
for(const [id,message]of [['clear-history','Delete all local task records and notes? Settings and saved webhook are retained.'],['recover','Recover only validated records and keep the original in a local recovery backup? Delivery will be disabled.'],['delete-recovery-backup','Permanently delete the local recovery backup? Primary task data is unchanged.']])$(id).onclick=async()=>{if(!confirm(message))return;try{await call(id,{confirmed:true});show('Local data action finished. Classroom is unchanged.');await refresh();}catch(e){show(e.message);}};
refresh().catch(e=>show(e.message));
