/* Administrator-only Review corrections. POST integration requires the documented narrow dispatch.
 * Appends new Reviews only. Never modifies a Master, queue, or original Review cell.
 */
function mfImageCollectorCardCorrectionApi_(payload) {
  if (['previewCardResearchCorrection','createCardResearchCorrections','recordCardResearchCorrections'].indexOf(payload.action) < 0) {
    throw new Error('correction_action_not_allowed');
  }
  // Preview can never write, including when a caller accidentally supplies apply=true.
  var input = Object.assign({}, payload);
  if (input.action === 'previewCardResearchCorrection') { input.apply = false; input.dryRun = true; }
  return mfImageCollectorCardCorrectionApply_(input);
}

function mfImageCollectorCardCorrectionPlan_(ss, payload, actor) {
  var parent = mfImageCollectorRecoveryParent_(ss, payload);
  var q = mfImageCollectorRecoveryQueue_(ss), children = q.values.slice(1).filter(function(r) {
    return r[0] === payload.recovery_request_id;
  });
  if (children.length !== 1) throw new Error('correction_child_missing_or_duplicate');
  var child = {}; q.headers.forEach(function(h,i) { child[h] = children[0][i]; });
  var message = JSON.parse(child.message), recovery = message.recovery, result = message.recovery_result;
  if (child.status !== 'completed' || child.request_type !== 'complete_card_recovery' || child.source !== 'Human' ||
      !recovery || recovery.recovery_request_id !== child.request_id || recovery.parent_request_id !== payload.parent_request_id ||
      recovery.approved_by_admin !== true || !recovery.approved_by || !recovery.approved_at || !result || result.verified !== true ||
      !Number.isInteger(result.expected) || result.expected < 1 || result.expected !== result.persisted ||
      !Array.isArray(message.proposed) || message.proposed.length !== result.expected ||
      !Array.isArray(result.persisted_review_ids) || result.persisted_review_ids.length !== result.expected ||
      new Set(result.persisted_review_ids).size !== result.expected) throw new Error('correction_child_unverified');
  ['version_key','primary_reference','tea_reference'].forEach(function(k) {
    if (child[k] !== parent.request[k]) throw new Error('correction_child_identity_mismatch');
  });
  if (recovery.parent_snapshot_hash !== mfImageCollectorRecoveryHash_(parent.parent_snapshot)) throw new Error('correction_parent_changed');
  if (recovery.target_snapshot_hash !== mfImageCollectorRecoveryHash_(mfImageCollectorRecoveryTarget_(parent))) throw new Error('correction_master_changed');
  if (!Array.isArray(payload.corrections) || !payload.corrections.length || payload.corrections.length > 2) throw new Error('correction_scope_required');
  var reason = String(payload.correction_reason || '').trim(), rule = String(payload.corrected_by_rule_version || '').trim();
  if (!reason || reason.length > 500 || !/^[A-Za-z0-9._-]{1,100}$/.test(rule)) throw new Error('correction_reason_and_rule_required');
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_REVIEW_SHEET_NAME), values = sheet.getDataRange().getValues();
  var headers = values[0].map(String), rows = values.slice(1).map(function(r,i) {
    return {row:mfImageCollectorReviewObject_(headers,r), n:i+2};
  }), seen = {};
  var items = payload.corrections.map(function(input) {
    var matches = rows.filter(function(r) { return r.row['検出ID'] === input.original_detection_id; });
    if (matches.length !== 1 || matches[0].n !== input.original_review_row || seen[input.original_detection_id]) throw new Error('correction_original_missing_or_duplicate');
    seen[input.original_detection_id] = true;
    var original = matches[0].row, receipt = mfImageCollectorCardResearchReceipt_(original,matches[0].n);
    var meta = JSON.parse(original['公式情報JSON']).card_research;
    var proposal = message.proposed.filter(function(p) { return p.detection_id === receipt.detection_id && p.fingerprint === receipt.fingerprint && p.verified === true; });
    if (receipt.fingerprint !== input.expected_original_fingerprint || receipt.request_id !== child.request_id || proposal.length !== 1 ||
        result.persisted_review_ids.indexOf(receipt.detection_id) < 0 || proposal[0].review_row !== matches[0].n || proposal[0].field !== receipt.field ||
        receipt.version_key !== child.version_key || receipt.primary_reference !== child.primary_reference || receipt.tea_reference !== child.tea_reference ||
        !meta.recovery || mfImageCollectorRecoveryHash_(meta.recovery) !== mfImageCollectorRecoveryHash_(recovery)) throw new Error('correction_original_verification_failed');
    if (original['ステータス'] === '反映済み') throw new Error('correction_original_already_applied');
    var field = receipt.field;
    if (['香味詳細タグ','香味大分類'].indexOf(field) < 0 || receipt.detection_type !== 'structured_fact' || input.candidate.target_column !== field) throw new Error('correction_field_not_allowed');
    var c = {request:parent.request,target:parent.target,effective:[field]};
    // Reuse all ordinary evidence, exact target, canonicalization and union checks.
    var built = mfImageCollectorCardResearchBuildReview_(c,input.candidate), row = built.row;
    if (row['候補値'] === original['候補値']) throw new Error('correction_has_no_value_change');
    var info = JSON.parse(row['公式情報JSON']);
    var correction = {supersedes_detection_id:receipt.detection_id,original_review_row:matches[0].n,
      original_fingerprint:receipt.fingerprint,correction_reason:reason,corrected_by_rule_version:rule,
      correction_source:'admin_review_correction',approved_by:actor,
      original_recovery_child_id:child.request_id,parent_request_id:payload.parent_request_id};
    // Stable identity excludes timestamps and operation IDs: retries cannot fork a correction.
    var key = mfImageCollectorRecoveryHash_([correction,mfImageCollectorCardResearchStoredContent_(row)]);
    info.card_research.request_id = 'correction-' + key;
    info.card_research.correction = correction;
    row['公式情報JSON'] = JSON.stringify(info);
    row['検出ID'] = 'card-correction-' + key;
    row['差分概要'] = '訂正版Review: ' + receipt.detection_id + ' / ' + field;
    row['Collectorが取得した根拠'] = row['根拠原文'];
    if (Object.keys(row).some(function(k) { return typeof row[k] === 'string' && (/^\s*=/.test(row[k]) || row[k].length > 45000); })) throw new Error('correction_unsafe_cell');
    var expected = mfImageCollectorCardResearchReceipt_(row,0);
    var forks = rows.filter(function(r) {
      var i; try { i = JSON.parse(r.row['公式情報JSON'] || '{}'); } catch(e) { throw new Error('correction_invalid_existing_json'); }
      return i.card_research && i.card_research.correction && i.card_research.correction.supersedes_detection_id === receipt.detection_id;
    });
    if (forks.some(function(r) { return r.row['検出ID'] !== expected.detection_id; })) throw new Error('correction_fork_requires_reconciliation');
    var existing = rows.filter(function(r) { return r.row['検出ID'] === expected.detection_id; });
    if (existing.length > 1) throw new Error('correction_duplicate_detection_id');
    if (existing.length) mfImageCollectorCardResearchReadBack_(sheet,expected);
    return {row:row,expected:expected,supersedes:correction,existing:existing.length === 1};
  });
  return {sheet:sheet,items:items,manifest:mfImageCollectorRecoveryHash_(items.map(function(i) { return i.expected; }))};
}

