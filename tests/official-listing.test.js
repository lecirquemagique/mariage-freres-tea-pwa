'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sales=require('../sales-state'),fixture=require('./fixtures/official-listing.json');
const source=fs.readFileSync(require.resolve('../backend/mf-image-collector.gs'),'utf8');
const gas=()=>{const c={};vm.createContext(c);vm.runInContext(source,c);vm.runInContext(fs.readFileSync(require.resolve('../backend/official-listing.gs'),'utf8'),c);return c;};
const copy=v=>JSON.parse(JSON.stringify(v));
test('four states and old API normalize without mutating stored legacy values',()=>{
  for(const state of ['未確認','掲載中','公式掲載なし','公式掲載終了']) assert.equal(sales.listing({'公式掲載状態':state}),state);
  for(const state of ['',undefined,'掲載未確認','unknown']) {const row={'公式掲載状態':state};assert.equal(sales.listing(row),'未確認');assert.equal(row['公式掲載状態'],state);}
  assert.equal(sales.listing({'公式掲載状態':'未掲載'}),'未掲載');
  assert.deepEqual(sales.badges({'公式掲載状態':'未掲載'},[]),['未掲載']);
});
test('listing badges remain independent of every sales status',()=>{
  for(const state of ['未確認','掲載中','公式掲載なし','公式掲載終了'])for(const status of ['販売中','終売推定','終売確定']) {
    const row={'公式掲載状態':state,'現行ステータス':status};assert.equal(sales.listing(row),state);
    assert.equal(sales.badges(row,[])[0],state==='掲載中'?'公式掲載中':state);
    if(status.startsWith('終売'))assert(sales.badges(row,[]).includes(status));
    assert.equal(sales.matchesScope(row,'all',true),true);
  }
});
test('T2215 and T935 remain unknown, legacy rows keep previous scopes',()=>{
  const before=JSON.stringify(fixture.rows),c=gas();
  for(const row of fixture.rows.slice(0,2)){
    assert.equal(sales.listing(row),'未確認');
  }
  const legacy=fixture.rows[5];assert.equal(sales.matchesScope(legacy,'past'),true);assert.equal(sales.matchesScope(legacy,'shopping'),false);
  assert.equal(sales.isOldVersion(legacy,[legacy,{'Primary Reference':'T3','VersionKey':'T3-C01','公式掲載状態':'掲載中'}]),false);
  assert.equal(JSON.stringify(fixture.rows),before);
});
test('negative plans only affect listing/evidence and never sales, duration or original data',()=>{
  const c=gas(),ob=fixture.negativeObservation,row=fixture.rows[4],before=JSON.stringify([ob,row]);
  for(const status of ['販売中','終売推定','終売確定']){
    const p=c.mfImageCollectorListingObservationPlan_({...row,'現行ステータス':status},ob);
    assert.equal(p.requires_human_review,true);assert.equal(p.actual_writes,0);
    assert.deepEqual(Object.keys(p.updates).sort(),['公式掲載根拠／出典','公式掲載状態'].sort());
    assert.equal(p.updates['公式掲載状態'],'公式掲載終了');
  }
  assert.equal(JSON.stringify([ob,row]),before);
});
test('absence requires no historical match; ended requires matching historical evidence',()=>{
  const c=gas(),row=fixture.rows[4],ob=copy(fixture.negativeObservation);
  ob.listing='公式掲載なし';assert.throws(()=>c.mfImageCollectorListingObservationPlan_(row,ob));
  ob.history_checked_no_match=true;ob.matching_history_found=false;
  assert.equal(c.mfImageCollectorListingObservationPlan_(row,ob).updates['公式掲載状態'],'公式掲載なし');
  for(const field of ['history_source_url','history_date','history_evidence','previous_url','history_identity_verified','old_url_checked','relocation_checked']){
    assert.throws(()=>c.mfImageCollectorListingObservationPlan_(row,{...fixture.negativeObservation,[field]:null}),field);
  }
});
test('404 alone, blocking, incomplete markets, wrong Version and missing identity never classify negative',()=>{
  const c=gas(),row=fixture.rows[4],ob=fixture.negativeObservation;
  for(const change of [{access_blocked:true},{markets:['FR']},{checks:[]},{scope_complete:false},{identity_verified:false},
    {identity_evidence:''},{version_key:'T2-C01'},{checked_at:'2026-02-30'},{checked_at:'2099-01-01'},
    {relocation_checked:false},{alternate_references_checked:false},{current_listing_found:true},{listing:'未掲載'},
    {checks:ob.checks.map(x=>({...x,accessible:false}))}]) assert.throws(()=>c.mfImageCollectorListingObservationPlan_(row,{...ob,...change}),JSON.stringify(change));
});
test('listed official JP/FR/EN pages are supported; impostors and network failures are rejected',()=>{
  const c=gas(),row=fixture.rows[4],ob={...fixture.negativeObservation,listing:'掲載中',product_page_verified:true};
  for(const url of ['https://www.mariagefreres.co.jp/view/item/0001','https://www.mariagefreres.com/fr/fixture.html','https://mariagefreres.com/en/fixture.html']){
    const p=c.mfImageCollectorListingObservationPlan_(row,{...ob,source_url:url});assert.equal(p.updates['公式掲載状態'],'掲載中');assert.equal(p.requires_human_review,false);
  }
  for(const url of ['https://mariagefreres.com.evil.test/fr/a.html','https://mariagefreres.com@evil.test/fr/a.html','http://www.mariagefreres.com/fr/a.html','https://www.mariagefreres.com/']) assert.throws(()=>c.mfImageCollectorListingObservationPlan_(row,{...ob,source_url:url}));
  assert.throws(()=>c.mfImageCollectorListingObservationPlan_(row,{...ob,access_blocked:true}));
});
test('validation plan preserves legacy values and separates evidence column without writes',()=>{
  const c=gas(),headers=['VersionKey','公式掲載状態','現行ステータス'],before=JSON.stringify(headers);
  const p=c.mfImageCollectorOfficialListingSchemaPlan_(headers,fixture.rows);
  assert.deepEqual(Array.from(p.canonical_states),['未確認','掲載中','公式掲載なし','公式掲載終了']);
  for(const value of ['未掲載','掲載未確認'])assert(p.listing_allowed.includes(value));
  assert.equal(p.add_columns.length,1);assert.equal(p.add_columns[0].header,'公式掲載根拠／出典');
  assert.equal(c.mfImageCollectorOfficialListingSchemaPlan_(p.headers,fixture.rows).add_columns.length,0);
  assert.equal(JSON.stringify(headers),before);assert.equal(p.actual_writes,0);
  assert.throws(()=>c.mfImageCollectorOfficialListingSchemaPlan_(['VersionKey','VersionKey'],[]));
});
test('actual Master validation helper uses listing choices instead of image statuses (Sheet mock)',()=>{
  const c=gas(),calls=[];
  const builder={requireValueInList(v){calls.push(Array.from(v));return this;},setAllowInvalid(v){assert.equal(v,false);return this;},build(){return 'rule';}};
  c.SpreadsheetApp={newDataValidation:()=>builder};
  c.mfImageCollectorApplyStatusValidation_({getDataRange:()=>({getValues:()=>[['公式掲載状態'],['未掲載']]}),getMaxRows:()=>8,getRange:(...args)=>({setDataValidation(v){assert.deepEqual(args,[2,1,7,1]);assert.equal(v,'rule');}})},1,'公式掲載状態');
  assert(calls[0].includes('公式掲載終了'));assert(calls[0].includes('未掲載'));assert(!calls[0].includes('available'));
});
test('old listing duration is never converted into sales status by the listing planner',()=>{
  const c=gas(),row={...fixture.rows[4],'公式未掲載確認開始日':'2000-01-01','販売状態根拠／出典':'old'};
  const p=c.mfImageCollectorListingObservationPlan_(row,fixture.negativeObservation);
  assert.equal(p.updates['現行ステータス'],undefined);assert.equal(p.updates['販売状態根拠／出典'],undefined);
});
test('offline planner emits review candidates only, with exact-target and duplicate guards',()=>{
  const {plan}=require('../scripts/official-listing-dry-run.cjs'),before=JSON.stringify(fixture);
  const p=plan(fixture);assert.equal(p.candidates.length,1);assert.equal(p.actual_writes,0);assert.deepEqual(p.requests,[]);
  assert.equal(JSON.stringify(fixture),before);
  for(const input of [{...fixture,rows:[]},{...fixture,rows:[...fixture.rows,fixture.rows[4]]},
    {...fixture,observations:[fixture.negativeObservation,fixture.negativeObservation]}]){
    const result=plan(input);assert.equal(result.candidates.length,0);assert(result.issues.length>0);assert.equal(result.ready_for_review,false);
  }
});
test('teaData keeps old fields and never changes existing evidence or Master snapshot',()=>{
  for(const existing of [false,true]){
    const c=gas(),headers=['VersionKey','公式掲載状態','現行ステータス','茶葉画像URL',...(existing?['公式掲載根拠／出典']:[])];
    const values=[headers,['T2215-B01','未確認','販売中','fixture-image',...(existing?['reviewed evidence']:[])],[]],before=JSON.stringify(values);
    c.PropertiesService={getScriptProperties:()=>({getProperty:()=>null})};
    c.mfImageCollectorOpenSpreadsheet_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>values})})});
    const result=c.mfImageCollectorGetTeaData_();assert.equal(result.rows.length,1);
    assert.equal(result.rows[0]['公式掲載根拠／出典'],existing?'reviewed evidence':'');
    assert.equal(result.rows[0]['現行ステータス'],'販売中');assert.equal(result.rows[0]['茶葉画像URL'],'fixture-image');
    assert.equal(JSON.stringify(values),before);
  }
});
test('GAS preparation refuses a stale or unrelated production source',()=>{
  const {patch}=require('../scripts/prepare-official-listing-gas.cjs');
  assert.throws(()=>patch('function unrelated() {}'),/Re-baseline/);
});
test('observation dates follow GAS Asia/Tokyo at local midnight',()=>{
  const c=gas(),NativeDate=Date;
  c.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-11-23T15:10:00Z']));}};
  c.Session={getScriptTimeZone:()=> 'Asia/Tokyo'};
  c.Utilities={formatDate(date,zone){assert.equal(zone,'Asia/Tokyo');return '2026-11-24';}};
  const p=c.mfImageCollectorListingObservationPlan_(fixture.rows[4],{...fixture.negativeObservation,checked_at:'2026-11-24'});
  assert.equal(p.actual_writes,0);assert.throws(()=>c.mfImageCollectorListingObservationPlan_(fixture.rows[4],{...fixture.negativeObservation,checked_at:'2026-11-25'}));
});
