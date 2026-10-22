(function(root){
  'use strict';
  function payload(row) {
    if(!row || typeof row.VersionKey!=='string' || !row.VersionKey.trim()) throw new Error('対象VersionKeyがありません。');
    return {action:'requestResearch',versionKey:row.VersionKey,primaryReference:String(row['Primary Reference']||''),
      teaReference:String(row['Tリファレンス番号']||''),displayName:String(row['現在の公式名']||row['銘柄名（黒い本）']||''),
      requestType:'complete_card',requestedAt:new Date().toISOString()};
  }
  function errorMessage(status,reason) {
    const messages={reference_mismatch:'REFが登録情報と一致しません。',invalid_version:'対象Versionが見つかりません。',
      conflict:'対象Versionまたは受付情報が一致しません。',disabled:'現在、調査依頼の受付は停止中です。',
      error:'調査依頼を登録できませんでした。時間をおいて再試行してください。',
      invalid_request_type:'調査依頼の種類が不正です。',schema_required:'受付の準備が整っていません。',busy:'受付が混み合っています。再試行してください。'};
    return messages[reason]||messages[status]||messages.error;
  }
  function feedback(result) {
    if(result.status==='recently_completed')return {kind:'recent',label:result.reason==='completion_history_unverifiable'?'完了履歴の確認が必要':'最近調査済み',
      message:result.reason==='completion_history_unverifiable'?'過去の調査完了日時を確認できないため、再調査を受け付けられません。':'この銘柄は最近調査済みです',nextEligibleAt:result.nextEligibleAt||null};
    return {kind:result.status==='dry_run'?'dry_run':'done',message:{queued:'調査依頼を登録しました',already_queued:'この銘柄はすでに調査待ちです',
      requeued_after_expiry:'再調査依頼を登録しました',dry_run:'受付内容を検証しました。キューには書き込んでいません。'}[result.status]||errorMessage('error')};
  }
  async function send(row,config,fetcher=fetch) {
    const body=payload(row);
    if(config.RESEARCH_API_ENABLED===false) throw new Error(errorMessage('disabled'));
    let endpoint;
    try{endpoint=new URL(config.GAS_API_URL);}catch(_){throw new Error('受付URLが設定されていません。');}
    if(endpoint.protocol!=='https:' && !(endpoint.protocol==='http:'&&['localhost','127.0.0.1'].includes(endpoint.hostname)))throw new Error('受付URLが不正です。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetcher(endpoint.href,{method:'POST',mode:'cors',credentials:'omit',redirect:'follow',
        headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(config.RESEARCH_DRY_RUN===true?{...body,dryRun:true}:body),signal:controller.signal});
      if(!response.ok)throw new Error('受付サーバーとの通信に失敗しました。');
      const result=await response.json();
      if(!result.ok || !['queued','already_queued','recently_completed','requeued_after_expiry','dry_run'].includes(result.status)){
        throw new Error(errorMessage(result.status,result.reason));
      }
      if(result.versionKey!==row.VersionKey)throw new Error('受付結果のVersionKeyが一致しません。');
      return result;
    }catch(e){if(e.name==='AbortError'||e.name==='TimeoutError'||e instanceof TypeError)throw new Error('通信に失敗しました。接続を確認して再試行してください。');if(e instanceof SyntaxError)throw new Error('受付結果を読み取れませんでした。再試行してください。');throw e;}
    finally{clearTimeout(timer);}
  }
  const api={payload,send,errorMessage,feedback};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.MFResearchRequest=api;
})(typeof globalThis!=='undefined'?globalThis:this);
