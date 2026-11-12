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
function api(x,options={}){
 const counts={opens:0,fetches:0,sleeps:[],propertyWrites:0,propertyDeletes:0,requests:[]};
 x.hooks.afterProperty=()=>counts.propertyWrites++;x.hooks.deleteProperty=()=>counts.propertyDeletes++;
 const originalLock=x.c.LockService.getScriptLock;
 x.c.LockService.getScriptLock=()=>{const lock=originalLock();return{tryLock:ms=>{const acquired=lock.tryLock(ms);counts.lockHeld=acquired;return acquired;},releaseLock:()=>{counts.lockHeld=false;lock.releaseLock();}};};
 const offset=options.timeZone==='Asia/Tokyo'?9*3600000:0;
 x.c.Utilities.sleep=n=>{assert.equal(counts.lockHeld,true);counts.sleeps.push(n);};
 x.c.Utilities.formatDate=(d,tz)=>{assert.equal(tz,'UTC');return d.toISOString().replace('T',' ').replace('Z','');};
 x.c.Utilities.parseDate=(s,tz)=>{assert.equal(tz,options.timeZone||'UTC');return new Date(Date.parse(s.replace(' ','T')+'Z')-offset);};
 x.c.ScriptApp={getOAuthToken:()=> 'memory-only-token'};
 x.c.SpreadsheetApp.openById=spreadsheetId=>{
  assert.equal(counts.lockHeld,true);assert.equal(spreadsheetId,'fixture-master');counts.opens++;
  const ss={getId:()=>spreadsheetId,getSheetByName:name=>{
   const original=name==='変更候補レビュー'?x.rs:x.ms;
   // Metadata only. A value read here would reuse the deliberately stale Sheet adapter.
   return {getName:()=>name,getParent:()=>ss,getSheetId:()=>original.getSheetId(),getLastColumn:()=>original.getLastColumn(),getMaxRows:()=>original.getMaxRows()};
  }};return ss;
 };
 function grid(values,sheetId){return{properties:{sheetId},data:[{startRow:0,startColumn:0,rowData:values.map(r=>({values:r.map(v=>{
  if(v instanceof Date)return{effectiveValue:{numberValue:(+v+offset)/86400000+25569},effectiveFormat:{numberFormat:{type:'DATE_TIME'}}};
  return{effectiveValue:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:{stringValue:v??''}};
 })}))}]};}
 x.c.UrlFetchApp={fetch:(url,request)=>{
  assert.equal(counts.lockHeld,true);counts.fetches++;counts.requests.push({url,method:request.method});assert.equal(request.method,'get');assert.equal(request.payload,undefined);
  const u=new URL(url);assert.equal(u.origin,'https://sheets.googleapis.com');assert(u.searchParams.get('fields').includes('effectiveValue'));assert.equal(u.searchParams.getAll('ranges').length,2);
  options.onFetch?.(counts.fetches,x);
  const reviews=x.grid.map(r=>r.slice()),master=x.master.map(r=>r.slice());
  if(counts.fetches<=(options.stale||0))reviews[row-1]=options.oldRow.slice();
  options.mutateGrid?.({reviews,master,attempt:counts.fetches});
  const result={properties:{timeZone:options.timeZone||'UTC'},sheets:[grid(reviews,2),grid(master,1)]};
  options.mutateResponse?.(result);
  return{getResponseCode:()=>options.http||200,getContentText:()=>options.badJSON?'not json':JSON.stringify(result)};
 }};
 return counts;
}
function race(options={}){
 const a=fixture(),b=fixture();options.configure?.(a);options.configure?.(b);
 const oldRow=b.grid[row-1].slice(),counts=api(b,{...options,oldRow});let locked=false,aResult;
 b.hooks.lock=()=>{aResult=a.apply(row);mirror(a,b);locked=true;options.afterLeader?.(b);};
 if(options.staleFirst!==false)b.hooks.read=({name,r,col,out})=>locked&&name==='変更候補レビュー'&&r===row?out.map((v,i)=>i? v:oldRow.slice(col-1,col-1+v.length)):out;
 return{a,b,counts,run:()=>b.apply(row),leader:()=>aResult};
}
function zero(x,counts){assert.equal(x.writes.length,0);assert.equal(counts.propertyWrites,0);assert.equal(counts.propertyDeletes,0);assert.equal(counts.lockHeld,false);}
test('A: concurrent approved requests: A applied, B finished on its fresh locked read, B writes0',()=>{
 const x=race({staleFirst:false}),r=x.run();assert.equal(x.leader().already_applied,false);assert.equal(r.finished,true);assert.equal(r.verified,true);assert.equal(x.counts.fetches,0);zero(x.b,x.counts);
});
test('B / Review621: stale locked read + completed receipt reconciles via independent GET',()=>{
 const x=race(),r=x.run();assert.equal(x.leader().already_applied,false);assert.equal(r.row_number,row);assert.equal(r.finished,true);assert.equal(r.already_applied,true);assert.equal(r.verified,true);assert.equal(x.b.master[1][5],'キャラメル');assert.equal(x.b.get(row,'ステータス'),'反映済み');assert.equal(x.counts.opens,1);assert.equal(x.counts.fetches,1);assert.deepEqual(x.counts.sleeps,[]);zero(x.b,x.counts);
});
test('C: first reconciliation still stale, second independent GET finished; exactly one150ms sleep',()=>{
 const x=race({stale:1}),r=x.run();assert.equal(r.finished,true);assert.equal(x.counts.opens,2);assert.equal(x.counts.fetches,2);assert.deepEqual(x.counts.sleeps,[150]);zero(x.b,x.counts);
});
test('D: persistent stale read is bounded to two independent GETs and fails closed',()=>{
 const x=race({stale:Infinity});assert.throws(x.run,/unfinished Review after independent reconciliation/);assert.equal(x.counts.fetches,2);assert.deepEqual(x.counts.sleeps,[150]);zero(x.b,x.counts);
});
test('D: truly unfinished Review is never repaired from completed receipt alone',()=>{
 const x=race({afterLeader:b=>{b.set(row,'ステータス','承認');b.set(row,'処理日時','');}});assert.throws(x.run,/unfinished Review/);assert.equal(x.b.get(row,'ステータス'),'承認');assert.equal(x.counts.fetches,2);zero(x.b,x.counts);
});
test('E: independent Master third value fails immediately without retry/write',()=>{
 const x=race({mutateGrid:({master})=>{master[1][5]='ヴァニラ';}});assert.throws(x.run,/third value/);assert.equal(x.counts.fetches,1);zero(x.b,x.counts);
});
for(const field of ['detection_id','review_identity_hash','approved_content_hash','expected_value_hash','final_hash'])test('F: changed completed receipt '+field+' is refused',()=>{
 const x=race({onFetch:(_n,b)=>{const[k,v]=[...b.props][0],r=JSON.parse(v);r[field]='changed';r.record_hash=b.c.mfImageCollectorApplyRecordHash_(r);b.props.set(k,JSON.stringify(r));}});assert.throws(x.run,/identity|hash|receipt/);assert.equal(x.counts.fetches,1);zero(x.b,x.counts);
});
test('F: corrupted completed receipt is refused without writes',()=>{
 const x=race({onFetch:(_n,b)=>{const[k]=[...b.props][0];b.props.set(k,'{');}});assert.throws(x.run,/resume JSON/);zero(x.b,x.counts);
});
for(const[field,value]of [['対象VersionKey','T8081-C01'],['Tリファレンス番号','T999'],['対象列','香味大分類'],['検出種別','official_name_changed'],['人間判定','保留'],['候補値','ヴァニラ'],['根拠原文','changed evidence']])test('independent fresh Review change is refused: '+field,()=>{
 const x=race({mutateGrid:({reviews})=>{reviews[row-1][x.b.rh.indexOf(field)]=value;}});assert.throws(x.run);assert.equal(x.counts.fetches,1);zero(x.b,x.counts);
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
 const x=race({mutateGrid:({reviews})=>{reviews[row-1][x.b.rh.indexOf('処理日時')]='';}});assert.throws(x.run,/unfinished Review/);assert.equal(x.counts.fetches,2);zero(x.b,x.counts);
});
test('Sheets API serial dates are decoded in spreadsheet timezone (Asia/Tokyo)',()=>{
 const x=race({timeZone:'Asia/Tokyo'}),r=x.run();assert.equal(r.finished,true);zero(x.b,x.counts);
});
test('omitted trailing blank GridData cells retain the original Sheet header/row shape',()=>{
 const x=race({mutateResponse:data=>{for(const s of data.sheets)for(const row of s.data[0].rowData){while(row.values.length&&row.values.at(-1).effectiveValue?.stringValue==='')row.values.pop();}}});
 assert.equal(x.run().finished,true);zero(x.b,x.counts);
});
for(const options of [{http:403},{http:503},{badJSON:true},{mutateResponse:r=>{r.sheets=[];}}])test('independent read error fails closed with no retry or write: '+JSON.stringify(options),()=>{
 const x=race(options);assert.throws(x.run);assert.equal(x.counts.fetches,1);assert.deepEqual(x.counts.sleeps,[]);zero(x.b,x.counts);
});
test('G: concurrent finished replays both succeed without GET, writes, property updates or timestamp changes',()=>{
 const a=fixture();a.apply(row);const b=fixture(),c=fixture();mirror(a,b);mirror(a,c);const bc=api(b),cc=api(c),timestamp=b.get(row,'処理日時'),props=[...b.props];let cr;b.hooks.lock=()=>{cr=c.apply(row);};const br=b.apply(row);assert.equal(br.finished,true);assert.equal(cr.finished,true);assert.equal(b.get(row,'処理日時'),timestamp);assert.deepEqual([...b.props],props);assert.equal(bc.fetches+cc.fetches,0);zero(b,bc);zero(c,cc);
});
test('ordinary first apply has no reconciliation GET or sleep',()=>{
 const x=fixture(),counts=api(x);assert.equal(x.apply(row).already_applied,false);assert.equal(counts.opens,0);assert.equal(counts.fetches,0);assert.deepEqual(counts.sleeps,[]);
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
 const x=race({onFetch:(_n,b)=>b.props.clear()});assert.throws(x.run,/identity \/ receipt changed/);zero(x.b,x.counts);
});
