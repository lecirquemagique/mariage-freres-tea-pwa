'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const runtime=require('../scripts/review-repair-runtime.cjs');
const {TARGETS,planHumanDecision}=require('../scripts/review-human-decision-plan.cjs');
const base={VersionKey:'T918-B01','Primary Reference':'T918','Tリファレンス番号':'T918','バージョン':'B01','現在の公式名':'MARCO POLO','現在のカテゴリ':'黒茶','茶種タグ':'黒茶','公式商品ページURL':'','現在の公式説明':'','黒い本掲載':'はい','備考':'','現行ステータス':'販売中'};
async function setup(){const x=runtime([base]);x.products=(await x.collector.fetchMasterProducts({masterGasApiUrl:'https://snapshot.invalid/'},'.',false)).products;return x;}
function fixture(rowNumber,ref){const name='OFFICIAL '+ref,url=`https://www.mariagefreres.com/en/product-${ref.toLowerCase()}.html`;
 return {rowNumber,review:{'検出ID':'id-'+ref,'検出日時':'2026-10-18','Tリファレンス番号':ref,'公式名':name,'公式URL':url,'検出種別':'unregistered_reference','ステータス':'承認','人間判定':'新規銘柄として追加','対象VersionKey':'','コメント':'keep'},
 page:{url,official_name:name,language:'EN',refs:[ref],sales_references:[ref],explicit_parent_t_references:[],facts:{url,h1:name,title:name,productDescription:'Box of 30 cotton muslin tea sachets.'},evidenceVerified:true,evidenceSource:'official_search_body; direct HTTP403; no bypass'}};}
