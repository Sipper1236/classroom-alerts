const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE = `(?:${MONTH}\\s+\\d{1,2}(?:,\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|\\d{4}-\\d{2}-\\d{2})`;
const WEEKDAY = '(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)';
const TIME = '\\d{1,2}:\\d{2}\\s*(?:AM|PM)';
const DUE_VALUE = `(?:${DATE}(?:,?\\s+${TIME})?|${WEEKDAY},?\\s+${TIME})`;

function extractVisibleDue(text) {
  const match = (text || '').replace(/\s+/g, ' ').match(
    new RegExp(`\\bDue(?:\\s+date)?\\s*:?\\s*(${DUE_VALUE})`, 'i')
  );
  return match?.[1]?.trim() || null;
}

function parseDetailAssignment(title, text) {
  const due = extractVisibleDue(text);
  const status = (text || '').match(/\b(Assigned|Turned in|Returned|Missing)\b/i)?.[1] || null;
  return { title: title?.trim() || null, due, status, accepted: Boolean(title?.trim() && due) };
}

function parseUpcomingAssignments(text) {
  const normalized = (text || '').replace(/\s+/g, ' ');
  const match = normalized.match(/\bUpcoming\s+Due\s+(.+?)\s+[–—-]\s+(.+?)\s+View all\b/i);
  if (!match) return [];
  return [{ title: match[2].trim(), due: match[1].trim(), status: 'Upcoming' }];
}

function parseTodoAssignments(text) {
  const normalized = (text || '').replace(/\s+/g, ' ');
  if (!/\bDue soon\b/i.test(normalized)) return [];
  const dateTime = `(${WEEKDAY},?\\s+${MONTH}\\s+\\d{1,2},\\s+${TIME})`;
  const pattern = new RegExp(`${dateTime}\\s+(.+?)\\s+assignment\\b`, 'gi');
  return [...normalized.matchAll(pattern)].map((match) => ({
    title: match[2].trim(), due: match[1].trim(), status: 'Due soon'
  }));
}

if (typeof module !== 'undefined') module.exports = {
  extractVisibleDue,
  parseDetailAssignment,
  parseUpcomingAssignments,
  parseTodoAssignments
};
