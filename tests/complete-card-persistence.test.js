'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {setup}=require('./complete-card-queue.test.js');
const {planRecovery,REQUEST_ID}=require('../scripts/complete-card-recovery-dry-run.cjs');
const fields=['現在の公式説明','香味詳細タグ','香味大分類'];
const urls={FR:'https://www.mariagefreres.com/fr/hojicha-t425-thes-au-poids.html',EN:'https://www.mariagefreres.com/en/hojicha-t425-tea-by-the-weight.html'};
function client(){const c={require,process:{env:{}},console,URL,Buffer,__dirname:path.join(__dirname,'../collector')};vm.createContext(c);const s=fs.readFileSync(path.join(__dirname,'../collector/collector.js'),'utf8');vm.runInContext(s.slice(0,s.lastIndexOf('\nmain().catch(')),c);return c;}
function fixture(){
 const x=setup();for(const h of ['現在のカテゴリ','産地・国'])if(!x.headers.includes(h)){x.headers.push(h);x.master[1].push('');}
 const data={'VersionKey':'T425-B01','Primary Reference':'T425','Tリファレンス番号':'T425','銘柄名（黒い本）':'HOJICHA','現在の公式名':'HOJICHA'};
 for(const [k,v]of Object.entries(data))x.master[1][x.headers.indexOf(k)]=v;
 for(const f of fields)x.master[1][x.headers.indexOf(f)]='';
 const row=x.queue[168];x.queue[168]=[];while(x.queue.length<211)x.queue.push([]);x.queue[210]=row;
 for(const [k,v]of Object.entries({request_id:REQUEST_ID,target_ref:'T425',target_name:'HOJICHA',version_key:'T425-B01',primary_reference:'T425',tea_reference:'T425',missing_fields:JSON.stringify(fields)}))row[x.qh.indexOf(k)]=v;
 const candidates=fields.map((f,i)=>({target_column:f,current_value:'',suggested_value:['翻訳レビュー候補','キャラメル','甘香・菓子'][i],evidence_url:urls.FR,
  evidence_text:'[FR] REF T425 HOJICHA: une note de caramel. [EN] REF T425 HOJICHA.',evidence_language:'FR',official_name:'HOJICHA',verified_references:['T425'],
  official_urls_by_language:urls,language_evidence:Object.entries(urls).map(([language,url])=>({evidence_language:language,source_url:url,canonical:url,name:'HOJICHA',description:'HOJICHA caramel',availability:'販売中',acquisition_method:'cdp_navigation'}))}));
 const call=p=>x.call({request_id:REQUEST_ID,...p});const request=call({action:'claimCardResearchRequest'}).request;
 const payload=(action,extra={})=>({action,request_id:REQUEST_ID,version_key:'T425-B01',primary_reference:'T425',tea_reference:'T425',claim_token:request.claim_token,...extra});
 const record=i=>call(payload('recordCardResearchCandidate',{candidate:candidates[i],expected_candidates:candidates}));
 const complete=extra=>call(payload('completeCardResearchRequest',{expected_candidates:candidates,...extra}));
 return {x,candidates,request,call,payload,record,complete,status:()=>x.queue[210][x.qh.indexOf('status')]};
}
const plain=x=>JSON.parse(JSON.stringify(x));
test('HOJICHA three Reviews read back with receipts and complete proposed3; Master unchanged',()=>{
 const f=fixture(),master=JSON.stringify(f.x.master);const receipts=[0,1,2].map(f.record);
 for(const r of receipts){assert.equal(r.verified,true);assert(r.review_row>=2);assert.match(r.fingerprint,/^[a-f0-9]{40}$/);assert.equal(r.version_key,'T425-B01');}
 const info=JSON.parse(f.x.review[1][f.x.review[0].indexOf('公式情報JSON')]);assert.equal(info.card_research.language_evidence.length,2);
 assert.equal(info.card_research.official_urls_by_language.EN,urls.EN);const result=f.complete();assert.equal(result.expected,3);assert.equal(result.persisted,3);assert.equal(result.result.proposed.length,3);assert.equal(result.result.unresolved.length,0);assert.equal(f.status(),'completed');assert.equal(JSON.stringify(f.x.master),master);
});
test('append returns normally but saves nothing: record fails, queue stays processing',()=>{const f=fixture();f.x.sheets['変更候補レビュー'].appendRow=()=>{};assert.throws(()=>f.record(0),/review_persistence_failed/);assert.equal(f.x.review.length,1);assert.equal(f.status(),'processing');});
for(const saved of [0,1,2])test(`completion expects3 but only${saved} Review rows survive: persistence failure, never evidence-not-found/completed`,()=>{
 const f=fixture();[0,1,2].forEach(f.record);f.x.review.splice(saved+1);const before=JSON.stringify(f.x.queue);
 assert.throws(()=>f.complete(),new RegExp(saved?'review_persistence_partial':'review_persistence_failed'));assert.equal(f.status(),'processing');assert.equal(JSON.stringify(f.x.queue),before);
});
for(const [label,mutate]of [
 ['VersionKey',(r,h)=>r[h.indexOf('対象VersionKey')]='T425-C01'],
 ['REF',(r,h)=>r[h.indexOf('Tリファレンス番号')]='T426'],
 ['target column',(r,h)=>r[h.indexOf('対象列')]='産地・国'],
 ['suggested value',(r,h)=>r[h.indexOf('候補値')]='wrong'],
 ['evidence URL',(r,h)=>r[h.indexOf('根拠URL')]=urls.EN],
 ['detection type',(r,h)=>r[h.indexOf('検出種別')]='unregistered_reference'],
 ['provenance',(r,h)=>r[h.indexOf('公式情報JSON')]='{}'],
 ['language provenance',(r,h)=>{const j=h.indexOf('公式情報JSON'),info=JSON.parse(r[j]);delete info.card_research.language_evidence;r[j]=JSON.stringify(info);}],
])test(`persisted ${label} mismatch fails verification`,()=>{const f=fixture();[0,1,2].forEach(f.record);mutate(f.x.review[1],f.x.review[0]);assert.throws(()=>f.complete(),/review_verification_failed/);assert.equal(f.status(),'processing');});
test('same candidate retry returns verified existing row and no duplicate',()=>{const f=fixture(),a=f.record(0),b=f.record(0);assert.equal(a.status,'recorded');assert.equal(b.status,'already_recorded');assert.equal(b.review_row,a.review_row);assert.equal(b.fingerprint,a.fingerprint);assert.equal(f.x.review.length,2);});
test('existing detection ID with damaged content is refused rather than acknowledged',()=>{const f=fixture();f.record(0);f.x.review[1][f.x.review[0].indexOf('根拠原文')]='changed';assert.throws(()=>f.record(0),/review_verification_failed/);assert.equal(f.x.review.length,2);});
test('same detection ID with changed official evidence cannot rebind the manifest',()=>{const f=fixture();f.record(0);f.candidates[0].evidence_text+=' altered';assert.throws(()=>f.record(0),/manifest changed/);assert.equal(f.x.review.length,2);});
test('missing completion manifest fails closed; caller cannot shrink bound expectations',()=>{const f=fixture();f.record(0);assert.throws(()=>f.complete({expected_candidates:undefined}),/expected_candidates is required/);assert.throws(()=>f.complete({expected_candidates:[]}),/manifest does not match/);assert.equal(f.status(),'processing');});
test('duplicate persisted detection IDs fail closed',()=>{const f=fixture();f.record(0);f.x.review.push(f.x.review[1].slice());assert.throws(()=>f.record(0),/duplicate Review/);});
test('human review status and approved translation can change without invalidating immutable receipts',()=>{const f=fixture();[0,1,2].forEach(f.record);const h=f.x.review[0],r=f.x.review[1];r[h.indexOf('ステータス')]='承認';r[h.indexOf('人間判定')]='既存銘柄を更新';r[h.indexOf('承認済み日本語説明')]='人間承認済み説明';assert.equal(f.complete().persisted,3);});
test('Collector rejects unverified success response and never calls completion',async()=>{const f=fixture(),c=client(),calls=[];c.buildCardResearchPlan=()=>({candidates:f.candidates,unresolved:{}});await assert.rejects(c.processCardResearchRequest({request:f.request,inspect:async()=>[],call:async p=>{calls.push(p.action);return{ok:true,status:'recorded'};}}),/review_verification_failed/);assert.deepEqual(calls,['recordCardResearchCandidate']);assert.equal(f.status(),'processing');});
test('Collector one verified receipt followed by failure keeps partial receipts, no completion',async()=>{const f=fixture(),c=client(),calls=[];c.buildCardResearchPlan=()=>({candidates:f.candidates,unresolved:{}});await assert.rejects(c.processCardResearchRequest({request:f.request,inspect:async()=>[],call:async p=>{calls.push(p.action);if(calls.length===2)throw Error('lost response');return f.call(p);}}),e=>{assert.equal(e.code,'review_persistence_partial');assert.equal(e.persistence.expected,3);assert.equal(e.persistence.acknowledged,1);assert.equal(e.persistence.persisted,null);assert.equal(e.persistence.receipts.length,1);return true;});assert(!calls.includes('completeCardResearchRequest'));assert.equal(f.status(),'processing');});
test('Collector confirms expected3 / persisted3 and preserves all receipts',async()=>{const f=fixture(),c=client();c.buildCardResearchPlan=()=>({candidates:f.candidates,unresolved:{}});const r=await c.processCardResearchRequest({request:f.request,inspect:async()=>[],call:async p=>f.call(p)});assert.equal(r.persistence.expected,3);assert.equal(r.persistence.persisted,3);assert.equal(r.persistence.receipts.length,3);assert.equal(r.normal_image_products,0);assert.equal(r.master_writes,0);});
for(const fail of [false,true])test(`Collector text/plain transport -> GAS doPost -> read-back ${fail?'failure':'success'} is fully mocked`,async()=>{
 const f=fixture(),c=client(),actions=[];c.buildCardResearchPlan=()=>({candidates:f.candidates,unresolved:{}});
 c.getWriteBackSettings=()=>({gasApiUrl:'https://offline.invalid',secret:'fixture-secret'});
 c.fetch=async(_url,options)=>{assert.equal(options.headers['Content-Type'],'text/plain;charset=utf-8');const p=JSON.parse(options.body);actions.push(p.action);return{ok:true,json:async()=>f.x.ctx.doPost({postData:{contents:options.body}})};};
 if(fail)f.x.sheets['変更候補レビュー'].appendRow=()=>{};
 const run=()=>c.processCardResearchRequest({request:f.request,inspect:async()=>[],call:p=>c.cardResearchApi({config:{},baseDir:'.'},p)});
 if(fail){await assert.rejects(run(),e=>{assert.equal(e.code,'review_persistence_failed');assert.equal(e.persistence.persisted,null);return true;});assert(!actions.includes('completeCardResearchRequest'));assert.equal(f.status(),'processing');}
 else{const r=await run();assert.equal(r.result.proposed.length,3);assert.equal(r.persisted,3);assert.equal(actions.length,4);}
});
test('POST reports typed partial persistence error and confirmed surviving count',()=>{const f=fixture();[0,1,2].forEach(f.record);f.x.review.splice(2);const payload=f.payload('completeCardResearchRequest',{secret:'fixture-secret',expected_candidates:f.candidates});const r=f.x.ctx.doPost({postData:{contents:JSON.stringify(payload)}});assert.equal(r.ok,false);assert.equal(r.code,'review_persistence_partial');assert.equal(r.expected,3);assert.equal(r.persisted,1);assert.equal(f.status(),'processing');});
test('Collector distinguishes earlier acknowledgements from current confirmed persistence',async()=>{const f=fixture(),c=client();c.buildCardResearchPlan=()=>({candidates:f.candidates,unresolved:{}});await assert.rejects(c.processCardResearchRequest({request:f.request,inspect:async()=>[],call:async p=>{if(p.action==='completeCardResearchRequest')f.x.review.splice(2);return f.call(p);}}),e=>{assert.equal(e.code,'review_persistence_partial');assert.equal(e.persistence.acknowledged,3);assert.equal(e.persistence.persisted,1);return true;});assert.equal(f.status(),'processing');});
test('zero generated candidates can legitimately complete with explicit unresolved reasons',()=>{const f=fixture();const r=f.complete({expected_candidates:[],unresolved:Object.fromEntries(fields.map(k=>[k,'no_official_evidence']))});assert.equal(r.expected,0);assert.equal(r.persisted,0);assert.equal(r.result.proposed.length,0);assert.equal(f.status(),'completed');});
function recoverySnapshot(){const f=fixture(),q=f.x.queue[210];q[f.x.qh.indexOf('status')]='completed';q[f.x.qh.indexOf('result_status')]='review_only';q[f.x.qh.indexOf('message')]=JSON.stringify({proposed:[]});const originalRequest=Object.fromEntries(f.x.qh.map((h,i)=>[h,q[i]??'']));return plain({requestId:REQUEST_ID,queueRow:211,currentMaster:f.x.master,baselineMaster:f.x.master,masterIdentityRows:f.x.master,queueValues:f.x.queue,reviewValues:f.x.review,originalRequest,candidates:f.candidates,evidence:{method:'archived_verified_plan',sha256:crypto.createHash('sha256').update(JSON.stringify(f.candidates)).digest('hex'),freshOfficialLookup:false}});}
test('queue211 recovery dry-run produces three candidates and zero writes; input is unchanged',()=>{const s=recoverySnapshot(),before=JSON.stringify(s),r=planRecovery(s);assert.equal(r.expected,3);assert.equal(r.existingReviewMatches,0);assert.deepEqual(r.writes,{queue:0,review:0,master:0});assert.equal(JSON.stringify(s),before);assert.equal(r.reviewCandidates.find(p=>p.field==='香味詳細タグ').row['候補値'],'キャラメル');});
test('recovery fails on latest Master changes and on preexisting equivalent Review',()=>{const s=recoverySnapshot();s.currentMaster[1][s.currentMaster[0].indexOf('香味詳細タグ')]='existing';assert.throws(()=>planRecovery(s),/Master evidence\/scope changed/);const a=recoverySnapshot(),r=planRecovery(a);a.reviewValues.push(a.reviewValues[0].map(h=>r.reviewCandidates[0].row[h]??''));assert.throws(()=>planRecovery(a),/Review already exists/);});
test('recovery refuses request scope, missing-fields, evidence archive or Version duplication changes',()=>{for(const change of [s=>s.requestId='other',s=>s.originalRequest.missing_fields='[]',s=>s.evidence.sha256='wrong',s=>s.masterIdentityRows.push(s.masterIdentityRows[1].slice())]){const s=recoverySnapshot();change(s);assert.throws(()=>planRecovery(s));}});
