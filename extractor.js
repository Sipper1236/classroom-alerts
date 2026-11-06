(() => {
  const compact = text => String(text || '').replace(/\s+/g,' ').trim();
  const textOf = node => node?.innerText ?? node?.textContent ?? '';
  const titleOf = node => compact(textOf(node)).replace(/^(assignment|Assignment:)\s*:?\s*/,'').replace(/^"|"$/g,'');
  function dueFrom(text) {
    // Preserve line/card boundaries before falling back to a bounded English date expression.
    const line = text.split('\n').map(compact).find(t => /^Due\b/i.test(t) && !/^Due soon$/i.test(t));
    if (line && line.length < 100) return line.replace(/^Due(?: date)?\s*:?\s*/i,'');
    const calendarLine=text.split('\n').map(compact).find(t=>/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM))?$/i.test(t));
    if(calendarLine)return calendarLine;
    const match = compact(text).match(/\bDue(?: date)?\s*:?\s*((?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?(?:[A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?|Today|Tomorrow)(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM))?)/i);
    return match?.[1] || '';
  }
  function statusFrom(text) {
    const lines = text.split('\n').map(compact).filter(Boolean);
    const exact = lines.find(t => /^(Assigned|Turned in|Submitted|Returned|Missing)$/i.test(t));
    const word = exact || compact(text).match(/\bYour work\s+(Assigned|Turned in|Submitted|Returned|Missing)\b/i)?.[1];
    return /^turned in|submitted$/i.test(word || '') ? 'submitted' : /^(assigned|returned|missing)$/i.test(word || '') ? word.toLowerCase() : 'unknown';
  }
  function extract(doc, href, settings = {}) {
    const C=globalThis.ClassroomCore, url=C.classroomURL(href);
    if (!url) throw new Error('Unsupported origin');
    const route=C.identity(href), main=doc.querySelector('main, [role="main"]') || doc.body;
    const pageText=textOf(main).slice(0,200000), links=[...doc.querySelectorAll('a[href]')].slice(0,2000);
    const courses=new Map(), candidates=[], items=new Map(),provisional=[];let provisionalLimited=false;
    for (const link of links) {
      const id=C.identity(link.href);
      if (id && !id.itemId && /^\/u\/\d+\/c\/[^/]+\/?$/.test(new URL(id.url).pathname) && id.accountPath === (settings.accountPath || url.pathname.match(/^\/u\/\d+\//)?.[0])) {
        const name=titleOf(link).slice(0,150);
        if (name) courses.set(id.courseId,{courseId:id.courseId,name,url:id.url,accountPath:id.accountPath});
      }
    }
    const courseName=route ? settings.courseName || courses.get(route.courseId)?.name || doc.title.replace(/ - Classroom$/,'') : '';
    const detail=Boolean(route?.itemId && /\/details\/?$/.test(url.pathname));
    if (detail) {
      const title=doc.title.replace(/\s+-\s+Classroom$/i,'').trim();
      const type=route.type;
      const ownWork=main.querySelector('[data-your-work], [aria-label="Your work"]');
      const ownWorkText=ownWork?textOf(ownWork):pageText.match(/\bYour work\b([\s\S]*?)(?:\bPrivate comments\b|\bClass comments\b|$)/i)?.[1] || '';
      const gradeRegion=main.querySelector('[data-student-grade], [aria-label="Your grade"]');
      const grade = settings.grades ? (gradeRegion?textOf(gradeRegion):ownWorkText).match(/\b\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:points|pts)?\b/i)?.[0] || null : null;
      if (title) items.set(route.itemId,{...route,type,title,courseName,dueRaw:dueFrom(pageText),status:statusFrom(ownWorkText),source:'detail',
        instructions: compact(textOf(doc.querySelector('[data-assignment-description], [data-description]'))).slice(0,3000),
        grade, materials: settings.materials ? [...main.querySelectorAll('a[href]')].filter(a=>/^https:\/\/(drive|docs)\.google\.com\//.test(a.href)).slice(0,30).map(a=>({title:titleOf(a).slice(0,150),url:a.href})) : []});
    } else {
      for (const link of links) {
        const id=C.identity(link.href);
        if (!id?.itemId || id.accountPath !== (settings.accountPath || url.pathname.match(/^\/u\/\d+\//)?.[0])) continue;
        if (id.type !== 'assignment' && !(id.type==='material' ? settings.materials : settings.announcements)) continue;
        const card=link.closest('[data-stream-item-id], [data-assignment-id], article, li, [role="listitem"]') || link.parentElement;
        const cardText=textOf(card).slice(0,6000);
        const title=titleOf(card?.querySelector('h1,h2,h3,[role="heading"]') || link).slice(0,300);
        if (!title) { candidates.push({reason:'title-not-found',type:id.type}); continue; }
        const dueRaw=dueFrom(cardText);
        const item={...id,title,type:id.type,courseName: route?.courseId === id.courseId ? courseName : courses.get(id.courseId)?.name || '',dueRaw,status:statusFrom(cardText),source:'summary'};
        if(id.type!=='assignment')item.instructions=compact(textOf(card?.querySelector('[data-announcement-text], [data-post-text], [data-material-description]'))).slice(0,3000);
        if (!items.has(`${id.courseId}|${id.itemId}`)) items.set(`${id.courseId}|${id.itemId}`,item);
        candidates.push({type:id.type,accepted:true,hasDue:Boolean(dueRaw),reason:dueRaw?'structured-link':'deadline-needs-detail',...(settings.verbose?{title,text:compact(cardText).slice(0,250)}:{})});
      }
      if(route&&!route.itemId&&route.accountPath===settings.accountPath){
        const cards=[...main.querySelectorAll('[data-assignment-id], [data-stream-item-id], article')].slice(0,500);
        provisionalLimited=cards.length===500;
        for(const card of cards){
          const heading=card.querySelector('[data-assignment-title],h1,h2,h3,[role="heading"]');
          if(!card.getClientRects().length||card.closest('nav,aside,form,[role="navigation"]')||card.querySelector('form,textarea,[contenteditable="true"]')||!heading?.getClientRects().length)continue;
          if(!card.hasAttribute('data-assignment-id')&&!/^Assignment\s*:/i.test(textOf(heading))&&!card.querySelector('[aria-label="Assignment"]'))continue;
          // A linked card already has real identity; never create a second title-based task.
          if([...card.querySelectorAll('a[href]')].some(a=>{const id=C.identity(a.href);return id&&(id.itemId||id.courseId!==route.courseId||id.accountPath!==route.accountPath);})||card.parentElement?.closest('[data-assignment-id], [data-stream-item-id], article'))continue;
          const title=titleOf(heading).slice(0,300);if(!title)continue;
          provisional.push({courseId:route.courseId,scopeURL:url.href,title,dueRaw:dueFrom(textOf(card).slice(0,6000).split(/Private comments|Class comments/i)[0])});
          if(provisional.length===50){provisionalLimited=true;break;}
        }
      }
    }
    const emptyMarker=[...main.querySelectorAll('[role="status"],[data-classwork-empty]')].find(node=>node.getClientRects().length&&/^(?:No classwork(?: yet)?|No assignments yet)$/i.test(compact(textOf(node))));
    const emptyStateTrusted=Boolean(route&&!route.itemId&&/\/m\/?$/.test(url.pathname)&&!items.size&&!provisional.length&&emptyMarker);
    const report={version: settings.version || 'development',scannedAt:Date.now(),route:detail?'detail':route?'course':'home',emptyStateTrusted,
      accountPath:url.pathname.match(/^\/u\/\d+\//)?.[0] || '',scope:'current-page',
      counts:{links:links.length,courses:courses.size,items:items.size,candidates:candidates.length,provisional:provisional.length},
      candidates:candidates.slice(0,30),truncated:links.length>=2000||pageText.length>=200000||provisionalLimited,
      warning:provisional.length?'Assignment summaries lack stable links; verify them in Classroom.':items.size||emptyStateTrusted ? null : 'No supported item links found; this is not evidence of no homework.',
      ...(settings.verbose?{pageTitle:doc.title,bodyTextSample:compact(pageText).slice(0,1000)}:{})};
    return {url:url.href,courses:[...courses.values()],items:[...items.values()],provisional,report};
  }
  const api={buildId:globalThis.ClassroomBuild?.id || 'unstamped',extract,dueFrom,statusFrom};
  globalThis.ClassroomExtractor=api;
  if(typeof module!=='undefined') module.exports=api;
})();
