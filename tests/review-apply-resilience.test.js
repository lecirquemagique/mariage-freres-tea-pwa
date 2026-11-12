'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),setup=require('./review-apply-harness.cjs');
const masterWrites=x=>x.writes.filter(w=>w.name==='銘柄マスター');
const immutable=x=>[616,617,618,619,620].map(n=>[n,x.get(n,'検出ID'),x.get(n,'候補値'),x.get(n,'根拠原文'),x.get(n,'公式情報JSON'),x.get(n,'Collectorが取得した根拠')]);

test('translation writes only AK, reads Master and Review back, preserves provenance',()=>{
 const x=setup(),before=immutable(x),r=x.apply();assert.equal(r.verified,true);assert.equal(r.already_applied,false);
 assert.equal(x.master[1][4],x.get(616,'承認済み日本語説明'));assert.notEqual(x.master[1][4],x.get(616,'候補値'));
 assert.equal(x.get(616,'ステータス'),'反映済み');assert(x.get(616,'処理日時'));assert.deepEqual(immutable(x),before);
 assert(x.trace.filter(t=>t.op==='readAll'&&t.name==='銘柄マスター').length>=3);
});

test('failure after Master write before Review: retry finalizes without rewriting Master',()=>{
 const x=setup();x.hooks.beforeWrite=op=>{if(op.name==='変更候補レビュー')throw Error('cut after Master');};
 assert.throws(()=>x.apply(),/cut after Master/);assert.equal(x.master[1][4],x.get(616,'承認済み日本語説明'));assert.equal(x.get(616,'ステータス'),'承認');
 const count=masterWrites(x).length;x.hooks.beforeWrite=null;const r=x.apply();assert.equal(r.already_applied,true);assert.equal(masterWrites(x).length,count);assert.equal(x.get(616,'ステータス'),'反映済み');
});

test('a coincidental Master match without resume cannot complete an unfinished Review',()=>{
 const x=setup();x.master[1][4]=x.get(616,'承認済み日本語説明');assert.throws(()=>x.apply(),/no valid resume identity/);assert.equal(masterWrites(x).length,0);assert.equal(x.get(616,'ステータス'),'承認');
});

for(const row of [616,619,620])test(`third Master value fails closed for Review ${row}`,()=>{
 const x=setup(),col=row===616?4:row===619?5:6;x.master[1][col]='concurrent third value';
 assert.throws(()=>x.apply(row),/third value/);assert.equal(masterWrites(x).length,0);assert.equal(x.get(row,'ステータス'),'承認');
});

test('Master write accepted but missing on read-back never completes Review',()=>{
 const x=setup();x.hooks.drop=op=>op.name==='銘柄マスター';assert.throws(()=>x.apply(),/Master read-back/);
 assert.equal(x.get(616,'ステータス'),'承認');assert.equal(x.get(616,'処理日時'),'');
});

test('Master write changes value on read-back: explicit error, Review still approved',()=>{
 const x=setup();x.hooks.afterWrite=op=>{if(op.name==='銘柄マスター')x.master[1][4]='wrong persisted value';};
 assert.throws(()=>x.apply(),/third value|read-back/);assert.equal(x.get(616,'ステータス'),'承認');
});

test('Review update accepted but missing status is detected; retry preserves first timestamp',()=>{
 const x=setup();x.hooks.drop=op=>op.name==='変更候補レビュー'&&op.col===x.rh.indexOf('ステータス')+1;
 assert.throws(()=>x.apply(),/completion read-back/);const timestamp=x.get(616,'処理日時'),count=masterWrites(x).length;
 assert(timestamp);assert.equal(x.get(616,'ステータス'),'承認');x.hooks.drop=null;assert.equal(x.apply().already_applied,true);
 assert.equal(+x.get(616,'処理日時'),+timestamp);assert.equal(masterWrites(x).length,count);
});

for(const field of ['検出ID','候補値','根拠原文','公式情報JSON'])test(`Review post-write ${field} mismatch is an error`,()=>{
 const x=setup();x.hooks.afterWrite=op=>{if(op.name==='変更候補レビュー'&&op.col===x.rh.indexOf('ステータス')+1)x.set(616,field,'tampered');};
 assert.throws(()=>x.apply(),/read-back|not found or not unique|Resume identity/);
});

test('translation blank AK rejected; AE placeholder cannot substitute',()=>{
 const x=setup();x.set(616,'承認済み日本語説明','');assert.throws(()=>x.apply(),/承認済み日本語説明/);assert.equal(x.writes.length,0);
});

