const { chromium, webkit } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../01-code/app');
(async () => {
 const server = http.createServer((req,res) => {
  const file = path.join(root, new URL(req.url,'http://localhost').pathname);
  if (!file.startsWith(root) || !fs.existsSync(file)) {res.writeHead(404);res.end();return;}
  const ext = path.extname(file);
  res.setHeader('Content-Type', ({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.csv':'text/csv'})[ext] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base = `http://127.0.0.1:${server.address().port}`;
 try {
 for (const [name, type] of [['Chromium',chromium],['WebKit',webkit]]) {
  const browser=await type.launch();
  try {
   for (const mode of ['ready-with-silent-auth','stalled-initializer']) {
    const context=await browser.newContext({serviceWorkers:'block'});
    await context.addInitScript(() => {
     if (localStorage.getItem('audit-seeded')) return; localStorage.setItem('audit-seeded','1'); localStorage.setItem('barkTermsAgreement','1');
     localStorage.setItem('bark.lastAuthenticatedVisitUid','audit-user');
     localStorage.setItem('bark.authoritativeVisits.audit-user',JSON.stringify({schemaVersion:1,uid:'audit-user',visits:[{id:'6b5a8134-6afb-4b93-8065-d10d3696eb5e',name:'Acadia',lat:44.4089658,lng:-68.2472733,ts:100,verified:false}]}));
     localStorage.setItem('bark.offlinePremiumSession.v1', JSON.stringify({uid:'audit-user',displayName:'Audit',email:'audit@example.com',cachedAt:Date.now(),entitlement:{premium:true,status:'active',source:'lemon_squeezy',currentPeriodEnd:Date.now()+86400000}}));
    });
    await context.route('**/*',async route=>{
     const url=route.request().url();
     if(!url.startsWith(base)) return route.abort();
     if(url.includes('services/authService.v145.js')) {
      const response=await route.fetch();
      return route.fulfill({response,body:(await response.text())+`\nwindow.BARK.services.auth.initFirebase = () => ${mode==='stalled-initializer'?'new Promise(() => {})':'Promise.resolve()'};`});
     }
     return route.continue();
    });
    const page=await context.newPage();
    await page.clock.install();
    await page.goto(base+'/index.v145.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.BARK?.repos?.ParkRepo?.getAll().length>300);
    await page.clock.fastForward(1500);
    const result=await page.evaluate(async()=>{
     const repo=window.BARK.repos.VaultRepo;
     const old=repo.getVisit('6b5a8134-6afb-4b93-8065-d10d3696eb5e');
     const before=localStorage.getItem('bark.authoritativeVisits.audit-user');
     let removal;
     try {removal=window.BARK.services.firebase.removeVisitedEntries([{id:old.id,record:old}]);}catch(e){removal={error:e.code,message:e.message};}
     const park=window.BARK.repos.ParkRepo.getAll().find(p=>p.id!==old.id);
     const add=await window.BARK.services.checkin.markAsVisited(park);
     return {green:!!old,offlinePremium:window.BARK.services.premium.getActiveOfflineSession()?.uid||null,removal,add:{success:add.success,message:add.message,syncStatus:add.syncStatus},baselineUnchanged:before===localStorage.getItem('bark.authoritativeVisits.audit-user'),deleteJournal:localStorage.getItem('bark.pendingVisitDeletes.audit-user')};
    });
    console.log(JSON.stringify({engine:name,mode,result}));
    if (!result.green || result.offlinePremium !== 'audit-user' || result.removal.syncStatus !== 'pending' || !result.add.success || !result.deleteJournal) throw new Error('Early editing failed');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.BARK?.repos?.ParkRepo?.getAll().length>300);
    await page.clock.fastForward(1500);
    const restored = await page.evaluate(()=>({removed:!window.BARK.repos.VaultRepo.hasVisit('6b5a8134-6afb-4b93-8065-d10d3696eb5e'),pending:window.BARK.repos.VaultRepo.getPendingMutationType('6b5a8134-6afb-4b93-8065-d10d3696eb5e')}));
    if (!restored.removed || restored.pending !== 'delete') throw new Error('Deletion reload failed');
    console.log('PASS early editing and durable reload: '+name+' '+mode);
    await context.close();
   }
  } finally {await browser.close();}
 }
 } finally {await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
