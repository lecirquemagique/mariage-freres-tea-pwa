'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const setup=require('./review-apply-harness.cjs');
const review=x=>x.c.mfImageCollectorReadApplyReview_(x.rs,616);
test('approved row preflight processes instead of skipping finalized',()=>{
 const x=setup(),r=x.c.mfImageCollectorPreflightReviewRow_(616,review(x));
 assert.equal(r.process,true);assert.equal(r.category,'apply');assert.equal(x.writes.length,0);
});
test('approved row becomes applied only after successful apply',()=>{
 const x=setup();assert.equal(x.apply().status,'反映済み');assert.equal(x.get(616,'ステータス'),'反映済み');
});
test('failed apply leaves approved status unchanged',()=>{
 const x=setup();x.hooks.beforeWrite=()=>{throw Error('apply failed');};
 assert.throws(()=>x.apply(),/apply failed/);assert.equal(x.get(616,'ステータス'),'承認');
});
for(const status of ['却下','反映済み'])test(status+' remains finalized in status-policy preflight',()=>{
 const x=setup();x.set(616,'ステータス',status);const r=x.c.mfImageCollectorPreflightReviewRow_(616,review(x));
 assert.equal(r.process,false);assert.equal(r.category,'skip_finalized');assert.equal(x.writes.length,0);
 if(status==='却下')assert.throws(()=>x.apply(),/finalized/);
});
test('approved new Primary is a dependency producer; finalized rows are not',()=>{
 const x=setup();for(const status of ['要確認','保留','承認','却下','反映済み']){
  const r={'ステータス':status,'人間判定':'新規銘柄として追加','対象VersionKey':'T918-B01','Tリファレンス番号':'T918'};
  const p=x.c.mfImageCollectorReviewPrimaryProducer_({row_number:2,review:r});
  if(['却下','反映済み'].includes(status))assert.equal(p,null);else{assert.equal(p.reference,'T918');assert.equal(p.version_key,'T918-B01');}
 }
});
test('held status remains eligible to apply, or stays held for hold decision',()=>{
 const x=setup();x.set(616,'ステータス','保留');assert.equal(x.apply().status,'反映済み');
 const y=setup();y.set(616,'ステータス','保留');y.set(616,'人間判定','保留');
 assert.equal(y.apply().status,'保留');assert.equal(y.writes.filter(w=>w.name==='銘柄マスター').length,0);assert.equal(y.props.size,0);
});
test('unknown status continues to fail closed',()=>{
 const x=setup();x.set(616,'ステータス','不明');assert.throws(()=>x.c.mfImageCollectorPreflightReviewRow_(616,review(x)),/処理できない/);assert.equal(x.writes.length,0);
});