test('caller cannot substitute another approved description for AK',()=>{
 const x=setup();assert.throws(()=>x.c.mfImageCollectorApplyReviewDecision(616,'既存銘柄を更新','T425-B01','','injected text'),/match Review AK/);assert.equal(x.writes.length,0);
});

test('AK is used exactly, including its whitespace',()=>{
 const x=setup();x.set(616,'承認済み日本語説明','  人間確認済み本文。\n');x.apply();assert.equal(x.master[1][4],x.get(616,'承認済み日本語説明'));
});

test('structured_detail canonical union is frozen once; retry does not merge twice',()=>{
 const x=setup();x.master[1][5]='ヴァニラ、カラメル、ハニー';x.set(619,'現在値',x.master[1][5]);x.set(619,'候補値','ヘーゼルナッツ');
 x.hooks.beforeWrite=op=>{if(op.name==='変更候補レビュー')throw Error('cut');};assert.throws(()=>x.apply(619),/cut/);
 const expected=x.master[1][5];assert(expected.includes('ヴァニラ')&&expected.includes('キャラメル')&&expected.includes('ハニー')&&expected.includes('ヘーゼルナッツ'));
 x.hooks.beforeWrite=null;const count=masterWrites(x).length;x.apply(619);assert.equal(masterWrites(x).length,count);assert.equal(x.master[1][5],expected);
 assert.equal(new Set(expected.split('、')).size,4);
});

test('finalized Review replay performs no Master/Review writes and preserves timestamp',()=>{
 const x=setup();x.apply();const count=x.writes.length,t=x.get(616,'処理日時');assert.equal(x.apply().already_applied,true);assert.equal(x.writes.length,count);assert.equal(+x.get(616,'処理日時'),+t);
});

test('response lost after final Review status persists: retry is a verified no-op',()=>{
 const x=setup();x.hooks.afterWrite=op=>{if(op.name==='変更候補レビュー'&&op.col===x.rh.indexOf('ステータス')+1)throw Error('response lost');};
 assert.throws(()=>x.apply(),/response lost/);const count=x.writes.length;x.hooks.afterWrite=null;assert.equal(x.apply().verified,true);assert.equal(x.writes.length,count);
});

test('a changed approval after an interrupted write cannot reuse the original intent',()=>{
 const x=setup();x.hooks.beforeWrite=op=>{if(op.name==='変更候補レビュー')throw Error('cut');};assert.throws(()=>x.apply(),/cut/);
 x.hooks.beforeWrite=null;x.set(616,'承認済み日本語説明','different approval');assert.throws(()=>x.apply(),/identity/);assert.equal(masterWrites(x).length,1);
});

test('Review approval/status changed during Master write is not silently overwritten',()=>{
 const x=setup();x.hooks.afterWrite=op=>{if(op.name==='銘柄マスター')x.set(616,'ステータス','却下');};
 assert.throws(()=>x.apply(),/identity/);assert.equal(x.get(616,'ステータス'),'却下');
});

test('busy lock and unavailable intent storage fail before any Master write',()=>{
 for(const option of [{busy:true},{propertyFailure:true}]){const x=setup(option);assert.throws(()=>x.apply(),/busy|property unavailable/);assert.equal(x.writes.length,0);}
});

test('duplicate VersionKey and wrong Primary fail before writes',()=>{
 for(const mutate of [x=>x.master.push(x.master[1].slice()),x=>{x.master[1][1]='T999';}]){const x=setup();mutate(x);assert.throws(()=>x.apply(),/duplicated|mismatch/);assert.equal(x.writes.length,0);}
});

test('HOJICHA batch: all3 complete, old617/618 immutable, exact4 tags /5 categories',()=>{
 const x=setup(),before=immutable(x),old617=x.grid[616].slice(),old618=x.grid[617].slice(),r=x.c.mfImageCollectorApplySelectedReviewRows();
 assert.equal(r.requested,3);assert.equal(r.applied,3);assert.equal(r.already_applied,0);assert.equal(r.failed,0);
 assert.equal(x.master[1][5],'チョコレート、ヴァニラ、キャラメル、木質');assert.equal(x.master[1][6],'スパイス、甘香・菓子、カカオ、キャラメル、ウッディ');
 assert.deepEqual(immutable(x),before);assert.deepEqual(x.grid[616],old617);assert.deepEqual(x.grid[617],old618);
 const count=x.writes.length;assert.equal(x.c.mfImageCollectorApplySelectedReviewRows().no_work,true);assert.equal(x.writes.length,count);
});

