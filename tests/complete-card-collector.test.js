'use strict';
const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const{setup,REQUEST_ID,URL}=require('./complete-card-queue.test.js');
const source=fs.readFileSync(path.join(__dirname,'../collector/collector.js'),'utf8');
function client(){const ctx={require,process:{env:{}},console,URL:global.URL,Buffer,__dirname:path.join(__dirname,'../collector')};vm.createContext(ctx);vm.runInContext(source.slice(0,source.lastIndexOf('\nmain().catch(')),ctx);return ctx;}
function page(patch={}){return {ok:true,url:URL,refs:['T2306'],official_name:'GRAND PAI MU TAN',language:'EN',facts:{url:URL,canonical:URL,productSummary:'REF T2306',h1:'GRAND PAI MU TAN',category:'White tea',productDescription:'Delicate white tea, harvested in China.',structuredProductData:JSON.stringify({'@type':'Product',sku:'T2306',name:'GRAND PAI MU TAN',offers:{availability:'https://schema.org/InStock'}})},...patch};}
const plain=x=>JSON.parse(JSON.stringify(x));
test('T2306 resolved-product success fixture: exact 169 claim -> Reviews -> completion, no Master/legacy writes',async()=>{const x=setup(),c=client(),master=JSON.stringify(x.master),legacy=JSON.stringify(x.queue[1]),calls=[];
 const args=c.parseArgs(['node','collector','--research-queue-only','--request-id',REQUEST_ID,'--connect-cdp','mock','--write-back']);let closed=0;
 const run=()=>c.runResearchQueueOnly({args,config:{},baseDir:'.',call:async p=>{calls.push(plain(p));return x.call(p);},connect:async()=>({context:{},browser:{close:async()=>closed++}}),inspect:async()=>[page()]});
 const r=await run();assert.equal(r.status,'completed');assert.equal(r.plan.mode,'existing_primary');assert.equal(r.normal_image_products,0);assert.equal(r.master_writes,0);assert.equal(r.plan.effective_missing_fields.length,14);
 const fields=r.result.proposed.map(p=>p.field);for(const f of ['公式商品ページURL','公式掲載状態','現行ステータス','現在の公式名','現在の公式説明'])assert(fields.includes(f),f);
 assert(!fields.includes('茶種タグ'));assert(r.result.unresolved.some(p=>p.field==='ミルクティー推奨'));assert(r.result.unresolved.some(p=>p.field==='茶葉画像URL'&&p.reason==='image_review_pipeline_required'));
 assert(calls.every(p=>['claimCardResearchRequest','recordCardResearchCandidate','completeCardResearchRequest'].includes(p.action)));assert.equal(JSON.stringify(x.master),master);assert.equal(JSON.stringify(x.queue[1]),legacy);
 const rows=x.review.length,writes=x.writes.length;assert.equal((await run()).status,'already_completed');assert.equal(x.review.length,rows);assert.equal(x.writes.length,writes);assert.equal(closed,2);
 console.log(JSON.stringify({mock:'T2306',request_id:REQUEST_ID,proposed:plain(fields),unresolved:r.result.unresolved.length,MasterWrites:0,normalImages:0}));
});
test('preview is default, even enabled config cannot claim or record without explicit --write-back',async()=>{const x=setup(),c=client(),before=JSON.stringify(x.queue);const args=c.parseArgs(['node','collector','--research-queue-only',`--request-id=${REQUEST_ID}`,'--connect-cdp','mock']);const r=await c.runResearchQueueOnly({args,config:{writeBack:{enabled:true}},call:async p=>x.call(p),connect:async()=>({context:{},browser:{close:async()=>{}}}),inspect:async()=>[page()]});assert.equal(r.status,'dry_run');assert.equal(x.writes.length,0);assert.equal(JSON.stringify(x.queue),before);});
test('request id required, selection mismatch and other modes rejected before any connection',async()=>{const c=client();for(const argv of [[],['--request-id','bad/id'],['--request-id',REQUEST_ID,'--refs','T2306'],['--request-id',REQUEST_ID,'--backfill-official-descriptions'],['--request-id',REQUEST_ID,'--write-master']]){let calls=0;await assert.rejects(c.runResearchQueueOnly({args:c.parseArgs(['node','collector','--research-queue-only',...argv,'--connect-cdp','mock']),config:{},call:async()=>{calls++;throw Error('must not call');}}));assert.equal(calls,0);}const x=setup(),args=c.parseArgs(['node','collector','--research-queue-only','--request-id',REQUEST_ID,'--connect-cdp','mock']);await assert.rejects(c.runResearchQueueOnly({args,config:{},call:async()=>({ok:true,status:'preview',request:{...x.claim(true).request,request_id:'wrong'}})}),/request_id mismatch/);});
test('Version and Primary/T identity mismatches rejected locally; no guessing between Versions',()=>{const c=client(),r=setup().claim(true).request;for(const patch of [{version_key:'T2306-C01'},{primary_reference:'T2307'},{tea_reference:'T2307'},{request_type:'legacy'},{source:'Human'}])assert.throws(()=>c.buildCardResearchPlan({...r,...patch},[page()]));});
test('only requested and still missing fields generate candidates; no inferred feature flags',()=>{const c=client(),r=setup().claim(true).request;r.target['公式商品ページURL']=URL;r.missing_fields=['公式商品ページURL','ミルクティー推奨','テインフリー','水出し用ブレンド','アイスティー推奨'];const p=c.buildCardResearchPlan(r,[page()]);assert.equal(p.candidates.length,0);assert.equal(p.effective_missing_fields.length,4);assert.equal(Object.keys(p.unresolved).length,4);});
test('foreign URL, wrong REF and different Version name cannot generate candidates',()=>{const c=client(),r=setup().claim(true).request;for(const patch of [{url:'https://evil.test/t2306.html'},{refs:['T2307']},{official_name:'REUSED REFERENCE OTHER PRODUCT'},{ok:false}])assert.equal(c.buildCardResearchPlan(r,[page(patch)]).candidates.length,0);});
test('stock requires same-product explicit evidence, not Add to cart text or missing stock',()=>{const c=client(),r=setup().claim(true).request;for(const data of [null,{'@type':'Product',sku:'T999',offers:{availability:'https://schema.org/InStock'}},{'@type':'Product',sku:'T2306',offers:{}}]){const p=page();p.facts.structuredProductData=JSON.stringify(data);assert(!c.buildCardResearchPlan(r,[p]).candidates.some(p=>p.target_column==='現行ステータス'));}const p=page();p.facts.structuredProductData=JSON.stringify({'@type':'Product',sku:'T2306',offers:{availability:'https://schema.org/OutOfStock'}});assert.equal(c.buildCardResearchPlan(r,[p]).candidates.find(p=>p.target_column==='現行ステータス').suggested_value,'一時欠品・入荷待ち');});
test('blocked research records unresolved without inventing not-listed/discontinued',async()=>{const c=client(),x=setup(),request=x.claim().request;const r=await c.processCardResearchRequest({request,inspect:async()=>{throw Error('403');},call:async p=>x.call(p)});assert.equal(r.result.proposed.length,0);assert.equal(r.result.unresolved.length,14);assert.equal(r.result.unresolved.filter(p=>p.reason==='official_lookup_inconclusive').length,10);assert.equal(r.result.unresolved.filter(p=>p.reason==='unsupported').length,1);assert.equal(r.result.unresolved.filter(p=>p.reason==='image_review_pipeline_required').length,3);assert.equal(x.review.length,1);});
test('uncertain candidate write stops before completion, retry has no second claim',async()=>{const c=client(),x=setup(),request=x.claim().request;const calls=[];await assert.rejects(c.processCardResearchRequest({request,inspect:async()=>[page()],call:async p=>{calls.push(p.action);throw Error('network timeout');}}),/network timeout/);assert.deepEqual(calls,['recordCardResearchCandidate']);assert.equal(x.queue[168][5],'processing');assert.equal(x.claim().status,'busy');});
test('dedicated main branch precedes every normal side effect; legacy function bodies remain separate',()=>{const start=source.indexOf('async function main()'),branch=source.indexOf('if (args.researchQueueOnly)',start),normal=source.indexOf('await normalizeNotFoundProductUrlWriteBacks(',start),fetch=source.indexOf('await fetchMasterProducts(',start);assert(branch>start&&branch<normal&&branch<fetch);assert.match(source.slice(branch,branch+200),/return;/);const fn=source.slice(source.indexOf('async function runResearchQueueOnly('),source.indexOf('async function claimTargetDiscoveryRequest('));for(const forbidden of ['selectProducts(','writeBackImageResults(','writeBackMasterOfficialInfo(','normalizeNotFoundProductUrlWriteBacks(','runTargetedTeaDiscovery(','processTargetDiscoveryQueueRequest('])assert(!fn.includes(forbidden),forbidden);const ps=fs.readFileSync(path.join(__dirname,'../collector/run-cdp-once.ps1'),'utf8');assert(ps.includes('"--research-queue-only", "--request-id", $RequestId'));});
test('real main dispatch returns before ordinary Master fetch, state normalization and image selection',async()=>{const c=client();c.process={cwd:()=>'.',argv:['node','collector','--research-queue-only','--request-id',REQUEST_ID,'--connect-cdp','mock'],env:{}};c.console={log(){}};c.readJson=()=>({writeBack:{enabled:true}});const called=[];c.runResearchQueueOnly=async({args})=>{called.push(args.requestId);return {status:'dry_run'};};for(const name of ['fetchMasterProducts','selectProducts','normalizeNotFoundProductUrlWriteBacks','writeBackImageResults','writeBackProductPageUrl'])c[name]=()=>{throw Error('Forbidden normal operation '+name);};await c.main();assert.deepEqual(called,[REQUEST_ID]);});
test('explicit Notify me is listed/waiting, and contradictory stock evidence is held',()=>{const c=client(),r=setup().claim(true).request,p=page();p.facts.structuredProductData='';p.facts.researchAvailability={source:'visible_product_controls',text:'Me prévenir'};const plan=c.buildCardResearchPlan(r,[p]);assert.equal(plan.candidates.find(c=>c.target_column==='現行ステータス').suggested_value,'一時欠品・入荷待ち');assert.equal(plan.candidates.find(c=>c.target_column==='公式掲載状態').suggested_value,'掲載中');p.facts.structuredProductData=page().facts.structuredProductData;assert(!c.buildCardResearchPlan(r,[p]).candidates.some(c=>c.target_column==='現行ステータス'));});
test('negated recommendations cannot become positive feature flags',()=>{const c=client(),r=setup().claim(true).request,p=page();p.facts.productDescription='This tea is not caffeine-free. Do not serve iced. Do not add milk.';const plan=c.buildCardResearchPlan(r,[p]);for(const field of ['テインフリー','アイスティー推奨','ミルクティー推奨'])assert(!plan.candidates.some(c=>c.target_column===field),field);});
test('explicit preparation evidence can create only requested feature proposals',()=>{const c=client(),r=setup().claim(true).request,p=page();p.facts.preparationText='Enjoy with milk. Serve iced. Caffeine-free.';const plan=c.buildCardResearchPlan(r,[p]);for(const field of ['テインフリー','アイスティー推奨','ミルクティー推奨'])assert(plan.candidates.some(c=>c.target_column===field),field);assert(!plan.candidates.some(c=>c.target_column==='水出し用ブレンド'));});
test('a stale request/black-book name cannot override an existing official Version name',()=>{const c=client(),r=setup().claim(true).request;r.target['現在の公式名']='OTHER CURRENT VERSION';assert.equal(c.buildCardResearchPlan(r,[page()]).candidates.length,0);});
test('official reader preserves verified known page when later searches are blocked and closes page',async()=>{const c=client(),r=setup().claim(true).request;r.target['公式商品ページURL']=URL;let closed=0,inspected=0;c.inspectTargetedProductPage=async()=>{inspected++;return page();};const result=await c.inspectCardResearchPages({request:r,config:{researchSearchUi:false},context:{newPage:async()=>({evaluate:async()=>({researchAvailability:{source:'visible_product_controls',text:''},researchProductData:[]}),goto:async()=>{},locator:()=>({innerText:async()=>'Cloudflare verify you are human'}),close:async()=>closed++})}});assert.equal(result.length,1);assert.equal(inspected,1);assert.equal(closed,1);});
test('CDP connection failure cannot consume a pending request',async()=>{const c=client(),x=setup(),args=c.parseArgs(['node','collector','--research-queue-only','--request-id',REQUEST_ID,'--connect-cdp','mock','--write-back']);let calls=0;await assert.rejects(c.runResearchQueueOnly({args,config:{},call:async p=>{calls++;return x.call(p);},connect:async()=>{throw Error('CDP unavailable');}}),/CDP unavailable/);assert.equal(calls,0);assert.equal(x.writes.length,0);});

