const fs=require('fs'),vm=require('vm'),path=require('path');
module.exports=function setup(options={}){
 const keys=['T146-B01','T146-C01','T1620-B01','T1620-C01'];
 const headers=['VersionKey','Primary Reference','Tリファレンス番号','現在の公式名','銘柄名（黒い本）'];
 const master=options.master||[headers,...keys.map(k=>[k,k.split('-')[0],k.split('-')[0],k,''])];
 const ctx={Set,Date,JSON,PropertiesService:{getScriptProperties:()=>({getProperty:()=>options.enabled===false?'false':'true'})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.env.MF_RESEARCH_GAS_SOURCE||path.join(__dirname,'../backend/mf-image-collector.gs'),'utf8'),ctx);
 const queue=options.queue||[Array.from(ctx.MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS).concat(Array.from(ctx.MF_RESEARCH_QUEUE_EXTRA_HEADERS))];
 const writes=[];let locked=false;
 ctx.LockService={getScriptLock:()=>({tryLock:()=>{if(locked||options.busy)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})};
 ctx.Utilities={getUuid:()=>`request-${writes.length+1}`};ctx.SpreadsheetApp={flush:()=>{}};
 const sheet={getDataRange:()=>({getValues:()=>queue.map(r=>r.slice())}),getLastRow:()=>queue.length,getMaxRows:()=>1000,getRange:(r,c,n,w)=>({setValues:values=>{if(!locked)throw Error('unlocked');writes.push({r,c,n,w,values});queue[r-1]=values[0];}})};
 ctx.mfImageCollectorOpenSpreadsheet_=()=>({getSheetByName:name=>name==='銘柄マスター'?{getDataRange:()=>({getValues:()=>master.map(r=>r.slice())})}:sheet});
 return {ctx,master,queue,writes,request:p=>JSON.parse(JSON.stringify(ctx.mfImageCollectorRequestResearch_(p)))};
};
module.exports.payload=(key='T146-C01')=>({action:'requestResearch',versionKey:key,primaryReference:key.split('-')[0],teaReference:key.split('-')[0],displayName:key,requestType:'complete_card',requestedAt:'2026-10-12T00:00:00.000Z',dryRun:false});
