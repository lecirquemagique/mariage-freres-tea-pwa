const {test}=require('node:test'),assert=require('node:assert/strict'),setup=require('./research-harness.cjs'),{payload}=setup;
test('server resolves optional identifiers, ignores stale name/time, computes queue fields',()=>{
 const x=setup(),before=JSON.stringify(x.master),start=Date.now();
 const result=x.request({action:'requestResearch',versionKey:'T146-C01',requestType:'complete_card',displayName:'old name',requestedAt:'1900-01-01T00:00:00Z'});
 assert.equal(result.status,'queued');
 const row=Object.fromEntries(x.queue[0].map((h,i)=>[h,x.queue[1][i]]));
 assert.equal(row.target_name,'T146-C01');assert.equal(row.primary_reference,'T146');assert.equal(row.tea_reference,'T146');
 assert.equal(row.source,'PWA');assert.equal(row.requested_at,row.created_at);assert.ok(Date.parse(row.requested_at)>=start&&Date.parse(row.requested_at)<=Date.now());
 for(const h of ['公式商品ページURL','現在の公式説明','茶葉画像URL','茶葉サムネイルURL','水色画像URL','公式掲載状態'])assert.ok(JSON.parse(row.missing_fields).includes(h));
 assert.equal(JSON.stringify(x.master),before);
 const y=setup();assert.equal(y.request({action:'requestResearch',versionKey:'T146-C01',requestType:'complete_card'}).status,'queued');
 assert.equal(setup().request({...payload(),requestType:'bad'}).status,'invalid_request_type');
 assert.equal(setup().request({...payload(),versionKey:'absent'}).status,'invalid_version');
 assert.equal(setup().request({...payload(),primaryReference:'T99'}).status,'conflict');
 assert.equal(setup().request({...payload(),teaReference:'T99'}).status,'conflict');
 const client=require('../research-request').payload({VersionKey:'T146-C01'});
 assert.ok(Number.isFinite(Date.parse(client.requestedAt)));
 for(const field of ['requested_at','source','missing_fields'])assert.equal(Object.hasOwn(client,field),false);
});
test('all four explicit Versions enqueue separately; 20 repeats dedupe; Master unchanged',()=>{
 const x=setup(),before=JSON.stringify(x.master);
 for(const key of ['T146-B01','T146-C01','T1620-B01','T1620-C01']){
  assert.equal(x.request(payload(key)).status,'queued');
  for(let i=0;i<20;i++)assert.equal(x.request(payload(key)).status,'already_queued');
 }
 assert.equal(x.writes.length,4);assert.equal(JSON.stringify(x.master),before);
 assert.ok(x.writes.every(w=>w.c===1&&w.n===1&&w.w===19));
});
test('invalid/missing/duplicate key, reference/name mismatch, arbitrary fields fail closed',()=>{
 for(const patch of [{versionKey:'MISSING'},{versionKey:''},{primaryReference:'T99'},{teaReference:'T99'},{url:'https://evil.test'},{column:'A1'},{requestType:'writeMaster'},{source:'PWA'},{missing_fields:[]}]){
  const x=setup();assert.equal(x.request({...payload(),...patch}).ok,false);assert.equal(x.writes.length,0);
 }
 const x=setup();x.master.push(x.master[2].slice());assert.equal(x.request(payload()).status,'conflict');assert.equal(x.writes.length,0);
});
test('completed without timestamp blocks rerequest; other states remain unfinished',()=>{
 for(const state of ['pending','processing','error','ambiguous','not_found','unexpected','completed']){
  const x=setup();x.request(payload());x.queue[1][5]=state;
  assert.equal(x.request(payload()).status,state==='completed'?'recently_completed':'already_queued');
 }
});
test('dry-run, missing columns, disabled and busy never write',()=>{
 let x=setup();assert.equal(x.request({...payload(),dryRun:true}).status,'dry_run');assert.equal(x.writes.length,0);
 x=setup();x.queue[0]=x.queue[0].slice(0,12);assert.equal(x.request(payload()).status,'schema_required');assert.equal(x.request({...payload(),dryRun:true}).plan.missingColumns.length,7);assert.equal(x.writes.length,0);
 x=setup({enabled:false});assert.equal(x.request(payload()).status,'disabled');assert.equal(x.writes.length,0);
 x=setup({busy:true});assert.equal(x.request(payload()).status,'busy');assert.equal(x.writes.length,0);
});
test('legacy REF-only open request conflicts, no inferred target',()=>{
 const x=setup();x.queue.push(['legacy','','','T146','','pending']);assert.equal(x.request(payload()).status,'conflict');assert.equal(x.writes.length,0);
});
test('client POST contract and success/error handling',async()=>{
 const api=require('../research-request'),row={VersionKey:'T146-C01','Primary Reference':'T146','Tリファレンス番号':'T146','現在の公式名':'NAME'},config={RESEARCH_API_ENABLED:true,RESEARCH_DRY_RUN:false,GAS_API_URL:'https://test.invalid/api'};
 for(const status of ['queued','already_queued','dry_run'])assert.equal((await api.send(row,config,async(url,options)=>{assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'text/plain;charset=utf-8');assert.equal(JSON.parse(options.body).versionKey,row.VersionKey);return {ok:true,json:async()=>({ok:true,status,versionKey:row.VersionKey})};})).status,status);
 await assert.rejects(api.send(row,config,async()=>({ok:true,json:async()=>({ok:false,status:'conflict'})})),/一致/);
 await assert.rejects(api.send(row,config,async()=>{throw new TypeError('network');}),/通信/);
});
test('existing doPost dispatches requestResearch and GET cannot enqueue',()=>{
 const x=setup();x.ctx.mfImageCollectorJson_=v=>v;
 assert.equal(x.ctx.doPost({postData:{contents:JSON.stringify(payload())}}).status,'queued');
 x.ctx.mfImageCollectorJsonOrJsonp_=v=>v;
 assert.equal(x.ctx.doGet({parameter:{action:'requestResearch'}}).ok,false);assert.equal(x.writes.length,1);
});
test('legacy discovery worker skips Version-targeted pending requests',()=>{
 const x=setup();x.request(payload());
 x.ctx.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
 x.ctx.mfImageCollectorGetOrCreateTargetQueueSheet_=()=>({getLastRow:()=>x.queue.length,getLastColumn:()=>19,getRange:()=>({getValues:()=>x.queue.slice(1),setValue:()=>{throw Error('Legacy worker must not claim card request');}})});
 x.ctx.mfImageCollectorSheetHeaders_=()=>x.queue[0];
 assert.equal(x.ctx.mfImageCollectorGetTargetDiscoveryRequest_({}).request,null);
});
