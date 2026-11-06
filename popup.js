const $=id=>document.getElementById(id);
const call=(type,extra={})=>browser.runtime.sendMessage({type,...extra});
function error(e){$('status').textContent=e.message;if($('freshness').textContent.includes('Loading cached tasks')){$('freshness').textContent='Cached data unavailable. Open Dashboard to review the extension error; no homework status is known.';$('next').textContent='Unable to read cached records.';$('delivery').textContent='Discord status unavailable.';for(const id of ['scan','course','page'])$(id).disabled=true;}}
async function refresh(){
  const state=await call('state');
  $('version-warning').hidden=state.build?.compatible===true&&!state.versionAlerts?.length;
  $('version-warning').textContent=state.build?.compatible!==true?'Extension scripts are mixed or outdated. Reload Classroom Alerts in about:debugging and reload Classroom tabs.':
    state.versionAlerts?.length?'Classroom tab scripts are out of date. Reload affected Classroom tabs, then scan again. Dashboard lists the affected tabs.':'';
  for(const id of ['scan','course','page'])$(id).disabled=state.build?.compatible!==true||Boolean(state.recovery?.blocked);
  $('freshness').textContent=state.scan?`${state.scan.status}: ${state.scan.stage} · ${state.scan.checked}/${state.scan.total} courses checked`:'No complete scan yet. Open settings to confirm your account and courses.';
  $('next').replaceChildren();
  const task=state.plan[0];
  if(task){const a=document.createElement('a');a.href=task.url;a.target='_blank';a.rel='noopener';a.textContent=task.title;const p=document.createElement('p');p.textContent=task.reason;$('next').append(a,p);}
  else $('next').textContent=ClassroomCore.emptyMessage(state);
  $('delivery').textContent=state.deliveryError?`Discord delivery failed: ${state.deliveryError}`:!state.settings.webhook?'Discord not configured. Set up an approved private channel in Dashboard.':state.lastDeliveryAt?`Discord last sent ${new Date(state.lastDeliveryAt).toLocaleString()}`:'No Discord delivery verified yet.';
}
$('dashboard').onclick=()=>browser.runtime.openOptionsPage();
for(const id of ['scan','course','page'])$(id).onclick=async()=>{try{await call(id==='course'?'scan-current-course':id);$('status').textContent=id==='page'?'Page collected. Open Diagnostics for the report.':'Scan started; progress is in Dashboard.';await refresh();}catch(e){await refresh().catch(()=>{});error(e);}};
refresh().catch(error);
