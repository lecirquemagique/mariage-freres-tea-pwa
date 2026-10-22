'use strict';
// Isolated browser and intercepted requests only. Never calls production GAS.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'..');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const row={VersionKey:'T146-C01','Primary Reference':'T146','Tリファレンス番号':'T146','現在の公式名':'NAMRING HIGH MOUNTAIN','公式掲載状態':'掲載中','現行ステータス':'販売中'};
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage();let status='recently_completed',reason='',posts=0;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const request=route.request(),u=new URL(request.url());
  if(u.pathname==='/api'&&request.method()==='GET')return route.fulfill({contentType:'application/javascript',body:u.searchParams.get('callback')+'('+JSON.stringify({ok:true,rows:[row]})+');'});
  if(u.pathname==='/api'&&request.method()==='POST'){
   posts++;const p=JSON.parse(request.postData());assert.equal(p.versionKey,row.VersionKey);assert.equal(p.requestType,'complete_card');assert.equal(request.headers()['content-type'],'text/plain;charset=utf-8');
   assert(!Object.hasOwn(p,'completedAt'));await new Promise(resolve=>setTimeout(resolve,100));
   return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,status,reason,versionKey:row.VersionKey,nextEligibleAt:'2027-10-18T00:00:00Z'})});
  }
  if(u.pathname==='/app-config.js')return route.fulfill({contentType:'application/javascript',body:'window.MF_APP_CONFIG={GAS_API_URL:"https://mf.test/api",RESEARCH_API_ENABLED:true,RESEARCH_DRY_RUN:false};'});
  const file=u.pathname==='/'?'index.html':u.pathname.slice(1);if(['index.html','sales-state.js','tea-search.js','tea-card.js','aroma-filter.js','research-request.js'].includes(file))return route.fulfill({path:path.join(root,file)});
  return route.fulfill({status:404,body:''});
 });
 const load=async()=>{await page.goto('https://mf.test');await page.waitForSelector('.research-button');};
 const button=()=>page.locator('.research-button');const submit=async()=>{await button().click();await page.locator('#confirmResearch').evaluate(el=>{for(let i=0;i<20;i++)el.click();});};
 for(const [value,text]of [['recently_completed','この銘柄は最近調査済みです'],['requeued_after_expiry','再調査依頼を登録しました'],['already_queued','この銘柄はすでに調査待ちです'],['queued','調査依頼を登録しました']]){
  status=value;reason='';await load();assert.equal(await button().innerText(),'情報を補完');const before=await page.evaluate(()=>JSON.stringify(R)),count=posts;
  await submit();await page.waitForFunction(text=>document.querySelector('.research-feedback')?.textContent===text,text);assert.equal(posts,count+1);assert.equal(await button().isDisabled(),true);
  if(value==='recently_completed'){assert.equal(await button().innerText(),'最近調査済み');await page.fill('#q','T146');assert.equal(await button().isDisabled(),true);assert.equal(await button().innerText(),'最近調査済み');}
  else assert.match(await button().innerText(),/依頼済み/);
  assert.equal(await page.evaluate(()=>JSON.stringify(R)),before);
 }
 status='recently_completed';reason='completion_history_unverifiable';await load();await submit();await page.waitForFunction(()=>document.querySelector('.research-feedback')?.textContent.includes('完了日時を確認できない'));
 assert.equal(await button().isDisabled(),true);assert.equal(await button().innerText(),'完了履歴の確認が必要');assert.deepEqual(errors,[]);
 console.log('PASS recheck browser: recent/requeued/queued/already_queued, disabled state retained across filtering, unknown completion, 20-click prevention, unchanged Master rows; all requests mocked.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
