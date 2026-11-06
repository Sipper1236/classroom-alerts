// Development-only browser dependency, not shipped with the extension.
const {test}=require('node:test');
const a=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');
test('DOM extraction handles final home card, details, identity and opt-in data',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/home/rayyan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
  try{
    const page=await browser.newPage();
    await page.setContent(`<main><h1>Home</h1><a href="https://classroom.google.com/u/1/c/A">Mathematics</a><h2>Due soon</h2>
      <article><a href="https://classroom.google.com/u/1/c/A/a/B/details">Logarithm Practice</a><p>Due Nov 9, 9:02 AM</p></article>
      <article><a href="https://classroom.google.com/u/1/c/A/a/C/details">SMU Library Visit</a><p>Due Nov 12, 11:59 PM</p></article><h2>Class learning tools</h2>
      <article><a href="https://classroom.google.com/u/1/c/A/a/D/details">No deadline task</a></article>
      <a href="https://classroom.google.com/u/0/c/A/a/PRIVATE/details">Wrong account</a></main>`);
    await page.addScriptTag({path:path.join(__dirname,'core.js')});await page.addScriptTag({path:path.join(__dirname,'extractor.js')});
    let result=await page.evaluate(()=>ClassroomExtractor.extract(document,'https://classroom.google.com/u/1/h/st',{accountPath:'/u/1/'}));
    a.equal(result.items.length,3);a.equal(result.items[1].title,'SMU Library Visit');a.equal(result.items[2].dueRaw,'');
    a.ok(!JSON.stringify(result.report).includes('SMU'));
    await page.setContent('<title>Logarithm Practice - Classroom</title><main><p>Instructions mention Returned</p><p>Due Nov 9, 9:02 AM</p><div>Your work</div><div>Assigned</div><p>8 / 10 points</p></main>');
    result=await page.evaluate(()=>ClassroomExtractor.extract(document,'https://classroom.google.com/u/1/c/A/a/B/details',{accountPath:'/u/1/'}));
    a.equal(result.items[0].title,'Logarithm Practice');a.equal(result.items[0].status,'assigned');a.equal(result.items[0].grade,null);
    result=await page.evaluate(()=>ClassroomExtractor.extract(document,'https://classroom.google.com/u/1/c/A/a/B/details',{accountPath:'/u/1/',grades:true}));
    a.equal(result.items[0].grade,'8 / 10 points');
  }finally{await browser.close();}
});
test('academic extraction limits grade evidence to own-work regions and excludes private comments from post bodies',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/home/rayyan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
  try{
    const page=await browser.newPage();await page.setContent('<title>Task - Classroom</title><main><p>Instruction example: 99 / 100 points</p><div data-assignment-description>Read chapter one</div><section data-your-work><p>Assigned</p></section><p>Private comments: 4 / 10 points</p></main>');
    await page.addScriptTag({path:path.join(__dirname,'core.js')});await page.addScriptTag({path:path.join(__dirname,'extractor.js')});
    let result=await page.evaluate(()=>ClassroomExtractor.extract(document,'https://classroom.google.com/u/1/c/A/a/B/details',{accountPath:'/u/1/',grades:true}));
    a.equal(result.items[0].grade,null);a.equal(result.items[0].instructions,'Read chapter one');a.equal(result.items[0].status,'assigned');
    await page.setContent('<main><article><a href="https://classroom.google.com/u/1/c/A/p/P">Notice</a><p data-announcement-text>Library visit Thursday</p><p>Private comment: do not collect</p></article><article><a href="https://classroom.google.com/u/1/c/A/m/M/details">Slides</a><p data-material-description>Chapter slides</p></article></main>');
    result=await page.evaluate(()=>ClassroomExtractor.extract(document,'https://classroom.google.com/u/1/c/A',{accountPath:'/u/1/',announcements:true,materials:true}));
    a.equal(result.items.length,2);a.equal(result.items[0].instructions,'Library visit Thursday');a.ok(!JSON.stringify(result.items).includes('Private comment'));
  }finally{await browser.close();}
});
test('empty-course recognition requires a visible exact status marker on a Classwork route',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/home/rayyan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
  try{
    const page=await browser.newPage();await page.setContent('<main><p role="status">No classwork yet</p></main>');
    await page.addScriptTag({path:path.join(__dirname,'core.js')});await page.addScriptTag({path:path.join(__dirname,'extractor.js')});
    const extract=()=>page.evaluate(()=>ClassroomExtractor.extract(document,'https://classroom.google.com/u/1/c/A/m',{accountPath:'/u/1/'}));
    a.equal((await extract()).report.emptyStateTrusted,true);
    await page.setContent('<main><p role="status" hidden>No classwork yet</p></main>');a.equal((await extract()).report.emptyStateTrusted,false);
    await page.setContent('<main><p>Instructions say: No classwork yet</p></main>');a.equal((await extract()).report.emptyStateTrusted,false);
  }finally{await browser.close();}
});
test('no-link summaries require visible assignment-card evidence and a known course; duplicates are not invented identities',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || '/home/rayyan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'});
  try{
    const page=await browser.newPage();await page.setContent(`<main>
      <article data-assignment-id=""><h3>Same title</h3><p>Due Nov 9, 9:02 AM</p></article>
      <article><h3>Assignment: Same title</h3></article>
      <article><h3>Generic news</h3><p>Due Nov 9</p></article>
      <nav><article data-assignment-id=""><h3>Navigation</h3></article></nav>
      <article data-assignment-id="" hidden><h3>Hidden</h3></article>
      <article data-assignment-id=""><h3>Private form</h3><form><textarea>Private comment</textarea></form></article>
      <article data-assignment-id=""><h3>Linked</h3><a href="https://classroom.google.com/u/1/c/A/a/B/details">Open</a></article>
      <article data-assignment-id=""><h3>Foreign course</h3><a href="https://classroom.google.com/u/1/c/Z">Other course</a></article>
      <p role="status">No classwork yet</p></main>`);
    await page.addScriptTag({path:path.join(__dirname,'core.js')});await page.addScriptTag({path:path.join(__dirname,'extractor.js')});
    const collect=url=>page.evaluate(url=>ClassroomExtractor.extract(document,url,{accountPath:'/u/1/'}),url);
    const result=await collect('https://classroom.google.com/u/1/c/A/m');a.equal(result.provisional.length,2);a.deepEqual(result.provisional.map(row=>row.title),['Same title','Same title']);
    a.equal(result.provisional[0].dueRaw,'Nov 9, 9:02 AM');a.equal(result.items.length,1);a.equal(result.report.emptyStateTrusted,false);a.equal(result.report.counts.provisional,2);
    a.ok(!JSON.stringify(result.provisional).includes('Private'));a.equal((await collect('https://classroom.google.com/u/1/h/st')).provisional.length,0);a.equal((await collect('https://classroom.google.com/u/0/c/A/m')).provisional.length,0);
    await page.setContent('<main>'+Array.from({length:51},(_,i)=>`<article data-assignment-id=""><h3>Task ${i}</h3></article>`).join('')+'</main>');
    const bounded=await collect('https://classroom.google.com/u/1/c/A/m');a.equal(bounded.provisional.length,50);a.equal(bounded.report.truncated,true);
  }finally{await browser.close();}
});
