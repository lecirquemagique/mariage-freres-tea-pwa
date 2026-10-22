'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{payload,send}=require('../research-request');
const row={VersionKey:'T700-B01','Primary Reference':'T700','Tリファレンス番号':'T700','現在の公式名':'<img src=x onerror="alert(1)">','銘柄名（黒い本）':'OLD'},config={GAS_API_URL:'https://script.google.com/macros/s/test/exec'};
const response=(status,extra={})=>({ok:true,json:async()=>({ok:['queued','already_queued'].includes(status),status,versionKey:row.VersionKey,...extra})});
test('complete_card payload uses exact Master values with timestamp and no server-owned fields',()=>{
 const before=JSON.stringify(row),start=Date.now(),p=payload(row);
 assert.deepEqual(Object.keys(p),['action','versionKey','primaryReference','teaReference','displayName','requestType','requestedAt']);
 assert.equal(p.action,'requestResearch');assert.equal(p.requestType,'complete_card');assert.equal(p.displayName,row['現在の公式名']);assert.equal(p.versionKey,row.VersionKey);assert.equal(p.primaryReference,'T700');assert.equal(p.teaReference,'T700');assert(Date.parse(p.requestedAt)>=start);
 assert.equal(payload({...row,'現在の公式名':''}).displayName,'OLD');assert.equal(payload({VersionKey:'T4233S-B01'}).primaryReference,'');assert.equal(payload({VersionKey:'T4233S-B01'}).teaReference,'');assert.equal(JSON.stringify(row),before);
});
test('complete_card missing VersionKey fails before fetch and never infers a reference',async()=>{
 let calls=0;for(const VersionKey of [undefined,null,'','  ',0])await assert.rejects(send({...row,VersionKey},config,async()=>{calls++;}),/VersionKey/);assert.equal(calls,0);
});
for(const status of ['queued','already_queued'])test(`complete_card ${status}: text/plain POST to GAS_API_URL`,async()=>{
 const before=JSON.stringify(row);let calls=0;
 const result=await send(row,{...config,RESEARCH_API_URL:'https://ignored.invalid/'},async(url,options)=>{
  calls++;assert.equal(url,config.GAS_API_URL);assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'text/plain;charset=utf-8');assert.equal(options.mode,'cors');assert.equal(options.credentials,'omit');
  const body=JSON.parse(options.body);assert.equal(body.versionKey,row.VersionKey);assert.equal(body.requestType,'complete_card');assert(!Object.hasOwn(body,'dryRun'));assert.equal(body.displayName,row['現在の公式名']);return response(status);
 });assert.equal(result.status,status);assert.equal(calls,1);assert.equal(JSON.stringify(row),before);
});
test('complete_card errors are concise Japanese; no raw server strings displayed',async()=>{
 for(const [status,reason,expected]of [['reference_mismatch','',/REF/],['invalid_version','',/Version/],['disabled','',/停止中/],['conflict','',/一致/],['conflict','reference_mismatch',/REF/],['error','',/登録できません/],['unexpected','<script>alert(1)</script>',/登録できません/]])await assert.rejects(send(row,config,async()=>response(status,{reason})),expected);
 await assert.rejects(send(row,config,async()=>{throw new TypeError('Failed to fetch');}),/通信に失敗/);
 await assert.rejects(send(row,config,async()=>({ok:false})),/通信に失敗/);
 await assert.rejects(send(row,config,async()=>({ok:true,json:async()=>{throw new SyntaxError('bad');}})),/読み取れません/);
});
test('complete_card blocks disabled config and mismatched receipt; explicit dry-run is isolated',async()=>{
 let calls=0;await assert.rejects(send(row,{...config,RESEARCH_API_ENABLED:false},async()=>{calls++;}),/停止中/);assert.equal(calls,0);
 await assert.rejects(send(row,config,async()=>response('queued',{versionKey:'T700-C01'})),/一致/);
 const result=await send(row,{...config,RESEARCH_DRY_RUN:true},async(_url,options)=>{assert.equal(JSON.parse(options.body).dryRun,true);return response('dry_run',{ok:true});});assert.equal(result.status,'dry_run');
});
