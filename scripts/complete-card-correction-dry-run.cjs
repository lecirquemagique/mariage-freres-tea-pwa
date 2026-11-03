'use strict';
// Offline only. There is no fetch, credential loading, or production writer in this script.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
function dryRun(snapshot,request,originalRows,reason,rule,operationId){
 const root=path.resolve(__dirname,'..'),before=JSON.stringify({snapshot,request});
 const ctx={Set,Date,JSON};vm.createContext(ctx);
 for(const name of ['mf-image-collector.gs','card-research-recovery.gs','card-research-correction.gs'])vm.runInContext(fs.readFileSync(path.join(root,'backend',name),'utf8'),ctx);
 ctx.Utilities={DigestAlgorithm:{SHA_1:'sha1'},Charset:{UTF_8:'utf8'},computeDigest:(_a,s)=>[...crypto.createHash('sha1').update(s).digest()]};
 // A fixed-range snapshot includes empty grid columns. GAS getDataRange() does not.
 const sheet=data=>{const width=Math.max(...data.map(r=>r.reduce((last,v,i)=>v!==''&&v!=null?i+1:last,0)));
  return {getDataRange:()=>({getValues:()=>data.map(r=>Array.from({length:width},(_,i)=>r[i]??''))}),getLastColumn:()=>width,getLastRow:()=>data.length};};
 // FORMULA exports are not GAS getValues(). For this offline replay only, use the
 // saved server-evaluated target from the same recovery preview for formula cells.
 // Never infer a formula result, and never alter the input snapshot itself.
 const evaluatedMaster=snapshot.master.map(r=>r.slice()),formulaFields=[];
 const identityCol=snapshot.master[0].indexOf('VersionKey');
 for(const row of evaluatedMaster.slice(1))if(row[identityCol]===request.version_key)row.forEach((value,i)=>{
  if(typeof value==='string'&&value.startsWith('=')){
   const field=snapshot.master[0][i];if(!Object.hasOwn(request.target,field))throw Error('Missing evaluated snapshot for '+field);
   row[i]=request.target[field];formulaFields.push(field);
  }
 });
 const sheets={'銘柄マスター':sheet(evaluatedMaster),'変更候補レビュー':sheet(snapshot.review),'銘柄指定調査キュー':sheet(snapshot.queue)};
 ctx.mfImageCollectorOpenSpreadsheet_=()=>({getSheetByName:n=>sheets[n]});
 ctx.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
 ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>({MF_CARD_RECOVERY_ADMIN_SECRET:'offline-fixture',MF_CARD_RECOVERY_ADMIN_NAME:'Local correction dry-run'}[k]||null),setProperty(){throw Error('dry-run property write forbidden');}})};
 const collector={require,process:{env:{}},console,URL,Buffer,__dirname:path.join(root,'collector')};vm.createContext(collector);
 const source=fs.readFileSync(path.join(root,'collector/collector.js'),'utf8');vm.runInContext(source.slice(0,source.lastIndexOf('\nmain().catch(')),collector);
 const originals=originalRows.map(n=>({n,row:Object.fromEntries(snapshot.review[0].map((h,i)=>[h,snapshot.review[n-1][i]]))}));
 const info=JSON.parse(originals[0].row['公式情報JSON']),meta=info.card_research;
 const pages=meta.language_evidence.map(e=>({ok:true,url:e.source_url,language:e.evidence_language,refs:meta.verified_references,official_name:e.name,acquisition_method:e.acquisition_method,
  facts:{url:e.source_url,canonical:e.canonical,h1:e.name,productSummary:'REF '+meta.tea_reference,category:e.category,productDescription:e.description,structuredProductData:e.availability_evidence}}));
 // Refresh the supplied request target from this snapshot, never from old candidate values.
 const mh=evaluatedMaster[0],matches=evaluatedMaster.slice(1).filter(r=>r[mh.indexOf('VersionKey')]===request.version_key);assert.equal(matches.length,1);
 request=JSON.parse(JSON.stringify(request));request.target=Object.fromEntries(mh.map((h,i)=>[h,String(matches[0][i]??'')]));
 const plan=collector.buildCardResearchPlan(request,pages,{recovery:true});
 assert.equal(plan.review_conflicts.length,0);assert.equal(plan.product_group.status,'verified');
 const payload={admin_secret:'offline-fixture',approved:true,parent_request_id:meta.recovery.parent_request_id,recovery_request_id:meta.request_id,
  operation_id:operationId,version_key:request.version_key,primary_reference:request.primary_reference,tea_reference:request.tea_reference,
  correction_reason:reason,corrected_by_rule_version:rule,corrections:originals.map(o=>{
   const candidates=plan.candidates.filter(c=>c.target_column===o.row['対象列']);assert.equal(candidates.length,1);
   return {original_detection_id:o.row['検出ID'],original_review_row:o.n,expected_original_fingerprint:ctx.mfImageCollectorCardResearchReceipt_(o.row,o.n).fingerprint,candidate:candidates[0]};
  })};
 const result=JSON.parse(JSON.stringify(ctx.mfImageCollectorCardCorrectionApply_(payload)));
 // Input originals, Master and queue must remain byte-equivalent in memory.
 assert.equal(JSON.stringify({snapshot,request:JSON.parse(before).request}),before);
 return {input:'Saved production snapshot and FR/EN evidence; not a fresh live read',operation_id:operationId,status:result.status,manifest:result.manifest,
  formula_results_source:'Saved server-evaluated recovery preview target (historical, not recalculated)',formula_fields:formulaFields,
  original_rows_unchanged:true,master_writes:0,review_writes:0,queue_writes:0,items:result.items};
}
module.exports={dryRun};
if(require.main===module){
 const [snapshotFile,requestFile,rows,operationId,output]=process.argv.slice(2);
 if(!snapshotFile||!requestFile||!rows||!operationId)throw Error('Usage: node scripts/complete-card-correction-dry-run.cjs snapshot.json request.json 617,618 local-operation-id [output.json]');
 const result=dryRun(JSON.parse(fs.readFileSync(snapshotFile)),JSON.parse(fs.readFileSync(requestFile)).request,rows.split(',').map(Number),
  'FR活用形と複数香味分類の抽出改善による訂正。旧候補は当時正常保存された履歴として保持。','structured-aroma-v2',operationId);
 const json=JSON.stringify(result,null,2);if(output)fs.writeFileSync(output,json);else console.log(json);
}
