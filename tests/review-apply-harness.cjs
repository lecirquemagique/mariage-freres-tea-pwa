'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
module.exports=function setup(options={}){
 const props=new Map(),writes=[],trace=[];let held=false;
 const c={Set,Date,JSON};vm.createContext(c);vm.runInContext(fs.readFileSync(process.env.MF_GAS_TEST_SOURCE||path.join(__dirname,'../backend/mf-image-collector.gs'),'utf8'),c);
 c.Utilities={DigestAlgorithm:{SHA_1:'sha1'},Charset:{UTF_8:'utf8'},computeDigest:(_a,s)=>[...crypto.createHash('sha1').update(s).digest()],newBlob:s=>({getBytes:()=>[...Buffer.from(s)]}),formatDate:()=> '2026-11-04'};
 c.Session={getScriptTimeZone:()=> 'Asia/Tokyo'};
 c.LockService={getScriptLock:()=>({tryLock:()=>{if(held||options.busy)return false;held=true;hooks.lock?.();return true;},releaseLock:()=>{held=false;}})};
 c.PropertiesService={getScriptProperties:()=>({getProperty:k=>{hooks.getProperty?.(k);return hooks.propertyRead?hooks.propertyRead(k,props.get(k)||null):props.get(k)||null;},getProperties:()=>Object.fromEntries(props),deleteProperty:k=>{hooks.deleteProperty?.(k);props.delete(k);},setProperty:(k,v)=>{if(options.propertyFailure)throw Error('property unavailable');hooks.beforeProperty?.(k,v);props.set(k,v);hooks.afterProperty?.(k,v);}})};
 const mh=['VersionKey','Primary Reference','Tリファレンス番号','現在の公式名','現在の公式説明','香味詳細タグ','香味大分類','公式商品ページURL','産地・国'];
 const master=options.master||[mh,['T425-B01','T425','T425','HOJICHA','','','','https://www.mariagefreres.com/fr/hojicha-t425-thes-au-poids.html','']];
 const rh=Array.from(c.MF_IMAGE_COLLECTOR_REVIEW_HEADERS);
 function review(row,type,column,current,suggested){return {'検出ID':'fixture-'+row,'検出日時':'2026-11-03','検出種別':type,'ステータス':'承認','人間判定':'既存銘柄を更新','対象VersionKey':'T425-B01','Tリファレンス番号':'T425','DB既存VersionKey':'T425-B01','DB既存T':'T425','公式名':'HOJICHA','公式URL':master[1][7],'対象列':column,'現在値':current,'候補値':suggested,'根拠原文':'caroube chocolatée; fragrance vanillée; caramel; voile boisé','根拠言語':'FR','根拠URL':master[1][7],'Collectorが取得した根拠':'Official FR/EN evidence fixture','公式情報JSON':JSON.stringify({primary_reference:'T425',reference_resolution:{mode:'existing_primary'},card_research:{request_id:'fixture-child',correction:{operation_id:'fixture-correction'}}}),'source_type':'description','confidence':'high','承認済み日本語説明':type==='official_description_translation'?'人間が承認した日本語説明。':''};}
 const grid=Array.from({length:620},()=>rh.map(()=>''));grid[0]=rh.slice();
 const values=[review(616,'official_description_translation','現在の公式説明','','翻訳レビュー候補'),review(617,'structured_fact','香味詳細タグ','','キャラメル'),review(618,'structured_fact','香味大分類','','甘香・菓子'),review(619,'structured_fact','香味詳細タグ','','チョコレート、ヴァニラ、キャラメル、木質'),review(620,'structured_fact','香味大分類','','スパイス、甘香・菓子、カカオ、キャラメル、ウッディ')];
 values[1]['ステータス']=values[2]['ステータス']='却下';values[1]['人間判定']=values[2]['人間判定']='却下';values.forEach((r,i)=>{grid[615+i]=rh.map(h=>r[h]??'');});
 const hooks={};
 function sheet(name,data,id){return {getParent:()=>({getId:()=>"fixture-master"}),getName:()=>name,getSheetId:()=>id,getLastColumn:()=>data[0].length,getLastRow:()=>data.length,getMaxRows:()=>data.length+10,getDataRange:()=>({getValues:()=>{trace.push({op:'readAll',name});const out=data.map(r=>r.slice());return hooks.readAll?.(name,out)||out;}}),getRange:(r,col,n=1,w=1)=>({getValues:()=>{trace.push({op:'read',name,r,col});const out=Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>data[r-1+i]?.[col-1+j]??''));return hooks.read?.({name,r,col,out})||out;},getValue:()=>data[r-1]?.[col-1]??'',setValue:v=>{if(!held)throw Error('write without lock');const op={name,r,col,value:v};hooks.beforeWrite?.(op);writes.push(op);if(!hooks.drop?.(op)){data[r-1]??=[];data[r-1][col-1]=v;}hooks.afterWrite?.(op);return null;},setValues:rows=>{if(!held)throw Error('write without lock');rows.forEach((row,i)=>row.forEach((v,j)=>{const op={name,r:r+i,col:col+j,value:v};hooks.beforeWrite?.(op);writes.push(op);if(!hooks.drop?.(op)){data[r-1+i]??=[];data[r-1+i][col-1+j]=v;}hooks.afterWrite?.(op);}));}})};}
 const ms=sheet('銘柄マスター',master,1),rs=sheet('変更候補レビュー',grid,2),ss={getSheetByName:n=>n==='銘柄マスター'?ms:rs,getActiveSheet:()=>rs};
 c.SpreadsheetApp={flush:()=>{trace.push({op:'flush'});hooks.flush?.();},getActiveSpreadsheet:()=>ss,getActiveRangeList:()=>({getRanges:()=>[{getRow:()=>616,getNumRows:()=>5}]}),getUi:()=>({ButtonSet:{YES_NO:'YES_NO',OK:'OK'},Button:{YES:'YES'},alert:(title,text)=>{hooks.alert?.(title,text);return 'YES';}})};
 c.mfImageCollectorOpenSpreadsheet_=()=>ss;c.mfImageCollectorGetOrCreateReviewSheet_=()=>rs;
 c.mfImageCollectorRefreshDependentReviews_=()=>({errors:[]});
 const get=(row,h)=>grid[row-1][rh.indexOf(h)],set=(row,h,v)=>{grid[row-1][rh.indexOf(h)]=v;};
 const apply=(row=616)=>c.mfImageCollectorApplyReviewDecision(row,get(row,'人間判定'),get(row,'対象VersionKey'),get(row,'コメント'),get(row,'承認済み日本語説明'));
 return {c,master,grid,mh,rh,ms,rs,get,set,apply,props,writes,trace,hooks};
};
