'use strict';
// All requests intercepted; this test cannot register research or alter remote data.
const path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.join(__dirname,'..');
const tags=['黒茶、ルイボス','黒茶・ルイボス','黒茶・マテ','未知茶','熟成茶'];
const rows=tags.map((tag,i)=>({VersionKey:`T${9900+i}-B01`,'Primary Reference':`T${9900+i}`,'Tリファレンス番号':`T${9900+i}`,
  '現在の公式名':`TEA FIXTURE ${i}`,'茶種タグ':tag,'公式掲載状態':'掲載中','現行ステータス':'販売中',
  '香味大分類':'甘香・菓子','香味詳細タグ':'ヴァニラ','産地・国':'中国','現在の公式説明':'表示確認用。'}));
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();let posts=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());
   if(request.method()!=='GET'){posts++;return route.fulfill({status:400,body:'No writes allowed'});}
   if(url.pathname==='/api')return route.fulfill({contentType:'application/javascript',body:url.searchParams.get('callback')+'('+JSON.stringify({ok:true,rows})+');'});
   if(url.pathname==='/app-config.js')return route.fulfill({contentType:'application/javascript',body:'window.MF_APP_CONFIG={GAS_API_URL:"https://mf.test/api"};'});
   const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
   if(['index.html','sales-state.js','research-request.js','tea-search.js','tea-card.js','aroma-filter.js'].includes(file)||file.startsWith('assets/'))return route.fulfill({path:path.join(root,file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://mf.test/');await page.waitForFunction(()=>document.querySelectorAll('.card').length===5);
  await page.locator('.advanced-filters').evaluateAll(items=>items.forEach(e=>e.open=true));
  const before=await page.evaluate(()=>JSON.stringify(R));
  const options=await page.locator('#tea option').evaluateAll(items=>items.map(o=>o.value));
  for(const bad of ['黒茶・ルイボス','黒茶・マテ','未知茶','熟成茶'])assert(!options.includes(bad));
  for(const good of ['黒茶','ルイボス']){await page.selectOption('#tea',good);assert.equal(await page.locator('.card').count(),1);assert.match(await page.locator('.card').innerText(),/TEA FIXTURE 0/);}
  await page.selectOption('#tea','マテ');assert.equal(await page.locator('.card').count(),0);
  await page.click('#reset');assert.equal(await page.locator('.card').count(),5);
  await page.locator('#aromaChips button').filter({hasText:/^甘香・菓子$/}).click();assert.equal(await page.locator('.card').count(),5);
  assert.equal(await page.evaluate(()=>JSON.stringify(R)),before);assert.equal(posts,0);assert.deepEqual(errors,[]);
  await context.close();console.log(`PASS tea taxonomy ${width}px: fixed options, dual matching, unknown preserved, aroma unchanged, POST 0`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