async function planned(row=587){const x=await setup(),f=fixture(row,TARGETS[row]);return {...x,p:planHumanDecision({...x,...f})};}
for(const [row,ref]of Object.entries(TARGETS))test(`human decision: ${ref} accepts exact Primary/B01 without promoting resolver`,async()=>{
 const x=await setup(),p=planHumanDecision({...x,...fixture(Number(row),ref)});assert(p.preflight.process);assert.equal(p.resolution.mode,'unresolved');
 assert.equal(x.gas.mfImageCollectorReviewReferenceMode_(p.review),'unresolved');assert(p.validation.includes('新規銘柄として追加'));
 const info=x.gas.mfImageCollectorReviewReferenceInfo_(p.review);assert.equal(info.primaryReference,ref);assert.equal(info.skuOnly,false);assert.equal(info.tReference,'');assert.equal(Object.keys(info.salesReferences).length,0);
 assert.equal(info.primaryReferenceType,ref.startsWith('T4')?'primary':'independent_hybrid_primary');
 const out=x.gas.mfImageCollectorApplyApprovedReview_(p.review,'新規銘柄として追加','',{dry_run:true,master_snapshot:x.masterSnapshot});assert.equal(out.target_version_key,ref+'-B01');
 if(ref!=='TB8884')assert.throws(()=>x.gas.mfImageCollectorAssertPrimaryReference_(ref),/Invalid primary/);
});
test('human decision: missing/mismatched evidence never permits unresolved',async()=>{
 const {gas,p,masterSnapshot}=await planned();
 for(const key of ['公式情報JSON','Collectorが取得した根拠','公式URL','公式名']){
 const r={...p.review,[key]:''};assert(!gas.mfImageCollectorReviewDecisionOptions_(r).includes('新規銘柄として追加'));assert.throws(()=>gas.mfImageCollectorPreflightReviewRow_(587,r,{master_snapshot:masterSnapshot}));}
 for(const patch of [{primary_reference:'T4233'},{names_by_language:{EN:'wrong'}},{urls_by_language:{EN:'https://evil.invalid/'}},{t_reference:'T4233'},{reference_resolution:{mode:'sales_sku'}},{reference_resolution:{mode:'existing_primary'}}]){
 const r={...p.review,'公式情報JSON':JSON.stringify({...JSON.parse(p.review['公式情報JSON']),...patch})};assert(!gas.mfImageCollectorReviewHasIndependentEvidence_(r));assert.throws(()=>gas.mfImageCollectorPreflightReviewRow_(587,r,{master_snapshot:masterSnapshot}));}
});
test('human decision: human choice required; no alternate version, duplicate Primary or numeric parent',async()=>{
 const {gas,p,masterSnapshot:s}=await planned();const before=JSON.stringify(s);
 assert.equal(gas.mfImageCollectorReviewHumanNewPrimary_({...p.review,'人間判定':'保留'}),false);
 assert.throws(()=>gas.mfImageCollectorApplyApprovedReview_({...p.review,'人間判定':''},'新規銘柄として追加','',{dry_run:true,master_snapshot:s}),/explicit human/);
 assert.throws(()=>gas.mfImageCollectorReviewReferenceInfo_({...p.review,'人間判定':''}),/Invalid primary/);
 assert.throws(()=>gas.mfImageCollectorApplyApprovedReview_(p.review,'新規銘柄として追加','T4233S-C01',{dry_run:true,master_snapshot:s}),/B01/);
 const dup=JSON.parse(before);dup.values.push(dup.headers.map(h=>h==='Primary Reference'?'T4233S':h==='VersionKey'?'T4233S-C01':''));
 assert.throws(()=>gas.mfImageCollectorPreflightReviewRow_(587,p.review,{master_snapshot:dup}),/already exists/);assert.equal(JSON.stringify(s),before);
 assert.throws(()=>gas.mfImageCollectorNextVersionKey_(s.values,s.headers,'T4233S'),/Invalid primary/);
});
test('human decision: six-row batch passes without touching any other rows or Master',async()=>{
 const x=await setup(),plans=Object.entries(TARGETS).map(([row,ref])=>planHumanDecision({...x,...fixture(Number(row),ref)}));
 const headers=Object.keys(plans[0].review),grid=Array.from({length:604},()=>[]);grid[0]=headers;
 for(const p of plans)grid[p.rowNumber-1]=headers.map(h=>p.review[h]||'');const before=JSON.stringify(grid),masterBefore=JSON.stringify(x.masterSnapshot);
 const sheet={getLastRow:()=>grid.length,getLastColumn:()=>headers.length,getRange:(row,col,n=1,w=headers.length)=>({getValues:()=>grid.slice(row-1,row-1+n).map(r=>Array.from({length:w},(_,i)=>r[col-1+i]||''))})};
 x.gas.mfImageCollectorMasterSnapshot_=()=>JSON.parse(masterBefore);const result=x.gas.mfImageCollectorPreflightReviewRows_(sheet,586,6);
 assert.equal(result.errors.length,0,JSON.stringify(result.errors));assert.equal(result.items.filter(i=>i.process).length,6);assert.equal(JSON.stringify(grid),before);assert.equal(JSON.stringify(x.masterSnapshot),masterBefore);
 for(const p of plans){const producer=x.gas.mfImageCollectorReviewPrimaryProducer_({row_number:p.rowNumber,review:p.review});assert.equal(producer.reference,p.reference);}
});

