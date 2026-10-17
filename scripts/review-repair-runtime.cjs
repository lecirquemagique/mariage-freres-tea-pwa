'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
module.exports=function runtime(masterRows,options={}){
 const file=path.join(root,'collector/collector.js'),source=fs.readFileSync(file,'utf8'),end=source.lastIndexOf('\nmain().catch(');
 if(end<0)throw Error('Collector entrypoint changed: inspect before loading');
 const collector={require,console,URL,URLSearchParams,Buffer,process,__dirname:path.dirname(file),setTimeout,clearTimeout,
  fetch:async url=>({ok:true,text:async()=>new URL(url).searchParams.get('callback')+'('+JSON.stringify({ok:true,rows:masterRows})+');'})};
 vm.createContext(collector);vm.runInContext(source.slice(0,end),collector,{filename:file});
 const gas={console,Date,Set};vm.createContext(gas);vm.runInContext(fs.readFileSync(options.gasSource||path.join(root,'backend/mf-image-collector.gs'),'utf8'),gas);
 // A snapshot-only adapter: applying Master data or reading live services is impossible here.
 const headers=Object.keys(masterRows[0]),values=[headers,...masterRows.map(r=>headers.map(h=>r[h]??''))];
 gas.mfImageCollectorOpenSpreadsheet_=()=>({getSheetByName:()=>({getDataRange:()=>({getValues:()=>values.map(r=>r.slice())})})});
 return {collector,gas,masterSnapshot:{values,headers}};
};
