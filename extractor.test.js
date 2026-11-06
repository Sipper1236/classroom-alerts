const {test}=require('node:test');
const a=require('node:assert/strict');
require('./core');
const E=require('./extractor');
test('date/status extraction does not use generic heading/list roles',()=>{
  a.equal(E.dueFrom('Your task\nDue Nov 9, 9:02 AM\nInstructions'),'Nov 9, 9:02 AM');
  a.equal(E.statusFrom('Instructions mention Assigned and Returned'),'unknown');
  a.equal(E.statusFrom('Your work\nTurned in'),'submitted');
  a.equal(E.dueFrom('No due date'),'');
  a.equal(E.dueFrom('SMU Library Visit\nThu, Nov 12, 11:59 PM\nClass learning tools'),'Thu, Nov 12, 11:59 PM');
});
