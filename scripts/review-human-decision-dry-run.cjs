'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const runtime=require('./review-repair-runtime.cjs'),{planHumanDecision}=require('./review-human-decision-plan.cjs');
async function run(){
 const source='logs/review-repair-write-20261018',out=process.argv[2]||'logs/review-human-decision-20261018';
 const load=n=>JSON.parse(fs.readFileSync(path.join(source,n),'utf8'));
 const master=load('master-after.json').values,headers=master[0];
 const rows=master.slice(1).filter(r=>r[headers.indexOf('VersionKey')]).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
 const x=runtime(rows,{gasSource:process.env.MF_REVIEW_GAS_SOURCE}),products=(await x.collector.fetchMasterProducts({masterGasApiUrl:'https://snapshot.invalid/'},'.',false)).products;
 const full=load('review-full-after.json').values,rh=full[0],grid=full.map(r=>r.slice()),before=JSON.stringify(full),masterBefore=JSON.stringify(x.masterSnapshot);
 const prior=load('postflight/repair-plan.json');
 const plans=prior.filter(p=>p.rowNumber>=586&&p.rowNumber<=591).map(p=>{
   const review=Object.fromEntries(rh.map((h,i)=>[h,full[p.rowNumber-1][i]??'']));
   return planHumanDecision({...x,products,rowNumber:p.rowNumber,review,page:p.page});
 });
 for(const p of plans)for(const [h,v]of Object.entries(p.updates))grid[p.rowNumber-1][rh.indexOf(h)]=v;
 const sheet={getLastRow:()=>grid.length,getLastColumn:()=>rh.length,getRange:(row,col,n=1,w=rh.length)=>({getValues:()=>grid.slice(row-1,row-1+n).map(r=>Array.from({length:w},(_,i)=>r[col-1+i]??''))})};
 x.gas.mfImageCollectorMasterSnapshot_=()=>JSON.parse(masterBefore);
 const batches=[[586,6],[593,7],[601,4],[586,19]].map(([row,count])=>({row,count,...x.gas.mfImageCollectorPreflightReviewRows_(sheet,row,count)}));
 for(const b of batches)assert.equal(b.errors.length,0,JSON.stringify(b.errors));
 assert.equal(batches[3].counts.apply,17);assert.equal(batches[3].counts.skip_finalized,2);
 assert.deepEqual(Array.from(batches[3].items).filter(i=>i.category==='skip_finalized').map(i=>i.row_number).sort((a,b)=>a-b),[592,600]);
 assert.equal(JSON.stringify(full),before);assert.equal(JSON.stringify(x.masterSnapshot),masterBefore);
 for(let i=0;i<full.length;i++)if(i<585||i>590)assert.deepEqual(grid[i],full[i]);
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify({snapshotSource:source,liveRead:false,write:false,masterRows:rows.length,plans,batches,protectedRowsUnchanged:true,masterUnchanged:true},null,2));
 console.log(JSON.stringify({snapshotSource:source,masterRows:rows.length,plans:plans.map(p=>({row:p.rowNumber,ref:p.reference,mode:p.resolution.mode,process:p.preflight.process})),batches:batches.map(b=>({row:b.row,count:b.count,counts:b.counts,errors:b.errors})),write:false,out},null,2));
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});
