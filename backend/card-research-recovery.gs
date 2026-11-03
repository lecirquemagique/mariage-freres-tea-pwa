/* Administrator-only complete_card recovery. Local implementation; not deployed.
 * No parent-row or Master writer. Existing A:S queue schema and v87 persistence contract.
 */
function mfImageCollectorRecoveryAdmin_(payload) {
  var props = PropertiesService.getScriptProperties(), secret = props.getProperty('MF_CARD_RECOVERY_ADMIN_SECRET');
  var actor = props.getProperty('MF_CARD_RECOVERY_ADMIN_NAME');
  if (!secret || !actor || secret === props.getProperty(MF_IMAGE_COLLECTOR_SECRET_PROPERTY) ||
      payload.admin_secret !== secret || payload.approved !== true) throw new Error('recovery_admin_approval_required');
  if (typeof payload.parent_request_id !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(payload.parent_request_id) ||
      typeof payload.operation_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(payload.operation_id)) throw new Error('recovery_parent_and_operation_required');
  return actor;
}

function mfImageCollectorRecoveryHash_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, mfImageCollectorCardResearchStable_(value), Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function mfImageCollectorRecoveryQueue_(ss) {
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_TARGET_QUEUE_SHEET_NAME);
  if (!sheet) throw new Error('recovery_queue_missing');
  var values = sheet.getDataRange().getValues(), headers = values[0].map(String);
  MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS.concat(MF_RESEARCH_QUEUE_EXTRA_HEADERS).forEach(function(h,i) {
    if (headers[i] !== h || headers.lastIndexOf(h) !== i) throw new Error('recovery_queue_schema_mismatch');
  });
  return {sheet:sheet,values:values,headers:headers};
}

function mfImageCollectorRecoveryParent_(ss, payload) {
  var c = mfImageCollectorCardResearchContext_(ss, payload.parent_request_id), result;
  ['version_key','primary_reference','tea_reference'].forEach(function(k) {
    if (!payload[k] || payload[k] !== c.request[k]) throw new Error('recovery_parent_identity_mismatch: ' + k);
  });
  try { result = JSON.parse(c.request.message); } catch(e) { throw new Error('recovery_parent_failure_unverifiable'); }
  if (c.request.status !== 'completed' || c.request.result_status !== 'review_only' || result.mode !== 'review_only' ||
      result.version_key !== c.request.version_key || !Array.isArray(result.proposed) || result.proposed.length) throw new Error('recovery_parent_failure_unverifiable');
  var q = mfImageCollectorRecoveryQueue_(ss), cells = q.values[c.row-1].map(function(v) {
    return Object.prototype.toString.call(v) === '[object Date]' ? {date:v.toISOString()} : v == null ? '' : v;
  });
  c.parent_snapshot = {row:c.row,headers:q.headers,values:cells};
  return c;
}

function mfImageCollectorRecoveryTarget_(parent) {
  var target = {};
  ['VersionKey','Primary Reference','Tリファレンス番号','現在の公式名','銘柄名（黒い本）','現在のカテゴリ','産地・国']
    .concat(MF_CARD_RESEARCH_FIELDS).forEach(function(k) { target[k] = String(parent.target[k] || ''); });
  return target;
}

function mfImageCollectorRecoveryReviews_(ss, versionKey, fields, ownId, parentId) {
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_REVIEW_SHEET_NAME);
  if (!sheet) throw new Error('recovery_review_sheet_missing');
  var values = sheet.getDataRange().getValues(), headers = values[0].map(String);
  values.slice(1).forEach(function(values) {
    var r = mfImageCollectorReviewObject_(headers,values), info;
    try { info = JSON.parse(r['公式情報JSON'] || '{}'); } catch(e) { info = {}; }
    if (info.card_research && info.card_research.request_id === ownId && ownId) return;
    var field = r['対象列'] || (r['検出種別'] === 'official_description_translation' ? '現在の公式説明' : '');
    if ((r['対象VersionKey'] === versionKey || r['DB既存VersionKey'] === versionKey || info.card_research && info.card_research.version_key === versionKey) && fields.indexOf(field) >= 0 ||
        info.card_research && info.card_research.request_id === parentId) throw new Error('recovery_existing_review_requires_reconciliation');
  });
}

