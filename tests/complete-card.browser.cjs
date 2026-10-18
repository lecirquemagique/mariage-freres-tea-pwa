'use strict';
// Every request is intercepted. Replies and queue state are local mocks; no GAS/Sheets implementation dependency.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'..');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const x={master:[['VersionKey','Primary Reference','Tリファレンス番号','現在の公式名','銘柄名（黒い本）'],...['T146-B01','T146-C01','T1620-B01','T1620-C01'].map(k=>[k,k.split('-')[0],k.split('-')[0],k,''])],queue:[['versionKey']],writes:[],request(p){if(p.dryRun)return{ok:true,status:'dry_run',versionKey:p.versionKey};if(this.queue.slice(1).some(r=>r.versionKey===p.versionKey))return{ok:true,status:'already_queued',versionKey:p.versionKey};this.queue.push({versionKey:p.versionKey});this.writes.push(p);return{ok:true,status:'queued',versionKey:p.versionKey};}},masterBefore=JSON.stringify(x.master),rows=x.master.slice(1).map(r=>Object.fromEntries(x.master[0].map((h,i)=>[h,r[i]])));
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();let posts=0,mode='normal';const errors=[],payloads=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
  if(u.pathname==='/api'&&req.method()==='GET')return route.fulfill({contentType:'application/javascript',body:u.searchParams.get('callback')+'('+JSON.stringify({ok:true,rows,updatedAt:'2026-10-18'})+');'});
  if(u.pathname==='/api'&&req.method()==='POST'){
   posts++;assert.equal(req.headers()['content-type'],'text/plain;charset=utf-8');const payload=JSON.parse(req.postData());payloads.push(payload);
   assert.equal(payload.action,'requestResearch');assert.equal(payload.requestType,'complete_card');assert(Number.isFinite(Date.parse(payload.requestedAt)));assert(!Object.hasOwn(payload,'missing_fields'));assert(!Object.hasOwn(payload,'source'));
   if(mode==='network')return route.abort();await new Promise(resolve=>setTimeout(resolve,180));
   const response=mode==='normal'?x.request(payload):{ok:false,status:mode,reason:mode==='reference_mismatch'?'reference_mismatch':'<img src=x onerror="window.__xss=1">'};
   return route.fulfill({contentType:'application/json',body:JSON.stringify(response)});
  }
  if(u.pathname==='/app-config.js')return route.fulfill({contentType:'application/javascript',body:'window.MF_APP_CONFIG={GAS_API_URL:"https://mf.test/api"};'});
  const file=u.pathname==='/'?'index.html':u.pathname.slice(1);
  if(['index.html','sales-state.js'].includes(file))return route.fulfill({path:path.join(root,file)});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('https://mf.test');await page.waitForFunction(()=>document.querySelectorAll('.card').length===4);
 const button=key=>page.locator('.card[data-version-key="'+key+'"] .research-button'),card=key=>page.locator('.card[data-version-key="'+key+'"]');
 const confirm=async key=>{await button(key).click();assert.equal(await page.locator('#researchDialog').isVisible(),true);await page.click('#confirmResearch');};
 await button('T146-B01').evaluate(e=>{for(let i=0;i<20;i++)e.click();});assert.equal(posts,0);assert.equal(await page.locator('#researchDialogName').innerText(),'T146-B01');assert.equal(await page.locator('#researchDialogRef').innerText(),'REF：T146');
 assert.equal(await page.locator('#researchDialogMessage').innerText(),'この銘柄の不足情報を調査キューへ送ります');await page.click('#cancelResearch');assert.equal(posts,0);
 await button('T146-B01').click();await page.locator('#confirmResearch').evaluate(e=>{for(let i=0;i<20;i++)e.click();});assert.equal(await button('T146-B01').isDisabled(),true);
 await page.waitForFunction(()=>document.querySelector('.research-button').textContent.includes('依頼済み'));assert.equal(posts,1);assert.equal(x.writes.length,1);assert.match(await card('T146-B01').innerText(),/調査依頼を登録しました/);
 await page.fill('#q','T146');assert.match(await button('T146-B01').innerText(),/依頼済み/);await page.fill('#q','');
 for(const key of ['T146-C01','T1620-B01','T1620-C01']){await confirm(key);await page.waitForFunction(key=>[...document.querySelectorAll('.research-button')].some(b=>b.dataset.versionKey===key&&b.textContent.includes('依頼済み')),key);}
 assert.equal(x.writes.length,4);assert.deepEqual(payloads.slice(0,4).map(p=>p.versionKey),['T146-B01','T146-C01','T1620-B01','T1620-C01']);
 await page.reload();await confirm('T146-B01');await page.waitForFunction(()=>document.querySelector('.research-button').textContent.includes('依頼済み'));assert.equal(x.writes.length,4);assert.match(await card('T146-B01').innerText(),/この銘柄はすでに調査待ちです/);
 for(const [status,message]of [['conflict','一致'],['error','登録できません'],['disabled','停止中'],['invalid_version','Version'],['reference_mismatch','REF'],['network','通信に失敗']]){
  mode=status;await confirm('T146-C01');await page.waitForFunction(message=>[...document.querySelectorAll('.research-feedback')].some(e=>e.textContent.includes(message)),message);assert.equal(await button('T146-C01').isEnabled(),true);
 }
 assert.equal(await page.evaluate(()=>window.__xss||0),0);assert.equal(x.writes.length,4);
 mode='normal';await page.evaluate(()=>{window.MF_APP_CONFIG.RESEARCH_DRY_RUN=true;});x.queue.splice(1);await confirm('T146-C01');await page.waitForFunction(()=>[...document.querySelectorAll('.research-feedback')].some(e=>e.textContent.includes('書き込んでいません')));assert.equal(x.writes.length,4);
 const unsafeName='<img src=x onerror="window.__xss=1">',extra=[{VersionKey:'T999-B01','Primary Reference':'T999','Tリファレンス番号':'T999','現在の公式名':unsafeName},{'現在の公式名':'NO VERSION'},{VersionKey:'T888-B01'},{VersionKey:'T888-B01'}];
 await page.evaluate(rows=>initData({ok:true,rows}),rows.concat(extra));const uiBefore=await page.evaluate(()=>JSON.stringify(R));
 assert.equal(await page.locator('.card[data-version-key=""] .research-button').isDisabled(),true);for(const b of await page.locator('.card[data-version-key="T888-B01"] .research-button').all())assert.equal(await b.isDisabled(),true);
 const previousPosts=posts;await button('T999-B01').click();assert.equal(await page.locator('#researchDialogName').innerText(),unsafeName);assert.equal(await page.locator('#researchDialogName img').count(),0);await page.keyboard.press('Escape');assert.equal(posts,previousPosts);assert.equal(await page.evaluate(()=>window.__xss||0),0);
 await page.evaluate(()=>{document.querySelector('.card[data-version-key="T999-B01"] .name').textContent='DOM NAME';});await button('T999-B01').click();assert.equal(await page.locator('#researchDialogName').innerText(),unsafeName);await page.keyboard.press('Escape');
 assert.equal(await page.evaluate(()=>JSON.stringify(R)),uiBefore);assert.equal(JSON.stringify(x.master),masterBefore);
 await button('T999-B01').click();await page.evaluate(()=>{R.find(r=>r.VersionKey==='T999-B01')['Primary Reference']='T998';});await page.click('#confirmResearch');await page.waitForFunction(()=>[...document.querySelectorAll('.research-feedback')].some(e=>e.textContent.includes('表示データが更新')));assert.equal(posts,previousPosts);
 await button('T1620-B01').click();fs.mkdirSync(path.join(root,'logs/complete-card-ui-20261018'),{recursive:true});
 for(const width of [390,1280]){await page.setViewportSize({width,height:844});const box=await page.locator('#researchDialog').boundingBox();assert(box.x>=0&&box.x+box.width<=width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(root,`logs/complete-card-ui-20261018/confirm-${width}.png`)});}
 await page.click('#cancelResearch');assert.deepEqual(errors,[]);assert.equal(JSON.stringify(x.master),masterBefore);
 console.log('PASS complete_card: confirm/cancel, four exact Versions, 20-click dedupe, queued/already_queued, errors/retry, missing/duplicate keys, safe XSS text, stale target, mobile/desktop; Master unchanged; all requests mocked.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
