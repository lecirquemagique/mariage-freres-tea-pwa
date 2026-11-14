'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),setup=require('./review-apply-harness.cjs');
const row=621,id='54c6a81517a0badca2a9b6e0253c45af0c202efd';
function fixture(){
 const x=setup();x.master[1][0]='T8081-B01';x.master[1][1]=x.master[1][2]='T8081';x.master[1][3]='CARAMEL RICHE';
 x.grid.push(x.grid[618].slice());
 const fields={'検出ID':id,'公式名':'CARAMEL RICHE','対象VersionKey':'T8081-B01','DB既存VersionKey':'T8081-B01','Tリファレンス番号':'T8081','DB既存T':'T8081','候補値':'キャラメル','現在値':'','公式情報JSON':JSON.stringify({primary_reference:'T8081',reference_resolution:{mode:'existing_primary'}}),'根拠原文':'This Jardin Premier® black tea has a sweet nostalgic fragrance evoking the rich, gourmet notes of traditional caramel.'};
 for(const[k,v]of Object.entries(fields))x.set(row,k,v);
 return x;
}
function mirror(a,b){b.grid.splice(0,b.grid.length,...a.grid.map(r=>r.slice()));b.master.splice(0,b.master.length,...a.master.map(r=>r.slice()));b.props.clear();for(const[k,v]of a.props)b.props.set(k,v);}
function spreadsheetReads(x,options={}){
 const counts={opens:0,reads:0,sleeps:[],propertyWrites:0,propertyDeletes:0,events:[],sheets:[],ranges:[]};
 x.hooks.afterProperty=()=>counts.propertyWrites++;x.hooks.deleteProperty=()=>counts.propertyDeletes++;
 x.hooks.getProperty=k=>{if(counts.reads)counts.events.push('property:'+k);};
 const originalLock=x.c.LockService.getScriptLock;
 x.c.LockService.getScriptLock=()=>{const lock=originalLock();return{tryLock:ms=>{const acquired=lock.tryLock(ms);counts.lockHeld=acquired;return acquired;},releaseLock:()=>{counts.lockHeld=false;lock.releaseLock();}};};
 x.c.Utilities.sleep=n=>{assert.equal(counts.lockHeld,true);counts.sleeps.push(n);};
 const flush=x.c.SpreadsheetApp.flush;
 x.c.SpreadsheetApp.flush=()=>{counts.events.push('flush');flush();};
 x.c.SpreadsheetApp.openById=spreadsheetId=>{
  assert.equal(counts.lockHeld,true);assert.equal(spreadsheetId,'fixture-master');counts.opens++;counts.reads++;counts.events.push('open');
  if(options.openFailure)throw Error('Spreadsheet open failed');
  options.onRead?.(counts.reads,x);
  const clone=values=>values.map(r=>r.map(v=>v instanceof Date?new Date(+v):v));
  const reviews=clone(x.grid),master=clone(x.master);
  if(counts.reads<=(options.stale||0))reviews[row-1]=options.oldRow.slice();
  options.mutateGrid?.({reviews,master,attempt:counts.reads});
  const ss={getId:()=>spreadsheetId,getSheetByName:name=>{
   counts.events.push('sheet:'+name);
   if(options.missingSheet===name)return null;
   const original=name==='変更候補レビュー'?x.rs:x.ms;
   const data=name==='変更候補レビュー'?reviews:master;
   // Fresh adapters deliberately never call the old Sheet/Range value readers.
   const sheet={getName:()=>name,getParent:()=>ss,getSheetId:()=>original.getSheetId(),getDataRange:()=>{
    counts.events.push('range:'+name);
    const range={getValues:()=>{
     counts.events.push('values:'+name);
     assert.equal(counts.lockHeld,true);
     if(options.readFailure===name)throw Error('Spreadsheet read failed');
     return options.emptyHeaders===name?[]:clone(data);
    }};counts.ranges.push(range);return range;
   }};counts.sheets.push(sheet);return sheet;
  }};return ss;
 };
 return counts;
}
function race(options={}){
 const a=fixture(),b=fixture();options.configure?.(a);options.configure?.(b);
 const oldRow=b.grid[row-1].slice(),counts=spreadsheetReads(b,{...options,oldRow});let locked=false,aResult;
 b.hooks.lock=()=>{aResult=a.apply(row);mirror(a,b);locked=true;options.afterLeader?.(b);};
 if(options.staleFirst!==false)b.hooks.read=({name,r,col,out})=>locked&&name==='変更候補レビュー'&&r===row?out.map((v,i)=>i? v:oldRow.slice(col-1,col-1+v.length)):out;
 return{a,b,counts,run:()=>b.apply(row),leader:()=>aResult};
}
function zero(x,counts){assert.equal(x.writes.length,0);assert.equal(counts.propertyWrites,0);assert.equal(counts.propertyDeletes,0);assert.equal(counts.lockHeld,false);}
test('A: concurrent approved requests: A applied, B finished on its fresh locked read, B writes0',()=>{
 const x=race({staleFirst:false}),r=x.run();assert.equal(x.leader().already_applied,false);assert.equal(r.finished,true);assert.equal(r.verified,true);assert.equal(x.counts.reads,0);zero(x.b,x.counts);
});
test('B / Review621: stale locked read + completed receipt reconciles via independent SpreadsheetApp read',()=>{
 const x=race(),r=x.run();assert.equal(x.leader().already_applied,false);assert.equal(r.row_number,row);assert.equal(r.finished,true);assert.equal(r.already_applied,true);assert.equal(r.verified,true);assert.equal(x.b.master[1][5],'キャラメル');assert.equal(x.b.get(row,'ステータス'),'反映済み');assert.equal(x.counts.opens,1);assert.equal(x.counts.reads,1);assert.deepEqual(x.counts.sleeps,[]);zero(x.b,x.counts);
});
test('C: first reconciliation still stale, second independent SpreadsheetApp read finished; exactly one150ms sleep',()=>{
 const x=race({stale:1}),r=x.run();assert.equal(r.finished,true);assert.equal(x.counts.opens,2);assert.equal(x.counts.reads,2);assert.deepEqual(x.counts.sleeps,[150]);zero(x.b,x.counts);
});
test('D: persistent stale read is bounded to three reads and returns retryable inconclusive',()=>{
 const x=race({stale:Infinity});assert.throws(x.run,e=>e.code==='review_freshness_inconclusive'&&e.retryable===true&&e.inconclusive===true&&/Review freshness could not be confirmed/.test(e.message));assert.equal(x.counts.reads,3);assert.deepEqual(x.counts.sleeps,[150,300]);zero(x.b,x.counts);
});
test('D: truly unfinished Review is never repaired from completed receipt alone',()=>{
 const x=race({afterLeader:b=>{b.set(row,'ステータス','承認');b.set(row,'処理日時','');}});assert.throws(x.run,/Review freshness could not be confirmed/);assert.equal(x.b.get(row,'ステータス'),'承認');assert.equal(x.counts.reads,3);zero(x.b,x.counts);
});
test('E: independent Master third value fails immediately without retry/write',()=>{
 const x=race({mutateGrid:({master})=>{master[1][5]='ヴァニラ';}});assert.throws(x.run,/third value/);assert.equal(x.counts.reads,1);zero(x.b,x.counts);
});
for(const field of ['detection_id','review_identity_hash','approved_content_hash','expected_value_hash','final_hash'])test('F: changed completed receipt '+field+' is refused',()=>{
 const x=race({onRead:(_n,b)=>{const[k,v]=[...b.props][0],r=JSON.parse(v);r[field]='changed';r.record_hash=b.c.mfImageCollectorApplyRecordHash_(r);b.props.set(k,JSON.stringify(r));}});assert.throws(x.run,/identity|hash|receipt/);assert.equal(x.counts.reads,1);zero(x.b,x.counts);
});
test('F: corrupted completed receipt is refused without writes',()=>{
 const x=race({onRead:(_n,b)=>{const[k]=[...b.props][0];b.props.set(k,'{');}});assert.throws(x.run,/resume JSON/);zero(x.b,x.counts);
});
for(const[field,value]of [['対象VersionKey','T8081-C01'],['Tリファレンス番号','T999'],['対象列','香味大分類'],['検出種別','official_name_changed'],['人間判定','保留'],['候補値','ヴァニラ'],['根拠原文','changed evidence']])test('independent fresh Review change is refused: '+field,()=>{
 const x=race({mutateGrid:({reviews})=>{reviews[row-1][x.b.rh.indexOf(field)]=value;}});assert.throws(x.run);assert.equal(x.counts.reads,1);zero(x.b,x.counts);
});
test('independent detection ID lookup rejects missing ID instead of trusting row621',()=>{
 const x=race({mutateGrid:({reviews})=>{reviews[row-1][0]='another-review';}});assert.throws(x.run,/detection ID not found/);zero(x.b,x.counts);
});
test('independent duplicate detection ID is rejected',()=>{
 const x=race({mutateGrid:({reviews})=>{reviews[1]=reviews[row-1].slice();}});assert.throws(x.run,/not unique/);zero(x.b,x.counts);
});
test('independent detection ID follows row sorting, with no old-row updates',()=>{
 const x=race({mutateGrid:({reviews})=>{[reviews[1],reviews[row-1]]=[reviews[row-1],reviews[1]];}});assert.equal(x.run().row_number,2);zero(x.b,x.counts);
});
test('duplicate Master VersionKey in authoritative read fails closed',()=>{
 const x=race({mutateGrid:({master})=>master.push(master[1].slice())});assert.throws(x.run,/duplicat/);zero(x.b,x.counts);
});
test('finished timestamp must equal the immutable receipt timestamp',()=>{
 const x=race({mutateGrid:({reviews})=>{reviews[row-1][x.b.rh.indexOf('処理日時')]=new Date('2020-01-01T00:00:00Z');}});assert.throws(x.run,/processing time mismatch/);zero(x.b,x.counts);
});
test('missing finished timestamp never becomes success or receives a synthetic timestamp',()=>{
 const x=race({mutateGrid:({reviews})=>{reviews[row-1][x.b.rh.indexOf('処理日時')]='';}});assert.throws(x.run,/Review freshness could not be confirmed/);assert.equal(x.counts.reads,3);zero(x.b,x.counts);
});
test('native SpreadsheetApp Date values retain receipt millisecond precision without timezone conversion',()=>{
 const x=race(),r=x.run();assert.equal(r.finished,true);zero(x.b,x.counts);
});
test('native getValues blank cells retain the original Sheet header/row shape',()=>{
 const x=race({mutateGrid:({reviews})=>{assert.equal(reviews[row-1].length,x.b.rh.length);assert(reviews[row-1].includes(''));}});
 assert.equal(x.run().finished,true);zero(x.b,x.counts);
});
for(const options of [{openFailure:true},{readFailure:'変更候補レビュー'},{readFailure:'銘柄マスター'},{missingSheet:'変更候補レビュー'}])test('independent read error fails closed with no retry or write: '+JSON.stringify(options),()=>{
 const x=race(options);assert.throws(x.run);assert.equal(x.counts.reads,1);assert.deepEqual(x.counts.sleeps,[]);zero(x.b,x.counts);
});
test('G: concurrent finished replays both succeed without reconciliation reads, writes, property updates or timestamp changes',()=>{
 const a=fixture();a.apply(row);const b=fixture(),c=fixture();mirror(a,b);mirror(a,c);const bc=spreadsheetReads(b),cc=spreadsheetReads(c),timestamp=b.get(row,'処理日時'),props=[...b.props];let cr;b.hooks.lock=()=>{cr=c.apply(row);};const br=b.apply(row);assert.equal(br.finished,true);assert.equal(cr.finished,true);assert.equal(b.get(row,'処理日時'),timestamp);assert.deepEqual([...b.props],props);assert.equal(bc.reads+cc.reads,0);zero(b,bc);zero(c,cc);
});
test('ordinary first apply has no reconciliation read or sleep',()=>{
 const x=fixture(),counts=spreadsheetReads(x);assert.equal(x.apply(row).already_applied,false);assert.equal(counts.opens,0);assert.equal(counts.reads,0);assert.deepEqual(counts.sleeps,[]);
});
test('translation reconciliation uses unchanged AK final value and never writes the AE placeholder',()=>{
 const x=race({configure:b=>{b.set(row,'検出種別','official_description_translation');b.set(row,'対象列','現在の公式説明');b.set(row,'候補値','翻訳レビュー候補');b.set(row,'承認済み日本語説明','人間が確認したキャラメルの説明。');}});
 assert.equal(x.run().finished,true);assert.equal(x.b.master[1][4],'人間が確認したキャラメルの説明。');zero(x.b,x.counts);
});
test('structured union is reconstructed against reviewed old tags, without a second merge/write',()=>{
 const x=race({configure:b=>{b.master[1][5]='ヴァニラ、カラメル、ハニー';b.set(row,'現在値',b.master[1][5]);b.set(row,'候補値','ヘーゼルナッツ');}});
 assert.equal(x.run().finished,true);const tags=x.b.master[1][5].split('、');assert.deepEqual(new Set(tags),new Set(['ヴァニラ','キャラメル','ハニー','ヘーゼルナッツ']));assert.equal(tags.length,4);zero(x.b,x.counts);
});
test('missing freshly reloaded receipt refuses reconciliation instead of creating a resume',()=>{
 const x=race({onRead:(_n,b)=>b.props.clear()});assert.throws(x.run,/identity \/ receipt changed/);zero(x.b,x.counts);
});