test('acceptance: URL/REF mismatch, empty REF and unofficial hosts fail closed',async()=>{
 const {gas,p,masterSnapshot}=await planned();
 for(const patch of [{'Tリファレンス番号':''},{'公式URL':''},{'公式URL':'https://www.mariagefreres.com/en/product-t999.html'},{'公式URL':'https://www.mariagefreres.com.evil.invalid/en/product-t4233s.html'}]) {
  const r={...p.review,...patch};const info=JSON.parse(r['公式情報JSON']);info.urls_by_language={EN:r['公式URL']};r['公式情報JSON']=JSON.stringify(info);
  assert.equal(gas.mfImageCollectorReviewHumanNewPrimary_(r),false);assert.throws(()=>gas.mfImageCollectorPreflightReviewRow_(587,r,{master_snapshot:masterSnapshot}));
 }
});
test('acceptance: URL/name evidence must agree in the same language and source text',async()=>{
 const {gas,p,masterSnapshot}=await planned();
 for(const patch of [{names_by_language:{FR:p.review['公式名']},urls_by_language:{EN:p.review['公式URL']}},{names_by_language:{EN:'WRONG PRODUCT'}}]) {
  const r={...p.review,'公式情報JSON':JSON.stringify({...JSON.parse(p.review['公式情報JSON']),...patch})};assert.throws(()=>gas.mfImageCollectorPreflightReviewRow_(587,r,{master_snapshot:masterSnapshot}));
 }
 const r={...p.review,'公式名':'WRONG PRODUCT'};const info=JSON.parse(r['公式情報JSON']);info.names_by_language.EN=r['公式名'];r['公式情報JSON']=JSON.stringify(info);
 assert.throws(()=>gas.mfImageCollectorPreflightReviewRow_(587,r,{master_snapshot:masterSnapshot}));
});
test('acceptance: explicit parent evidence blocks even when parent is not yet resolved',async()=>{
 const {gas,p,masterSnapshot}=await planned();
 for(const patch of [{parent_resolution:{resolved:true}},{parent_resolution:{resolved_parent:{reference:'T4233'}}},{parent_resolution:{candidates:[{match_method:'official_explicit_t_reference'}]}},{parent_resolution:{candidates:[{match_method:'official_parent_name'}]}},{independent_primary:{explicit_parent_references:['T4233']}},{independent_primary:{explicit_parent_names:['PARENT']}},{reason:'explicit_parent_not_resolved'},{reference:'T999'}]) {
  const info=JSON.parse(p.review['公式情報JSON']);info.reference_resolution={...info.reference_resolution,...patch};const r={...p.review,'公式情報JSON':JSON.stringify(info)};
  assert.throws(()=>gas.mfImageCollectorPreflightReviewRow_(587,r,{master_snapshot:masterSnapshot}));
 }
});
test('acceptance: empty/hold/sales decision cannot take the new Primary path',async()=>{
 const {gas,p,masterSnapshot}=await planned();
 for(const decision of ['','保留','販売SKUとして追加']){
  const r={...p.review,'人間判定':decision};assert.equal(gas.mfImageCollectorReviewHumanNewPrimary_(r),false);
  assert.throws(()=>gas.mfImageCollectorApplyApprovedReview_(r,'新規銘柄として追加','',{dry_run:true,master_snapshot:masterSnapshot}),/explicit human/);
  if(decision==='保留')assert.equal(gas.mfImageCollectorPreflightReviewRow_(587,r,{master_snapshot:masterSnapshot}).category,'hold');
  else assert.throws(()=>gas.mfImageCollectorPreflightReviewRow_(587,r,{master_snapshot:masterSnapshot}));
 }
});
test('acceptance: planner rejects a different page/name/explicit parent and all non-target rows',async()=>{
 const x=await setup(),f=fixture(587,'T4233S');
 for(const patch of [{url:'https://www.mariagefreres.com/en/other-t4233s.html'},{official_name:'WRONG'},{explicit_parent_t_references:['T4233']},{facts:{...f.page.facts,parentTeaName:'PARENT'}}])assert.throws(()=>planHumanDecision({...x,...f,page:{...f.page,...patch}}));
 for(const rowNumber of [585,592,593,600,604])assert.throws(()=>planHumanDecision({...x,...f,rowNumber}),/out_of_scope/);
});
test('acceptance: TFBF retains its separate strict existing path',async()=>{
 const {gas,p}=await planned();assert.doesNotThrow(()=>gas.mfImageCollectorAssertPrimaryReference_('TFBF123'));
 const ref='TFBF123',url='https://www.mariagefreres.com/en/product-tfbf123.html',info=JSON.parse(p.review['公式情報JSON']);info.primary_reference=ref;info.names_by_language={EN:'TFBF'};info.urls_by_language={EN:url};
 const r={...p.review,'Tリファレンス番号':ref,'公式名':'TFBF','公式URL':url,'公式情報JSON':JSON.stringify(info),'Collectorが取得した根拠':`REF ${ref}; TFBF; ${url}`};
 assert.equal(gas.mfImageCollectorReviewHumanNewPrimary_(r),false);assert.equal(gas.mfImageCollectorReviewReferenceInfo_(r).primaryReference,ref);
});