test('batch partial success reports requested3/applied2/failed1; retry converges without undoing successes',()=>{
 const x=setup();x.hooks.beforeWrite=op=>{if(op.name==='変更候補レビュー'&&op.r===616)throw Error('cut last Review');};
 const r=x.c.mfImageCollectorApplySelectedReviewRows();assert.equal(r.ok,false);assert.equal(r.requested,3);assert.equal(r.applied,2);assert.equal(r.failed,1);assert.equal(r.not_processed,0);
 assert.equal(x.get(619,'ステータス'),'反映済み');assert.equal(x.get(620,'ステータス'),'反映済み');assert.equal(x.get(616,'ステータス'),'承認');
 const count=masterWrites(x).length;x.hooks.beforeWrite=null;const retry=x.c.mfImageCollectorApplySelectedReviewRows();assert.equal(retry.requested,1);assert.equal(retry.already_applied,1);assert.equal(retry.failed,0);assert.equal(masterWrites(x).length,count);
});

test('final UI response timeout after all3 completed: batch replay causes zero additional writes',()=>{
 const x=setup();x.hooks.alert=title=>{if(title==='一括反映完了')throw Error('UI timeout');};assert.throws(()=>x.c.mfImageCollectorApplySelectedReviewRows(),/UI timeout/);
 const count=x.writes.length;x.hooks.alert=null;assert.equal(x.c.mfImageCollectorApplySelectedReviewRows().no_work,true);assert.equal(x.writes.length,count);
});

test('a finalized Review must not rewrite Master even if its old value reappears',()=>{
 const x=setup();x.apply();x.master[1][4]='';const count=x.writes.length;assert.throws(()=>x.apply(),/Finished Review/);assert.equal(x.writes.length,count);
});

test('finalized Review timestamp tampering is detected without overwriting it',()=>{
 const x=setup();x.apply();x.set(616,'処理日時',new Date('2020-01-01'));const count=x.writes.length;assert.throws(()=>x.apply(),/completion read-back/);assert.equal(x.writes.length,count);
});

test('duplicate detection IDs fail before Master writes',()=>{
 const x=setup();x.set(619,'検出ID',x.get(616,'検出ID'));assert.throws(()=>x.apply(),/not unique/);assert.equal(x.writes.length,0);
});

test('read-only preflight never creates durable intents',()=>{
 const x=setup(),r=x.c.mfImageCollectorPreflightReviewRows_(x.rs,616,5,{resume_apply:true});assert.equal(r.errors.length,0);assert.equal(x.props.size,0);assert.equal(x.writes.length,0);
});

function newPrimary(x){
 const values={'検出種別':'unregistered_reference','公式名':'NEW TEA','公式URL':'https://www.mariagefreres.com/fr/new-t9999.html','Tリファレンス番号':'T9999','人間判定':'新規銘柄として追加','対象VersionKey':'T9999-B01','DB既存VersionKey':'','DB既存T':'','対象列':'','現在値':'','候補値':'','承認済み日本語説明':'','公式情報JSON':JSON.stringify({primary_reference:'T9999',reference_resolution:{mode:'independent_primary'}})};
 for(const[k,v]of Object.entries(values))x.set(616,k,v);
}

test('new Primary append interrupted before Review: replay reuses exact frozen VersionKey, no duplicate row',()=>{
 const x=setup();newPrimary(x);x.hooks.beforeWrite=op=>{if(op.name==='変更候補レビュー')throw Error('cut after append');};assert.throws(()=>x.apply(),/cut after append/);
 assert.equal(x.master.length,3);assert.equal(x.master[2][0],'T9999-B01');const count=masterWrites(x).length;x.hooks.beforeWrite=null;
 assert.equal(x.apply().already_applied,true);assert.equal(x.master.length,3);assert.equal(masterWrites(x).length,count);
});

function salesSku(x){
 x.master[0].push('ティーバッグ版','TBリファレンス','TB根拠／出典');x.master[1].push('','','');
 const values={'検出種別':'sales_sku_detected','人間判定':'販売SKUとして追加','Tリファレンス番号':'TB425','対象列':'','現在値':'','候補値':'','承認済み日本語説明':'','公式情報JSON':JSON.stringify({primary_reference:'T425',sales_sku:'TB425',t_reference:'T425',reference_resolution:{mode:'sales_sku'}})};
 for(const[k,v]of Object.entries(values))x.set(616,k,v);
}

