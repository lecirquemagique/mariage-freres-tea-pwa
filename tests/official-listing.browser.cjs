'use strict';
// Local HTTP only, real service worker/cache, no production requests or writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),rows=require('./fixtures/official-listing.json').rows.map(row=>({...row,'現在の公式名':row.VersionKey}));
const posts=[];let base;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,base);
 if(url.pathname==='/app-config.js'){res.setHeader('Content-Type','application/javascript');return res.end('window.MF_APP_CONFIG='+JSON.stringify({GAS_API_URL:'https://official-listing.fixture.invalid/api'})+';');}
 if(url.pathname==='/api'){
  if(req.method==='GET'){res.setHeader('Content-Type','application/javascript');return res.end(url.searchParams.get('callback')+'('+JSON.stringify({ok:true,rows,updatedAt:'2026-11-23'})+');');}
  let body='';for await(const chunk of req)body+=chunk;const payload=JSON.parse(body);posts.push(payload);
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,status:'already_queued',versionKey:payload.versionKey,requestId:'offline-existing-request',writePerformed:false,
   image:payload.versionKey==='T719-B01'?{status:'not_needed'}:{status:'deferred',reason:'official_url_missing',writePerformed:false}}));
 }
 const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;return res.end('not found');}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.png')?'image/png':'image/svg+xml');
 res.end(fs.readFileSync(file));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin==='https://official-listing.fixture.invalid')return route.fulfill({contentType:'application/javascript',body:url.searchParams.get('callback')+'('+JSON.stringify({ok:true,rows,updatedAt:'2026-11-23'})+');'});
   return route.request().url().startsWith(base+'/')?route.continue():route.abort();
  });
  await page.goto(base+'/');await page.waitForFunction(()=>document.querySelectorAll('.card').length===4);
  const scope=async value=>page.evaluate(value=>{if(typeof setScope==='function')setScope(value);else document.getElementById('displayScope').value=value;render();},value);
  await scope('all');assert.equal(await page.locator('.card').count(),7);
  const labels=await page.locator('.sales-badges').allTextContents();
  assert(labels[0].includes('未確認'));assert(labels[1].includes('未確認'));assert(labels[2].includes('公式掲載中'));
  assert(labels[3].includes('公式掲載なし'));assert(labels[3].includes('終売推定'));assert(labels[4].includes('公式掲載終了'));
  assert(labels[5].includes('未掲載'));assert(!labels[5].includes('未確認'));assert(!labels[5].includes('公式掲載なし'));assert(!labels[5].includes('公式掲載終了'));
  await scope('past');assert.equal(await page.locator('.card').count(),3);await scope('shopping');assert.equal(await page.locator('.card').count(),4);
  const combos=await page.evaluate(()=>{const out=[];for(const listing of ['未確認','掲載中','未掲載','公式掲載なし','公式掲載終了'])for(const sales of ['販売中','終売推定','終売確定']){
   const row={'公式掲載状態':listing,'現行ステータス':sales};out.push({listing,sales,read:MFSalesState.listing(row),labels:MFSalesState.badges(row,[])});
  }return out;});
  for(const c of combos){assert.equal(c.read,c.listing);if(c.sales.startsWith('終売'))assert(c.labels.includes(c.sales));}
  // Exercise the unchanged published client against only the local mocked endpoint.
  for(const row of rows.slice(0,3)){
   const result=await page.evaluate(async row=>{const result=await MFResearchRequest.send(row,{GAS_API_URL:location.origin+'/api'});return {result,feedback:MFResearchRequest.feedback(result)};},row);
   assert.equal(result.result.status,'already_queued');assert.equal(result.result.writePerformed,false);assert.equal(result.feedback.kind,'done');
  }
  assert.equal(posts.length,3);assert(posts.every(p=>p.action==='requestResearch'&&p.operationId));
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  const keys=await page.evaluate(()=>caches.keys());assert(keys.includes('mf-tea-pwa-v1-6-official-listing'));
  const cached=await page.evaluate(async()=>{const c=await caches.open('mf-tea-pwa-v1-6-official-listing');return (await c.keys()).map(r=>new URL(r.url).pathname);});
  for(const name of ['/index.html','/sales-state.js','/research-request.js'])assert(cached.includes(name));
  await context.setOffline(true);const offline=await page.evaluate(async()=>{const r=await fetch('/sales-state.js');return {status:r.status,text:await r.text()};});
  assert.equal(offline.status,200);assert(offline.text.includes('公式掲載終了'));await context.setOffline(false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('PASS official listing: old 3/new 4 labels, legacy unchanged, 15 independent sales combinations, scopes, 3 mocked intake requests, real SW/cache/offline, 390px. Production requests/writes 0.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
