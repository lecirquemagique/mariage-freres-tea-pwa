'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),setup=require('./review-apply-harness.cjs');
const mw=x=>x.writes.filter(w=>w.name==='銘柄マスター').length;
function pause(x,row=616,stage='Master'){
 x.hooks.beforeWrite=op=>{if(op.name===(stage==='Master'?'銘柄マスター':'変更候補レビュー'))throw Error('fixture interrupt');};
 assert.throws(()=>x.apply(row),/fixture interrupt/);x.hooks.beforeWrite=null;
 const [key,json]=[...x.props][0];return {key,record:JSON.parse(json)};
}
function tamper(x,change,rehash=true){
 const [k,v]=[...x.props][0],r=JSON.parse(v);change(r);
 if(rehash)r.record_hash=x.c.mfImageCollectorApplyRecordHash_(r);x.props.set(k,JSON.stringify(r));
}
function token(x,row=616){const s=x.c.mfImageCollectorLocateApplyReview_(x.rs,row);return x.c.mfImageCollectorApplyTarget_(x.c.mfImageCollectorPrepareApply_(x.rs,s,s.review['人間判定'],'',s.review['承認済み日本語説明']).plan);}
function withToken(x,t,row=616){return x.c.mfImageCollectorApplyReviewDecision(row,t.human_decision,'','',x.get(row,'承認済み日本語説明'),{apply_target:t});}
for(const [name,change,rehash] of [
 ['tampered expected value',r=>{r.cells[0].expected_value='tampered';r.expected_master_value['現在の公式説明']='tampered';r.expected_value_hash='fake';},true],
 ['tampered expected with recomputed hashes',r=>{r.cells[0].expected_value='tampered';r.expected_master_value['現在の公式説明']='tampered';},'expected'],
 ['empty cells',r=>{r.cells=[];},true],
 ['schema mismatch',r=>{r.schema_version=999;},true],
 ['missing approved field',r=>{delete r.approved_value;},true],
 ['target mapping mismatch',r=>{r.cells[0].column='現在の公式名';},true],
 ['invalid record checksum',r=>{r.state='MASTER_VERIFIED';},false],
 ['invalid state',r=>{r.state='UNKNOWN';},true],
 ['approved value mismatch',r=>{r.approved_value='different';},true],
 ['wrong spreadsheet mapping',r=>{r.spreadsheet_id='another-master';},true],
 ['wrong result metadata',r=>{r.result={sales_sku:'TB999'};},true]
])test(name+' resume is rejected before writes',()=>{
 const x=setup();pause(x);tamper(x,r=>{change(r);if(rehash==='expected')r.expected_value_hash=x.c.mfImageCollectorReviewApplyHash_(r.expected_master_value);},rehash!==false);
 assert.throws(()=>x.apply(),/Resume|resume|Reconstructed/);assert.equal(mw(x),0);assert.equal(x.get(616,'ステータス'),'承認');
});
test('broken resume JSON fails closed',()=>{const x=setup(),{key}=pause(x);x.props.set(key,'{');assert.throws(()=>x.apply(),/resume JSON/);assert.equal(mw(x),0);});
test('resume exact JSON read-back mismatch fails before Master write',()=>{
 const x=setup();x.hooks.afterProperty=(k)=>{x.props.set(k,x.props.get(k)+' ');};assert.throws(()=>x.apply(),/persistence verification/);assert.equal(mw(x),0);
});
for(const emptyCaller of [false,true])for(const changeVersion of [false,true])test(`resume binds Review Version with emptyCaller=${emptyCaller}, changed=${changeVersion}`,()=>{
 const x=setup();pause(x);const c=x.master[1].slice();c[0]='T425-C01';x.master.push(c);
 if(changeVersion)x.set(616,'対象VersionKey','T425-C01');
 const call=()=>x.c.mfImageCollectorApplyReviewDecision(616,'既存銘柄を更新',emptyCaller?'':x.get(616,'対象VersionKey'),'','');
 if(changeVersion){assert.throws(call,/VersionKey changed/);assert.equal(mw(x),0);}else{assert.equal(call().verified,true);assert.equal(mw(x),1);}
 assert.equal(x.master[2][4],'');
});
test('same detection ID follows its moved row after lock acquisition',()=>{
 const x=setup();x.hooks.lock=()=>{[x.grid[615],x.grid[618]]=[x.grid[618],x.grid[615]];};
 const r=x.apply();assert.equal(r.row_number,619);assert.equal(x.get(619,'検出ID'),'fixture-616');assert.equal(x.get(619,'ステータス'),'反映済み');assert.equal(x.get(616,'ステータス'),'承認');assert.equal(mw(x),1);
});
test('a replacement Review at the old row is rejected when selected ID disappears',()=>{
 const x=setup();x.hooks.lock=()=>{x.grid[615]=x.grid[618].slice();x.grid[618]=x.rh.map(()=> '');};
 assert.throws(()=>x.apply(),/not found/);assert.equal(x.writes.length,0);
});
test('batch confirmation cannot apply a replacement moved into the selected row',()=>{
 const x=setup();x.hooks.alert=title=>{if(title==='選択行を一括反映'){x.set(619,'検出ID','replacement-review');}};
 const r=x.c.mfImageCollectorApplySelectedReviewRows();assert.equal(r.failed,1);assert.equal(mw(x),0);
});
test('batch follows the originally approved Review after sorting, never the unselected replacement',()=>{
 const x=setup(),expected=x.get(616,'承認済み日本語説明'),hidden=x.grid[618].slice();
 hidden[x.rh.indexOf('検出ID')]='unselected-detection';hidden[x.rh.indexOf('対象列')]='産地・国';hidden[x.rh.indexOf('候補値')]='中国';x.grid[614]=hidden;
 x.hooks.alert=title=>{if(title==='選択行を一括反映')[x.grid[615],x.grid[614]]=[x.grid[614],x.grid[615]];};
 const r=x.c.mfImageCollectorApplySelectedReviewRows();assert.equal(r.failed,0);assert.equal(r.applied,3);assert.equal(x.master[1][4],expected);assert.equal(x.master[1][8],'');
 assert.equal(x.get(615,'検出ID'),'fixture-616');assert.equal(x.get(615,'ステータス'),'反映済み');assert.equal(x.get(616,'検出ID'),'unselected-detection');assert.equal(x.get(616,'ステータス'),'承認');
});
for(const field of ['承認済み日本語説明','候補値','対象VersionKey','人間判定','根拠原文'])test('locked approval change detected: '+field,()=>{
 const x=setup();x.hooks.lock=()=>x.set(616,field,'changed');assert.throws(()=>x.apply());assert.equal(x.writes.length,0);
});
test('caller cannot replace approved content hash',()=>{
 const x=setup(),t=token(x);t.approved_content_hash='changed';assert.throws(()=>withToken(x,t),/content hash/);assert.equal(mw(x),0);
});
test('caller target mapping is checked even when approved content hash is unchanged',()=>{
 const x=setup(),t=token(x);t.target_column='現在の公式名';assert.throws(()=>withToken(x,t),/target changed/);assert.equal(mw(x),0);
});
test('AK changed during an interrupted apply cannot reuse the frozen value',()=>{
 const x=setup();pause(x,616,'Review');x.set(616,'承認済み日本語説明','changed approval');const n=mw(x);assert.throws(()=>x.apply(),/identity/);assert.equal(mw(x),n);
});
test('HOJICHA 619/620 final structured values are frozen, never merged with a third value',()=>{
 for(const row of [619,620]){const x=setup(),col=row===619?5:6;pause(x,row,'Review');const n=mw(x);x.master[1][col]+='、ローズ';assert.throws(()=>x.apply(row),/third value/);assert.equal(mw(x),n);assert.equal(x.get(row,'ステータス'),'承認');}
});
test('active record and compact completed receipt contain schema and self-consistent identity',()=>{
 const x=setup(),{record}=pause(x);for(const field of ['schema_version','detection_id','review_row','version_key','ref','target_column','detection_type','human_decision','approved_value','expected_master_value','expected_value_hash','review_identity_hash','approved_content_hash','cells','state'])assert(Object.hasOwn(record,field),field);
 assert.equal(record.state,'PREPARED');x.apply();const receipt=JSON.parse([...x.props.values()][0]);assert.equal(receipt.state,'COMPLETED');assert(!Object.hasOwn(receipt,'cells'));assert(!Object.hasOwn(receipt,'approved_value'));assert.equal(receipt.outcome,'verified');
});
test('row number and timestamps do not affect identity hash',()=>{
 const x=setup(),a=token(x);[x.grid[615],x.grid[618]]=[x.grid[618],x.grid[615]];x.set(619,'検出日時','later');x.set(619,'処理日時',new Date());const b=token(x,619);assert.equal(a.approved_content_hash,b.approved_content_hash);
});
test('completed receipts expire after seven days, active and corrupt records are not deleted',()=>{
 const x=setup();x.apply();const [k,v]=[...x.props][0],receipt=JSON.parse(v);receipt.completed_at=new Date(Date.now()-8*86400000).toISOString();receipt.record_hash=x.c.mfImageCollectorApplyRecordHash_(receipt);x.props.set(k,JSON.stringify(receipt));
 const y=setup(),p=pause(y);x.props.set(p.key+'-active',p.record?JSON.stringify({...p.record,property_key:p.key+'-active',record_hash:''}):'');
 const active={...p.record,property_key:p.key+'-active'};active.record_hash=x.c.mfImageCollectorApplyRecordHash_(active);x.props.set(active.property_key,JSON.stringify(active));x.props.set('MF_REVIEW_APPLY_V2_corrupt','{');
 assert.equal(x.c.mfImageCollectorCleanupReviewApply_().removed,1);assert(!x.props.has(k));assert(x.props.has(active.property_key));assert(x.props.has('MF_REVIEW_APPLY_V2_corrupt'));
});
test('completed receipt count is bounded at100, active records are retained',()=>{
 const x=setup();x.apply();const base=JSON.parse([...x.props.values()][0]);x.props.clear();
 for(let i=0;i<105;i++){const r={...base,property_key:'MF_REVIEW_APPLY_V2_'+i,completed_at:new Date(Date.now()-i*1000).toISOString()};r.record_hash=x.c.mfImageCollectorApplyRecordHash_(r);x.props.set(r.property_key,JSON.stringify(r));}
 assert.equal(x.c.mfImageCollectorCleanupReviewApply_().removed,5);assert.equal(x.props.size,100);
});
test('an old completed receipt cannot block a different Review reusing its row',()=>{
 const x=setup();x.apply();x.set(616,'検出ID','new-detection');x.set(616,'ステータス','承認');x.set(616,'処理日時','');x.set(616,'現在値',x.master[1][4]);x.set(616,'承認済み日本語説明','new approved content');assert.equal(x.apply().verified,true);assert.equal(x.master[1][4],'new approved content');
});
test('finished translation replay without a receipt performs zero property and sheet writes',()=>{
 const x=setup();x.apply();x.props.clear();const n=x.writes.length;x.c.mfImageCollectorAssertReviewDecisionAllowed_=()=>{throw Error('normal apply guard must not run');};
 assert.equal(x.apply().finished,true);assert.equal(x.writes.length,n);assert.equal(x.props.size,0);
});
test('finished new Primary replay skips normal existing-Primary guard and creates no resume',()=>{
 const x=setup();for(const [h,v]of Object.entries({'検出種別':'unregistered_reference','公式名':'NEW TEA','公式URL':'https://www.mariagefreres.com/fr/new-t9999.html','Tリファレンス番号':'T9999','人間判定':'新規銘柄として追加','対象VersionKey':'T9999-B01','DB既存VersionKey':'','DB既存T':'','対象列':'','現在値':'','候補値':'','承認済み日本語説明':'','公式情報JSON':JSON.stringify({primary_reference:'T9999',reference_resolution:{mode:'independent_primary'}})}))x.set(616,h,v);
 x.apply();x.props.clear();const n=x.writes.length;x.c.mfImageCollectorAssertReviewDecisionAllowed_=()=>{throw Error('existing primary guard');};assert.equal(x.apply().finished,true);assert.equal(x.writes.length,n);assert.equal(x.props.size,0);
});
test('a matching Master value is insufficient without active resume identity',()=>{
 const x=setup();x.master[1][4]=x.get(616,'承認済み日本語説明');assert.throws(()=>x.apply(),/no valid resume identity/);assert.equal(x.props.size,0);assert.equal(x.writes.length,0);
});
test('state never moves backwards and a verified Master reverting to old value is rejected',()=>{
 const x=setup(),{record}=pause(x,616,'Review');assert.equal(record.state,'MASTER_VERIFIED');x.master[1][4]='';assert.throws(()=>x.apply(),/regressed/);assert.equal(JSON.parse([...x.props.values()][0]).state,'MASTER_VERIFIED');
});
test('an interrupted dependent refresh is resumed before compaction',()=>{
 const x=setup();x.c.mfImageCollectorReviewMasterChange_=()=>({type:'fixture'});x.c.mfImageCollectorRefreshDependentReviews_=()=>{throw Error('refresh interrupted');};
 assert.throws(()=>x.apply(),/refresh interrupted/);assert.equal(JSON.parse([...x.props.values()][0]).state,'REVIEW_WRITTEN');const n=x.writes.length;let refreshed=0;
 x.c.mfImageCollectorRefreshDependentReviews_=()=>{refreshed++;return {errors:[]};};assert.equal(x.apply().finished,true);assert.equal(refreshed,1);assert.equal(x.writes.length,n);assert.equal(JSON.parse([...x.props.values()][0]).state,'COMPLETED');
});
test('getProperty failure prevents any Master write',()=>{const x=setup();x.hooks.getProperty=()=>{throw Error('getProperty failed');};assert.throws(()=>x.apply(),/getProperty failed/);assert.equal(mw(x),0);});
test('property state-save failure after Master write resumes without rewriting Master',()=>{
 const x=setup();x.hooks.beforeProperty=(_k,v)=>{if(JSON.parse(v).state==='MASTER_WRITTEN')throw Error('state save failed');};assert.throws(()=>x.apply(),/state save failed/);const n=mw(x);assert.equal(n,1);x.hooks.beforeProperty=null;assert.equal(x.apply().verified,true);assert.equal(mw(x),n);
});
test('source-display token refuses changed evidence without relying on row number',()=>{
 const x=setup(),r=x.c.mfImageCollectorReadApplyReview_(x.rs,616),hash=x.c.mfImageCollectorReviewApplyDisplayHash_(r);x.set(616,'根拠原文','changed');
 assert.throws(()=>x.c.mfImageCollectorApplyReviewDecision(616,'既存銘柄を更新','','','',{expected_detection_id:'fixture-616',review_source_hash:hash}),/Displayed Review approval changed/);assert.equal(mw(x),0);
});
test('dialog stores the explicit human approval and AK under lock before applying',()=>{
 const x=setup();x.set(616,'人間判定','');x.set(616,'承認済み日本語説明','');x.set(616,'ステータス','要確認');
 const hash=x.c.mfImageCollectorReviewApplyDisplayHash_(x.c.mfImageCollectorReadApplyReview_(x.rs,616));
 const r=x.c.mfImageCollectorApplyReviewDecision(616,'既存銘柄を更新','T425-B01','','dialog approved Japanese',{expected_detection_id:'fixture-616',review_source_hash:hash});
 assert.equal(r.verified,true);assert.equal(x.master[1][4],'dialog approved Japanese');assert.equal(x.get(616,'人間判定'),'既存銘柄を更新');assert.equal(x.get(616,'承認済み日本語説明'),'dialog approved Japanese');
});
test('dialog cannot replace an approval changed after the page was displayed',()=>{
 const x=setup(),hash=x.c.mfImageCollectorReviewApplyDisplayHash_(x.c.mfImageCollectorReadApplyReview_(x.rs,616));x.set(616,'人間判定','保留');
 assert.throws(()=>x.c.mfImageCollectorApplyReviewDecision(616,'既存銘柄を更新','T425-B01','','new approval',{expected_detection_id:'fixture-616',review_source_hash:hash}),/Displayed Review approval changed/);assert.equal(x.writes.length,0);
});
test('dialog cannot silently overwrite a concurrent locked approval',()=>{
 const x=setup(),hash=x.c.mfImageCollectorReviewApplyDisplayHash_(x.c.mfImageCollectorReadApplyReview_(x.rs,616));x.hooks.lock=()=>x.set(616,'人間判定','却下');
 assert.throws(()=>x.c.mfImageCollectorApplyReviewDecision(616,'既存銘柄を更新','T425-B01','','new approval',{expected_detection_id:'fixture-616',review_source_hash:hash}),/after confirmation/);assert.equal(x.writes.length,0);
});
test('dialog tracks a moved Review using the displayed ID',()=>{
 const x=setup(),hash=x.c.mfImageCollectorReviewApplyDisplayHash_(x.c.mfImageCollectorReadApplyReview_(x.rs,616));[x.grid[615],x.grid[618]]=[x.grid[618],x.grid[615]];
 const r=x.c.mfImageCollectorApplyReviewDecision(616,'既存銘柄を更新','T425-B01','','human approved',{expected_detection_id:'fixture-616',review_source_hash:hash});assert.equal(r.row_number,619);assert.equal(x.get(616,'ステータス'),'承認');assert.equal(x.master[1][4],'human approved');
});
test('translation may be held or rejected without AK; no Master or resume write',()=>{
 for(const decision of ['保留','却下']){const x=setup();x.set(616,'承認済み日本語説明','');x.set(616,'人間判定',decision);assert.equal(x.apply().status,decision);assert.equal(mw(x),0);assert.equal(x.props.size,0);}
});
test('Review B01 to valid C01 change inside lock is refused even with an empty caller key',()=>{
 const x=setup(),row=x.master[1].slice();row[0]='T425-C01';x.master.push(row);x.hooks.lock=()=>x.set(616,'対象VersionKey','T425-C01');
 assert.throws(()=>x.c.mfImageCollectorApplyReviewDecision(616,'既存銘柄を更新','','',''),/content hash|target changed/);assert.equal(mw(x),0);
});
test('a second apply cannot enter the same ScriptLock during a Master write',()=>{
 const x=setup();let blocked=0;x.hooks.afterWrite=op=>{if(op.name==='銘柄マスター'){assert.throws(()=>x.apply(),/busy/);blocked++;}};
 assert.equal(x.apply().verified,true);assert.equal(blocked,1);assert.equal(mw(x),1);
});
