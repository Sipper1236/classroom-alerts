const assert = require('node:assert/strict');
const {
  extractVisibleDue,
  parseDetailAssignment,
  parseUpcomingAssignments,
  parseTodoAssignments
} = require('./assignment-parser');

const body = 'Logarithm Practice - Classroom assignment Logarithm Practice more options Julie Boudreau • 7:38 AM Due Nov 9, 9:02 AM Please complete the following questions for next class. Your work Assigned';
assert.equal(extractVisibleDue(body), 'Nov 9, 9:02 AM');
assert.equal(extractVisibleDue('Upcoming Due Monday 9:02 AM – Logarithm Practice View all'), 'Monday 9:02 AM');
assert.deepEqual(parseDetailAssignment('Logarithm Practice - Classroom', body), {
  title: 'Logarithm Practice - Classroom',
  due: 'Nov 9, 9:02 AM',
  status: 'Assigned',
  accepted: true
});
assert.deepEqual(parseUpcomingAssignments('Upcoming Due Monday 9:02 AM – Logarithm Practice View all edit'), [
  { title: 'Logarithm Practice', due: 'Monday 9:02 AM', status: 'Upcoming' }
]);
assert.deepEqual(parseTodoAssignments('Due soon View To-do collapse_content Collapse Logarithm Practice Class Math Learn with Gemini Mon, Nov 9, 9:02 AM Logarithm Practice assignment SMU Library Visit Class Research Thu, Nov 12, 11:59 PM SMU Library Visit assignment'), [
  { title: 'Logarithm Practice', due: 'Mon, Nov 9, 9:02 AM', status: 'Due soon' },
  { title: 'SMU Library Visit', due: 'Thu, Nov 12, 11:59 PM', status: 'Due soon' }
]);
assert.deepEqual(parseTodoAssignments('No due soon assignments here'), []);
assert.equal(extractVisibleDue('No due date shown'), null);
