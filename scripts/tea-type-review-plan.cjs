'use strict';
// Offline only: use the normal production Review builder, never append a row.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..');
function planTeaTypeReviews(values, operations, source=fs.readFileSync(path.join(root,'backend/mf-image-collector.gs'),'utf8')) {
  const c={Date,JSON,Utilities:{DigestAlgorithm:{SHA_1:'sha1'},Charset:{UTF_8:'utf8'},
    computeDigest:(_algorithm,text)=>[...crypto.createHash('sha1').update(text).digest()]}};
  vm.createContext(c);vm.runInContext(source,c);
  const headers=values[0],at=h=>{const n=headers.indexOf(h);if(n<0)throw Error('Missing header: '+h);return n;};
  const key=at('VersionKey'),primary=at('Primary Reference'),ref=at('Tリファレンス番号'),tea=at('茶種タグ');
  const name=headers.indexOf('現在の公式名'),book=headers.indexOf('銘柄名（黒い本）');
  return operations.map(op=>{
    if(!op.reason||!op.version_key||!op.reference)throw Error('Explicit target and human-review reason required.');
    const found=values.slice(1).filter(r=>r[key]===op.version_key);
    if(found.length!==1)throw Error('VersionKey must match exactly one Master row.');
    const row=found[0];
    if(row[primary]!==op.reference||row[ref]!==op.reference||!op.version_key.startsWith(op.reference+'-'))throw Error('Primary / REF mismatch.');
    if(row[tea]!==op.current_value)throw Error('Master current value changed.');
    const after=c.mfImageCollectorNormalizeApprovedStructuredFactCandidate_('茶種タグ',op.suggested_value);
    if(!after||after===op.current_value)throw Error('Nonempty changed candidate required.');
    const identity={rule:'tea-type-representation-v1',version_key:op.version_key,reference:op.reference,current:op.current_value,suggested:after,reason:op.reason};
    const hash=crypto.createHash('sha1').update(JSON.stringify(identity)).digest('hex');
    const evidence=JSON.stringify(identity);
    const candidate={reference:op.reference,primary_reference:op.reference,t_reference:op.reference,
      official_name:row[name]||row[book]||'',existing_reference:op.reference,existing_version_key:op.version_key,
      target_version_key:op.version_key,target_provenance:'human',detection_type:'structured_fact',target_column:'茶種タグ',
      current_value:op.current_value,suggested_value:after,evidence,evidence_text:evidence,evidence_language:'JA',
      source_type:'taxonomy_representation_normalization',confidence:'high',status:'要確認',human_decision:'',
      diff_summary:'既存茶種の複数値表現修正（人間確認必須）',
      structured_fact:{column:'茶種タグ',current_value:op.current_value,suggested_value:after,requires_human_review:true,
        normalization:{...identity,fingerprint:hash}}};
    const detectionId=c.mfImageCollectorReviewDedupeKey_(candidate);
    return {detection_id:detectionId,candidate,review:c.mfImageCollectorReviewCandidateToRow_(candidate,detectionId)};
  });
}
module.exports={planTeaTypeReviews};
if(require.main===module){
  const [masterFile,operationsFile]=process.argv.slice(2);
  if(!masterFile||!operationsFile)throw Error('Usage: node scripts/tea-type-review-plan.cjs <Master snapshot JSON> <explicit operations JSON>');
  const input=JSON.parse(fs.readFileSync(masterFile,'utf8'));
  console.log(JSON.stringify({dry_run:true,master_writes:0,review_writes:0,queue_writes:0,
    candidates:planTeaTypeReviews(input.values||input,JSON.parse(fs.readFileSync(operationsFile,'utf8')))},null,2));
}
