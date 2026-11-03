'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {setup}=require('./complete-card-queue.test.js');
const PARENT='76c49d5c-9fd2-4385-9ab4-34a9dc6116cd',FIELDS=['現在の公式説明','香味詳細タグ','香味大分類'];
function setupRecovery(){
 const x=setup();vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend/card-research-recovery.gs'),'utf8'),x.ctx);
 x.props.set('MF_CARD_RECOVERY_ADMIN_SECRET','admin-fixture-secret');x.props.set('MF_CARD_RECOVERY_ADMIN_NAME','Fixture Administrator');x.props.set('MF_COLLECTOR_WRITE_SECRET','fixture-secret');
 const values={VersionKey:'T425-B01','Primary Reference':'T425','Tリファレンス番号':'T425','銘柄名（黒い本）':'HOJICHA','現在の公式名':'HOJICHA'};
 for(const[h,v]of Object.entries(values))x.master[1][x.headers.indexOf(h)]=v;for(const f of FIELDS)x.master[1][x.headers.indexOf(f)]='';
 const row=x.queue[168];x.queue[168]=[];while(x.queue.length<211)x.queue.push([]);x.queue[210]=row;
 const missing=[...FIELDS,'産地・地域／茶園','水出し用ブレンド','アイスティー推奨','ミルクティー推奨','テインフリー'];
 const result={mode:'review_only',version_key:'T425-B01',proposed:[],unresolved:missing.map(field=>({field,reason:'no_official_evidence'}))};
 for(const[h,v]of Object.entries({request_id:PARENT,target_ref:'T425',target_name:'HOJICHA',version_key:'T425-B01',primary_reference:'T425',tea_reference:'T425',status:'completed',result_status:'review_only',message:JSON.stringify(result),missing_fields:JSON.stringify(missing),completed_at:'2026-11-03T06:38:47.190Z'}))row[x.qh.indexOf(h)]=v;
 const queue=x.sheets['銘柄指定調査キュー'],range=queue.getRange;queue.getRange=(...args)=>{const r=range(...args);return{...r,setValues(values){while(x.queue.length<args[0])x.queue.push([]);return r.setValues(values);}};};
 const common={admin_secret:'admin-fixture-secret',approved:true,parent_request_id:PARENT,operation_id:'fixture-recovery-1',version_key:'T425-B01',primary_reference:'T425',tea_reference:'T425'};
 const api=p=>JSON.parse(JSON.stringify(x.ctx.mfImageCollectorRecoveryApi_({...common,...p})));
 const input={action:'createCardResearchRecoveryRequest',target_columns:FIELDS,recovery_reason:'Repair missing HOJICHA Review persistence'};
 const preview=extra=>api({...input,...extra});
 const create=extra=>{const p=preview();return api({...input,apply:true,expected_target_hash:p.request?.recovery.target_snapshot_hash,...extra});};
 const claim=(id,extra={})=>api({action:'claimCardResearchRecoveryRequest',request_id:id,dryRun:false,...extra});
 const candidates=FIELDS.map((f,i)=>({target_column:f,current_value:'',suggested_value:['翻訳レビュー候補','キャラメル','甘香・菓子'][i],
  official_name:'HOJICHA',verified_references:['T425'],evidence_url:'https://www.mariagefreres.com/fr/hojicha-t425-thes-au-poids.html',
  evidence_text:'[FR] REF T425 HOJICHA caramel. [EN] REF T425 HOJICHA.',evidence_language:'FR',
  language_evidence:[{evidence_language:'FR',name:'HOJICHA',acquisition_method:'cdp_existing_dom'}]}));
 const own=(request,action,extra={})=>({action,request_id:request.request_id,claim_token:request.claim_token,expected_candidates:candidates,dryRun:false,...extra});
 const record=(r,i)=>api(own(r,'recordCardResearchRecoveryCandidate',{candidate:candidates[i]}));
 const complete=(r,extra)=>api(own(r,'completeCardResearchRecoveryRequest',extra));
 return{x,common,input,api,preview,create,claim,candidates,own,record,complete,parent:PARENT,fields:FIELDS};
}
module.exports={setupRecovery,PARENT,FIELDS};
