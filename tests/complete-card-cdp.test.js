'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const PRODUCT='https://www.mariagefreres.com/en/grand-white-t2306-tea-by-the-weight.html';
function client(){const c={require,process:{env:{}},console,URL,Buffer,setTimeout,clearTimeout,__dirname:path.join(__dirname,'../collector')};vm.createContext(c);const s=fs.readFileSync(path.join(__dirname,'../collector/collector.js'),'utf8');vm.runInContext(s.slice(0,s.lastIndexOf('\nmain().catch(')),c);return c;}
function facts(url=PRODUCT,ref='T2306',name='GRAND WHITE') {return {url,canonical:url,h1:name,title:name,bodyText:'REF '+ref,productSummary:'REF '+ref,productDescription:'White tea from China.',structuredProductData:JSON.stringify({'@type':'Product',sku:ref,name,offers:{availability:'https://schema.org/InStock'}})};}
function request(){const fields=['公式商品ページURL','公式掲載状態','現行ステータス','現在の公式名','現在の公式説明','水出し用ブレンド','茶葉画像URL','茶葉サムネイルURL','水色画像URL'];return {request_id:'fixture-id',version_key:'T2306-B01',primary_reference:'T2306',tea_reference:'T2306',request_type:'complete_card',source:'PWA',target_name:'GRAND WHITE',missing_fields:fields,target:Object.assign(Object.fromEntries(fields.map(f=>[f,''])),{VersionKey:'T2306-B01','Primary Reference':'T2306','Tリファレンス番号':'T2306','銘柄名（黒い本）':'GRAND WHITE'})};}
class Page {
 constructor(options={}){this.options=options;this.current=options.url||'about:blank';this.state={};this.gotos=[];this.closes=0;this.reloads=0;this.listeners=new Set();this.visible=false;this.frame={};}
 url(){return this.current;}mainFrame(){return this.frame;}on(_event,fn){this.listeners.add(fn);}off(_event,fn){this.listeners.delete(fn);}
 emit(url,status,type='document'){const req={resourceType:()=>type,frame:()=>this.frame,redirectedFrom:()=>null};for(const f of this.listeners)f({request:()=>req,url:()=>url,status:()=>status});}
 async goto(url){this.gotos.push(url);this.current=url;this.visible=false;const region=url.includes('.co.jp')?'JP':url.includes('/en/')?'EN':'FR';const product=/t\d+.*\.html/.test(url);const root=/\/(?:fr\/|en\/)?$/.test(new URL(url).pathname);this.state=product?{status:200,product:true}:root&&this.options.uiRegion===region?{status:200,home:true}:this.options.search||{status:403};this.emit(url,this.state.status);return {status:()=>this.state.status};}
 async reload(){this.reloads++;throw Error('must not reload');}async close(){this.closes++;}async title(){return this.state.title||'';}async waitForLoadState(){}async waitForTimeout(){}async waitForURL(predicate){if(!predicate(new URL(this.current)))throw Error('search navigation unavailable');}
 locator(selector){const page=this;const input=/input/.test(selector);return {first(){return this;},innerText:async()=>page.state.body||'',isVisible:async()=>input?page.visible:!!page.state.home,
  click:async()=>{if(selector.includes('#makeshop-common-search-url')){await page.locator('input').press();return;}if(page.options.popup403){page.emit(page.current+'catalogsearch/ajax/popup/',403,'xhr');return;}page.visible=true;},
  waitFor:async()=>{if(input&&!page.visible)throw Error('input unavailable');},evaluate:async()=>page.options.unsafeForm!==true,
  fill:async query=>{page.query=query;},press:async()=>{page.current=page.options.correctedUrl||'https://www.mariagefreres.com/en/catalogsearch/result/?q='+encodeURIComponent(page.query);page.state={status:200,searchUi:true};page.emit(page.current,200);}};}
 async evaluate(fn,arg){const source=String(fn);
  if(source.includes('researchAvailability'))return {researchProductData:[{'@type':'Product',sku:'T2306',offers:{availability:'https://schema.org/InStock'}}]};
  if(source.includes('effective_query'))return {url:this.current,title:this.state.title||'',body:this.state.body||'',canonical:'',effective_query:this.options.correctedQuery||arg,query_corrected:!!this.options.correctedQuery,no_result:!!this.state.noResult};
  if(source.includes('productDescriptionSelectors'))return this.options.facts||facts(this.current);
  if(source.includes("querySelectorAll('a[href]')"))return this.state.searchUi?this.options.uiLinks||[]:this.options.navLinks||[];
  throw Error('Unexpected evaluate '+source.slice(0,80));
 }
}
const config={settleDelayMs:1,researchUiTimeoutMs:1,researchUiSettleMs:1};
function context(owned,borrowed=[]){return {pages:()=>borrowed,newPage:async()=>owned};}

