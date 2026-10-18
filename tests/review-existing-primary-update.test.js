'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const source=fs.readFileSync(process.env.MF_GAS_TEST_SOURCE||path.join(__dirname,'../backend/mf-image-collector.gs'),'utf8');
function setup(){
 const headers=['VersionKey','Primary Reference','Tリファレンス番号','現在の公式名','現在の公式説明','産地・国','ミルクティー推奨'];
 const data=[headers,['T700-B01','T700','T700','T700 TEA','Original English description','',''],['T700-C01','T700','T700','CURRENT','Other description','',''],['T918-B01','T918','T918','MARCO POLO','','','']],writes=[];
 const sheet={getDataRange:()=>({getValues:()=>data.map(r=>r.slice())}),getRange:(row,col)=>({getValue:()=>data[row-1][col-1],setValue:value=>{writes.push({row,col,value});data[row-1][col-1]=value;}})};
 const gas={};vm.createContext(gas);vm.runInContext(source,gas);gas.mfImageCollectorOpenSpreadsheet_=()=>({getSheetByName:()=>sheet});
 return {gas,data,headers,writes,snapshot:{values:data.map(r=>r.slice()),headers}};
}
function review(type,patch={}){return {'検出ID':'fixture-only','検出種別':type,'ステータス':'承認','人間判定':'既存銘柄を更新','対象VersionKey':'T700-B01','Tリファレンス番号':'T700','公式名':'T700 TEA','対象列':'産地・国','現在値':type==='official_description_translation'?'Original English description':'','候補値':'中国','承認済み日本語説明':type==='official_description_translation'?'人間が承認した日本語説明':'','公式情報JSON':JSON.stringify({primary_reference:'T700',reference_resolution:{mode:'existing_primary'}}),...patch};}
for(const type of ['structured_fact','official_description_translation','official_name_changed'])test(`existing Primary: ${type} explicit update passes without writes`,()=>{
 const x=setup(),r=review(type),before=JSON.stringify(x.data),snapshotBefore=JSON.stringify(x.snapshot),result=x.gas.mfImageCollectorPreflightReviewRow_(type==='structured_fact'?607:606,r,{master_snapshot:x.snapshot});
 assert.equal(result.process,true);assert.equal(result.category,'apply');assert.equal(result.target_version_key,'T700-B01');assert.equal(x.writes.length,0);assert.equal(JSON.stringify(x.data),before);assert.equal(JSON.stringify(x.snapshot),snapshotBefore);
});
test('translation requires human-approved text; candidate is never used as fallback',()=>{
 const x=setup(),r=review('official_description_translation',{'承認済み日本語説明':'','候補値':'流用してはいけない候補'});
 assert.throws(()=>x.gas.mfImageCollectorPreflightReviewRow_(606,r,{master_snapshot:x.snapshot}),/承認済み日本語説明/);
 assert.throws(()=>x.gas.mfImageCollectorApplyOfficialDescriptionTranslation_(r,{dry_run:true}),/Human-approved/);assert.equal(x.writes.length,0);
});
test('translation mock apply writes only the explicit approved text to B01',()=>{
 const x=setup(),r=review('official_description_translation',{'候補値':'未承認候補'});
 x.gas.mfImageCollectorAssertReviewDecisionAllowed_(r,'既存銘柄を更新','T700-B01',r['承認済み日本語説明'],{master_snapshot:x.snapshot});
 x.gas.mfImageCollectorApplyApprovedReview_(r,'既存銘柄を更新','T700-B01',{approved_japanese_description:r['承認済み日本語説明']});
 assert.deepEqual(x.writes,[{row:2,col:5,value:r['承認済み日本語説明']}]);assert.equal(x.data[3][4],'');assert.equal(x.data[2][4],'Other description');
});
test('existing Primary: all update types reject missing/invalid/wrong-Primary targets and duplicates',()=>{
 for(const type of ['structured_fact','official_description_translation','official_name_changed']){
  for(const key of ['', 'T700-C99','T918-B01']){const x=setup();assert.throws(()=>x.gas.mfImageCollectorPreflightReviewRow_(606,review(type,{'対象VersionKey':key}),{master_snapshot:x.snapshot}));assert.equal(x.writes.length,0);}
  const x=setup();x.snapshot.values.push(x.snapshot.values[1].slice());assert.throws(()=>x.gas.mfImageCollectorPreflightReviewRow_(606,review(type),{master_snapshot:x.snapshot}),/duplicated/);
  const y=setup(),r=review(type);r['公式情報JSON']=JSON.stringify({primary_reference:'T918',reference_resolution:{mode:'existing_primary'}});assert.throws(()=>y.gas.mfImageCollectorPreflightReviewRow_(606,r,{master_snapshot:y.snapshot}),/mismatch/);
 }
});
test('structured facts retain allowed-column and stale-value checks',()=>{
 const x=setup();for(const patch of [{'対象列':'VersionKey'},{'現在値':'日本'},{'候補値':''}])assert.throws(()=>x.gas.mfImageCollectorPreflightReviewRow_(607,review('structured_fact',patch),{master_snapshot:x.snapshot}));assert.equal(x.writes.length,0);
});
test('translation retains expected-current-description check',()=>{
 const x=setup();assert.throws(()=>x.gas.mfImageCollectorPreflightReviewRow_(606,review('official_description_translation',{'現在値':'stale'}),{master_snapshot:x.snapshot}),/changed after/);assert.equal(x.writes.length,0);
});
test('unregistered and sales-SKU detections cannot add to an existing Primary',()=>{
 const x=setup();for(const type of ['unregistered_reference','unregistered_reference_image','sales_sku_detected'])for(const decision of ['新規銘柄として追加','既存銘柄を更新','販売SKUとして追加'])assert.throws(()=>x.gas.mfImageCollectorPreflightReviewRow_(606,review(type,{'人間判定':decision}),{master_snapshot:x.snapshot}));assert.equal(x.writes.length,0);
});
test('existing Primary update exception cannot be used for new Versions',()=>{
 const x=setup();for(const type of ['official_name_changed','official_description_translation','structured_fact'])assert.throws(()=>x.gas.mfImageCollectorPreflightReviewRow_(606,review(type,{'人間判定':'既存銘柄の新バージョンとして追加'}),{master_snapshot:x.snapshot}));
});
test('606/607 fixture batch passes; finalized 605 is skipped and all fixture data stays unchanged',()=>{
 const x=setup(),reviews=[review('official_name_changed',{'ステータス':'反映済み'}),review('official_description_translation'),review('structured_fact')],h=Object.keys(reviews[0]);
 const grid=Array.from({length:607},()=>[]);grid[0]=h;reviews.forEach((r,i)=>grid[604+i]=h.map(k=>r[k]??''));const before=JSON.stringify(grid),masterBefore=JSON.stringify(x.data);
 const sheet={getLastRow:()=>607,getLastColumn:()=>h.length,getRange:(row,col,n=1,w=h.length)=>({getValues:()=>grid.slice(row-1,row-1+n).map(r=>Array.from({length:w},(_,i)=>r[col-1+i]??''))})};
 x.gas.mfImageCollectorMasterSnapshot_=()=>({values:x.data.map(r=>r.slice()),headers:x.headers});const batch=x.gas.mfImageCollectorPreflightReviewRows_(sheet,605,3);
 assert.equal(batch.errors.length,0,JSON.stringify(batch.errors));assert.equal(batch.counts.apply,2);assert.equal(batch.counts.skip_finalized,1);assert.equal(batch.items.find(i=>i.row_number===605).process,false);
 assert.equal(JSON.stringify(grid),before);assert.equal(JSON.stringify(x.data),masterBefore);assert.equal(x.writes.length,0);
});