test('partially persisted sales SKU fields converge without duplicating evidence or changing ownership',()=>{
 const x=setup();salesSku(x);x.hooks.afterWrite=op=>{if(op.name==='銘柄マスター')throw Error('cut mid SKU');};assert.throws(()=>x.apply(),/cut mid SKU/);
 x.hooks.afterWrite=null;x.apply();assert.equal(x.master[1][10],'TB425');assert(x.master[1][11]);
 const snapshot=JSON.stringify(x.master),count=x.writes.length;assert.equal(x.apply().already_applied,true);assert.equal(JSON.stringify(x.master),snapshot);assert.equal(x.writes.length,count);
});

test('sales SKU ownership conflict appearing after interrupted apply is still rejected',()=>{
 const x=setup();salesSku(x);x.hooks.afterWrite=op=>{if(op.name==='銘柄マスター')throw Error('cut');};assert.throws(()=>x.apply(),/cut/);x.hooks.afterWrite=null;
 const row=x.master[1].map(()=> '');row[0]='T999-B01';row[1]=row[2]='T999';row[10]='TB425';x.master.push(row);const count=x.writes.length;
 assert.throws(()=>x.apply(),/another Primary/);assert.equal(x.writes.length,count);
});

test('new Version freezes its next key; a retry never allocates a second new Version',()=>{
 const x=setup();for(const[k,v]of Object.entries({'検出種別':'official_name_changed','対象列':'','候補値':'','承認済み日本語説明':'','対象VersionKey':'','人間判定':'既存銘柄の新バージョンとして追加','公式情報JSON':JSON.stringify({primary_reference:'T425',reference_resolution:{mode:'independent_primary'}})}))x.set(616,k,v);
 x.hooks.beforeWrite=op=>{if(op.name==='変更候補レビュー')throw Error('cut');};assert.throws(()=>x.apply(),/cut/);
 const key=x.master[2][0];assert.notEqual(key,'T425-B01');x.hooks.beforeWrite=null;const count=masterWrites(x).length;
 assert.equal(x.apply().already_applied,true);assert.equal(x.master.length,3);assert.equal(x.get(616,'対象VersionKey'),key);assert.equal(masterWrites(x).length,count);
});

test('official name + URL partial write recovers only the remaining cell',()=>{
 const x=setup();for(const[k,v]of Object.entries({'検出種別':'official_name_changed','対象列':'','公式名':'HOJICHA UPDATED','公式URL':'https://www.mariagefreres.com/en/hojicha-t425.html','承認済み日本語説明':''}))x.set(616,k,v);
 x.hooks.afterWrite=op=>{if(op.name==='銘柄マスター')throw Error('cut');};assert.throws(()=>x.apply(),/cut/);x.hooks.afterWrite=null;
 x.apply();assert.equal(masterWrites(x).length,2);assert.equal(x.master[1][3],'HOJICHA UPDATED');assert.equal(x.master[1][7],x.get(616,'公式URL'));
});

test('oversized intent is refused before Master writes',()=>{
 const x=setup();x.set(616,'承認済み日本語説明','本文'.repeat(5000));assert.throws(()=>x.apply(),/size limit/);assert.equal(x.writes.length,0);
});

test('a missing Review processed timestamp is detected and repaired by retry, without rewriting Master',()=>{
 const x=setup();x.hooks.drop=op=>op.name==='変更候補レビュー'&&op.col===x.rh.indexOf('処理日時')+1;assert.throws(()=>x.apply(),/completion read-back/);
 const count=masterWrites(x).length;assert.equal(x.get(616,'ステータス'),'反映済み');assert.equal(x.get(616,'処理日時'),'');x.hooks.drop=null;x.apply();assert(x.get(616,'処理日時'));assert.equal(masterWrites(x).length,count);
});

test('793-record /90-column fixture changes only the intended three Master cells',()=>{
 const x=setup();for(let i=x.master[0].length;i<90;i++){x.master[0].push('untouched-'+i);x.master[1].push('keep-'+i);}
 for(let i=0;i<792;i++){const row=x.master[1].map(()=> '');row[0]=`T${10000+i}-B01`;row[1]=row[2]=`T${10000+i}`;x.master.push(row);}
 const before=JSON.parse(JSON.stringify(x.master));x.c.mfImageCollectorApplySelectedReviewRows();
 const diffs=[];for(let i=1;i<x.master.length;i++)for(let j=0;j<90;j++)if(x.master[i][j]!==before[i][j])diffs.push([i,j]);
 assert.deepEqual(diffs,[[1,4],[1,5],[1,6]]);assert.equal(x.master.length-1,793);
 assert(x.writes.every(w=>['銘柄マスター','変更候補レビュー'].includes(w.name)));
});