test('rendered exact REF product is discovered without navigating, reloading or closing borrowed tab',async()=>{
 const c=client(),r=request(),borrowed=new Page({url:PRODUCT}),owned=new Page();
 const pages=await c.inspectCardResearchPages({context:context(owned,[borrowed]),request:r,config:{...config,researchSearchUi:false}});
 const plan=c.buildCardResearchPlan(r,pages);assert.equal(plan.candidates.length,5);assert.equal(borrowed.gotos.length,0);assert.equal(borrowed.reloads,0);assert.equal(borrowed.closes,0);assert.equal(owned.closes,1);assert.equal(owned.listeners.size,0);
 assert(plan.lookup_diagnostics.some(d=>d.transport==='cdp_existing_dom'&&d.status===null&&d.references.includes('T2306')));
});
test('every relevant borrowed tab is inspected; conflicting Versions do not select the first tab',async()=>{
 const c=client(),a=new Page({url:PRODUCT}),url=PRODUCT.replace('grand-white','another'),b=new Page({url});const r=request();
 const pages=await c.inspectCardResearchPages({context:context(new Page(),[a,b]),request:r,config:{...config,researchSearchUi:false}});
 assert.equal(c.buildCardResearchPlan(r,pages).candidates.length,0);assert.equal(c.buildCardResearchPlan(r,pages).unresolved['現在の公式名'],'version_ambiguous');assert.equal(a.closes+b.closes,0);
});
test('canonical conflicts, missing canonical and wrong REF fail closed for existing DOM',async()=>{
 const c=client();for(const patch of [{canonical:PRODUCT.replace('t2306','t2307')},{canonical:''},{productSummary:'REF T9999',bodyText:'REF T9999',structuredProductData:'',h1:'GRAND WHITE'}]){
 const p=new Page({url:PRODUCT,facts:{...facts(),...patch}});const out=await c.inspectRenderedCardResearchPage(p,{reference:'T2306',name:'GRAND WHITE'},config,false);
 assert.equal(out.ok,false);assert.equal(p.gotos.length,0);assert.equal(p.closes,0);}
});
test('a REF appearing only in recommendations cannot establish product identity',async()=>{
 const c=client(),p=new Page({url:PRODUCT,facts:{...facts(),productSummary:'',structuredProductData:'',bodyText:'You may also like REF T2306'}});
 assert.equal((await c.inspectRenderedCardResearchPage(p,{reference:'T2306',name:'GRAND WHITE'},config,false)).ok,false);
});
test('official search UI supplies a candidate and preserves corrected query provenance',async()=>{
 const c=client(),owned=new Page({uiRegion:'EN',correctedQuery:'white',correctedUrl:'https://www.mariagefreres.com/en/catalogsearch/result/?q=white',uiLinks:[{href:PRODUCT,text:'GRAND WHITE',closestText:'REF T2306'}]});
 const pages=await c.inspectCardResearchPages({context:context(owned),request:request(),config});
 assert.equal(c.buildCardResearchPlan(request(),pages).candidates.length,5);
 assert(pages.lookup.some(d=>d.transport==='cdp_search_ui'&&d.effective_query==='white'&&d.query_corrected));assert.equal(owned.closes,1);assert.equal(owned.listeners.size,0);
});
test('search UI XHR403 is recorded and never interpreted as product absence',async()=>{
 const c=client(),owned=new Page({uiRegion:'EN',popup403:true});const pages=await c.inspectCardResearchPages({context:context(owned),request:request(),config});
 assert(pages.lookup.some(d=>d.transport==='cdp_search_ui'&&d.resource_type==='xhr'&&d.status===403&&d.reason==='official_access_blocked'));
 assert.equal(c.buildCardResearchPlan(request(),pages).candidates.length,0);assert.equal(owned.closes,1);
});
test('no-results searches ignore recommendations and preserve source-specific failure',async()=>{
 const c=client(),owned=new Page({search:{status:200,noResult:true,body:'THERE ARE NO RESULTS FOR'},navLinks:[{href:PRODUCT,text:'GRAND WHITE',closestText:'REF T2306'}]});
 const pages=await c.inspectCardResearchPages({context:context(owned),request:request(),config:{...config,researchSearchUi:false}});
 assert.equal(c.buildCardResearchPlan(request(),pages).candidates.length,0);assert(!owned.gotos.includes(PRODUCT));assert(pages.lookup.some(d=>d.reason==='official_search_no_result'));
});
test('corrected name search never accepts a different REF',async()=>{
 const c=client(),other=PRODUCT.replace('t2306','t2302'),owned=new Page({uiRegion:'EN',uiLinks:[{href:other,text:'PAI MU TAN IMPERIAL',closestText:'REF T2302'}]});
 const pages=await c.inspectCardResearchPages({context:context(owned),request:request(),config});assert.equal(c.buildCardResearchPlan(request(),pages).candidates.length,0);assert(!owned.gotos.includes(other));
});
test('navigation fallback can discover an exact product and never navigates borrowed category tab',async()=>{
 const c=client(),owned=new Page({search:{status:200},navLinks:[{href:PRODUCT,text:'GRAND WHITE',closestText:'REF T2306'}]}),borrowed=new Page({url:'https://www.mariagefreres.com/fr/the/les-grandes-familles/the-blanc.html'});
 const pages=await c.inspectCardResearchPages({context:context(owned,[borrowed]),request:request(),config:{...config,researchSearchUi:false}});
 assert.equal(c.buildCardResearchPlan(request(),pages).candidates.length,5);assert(owned.gotos.includes(PRODUCT));assert.equal(borrowed.gotos.length,0);assert.equal(borrowed.closes,0);
});
test('unsafe search form is not submitted; no cart/account writes',async()=>{
 const c=client(),owned=new Page({uiRegion:'EN',unsafeForm:true});let presses=0;const locator=owned.locator.bind(owned);owned.locator=s=>{const l=locator(s);l.press=async()=>presses++;return l;};
 await c.inspectCardResearchPages({context:context(owned),request:request(),config});assert.equal(presses,0);
});
test('preview with UI/DOM evidence has zero queue, Review, Master and normal image writes',async()=>{
 const c=client(),r=request(),before=JSON.stringify(r),owned=new Page(),borrowed=new Page({url:PRODUCT});let calls=0;
 const out=await c.processCardResearchRequest({request:r,dryRun:true,inspect:()=>c.inspectCardResearchPages({context:context(owned,[borrowed]),request:r,config:{...config,researchSearchUi:false}}),call:async()=>{calls++;throw Error('forbidden write');}});
 assert.equal(out.status,'dry_run');assert.equal(out.master_writes,0);assert.equal(out.normal_image_products,0);assert.equal(out.plan.candidates.length,5);assert.equal(calls,0);assert.equal(JSON.stringify(r),before);
});
test('privacy filters redact challenge tokens and credentials from provenance',()=>{
 const c=client();const u=c.cardResearchSafeUrl('https://user:pass@www.mariagefreres.com/en/?q=T2306&__cf_chl_rt_tk=secret&token=secret#x');assert(!/secret|pass|user|__cf/.test(u));assert(u.includes('q=T2306'));
 assert(c.cardResearchSafeUrl('https://www.mariagefreres.co.jp/view/search?search_keyword=T2306').includes('search_keyword=T2306'));
});
for(const region of ['FR','JP'])test('region-specific official search UI works: '+region,async()=>{
 const c=client(),owned=new Page({uiRegion:region,uiLinks:[{href:PRODUCT,text:'GRAND WHITE',closestText:'REF T2306'}]});
 const pages=await c.inspectCardResearchPages({context:context(owned),request:request(),config});
 assert.equal(c.buildCardResearchPlan(request(),pages).candidates.length,5);
 assert(pages.lookup.some(d=>d.transport==='cdp_search_ui'&&d.source_region===region));assert.equal(owned.closes,1);
});
test('Master URL is attempted before discovery; existing DOM remains untouched',async()=>{
 const c=client(),r=request();r.target['公式商品ページURL']=PRODUCT;
 const owned=new Page(),borrowed=new Page({url:PRODUCT});await c.inspectCardResearchPages({context:context(owned,[borrowed]),request:r,config:{...config,researchSearchUi:false}});
 assert.equal(owned.gotos[0],PRODUCT);assert.equal(borrowed.gotos.length+borrowed.reloads+borrowed.closes,0);
});
test('concurrent navigation invalidates a borrowed DOM snapshot',async()=>{
 const c=client(),p=new Page({url:PRODUCT});const evaluate=p.evaluate.bind(p);p.evaluate=async(fn,arg)=>{const result=await evaluate(fn,arg);if(String(fn).includes('productDescriptionSelectors'))p.current=PRODUCT.replace('t2306','t2307');return result;};
 const out=await c.inspectRenderedCardResearchPage(p,{reference:'T2306',name:'GRAND WHITE'},config,false);
 assert.equal(out.ok,false);assert.equal(out.reject_reason,'page_changed_during_read');assert.equal(p.gotos.length,0);
});