function mfImageCollectorCardCorrectionApply_(payload) {
  var actor = mfImageCollectorRecoveryAdmin_(payload), lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var plan = mfImageCollectorCardCorrectionPlan_(mfImageCollectorOpenSpreadsheet_(),payload,actor);
    var preview = {ok:true,status:'correction_preview',manifest:plan.manifest,items:plan.items,writePerformed:false};
    if (payload.apply !== true || payload.dryRun === true) return preview;
    if (payload.expected_manifest !== plan.manifest) throw new Error('correction_preview_manifest_required');
    var props = PropertiesService.getScriptProperties(), key = 'MF_CARD_CORRECTION_OP_' + mfImageCollectorRecoveryHash_([payload.parent_request_id,payload.operation_id]);
    var prior = props.getProperty(key);
    if (prior && prior !== plan.manifest) throw new Error('correction_operation_changed');
    // Record intent before append. If the network outcome is unknown, retry this operation only.
    props.setProperty(key,plan.manifest);
    var persisted = [];
    plan.items.forEach(function(item) {
      if (!item.existing) mfImageCollectorAppendReviewRow_(plan.sheet,item.row);
      SpreadsheetApp.flush();
      var receipt = mfImageCollectorCardResearchReadBack_(plan.sheet,item.expected);
      mfImageCollectorApplyReviewRowValidation_(plan.sheet,receipt.review_row);
      persisted.push(receipt);
    });
    // Independent final read verifies the entire manifest before recommending retirement.
    persisted = plan.items.map(function(item) { return mfImageCollectorCardResearchReadBack_(plan.sheet,item.expected); });
    return {ok:true,status:'correction_verified',expected:plan.items.length,persisted:persisted,
      retirement_plan:plan.items.map(function(i) { return {detection_id:i.supersedes.supersedes_detection_id,
        status:'却下',comment:'当時の候補は正常保存。抽出改善による訂正版: ' + i.expected.detection_id}; }),
      original_rows_modified:false,writePerformed:plan.items.some(function(i) {return !i.existing;})};
  } finally { lock.releaseLock(); }
}
