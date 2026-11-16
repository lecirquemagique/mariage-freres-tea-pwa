// Test-only excerpt from production v92 master-audit.gs. Do not deploy.
// Original source SHA-256: 5c0a101b9ae82aa9b8771d348779568105c2cc46258482cbb37d90a0110394fb
function mfMasterAuditApply_(input, options) {
  options=options||{};
  var lock=LockService.getScriptLock(),held=false,submitted=false;
  try {
    if(!lock.tryLock(10000))return {ok:false,status:'busy',writePerformed:false};held=true;
    var props=PropertiesService.getScriptProperties(),pending=props.getProperty('MF_MASTER_AUDIT_PENDING');
    if(pending && pending!==(input&&input.operationId))return {ok:false,status:'recovery_required',writePerformed:false,operationId:pending,requiresHumanReview:true};
    var snapshot=mfMasterAuditRead_(),timestamp=new Date().toISOString(),plan=mfMasterAuditPlan_(input,snapshot,timestamp);
    if(plan.status==='already_applied'){
      if(pending && options.dryRun===false)props.deleteProperty('MF_MASTER_AUDIT_PENDING');
      return {ok:true,status:'already_applied',writePerformed:false,classificationChanges:plan.classificationChanges};
    }
    if(pending)return {ok:false,status:'outcome_unknown',writePerformed:null,operationId:pending,requiresHumanReview:true};
    if(options.dryRun!==false)return {ok:true,status:'dry_run',writePerformed:false,plan:plan};
    mfMasterAuditAssert_(plan.schemaReady,'audit_schema_required');
    mfMasterAuditAssert_(props.getProperty('MF_MASTER_AUDIT_WRITE_ENABLED')==='true','audit_write_disabled');
    // Durable barrier survives a script timeout. Uncertain operations block further commits.
    props.setProperty('MF_MASTER_AUDIT_PENDING',input.operationId);
    submitted=true;
    try{mfMasterAuditCommit_(snapshot,plan.requests);}catch(commitError){/* Read both sides; never blindly resubmit. */}
    var after=mfMasterAuditRead_(),verification=mfMasterAuditPlan_(input,after,timestamp);
    if(verification.status==='already_applied'){
      props.deleteProperty('MF_MASTER_AUDIT_PENDING');
      return {ok:true,status:'applied',writePerformed:true,masterCells:plan.masterCells,auditRows:plan.auditRowCount,classificationChanges:plan.classificationChanges};
    }
    // A timeout can still complete later: absence on first reread is NOT proof of failure.
    return {ok:false,status:'outcome_unknown',writePerformed:null,operationId:input.operationId,requiresHumanReview:true};
  }catch(error){var unresolved=submitted||!!pending;return {ok:false,status:unresolved?'recovery_required':'rejected',reason:String(error.message||error),writePerformed:unresolved?null:false,operationId:input&&input.operationId,requiresHumanReview:unresolved};}
  finally{if(held)lock.releaseLock();}
}
