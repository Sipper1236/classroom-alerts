/* Shared pure logic: no timers, network, browser profile access, or dependencies. */
(() => {
  const defaults = {
    profile: '', accountPath: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    courses: [], intervalMinutes: 60, digestHour: 16, quietStart: 21, quietEnd: 7,
    reminderHours: [24, 3], remindersEnabled: true, digestEnabled: true, notifyNew: true, notifyDeadline: true,
    notifyHealth:true,healthStaleHours:24,
    notificationGapMinutes: 15, webhook: '', verbose: false, verboseUntil:0,
    completedRetentionDays: 0, diagnosticRetentionHours: 24, historyRetentionDays: 30,
    announcements: false, materials: false, grades: false, shareGrades: false
  };

  function classroomURL(value, base = 'https://classroom.google.com/') {
    try {
      const u = new URL(value, base);
      if (u.origin !== 'https://classroom.google.com' || u.username || u.password) return null;
      u.hash = ''; u.search = '';
      return u;
    } catch { return null; }
  }

  function identity(value) {
    const u = classroomURL(value);
    if (!u) return null;
    const match = u.pathname.match(/^\/u\/(\d{1,3})\/c\/([A-Za-z0-9_-]{1,200})(?:\/(a|m|p)\/([A-Za-z0-9_-]{1,200})(?:\/details)?|\/(?:m|p|t\/all))?\/?$/);
    if (!match) return null;
    if([match[2],match[4]].some(id=>['__proto__','constructor','prototype'].includes(id)))return null;
    return { accountPath: `/u/${match[1]}/`, courseId: match[2], itemId: match[4] || null,
      type: match[3] === 'a' ? 'assignment' : match[3] === 'm' ? 'material' : 'announcement', url: u.href };
  }

  function webhookURL(value) {
    try {
      const u = new URL(value.trim());
      return u.protocol === 'https:' && u.hostname === 'discord.com' && !u.port && !u.username && !u.password &&
        /^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.hash && !u.search ? u.href : null;
    } catch { return null; }
  }

  function zonedParts(date, timezone) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
  }

  function dueDate(raw, timezone, now = Date.now()) {
    const result = { raw: String(raw || '').trim(), timezone, confidence: 'unknown', at: null, date: null };
    if (!result.raw || /^no due date$/i.test(result.raw)) return result;
    let today;
    try { today = zonedParts(new Date(now), timezone); } catch { return { ...result, confidence: 'ambiguous' }; }
    let value = result.raw.replace(/^Due(?: date)?\s*:?\s*/i, '').replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?[,]?\s+(?=[A-Za-z]+\s+\d)/i, '');
    let year, month, day, inferred = false;
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    let match = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
    if (match && months.includes(match[1].slice(0,3).toLowerCase())) {
      month = months.indexOf(match[1].slice(0,3).toLowerCase()) + 1; day = Number(match[2]); year = Number(match[3] || today.year); inferred = !match[3];
      // A >6-month displacement is a year-boundary inference, not a weekday rollover.
      if (inferred && month - today.month < -6) year++;
      if (inferred && month - today.month > 6) year--;
    } else if ((match = value.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
      [,year,month,day] = match.map(Number);
    } else if (/^(today|tomorrow)\b/i.test(value)) {
      const d = new Date(Date.UTC(today.year, today.month - 1, today.day + (/^tomorrow/i.test(value) ? 1 : 0)));
      year = d.getUTCFullYear(); month = d.getUTCMonth() + 1; day = d.getUTCDate(); inferred = true;
    } else return { ...result, confidence: 'ambiguous' };
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { ...result, confidence: 'ambiguous' };
    result.date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    result.confidence = inferred ? 'inferred' : 'confirmed';
    const time = value.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
    if (!time) return result; // Date-only is deliberately not converted to midnight or 11:59 PM.
    let hour = Number(time[1]), minute = Number(time[2]);
    if (minute > 59 || hour > (time[3] ? 12 : 23) || (time[3] && hour < 1)) return { ...result, confidence: 'ambiguous' };
    if (time[3]) hour = hour % 12 + (/pm/i.test(time[3]) ? 12 : 0);
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let instant = target;
    for (let i = 0; i < 3; i++) {
      const p = zonedParts(new Date(instant), timezone);
      instant += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    }
    const p = zonedParts(new Date(instant), timezone);
    if (p.year !== year || p.month !== month || p.day !== day || p.hour !== hour || p.minute !== minute) return { ...result, confidence: 'ambiguous' };
    // Fall-back repeated wall times are ambiguous; never pick one silently.
    for (const delta of [-3600000,3600000]) {
      const alt = zonedParts(new Date(instant + delta), timezone);
      if (alt.year === year && alt.month === month && alt.day === day && alt.hour === hour && alt.minute === minute) return { ...result, confidence: 'ambiguous' };
    }
    result.at = instant; return result;
  }

  function emptyState() { return { schemaVersion: 2, revision:0, monitoringStartedAt:0,lastNotificationCheckAt:0,deliveryNotBefore:0,settings: { ...defaults, courses:[], reminderHours:[...defaults.reminderHours] }, courses: {}, items: {}, provisional:[],queue: [], delivered: {}, activity: [], versionAlerts:[], scan: null }; }
  function itemKey(profile, item) { return `${profile}|${item.courseId}|${item.itemId}`; }
  function deadlineSignature(item) {
    const due=item?.due;
    if(Number.isFinite(due?.at))return `instant:${due.at}`;
    if(due?.date && due.confidence!=='ambiguous')return `date:${due.date}`;
    if(/^no due date$/i.test(item?.dueRaw || ''))return 'no-date';
    return null;
  }
  function mergeItems(state, incoming, now = Date.now()) {
    const changes = [];
    for (const item of incoming.slice(0,500)) {
      if (!item.courseId || !item.itemId || !item.title || !classroomURL(item.url)) continue;
      const id = identity(item.url);
      if (!id || id.courseId !== item.courseId || id.itemId !== item.itemId || id.accountPath !== state.settings.accountPath) continue;
      const key = itemKey(state.settings.profile, item), old = state.items[key];
      const detailed = item.source === 'detail';
      const merged = { ...old, ...item, key, firstSeenAt: old?.firstSeenAt || now, lastSeenAt: now,
        local: old?.local || { status: 'not-started', note: '', minutes: null, snoozeUntil: 0 },
        due: dueDate(item.dueRaw, state.settings.timezone, now) };
      delete merged.notSeenAt;delete merged.notSeenIn;
      if(detailed){merged.verificationNeeded=false;merged.imported=false;}
      else if(old?.imported){merged.imported=true;merged.verificationNeeded=true;merged.status='unknown';}
      if (old?.source === 'detail' && !detailed) {
        const dueConflict=Boolean(item.dueRaw && deadlineSignature(merged)!==deadlineSignature(old));
        const statusConflict=Boolean(item.status && item.status!=='unknown' && item.status!==old.status);
        merged.verificationNeeded=Boolean(old.verificationNeeded || dueConflict || statusConflict);
        for (const field of ['status','due','dueRaw','instructions','grade','source','lastVerifiedAt']) merged[field] = old[field];
      }
      merged.completedAt=merged.status==='submitted'?(old?.status==='submitted'?old.completedAt || old.lastSeenAt || now:now):0;
      if (detailed) merged.lastVerifiedAt = now;
      if(state.settings.grades&&detailed&&typeof item.grade==='string'&&item.grade!==old?.grade){
        merged.gradeHistory=[...(old?.gradeHistory || []),{at:now,value:item.grade}].slice(-10);
      }
      if(!state.settings.grades){delete merged.grade;delete merged.gradeHistory;}
      const revision = JSON.stringify([merged.title, merged.dueRaw, merged.status, merged.grade]);
      const before=deadlineSignature(old),after=deadlineSignature(merged);
      const deadlineChanged=Boolean(old?.source==='detail' && detailed && before && after && before!==after);
      merged.deadlineRevision=(old?.deadlineRevision || 0)+(deadlineChanged?1:0);
      if (!old || old.revision !== revision) changes.push({ key, type: old ? 'changed' : 'new', at: now, deadlineChanged, previousDeadline:before });
      merged.revision = revision; state.items[key] = merged;
    }
    state.activity = [...changes, ...state.activity].slice(0,100);
    return changes;
  }

  function schoolDay(timezone,now=Date.now()){
    const p=zonedParts(new Date(now),timezone);return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
  }
  function plan(state, now = Date.now()) {
    const today=schoolDay(state.settings.timezone,now);
    return Object.values(state.items).filter(item => item.type === 'assignment' && state.settings.courses.includes(item.courseId) &&
      item.status !== 'submitted' && item.local?.status !== 'complete').map(item => {
      const due = item.due?.at;
      const hours = due == null ? null : (due - now) / 3600000;
      let priority = hours == null ? 1000 : Math.max(-72, hours);
      if (item.status === 'missing') priority -= 24;
      if (item.local?.snoozeUntil > now) priority += 10000;
      const reason = [hours == null ? (item.due?.date ? 'Date-only deadline; check time' : 'Deadline needs review') : hours < 0 ? 'Deadline has passed' : `Due in ${Math.ceil(hours)} hours`,
        item.status === 'unknown' ? 'Submission status needs verification' : `Classroom: ${item.status}`,
        item.local?.minutes ? `Your estimate: ${item.local.minutes} min` : 'Effort not estimated'];
      if (item.source !== 'detail') reason.push('Summary only');
      if (item.verificationNeeded) reason.push('Summary changed; detail verification needed');
      if (item.imported) reason.push('Imported snapshot; verify in Classroom before alerts');
      if (item.notSeenAt) reason.push('Not seen in last successful bounded course scan; not proof of removal or completion');
      const pinnedToday=item.local?.pinnedDay===today;
      if(pinnedToday)reason.push("Pinned for today's plan");
      if(item.local?.snoozeUntil>now)reason.push(`Snoozed until ${new Date(item.local.snoozeUntil).toLocaleString('en-US',{timeZone:state.settings.timezone})} (${state.settings.timezone})`);
      return { ...item, priority,pinnedToday, reason: reason.join(' · ') };
    }).sort((a,b) => Number(b.pinnedToday&&!(b.local?.snoozeUntil>now))-Number(a.pinnedToday&&!(a.local?.snoozeUntil>now)) || a.priority - b.priority || a.title.localeCompare(b.title));
  }

  function quiet(settings, now = Date.now()) {
    const hour = zonedParts(new Date(now), settings.timezone).hour;
    return settings.quietStart === settings.quietEnd ? false : settings.quietStart < settings.quietEnd ?
      hour >= settings.quietStart && hour < settings.quietEnd : hour >= settings.quietStart || hour < settings.quietEnd;
  }

  function emptyMessage(state){
    if(state.recovery?.blocked)return 'Saved data needs recovery. Open Data recovery in Dashboard; automation is blocked.';
    if(state.scan?.status==='running')return 'Scan in progress. Results within the checked scope are not complete yet.';
    if(state.scan?.status==='failed')return `Scan failed: ${state.scan.stage}. Cached records may be incomplete.`;
    if(state.scan?.failed?.length)return 'Some courses failed. Review course errors and retry; this is not evidence of no homework.';
    if(state.provisional?.some(row=>state.settings.courses.includes(row.courseId)))return 'Unverified assignment summaries need review. Open provisional summaries in Dashboard; do not assume there is no homework.';
    if(state.report?.warning&&state.report.counts?.items===0)return 'No recognized tasks on this page layout. Check Diagnostics; this is not evidence of no homework.';
    if(!Object.keys(state.items).length&&!state.report&&!state.scan)return 'No data collected yet. Confirm your account and courses in Settings, then scan.';
    return 'No unfinished tasks found within the checked scope. Check scan coverage before assuming there is no homework.';
  }
  function safeText(value,limit=400) { return String(value || '').replace(/([\\*_~`>|])/g, '\\$1').replace(/@/g,'＠').slice(0,limit); }
  function messages(items, heading = 'Classroom check-in') {
    const chunks = []; let text = heading;
    for (const item of items.slice(0,100)) {
      if(!identity(item.url))continue;
      const deadline=item.verificationNeeded?'Deadline/status needs recheck':item.dueRaw || 'No confirmed deadline';
      const status=item.verificationNeeded?'Status needs recheck':item.status;
      const row = `\n• **${safeText(item.title,220)}** — ${safeText(item.courseName,100)}\n${safeText(deadline,100)} · ${safeText(status,40)}${item.reason?`\n${safeText(item.reason,250)}`:''}\n<${classroomURL(item.url).href}>`;
      if (text.length + row.length > 1900) { chunks.push(text); text = heading + ' (continued)'; }
      text += row;
    }
    if (items.length) chunks.push(text);
    return chunks;
  }

  const api = { buildId:globalThis.ClassroomBuild?.id || 'unstamped',defaults, classroomURL, identity, webhookURL, dueDate, zonedParts,schoolDay, emptyState, itemKey, deadlineSignature, mergeItems, plan, quiet,emptyMessage, messages };
  if (typeof module !== 'undefined') module.exports = api;
  globalThis.ClassroomCore = api;
})();