// Failure fixture models discovery, rather than injecting a resolved product page.
function searchFailureBrowser({status=403,body='',title='',production=false}={}) {
 let current='',closed=0,navigations=0;
 return {get closed(){return closed;},get navigations(){return navigations;},context:{newPage:async()=>({
  goto:async url=>{current=url;navigations++;return {status:()=>production&&url.includes('.co.jp')?200:status};},
  url:()=>current,
  evaluate:async()=>({url:current,title:production&&!current.includes('.co.jp')?'Just a moment...':title,body:production&&current.includes('.co.jp')?'検索結果が見つかりません':body,no_result:/No products|検索結果/.test(production&&current.includes('.co.jp')?'検索結果が見つかりません':body),effective_query:new global.URL(current).searchParams.get('q') || new global.URL(current).searchParams.get('search_keyword'),query_corrected:false}),
  title:async()=>production&&!current.includes('.co.jp')?'Just a moment...':title,
  locator:()=>({innerText:async()=>production&&current.includes('.co.jp')?'検索結果が見つかりません':body}),
  close:async()=>closed++
 })}};
}
for(const scenario of [
 {name:'403 empty body',status:403},
 {name:'403 Cloudflare body',status:403,body:'Cloudflare verify you are human'},
 {name:'429 empty body',status:429},
 {name:'503 empty body',status:503},
 {name:'200 challenge title only',status:200,title:'Just a moment...'},
 {name:'200 no results',status:200,body:'No products found',reason:'official_search_no_result'},
 {name:'200 unknown empty page',status:200,reason:'official_lookup_inconclusive'}
]) test('search failure fixture: '+scenario.name,async()=>{
 const c=client(),x=setup(),request=x.claim(true).request,browser=searchFailureBrowser(scenario);
 c.collectProductSearchCandidates=async()=>[];
 let productCalls=0;c.inspectTargetedProductPage=async()=>{productCalls++;throw Error('must not inspect product');};
 const before=JSON.stringify({master:x.master,review:x.review,queue:x.queue});
 const result=await c.processCardResearchRequest({request,dryRun:true,inspect:()=>c.inspectCardResearchPages({context:browser.context,config:{researchSearchUi:false},request}),call:async()=>{throw Error('no API writes');}});
 assert.equal(result.plan.candidates.length,0);assert.equal(result.master_writes,0);assert.equal(productCalls,0);
 assert.equal(Object.values(result.plan.unresolved).filter(reason=>reason===(scenario.reason||'official_access_blocked')).length,10);
 assert.equal(browser.navigations,6);assert.equal(browser.closed,1);
 assert.equal(JSON.stringify({master:x.master,review:x.review,queue:x.queue}),before);
 assert(result.plan.lookup_diagnostics.filter(d=>d.status!==null).every(d=>d.status===scenario.status));
});
test('T2306 production-equivalent search failure fixture: FR/EN403 + JP no results, no Reviews or Master writes',async()=>{
 const c=client(),x=setup(),request=x.claim().request,browser=searchFailureBrowser({production:true});
 c.collectProductSearchCandidates=async()=>[];
 const master=JSON.stringify(x.master),reviews=JSON.stringify(x.review),calls=[];
 const result=await c.processCardResearchRequest({request,inspect:()=>c.inspectCardResearchPages({context:browser.context,config:{researchSearchUi:false},request}),call:async payload=>{calls.push(payload.action);return x.call(payload);}});
 assert.equal(result.plan.candidates.length,0);assert.equal(Object.keys(result.plan.unresolved).length,14);
 assert.equal(Object.values(result.plan.unresolved).filter(r=>r==='official_lookup_inconclusive').length,10);
 assert.equal(result.plan.lookup_diagnostics.filter(d=>d.reason==='official_access_blocked').length,4);
 assert.equal(result.plan.lookup_diagnostics.filter(d=>d.reason==='official_search_no_result').length,2);
 assert.deepEqual(calls,['completeCardResearchRequest']);assert.equal(result.master_writes,0);assert.equal(result.normal_image_products,0);
 assert.equal(JSON.stringify(x.master),master);assert.equal(JSON.stringify(x.review),reviews);
});
test('multiple distinct verified pages fail closed instead of selecting first',()=>{
 const c=client(),r=setup().claim(true).request;
 const plan=c.buildCardResearchPlan(r,[page(),page({url:URL.replace('/en/','/fr/')})]);
 assert.equal(plan.candidates.length,0);assert.equal(Object.values(plan.unresolved).filter(r=>r==='version_ambiguous').length,10);
});
test('REF/name/canonical rejection is actual Version ambiguity, not access blocking',()=>{
 const c=client(),r=setup().claim(true).request;
 for(const rejected of [page({refs:['T2307']}),page({official_name:'OTHER VERSION'}),{ok:false,url:URL,reject_reason:'canonical_conflict'},
 {ok:false,url:URL,reject_reason:'target_ref_mismatch:T2306'}]) {
  const plan=c.buildCardResearchPlan(r,[rejected]);assert.equal(plan.candidates.length,0);
  assert.equal(Object.values(plan.unresolved).filter(r=>r==='version_ambiguous').length,10);
 }
});
test('single resolved-product success fixture keeps five candidates and nine unresolved',()=>{
 const c=client(),r=setup().claim(true).request,plan=c.buildCardResearchPlan(r,[page()]);
 assert.equal(plan.candidates.length,5);assert.equal(Object.keys(plan.unresolved).length,9);
});