function mfImageCollectorRecoveryOperationKey_(payload) {
  return 'MF_CARD_RECOVERY_OP_' + mfImageCollectorRecoveryHash_([payload.parent_request_id,payload.operation_id]);
}

function mfImageCollectorRecoveryContext_(ss, payload) {
  var q = mfImageCollectorRecoveryQueue_(ss), matches = [];
  q.values.slice(1).forEach(function(r,i) { if (r[0] === payload.request_id) matches.push({r:r,row:i+2}); });
  if (matches.length !== 1) throw new Error('recovery_request_missing_or_duplicated');
  var request = {};q.headers.forEach(function(h,i) { request[h] = String(matches[0].r[i] == null ? '' : matches[0].r[i]); });
  var meta;try { meta = JSON.parse(request.message).recovery; } catch(e) { throw new Error('recovery_metadata_missing'); }
  if (request.request_type !== 'complete_card_recovery' || request.source !== 'Human' || !meta ||
      meta.recovery_request_id !== request.request_id || meta.parent_request_id !== payload.parent_request_id ||
      meta.operation_id !== payload.operation_id || meta.approved_by_admin !== true || !meta.approved_by || !meta.approved_at ||
      request.request_id === meta.parent_request_id) throw new Error('recovery_metadata_mismatch');
  var stored = PropertiesService.getScriptProperties().getProperty(mfImageCollectorRecoveryOperationKey_(payload)), ledger;
  try { ledger = JSON.parse(stored); } catch(e) { throw new Error('recovery_approval_ledger_missing'); }
  if (!ledger || ledger.request_id !== request.request_id || ledger.metadata_hash !== mfImageCollectorRecoveryHash_(meta)) throw new Error('recovery_approval_ledger_mismatch');
  var parent = mfImageCollectorRecoveryParent_(ss,payload);
  if (parent.row !== meta.parent_queue_row || mfImageCollectorRecoveryHash_(parent.parent_snapshot) !== meta.parent_snapshot_hash) throw new Error('recovery_parent_history_changed');
  if (mfImageCollectorRecoveryHash_(mfImageCollectorRecoveryTarget_(parent)) !== meta.target_snapshot_hash) throw new Error('recovery_target_changed');
  var fields;try { fields = JSON.parse(request.missing_fields); } catch(e) { throw new Error('recovery_scope_changed'); }
  if (mfImageCollectorCardResearchStable_(fields) !== mfImageCollectorCardResearchStable_(meta.target_columns) ||
      fields.some(function(f) { return parent.effective.indexOf(f) < 0; })) throw new Error('recovery_scope_changed');
  ['version_key','primary_reference','tea_reference'].forEach(function(k) { if (request[k] !== parent.request[k]) throw new Error('recovery_child_identity_mismatch'); });
  mfImageCollectorRecoveryReviews_(ss,request.version_key,fields,request.request_id,parent.request.request_id);
  return {queue:q.sheet,row:matches[0].row,request:request,target:parent.target,fields:fields,effective:fields,
    vocabulary:parent.vocabulary,recovery:meta};
}

function mfImageCollectorRecoveryRequestView_(c) {
  return {request_id:c.request.request_id,request_type:'complete_card_recovery',source:'Human',version_key:c.request.version_key,
    primary_reference:c.request.primary_reference,tea_reference:c.request.tea_reference,target_name:c.request.target_name,
    missing_fields:c.fields,effective_missing_fields:c.effective,target:c.target,vocabulary:c.vocabulary,recovery:c.recovery};
}

