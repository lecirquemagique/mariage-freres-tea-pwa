'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),setup=require('./research-harness.cjs'),{payload}=setup;
function clock(x,iso){x.ctx.Date=class extends Date{constructor(...args){super(...(args.length?args:[iso]));}static now(){return new Date(iso).getTime();}};}
function history(x,date,key='T146-C01',patch={}){const data={request_id:'old-'+x.queue.length,version_key:key,request_type:'complete_card',status:'completed',completed_at:date,requested_at:'1900-01-01T00:00:00Z',...patch};x.queue.push(x.queue[0].map(h=>data[h]??''));return data.request_id;}
for(const status of ['pending','processing','claimed','error','unknown',''])test('unfinished '+status+' takes priority over expired completion',()=>{
 const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,'2020-01-01T00:00:00Z');history(x,'','T146-C01',{request_id:'open',status});
 const before=JSON.stringify(x.queue);assert.equal(x.request(payload()).status,'already_queued');assert.equal(x.writes.length,0);assert.equal(JSON.stringify(x.queue),before);
});
test('364 days after completion is recently_completed; requested_at is irrelevant',()=>{
 const x=setup();clock(x,'2027-10-17T03:04:05Z');history(x,'2026-10-18T03:04:05Z','T146-C01',{requested_at:'1900-01-01T00:00:00Z'});
 const r=x.request({...payload(),requestedAt:'2099-10-18T00:00:00Z'});assert.equal(r.status,'recently_completed');assert.equal(r.nextEligibleAt,'2027-10-18T03:04:05.000Z');assert.equal(x.writes.length,0);
});
for(const now of ['2027-10-18T03:04:05Z','2028-10-19T00:00:00Z'])test('calendar anniversary or later permits a new immutable request: '+now,()=>{
 const x=setup();clock(x,now);const oldId=history(x,'2026-10-18T03:04:05Z');const old=JSON.stringify(x.queue[1]),master=JSON.stringify(x.master);
 const r=x.request(payload());assert.equal(r.status,'requeued_after_expiry');assert.notEqual(r.requestId,oldId);assert.equal(x.queue.length,3);assert.equal(JSON.stringify(x.queue[1]),old);assert.equal(JSON.stringify(x.master),master);
 const values=Object.fromEntries(x.queue[0].map((h,i)=>[h,x.queue[2][i]]));assert.equal(values.source,'PWA');assert.equal(values.request_type,'complete_card');assert.equal(values.status,'pending');assert.equal(values.version_key,'T146-C01');assert.equal(values.requested_at,new Date(now).toISOString());
 for(let i=0;i<20;i++)assert.equal(x.request(payload()).status,'already_queued');assert.equal(x.writes.length,1);
});
test('one millisecond before anniversary is blocked; exact boundary is allowed',()=>{
 for(const [now,status]of [['2027-10-18T14:59:59.499Z','recently_completed'],['2027-10-18T14:59:59.500Z','requeued_after_expiry']]){
 const x=setup();clock(x,now);history(x,'2026-10-18T14:59:59.500Z');assert.equal(x.request(payload()).status,status);}
});
test('leap-day anniversary clamps to Feb28 at the same Asia/Tokyo time',()=>{
 const x=setup();const completed=x.ctx.mfImageCollectorResearchCompletedAt_('2024-02-28T16:00:00Z');
 assert.equal(x.ctx.mfImageCollectorResearchAnniversary_(completed).toISOString(),'2025-02-27T16:00:00.000Z');
 clock(x,'2025-02-27T15:59:59.999Z');history(x,'2024-02-28T16:00:00Z');assert.equal(x.request(payload()).status,'recently_completed');
 clock(x,'2025-02-27T16:00:00Z');assert.equal(x.request(payload()).status,'requeued_after_expiry');
});
test('not fixed365 days: leap-year anniversary requires the full calendar year',()=>{
 const x=setup();clock(x,'2024-02-28T00:00:00Z');history(x,'2023-03-01T00:00:00Z');assert.equal(x.request(payload()).status,'recently_completed');
 clock(x,'2024-03-01T00:00:00Z');assert.equal(x.request(payload()).status,'requeued_after_expiry');
});
for(const date of ['',null,'not-a-date','2026-02-30T00:00:00Z','2026-10-18 12:00:00','2099-01-01T00:00:00Z'])test('missing/invalid/future completion blocks automatic requeue: '+date,()=>{
 const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,date);const r=x.request(payload());assert.equal(r.status,'recently_completed');assert.equal(r.reason,'completion_history_unverifiable');assert.equal(x.writes.length,0);
});
test('native Sheets Date cells are accepted without locale string conversion',()=>{
 const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,new Date('2026-10-18T00:00:00Z'));assert.equal(x.request(payload()).status,'requeued_after_expiry');
});
test('latest completed_at wins regardless of row and requested_at order',()=>{
 const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,'2027-09-01T00:00:00Z');history(x,'2020-01-01T00:00:00Z','T146-C01',{requested_at:'2099-01-01T00:00:00Z'});
 assert.equal(x.request(payload()).nextEligibleAt,'2028-09-01T00:00:00.000Z');assert.equal(x.writes.length,0);
});
test('one unverifiable completion cannot be hidden by another expired completion',()=>{
 const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,'2020-01-01T00:00:00Z');history(x,'');assert.equal(x.request(payload()).reason,'completion_history_unverifiable');
});
test('same Primary has independent B01/C01 histories; unrelated completed types do not impose a card cooldown',()=>{
 const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,'2027-10-17T00:00:00Z');assert.equal(x.request(payload('T146-B01')).status,'queued');assert.equal(x.request(payload()).status,'recently_completed');
 const y=setup();history(y,'','T146-C01',{request_type:'legacy_discovery'});assert.equal(y.request(payload()).status,'queued');
});
test('expired request still revalidates VersionKey, Primary and T before append',()=>{
 for(const patch of [{versionKey:'missing'},{primaryReference:'T99'},{teaReference:'T99'}]){const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,'2020-01-01T00:00:00Z');assert.equal(x.request({...payload(),...patch}).ok,false);assert.equal(x.writes.length,0);}
});
test('missing authoritative Master references cannot be re-enqueued with omitted client references',()=>{
 for(const column of ['Primary Reference','Tリファレンス番号']){const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,'2020-01-01T00:00:00Z');x.master[2][x.master[0].indexOf(column)]='';
 const r=x.request({action:'requestResearch',versionKey:'T146-C01',requestType:'complete_card'});assert.equal(r.status,'conflict');assert.equal(r.reason,'master_reference_missing');assert.equal(x.writes.length,0);}
});
test('client cannot supply a policy clock or completion timestamp',()=>{
 for(const patch of [{serverNow:'2099-01-01T00:00:00Z'},{completedAt:'1900-01-01T00:00:00Z'}]){const x=setup();assert.equal(x.request({...payload(),...patch}).ok,false);assert.equal(x.writes.length,0);}
});
test('requeue missing_fields comes from the latest Master, not old queue data',()=>{
 const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,'2020-01-01T00:00:00Z','T146-C01',{missing_fields:'["公式商品ページURL"]'});
 x.master[0].push('公式商品ページURL','現在の公式説明');for(let i=1;i<x.master.length;i++)x.master[i].push('https://www.mariagefreres.com/en/known.html','');
 assert.equal(x.request(payload()).status,'requeued_after_expiry');const missing=JSON.parse(x.queue[2][x.queue[0].indexOf('missing_fields')]);assert(!missing.includes('公式商品ページURL'));assert(missing.includes('現在の公式説明'));
});
test('expired dry-run plans an append without UUID/write; no old row mutation',()=>{
 const x=setup();clock(x,'2027-10-18T00:00:00Z');history(x,'2020-01-01T00:00:00Z');const before=JSON.stringify(x.queue),r=x.request({...payload(),dryRun:true});assert.equal(r.status,'dry_run');assert.equal(r.plan.requeued,true);assert.equal(x.writes.length,0);assert.equal(JSON.stringify(x.queue),before);
});
test('T2306 pending row169 remains unchanged and already_queued',()=>{
 const x=setup();x.master.push(['T2306-B01','T2306','T2306','GRAND PAI MU TAN','']);while(x.queue.length<168)x.queue.push([]);history(x,'','T2306-B01',{request_id:'2a855a7a-a012-449b-ab9a-393639ace1a2',status:'pending'});
 const before=JSON.stringify(x.queue);assert.equal(x.request(payload('T2306-B01')).status,'already_queued');assert.equal(x.queue[168][5],'pending');assert.equal(JSON.stringify(x.queue),before);assert.equal(x.writes.length,0);
});
test('frontend accepts policy statuses without changing the Master row or payload',async()=>{
 const api=require('../research-request'),row={VersionKey:'T146-C01'},before=JSON.stringify(row);
 for(const status of ['queued','already_queued','recently_completed','requeued_after_expiry']){
 const r=await api.send(row,{GAS_API_URL:'https://test.invalid'},async()=>({ok:true,json:async()=>({ok:true,status,versionKey:row.VersionKey})}));assert.equal(r.status,status);}
 assert.equal(api.feedback({status:'recently_completed'}).kind,'recent');assert.equal(api.feedback({status:'recently_completed'}).message,'この銘柄は最近調査済みです');assert.equal(api.feedback({status:'requeued_after_expiry'}).message,'再調査依頼を登録しました');assert.equal(JSON.stringify(row),before);
});