test('conflicting rejected product cannot be hidden behind another matching page',()=>{
 const c=client(),r=setup().claim(true).request,plan=c.buildCardResearchPlan(r,[page(),{ok:false,url:URL,reject_reason:'target_ref_mismatch:T2306'}]);
 assert.equal(plan.candidates.length,0);assert.equal(Object.values(plan.unresolved).filter(r=>r==='version_ambiguous').length,10);
});
test('HTTP403 product page cannot become a verified candidate even with an optimistic parser',async()=>{
 const c=client(),r=setup().claim(true).request,browser=searchFailureBrowser({status:403});r.target['公式商品ページURL']=URL;
 c.inspectTargetedProductPage=async reader=>{await reader.goto(URL,{});return page();};
 c.collectProductSearchCandidates=async()=>[];
 const pages=await c.inspectCardResearchPages({context:browser.context,config:{researchSearchUi:false},request:r});
 assert.equal(pages.length,0);assert.equal(pages.lookup.filter(d=>d.status===403).length,7);assert(pages.lookup.every(d=>d.reason==='official_access_blocked'));
 assert.equal(c.buildCardResearchPlan(r,pages).candidates.length,0);
});

test('completion accepts new diagnostic reasons only within the existing missing-fields allowlist',()=>{
 for(const reason of ['official_access_blocked','official_search_no_result','official_lookup_inconclusive']) {
  const x=setup(),request=x.claim().request,master=JSON.stringify(x.master),review=JSON.stringify(x.review);
  const result=x.call(x.owned(request,'completeCardResearchRequest',{unresolved:{'公式商品ページURL':reason}}));
  assert.equal(result.status,'completed');assert.equal(JSON.stringify(x.master),master);assert.equal(JSON.stringify(x.review),review);
 }
 const x=setup(),request=x.claim().request;
 assert.throws(()=>x.call(x.owned(request,'completeCardResearchRequest',{unresolved:{'公式商品ページURL':'invented_reason'}})),/Invalid unresolved result/);
});