function mfImageCollectorCreateRecovery_(payload) {
  var actor = mfImageCollectorRecoveryAdmin_(payload), lock = LockService.getScriptLock();lock.waitLock(10000);
  try {
    var ss = mfImageCollectorOpenSpreadsheet_(), parent = mfImageCollectorRecoveryParent_(ss,payload), fields = payload.target_columns;
    if (!Array.isArray(fields) || !fields.length || new Set(fields).size !== fields.length || fields.some(function(f) {
      return parent.fields.indexOf(f) < 0 || f !== '現在の公式説明' && !mfImageCollectorStructuredFactAllowedColumns_()[f] && MF_CARD_RESEARCH_EXTRA_REVIEW_FIELDS.indexOf(f) < 0;
    })) throw new Error('recovery_target_columns_invalid_or_filled');
    var reason = String(payload.recovery_reason || '').trim();if (!reason || reason.length > 500 || /^\s*=/.test(reason)) throw new Error('recovery_reason_required');
    var props = PropertiesService.getScriptProperties(), key = mfImageCollectorRecoveryOperationKey_(payload), prior = props.getProperty(key);
    if (prior) {
      var entry = JSON.parse(prior), current = mfImageCollectorRecoveryQueue_(ss), rows = current.values.slice(1).filter(function(r) {return r[0] === entry.request_id;});
      if (rows.length !== 1) throw new Error('recovery_operation_requires_reconciliation');
      var existing = {};current.headers.forEach(function(h,i){existing[h]=String(rows[0][i] == null ? '' : rows[0][i]);});
      var previous = JSON.parse(existing.message).recovery;
      if (!previous || existing.request_type !== 'complete_card_recovery' || existing.source !== 'Human' ||
          previous.parent_request_id !== payload.parent_request_id || previous.operation_id !== payload.operation_id ||
          entry.metadata_hash !== mfImageCollectorRecoveryHash_(previous)) throw new Error('recovery_approval_ledger_mismatch');
      if (mfImageCollectorCardResearchStable_(fields) !== mfImageCollectorCardResearchStable_(previous.target_columns)) throw new Error('recovery_operation_scope_changed');
      // Idempotent lookup returns history even after later human Master updates; worker revalidation remains mandatory.
      return {ok:true,status:'already_exists',recovery_request_id:entry.request_id,parent_request_id:payload.parent_request_id,writePerformed:false,requires_revalidation:true};
    }
    if (fields.some(function(f) {return parent.effective.indexOf(f)<0;})) throw new Error('recovery_target_columns_invalid_or_filled');
    // An injected/manual recovery row without its approval ledger cannot be adopted or duplicated.
    var q = mfImageCollectorRecoveryQueue_(ss);
    q.values.slice(1).forEach(function(r) {if (r[q.headers.indexOf('request_type')] !== 'complete_card_recovery') return;var m;
      try { m = JSON.parse(r[q.headers.indexOf('message')]).recovery; } catch(e) { throw new Error('recovery_history_unverifiable'); }
      if (!m || m.parent_request_id === payload.parent_request_id && m.operation_id === payload.operation_id) throw new Error('recovery_operation_requires_reconciliation');
      if (m.parent_request_id === payload.parent_request_id && r[q.headers.indexOf('status')] !== 'completed') throw new Error('recovery_parent_has_active_recovery');
    });
    mfImageCollectorRecoveryReviews_(ss,parent.request.version_key,fields,null,parent.request.request_id);
    var now = new Date().toISOString(), target = mfImageCollectorRecoveryTarget_(parent), meta = {
      recovery_request_id:null,parent_request_id:payload.parent_request_id,parent_queue_row:parent.row,
      version_key:parent.request.version_key,primary_reference:parent.request.primary_reference,tea_reference:parent.request.tea_reference,
      target_name:parent.target['現在の公式名'] || parent.target['銘柄名（黒い本）'],recovery_reason:reason,
      approved_by_admin:true,approved_by:actor,approved_at:now,created_at:now,operation_id:payload.operation_id,source:'Human',
      target_columns:fields.slice(),target_values:target,target_snapshot_hash:mfImageCollectorRecoveryHash_(target),
      parent_snapshot:parent.parent_snapshot,parent_snapshot_hash:mfImageCollectorRecoveryHash_(parent.parent_snapshot)};
    if (payload.expected_target_hash !== undefined && payload.expected_target_hash !== meta.target_snapshot_hash) throw new Error('recovery_target_changed');
    var preview = {request_id:'recovery-preview',target_name:meta.target_name,version_key:meta.version_key,primary_reference:meta.primary_reference,tea_reference:meta.tea_reference};
    var c = {request:preview,target:parent.target,fields:fields,effective:fields,vocabulary:parent.vocabulary,recovery:meta};
    if (payload.apply !== true || payload.dryRun === true) return {ok:true,status:'recovery_preview',recovery_request_id:null,parent_request_id:payload.parent_request_id,
      request:mfImageCollectorRecoveryRequestView_(c),writePerformed:false};
    if (payload.expected_target_hash !== meta.target_snapshot_hash) throw new Error('recovery_preview_hash_required');
    var id = Utilities.getUuid();
    if (id === parent.request.request_id || q.values.slice(1).some(function(r) {return r[0] === id;})) throw new Error('recovery_new_id_collision');
    meta.recovery_request_id = id;
    var values = {request_id:id,created_at:now,target_name:meta.target_name,target_ref:meta.tea_reference,target_url:parent.target['公式商品ページURL'] || '',
      status:'pending',message:JSON.stringify({recovery:meta}),version_key:meta.version_key,primary_reference:meta.primary_reference,tea_reference:meta.tea_reference,
      request_type:'complete_card_recovery',source:'Human',requested_at:now,missing_fields:JSON.stringify(fields)};
    var headers = MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS.concat(MF_RESEARCH_QUEUE_EXTRA_HEADERS), cells = headers.map(function(h) { return values[h] || ''; });
    if (cells.some(function(v) { return /^\s*=/.test(v) || String(v).length > 45000; })) throw new Error('recovery_unsafe_queue_value');
    // Save ownership first. Unknown append outcome must be reconciled, never create a second UUID.
    props.setProperty(key,JSON.stringify({request_id:id,metadata_hash:mfImageCollectorRecoveryHash_(meta)}));
    var row = q.sheet.getLastRow()+1;q.sheet.getRange(row,1,1,cells.length).setValues([cells]);SpreadsheetApp.flush();
    if (mfImageCollectorCardResearchStable_(q.sheet.getRange(row,1,1,cells.length).getValues()[0]) !== mfImageCollectorCardResearchStable_(cells)) throw new Error('recovery_request_persistence_failed');
    return {ok:true,status:'recovery_created',recovery_request_id:id,parent_request_id:payload.parent_request_id,queue_row:row,writePerformed:true};
  } finally {lock.releaseLock();}
}

function mfImageCollectorRecoveryApi_(payload) {
  mfImageCollectorRecoveryAdmin_(payload);
  if (payload.action === 'createCardResearchRecoveryRequest') return mfImageCollectorCreateRecovery_(payload);
  var actions = {claimCardResearchRecoveryRequest:'claimCardResearchRequest',recordCardResearchRecoveryCandidate:'recordCardResearchCandidate',completeCardResearchRecoveryRequest:'completeCardResearchRequest'};
  if (!actions[payload.action]) throw new Error('recovery_action_invalid');
  if (payload.dryRun !== false) {
    var lock = LockService.getScriptLock();lock.waitLock(10000);
    try {var c = mfImageCollectorRecoveryContext_(mfImageCollectorOpenSpreadsheet_(),payload);
      return {ok:true,status:'preview',request:mfImageCollectorRecoveryRequestView_(c),writePerformed:false};
    } finally {lock.releaseLock();}
  }
  return mfImageCollectorCardResearchWorker_(Object.assign({},payload,{action:actions[payload.action]}),true);
}