class ChallengePage extends Page {
 constructor(options={}){super(options);this.waits=0;this.productNavigations=0;}
 async goto(url){
  if(!/t\d+.*\.html/.test(url))return super.goto(url);
  this.productNavigations++;this.gotos.push(url);this.current=url;this.state={status:403,title:'Just a moment...',body:'Cloudflare'};
  this.emit(url,403);return {status:()=>403,headerValue:async key=>key==='cf-mitigated'?'challenge':null};
 }
 async waitForTimeout(ms){
  this.waits++;await new Promise(resolve=>setTimeout(resolve,Math.min(ms,1)));
  if(!this.options.neverReady && this.waits >= 2){this.state={status:200,product:true};this.emit(this.current,200);}
 }
 async evaluate(fn,arg){if(String(fn).includes('Boolean(document.querySelector'))return !!this.state.product;return super.evaluate(fn,arg);}
}

test('owned initial403 waits for natural product DOM, retains status provenance and does not touch borrowed tab',async()=>{
 const c=client(),r=request();r.target['公式商品ページURL']=PRODUCT;
 const owned=new ChallengePage(),borrowed=new Page({url:PRODUCT});
 const pages=await c.inspectCardResearchPages({context:context(owned,[borrowed]),request:r,config:{...config,researchSearchUi:false,researchProductReadyTimeoutMs:100}});
 const recovered=pages.lookup.find(d=>d.initial_http_status===403);
 assert.equal(recovered.cf_mitigated,'challenge');assert.equal(recovered.final_http_status,200);assert.equal(recovered.final_dom_validation.ok,true);
 assert(recovered.waited_ms>0);assert.equal(recovered.reason,'');assert.equal(owned.productNavigations,1);
 assert(c.buildCardResearchPlan(r,pages).candidates.length>0);
 assert.equal(borrowed.gotos.length+borrowed.reloads+borrowed.closes,0);assert.equal(owned.listeners.size,0);
});

