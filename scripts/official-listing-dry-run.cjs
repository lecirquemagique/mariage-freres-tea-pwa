'use strict';
// Offline only. No Google client, credentials, network, or Sheet write path.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function plan(input){
  const c={};vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/official-listing.gs'),'utf8'),c);
  const rows=input.rows || (input.values || []).slice(1).map(values=>Object.fromEntries(input.values[0].map((h,i)=>[h,values[i]??''])));
  const headers=input.values?.[0] || [...new Set(rows.flatMap(Object.keys))];
  const observations=input.observations || (input.negativeObservation?[input.negativeObservation]:[]);
  const candidates=[],issues=[];
  for(const observation of observations){
    const targets=rows.filter(row=>row.VersionKey===observation.version_key);
    try{
      if(targets.length!==1)throw Error('Missing or duplicate exact VersionKey.');
      if(observations.filter(o=>o.version_key===observation.version_key).length!==1)throw Error('Duplicate observations require reconciliation.');
      candidates.push(c.mfImageCollectorListingObservationPlan_(targets[0],observation));
    }catch(error){issues.push({version_key:observation.version_key,reason:error.message});}
  }
  return {dry_run:true,actual_writes:0,network_requests:0,
    schema:c.mfImageCollectorOfficialListingSchemaPlan_(headers,rows),candidates,issues,
    // No executable update requests: negative candidates require human review.
    ready_for_review:issues.length===0,requests:[]};
}
if(require.main===module){
  if(!process.argv[2])throw Error('Usage: node scripts/official-listing-dry-run.cjs <local-snapshot-with-observations.json>');
  process.stdout.write(JSON.stringify(plan(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2)+'\n');
}
module.exports={plan};
