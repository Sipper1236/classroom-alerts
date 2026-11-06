(() => {
  // Capture the actually loaded scripts; getManifest() may already report a newer install.
  const build=globalThis.ClassroomBuild,core=globalThis.ClassroomCore,extractor=globalThis.ClassroomExtractor;
  if(globalThis.classroomAlertsLoaded)return;
  globalThis.classroomAlertsLoaded=true;
  function settled(quiet=100,maximum=450){return new Promise(resolve=>{
    let timer;const observer=new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(done,quiet);});
    const deadline=setTimeout(done,maximum);
    function done(){clearTimeout(timer);clearTimeout(deadline);observer.disconnect();resolve();}
    observer.observe(document.querySelector('main,[role="main"]')||document.body,{subtree:true,childList:true,characterData:true});
    timer=setTimeout(done,quiet);
  });}
  async function expandSafe(settings){
    const report={expanded:0,skipped:0,budgetExhausted:false};
    const main=document.querySelector('main,[role="main"]')||document.body;
    const candidates=[...main.querySelectorAll('button[aria-expanded="false"][aria-controls]')].slice(0,100);
    for(const control of candidates){
      const card=control.closest('[data-stream-item-id],[data-assignment-id],article'),panel=document.getElementById(control.getAttribute('aria-controls'));
      const label=(control.getAttribute('aria-label')||control.textContent).trim();
      const safeLabel=/^(?:show details|view assignment details|expand assignment)$/i.test(label)&&!/comment|submit|turn.?in|mark.?as.?done|delete|enrol|join/i.test(control.getAttribute('aria-controls'));
      const hasTask=card&&[...card.querySelectorAll('a[href]')].some(a=>{const id=core.identity(a.href);return id?.type==='assignment'&&id.itemId&&id.accountPath===settings.accountPath;});
      if(!safeLabel||!hasTask||!panel||!card.contains(panel)||control.closest('form')||panel.querySelector('form,input,textarea,[contenteditable="true"]')||!control.getClientRects().length){report.skipped++;continue;}
      if(report.expanded===8){report.budgetExhausted=true;break;}
      control.click();report.expanded++;await settled();
    }
    if(candidates.length===100)report.budgetExhausted=true;
    return report;
  }
  browser.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id!==browser.runtime.id || !message || message.type!=='collect')return undefined;
    return (async()=>{
      const handshake={protocol:build?.protocol,buildId:build?.id,contentVersion:build?.version,
        coreBuild:core?.buildId,extractorBuild:extractor?.buildId,requestId:message.requestId};
      if(!build||message.protocol!==build.protocol||message.expectedBuild!==build.id||core?.buildId!==build.id||extractor?.buildId!==build.id||typeof message.requestId!=='string'||!message.requestId||message.requestId.length>100){
        return {error:'SCRIPT_VERSION_MISMATCH',handshake};
      }
      let truncated=false,expansion={expanded:0,skipped:0,budgetExhausted:false};const initialURL=location.href;
      if(message.expand){
        expansion=await expandSafe(message.settings);
        // Scroll only after explicitly controlled read-only expansions; never click submit/comment controls.
        const oldY=scrollY;let prior=0,stable=0;
        for(let step=0;step<6;step++){
          window.scrollTo(0,document.documentElement.scrollHeight);
          await settled();
          if(location.href!==initialURL)throw new Error('Page changed during collection; retry the intended course');
          const count=document.querySelectorAll('a[href]').length;
          stable=count===prior?stable+1:0;prior=count;
          if(stable>=2)break;
          if(step===5)truncated=true;
        }
        window.scrollTo(0,oldY);
      }
      const result=extractor.extract(document,location.href,message.settings);
      result.report.truncated ||= truncated||expansion.budgetExhausted;
      result.report.expansion=expansion;
      result.report.version=build.version;
      result.handshake=handshake;
      const link=[...document.querySelectorAll('a[href]')].find(a=>a.textContent.trim()==='Classwork' && core.identity(a.href)?.courseId===core.identity(location.href)?.courseId);
      result.classworkURL=link?.href || null;
      return result;
    })();
  });
})();