test('normalization fails closed on unknown taxonomy and never drops existing aroma tags',()=>{
 const x=setup();x.set(620,'候補値','unknown category');assert.throws(()=>x.apply(620));assert.equal(x.writes.length,0);
 const y=setup();y.master[1][5]='ローズ';y.set(619,'現在値','ローズ');y.apply(619);assert(y.master[1][5].includes('ローズ'));
});

test('a failed first batch item reports remaining work and does not run dependents',()=>{
 const x=setup();x.hooks.beforeWrite=op=>{if(op.name==='銘柄マスター')throw Error('write failed');};
 const r=x.c.mfImageCollectorApplySelectedReviewRows();assert.equal(r.requested,3);assert.equal(r.applied,0);assert.equal(r.failed,1);assert.equal(r.not_processed,2);
 for(const n of [616,619,620])assert.equal(x.get(n,'ステータス'),'承認');
});

test('batch replay reconciles a finalized row missing its processing timestamp',()=>{
 const x=setup();x.hooks.drop=op=>op.name==='変更候補レビュー'&&op.r===616&&op.col===x.rh.indexOf('処理日時')+1;
 const first=x.c.mfImageCollectorApplySelectedReviewRows();assert.equal(first.failed,1);assert.equal(x.get(616,'ステータス'),'反映済み');assert.equal(x.get(616,'処理日時'),'');
 const count=masterWrites(x).length;x.hooks.drop=null;const second=x.c.mfImageCollectorApplySelectedReviewRows();assert.equal(second.already_applied,1);assert.equal(second.failed,0);assert(x.get(616,'処理日時'));assert.equal(masterWrites(x).length,count);
});

test('batch preflight revalidates journaled finalized rows and refuses changed provenance',()=>{
 const x=setup();x.c.mfImageCollectorApplySelectedReviewRows();x.set(619,'公式情報JSON','{}');const count=x.writes.length;
 assert.throws(()=>x.c.mfImageCollectorApplySelectedReviewRows(),/事前検証/);assert.equal(x.writes.length,count);
});

test('resuming an unstarted new Primary simulates it for dependent sales-SKU preflight, without writes',()=>{
 const x=setup();newPrimary(x);x.master[0].push('ティーバッグ版','TBリファレンス','TB根拠／出典');x.master[1].push('','','');
 x.hooks.beforeWrite=op=>{if(op.name==='銘柄マスター')throw Error('cut before append');};assert.throws(()=>x.apply(),/cut before append/);x.hooks.beforeWrite=null;
 for(const[k,v]of Object.entries({'検出種別':'sales_sku_detected','人間判定':'販売SKUとして追加','Tリファレンス番号':'TB9999','対象VersionKey':'T9999-B01','対象列':'','候補値':'','DB既存VersionKey':'','DB既存T':'','公式情報JSON':JSON.stringify({primary_reference:'T9999',sales_sku:'TB9999',reference_resolution:{mode:'sales_sku'}})}))x.set(619,k,v);
 x.set(619,'DB既存T','T9999'); // Explicit saved parent evidence, never inferred from the SKU digits.
 const before=JSON.stringify(x.master),p=x.c.mfImageCollectorPreflightReviewRows_(x.rs,616,5,{resume_apply:true});assert.equal(p.errors.length,0,JSON.stringify(p.errors));assert.equal(JSON.stringify(x.master),before);assert.equal(x.writes.length,0);
 const result=x.c.mfImageCollectorApplySelectedReviewRows();assert.equal(result.failed,0);assert.equal(x.master[2][10],'TB9999');
});

test('an official-name third value is not overwritten when DB existing name was reviewed',()=>{
 const x=setup();x.set(616,'検出種別','official_name_changed');x.set(616,'DB既存名','HOJICHA');x.set(616,'公式名','APPROVED NEW NAME');x.set(616,'対象列','');x.master[1][3]='THIRD NAME';
 assert.throws(()=>x.apply(),/third value/);assert.equal(x.writes.length,0);
});
