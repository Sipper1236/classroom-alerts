const { test } = require('node:test');
const a = require('node:assert/strict');
const C = require('./core');
const now = Date.parse('2026-11-05T23:00:00Z');
test('strict URL boundaries and observed account identity', () => {
  a.equal(C.classroomURL('https://classroom.google.com.evil.test/u/1/c/A'), null);
  a.equal(C.identity('https://classroom.google.com/u/1/c/A/a/B/details').itemId, 'B');
  a.equal(C.webhookURL('https://discord.com/api/webhooks/123/abc_DEF'), 'https://discord.com/api/webhooks/123/abc_DEF');
  for (const url of ['https://discord.com.evil.test/api/webhooks/123/abc','https://x@discord.com/api/webhooks/123/abc','http://discord.com/api/webhooks/123/abc']) a.equal(C.webhookURL(url), null);
});
test('deadlines preserve uncertainty and timezone semantics', () => {
  a.equal(C.dueDate('Nov 9, 9:02 AM','America/Halifax',now).at, Date.parse('2026-11-09T13:02:00Z'));
  a.equal(C.dueDate('Mon, Nov 9, 9:02 AM','UTC',now).at, Date.parse('2026-11-09T09:02:00Z'));
  a.equal(C.dueDate('Nov 9','UTC',now).at,null);
  a.equal(C.dueDate('Monday 9:02 AM','UTC',now).confidence,'ambiguous');
  a.equal(C.dueDate('02/03/2026','UTC',now).confidence,'ambiguous');
  a.equal(C.dueDate('Feb 30, 9:00 AM','UTC',now).confidence,'ambiguous');
  a.equal(C.dueDate('Nov 1, 2026, 1:30 AM','America/New_York',now).confidence,'ambiguous');
  a.equal(C.dueDate('Mar 8, 2026, 2:30 AM','America/New_York',now).confidence,'ambiguous');
  a.equal(C.dueDate('Jan 2','UTC',Date.parse('2026-12-31T12:00Z')).date,'2027-01-02');
});
test('merge uses stable identity, preserves detail/local edits, never deletes omitted items', () => {
  const s=C.emptyState(); s.settings.profile='school'; s.settings.accountPath='/u/1/'; s.settings.courses=['A'];
  const item={courseId:'A',itemId:'B',type:'assignment',title:'Task',url:'https://classroom.google.com/u/1/c/A/a/B/details',dueRaw:'Nov 9, 9:02 AM',source:'detail',status:'assigned'};
  a.equal(C.mergeItems(s,[item],now).length,1);
  s.items['school|A|B'].local.note='Keep';
  a.equal(C.mergeItems(s,[item],now+1000).length,0);
  C.mergeItems(s,[{...item,source:'summary',status:'unknown',dueRaw:''}],now+2000);
  a.equal(s.items['school|A|B'].dueRaw,item.dueRaw);
  a.equal(s.items['school|A|B'].local.note,'Keep');
  C.mergeItems(s,[],now+3000); a.equal(Object.keys(s.items).length,1);
  C.mergeItems(s,[{...item,courseId:'OTHER'}]); a.equal(Object.keys(s.items).length,1);
  a.equal(C.plan(s,now).length,1);
});
test('Discord chunks stay bounded and suppress mention text', () => {
  const out=C.messages(Array.from({length:50},()=>({title:'@everyone '+ 'x'.repeat(200),url:'https://classroom.google.com/u/1/c/A/a/B/details'})));
  a.ok(out.length>1); a.ok(out.every(m=>m.length<=2000)); a.ok(out.every(m=>!m.includes('@everyone')));
});
