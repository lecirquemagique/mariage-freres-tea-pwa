'use strict';
// Offline planner only. No transport, credentials, queue transitions or writable Sheet service.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const REQUEST_ID='76c49d5c-9fd2-4385-9ab4-34a9dc6116cd';
function planRecovery(snapshot){
 const c={Set,Date,JSON};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/mf-image-collector.gs'),'utf8'),c);
 c.Utilities={DigestAlgorithm:{SHA_1:'sha1'},Charset:{UTF_8:'utf8'},computeDigest:(_a,s)=>Array.from(crypto.createHash('sha1').update(s).digest()).map(b=>b>127?b-256:b)};
 const check=(condition,message)=>{if(!condition)throw Error(message);};
 check(snapshot.requestId===REQUEST_ID&&snapshot.queueRow===211,'Recovery scope must be exact request / row211');
 check(snapshot.evidence?.method==='archived_verified_plan'&&snapshot.evidence.sha256===crypto.createHash('sha256').update(JSON.stringify(snapshot.candidates)).digest('hex'), 'Archived candidate evidence hash mismatch');
 const {currentMaster,baselineMaster,queueValues,reviewValues,masterIdentityRows}=snapshot;
 const kh=masterIdentityRows[0].indexOf('VersionKey');check(kh>=0&&masterIdentityRows.slice(1).filter(r=>r[kh]==='T425-B01').length===1,'Fresh Master VersionKey is missing or duplicated');
 const readOnly=data=>({getDataRange:()=>({getValues:()=>data.map(r=>r.slice())})});
 const context=c.mfImageCollectorCardResearchContext_({getSheetByName:n=>({'銘柄マスター':readOnly(currentMaster),'銘柄指定調査キュー':readOnly(queueValues)})[n]},REQUEST_ID);
 check(context.row===211&&context.request.version_key==='T425-B01'&&context.request.primary_reference==='T425'&&context.request.tea_reference==='T425','Queue recovery identity mismatch');
 check(context.request.status==='completed'&&context.request.result_status==='review_only','Original failed completion history changed');
 const oldResult=JSON.parse(context.request.message||'{}');check(Array.isArray(oldResult.proposed)&&oldResult.proposed.length===0,'Original completion result is no longer empty');
 for(const key of ['version_key','primary_reference','tea_reference','missing_fields'])check(context.request[key]===snapshot.originalRequest[key],`Original request ${key} changed`);
 const bh=baselineMaster[0],baselineRows=baselineMaster.slice(1).filter(r=>r[bh.indexOf('VersionKey')]==='T425-B01');check(baselineRows.length===1,'Baseline VersionKey must be unique');
 const watched=[...new Set(['VersionKey','Primary Reference','Tリファレンス番号','現在の公式名','銘柄名（黒い本）','現在のカテゴリ','産地・国',...c.MF_CARD_RESEARCH_FIELDS])];
 for(const key of watched){const j=bh.indexOf(key);check(j>=0&&String(baselineRows[0][j]??'')===String(context.target[key]??''),`Master evidence/scope changed: ${key}`);}
 check(Array.isArray(snapshot.candidates)&&snapshot.candidates.length===3,'Expected three archived HOJICHA candidates');
 const manifest=c.mfImageCollectorCardResearchManifest_(context,snapshot.candidates),rh=reviewValues[0];
 const expectedFields=['現在の公式説明','香味詳細タグ','香味大分類'];check(expectedFields.every(f=>manifest.entries.some(e=>e.field===f)),'Recovery candidate scope mismatch');
 for(const values of reviewValues.slice(1)){
  const r=c.mfImageCollectorReviewObject_(rh,values);let info;try{info=JSON.parse(r['公式情報JSON']||'{}');}catch{info={};}
  check(!String(r['検出ID']||'').startsWith('card-'+REQUEST_ID+'-')&&info.card_research?.request_id!==REQUEST_ID,'Request-linked Review already exists; reconcile before recovery');
  check(!manifest.rows.some(item=>r['対象VersionKey']==='T425-B01'&&r['検出種別']===item.row['検出種別']&&r['対象列']===item.field&&r['候補値']===item.row['候補値']), 'Equivalent Review already exists; reconcile before recovery');
 }
 return {ok:true,dryRun:true,request_id:REQUEST_ID,queue_row:211,version_key:'T425-B01',mode:'existing_primary',
  expected:manifest.entries.length,persisted:0,reviewCandidates:manifest.rows.map(item=>({field:item.field,detection_id:item.id,row:item.row})),
  evidence:snapshot.evidence,masterWatchedColumns:watched,existingReviewMatches:0,
  writes:{queue:0,review:0,master:0},normal_image_products:0,
  recommendation:'Preserve row211 as immutable failure history; authorize a separately linked recovery request after deploying persistence verification. No recovery action is implemented by this planner.'};
}
module.exports={planRecovery,REQUEST_ID};
if(require.main===module){try{if(process.argv.length!==3)throw Error('Usage: node scripts/complete-card-recovery-dry-run.cjs <read-only-snapshot.json>');console.log(JSON.stringify(planRecovery(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2));}catch(e){console.error(JSON.stringify({ok:false,error:e.message,writePerformed:false}));process.exitCode=1;}}