test('permanent challenge ends within finite deadline, without retry navigation or accepting unverified DOM',async()=>{
 const c=client(),r=request();r.target['公式商品ページURL']=PRODUCT;const owned=new ChallengePage({neverReady:true}),start=Date.now();
 const pages=await c.inspectCardResearchPages({context:context(owned),request:r,config:{...config,researchSearchUi:false,researchProductReadyTimeoutMs:8}});
 assert(Date.now()-start<1000);assert.equal(owned.productNavigations,1);
 const blocked=pages.lookup.find(d=>d.initial_http_status===403);
 assert.equal(blocked.reason,'official_access_blocked');assert.equal(blocked.final_dom_validation.ok,false);assert(blocked.waited_ms>=8);
 assert.equal(c.buildCardResearchPlan(r,pages).candidates.length,0);assert.equal(owned.listeners.size,0);
});

test('natural challenge completion with wrong REF is still refused',async()=>{
 const c=client(),r=request();r.target['公式商品ページURL']=PRODUCT;
 const owned=new ChallengePage({facts:facts(PRODUCT,'T9999')});
 const pages=await c.inspectCardResearchPages({context:context(owned),request:r,config:{...config,researchSearchUi:false,researchProductReadyTimeoutMs:15}});
 assert.equal(c.buildCardResearchPlan(r,pages).candidates.length,0);
 assert.equal(pages.lookup.find(d=>d.initial_http_status===403).final_dom_validation.ok,false);
});