test('SpreadsheetApp-only: third read can confirm completion after two stale reads',()=>{
 const x=race({stale:2}),r=x.run();assert.equal(r.finished,true);assert.equal(r.already_applied,true);assert.equal(x.counts.opens,3);assert.deepEqual(x.counts.sleeps,[150,300]);zero(x.b,x.counts);
});
test('SpreadsheetApp-only: every retry reacquires Spreadsheet, both Sheets/Ranges and receipt under lock',()=>{
 const x=race({stale:2});x.run();
 const sequence=['flush','open','sheet:変更候補レビュー','sheet:銘柄マスター','range:変更候補レビュー','values:変更候補レビュー','range:銘柄マスター','values:銘柄マスター'];
 assert.deepEqual(x.counts.events.filter(e=>!e.startsWith('property:')),Array.from({length:3},()=>sequence).flat());
 assert.equal(new Set(x.counts.sheets).size,6);assert.equal(new Set(x.counts.ranges).size,6);
 const events=x.counts.events.join('|');assert.equal((events.match(/values:銘柄マスター\|property:MF_REVIEW_APPLY_V2_/g)||[]).length,3);zero(x.b,x.counts);
});
test('SpreadsheetApp-only: no OAuth, REST, UrlFetch or serial-date service mock is needed',()=>{
 const x=race();assert.equal(x.b.c.UrlFetchApp,undefined);assert.equal(x.b.c.ScriptApp,undefined);assert.equal(x.b.c.Utilities.parseDate,undefined);
 assert.equal(x.run().verified,true);zero(x.b,x.counts);
});
test('SpreadsheetApp-only: flush error aborts before reopening or writing',()=>{
 const x=race();x.b.hooks.flush=()=>{throw Error('flush failed');};assert.throws(x.run,/flush failed/);assert.equal(x.counts.opens,0);assert.deepEqual(x.counts.sleeps,[]);zero(x.b,x.counts);
});
test('SpreadsheetApp-only: stale then Master third value is a hard conflict, not retryable freshness',()=>{
 const x=race({stale:1,mutateGrid:({master,attempt})=>{if(attempt===2)master[1][5]='ヴァニラ';}});
 assert.throws(x.run,e=>/third value/.test(e.message)&&!e.retryable);assert.equal(x.counts.opens,2);assert.deepEqual(x.counts.sleeps,[150]);zero(x.b,x.counts);
});
test('SpreadsheetApp-only: receipt changed between retries is a hard conflict',()=>{
 const x=race({stale:1,onRead:(n,b)=>{if(n===2){const[k,v]=[...b.props][0],r=JSON.parse(v);r.ref='T999';r.record_hash=b.c.mfImageCollectorApplyRecordHash_(r);b.props.set(k,JSON.stringify(r));}}});
 assert.throws(x.run,e=>/identity|receipt|value changed/.test(e.message)&&!e.retryable);assert.equal(x.counts.opens,2);zero(x.b,x.counts);
});
for(const name of ['変更候補レビュー','銘柄マスター'])test('SpreadsheetApp-only: empty fresh headers rejected for '+name,()=>{
 const x=race({emptyHeaders:name});assert.throws(x.run,/headers are missing/);assert.equal(x.counts.opens,1);zero(x.b,x.counts);
});
test('SpreadsheetApp-only: missing Master sheet rejected without retry or writes',()=>{
 const x=race({missingSheet:'銘柄マスター'});assert.throws(x.run,/sheet not found/);assert.equal(x.counts.opens,1);zero(x.b,x.counts);
});
test('SpreadsheetApp-only: fresh rejected Review remains a hard conflict',()=>{
 const x=race({mutateGrid:({reviews})=>{reviews[row-1][x.b.rh.indexOf('ステータス')]='却下';}});
 assert.throws(x.run,e=>/finalized differently/.test(e.message)&&!e.retryable);assert.equal(x.counts.opens,1);zero(x.b,x.counts);
});
test('SpreadsheetApp-only: fresh translation AK mismatch fails rather than reusing old approval',()=>{
 const x=race({configure:b=>{b.set(row,'検出種別','official_description_translation');b.set(row,'対象列','現在の公式説明');b.set(row,'候補値','翻訳レビュー候補');b.set(row,'承認済み日本語説明','承認した説明');},mutateGrid:({reviews})=>{reviews[row-1][x.b.rh.indexOf('承認済み日本語説明')]='別の説明';}});
 assert.throws(x.run,e=>/match Review AK|approved|identity/i.test(e.message)&&!e.retryable);zero(x.b,x.counts);
});
