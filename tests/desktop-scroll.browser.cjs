'use strict';
// All traffic is intercepted. Confirmation dialogs are cancelled; no research is submitted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(process.env.MF_PWA_SCROLL_ROOT||path.join(__dirname,'..'));
const html=process.env.MF_PWA_SCROLL_HTML||path.join(root,'index.html');
const out=path.resolve(process.env.MF_PWA_SCROLL_OUTPUT||path.join(root,'logs/pwa-desktop-scroll-20261022/working'));
const widths=(process.env.MF_PWA_SCROLL_WIDTHS||'1440,1920,390,700,701').split(',').map(Number);
const rows=Array.from({length:40},(_,i)=>({VersionKey:`T${9900+i}-C01`,'Primary Reference':`T${9900+i}`,'Tリファレンス番号':`T${9900+i}`,
 '現在の公式名':`SCROLL TEA ${i}`,'銘柄名（黒い本）':`SCROLL TEA ${i}`,'カタカナ表記':`スクロール テスト ${i}`,
 '公式掲載状態':'掲載中','現行ステータス':'販売中','茶種タグ':i%2?'黒茶':'青茶','産地・国':i%2?'インド':'中国',
 '香味大分類':i%2?'果実':'花','香味詳細タグ':i%2?'ピーチ':'ジャスミン','時間帯タグ':i%2?'朝':'午後','ミルクティー推奨':i%2?'いいえ':'はい',
 '公式商品ページURL':`https://www.mariagefreres.com/fr/fixture-t${9900+i}.html`,'現在の公式説明':'香りと産地を確認するための、ローカル表示テスト用の説明です。'.repeat(4),
 '茶葉画像URL':'https://mf.test/leaf.svg','茶葉サムネイルURL':'https://mf.test/leaf.svg','水色画像URL':'https://mf.test/liquor.svg'}));
const data=[...rows,{...rows[0],VersionKey:'T9900-B01','現在の公式名':'OLD SCROLL TEA','公式掲載状態':'未掲載','現行ステータス':'終売未確定'},
 {...rows[1],VersionKey:'T9998-B01','Primary Reference':'T9998','Tリファレンス番号':'T9998','公式掲載状態':'未掲載','現行ステータス':'終売確定'}];
(async()=>{fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});const results=[];
 try{for(const width of widths){const height=width===1920?1080:width===390?844:900;
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];let posts=0;
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{const req=route.request(),u=new URL(req.url());
   if(req.method()!=='GET'){posts++;return route.fulfill({status:400,body:'Unexpected request in scroll-only test'});}
   if(u.pathname==='/api')return route.fulfill({contentType:'application/javascript',body:u.searchParams.get('callback')+'('+JSON.stringify({ok:true,rows:data,updatedAt:'2026-10-22T00:00:00.000Z'})+');'});
   if(u.pathname==='/app-config.js')return route.fulfill({contentType:'application/javascript',body:'window.MF_APP_CONFIG={GAS_API_URL:"https://mf.test/api"};'});
   if(u.pathname.endsWith('.svg'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#665631"/></svg>'});
   if(u.pathname==='/')return route.fulfill({path:html});
   const file=u.pathname.slice(1);
   if(['index.html','sales-state.js','research-request.js','tea-search.js','tea-card.js','aroma-filter.js'].includes(file)||file.startsWith('assets/mf-sales-format-icons/'))return route.fulfill({path:path.join(root,file)});
   return route.fulfill({status:404,body:''});
  });
  await page.goto('https://mf.test/');await page.waitForFunction(()=>document.querySelectorAll('.card').length===40);
  const masterBefore=await page.evaluate(()=>JSON.stringify(R));
  await page.locator('.advanced-filters').evaluateAll(items=>items.forEach(e=>e.open=true));
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  const before=await page.evaluate(()=>{const f=document.querySelector('.filters'),c=document.querySelector('.card'),g=document.querySelector('#list'),s=getComputedStyle(f),r=f.getBoundingClientRect();return {position:s.position,top:r.top,bottom:r.bottom,height:r.height,padding:s.padding,cardTop:c.getBoundingClientRect().top,cardWidth:c.getBoundingClientRect().width,cardHeight:c.getBoundingClientRect().height,gridGap:getComputedStyle(g).gap};});
  assert.equal(before.position,'static',`${width}px filters must be in normal document flow`);
  await page.evaluate(y=>window.scrollTo({top:y,behavior:'instant'}),Math.ceil(before.bottom+16));
  await page.waitForFunction(()=>document.querySelector('.filters').getBoundingClientRect().bottom<0);
  const after=await page.evaluate(()=>({filterTop:document.querySelector('.filters').getBoundingClientRect().top,filterBottom:document.querySelector('.filters').getBoundingClientRect().bottom,scrollY,cardTop:document.querySelector('.card').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert(Math.abs((before.top-after.filterTop)-after.scrollY)<=1,'Filters must move by the document scroll distance');
  assert(after.filterBottom<0);assert(after.cardTop>=-32&&after.cardTop<height*.25,'Cards should use the screen after filters leave');assert.equal(after.overflow,false);
  assert.equal(await page.locator('.research-button').first().isEnabled(),true);assert(await page.locator('.sales-format-icon').count()>0);
  if([1440,1920,390].includes(width))await page.screenshot({path:path.join(out,`scroll-${width}.png`)});
  await page.fill('#q','T9900');assert.equal(await page.locator('.card').count(),1);
  await page.selectOption('#tea','青茶');await page.selectOption('#origin','中国');
  await page.locator('#aromaChips button').filter({hasText:/^花$/}).click();
  await page.locator('#timeChips button').filter({hasText:/^午後$/}).click();await page.locator('.feature-chip').filter({has:page.locator('#milk')}).click();assert.equal(await page.locator('.card').count(),1);
  await page.locator('.research-button').click();assert.match(await page.locator('#researchDialogRef').innerText(),/T9900/);assert.equal(await page.locator('#researchDialogName').innerText(),'SCROLL TEA 0');await page.click('#cancelResearch');
  await page.click('#reset');assert.equal(await page.locator('.card').count(),40);
  const scope=async value=>{if(await page.locator('select#displayScope').count())await page.selectOption('#displayScope',value);else await page.locator('.scope-segments label').filter({has:page.locator(`[value=${value}]`)}).click();};
  await scope('all');assert.equal(await page.locator('.card').count(),42);await scope('past');assert.equal(await page.locator('.card').count(),2);await page.click('#reset');
  assert.equal(await page.evaluate(()=>JSON.stringify(R)),masterBefore);assert.equal(posts,0);assert.deepEqual(errors,[]);
  results.push({width,height,before,after,searchAndFilters:'pass',completeCardConfirmCancel:'pass',salesScope:'40/42/2',posts,errors});await context.close();
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log('PASS desktop scroll: '+widths.join('/')+'px; filters leave viewport, cards use screen, filters/scopes/SKU/complete_card preserved; POST 0.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