test('DOM success after initial403 does not invent a finalHTTP200',async()=>{
 const c=client(),p=new ChallengePage();p.emit=()=>{};
 const r=request();r.target['公式商品ページURL']=PRODUCT;
 const pages=await c.inspectCardResearchPages({context:context(p),request:r,config:{...config,researchSearchUi:false,researchProductReadyTimeoutMs:100}});
 const recovered=pages.lookup.find(d=>d.initial_http_status===403);
 assert.equal(recovered.final_dom_validation.ok,true);assert.equal(recovered.final_http_status,null);assert.equal(recovered.initial_http_status,403);
});

async function headingFacts(c,selectors,title='Document title fallback'){
 const document={title,body:{innerText:'REF T2306'},querySelector:()=>null,
  querySelectorAll:selector=>(selectors[selector]||[]).map(textContent=>({textContent}))};
 return c.collectDiscoveryPageFacts({evaluate:async fn=>vm.runInNewContext(`(${fn.toString()})()`,{document,location:{href:PRODUCT}})},PRODUCT);
}
test('empty leading logo h1 is ignored in favor of explicit product page-title',async()=>{
 const c=client(),f=await headingFacts(c,{'h1':['','Unrelated heading'],'h1.page-title':['GRAND WHITE']});
 assert.equal(f.h1,'GRAND WHITE');
});
test('product name span precedes heading decorations and document title',async()=>{
 const c=client(),f=await headingFacts(c,{'h1.page-title [itemprop="name"]':['GRAND WHITE'],'h1.page-title':['GRAND WHITE Add to wishlist'],'h1':['Other']},'Different SEO title');
 assert.equal(f.h1,'GRAND WHITE');
});
test('without page-title, product-region name precedes a generic heading',async()=>{
 const c=client(),f=await headingFacts(c,{'.product-info-main [itemprop="name"]':['GRAND WHITE'],'h1':['Other']});assert.equal(f.h1,'GRAND WHITE');
});
test('generic h1 fallback skips empty nodes; document title is only the final fallback',async()=>{
 const c=client(),generic=await headingFacts(c,{'h1':['','GRAND WHITE']});assert.equal(generic.h1,'GRAND WHITE');
 const noHeading=await headingFacts(c,{'h1':['','']},'GRAND WHITE');assert.equal(noHeading.h1,'');assert.equal(noHeading.h1||noHeading.title,'GRAND WHITE');
});
test('FR/EN labels cannot group a page whose canonical still identifies another URL',()=>{
 const c=client(),r=request(),en={ok:true,url:PRODUCT,refs:['T2306'],official_name:'GRAND WHITE',facts:facts()},fr={...en,url:PRODUCT.replace('/en/','/fr/')};
 const plan=c.buildCardResearchPlan(r,[fr,en]);assert.equal(plan.candidates.length,0);assert.equal(plan.unresolved['現在の公式名'],'version_ambiguous');
});
