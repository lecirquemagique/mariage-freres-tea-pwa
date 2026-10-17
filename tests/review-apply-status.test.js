'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.MF_GAS_TEST_SOURCE||path.join(__dirname,'../backend/mf-image-collector.gs'),'utf8');
function setup(status='承認',decision='既存銘柄を更新'){
 const c={};vm.createContext(c);vm.runInContext(source,c);
 const review={'ステータス':status,'人間判定':decision,'対象VersionKey':'T918-B01','Tリファレンス番号':'T918','公式名':'MARCO POLO'};
 const headers=Object.keys(review),row=headers.map(h=>review[h]),calls=[];
 const sheet={getLastRow:()=>2,getLastColumn:()=>headers.length,getRange:(r)=>({getValues:()=>[r===1?headers:row]})};
 c.mfImageCollectorGetOrCreateReviewSheet_=()=>sheet;
 c.mfImageCollectorAssertReviewDecisionAllowed_=()=>{};
 c.mfImageCollectorApplyApprovedReview_=(_review,_decision,key,options)=>{calls.push({key,options});return {target_version_key:key};};
 c.mfImageCollectorSetReviewRowValues_=(_sheet,_row,updates)=>{Object.assign(review,updates);};
 c.mfImageCollectorReviewMasterChange_=()=>null;
 return {c,review,calls};
}
test('approved row preflight processes instead of skipping finalized',()=>{
 const x=setup();const r=x.c.mfImageCollectorPreflightReviewRow_(2,x.review);
 assert.equal(r.process,true);assert.equal(r.category,'apply');assert.equal(x.calls.length,1);assert.equal(x.calls[0].options.dry_run,true);
});
test('approved row becomes applied only after successful apply',()=>{
 const x=setup();assert.equal(x.c.mfImageCollectorApplyReviewDecision(2,'既存銘柄を更新','T918-B01').status,'反映済み');
 assert.equal(x.review['ステータス'],'反映済み');assert.equal(x.calls.length,1);
});
test('failed apply leaves approved status unchanged',()=>{
 const x=setup();x.c.mfImageCollectorApplyApprovedReview_=()=>{throw Error('apply failed');};
 assert.throws(()=>x.c.mfImageCollectorApplyReviewDecision(2,'既存銘柄を更新','T918-B01'),/apply failed/);assert.equal(x.review['ステータス'],'承認');
});
for(const status of ['却下','反映済み'])test(`${status} remains finalized and never invokes apply`,()=>{
 const x=setup(status),r=x.c.mfImageCollectorPreflightReviewRow_(2,x.review);
 assert.equal(r.process,false);assert.equal(r.category,'skip_finalized');assert.equal(x.calls.length,0);
 assert.throws(()=>x.c.mfImageCollectorApplyReviewDecision(2,'既存銘柄を更新','T918-B01'),/finalized/);assert.equal(x.review['ステータス'],status);
});
test('approved new Primary is a dependency producer; finalized rows are not',()=>{
 for(const status of ['要確認','保留','承認','却下','反映済み']){
  const x=setup(status,'新規銘柄として追加'),p=x.c.mfImageCollectorReviewPrimaryProducer_({row_number:2,review:x.review});
  if(['却下','反映済み'].includes(status))assert.equal(p,null);else{assert.equal(p.reference,'T918');assert.equal(p.version_key,'T918-B01');assert.equal(p.row_number,2);}
 }
});
test('held status remains eligible to apply, or stays held for hold decision',()=>{
 let x=setup('保留');assert.equal(x.c.mfImageCollectorPreflightReviewRow_(2,x.review).process,true);
 assert.equal(x.c.mfImageCollectorApplyReviewDecision(2,'既存銘柄を更新','T918-B01').status,'反映済み');
 x=setup('保留','保留');const p=x.c.mfImageCollectorPreflightReviewRow_(2,x.review);assert.equal(p.process,true);assert.equal(p.category,'hold');x.calls.length=0;
 assert.equal(x.c.mfImageCollectorApplyReviewDecision(2,'保留','T918-B01').status,'保留');assert.equal(x.calls.length,0);
});
test('unknown status continues to fail closed',()=>{
 const x=setup('不明');assert.throws(()=>x.c.mfImageCollectorPreflightReviewRow_(2,x.review),/処理できない/);assert.equal(x.calls.length,0);
});
