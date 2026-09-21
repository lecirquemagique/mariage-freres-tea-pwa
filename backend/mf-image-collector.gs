/*
 * MARIAGE FRERES image collector writeback helpers.
 *
 * Replace the existing mf-image-collector.gs file with this whole file.
 * Keep exactly one top-level doPost(e); mfImageCollectorDoPost(e) handles
 * collector POST actions internally.
 */

var MF_IMAGE_COLLECTOR_FOLDER_ID = '192M8W9aopop-k0H_xHMJBWkEVy3fK4eX';
var MF_IMAGE_COLLECTOR_SHEET_NAME = '銘柄マスター';
var MF_IMAGE_COLLECTOR_REVIEW_SHEET_NAME = '変更候補レビュー';
var MF_IMAGE_COLLECTOR_TAXONOMY_LOG_SHEET_NAME = '分類変更履歴';
var MF_IMAGE_COLLECTOR_TARGET_QUEUE_SHEET_NAME = '銘柄指定調査キュー';
var MF_IMAGE_COLLECTOR_SECRET_PROPERTY = 'MF_COLLECTOR_WRITE_SECRET';
var MF_IMAGE_COLLECTOR_REVIEW_HEADERS = [
  '検出ID',
  '検出日時',
  'Tリファレンス番号',
  '公式名',
  '検出種別',
  '公式URL',
  '言語',
  'DB既存T',
  'DB既存VersionKey',
  'DB既存名',
  '差分概要',
  'Collectorが取得した根拠',
  'ステータス',
  '確認内容',
  '人間判定',
  '対象VersionKey',
  'コメント',
  '処理日時',
  'FR公式URL',
  'EN公式URL',
  'JP公式URL',
  '確認言語',
  '公式名称差',
  '公式説明抜粋',
  'DB存在確認',
  'DB類似候補',
  'Discovery source',
  '公式情報JSON',
  '対象列',
  '現在値',
  '候補値',
  '承認済み日本語説明',
  '根拠原文',
  '根拠言語',
  '根拠URL',
  'source_type',
  'confidence'
];
var MF_IMAGE_COLLECTOR_REVIEW_STATUSES = ['要確認', '承認', '保留', '却下', '反映済み'];
var MF_IMAGE_COLLECTOR_REVIEW_DECISIONS = [
  '新規銘柄として追加',
  '既存銘柄を更新',
  '既存銘柄の新バージョンとして追加',
  '販売SKUとして追加',
  '既存銘柄と同一',
  '終売情報として更新',
  '誤検出',
  '保留'
];
var MF_IMAGE_COLLECTOR_TAXONOMY_COLUMNS = ['茶種タグ', '現在のカテゴリ', '香味大分類'];
var MF_IMAGE_COLLECTOR_REVIEW_APPLY_STATUSES = ['要確認', '保留'];
var MF_IMAGE_COLLECTOR_REVIEW_FINAL_STATUSES = ['承認', '却下', '反映済み'];
var MF_IMAGE_COLLECTOR_TAXONOMY_LOG_HEADERS = [
  'batch_id',
  'timestamp',
  'status',
  'rollback_at',
  'rollback_status',
  'row_number',
  'VersionKey',
  'Tリファレンス番号',
  '銘柄名',
  'column',
  'before',
  'after',
  'reason'
];
var MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS = [
  'request_id',
  'created_at',
  'target_name',
  'target_ref',
  'target_url',
  'status',
  'started_at',
  'completed_at',
  'result_reference',
  'result_name',
  'result_status',
  'message'
];
var MF_IMAGE_COLLECTOR_TARGET_QUEUE_STATUSES = ['pending', 'processing', 'completed', 'not_found', 'ambiguous', 'error'];

function doPost(e) {
  return mfImageCollectorDoPost(e);
}

function doGet(e) {
  return mfImageCollectorDoGet(e);
}

function onOpen(e) {
  mfImageCollectorOnOpen(e);
}

function mfImageCollectorDoGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var action = String(params.action || 'teaData');
    if (action === 'teaData') {
      return mfImageCollectorJsonOrJsonp_(mfImageCollectorGetTeaData_(), params.callback);
    }
    if (action === 'getTargetDiscoveryRequest') {
      mfImageCollectorAssertSecret_(params);
      return mfImageCollectorJsonOrJsonp_(mfImageCollectorGetTargetDiscoveryRequest_(params), params.callback);
    }
    return mfImageCollectorJsonOrJsonp_({ ok: false, error: 'Unsupported action.' }, params.callback);
  } catch (error) {
    var callback = e && e.parameter ? e.parameter.callback : '';
    return mfImageCollectorJsonOrJsonp_({ ok: false, error: String(error && error.message || error) }, callback);
  }
}

function mfImageCollectorDoPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.action === 'uploadImageResults') {
      return mfImageCollectorJson_(mfImageCollectorUploadImageResults_(payload));
    }
    if (payload.action === 'updateProductPageUrl') {
      return mfImageCollectorJson_(mfImageCollectorUpdateProductPageUrl_(payload));
    }
    if (payload.action === 'updateMasterOfficialInfo') {
      return mfImageCollectorJson_(mfImageCollectorUpdateMasterOfficialInfo_(payload));
    }
    if (payload.action === 'normalizeTeaTypeTags') {
      return mfImageCollectorJson_(mfImageCollectorNormalizeTeaTypeTags_(payload));
    }
    if (payload.action === 'taxonomyDryRun') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_(mfImageCollectorTaxonomyDryRun_());
    }
    if (payload.action === 'taxonomyApply') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_(mfImageCollectorApplyTaxonomyInternal_(payload));
    }
    if (payload.action === 'taxonomyRollback') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_(mfImageCollectorRollbackTaxonomyInternal_(payload));
    }
    if (payload.action === 'updateMasterNewTeaDefaults') {
      return mfImageCollectorJson_(mfImageCollectorUpdateMasterNewTeaDefaults_(payload));
    }
    if (payload.action === 'recordReviewCandidate') {
      return mfImageCollectorJson_(mfImageCollectorRecordReviewCandidate_(payload));
    }
    if (payload.action === 'validateReviewCandidate') {
      return mfImageCollectorJson_(mfImageCollectorValidateReviewCandidate_(payload));
    }
    if (payload.action === 'getReviewSummary') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_(mfImageCollectorGetReviewSummary());
    }
    if (payload.action === 'getReviewItems') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_({
        ok: true,
        items: mfImageCollectorGetReviewItems(String(payload.status || '要確認'))
      });
    }
    if (payload.action === 'repairStructuredFactTargetVersions') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_(mfImageCollectorRepairStructuredFactTargetVersions_(payload));
    }
    if (payload.action === 'ensurePrimaryReferenceColumn') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_(mfImageCollectorEnsurePrimaryReferenceColumn_(payload));
    }
    if (payload.action === 'backfillPrimaryReferences') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_(mfImageCollectorBackfillPrimaryReferences_(payload));
    }
    if (payload.action === 'completeTargetDiscoveryRequest') {
      mfImageCollectorAssertSecret_(payload);
      return mfImageCollectorJson_(mfImageCollectorCompleteTargetDiscoveryRequest_(payload));
    }
    return mfImageCollectorJson_({ ok: false, error: 'Unsupported action.' });
  } catch (error) {
    return mfImageCollectorJson_({ ok: false, error: String(error && error.message || error) });
  }
}

function mfImageCollectorUploadImageResults_(payload) {
  mfImageCollectorAssertSecret_(payload);

  var reference = String(payload.reference || '').trim();
  if (!reference) throw new Error('reference is required.');

  var folderId = String(payload.folder_id || MF_IMAGE_COLLECTOR_FOLDER_ID).trim();
  if (folderId !== MF_IMAGE_COLLECTOR_FOLDER_ID) {
    throw new Error('Unexpected Drive folder ID.');
  }

  var rootFolder = DriveApp.getFolderById(folderId);
  var duplicatePolicy = String(payload.duplicate_policy || 'skip').toLowerCase();
  var urlSize = String(payload.url_size || 'w1200');
  var uploaded = [];
  var images = payload.images || [];

  for (var i = 0; i < images.length; i += 1) {
    var image = images[i] || {};
    var imageType = String(image.image_type || '').trim();
    if (imageType !== 'tea' && imageType !== 'teaThumbnail' && imageType !== 'liqueur') continue;

    var fileName = String(image.file_name || '').trim();
    var status = mfImageCollectorNormalizeStatus_(image.status);
    if (status === 'available' && !fileName) throw new Error('file_name is required.');
    var mimeType = String(image.mime_type || 'application/octet-stream');
    var base64 = String(image.data_base64 || '');
    if (status === 'available' && !base64) throw new Error('data_base64 is required.');

    var result = {
      image_type: imageType,
      status: status,
      error_message: String(image.error_message || '')
    };

    if (status === 'available') {
      var folderName = mfImageCollectorFolderNameForType_(imageType);
      var targetFolder = mfImageCollectorGetOrCreateSubfolder_(rootFolder, folderName);
      var fileResult = mfImageCollectorUpsertFile_(targetFolder, fileName, mimeType, base64, duplicatePolicy);
      if (imageType === 'liqueur') {
        mfImageCollectorTrashLegacyLiqueurFiles_(rootFolder, reference);
        mfImageCollectorTrashLegacyLiqueurFiles_(targetFolder, reference);
      }
      result.file_id = fileResult.file.getId();
      result.name = fileResult.file.getName();
      result.folder = folderName;
      result.mime_type = mimeType;
      result.action = fileResult.action;
      result.url = mfImageCollectorThumbnailUrl_(fileResult.file.getId(), urlSize);
    }
    uploaded.push(result);
  }

  var row = mfImageCollectorUpdateSheet_(reference, uploaded);
  return { ok: true, reference: reference, sheet_row: row, images: uploaded };
}

function mfImageCollectorAssertSecret_(payload) {
  var expected = PropertiesService.getScriptProperties().getProperty(MF_IMAGE_COLLECTOR_SECRET_PROPERTY);
  if (!expected) throw new Error('Script property MF_COLLECTOR_WRITE_SECRET is not configured.');
  if (String(payload.secret || '') !== expected) throw new Error('Invalid collector secret.');
}

function mfImageCollectorUpsertFile_(folder, fileName, mimeType, base64, duplicatePolicy) {
  var files = folder.getFilesByName(fileName);
  var existing = [];
  while (files.hasNext()) existing.push(files.next());

  if (existing.length && duplicatePolicy !== 'replace') {
    mfImageCollectorMakeDisplayable_(existing[0]);
    return { file: existing[0], action: 'skipped_existing' };
  }

  if (existing.length && duplicatePolicy === 'replace') {
    for (var i = 0; i < existing.length; i += 1) existing[i].setTrashed(true);
  }

  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, mimeType, fileName);
  var file = folder.createFile(blob);
  mfImageCollectorMakeDisplayable_(file);
  return { file: file, action: existing.length ? 'replaced' : 'created' };
}

function mfImageCollectorGetOrCreateSubfolder_(rootFolder, name) {
  var folders = rootFolder.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return rootFolder.createFolder(name);
}

function mfImageCollectorFolderNameForType_(imageType) {
  if (imageType === 'teaThumbnail') return 'tea-thumbnail';
  return imageType;
}

function mfImageCollectorNormalizeStatus_(status) {
  var value = String(status || '').toLowerCase();
  if (value === 'available' || value === 'not_available' || value === 'pending' || value === 'error') return value;
  return 'available';
}

function mfImageCollectorNormalizeProductUrlStatus_(status) {
  var value = String(status || '').toLowerCase();
  if (value === 'not_available') return 'not_found';
  if (value === 'available' || value === 'not_found' || value === 'pending' || value === 'error') return value;
  return 'error';
}

function mfImageCollectorTrashLegacyLiqueurFiles_(folder, reference) {
  var names = [
    reference + '_liqueur.jpg',
    reference + '_liqueur.jpeg',
    reference + '_liqueur.png',
    reference + '_liqueur.webp',
    reference + '_liqueur.avif'
  ];
  for (var i = 0; i < names.length; i += 1) {
    var files = folder.getFilesByName(names[i]);
    while (files.hasNext()) files.next().setTrashed(true);
  }
}

function mfImageCollectorMakeDisplayable_(file) {
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (error) {
    // Some Workspace policies forbid public link sharing. The file is still saved,
    // but the PWA may need an authenticated or proxied display path.
  }
}

function mfImageCollectorMakeFilesDisplayable(fileIds) {
  var updated = [];
  for (var i = 0; i < fileIds.length; i += 1) {
    var fileId = String(fileIds[i] || '').trim();
    if (!fileId) continue;
    var file = DriveApp.getFileById(fileId);
    mfImageCollectorMakeDisplayable_(file);
    updated.push({ file_id: fileId, name: file.getName() });
  }
  return updated;
}

function mfImageCollectorOnOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu('MARIAGE FRÈRES 管理')
    .addItem('変更レビュー', 'mfImageCollectorOpenReviewSheet')
    .addItem('選択行を反映', 'mfImageCollectorApplySelectedReviewRow')
    .addItem('選択行を一括反映', 'mfImageCollectorApplySelectedReviewRows')
    .addItem('要確認件数を表示', 'mfImageCollectorShowReviewSummary')
    .addItem('レビュー更新', 'mfImageCollectorRefreshReviewSheet')
    .addItem('旧HTMLレビュー', 'mfImageCollectorShowReviewDialog')
    .addSeparator()
    .addItem('銘柄指定で追加候補を作成', 'mfImageCollectorShowTargetRequestDialog')
    .addItem('銘柄指定調査キューを開く', 'mfImageCollectorOpenTargetRequestQueue')
    .addItem('現在カテゴリを監査', 'mfImageCollectorAuditCurrentCategories')
    .addItem('分類整理 dry-run', 'mfImageCollectorShowTaxonomyDryRun')
    .addItem('分類整理を反映', 'mfImageCollectorShowTaxonomyApplyConfirm')
    .addItem('分類整理を元に戻す', 'mfImageCollectorShowTaxonomyRollbackConfirm')
    .addToUi();
}

function mfImageCollectorOpenReviewSheet() {
  var sheet = mfImageCollectorGetOrCreateReviewSheet_();
  mfImageCollectorPrepareReviewSheetDisplay_(sheet);
  mfImageCollectorEnsureReviewFilter_(sheet);
  sheet.activate();
  var statusCol = mfImageCollectorSheetHeaders_(sheet).indexOf('ステータス');
  if (statusCol < 0 || sheet.getLastRow() < 2) return;
  var statuses = sheet.getRange(2, statusCol + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < statuses.length; i += 1) {
    if (MF_IMAGE_COLLECTOR_REVIEW_APPLY_STATUSES.indexOf(String(statuses[i][0] || '').trim()) >= 0) {
      sheet.setActiveRange(sheet.getRange(i + 2, 1));
      return;
    }
  }
}

function mfImageCollectorAuditCurrentCategories() {
  var result = mfImageCollectorAuditCurrentCategories_();
  var message = [
    '対象行数: ' + result.target_rows,
    'canonicalで変更不要: ' + result.canonical_rows,
    '正規化候補追加数: ' + result.created,
    '重複skip数: ' + result.duplicate_skips,
    'blank数: ' + result.blank_rows,
    '未知カテゴリ数: ' + result.unknown_rows
  ];
  if (result.unknown_values.length) message.push('', '未知値:', result.unknown_values.join('\n'));
  SpreadsheetApp.getUi().alert('現在カテゴリ監査', message.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
  return result;
}

function mfImageCollectorApplySelectedReviewRow() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (!sheet || sheet.getName() !== MF_IMAGE_COLLECTOR_REVIEW_SHEET_NAME) {
    throw new Error('変更候補レビューシートで反映する行を選択してください。');
  }
  var activeRange = sheet.getActiveRange();
  if (!activeRange || activeRange.getNumRows() !== 1 || activeRange.getRow() < 2) {
    throw new Error('反映するデータ行を1行だけ選択してください。');
  }

  var rowNumber = activeRange.getRow();
  var headers = mfImageCollectorSheetHeaders_(sheet);
  var values = sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0];
  var review = mfImageCollectorReviewObject_(headers, values);
  var decision = String(review['人間判定'] || '').trim();
  var targetVersionKey = String(review['対象VersionKey'] || '').trim();
  var comment = String(review['コメント'] || '').trim();
  var approvedDescription = String(review['承認済み日本語説明'] || '').trim();
  mfImageCollectorAssertReviewDecisionAllowed_(review, decision, targetVersionKey, approvedDescription);

  var resolvedStructuredFact = null;
  if (String(review['検出種別'] || '').trim() === 'structured_fact' &&
      decision === '既存銘柄を更新' &&
      !targetVersionKey &&
      !String(review['DB既存VersionKey'] || '').trim()) {
    resolvedStructuredFact = mfImageCollectorResolveStructuredFactTargetFromMaster_(review);
  }

  var salesIdentity = mfImageCollectorReviewSalesSkuIdentity_(review);
  var salesSku = salesIdentity.sku_info;
  var parent = salesSku ? mfImageCollectorSalesSkuParentForReview_(review, targetVersionKey) : null;
  var lines = [
    '行: ' + rowNumber,
    'REF / Primary Reference候補: ' + (mfImageCollectorReviewPrimaryReference_(review) || '（空欄）'),
    '公式名: ' + (String(review['公式名'] || '').trim() || '（空欄）'),
    '確認内容: ' + mfImageCollectorReviewConfirmationLabel_(review),
    '検出種別（技術情報）: ' + (String(review['検出種別'] || '').trim() || '（空欄）'),
    '人間判定: ' + decision,
    '対象VersionKey: ' + (resolvedStructuredFact
      ? resolvedStructuredFact.version_key + '（自動解決）'
      : (targetVersionKey || '（空欄）')),
    'コメント: ' + (comment || '（なし）')
  ];
  if (salesSku) {
    lines.push('販売SKU種別: ' + salesSku.prefix);
    lines.push('親T候補: ' + (parent ? parent.reference : '（未特定）'));
    lines.push('親銘柄名: ' + (parent && parent.name ? parent.name : '（未特定）'));
  }
  if (String(review['検出種別'] || '').trim() === 'official_description_translation') {
    lines.push('人間承認済み日本語説明: ' + (approvedDescription || '（空欄）'));
  }
  if (String(review['検出種別'] || '').trim() === 'structured_fact') {
    lines.push('対象列: ' + (String(review['対象列'] || '').trim() || '（空欄）'));
    lines.push('現在値: ' + (String(review['現在値'] || '').trim() || '（空欄）'));
    lines.push('候補値: ' + (String(review['候補値'] || '').trim() || '（空欄）'));
  }
  lines.push('');
  lines.push('実行内容: ' + mfImageCollectorReviewDecisionDescription_(review, decision, parent));

  var response = ui.alert('選択行を反映', lines.join('\n'), ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return { ok: false, cancelled: true, row_number: rowNumber };

  var result = mfImageCollectorApplyReviewDecision(
    rowNumber,
    decision,
    targetVersionKey,
    comment,
    approvedDescription
  );
  ui.alert('反映完了', '行 ' + rowNumber + ' を「' + result.status + '」に更新しました。', ui.ButtonSet.OK);
  return result;
}

function mfImageCollectorApplySelectedReviewRows() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (!sheet || sheet.getName() !== MF_IMAGE_COLLECTOR_REVIEW_SHEET_NAME) {
    throw new Error('変更候補レビューシートで反映する行を選択してください。');
  }
  var rangeList = SpreadsheetApp.getActiveRangeList();
  var ranges = rangeList ? rangeList.getRanges() : [];
  if (ranges.length !== 1) throw new Error('離れた複数範囲は一括反映できません。連続した行だけを選択してください。');
  var range = ranges[0];
  if (range.getRow() < 2) throw new Error('ヘッダー行を含む選択は一括反映できません。');
  if (range.getNumRows() === 1) return mfImageCollectorApplySelectedReviewRow();

  var preflight = mfImageCollectorPreflightReviewRows_(sheet, range.getRow(), range.getNumRows());
  if (preflight.errors.length) {
    throw new Error('一括反映の事前検証に失敗しました。\n\n' + preflight.errors.join('\n'));
  }

  var counts = preflight.counts;
  var processItems = preflight.items.filter(function(item) { return item.process; });
  if (!processItems.length) {
    ui.alert(
      '選択行を一括反映',
      '選択範囲: ' + preflight.selected_count + '行\n' +
      '確定済みスキップ: ' + counts.skip_finalized + '件\n\n' +
      '処理対象はありません。',
      ui.ButtonSet.OK
    );
    return { ok: true, no_work: true, preflight: preflight };
  }
  var lines = [
    '選択範囲: ' + preflight.selected_count + '行',
    '実処理対象: ' + processItems.length + '件',
    '確定済みスキップ: ' + counts.skip_finalized + '件',
    '',
    '反映予定:',
    '- 反映: ' + counts.apply + '件',
    '- 反映済み確認（Master書込なし）: ' + counts.already_applied + '件',
    '- 保留: ' + counts.hold + '件',
    '- 誤検出/却下: ' + counts.reject + '件',
    '',
    'この' + processItems.length + '件を反映しますか？'
  ];
  var response = ui.alert('選択行を一括反映', lines.join('\n'), ui.ButtonSet.YES_NO);
  if (response !== ui.Button.YES) return { ok: false, cancelled: true };

  var results = [];
  for (var i = 0; i < processItems.length; i += 1) {
    var item = processItems[i];
    try {
      results.push(mfImageCollectorApplyReviewDecision(
        item.row_number,
        item.decision,
        item.target_version_key,
        item.comment,
        item.approved_japanese_description
      ));
    } catch (error) {
      var remaining = processItems.length - i - 1;
      throw new Error(
        '一括反映を行 ' + item.row_number + ' で停止しました。\n' +
        '成功済み: ' + results.length + '件\n' +
        '失敗: 行 ' + item.row_number + ' - ' + error.message + '\n' +
        '未処理: ' + remaining + '件'
      );
    }
  }

  var summary = mfImageCollectorSummarizeBatchReviewResults_(results);
  ui.alert(
    '一括反映完了',
    '成功: ' + results.length + '件\n' +
    '既に反映済み（Master書込なし）: ' + summary.already_applied + '件\n' +
    '保留: ' + summary.hold + '件\n' +
    '却下: ' + summary.reject + '件\n' +
    '失敗: 0件',
    ui.ButtonSet.OK
  );
  return { ok: true, results: results, summary: summary };
}

function mfImageCollectorPreflightReviewRows_(sheet, startRow, rowCount) {
  var headers = mfImageCollectorSheetHeaders_(sheet);
  var values = sheet.getRange(startRow, 1, rowCount, sheet.getLastColumn()).getValues();
  var items = [];
  var errors = [];
  var counts = { apply: 0, hold: 0, reject: 0, skip_finalized: 0, already_applied: 0, error: 0 };
  for (var i = 0; i < values.length; i += 1) {
    var rowNumber = startRow + i;
    try {
      var item = mfImageCollectorPreflightReviewRow_(rowNumber, mfImageCollectorReviewObject_(headers, values[i]));
      items.push(item);
      counts[item.category] += 1;
    } catch (error) {
      errors.push('行 ' + rowNumber + ': ' + error.message);
      counts.error += 1;
    }
  }
  return { selected_count: rowCount, items: items, errors: errors, counts: counts };
}

function mfImageCollectorPreflightReviewRow_(rowNumber, review) {
  var status = String(review['ステータス'] || '').trim();
  if (MF_IMAGE_COLLECTOR_REVIEW_APPLY_STATUSES.indexOf(status) < 0) {
    if (MF_IMAGE_COLLECTOR_REVIEW_FINAL_STATUSES.indexOf(status) < 0) {
      throw new Error('処理できないステータスです: ' + (status || '(空欄)'));
    }
    return {
      row_number: rowNumber,
      decision: String(review['人間判定'] || '').trim(),
      target_version_key: String(review['対象VersionKey'] || '').trim(),
      approved_japanese_description: '',
      comment: String(review['コメント'] || '').trim(),
      category: 'skip_finalized',
      process: false
    };
  }
  var decision = String(review['人間判定'] || '').trim();
  var targetVersionKey = String(review['対象VersionKey'] || '').trim();
  var comment = String(review['コメント'] || '').trim();
  var approvedDescription = String(review['承認済み日本語説明'] || '').trim();
  mfImageCollectorAssertReviewDecisionAllowed_(review, decision, targetVersionKey, approvedDescription);
  var result = mfImageCollectorApplyApprovedReview_(review, decision, targetVersionKey, {
    dry_run: true,
    target_version_key: targetVersionKey,
    approved_japanese_description: approvedDescription
  });
  return {
    row_number: rowNumber,
    decision: decision,
    target_version_key: result && result.target_version_key ? result.target_version_key : targetVersionKey,
    approved_japanese_description: approvedDescription,
    comment: comment,
    category: result && result.already_applied ? 'already_applied' : mfImageCollectorBatchReviewCategory_(review, decision),
    process: true
  };
}

function mfImageCollectorBatchReviewCategory_(review, decision) {
  if (decision === '保留') return 'hold';
  if (decision === '誤検出') return 'reject';
  return 'apply';
}

function mfImageCollectorSummarizeBatchReviewResults_(results) {
  var summary = { hold: 0, reject: 0, already_applied: 0 };
  for (var i = 0; i < results.length; i += 1) {
    if (results[i].status === '保留') summary.hold += 1;
    if (results[i].status === '却下') summary.reject += 1;
    if (results[i].already_applied) summary.already_applied += 1;
  }
  return summary;
}

function mfImageCollectorShowReviewSummary() {
  var summary = mfImageCollectorGetReviewSummary();
  SpreadsheetApp.getUi().alert(
    '変更候補レビュー',
    '要確認: ' + summary.pending_count + '件\n最古の未処理: ' + (summary.oldest_pending_at || 'なし'),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function mfImageCollectorShowReviewDialog() {
  var html = HtmlService.createHtmlOutput(mfImageCollectorReviewHtml_())
    .setWidth(820)
    .setHeight(720);
  SpreadsheetApp.getUi().showModalDialog(html, 'MARIAGE FRÈRES 変更レビュー');
}

function mfImageCollectorTargetRequestHtml_() {
  return [
    '<!doctype html><html><head><base target="_top"><style>',
    'body{font-family:Arial,"Noto Sans JP",sans-serif;margin:0;padding:18px;color:#202124}',
    '.note{background:#f8f5ef;border:1px solid #e5dccd;border-radius:6px;padding:10px 12px;margin-bottom:14px;line-height:1.55}',
    'label{display:block;font-weight:700;margin:12px 0 6px}',
    'input{box-sizing:border-box;width:100%;padding:9px 10px;border:1px solid #c9c2b8;border-radius:4px;font-size:14px}',
    '.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:18px}',
    'button{border:1px solid #8b7358;background:#fff;padding:8px 12px;border-radius:4px;cursor:pointer}',
    'button.primary{background:#4b3a2a;color:#fff;border-color:#4b3a2a}',
    '#message{margin-top:12px;white-space:pre-wrap}',
    '</style></head><body>',
    '<div class="note">この操作では銘柄マスターへ直接追加しません。次回collector実行時に公式サイトを調査し、確認できた場合は変更候補レビューへ送ります。</div>',
    '<label for="target_name">銘柄名 <span style="color:#b3261e">*</span></label>',
    '<input id="target_name" autocomplete="off" placeholder="例: KUKICHA">',
    '<label for="target_ref">REF</label>',
    '<input id="target_ref" autocomplete="off" placeholder="例: T662 / TFG9965 / TJ9JA">',
    '<label for="target_url">公式商品URL</label>',
    '<input id="target_url" autocomplete="off" placeholder="https://www.mariagefreres.com/en/...">',
    '<div class="actions">',
    '  <button onclick="google.script.host.close()">キャンセル</button>',
    '  <button class="primary" id="submit" onclick="submitRequest()">調査キューに追加</button>',
    '</div>',
    '<div id="message"></div>',
    '<script>',
    'function value(id){return document.getElementById(id).value.trim();}',
    'function submitRequest(){',
    "  var button=document.getElementById('submit');",
    "  var message=document.getElementById('message');",
    "  var payload={target_name:value('target_name'),target_ref:value('target_ref'),target_url:value('target_url')};",
    "  if(!payload.target_name){message.textContent='銘柄名を入力してください。';return;}",
    '  button.disabled=true;',
    "  message.textContent='登録中...';",
    '  google.script.run',
    '    .withSuccessHandler(function(result){',
    "      if(!result || result.ok===false){message.textContent=(result && result.error) || '登録に失敗しました。';button.disabled=false;return;}",
    "      message.textContent=(result.message || '調査キューに追加しました。') + '\\nrequest_id: ' + (result.request_id || '');",
    '    })',
    '    .withFailureHandler(function(error){',
    "      message.textContent='エラー: ' + (error && error.message ? error.message : error);",
    '      button.disabled=false;',
    '    })',
    '    .mfImageCollectorCreateTargetDiscoveryRequest(payload);',
    '}',
    '</script></body></html>'
  ].join('\n');
}

function mfImageCollectorShowTargetRequestDialog() {
  var html = HtmlService.createHtmlOutput(mfImageCollectorTargetRequestHtml_())
    .setWidth(520)
    .setHeight(430);
  SpreadsheetApp.getUi().showModalDialog(html, '銘柄指定で追加候補を作成');
}

function mfImageCollectorOpenTargetRequestQueue() {
  var sheet = mfImageCollectorGetOrCreateTargetQueueSheet_();
  SpreadsheetApp.setActiveSheet(sheet);
}

function mfImageCollectorCreateTargetDiscoveryRequest(form) {
  var input = mfImageCollectorNormalizeTargetRequestInput_(form || {});
  if (!input.target_name) throw new Error('銘柄名は必須です。');

  var sheet = mfImageCollectorGetOrCreateTargetQueueSheet_();
  var headers = mfImageCollectorSheetHeaders_(sheet);
  var duplicate = mfImageCollectorFindOpenTargetQueueRow_(sheet, headers, input);
  if (duplicate.row_number > 0) {
    return {
      ok: true,
      duplicate: true,
      request_id: duplicate.request.request_id,
      message: 'すでに調査待ちです。'
    };
  }

  var requestId = mfImageCollectorTargetRequestId_(input);
  var row = {
    request_id: requestId,
    created_at: new Date(),
    target_name: input.target_name,
    target_ref: input.target_ref,
    target_url: input.target_url,
    status: 'pending',
    started_at: '',
    completed_at: '',
    result_reference: '',
    result_name: '',
    result_status: '',
    message: ''
  };
  sheet.appendRow(MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS.map(function(header) { return row[header] || ''; }));
  mfImageCollectorApplyTargetQueueValidation_(sheet);
  return {
    ok: true,
    duplicate: false,
    request_id: requestId,
    message: '調査キューに追加しました。次回collector実行時に調査します。'
  };
}

function mfImageCollectorShowTaxonomyDryRun() {
  var result = mfImageCollectorTaxonomyDryRun_();
  SpreadsheetApp.getUi().alert(
    '分類整理 dry-run',
    '変更対象行: ' + result.summary.changed_rows +
      '\n変更対象セル: ' + result.summary.changed_cells +
      '\n茶種/カテゴリ変更セル: ' + result.summary.tea_type_changed_cells +
      '\n香味大分類変更行: ' + result.summary.aroma_changed_rows +
      '\n未知分類: ' + Object.keys(result.summary.unknown_old_categories).join(', '),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function mfImageCollectorShowTaxonomyApplyConfirm() {
  var ui = SpreadsheetApp.getUi();
  var dryRun = mfImageCollectorTaxonomyDryRun_();
  var batchId = mfImageCollectorTaxonomyBatchId_();
  var response = ui.alert(
    '分類整理を反映',
    '変更行数: ' + dryRun.summary.changed_rows +
      '\n変更セル数: ' + dryRun.summary.changed_cells +
      '\nbatch_id: ' + batchId +
      '\n\nこの処理は銘柄マスターを書き換えます。実行しますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (response !== ui.Button.OK) return;
  var result = mfImageCollectorApplyTaxonomyInternal_({ batch_id: batchId, dry_run: false });
  if (!result.ok) {
    ui.alert('分類整理を反映', '中止: ' + (result.error || 'conflict') + '\nconflict数: ' + ((result.conflicts || []).length), ui.ButtonSet.OK);
    return;
  }
  ui.alert('分類整理を反映', '完了: ' + result.applied_count + 'セル\nbatch_id: ' + result.batch_id, ui.ButtonSet.OK);
}

function mfImageCollectorShowTaxonomyRollbackConfirm() {
  var ui = SpreadsheetApp.getUi();
  var latest = mfImageCollectorLatestAppliedTaxonomyBatch_();
  if (!latest) {
    ui.alert('分類整理を元に戻す', 'rollback可能なbatchがありません。', ui.ButtonSet.OK);
    return;
  }
  var response = ui.alert(
    '分類整理を元に戻す',
    'batch_id: ' + latest.batch_id +
      '\n対象セル数: ' + latest.count +
      '\n\n保存済みbefore値へ戻します。実行しますか？',
    ui.ButtonSet.OK_CANCEL
  );
  if (response !== ui.Button.OK) return;
  var result = mfImageCollectorRollbackTaxonomyInternal_({ batch_id: latest.batch_id, dry_run: false });
  ui.alert(
    '分類整理を元に戻す',
    '戻したセル: ' + (result.rollback_count || 0) +
      '\nconflict数: ' + (result.conflict_count || 0) +
      '\nbatch_id: ' + result.batch_id +
      (result.error ? '\n' + result.error : ''),
    ui.ButtonSet.OK
  );
}

function mfImageCollectorRefreshReviewSheet() {
  var sheet = mfImageCollectorGetOrCreateReviewSheet_();
  mfImageCollectorPrepareReviewSheetDisplay_(sheet);
  mfImageCollectorEnsureReviewFilter_(sheet);
  mfImageCollectorShowReviewSummary();
}

function mfImageCollectorGetReviewItems(status) {
  var sheet = mfImageCollectorGetOrCreateReviewSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var statusCol = headers.indexOf('ステータス');
  if (statusCol < 0) throw new Error('Review sheet is missing ステータス column.');
  var items = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    if (status && String(row[statusCol] || '').trim() !== status) continue;
    var item = { row_number: i + 1 };
    for (var j = 0; j < headers.length; j += 1) item[headers[j]] = mfImageCollectorClientValue_(row[j]);
    items.push(item);
  }
  return items;
}

function mfImageCollectorClientValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  }
  if (value === null || typeof value === 'undefined') return '';
  return String(value);
}

function mfImageCollectorReviewObject_(headers, values) {
  var review = {};
  for (var i = 0; i < headers.length; i += 1) review[headers[i]] = values[i];
  return review;
}

function mfImageCollectorReviewOfficialInfo_(review) {
  try {
    return JSON.parse(String(review['公式情報JSON'] || '{}')) || {};
  } catch (error) {
    return {};
  }
}

function mfImageCollectorReviewPrimaryReference_(review) {
  var info = mfImageCollectorReviewOfficialInfo_(review);
  return String(info.primary_reference || review['Tリファレンス番号'] || '').trim().toUpperCase();
}

function mfImageCollectorReviewSalesSkuIdentity_(review) {
  var info = mfImageCollectorReviewOfficialInfo_(review);
  var displayReference = String(review['Tリファレンス番号'] || '').trim().toUpperCase();
  var jsonReference = String(info.primary_reference || '').trim().toUpperCase();
  var displaySku = mfImageCollectorSalesSkuInfo_(displayReference);
  var jsonSku = mfImageCollectorSalesSkuInfo_(jsonReference);
  var conflict = !!(displaySku && jsonSku && displaySku.sku !== jsonSku.sku);
  return {
    is_sales_sku: !!(displaySku || jsonSku),
    sku_info: displaySku || jsonSku || null,
    display_reference: displayReference,
    json_reference: jsonReference,
    conflict: conflict
  };
}

function mfImageCollectorSalesSkuParentForReview_(review, targetVersionKey) {
  var salesIdentity = mfImageCollectorReviewSalesSkuIdentity_(review);
  if (!salesIdentity.sku_info) return null;
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  return mfImageCollectorResolveSalesSkuParent_(review, targetVersionKey, salesIdentity.sku_info, values, headers);
}

function mfImageCollectorReviewDecisionOptions_(review) {
  var detectionType = String(review['検出種別'] || '').trim();
  if (detectionType === 'structured_fact' || detectionType === 'official_description_translation') {
    return ['既存銘柄を更新', '誤検出', '保留'];
  }

  if (mfImageCollectorReviewSalesSkuIdentity_(review).is_sales_sku) {
    return ['販売SKUとして追加', '誤検出', '保留'];
  }

  return [
    '新規銘柄として追加',
    '既存銘柄を更新',
    '既存銘柄の新バージョンとして追加',
    '既存銘柄と同一',
    '終売情報として更新',
    '誤検出',
    '保留'
  ];
}

function mfImageCollectorAssertReviewDecisionAllowed_(review, decision, targetVersionKey, approvedJapaneseDescription) {
  var normalizedDecision = String(decision || '').trim();
  var allowed = mfImageCollectorReviewDecisionOptions_(review);
  if (allowed.indexOf(normalizedDecision) < 0) {
    throw new Error('この候補には選択できない人間判定です: ' + (normalizedDecision || '(空欄)'));
  }

  var salesIdentity = mfImageCollectorReviewSalesSkuIdentity_(review);
  var skuInfo = salesIdentity.sku_info;
  if (skuInfo && normalizedDecision === '販売SKUとして追加') {
    if (salesIdentity.conflict) {
      throw new Error('表示REFと公式情報JSONの販売SKUが一致しません。');
    }
    var parent = mfImageCollectorSalesSkuParentForReview_(review, targetVersionKey);
    if (!parent) {
      throw new Error('販売SKUの親Tを現在のMasterから安全に一意解決できません。対象VersionKeyを明示してください: ' + skuInfo.sku);
    }
  }

  var detectionType = String(review['検出種別'] || '').trim();
  if (detectionType === 'official_description_translation' && normalizedDecision === '既存銘柄を更新') {
    if (!String(approvedJapaneseDescription || '').trim()) {
      throw new Error('official_description_translation の反映には、人間が明示入力した承認済み日本語説明が必要です。');
    }
  }
}

function mfImageCollectorReviewDecisionDescription_(review, decision, parent) {
  if (decision === '販売SKUとして追加') {
    return '既存銘柄 ' + (parent ? parent.reference : '') + ' に販売SKUを追加します。';
  }
  if (decision === '新規銘柄として追加') return '新しい銘柄行を追加します。';
  if (decision === '既存銘柄の新バージョンとして追加') return '既存銘柄の新しいVersionKey行を追加します。';
  if (decision === '既存銘柄を更新') {
    var detectionType = String(review['検出種別'] || '').trim();
    if (detectionType === 'official_description_translation') {
      return '既存行の現在の公式説明を、人間が入力した承認済み日本語説明で更新します。';
    }
    if (detectionType === 'structured_fact') {
      return '既存行の「' + String(review['対象列'] || '').trim() + '」を「' + String(review['候補値'] || '').trim() + '」へ更新します。';
    }
    return '既存の対象VersionKey行を更新します。';
  }
  if (decision === '既存銘柄と同一') return 'マスターは変更せず、同一銘柄としてレビューを完了します。';
  if (decision === '終売情報として更新') return '既存の終売情報判定としてレビューを完了します。';
  if (decision === '誤検出') return 'マスターは変更せず、候補を却下します。';
  if (decision === '保留') return 'マスターは変更せず、後日の再確認対象として保留します。';
  return decision;
}

function mfImageCollectorEnsureReviewFilter_(sheet) {
  if (sheet.getFilter() || sheet.getLastColumn() < 1) return;
  var rowCount = Math.max(sheet.getLastRow(), 1);
  sheet.getRange(1, 1, rowCount, sheet.getLastColumn()).createFilter();
}

function mfImageCollectorApplyReviewDecision(rowNumber, decision, targetVersionKey, comment, approvedJapaneseDescription) {
  var sheet = mfImageCollectorGetOrCreateReviewSheet_();
  var row = Number(rowNumber);
  if (!row || row < 2 || row > sheet.getLastRow()) throw new Error('Invalid review row.');
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  var review = mfImageCollectorReviewObject_(headers, values);

  if (MF_IMAGE_COLLECTOR_REVIEW_DECISIONS.indexOf(decision) < 0) throw new Error('Unsupported review decision.');
  var currentStatus = String(review['ステータス'] || '').trim();
  if (MF_IMAGE_COLLECTOR_REVIEW_APPLY_STATUSES.indexOf(currentStatus) < 0) {
    throw new Error('Review row has already been finalized or cannot be processed: ' + (currentStatus || '(blank)'));
  }
  mfImageCollectorAssertReviewDecisionAllowed_(review, decision, targetVersionKey, approvedJapaneseDescription);
  var finalStatus = '反映済み';
  if (decision === '保留') finalStatus = '保留';
  if (decision === '誤検出') finalStatus = '却下';

  var applyResult = null;
  if (finalStatus === '反映済み') {
    applyResult = mfImageCollectorApplyApprovedReview_(review, decision, targetVersionKey, {
      review_row: row,
      approved_japanese_description: approvedJapaneseDescription,
      target_version_key: targetVersionKey
    });
  }

  var reviewUpdates = {
    'ステータス': finalStatus,
    '人間判定': decision,
    '対象VersionKey': applyResult && applyResult.target_version_key
      ? applyResult.target_version_key
      : (targetVersionKey || review['対象VersionKey'] || ''),
    'コメント': comment || review['コメント'] || '',
    '処理日時': new Date()
  };
  if (applyResult && applyResult.already_applied) {
    var alreadyAppliedNote = 'Masterに候補値が既に存在したため書込なし';
    reviewUpdates['コメント'] = comment
      ? comment + ' / ' + alreadyAppliedNote
      : alreadyAppliedNote;
  }
  if (applyResult && applyResult.auto_resolved) {
    reviewUpdates['DB既存VersionKey'] = applyResult.target_version_key;
    reviewUpdates['DB既存T'] = applyResult.reference || '';
    reviewUpdates['DB既存名'] = applyResult.name || '';
  }
  mfImageCollectorSetReviewRowValues_(sheet, row, reviewUpdates);
  return {
    ok: true,
    row_number: row,
    status: finalStatus,
    decision: decision,
    already_applied: !!(applyResult && applyResult.already_applied)
  };
}

function mfImageCollectorRecordReviewCandidate_(payload) {
  mfImageCollectorAssertSecret_(payload);
  var candidate = payload.candidate || {};
  var reference = String(candidate.reference || '').trim();
  if (!reference) throw new Error('candidate.reference is required.');

  var sheet = mfImageCollectorGetOrCreateReviewSheet_();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  var detectionId = mfImageCollectorReviewDedupeKey_(candidate);
  var existingRow = mfImageCollectorFindReviewRow_(sheet, headers, detectionId);
  var matchedByIdentity = false;
  if (existingRow < 0) {
    existingRow = mfImageCollectorFindReviewRowByIdentity_(sheet, headers, candidate);
    matchedByIdentity = existingRow > 0;
  }
  var rowValues = mfImageCollectorReviewCandidateToRow_(candidate, detectionId);

  if (existingRow > 0) {
    var status = String(sheet.getRange(existingRow, headers.indexOf('ステータス') + 1).getValue() || '');
    if (status === '要確認' || status === '保留') {
      mfImageCollectorSetReviewRowValues_(sheet, existingRow, {
        '検出ID': matchedByIdentity ? detectionId : undefined,
        '検出日時': rowValues['検出日時'],
        '公式名': rowValues['公式名'],
        '公式URL': rowValues['公式URL'],
        '言語': rowValues['言語'],
        '差分概要': rowValues['差分概要'],
        'Collectorが取得した根拠': rowValues['Collectorが取得した根拠'],
        'コメント': rowValues['コメント'],
        'FR公式URL': rowValues['FR公式URL'],
        'EN公式URL': rowValues['EN公式URL'],
        'JP公式URL': rowValues['JP公式URL'],
        '確認言語': rowValues['確認言語'],
        '公式名称差': rowValues['公式名称差'],
        '公式説明抜粋': rowValues['公式説明抜粋'],
        'DB存在確認': rowValues['DB存在確認'],
        'DB類似候補': rowValues['DB類似候補'],
        'Discovery source': rowValues['Discovery source'],
        '公式情報JSON': rowValues['公式情報JSON'],
        '対象列': rowValues['対象列'],
        '現在値': rowValues['現在値'],
        '候補値': rowValues['候補値'],
        '根拠原文': rowValues['根拠原文'],
        '根拠言語': rowValues['根拠言語'],
        '根拠URL': rowValues['根拠URL'],
        'source_type': rowValues['source_type'],
        'confidence': rowValues['confidence']
      });
      return { ok: true, action: 'updated_existing', detection_id: detectionId, sheet_row: existingRow };
    }
    return { ok: true, action: 'skipped_existing_final', detection_id: detectionId, sheet_row: existingRow };
  }

  sheet.appendRow(MF_IMAGE_COLLECTOR_REVIEW_HEADERS.map(function(header) { return rowValues[header] || ''; }));
  mfImageCollectorApplyReviewValidation_(sheet);
  return { ok: true, action: 'created', detection_id: detectionId, sheet_row: sheet.getLastRow() };
}

function mfImageCollectorValidateReviewCandidate_(payload) {
  mfImageCollectorAssertSecret_(payload);
  var candidate = payload.candidate || {};
  var reference = String(candidate.reference || '').trim();
  if (!reference) throw new Error('candidate.reference is required.');

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_REVIEW_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
    var fallbackDetectionId = mfImageCollectorReviewDedupeKey_(candidate);
    return {
      ok: true,
      valid: true,
      wouldCreate: true,
      wouldUpdate: false,
      existingRow: 0,
      existingStatus: '',
      dedupeKey: fallbackDetectionId,
      writePerformed: false
    };
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  var detectionId = mfImageCollectorReviewDedupeKey_(candidate);
  var existingRow = mfImageCollectorFindReviewRow_(sheet, headers, detectionId);
  if (existingRow < 0) {
    existingRow = mfImageCollectorFindReviewRowByIdentity_(sheet, headers, candidate);
  }
  var existingStatus = '';
  if (existingRow > 0) {
    existingStatus = String(sheet.getRange(existingRow, headers.indexOf('ステータス') + 1).getValue() || '');
  }
  return {
    ok: true,
    valid: true,
    wouldCreate: existingRow < 0,
    wouldUpdate: existingRow > 0 && (existingStatus === '要確認' || existingStatus === '保留'),
    existingRow: existingRow > 0 ? existingRow : 0,
    existingStatus: existingStatus,
    dedupeKey: detectionId,
    writePerformed: false
  };
}

function mfImageCollectorOpenSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('MF_MASTER_SPREADSHEET_ID');
  if (!spreadsheetId && typeof SPREADSHEET_ID !== 'undefined') {
    spreadsheetId = SPREADSHEET_ID;
  }
  var ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet not found. Bind this script, define SPREADSHEET_ID, or set MF_MASTER_SPREADSHEET_ID.');
  return ss;
}

function mfImageCollectorGetTeaData_() {
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  if (!values.length) return { ok: true, rows: [], updatedAt: new Date().toISOString() };
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = {};
    var hasValue = false;
    for (var j = 0; j < headers.length; j += 1) {
      row[headers[j]] = mfImageCollectorClientValue_(values[i][j]);
      if (row[headers[j]]) hasValue = true;
    }
    if (hasValue) rows.push(row);
  }
  return { ok: true, rows: rows, updatedAt: new Date().toISOString() };
}

function mfImageCollectorSheetHeaders_(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) {
    return String(value).trim();
  });
}

function mfImageCollectorGetOrCreateReviewSheet_() {
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_REVIEW_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MF_IMAGE_COLLECTOR_REVIEW_SHEET_NAME);
    sheet.getRange(1, 1, 1, MF_IMAGE_COLLECTOR_REVIEW_HEADERS.length).setValues([MF_IMAGE_COLLECTOR_REVIEW_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    var headers = sheet.getLastColumn() > 0
      ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); })
      : [];
    if (headers.indexOf('確認内容') < 0) {
      var decisionIndex = headers.indexOf('人間判定');
      if (decisionIndex < 0) throw new Error('Review sheet is missing 人間判定 column.');
      sheet.insertColumnBefore(decisionIndex + 1);
      sheet.getRange(1, decisionIndex + 1).setValue('確認内容');
      SpreadsheetApp.flush();
      headers = mfImageCollectorSheetHeaders_(sheet);
    }
    for (var i = 0; i < MF_IMAGE_COLLECTOR_REVIEW_HEADERS.length; i += 1) {
      if (headers.indexOf(MF_IMAGE_COLLECTOR_REVIEW_HEADERS[i]) < 0) {
        var lastColumn = Math.max(sheet.getLastColumn(), 1);
        sheet.insertColumnAfter(lastColumn);
        sheet.getRange(1, lastColumn + 1).setValue(MF_IMAGE_COLLECTOR_REVIEW_HEADERS[i]);
        headers.push(MF_IMAGE_COLLECTOR_REVIEW_HEADERS[i]);
      }
    }
  }
  mfImageCollectorEnsureReviewFilter_(sheet);
  return sheet;
}

function mfImageCollectorReviewConfirmationLabel_(review) {
  var existing = String(review['確認内容'] || '').trim();
  if (existing) return existing;
  var detectionType = String(review['検出種別'] || '').trim();
  var targetColumn = String(review['対象列'] || '').trim();
  if (detectionType === 'structured_fact') {
    var structuredLabels = {
      '香味詳細タグ': '香味詳細タグの追加',
      '香味大分類': '香味分類の追加・変更',
      '現在のカテゴリ': '現在のカテゴリの正規化',
      '産地・国': '産地・国の追加・変更',
      '産地・地域／茶園': '産地・茶園情報の追加・変更',
      '時間帯タグ': '時間帯タグの追加・変更',
      'ミルクティー推奨': 'ミルクティー推奨の確認',
      'アイスティー推奨': 'アイスティー推奨の確認',
      'テインフリー': 'テインフリー情報の確認',
      '燻製茶': '燻製茶情報の確認'
    };
    return structuredLabels[targetColumn] || (targetColumn ? targetColumn + 'の確認' : '情報差分の確認');
  }
  var labels = {
    official_description_translation: '公式説明の日本語確認',
    sales_sku_detected: '販売形式の追加',
    unregistered_reference: '新規銘柄候補',
    unregistered_reference_image: '新規銘柄候補（画像から検出）',
    official_name_changed: '公式名の変更確認'
  };
  return labels[detectionType] || '情報差分の確認';
}

function mfImageCollectorPrepareReviewSheetDisplay_(sheet) {
  var headers = mfImageCollectorSheetHeaders_(sheet);
  var confirmationCol = headers.indexOf('確認内容');
  var decisionCol = headers.indexOf('人間判定');
  var detectionCol = headers.indexOf('検出種別');
  if (confirmationCol < 0 || decisionCol < 0 || detectionCol < 0) throw new Error('Review display columns are missing.');
  mfImageCollectorClearReviewConfirmationValidation_(sheet, confirmationCol + 1, decisionCol + 1);
  SpreadsheetApp.flush();
  mfImageCollectorApplyReviewValidation_(sheet);
  SpreadsheetApp.flush();
  headers = mfImageCollectorSheetHeaders_(sheet);
  confirmationCol = headers.indexOf('確認内容');
  detectionCol = headers.indexOf('検出種別');
  if (confirmationCol < 0 || detectionCol < 0) throw new Error('Review display columns are missing after validation refresh.');
  var rowCount = Math.max(sheet.getLastRow() - 1, 0);
  if (rowCount > 0) {
    var values = sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getValues();
    for (var i = 0; i < values.length; i += 1) {
      if (String(values[i][confirmationCol] || '').trim()) continue;
      var review = mfImageCollectorReviewObject_(headers, values[i]);
      sheet.getRange(i + 2, confirmationCol + 1).setValue(mfImageCollectorReviewConfirmationLabel_(review));
    }
  }
  if (!sheet.isColumnHiddenByUser(detectionCol + 1)) sheet.hideColumns(detectionCol + 1);
}

function mfImageCollectorClearReviewConfirmationValidation_(sheet, confirmationColumn, decisionColumn) {
  var dataRowCount = Math.max(sheet.getMaxRows() - 1, 0);
  var firstColumn = Math.min(confirmationColumn, decisionColumn);
  var columnCount = Math.abs(decisionColumn - confirmationColumn) + 1;
  if (dataRowCount > 0) sheet.getRange(2, firstColumn, dataRowCount, columnCount).clearDataValidations();
}

function mfImageCollectorGetOrCreateTargetQueueSheet_() {
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_TARGET_QUEUE_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MF_IMAGE_COLLECTOR_TARGET_QUEUE_SHEET_NAME);
    sheet.getRange(1, 1, 1, MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS.length).setValues([MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS]);
    sheet.setFrozenRows(1);
  } else {
    var headers = mfImageCollectorSheetHeaders_(sheet);
    for (var i = 0; i < MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS.length; i += 1) {
      if (headers.indexOf(MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS[i]) < 0) {
        var lastColumn = Math.max(sheet.getLastColumn(), 1);
        sheet.insertColumnAfter(lastColumn);
        sheet.getRange(1, lastColumn + 1).setValue(MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS[i]);
        headers.push(MF_IMAGE_COLLECTOR_TARGET_QUEUE_HEADERS[i]);
      }
    }
  }
  mfImageCollectorApplyTargetQueueValidation_(sheet);
  return sheet;
}

function mfImageCollectorApplyTargetQueueValidation_(sheet) {
  var headers = mfImageCollectorSheetHeaders_(sheet);
  var statusCol = headers.indexOf('status') + 1;
  if (statusCol < 1) return;
  var maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, statusCol, maxRows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInList(MF_IMAGE_COLLECTOR_TARGET_QUEUE_STATUSES, true)
      .setAllowInvalid(false)
      .build()
  );
}

function mfImageCollectorQueueRowToObject_(headers, rowValues) {
  var row = {};
  for (var i = 0; i < headers.length; i += 1) {
    row[headers[i]] = mfImageCollectorClientValue_(rowValues[i]);
  }
  return row;
}

function mfImageCollectorNormalizeTargetRequestName_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[®™]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function mfImageCollectorNormalizeTargetRequestRef_(value) {
  var ref = String(value || '').normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '');
  if (!ref) return '';
  if (/^T\d+$/.test(ref)) return ref;
  if (mfImageCollectorIsTfbfReference_(ref)) return ref;
  if (/^(TFG|TJC|TB|TC|TE|TF|TP|TA)\d+$/.test(ref)) return ref;
  if (/^TJ[A-Z0-9]+$/.test(ref)) return ref;
  throw new Error('REFの形式が不正です: ' + ref);
}

function mfImageCollectorNormalizeTargetRequestUrl_(value) {
  var url = String(value || '').trim();
  if (!url) return '';
  var match = url.match(/^https:\/\/([^\/?#]+)(\/[^?#]*)/i);
  if (!match) throw new Error('公式商品URLの形式が不正です。');
  var host = String(match[1] || '').toLowerCase();
  var path = String(match[2] || '');
  var allowed = (
    (host === 'www.mariagefreres.com' && /^\/(en|fr)\//.test(path) && /\.html$/i.test(path)) ||
    (host === 'www.mariagefreres.co.jp' && /^\/view\/item\//.test(path))
  );
  if (!allowed) throw new Error('公式商品URLは mariagefreres.com または mariagefreres.co.jp の商品ページだけ指定できます。');
  return url;
}

function mfImageCollectorNormalizeTargetRequestInput_(input) {
  return {
    target_name: String(input.target_name || input.targetName || '').normalize('NFKC').replace(/\s+/g, ' ').trim(),
    target_ref: mfImageCollectorNormalizeTargetRequestRef_(input.target_ref || input.targetRef || ''),
    target_url: mfImageCollectorNormalizeTargetRequestUrl_(input.target_url || input.targetUrl || '')
  };
}

function mfImageCollectorTargetRequestIdentity_(input) {
  if (input.target_ref) return 'ref:' + input.target_ref;
  return 'name:' + mfImageCollectorNormalizeTargetRequestName_(input.target_name);
}

function mfImageCollectorFindOpenTargetQueueRow_(sheet, headers, input) {
  var identity = mfImageCollectorTargetRequestIdentity_(input);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { row_number: 0, request: null };
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i += 1) {
    var request = mfImageCollectorQueueRowToObject_(headers, values[i]);
    var status = String(request.status || '').trim();
    if (status !== 'pending' && status !== 'processing') continue;
    var rowInput = {
      target_name: request.target_name || '',
      target_ref: request.target_ref || '',
      target_url: request.target_url || ''
    };
    if (mfImageCollectorTargetRequestIdentity_(rowInput) === identity) {
      return { row_number: i + 2, request: request };
    }
  }
  return { row_number: 0, request: null };
}

function mfImageCollectorTargetRequestId_(input) {
  var raw = [
    new Date().toISOString(),
    mfImageCollectorTargetRequestIdentity_(input),
    input.target_url || '',
    Math.random()
  ].join('|');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, raw, Utilities.Charset.UTF_8);
  return digest.map(function(byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('').slice(0, 24);
}

function mfImageCollectorGetTargetDiscoveryRequest_(payload) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = mfImageCollectorGetOrCreateTargetQueueSheet_();
    var headers = mfImageCollectorSheetHeaders_(sheet);
    var statusCol = headers.indexOf('status') + 1;
    var startedCol = headers.indexOf('started_at') + 1;
    if (statusCol < 1) throw new Error('target queue status column is missing.');
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: true, request: null };
    var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < values.length; i += 1) {
      var request = mfImageCollectorQueueRowToObject_(headers, values[i]);
      if (String(request.status || '').trim() !== 'pending') continue;
      var rowNumber = i + 2;
      sheet.getRange(rowNumber, statusCol).setValue('processing');
      if (startedCol > 0) sheet.getRange(rowNumber, startedCol).setValue(new Date());
      request.status = 'processing';
      request.started_at = new Date().toISOString();
      return {
        ok: true,
        request: {
          request_id: request.request_id,
          target_name: request.target_name,
          target_ref: request.target_ref,
          target_url: request.target_url,
          status: request.status
        }
      };
    }
    return { ok: true, request: null };
  } finally {
    lock.releaseLock();
  }
}

function mfImageCollectorCompleteTargetDiscoveryRequest_(payload) {
  var requestId = String(payload.request_id || '').trim();
  if (!requestId) throw new Error('request_id is required.');
  var status = String(payload.status || '').trim();
  if (['completed', 'not_found', 'ambiguous', 'error'].indexOf(status) < 0) {
    throw new Error('Unsupported target request completion status: ' + status);
  }

  var sheet = mfImageCollectorGetOrCreateTargetQueueSheet_();
  var headers = mfImageCollectorSheetHeaders_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Target request not found: ' + requestId);
  var requestIdCol = headers.indexOf('request_id');
  if (requestIdCol < 0) throw new Error('target queue request_id column is missing.');
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][requestIdCol] || '').trim() !== requestId) continue;
    var rowNumber = i + 2;
    mfImageCollectorSetTargetQueueRowValues_(sheet, rowNumber, {
      status: status,
      completed_at: new Date(),
      result_reference: String(payload.result_reference || '').trim(),
      result_name: String(payload.result_name || '').trim(),
      result_status: String(payload.result_status || status).trim(),
      message: String(payload.message || '').slice(0, 2000)
    });
    return { ok: true, request_id: requestId, status: status, row_number: rowNumber };
  }
  throw new Error('Target request not found: ' + requestId);
}

function mfImageCollectorSetTargetQueueRowValues_(sheet, rowNumber, updates) {
  var headers = mfImageCollectorSheetHeaders_(sheet);
  for (var key in updates) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    var col = headers.indexOf(key) + 1;
    if (col > 0) sheet.getRange(rowNumber, col).setValue(updates[key]);
  }
}

function mfImageCollectorApplyReviewValidation_(sheet) {
  var headers = mfImageCollectorSheetHeaders_(sheet);
  var statusCol = headers.indexOf('ステータス') + 1;
  var decisionCol = headers.indexOf('人間判定') + 1;
  var maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  if (statusCol > 0) {
    sheet.getRange(2, statusCol, maxRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(MF_IMAGE_COLLECTOR_REVIEW_STATUSES, true).setAllowInvalid(false).build()
    );
  }
  if (decisionCol > 0) {
    var dataRowCount = Math.max(sheet.getLastRow() - 1, 0);
    if (dataRowCount > 0) {
      var values = sheet.getRange(2, 1, dataRowCount, sheet.getLastColumn()).getValues();
      var groupStart = 0;
      var groupOptions = null;
      var groupKey = '';
      for (var i = 0; i < values.length; i += 1) {
        var review = mfImageCollectorReviewObject_(headers, values[i]);
        var options = mfImageCollectorReviewDecisionOptions_(review);
        var key = options.join('\n');
        if (groupOptions === null) {
          groupStart = i;
          groupOptions = options;
          groupKey = key;
        } else if (key !== groupKey) {
          mfImageCollectorSetReviewDecisionValidation_(sheet, decisionCol, groupStart + 2, i - groupStart, groupOptions);
          groupStart = i;
          groupOptions = options;
          groupKey = key;
        }
      }
      mfImageCollectorSetReviewDecisionValidation_(sheet, decisionCol, groupStart + 2, values.length - groupStart, groupOptions);
    }
    if (maxRows > dataRowCount) {
      mfImageCollectorSetReviewDecisionValidation_(sheet, decisionCol, dataRowCount + 2, maxRows - dataRowCount, MF_IMAGE_COLLECTOR_REVIEW_DECISIONS);
    }
  }
}

function mfImageCollectorSetReviewDecisionValidation_(sheet, decisionCol, startRow, rowCount, options) {
  if (rowCount < 1) return;
  sheet.getRange(startRow, decisionCol, rowCount, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build()
  );
}

function mfImageCollectorReviewCandidateToRow_(candidate, detectionId) {
  var officialInfo = {
    urls_by_language: candidate.official_urls_by_language || {},
    names_by_language: candidate.official_names_by_language || {},
    description_snippets_by_language: candidate.description_snippets_by_language || {},
    categories_by_language: candidate.categories_by_language || {},
    official_category: candidate.official_category || '',
    primary_reference: candidate.primary_reference || candidate.reference || '',
    primary_reference_type: candidate.primary_reference_type || '',
    t_reference: candidate.t_reference || '',
    sales_references: candidate.sales_references || {},
    sales_prefix: candidate.sales_prefix || '',
    sku_only: candidate.sku_only === true,
    discovered_image_url: candidate.discovered_image_url || '',
    discovered_image_type: candidate.discovered_image_type || '',
    discovered_image_source_url: candidate.discovered_image_source_url || '',
    discovery_evidence_type: candidate.discovery_evidence_type || '',
    evidence_level: candidate.evidence_level || '',
    resolved_image_url: candidate.resolved_image_url || '',
    image_width: candidate.image_width || 0,
    image_height: candidate.image_height || 0,
    official_page_url: candidate.official_page_url || '',
    official_page_verified: candidate.official_page_verified === true,
    master_absence_confirmed: candidate.master_absence_confirmed === true,
    similar_master_candidates: candidate.similar_master_candidates || [],
    structured_fact: candidate.structured_fact || null
  };
  var row = {
    '検出ID': detectionId,
    '検出日時': candidate.detected_at ? new Date(candidate.detected_at) : new Date(),
    'Tリファレンス番号': String(candidate.reference || '').trim(),
    '公式名': String(candidate.official_name || '').trim(),
    '検出種別': String(candidate.detection_type || '').trim(),
    '公式URL': String(candidate.official_url || '').trim(),
    '言語': String(candidate.source_language || '').trim(),
    'DB既存T': String(candidate.existing_reference || '').trim(),
    'DB既存VersionKey': String(candidate.existing_version_key || '').trim(),
    'DB既存名': String(candidate.existing_name || '').trim(),
    '差分概要': String(candidate.diff_summary || '').trim(),
    'Collectorが取得した根拠': String(candidate.evidence || '').trim(),
    'ステータス': String(candidate.status || '要確認').trim(),
    '確認内容': '',
    '人間判定': String(candidate.human_decision || '').trim(),
    '対象VersionKey': String(candidate.target_version_key || '').trim(),
    'コメント': String(candidate.comment || '').trim(),
    '処理日時': '',
    'FR公式URL': String(candidate.fr_official_url || (candidate.official_urls_by_language && candidate.official_urls_by_language.FR) || '').trim(),
    'EN公式URL': String(candidate.en_official_url || (candidate.official_urls_by_language && candidate.official_urls_by_language.EN) || '').trim(),
    'JP公式URL': String(candidate.jp_official_url || (candidate.official_urls_by_language && candidate.official_urls_by_language.JP) || '').trim(),
    '確認言語': String(candidate.source_language || '').trim(),
    '公式名称差': String(candidate.official_name_differences || '').trim(),
    '公式説明抜粋': String(candidate.description_excerpt || '').trim(),
    'DB存在確認': candidate.master_absence_confirmed === true ? '銘柄マスターに存在しない' : '',
    'DB類似候補': mfImageCollectorStableJson_(candidate.similar_master_candidates || []),
    'Discovery source': mfImageCollectorStableJson_(candidate.discovery_sources || []),
    '公式情報JSON': mfImageCollectorStableJson_(officialInfo),
    '対象列': String(candidate.target_column || '').trim(),
    '現在値': String(candidate.current_value || '').trim(),
    '候補値': String(candidate.suggested_value || '').trim(),
    '承認済み日本語説明': '',
    '根拠原文': String(candidate.evidence_text || '').trim(),
    '根拠言語': String(candidate.evidence_language || '').trim(),
    '根拠URL': String(candidate.evidence_url || '').trim(),
    'source_type': String(candidate.source_type || '').trim(),
    'confidence': String(candidate.confidence || '').trim()
  };
  row['確認内容'] = mfImageCollectorReviewConfirmationLabel_(row);
  return row;
}

function mfImageCollectorStableJson_(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function mfImageCollectorReviewDedupeKey_(candidate) {
  var raw = mfImageCollectorReviewIdentity_(candidate);
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, raw, Utilities.Charset.UTF_8);
  return digest.map(function(byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function mfImageCollectorReviewIdentity_(candidate) {
  var type = String(candidate.detection_type || 'review_candidate').trim();
  var reference = String(candidate.reference || '').trim().toUpperCase();
  if (type === 'unregistered_reference') return type + '|' + reference;
  if (type === 'unregistered_reference_image') return type + '|' + reference;
  if (type === 'sales_sku_detected') return type + '|' + reference;
  if (type === 'structured_fact') {
    return type + '|' + reference + '|' + String(candidate.existing_version_key || candidate.target_version_key || '').trim() + '|' + String(candidate.target_column || '').trim() + '|' + String(candidate.suggested_value || '').trim();
  }
  if (type === 'official_name_changed') {
    return type + '|' + reference + '|' + String(candidate.existing_version_key || candidate.target_version_key || '').trim();
  }
  return type + '|' + reference + '|' + String(candidate.existing_version_key || '').trim();
}

function mfImageCollectorFindReviewRow_(sheet, headers, detectionId) {
  var idCol = headers.indexOf('検出ID');
  if (idCol < 0 || sheet.getLastRow() < 2) return -1;
  var values = sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][0] || '') === detectionId) return i + 2;
  }
  return -1;
}

function mfImageCollectorFindReviewRowByIdentity_(sheet, headers, candidate) {
  if (sheet.getLastRow() < 2) return -1;
  var refCol = headers.indexOf('Tリファレンス番号');
  var typeCol = headers.indexOf('検出種別');
  var versionCol = headers.indexOf('DB既存VersionKey');
  if (refCol < 0 || typeCol < 0) return -1;

  var type = String(candidate.detection_type || '').trim();
  var reference = String(candidate.reference || '').trim().toUpperCase();
  var versionKey = String(candidate.existing_version_key || candidate.target_version_key || '').trim();
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i += 1) {
    var rowType = String(values[i][typeCol] || '').trim();
    var rowReference = String(values[i][refCol] || '').trim().toUpperCase();
    if (rowType !== type || rowReference !== reference) continue;
    if (type === 'structured_fact') {
      var rowVersionForStructured = versionCol >= 0 ? String(values[i][versionCol] || '').trim() : '';
      var targetColumnCol = headers.indexOf('対象列');
      var suggestedValueCol = headers.indexOf('候補値');
      var rowTargetColumn = targetColumnCol >= 0 ? String(values[i][targetColumnCol] || '').trim() : '';
      var rowSuggestedValue = suggestedValueCol >= 0 ? String(values[i][suggestedValueCol] || '').trim() : '';
      if (rowVersionForStructured !== versionKey || rowTargetColumn !== String(candidate.target_column || '').trim() || rowSuggestedValue !== String(candidate.suggested_value || '').trim()) continue;
    }
    if (type === 'official_name_changed') {
      var rowVersion = versionCol >= 0 ? String(values[i][versionCol] || '').trim() : '';
      if (rowVersion !== versionKey) continue;
    }
    return i + 2;
  }
  return -1;
}

function mfImageCollectorSetReviewRowValues_(sheet, rowNumber, updates) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  Object.keys(updates).forEach(function(header) {
    if (typeof updates[header] === 'undefined') return;
    var col = headers.indexOf(header);
    if (col >= 0) sheet.getRange(rowNumber, col + 1).setValue(updates[header]);
  });
}

function mfImageCollectorGetReviewSummary() {
  var sheet = mfImageCollectorGetOrCreateReviewSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, pending_count: 0, hold_count: 0, oldest_pending_at: '' };
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var statusCol = headers.indexOf('ステータス');
  var detectedAtCol = headers.indexOf('検出日時');
  var pendingCount = 0;
  var holdCount = 0;
  var oldest = null;
  for (var i = 1; i < values.length; i += 1) {
    var status = String(values[i][statusCol] || '');
    if (status === '要確認') {
      pendingCount += 1;
      var detected = values[i][detectedAtCol];
      if (detected && (!oldest || detected < oldest)) oldest = detected;
    }
    if (status === '保留') holdCount += 1;
  }
  return {
    ok: true,
    pending_count: pendingCount,
    hold_count: holdCount,
    oldest_pending_at: oldest ? Utilities.formatDate(new Date(oldest), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : ''
  };
}

function mfImageCollectorApplyApprovedReview_(review, decision, targetVersionKey, options) {
  if (decision === '誤検出' || decision === '保留') return;
  options = options || {};
  if (String(review['検出種別'] || '').trim() === 'official_description_translation') {
    if (decision !== '既存銘柄を更新') {
      throw new Error('official_description_translation can only be approved as an existing row update.');
    }
    return mfImageCollectorApplyOfficialDescriptionTranslation_(review, options);
  }
  if (String(review['検出種別'] || '').trim() === 'structured_fact') {
    return mfImageCollectorApplyStructuredFact_(review, options);
  }
  if (decision === '販売SKUとして追加') {
    return mfImageCollectorApplySalesSku_(review, targetVersionKey, options);
  }
  if (decision === '既存銘柄と同一' || decision === '終売情報として更新') return;

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var versionCol = headers.indexOf('VersionKey');
  var primaryRefCol = headers.indexOf('Primary Reference');
  var refCol = headers.indexOf('Tリファレンス番号');
  var nameCol = headers.indexOf('現在の公式名');
  var urlCol = headers.indexOf('公式商品ページURL');
  if (versionCol < 0 || refCol < 0 || nameCol < 0) throw new Error('Master columns required for approved review are missing.');

  if (decision === '新規銘柄として追加' || decision === '既存銘柄の新バージョンとして追加') {
    var referenceInfo = mfImageCollectorReviewReferenceInfo_(review);
    var reference = referenceInfo.primaryReference;
    var versionKey = String(targetVersionKey || mfImageCollectorNextVersionKey_(values, headers, reference)).trim().toUpperCase();
    mfImageCollectorAssertAppendVersionKey_(values, headers, reference, versionKey);
    var versionLabel = mfImageCollectorVersionLabelFromVersionKey_(reference, versionKey);
    var newRow = mfImageCollectorBuildApprovedNewTeaRow_(headers, review, referenceInfo, versionKey, versionLabel);
    if (!options.dry_run) mfImageCollectorAppendMasterRow_(sheet, headers, newRow);
    return { target_version_key: versionKey };
  }

  if (decision === '既存銘柄を更新') {
    var row = mfImageCollectorFindMasterRowByVersionOrReference_(values, headers, targetVersionKey, String(review['Tリファレンス番号'] || ''));
    if (row < 2) throw new Error('Target master row was not found.');
    if (!options.dry_run) {
      if (review['公式名']) sheet.getRange(row, nameCol + 1).setValue(review['公式名']);
      if (urlCol >= 0 && review['公式URL']) sheet.getRange(row, urlCol + 1).setValue(review['公式URL']);
    }
    return { target_version_key: targetVersionKey || String(review['対象VersionKey'] || review['DB既存VersionKey'] || '').trim() };
  }
}

function mfImageCollectorApplyOfficialDescriptionTranslation_(review, options) {
  options = options || {};
  var targetVersionKey = String(review['対象VersionKey'] || review['DB既存VersionKey'] || '').trim();
  var approvedDescription = String(options.approved_japanese_description || '').trim();
  var candidateCurrentValue = String(review['現在値'] || '').trim();
  if (!targetVersionKey) throw new Error('official_description_translation target_version_key is required.');
  if (!approvedDescription) throw new Error('Human-approved Japanese description is required.');

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var targetRow = mfImageCollectorFindMasterRowByVersionOrReference_(values, headers, targetVersionKey, '');
  if (targetRow < 2) throw new Error('Target master row was not found for official_description_translation: ' + targetVersionKey);
  var descriptionCol = headers.indexOf('現在の公式説明');
  if (descriptionCol < 0) throw new Error('現在の公式説明 column was not found.');

  var range = sheet.getRange(targetRow, descriptionCol + 1);
  var actualCurrentValue = String(range.getValue() || '').trim();
  if (actualCurrentValue !== candidateCurrentValue) {
    throw new Error('Master official description changed after translation candidate was created: expected "' + candidateCurrentValue + '" but found "' + actualCurrentValue + '".');
  }
  if (!options.dry_run) range.setValue(approvedDescription);
  return { target_version_key: targetVersionKey };
}

function mfImageCollectorApplyStructuredFact_(review, options) {
  options = options || {};
  var targetVersionKey = String(options.target_version_key || review['対象VersionKey'] || review['DB既存VersionKey'] || '').trim();
  var targetColumn = String(review['対象列'] || '').trim();
  var candidateCurrentValue = String(review['現在値'] || '').trim();
  var suggestedValue = String(review['候補値'] || '').trim();
  if (!targetColumn) throw new Error('structured_fact target_column is required.');
  if (!suggestedValue) throw new Error('structured_fact suggested_value is required.');
  if (!mfImageCollectorStructuredFactAllowedColumns_()[targetColumn]) {
    throw new Error('structured_fact cannot update this column: ' + targetColumn);
  }

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var resolved = null;
  if (!targetVersionKey) {
    resolved = mfImageCollectorResolveStructuredFactMasterRow_(values, headers, review);
    mfImageCollectorAssertStructuredFactResolution_(resolved);
    targetVersionKey = resolved.version_key;
  }
  var targetRow = resolved
    ? resolved.row_number
    : mfImageCollectorFindMasterRowByVersionOrReference_(values, headers, targetVersionKey, '');
  if (targetRow < 2) throw new Error('Target master row was not found for structured_fact: ' + targetVersionKey);
  var targetCol = headers.indexOf(targetColumn);
  if (targetCol < 0) throw new Error('Target master column was not found for structured_fact: ' + targetColumn);

  var range = sheet.getRange(targetRow, targetCol + 1);
  var actualCurrentValue = String(range.getValue() || '').trim();
  var evaluation = mfImageCollectorEvaluateStructuredFactChange_(targetColumn, actualCurrentValue, candidateCurrentValue, suggestedValue);
  if (!evaluation.already_applied && evaluation.next_value !== actualCurrentValue && !options.dry_run) {
    range.setValue(evaluation.next_value);
  }
  return {
    target_version_key: targetVersionKey,
    auto_resolved: !!resolved,
    reference: resolved ? resolved.reference : '',
    name: resolved ? resolved.name : '',
    already_applied: evaluation.already_applied
  };
}

function mfImageCollectorStructuredFactAllowedColumns_() {
  return {
    '現在のカテゴリ': true,
    '産地・国': true,
    '産地・地域／茶園': true,
    '香味大分類': true,
    '香味詳細タグ': true,
    '燻製茶': true,
    'ミルクティー推奨': true,
    'アイスティー推奨': true,
    'テインフリー': true,
    '時間帯タグ': true
  };
}

function mfImageCollectorStructuredFactMultiValueColumns_() {
  return {
    '産地・国': true,
    '産地・地域／茶園': true,
    '香味大分類': true,
    '香味詳細タグ': true,
    '時間帯タグ': true
  };
}

function mfImageCollectorStructuredFactNextValue_(targetColumn, actualCurrentValue, candidateCurrentValue, suggestedValue) {
  return mfImageCollectorEvaluateStructuredFactChange_(targetColumn, actualCurrentValue, candidateCurrentValue, suggestedValue).next_value;
}

function mfImageCollectorEvaluateStructuredFactChange_(targetColumn, actualCurrentValue, candidateCurrentValue, suggestedValue) {
  var actual = String(actualCurrentValue || '').trim();
  var expected = String(candidateCurrentValue || '').trim();
  var incoming = targetColumn === '香味大分類'
    ? mfImageCollectorNormalizeApprovedAromaCategoryValue_(suggestedValue)
    : mfImageCollectorNormalizeStructuredFactValue_(targetColumn, suggestedValue);
  if (mfImageCollectorStructuredFactMultiValueColumns_()[targetColumn]) {
    var values = mfImageCollectorDelimitedValues_(actual);
    var expectedValues = mfImageCollectorDelimitedValues_(expected);
    var incomingValues = mfImageCollectorDelimitedValues_(incoming);
    var alreadyApplied = incomingValues.length > 0 && incomingValues.every(function(value) {
      if (values.indexOf(value) >= 0) return true;
      return targetColumn === '香味詳細タグ' && values.some(function(existingValue) {
        return mfImageCollectorAromaDetailAlreadyRepresented_(existingValue, value);
      });
    });
    if (alreadyApplied) return { already_applied: true, next_value: actual };
    var currentChanged = expectedValues.some(function(expectedValue) {
      return values.indexOf(expectedValue) < 0;
    });
    if (currentChanged) {
      throw new Error('Master value changed after structured_fact candidate was created: ' + targetColumn + ' expected "' + expected + '" but found "' + actual + '".');
    }
    for (var j = 0; j < incomingValues.length; j += 1) {
      if (values.indexOf(incomingValues[j]) < 0) values.push(incomingValues[j]);
    }
    return { already_applied: false, next_value: values.join('、') };
  }
  var normalizedActual = mfImageCollectorNormalizeStructuredFactValue_(targetColumn, actual);
  var normalizedExpected = mfImageCollectorNormalizeStructuredFactValue_(targetColumn, expected);
  if (normalizedActual === incoming) return { already_applied: true, next_value: actual };
  if (normalizedActual !== normalizedExpected) {
    throw new Error('Master value changed after structured_fact candidate was created: ' + targetColumn + ' expected "' + expected + '" but found "' + actual + '".');
  }
  return { already_applied: false, next_value: incoming };
}

function mfImageCollectorCanonicalAromaDetailTerm_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/ヴァニラ/g, 'バニラ')
    .trim();
}

function mfImageCollectorAromaDetailAlreadyRepresented_(existingValue, candidateValue) {
  var existing = mfImageCollectorCanonicalAromaDetailTerm_(existingValue);
  var candidate = mfImageCollectorCanonicalAromaDetailTerm_(candidateValue);
  if (!existing || !candidate) return false;
  if (existing === candidate) return true;
  if (candidate === '花') {
    return /^(?:白い花|白花|花の香り|フローラルな花)$/.test(existing);
  }
  if (candidate.length < 3) return false;
  var escapedCandidate = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var modifier = '(?:軽い|淡い|ほのかな|柔らかな|やわらかな|甘い|濃厚な|繊細な|上品な|豊かな|爽やかな)';
  var suffix = '(?:の香り|香り)?';
  return new RegExp('^' + modifier + escapedCandidate + suffix + '$').test(existing);
}

function mfImageCollectorNormalizeStructuredFactValue_(targetColumn, value) {
  if (targetColumn === '香味大分類') {
    return mfImageCollectorNormalizeAromaCategoriesForMaster_(value, '').value;
  }
  if (targetColumn === '現在のカテゴリ') {
    return mfImageCollectorNormalizeClassificationValueForMaster_(value);
  }
  if (targetColumn === '茶種タグ') {
    return mfImageCollectorNormalizeTeaTypeTagsForMaster_(value);
  }
  return String(value || '').trim();
}

function mfImageCollectorNormalizeApprovedAromaCategoryValue_(value) {
  var raw = String(value || '').trim();
  if (!raw) throw new Error('香味大分類 candidate value is empty.');
  var safeMap = {
    '木質': ['ウッディ'],
    '甘香': ['甘香・菓子'],
    '甘香・木質': ['甘香・菓子', 'ウッディ'],
    '乳香': ['甘香・菓子'],
    '旨味': []
  };
  var normalized = safeMap.hasOwnProperty(raw) ? safeMap[raw] : [raw];
  var allowed = mfImageCollectorAromaCategoryOrder_();
  for (var i = 0; i < normalized.length; i += 1) {
    if (allowed.indexOf(normalized[i]) < 0) {
      throw new Error('香味大分類 is not in the approved 14-category whitelist: ' + raw);
    }
  }
  return mfImageCollectorOrderedUniqueAromaCategories_(normalized).join('、');
}

function mfImageCollectorDelimitedValues_(value) {
  return String(value || '').split(/[、,;／|\n]+/).map(function(part) {
    return String(part).trim();
  }).filter(Boolean);
}

function mfImageCollectorVersionLabelFromVersionKey_(reference, versionKey) {
  var ref = String(reference || '').trim().toUpperCase();
  var key = String(versionKey || '').trim().toUpperCase();
  mfImageCollectorAssertPrimaryReference_(ref);
  var match = key.match(new RegExp('^' + ref + '-(B\\d{2})$'));
  if (!match) {
    throw new Error('VersionKey and バージョン are inconsistent: ' + key);
  }
  return match[1];
}

function mfImageCollectorBuildApprovedNewTeaRow_(headers, review, referenceInfo, versionKey, versionLabel) {
  var reference = referenceInfo.primaryReference;
  var officialCategory = mfImageCollectorNormalizeClassificationValueForMaster_(mfImageCollectorReviewOfficialCategory_(review));
  if (mfImageCollectorIsTfbfReference_(reference)) officialCategory = 'ティザン';
  var teaTypeTag = mfImageCollectorTeaTypeTagFromCategory_(officialCategory);
  var officialDescription = mfImageCollectorReviewOfficialDescriptionForMaster_(review);
  var officialUrl = String(review['公式URL'] || '').trim();
  var salesRefs = referenceInfo.salesReferences || {};
  var salesEvidence = mfImageCollectorSalesSkuEvidence_(review);
  return headers.map(function(header) {
    if (header === 'VersionKey') return versionKey;
    if (header === 'Primary Reference') return reference;
    if (header === 'バージョン') return versionLabel;
    if (header === 'Tリファレンス番号') return referenceInfo.tReference || '';
    if (header === '現在の公式名') return review['公式名'] || '';
    if (header === '現在の公式説明') return officialDescription;
    if (header === '現在のカテゴリ') return officialCategory;
    if (header === '茶種タグ') return teaTypeTag;
    if (header === '燻製茶' && mfImageCollectorIsSmokyTeaReference_(reference, salesRefs)) return 'はい';
    if (header === '公式商品ページURL') return officialUrl;
    if (header === '公式商品ページURL状態') return officialUrl ? 'available' : 'pending';
    if (header === '黒い本掲載') return 'いいえ';
    if (header === '茶葉画像状態' || header === '茶葉サムネイル状態' || header === '水色画像状態') return 'pending';
    for (var prefix in salesRefs) {
      var mapping = mfImageCollectorSalesSkuColumns_(prefix);
      if (!mapping || !salesRefs[prefix]) continue;
      if (header === mapping.flag) return 'はい';
      if (header === mapping.reference) return salesRefs[prefix];
      if (header === mapping.kind) return prefix;
      if (header === mapping.evidence) return salesEvidence;
    }
    return '';
  });
}

function mfImageCollectorFindMasterAppendRow_(sheet, headers) {
  var versionCol = headers.indexOf('VersionKey');
  if (versionCol < 0) throw new Error('VersionKey column is missing.');
  var maxRows = sheet.getMaxRows();
  if (maxRows < 2) return 2;
  var versionValues = sheet.getRange(2, versionCol + 1, maxRows - 1, 1).getValues();
  var lastDataRow = 1;
  for (var i = 0; i < versionValues.length; i += 1) {
    if (String(versionValues[i][0] || '').trim()) lastDataRow = i + 2;
  }
  return lastDataRow + 1;
}

function mfImageCollectorAppendMasterRow_(sheet, headers, rowValues) {
  var versionCol = headers.indexOf('VersionKey');
  if (versionCol < 0) throw new Error('VersionKey column is missing.');
  var appendRow = mfImageCollectorFindMasterAppendRow_(sheet, headers);
  if (appendRow > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), appendRow - sheet.getMaxRows());
  }
  if (String(sheet.getRange(appendRow, versionCol + 1).getValue() || '').trim()) {
    throw new Error('Master append target VersionKey cell is no longer blank: row ' + appendRow);
  }
  sheet.getRange(appendRow, 1, 1, headers.length).setValues([rowValues]);
  return appendRow;
}

function mfImageCollectorReviewReferenceInfo_(review) {
  var rawReference = String(review['Tリファレンス番号'] || '').trim().toUpperCase();
  var info = {};
  try {
    info = JSON.parse(String(review['公式情報JSON'] || '{}'));
  } catch (error) {
    info = {};
  }
  var primary = String(info.primary_reference || rawReference).trim().toUpperCase();
  mfImageCollectorAssertPrimaryReference_(primary);
  var salesRefs = {};
  var infoSalesRefs = info.sales_references || {};
  Object.keys(infoSalesRefs).forEach(function(prefix) {
    var normalizedPrefix = String(prefix || '').trim().toUpperCase();
    var mapping = mfImageCollectorSalesSkuColumns_(normalizedPrefix);
    if (!mapping) return;
    var tokens = mfImageCollectorDelimitedValues_(infoSalesRefs[prefix]).filter(function(token) {
      return mfImageCollectorSalesSkuInfo_(token) !== null;
    });
    if (tokens.length) salesRefs[normalizedPrefix] = tokens.join('、');
  });

  var primarySku = mfImageCollectorSalesSkuInfo_(primary);
  if (primarySku && !salesRefs[primarySku.prefix]) salesRefs[primarySku.prefix] = primarySku.sku;
  var tReference = String(info.t_reference || '').trim().toUpperCase();
  if (mfImageCollectorIsTfbfReference_(primary) && tReference === primary) tReference = '';
  if (!tReference && /^T\d+$/.test(primary)) tReference = primary;
  if (tReference && !/^T\d+$/.test(tReference)) throw new Error('Invalid T reference in review candidate: ' + tReference);

  return {
    primaryReference: primary,
    primaryReferenceType: primarySku ? 'sales_sku' : 'tea',
    tReference: tReference,
    salesReferences: salesRefs,
    skuOnly: primarySku !== null && !tReference
  };
}

function mfImageCollectorReviewOfficialCategory_(review) {
  try {
    var info = JSON.parse(String(review['公式情報JSON'] || '{}'));
    return String(info.official_category || '').trim();
  } catch (error) {
    return '';
  }
}

function mfImageCollectorReviewOfficialDescriptionForMaster_(review) {
  try {
    var info = JSON.parse(String(review['公式情報JSON'] || '{}'));
    var approved = String(info.approved_japanese_description || info.planned_japanese_description || '').trim();
    if (approved) return approved;
    var snippets = info.description_snippets_by_language || {};
    var jp = String(snippets.JP || snippets.jp || '').trim();
    if (jp) return jp;
  } catch (error) {
    // Fall through to the flat review fields below.
  }
  var language = String(review['言語'] || review['確認言語'] || '').trim().toUpperCase();
  if (language === 'JP') return String(review['公式説明抜粋'] || '').trim();
  return '';
}

function mfImageCollectorTeaTypeTagFromCategory_(category) {
  var normalized = mfImageCollectorNormalizeClassificationValueForMaster_(category);
  if (!normalized) return '';
  var direct = ['黒茶', '青茶', '緑茶', '白茶', '黄茶', '後発酵茶', 'ルイボス', 'ティザン', 'マテ', 'インフュージョン'];
  for (var i = 0; i < direct.length; i += 1) {
    if (normalized.indexOf(direct[i]) === 0 || normalized.indexOf(direct[i] + '／') === 0 || normalized.indexOf(direct[i] + ',') === 0) {
      return direct[i];
    }
  }
  return mfImageCollectorNormalizeTeaTypeTagsForMaster_(normalized);
}

function mfImageCollectorApplySalesSku_(review, targetVersionKey, options) {
  options = options || {};
  var salesIdentity = mfImageCollectorReviewSalesSkuIdentity_(review);
  if (salesIdentity.conflict) throw new Error('表示REFと公式情報JSONの販売SKUが一致しません。');
  var skuInfo = salesIdentity.sku_info;
  var sku = skuInfo ? skuInfo.sku : '';
  if (!skuInfo) throw new Error('Unsupported sales SKU reference: ' + sku);

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var parent = mfImageCollectorResolveSalesSkuParent_(review, targetVersionKey, skuInfo, values, headers);
  if (!parent) throw new Error('Target master row was not found for sales SKU: ' + sku);
  var targetRow = parent.row_number;

  var mapping = mfImageCollectorSalesSkuColumns_(skuInfo.prefix);
  if (!mapping) throw new Error('Unsupported sales SKU prefix: ' + skuInfo.prefix);

  ['flag', 'reference', 'kind', 'evidence'].forEach(function(key) {
    if (mapping[key] && headers.indexOf(mapping[key]) < 0) {
      throw new Error('Required sales SKU column is missing: ' + mapping[key]);
    }
  });

  var evidence = mfImageCollectorSalesSkuEvidence_(review);
  if (!options.dry_run) {
    if (mapping.flag) mfImageCollectorSetCellByHeader_(sheet, headers, targetRow, mapping.flag, 'はい');
    if (mapping.reference) mfImageCollectorAppendDelimitedCellByHeader_(sheet, headers, targetRow, mapping.reference, sku);
    if (mapping.kind) mfImageCollectorAppendDelimitedCellByHeader_(sheet, headers, targetRow, mapping.kind, skuInfo.prefix);
    if (mapping.evidence) mfImageCollectorAppendDelimitedCellByHeader_(sheet, headers, targetRow, mapping.evidence, evidence);
  }
  return { target_version_key: parent.version_key };
}

function mfImageCollectorSalesSkuInfo_(sku) {
  var normalized = String(sku || '').trim().toUpperCase();
  var numeric = normalized.match(/^(TFG|TJC|TB|TC|TE|TF|TP|TA)(\d{2,6})$/);
  if (numeric) return { sku: normalized, prefix: numeric[1], suffix: numeric[2], numericSuffix: true };
  var tj = normalized.match(/^(TJ)([A-Z0-9]{2,8})$/);
  if (tj) return { sku: normalized, prefix: tj[1], suffix: tj[2], numericSuffix: false };
  return null;
}

function mfImageCollectorSalesSkuColumns_(prefix) {
  var map = {
    TB: { flag: 'ティーバッグ版', reference: 'TBリファレンス', evidence: 'TB根拠／出典' },
    TC: { flag: 'クラシック缶版', reference: 'TCリファレンス', evidence: 'TC根拠／出典' },
    TE: { flag: 'トール缶版', reference: 'TEリファレンス', evidence: 'TE根拠／出典' },
    TF: { flag: 'ガラスフラコン版', reference: 'TFリファレンス', evidence: 'TF根拠／出典' },
    TFG: { flag: '水出し用ブレンド', reference: '水出し用リファレンス', evidence: '水出し用根拠／出典' },
    TP: { flag: 'ティーパケット版', reference: 'TPリファレンス', evidence: 'TP根拠／出典' },
    TA: { flag: 'TA装丁版', reference: 'TAリファレンス', evidence: 'TA根拠／出典' },
    TJ: { flag: 'カリグラフィー缶版', reference: 'TJリファレンス', evidence: 'TJ根拠／出典' },
    TJC: { flag: '和紙装丁缶版', reference: 'TJCリファレンス', evidence: 'TJC根拠／出典' }
  };
  return map[prefix] || null;
}

function mfImageCollectorResolveSalesSkuParent_(review, targetVersionKey, skuInfo, values, headers) {
  var versionCol = headers.indexOf('VersionKey');
  var refCol = headers.indexOf('Tリファレンス番号');
  if (versionCol < 0 || refCol < 0) throw new Error('Required Master identity columns are missing for sales SKU resolution.');
  var candidates = mfImageCollectorSalesSkuParentRows_(values, headers);

  var explicitVersionKey = String(targetVersionKey || review['対象VersionKey'] || '').trim().toUpperCase();
  if (explicitVersionKey) {
    var explicitMatches = candidates.filter(function(candidate) { return candidate.version_key === explicitVersionKey; });
    if (explicitMatches.length !== 1) throw new Error('Explicit target VersionKey is not a unique T parent row: ' + explicitVersionKey);
    return explicitMatches[0];
  }

  var existingVersionKey = String(review['DB既存VersionKey'] || '').trim().toUpperCase();
  if (existingVersionKey) {
    var versionMatches = candidates.filter(function(candidate) { return candidate.version_key === existingVersionKey; });
    if (versionMatches.length !== 1) throw new Error('DB existing VersionKey is not a unique T parent row: ' + existingVersionKey);
    return versionMatches[0];
  }

  var existingReference = String(review['DB既存T'] || '').trim().toUpperCase();
  if (/^T\d+$/.test(existingReference)) {
    var referenceMatches = candidates.filter(function(candidate) { return candidate.reference === existingReference; });
    return mfImageCollectorSelectSalesSkuParentCandidate_(referenceMatches, review, 'DB既存T ' + existingReference);
  }

  var salesRefCols = mfImageCollectorSalesSkuReferenceColumns_(headers);
  var existingSkuMatches = candidates.filter(function(candidate) {
    for (var i = 0; i < salesRefCols.length; i += 1) {
      var tokens = mfImageCollectorDelimitedValues_(values[candidate.row_number - 1][salesRefCols[i]]).map(function(value) {
        return String(value).trim().toUpperCase();
      });
      if (tokens.indexOf(skuInfo.sku) >= 0) return true;
    }
    return false;
  });
  if (existingSkuMatches.length) {
    return mfImageCollectorSelectSalesSkuParentCandidate_(existingSkuMatches, review, '既存販売SKU ' + skuInfo.sku);
  }

  if (!skuInfo.numericSuffix) return null;
  var candidateReference = 'T' + skuInfo.suffix;
  var reviewNames = mfImageCollectorSalesSkuReviewNames_(review);
  if (!reviewNames.length) return null;
  var currentMatches = candidates.filter(function(candidate) {
    if (candidate.reference !== candidateReference) return false;
    return candidate.names.some(function(name) { return reviewNames.indexOf(name) >= 0; });
  });
  if (!currentMatches.length) return null;
  return mfImageCollectorSelectSalesSkuParentCandidate_(currentMatches, review, skuInfo.sku + ' name-confirmed current Master match');
}

function mfImageCollectorSalesSkuParentRows_(values, headers) {
  var versionCol = headers.indexOf('VersionKey');
  var refCol = headers.indexOf('Tリファレンス番号');
  var nameCols = ['現在の公式名', '銘柄名（黒い本）', '日本語名（黒い本）'].map(function(header) { return headers.indexOf(header); });
  var urlCol = headers.indexOf('公式商品ページURL');
  var rows = [];
  for (var i = 1; i < values.length; i += 1) {
    var versionKey = String(values[i][versionCol] || '').trim().toUpperCase();
    var reference = String(values[i][refCol] || '').trim().toUpperCase();
    if (!versionKey || !/^T\d+$/.test(reference) || versionKey.indexOf(reference + '-B') !== 0) continue;
    var names = nameCols.map(function(col) {
      return col >= 0 ? mfImageCollectorNormalizeNameForCompare_(values[i][col]) : '';
    }).filter(Boolean);
    rows.push({
      row_number: i + 1,
      version_key: versionKey,
      reference: reference,
      name: nameCols[0] >= 0 ? String(values[i][nameCols[0]] || '').trim() : '',
      names: names,
      url: urlCol >= 0 ? mfImageCollectorNormalizeUrlForCompare_(values[i][urlCol]) : ''
    });
  }
  return rows;
}

function mfImageCollectorSalesSkuReviewNames_(review) {
  var values = [review['公式名'], review['DB既存名']];
  var info = mfImageCollectorReviewOfficialInfo_(review);
  values.push(info.official_name, info.current_official_name, info.name);
  var names = [];
  for (var i = 0; i < values.length; i += 1) {
    var normalized = mfImageCollectorNormalizeNameForCompare_(values[i]);
    if (normalized && names.indexOf(normalized) < 0) names.push(normalized);
  }
  return names;
}

function mfImageCollectorSelectSalesSkuParentCandidate_(candidates, review, source) {
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return null;
  var urls = mfImageCollectorStructuredFactReviewUrls_(review);
  if (urls.length) {
    var urlMatches = candidates.filter(function(candidate) { return candidate.url && urls.indexOf(candidate.url) >= 0; });
    if (urlMatches.length === 1) return urlMatches[0];
  }
  throw new Error('Sales SKU parent row is ambiguous for ' + source + '; specify target VersionKey explicitly.');
}

function mfImageCollectorResolveSalesSkuParentReference_(review, targetVersionKey, skuInfo) {
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var parent = mfImageCollectorResolveSalesSkuParent_(review, targetVersionKey, skuInfo, values, headers);
  if (!parent) throw new Error('Explicit or safely resolved parent T reference is required for sales SKU: ' + skuInfo.sku);
  return parent.reference;
}

function mfImageCollectorSalesSkuEvidence_(review) {
  var parts = [];
  var officialUrl = String(review['公式URL'] || '').trim();
  var evidence = String(review['Collectorが取得した根拠'] || '').trim();
  if (officialUrl) parts.push('公式URL: ' + officialUrl);
  if (evidence) parts.push(evidence);
  return parts.join(' / ');
}

function mfImageCollectorSetCellByHeader_(sheet, headers, row, header, value) {
  var col = headers.indexOf(header);
  if (col < 0) throw new Error('Required sales SKU column is missing: ' + header);
  sheet.getRange(row, col + 1).setValue(value);
}

function mfImageCollectorAppendDelimitedCellByHeader_(sheet, headers, row, header, value) {
  var col = headers.indexOf(header);
  if (col < 0) throw new Error('Required sales SKU column is missing: ' + header);
  var range = sheet.getRange(row, col + 1);
  var existing = String(range.getValue() || '').trim();
  var incoming = String(value || '').trim();
  if (!incoming) return;
  var values = existing ? existing.split(/[、,;／|\n]+/).map(function(part) { return String(part).trim(); }).filter(Boolean) : [];
  if (values.indexOf(incoming) < 0) values.push(incoming);
  range.setValue(values.join('、'));
}

function mfImageCollectorFindMasterRowByVersionOrReference_(values, headers, versionKey, reference) {
  var versionCol = headers.indexOf('VersionKey');
  var primaryRefCol = headers.indexOf('Primary Reference');
  var refCol = headers.indexOf('Tリファレンス番号');
  var salesRefCols = mfImageCollectorSalesSkuReferenceColumns_(headers);
  var normalizedVersionKey = String(versionKey || '').trim().toUpperCase();
  var normalizedReference = String(reference || '').trim().toUpperCase();
  for (var i = 1; i < values.length; i += 1) {
    var rowVersionKey = versionCol >= 0 ? String(values[i][versionCol] || '').trim().toUpperCase() : '';
    if (normalizedVersionKey && versionCol >= 0 && rowVersionKey === normalizedVersionKey) return i + 1;
    if (normalizedReference && primaryRefCol >= 0 && String(values[i][primaryRefCol] || '').trim().toUpperCase() === normalizedReference) return i + 1;
    if (normalizedReference && refCol >= 0 && String(values[i][refCol] || '').trim().toUpperCase() === normalizedReference) return i + 1;
    if (normalizedReference && mfImageCollectorSalesSkuInfo_(normalizedReference)) {
      for (var j = 0; j < salesRefCols.length; j += 1) {
        var tokens = mfImageCollectorDelimitedValues_(values[i][salesRefCols[j]]);
        if (tokens.map(function(token) { return String(token).trim().toUpperCase(); }).indexOf(normalizedReference) >= 0) return i + 1;
      }
    }
    if (normalizedReference && versionCol >= 0 && rowVersionKey.indexOf(normalizedReference + '-B') === 0) return i + 1;
  }
  return -1;
}

function mfImageCollectorPrimaryReferenceHeaderInfo_(sheet) {
  var lastColumn = sheet.getLastColumn();
  var rawHeaders = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    : [];
  var matches = [];
  for (var i = 0; i < rawHeaders.length; i += 1) {
    var raw = String(rawHeaders[i] || '');
    var trimmed = raw.trim();
    if (trimmed === 'Primary Reference') {
      if (raw !== trimmed) {
        throw new Error('Ambiguous Primary Reference header with surrounding whitespace at column ' + (i + 1));
      }
      matches.push(i + 1);
    }
  }
  if (matches.length > 1) throw new Error('Duplicate Primary Reference columns found.');
  return {
    column_exists: matches.length === 1,
    column_index: matches.length === 1 ? matches[0] : lastColumn + 1,
    header_count: lastColumn
  };
}

function mfImageCollectorEnsurePrimaryReferenceColumn_(payload) {
  var dryRun = payload.dry_run !== false;
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var info = mfImageCollectorPrimaryReferenceHeaderInfo_(sheet);
  var added = false;
  if (!info.column_exists && !dryRun) {
    sheet.insertColumnAfter(info.header_count);
    sheet.getRange(1, info.header_count + 1).setValue('Primary Reference');
    added = true;
    info = mfImageCollectorPrimaryReferenceHeaderInfo_(sheet);
  }
  if (!dryRun && info.column_exists && sheet.getMaxRows() > 1) {
    sheet.getRange(2, info.column_index, sheet.getMaxRows() - 1, 1).clearDataValidations();
  }
  return {
    ok: true,
    dry_run: dryRun,
    column_exists: info.column_exists,
    added: added,
    column_index: info.column_index,
    header_count: info.header_count
  };
}

function mfImageCollectorPrimaryReferenceIsAllowed_(reference, item) {
  var ref = String(reference || '').trim().toUpperCase();
  if (/^T\d+$/.test(ref)) return true;
  if (/^TFBF\d+$/.test(ref)) return true;
  if (/^TFG\d+$/.test(ref)) {
    var source = String(item.derivation_source || '').trim();
    var salesRefs = mfImageCollectorDelimitedValues_((item.expected_sales_sku_references || []).join ? item.expected_sales_sku_references.join('、') : item.expected_sales_sku_references)
      .map(function(value) { return String(value || '').trim().toUpperCase(); });
    return source === 'sales_sku_reference' && salesRefs.indexOf(ref) >= 0;
  }
  return false;
}

function mfImageCollectorPrimaryReferenceSalesRefsForRow_(values, headers, rowIndex) {
  var cols = mfImageCollectorSalesSkuReferenceColumns_(headers);
  var out = [];
  for (var i = 0; i < cols.length; i += 1) {
    var tokens = mfImageCollectorDelimitedValues_(values[rowIndex][cols[i]]);
    for (var j = 0; j < tokens.length; j += 1) {
      var token = String(tokens[j] || '').trim().toUpperCase();
      if (token && out.indexOf(token) < 0) out.push(token);
    }
  }
  return out;
}

function mfImageCollectorPrimaryReferenceBackfillResult_(item, result, reason, rowNumber, oldValue) {
  return {
    version_key: String(item.version_key || '').trim(),
    row_number: rowNumber || item.row_number || '',
    old_value: typeof oldValue === 'undefined' ? '' : oldValue,
    new_value: String(item.new_primary_reference || '').trim().toUpperCase(),
    result: result,
    reason: reason
  };
}

function mfImageCollectorValidatePrimaryReferenceBackfillItem_(item, values, headers, primaryCol) {
  var versionKey = String(item.version_key || '').trim().toUpperCase();
  var newPrimary = String(item.new_primary_reference || '').trim().toUpperCase();
  if (!versionKey) return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'invalid', 'version_key is required');
  if (!newPrimary) return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'invalid', 'new_primary_reference is required');
  if (/-N\d{2}$/i.test(versionKey) && /^T\d{7,}$/i.test(newPrimary)) {
    return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'invalid', 'legacy N01 long reference is not eligible');
  }
  if (!mfImageCollectorPrimaryReferenceIsAllowed_(newPrimary, item)) {
    return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'invalid', 'new_primary_reference is not an allowed primary reference');
  }
  var versionCol = headers.indexOf('VersionKey');
  if (versionCol < 0) return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'invalid', 'VersionKey column is missing');
  var matches = [];
  for (var i = 1; i < values.length; i += 1) {
    if (String(values[i][versionCol] || '').trim().toUpperCase() === versionKey) matches.push(i);
  }
  if (matches.length === 0) return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'stale', 'VersionKey not found');
  if (matches.length > 1) return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'conflict', 'Duplicate VersionKey rows found');

  var rowIndex = matches[0];
  var rowNumber = rowIndex + 1;
  var currentPrimary = String(values[rowIndex][primaryCol] || '').trim();
  var expectedPrimary = String(item.expected_current_primary_reference || '').trim();
  if (currentPrimary !== expectedPrimary) {
    return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'conflict', 'Current Primary Reference does not match expected value', rowNumber, currentPrimary);
  }

  var refCol = headers.indexOf('Tリファレンス番号');
  var expectedT = String(item.expected_t_reference || '').trim().toUpperCase();
  if (refCol >= 0) {
    var currentT = String(values[rowIndex][refCol] || '').trim().toUpperCase();
    if (currentT !== expectedT) {
      return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'stale', 'Tリファレンス番号 changed', rowNumber, currentPrimary);
    }
  }

  var expectedSales = mfImageCollectorDelimitedValues_((item.expected_sales_sku_references || []).join ? item.expected_sales_sku_references.join('、') : item.expected_sales_sku_references)
    .map(function(value) { return String(value || '').trim().toUpperCase(); })
    .sort();
  var currentSales = mfImageCollectorPrimaryReferenceSalesRefsForRow_(values, headers, rowIndex).sort();
  if (expectedSales.join('|') !== currentSales.join('|')) {
    return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'stale', 'sales SKU references changed', rowNumber, currentPrimary);
  }

  return mfImageCollectorPrimaryReferenceBackfillResult_(item, 'validated', 'validated', rowNumber, currentPrimary);
}

function mfImageCollectorPrimaryReferenceBackfillSummary_(results) {
  var summary = {
    requested: results.length,
    validated: 0,
    written: 0,
    skipped: 0,
    stale: 0,
    conflict: 0,
    invalid: 0,
    missing_column: 0,
    errors: 0
  };
  for (var i = 0; i < results.length; i += 1) {
    var key = results[i].result;
    if (key === 'would_write') key = 'validated';
    if (summary.hasOwnProperty(key)) summary[key] += 1;
  }
  return summary;
}

function mfImageCollectorBackfillPrimaryReferences_(payload) {
  var dryRun = payload.dry_run !== false;
  var items = Array.isArray(payload.items) ? payload.items : [];
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  if (values.length < 1) throw new Error('Sheet has no header row.');
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var info = mfImageCollectorPrimaryReferenceHeaderInfo_(sheet);
  var results = [];
  if (!info.column_exists) {
    for (var m = 0; m < items.length; m += 1) {
      results.push(mfImageCollectorPrimaryReferenceBackfillResult_(items[m], 'missing_column', 'Primary Reference column is missing'));
    }
    var missingSummary = mfImageCollectorPrimaryReferenceBackfillSummary_(results);
    return Object.assign({ ok: true, dry_run: dryRun, results: results }, missingSummary);
  }

  var primaryCol = info.column_index - 1;
  for (var i = 0; i < items.length; i += 1) {
    var validation = mfImageCollectorValidatePrimaryReferenceBackfillItem_(items[i], values, headers, primaryCol);
    if (validation.result === 'validated') {
      if (dryRun) {
        validation.result = 'would_write';
      } else {
        sheet.getRange(validation.row_number, primaryCol + 1).setValue(validation.new_value);
        values[validation.row_number - 1][primaryCol] = validation.new_value;
        validation.result = 'written';
      }
    }
    results.push(validation);
  }
  var summary = mfImageCollectorPrimaryReferenceBackfillSummary_(results);
  return Object.assign({ ok: true, dry_run: dryRun, results: results }, summary);
}

function mfImageCollectorRepairStructuredFactTargetVersions_(payload) {
  var dryRun = payload.dry_run !== false;
  var reviewSheet = mfImageCollectorGetOrCreateReviewSheet_();
  var ss = mfImageCollectorOpenSpreadsheet_();
  var masterSheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!masterSheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);

  var reviewValues = reviewSheet.getDataRange().getValues();
  if (reviewValues.length < 2) return { ok: true, dry_run: dryRun, repaired: 0, candidates: [], skipped: [] };
  var reviewHeaders = reviewValues[0].map(function(value) { return String(value).trim(); });
  var masterValues = masterSheet.getDataRange().getValues();
  var masterHeaders = masterValues[0].map(function(value) { return String(value).trim(); });
  var targetVersionCol = reviewHeaders.indexOf('対象VersionKey');
  var dbVersionCol = reviewHeaders.indexOf('DB既存VersionKey');
  var dbRefCol = reviewHeaders.indexOf('DB既存T');
  var dbNameCol = reviewHeaders.indexOf('DB既存名');
  var suggestedValueCol = reviewHeaders.indexOf('候補値');
  if (targetVersionCol < 0 || dbVersionCol < 0 || dbRefCol < 0 || dbNameCol < 0 || suggestedValueCol < 0) {
    throw new Error('Review sheet is missing DB/target VersionKey columns.');
  }

  var candidates = [];
  var skipped = [];
  for (var i = 1; i < reviewValues.length; i += 1) {
    var review = {};
    for (var j = 0; j < reviewHeaders.length; j += 1) review[reviewHeaders[j]] = reviewValues[i][j];
    if (String(review['検出種別'] || '').trim() !== 'structured_fact') continue;
    if (String(review['対象VersionKey'] || review['DB既存VersionKey'] || '').trim()) continue;
    var resolved = mfImageCollectorResolveStructuredFactMasterRow_(masterValues, masterHeaders, review);
    if (resolved.ok) {
      var normalizedSuggestedValue = mfImageCollectorRepairStructuredFactSuggestedValue_(review);
      if (!normalizedSuggestedValue.ok) {
        skipped.push({
          row_number: i + 1,
          reference: String(review['Tリファレンス番号'] || '').trim(),
          target_column: String(review['対象列'] || '').trim(),
          suggested_value: String(review['候補値'] || '').trim(),
          reason: normalizedSuggestedValue.reason,
          matches: [{ row_number: resolved.row_number, version_key: resolved.version_key, name: resolved.name }]
        });
        continue;
      }
      var update = {
        row_number: i + 1,
        reference: String(review['Tリファレンス番号'] || '').trim(),
        target_column: String(review['対象列'] || '').trim(),
        suggested_value: normalizedSuggestedValue.value,
        original_suggested_value: normalizedSuggestedValue.original_value,
        suggested_value_changed: normalizedSuggestedValue.changed,
        version_key: resolved.version_key,
        master_row_number: resolved.row_number,
        name: resolved.name,
        reason: resolved.reason
      };
      candidates.push(update);
      if (!dryRun) {
        reviewSheet.getRange(i + 1, targetVersionCol + 1).setValue(resolved.version_key);
        reviewSheet.getRange(i + 1, dbVersionCol + 1).setValue(resolved.version_key);
        reviewSheet.getRange(i + 1, dbRefCol + 1).setValue(resolved.reference);
        reviewSheet.getRange(i + 1, dbNameCol + 1).setValue(resolved.name);
        if (normalizedSuggestedValue.changed) {
          reviewSheet.getRange(i + 1, suggestedValueCol + 1).setValue(normalizedSuggestedValue.value);
        }
      }
    } else {
      skipped.push({
        row_number: i + 1,
        reference: String(review['Tリファレンス番号'] || '').trim(),
        target_column: String(review['対象列'] || '').trim(),
        suggested_value: String(review['候補値'] || '').trim(),
        reason: resolved.reason,
        matches: resolved.matches || []
      });
    }
  }
  return { ok: true, dry_run: dryRun, repaired: dryRun ? 0 : candidates.length, candidates: candidates, skipped: skipped };
}

function mfImageCollectorRepairStructuredFactSuggestedValue_(review) {
  var targetColumn = String(review['対象列'] || '').trim();
  var original = String(review['候補値'] || '').trim();
  if (targetColumn !== '香味大分類') {
    return { ok: true, value: original, original_value: original, changed: false };
  }
  var normalized = mfImageCollectorNormalizeStructuredFactValue_(targetColumn, original);
  if (!normalized) {
    return {
      ok: false,
      reason: 'unknown aroma taxonomy value',
      value: '',
      original_value: original,
      changed: false
    };
  }
  return {
    ok: true,
    value: normalized,
    original_value: original,
    changed: normalized !== original
  };
}

function mfImageCollectorResolveStructuredFactTargetFromMaster_(review) {
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var resolved = mfImageCollectorResolveStructuredFactMasterRow_(values, headers, review);
  mfImageCollectorAssertStructuredFactResolution_(resolved);
  return resolved;
}

function mfImageCollectorAssertStructuredFactResolution_(resolved) {
  if (resolved && resolved.ok) return;
  var reason = resolved && resolved.reason ? resolved.reason : 'unknown resolution error';
  throw new Error('structured_fact の対象VersionKeyを安全に自動解決できません: ' + reason);
}

function mfImageCollectorResolveStructuredFactMasterRow_(values, headers, review) {
  var reference = String(review['Tリファレンス番号'] || '').trim().toUpperCase();
  if (!reference) return { ok: false, reason: 'reference missing' };
  var versionCol = headers.indexOf('VersionKey');
  var primaryRefCol = headers.indexOf('Primary Reference');
  var refCol = headers.indexOf('Tリファレンス番号');
  var nameCol = headers.indexOf('現在の公式名');
  var urlCol = headers.indexOf('公式商品ページURL');
  if (versionCol < 0 || refCol < 0) return { ok: false, reason: 'required master columns missing' };

  var matches = [];
  for (var i = 1; i < values.length; i += 1) {
    var versionKey = String(values[i][versionCol] || '').trim();
    if (!versionKey) continue;
    var rowPrimaryRef = primaryRefCol >= 0 ? String(values[i][primaryRefCol] || '').trim().toUpperCase() : '';
    var rowRef = String(values[i][refCol] || '').trim().toUpperCase();
    var versionPrefix = String(versionKey || '').trim().toUpperCase().match(/^([A-Z]+\d[A-Z0-9]*)-[BN]\d{2}$/);
    if (rowPrimaryRef !== reference && rowRef !== reference && (!versionPrefix || versionPrefix[1] !== reference)) continue;
    matches.push({
      row_number: i + 1,
      version_key: versionKey,
      reference: rowPrimaryRef || rowRef,
      name: nameCol >= 0 ? String(values[i][nameCol] || '').trim() : '',
      url: urlCol >= 0 ? String(values[i][urlCol] || '').trim() : ''
    });
  }
  if (matches.length === 1) return mfImageCollectorStructuredFactResolvedRow_(matches[0], 'single reference match');

  var urls = mfImageCollectorStructuredFactReviewUrls_(review);
  if (urls.length) {
    var urlMatches = matches.filter(function(match) {
      return urls.indexOf(mfImageCollectorNormalizeUrlForCompare_(match.url)) >= 0;
    });
    if (urlMatches.length === 1) return mfImageCollectorStructuredFactResolvedRow_(urlMatches[0], 'official URL match');
  }

  var name = mfImageCollectorNormalizeNameForCompare_(review['公式名']);
  if (name) {
    var nameMatches = matches.filter(function(match) {
      return mfImageCollectorNormalizeNameForCompare_(match.name) === name;
    });
    if (nameMatches.length === 1) return mfImageCollectorStructuredFactResolvedRow_(nameMatches[0], 'official name match');
  }

  return {
    ok: false,
    reason: matches.length ? 'target row ambiguous' : 'no master row for reference',
    matches: matches.map(function(match) { return { row_number: match.row_number, version_key: match.version_key, name: match.name, url: match.url }; })
  };
}

function mfImageCollectorStructuredFactResolvedRow_(match, reason) {
  return {
    ok: true,
    reason: reason,
    row_number: match.row_number,
    version_key: match.version_key,
    reference: match.reference,
    name: match.name
  };
}

function mfImageCollectorStructuredFactReviewUrls_(review) {
  var values = [
    review['公式URL'],
    review['根拠URL'],
    review['FR公式URL'],
    review['EN公式URL'],
    review['JP公式URL']
  ];
  try {
    var info = JSON.parse(String(review['公式情報JSON'] || '{}') || '{}');
    if (info.official_page_url) values.push(info.official_page_url);
    if (info.urls_by_language) {
      values.push(info.urls_by_language.FR);
      values.push(info.urls_by_language.EN);
      values.push(info.urls_by_language.JP);
    }
  } catch (error) {
  }
  var out = [];
  for (var i = 0; i < values.length; i += 1) {
    var normalized = mfImageCollectorNormalizeUrlForCompare_(values[i]);
    if (normalized && out.indexOf(normalized) < 0) out.push(normalized);
  }
  return out;
}

function mfImageCollectorNormalizeUrlForCompare_(rawUrl) {
  var value = String(rawUrl || '').trim();
  if (!value) return '';
  return value.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}

function mfImageCollectorNormalizeNameForCompare_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[®™]/g, '')
    .replace(/[’‘´`]/g, "'")
    .replace(/[^A-Za-z0-9À-ÿ一-龠ぁ-んァ-ヶー]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function mfImageCollectorNextVersionKey_(values, headers, reference) {
  var versionCol = headers.indexOf('VersionKey');
  if (versionCol < 0) throw new Error('VersionKey column is missing.');
  var ref = String(reference || '').trim().toUpperCase();
  mfImageCollectorAssertPrimaryReference_(ref);
  var prefix = ref + '-B';
  var max = 0;
  for (var i = 1; i < values.length; i += 1) {
    var value = String(values[i][versionCol] || '');
    var match = value.match(new RegExp('^' + ref + '-B(\\d{2})$'));
    if (!match) continue;
    var number = Number(match[1]);
    if (number > max) max = number;
  }
  return prefix + ('0' + (max + 1)).slice(-2);
}

function mfImageCollectorAssertAppendVersionKey_(values, headers, reference, versionKey) {
  var versionCol = headers.indexOf('VersionKey');
  if (versionCol < 0) throw new Error('VersionKey column is missing.');
  var ref = String(reference || '').trim().toUpperCase();
  var key = String(versionKey || '').trim().toUpperCase();
  mfImageCollectorAssertPrimaryReference_(ref);
  if (!new RegExp('^' + ref + '-B\\d{2}$').test(key)) {
    throw new Error('VersionKey must use the B-series for this reference: ' + ref + '-B##');
  }
  for (var i = 1; i < values.length; i += 1) {
    if (String(values[i][versionCol] || '').trim().toUpperCase() === key) {
      throw new Error('VersionKey already exists: ' + key);
    }
  }
}

function mfImageCollectorAssertPrimaryReference_(reference) {
  var ref = String(reference || '').trim().toUpperCase();
  if (/^T\d+$/.test(ref)) return;
  if (mfImageCollectorIsTfbfReference_(ref)) return;
  if (mfImageCollectorSalesSkuInfo_(ref)) return;
  throw new Error('Invalid primary reference for VersionKey: ' + reference);
}

function mfImageCollectorIsTfbfReference_(reference) {
  return /^TFBF\d+$/.test(String(reference || '').trim().toUpperCase());
}

function mfImageCollectorIsSmokyTeaReference_(reference, salesReferences) {
  var primary = String(reference || '').trim().toUpperCase();
  if (/^T429[1-5]$/.test(primary)) return true;
  var refs = salesReferences || {};
  for (var prefix in refs) {
    if (/^TP429[1-5]$/.test(String(refs[prefix] || '').trim().toUpperCase())) return true;
  }
  return false;
}

function mfImageCollectorSalesSkuReferenceColumns_(headers) {
  var cols = [];
  var seen = {};
  ['TB', 'TC', 'TE', 'TF', 'TFG', 'TP', 'TA', 'TJ', 'TJC'].forEach(function(prefix) {
    var mapping = mfImageCollectorSalesSkuColumns_(prefix);
    if (!mapping || !mapping.reference) return;
    var col = headers.indexOf(mapping.reference);
    if (col >= 0 && !seen[col]) {
      seen[col] = true;
      cols.push(col);
    }
  });
  return cols;
}

function mfImageCollectorReviewHtml_() {
  return `<!doctype html><html><head><base target="_top"><style>
body{font-family:Arial,sans-serif;margin:20px;color:#222}
button,select,input,textarea{font:inherit;margin:4px 0}
textarea{display:block;width:100%;min-height:56px}
.item{border:1px solid #ddd;padding:12px;margin:12px 0}
.item.structured{padding:10px 12px}
.head{font-size:18px;font-weight:700}
.structured .head{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}
.section{border-top:1px solid #eee;margin-top:10px;padding-top:10px}
.structured .section{margin-top:8px;padding-top:8px}
.section h3{font-size:13px;margin:0 0 6px;color:#555}
.muted{color:#666}
.url{word-break:break-all}
.kv{margin:3px 0}
.change{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0}
.pill{border:1px solid #ddd;background:#fafafa;border-radius:4px;padding:4px 8px}
.candidate{font-weight:700}
.evidence{margin:8px 0;line-height:1.45}
.thumb{width:128px;height:128px;object-fit:contain;border:1px solid #ddd;background:#fafafa}
.image-card{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.image-meta{min-width:260px;flex:1}
.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.error{background:#fff2f2;border:1px solid #f2b8b8;color:#8a1f1f;padding:10px;margin:10px 0}
</style></head><body><h2>変更候補レビュー</h2><div id="summary">読み込み中...</div><div id="items">読み込み中...</div><script>
function esc(s){return String(s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function parseInfo(it){try{return JSON.parse(it['公式情報JSON']||'{}')||{};}catch(e){return {};}}
function dbStatus(it){return it['DB存在確認']||(it['DB既存T']||it['DB既存VersionKey']||it['DB既存名']?'DB既存データあり':'DB既存データなし');}
function fail(where,e){document.getElementById(where).innerHTML='<div class="error">'+esc((e&&e.message)||e||'読み込みエラー')+'</div>';}
function link(label,url){return url?'<div class="url"><b>'+esc(label)+'</b>: <a href="'+esc(url)+'" target="_blank">'+esc(url)+'</a></div>':'';}
function decisionOptions(it){
  var info=parseInfo(it);
  var displayRef=String(it['Tリファレンス番号']||'').toUpperCase();
  var jsonRef=String(info.primary_reference||'').toUpperCase();
  var isSales=function(ref){return /^(TFG|TJC|TB|TC|TE|TF|TP|TA)\\d+$/.test(ref)||/^TJ[A-Z0-9]+$/.test(ref);};
  if(isSales(displayRef)||isSales(jsonRef))return ['販売SKUとして追加','誤検出','保留'];
  return ['新規銘柄として追加','既存銘柄を更新','既存銘柄の新バージョンとして追加','既存銘柄と同一','終売情報として更新','誤検出','保留'];
}
function actionControls(it,idx){
  var options=decisionOptions(it).map(function(value){return '<option>'+esc(value)+'</option>';}).join('');
  return '<div class="section"><h3>判定</h3><div class="actions"><select id="d'+idx+'">'+options+'</select><input id="v'+idx+'" placeholder="対象VersionKey"><textarea id="c'+idx+'" placeholder="コメント"></textarea><button onclick="apply('+idx+','+it.row_number+')">反映</button></div></div>';
}
function structuredActionControls(it,idx){
  return '<div class="section"><h3>判定</h3><div class="muted">対象VersionKey: '+esc(it['対象VersionKey']||it['DB既存VersionKey']||'')+'</div><div class="actions"><select id="d'+idx+'"><option value="保留">保留</option><option value="既存銘柄を更新">承認</option><option value="誤検出">却下</option></select><textarea id="c'+idx+'" placeholder="コメント"></textarea><button onclick="apply('+idx+','+it.row_number+')">反映</button></div></div>';
}
function translationActionControls(it,idx){
  return '<div class="section"><h3>判定</h3><textarea id="t'+idx+'" placeholder="人間が確認・修正した日本語説明"></textarea><div class="actions"><select id="d'+idx+'"><option value="保留">保留</option><option value="既存銘柄を更新">承認</option><option value="誤検出">却下</option></select><textarea id="c'+idx+'" placeholder="コメント"></textarea><button onclick="apply('+idx+','+it.row_number+')">反映</button></div></div>';
}
function renderStructured(it,idx){
  var lang=it['根拠言語']||it['確認言語']||it['言語']||'';
  var source=it['source_type']||'';
  var confidence=it['confidence']||'';
  return '<div class="item structured"><div class="head"><span>'+esc(it['公式名'])+'</span><span class="muted">'+esc(it['Tリファレンス番号'])+'</span></div><div class="muted">'+esc(it['検出種別'])+' / '+esc(it['ステータス'])+'</div><div class="section"><h3>'+esc(it['対象列'])+'</h3><div class="change"><span class="pill">現在: '+esc(it['現在値']||'なし')+'</span><span>→</span><span class="pill candidate">候補: '+esc(it['候補値'])+'</span></div></div><div class="section"><h3>根拠</h3><div class="evidence">'+esc(it['根拠原文']||'')+'</div><div class="muted">'+esc(lang)+'公式 / '+esc(source)+' / confidence: '+esc(confidence)+'</div>'+link('公式ページ',it['根拠URL']||it['公式URL'])+'</div>'+structuredActionControls(it,idx)+'</div>';
}
function renderTranslation(it,idx){
  var target=it['対象VersionKey']||it['DB既存VersionKey']||'';
  var lang=it['根拠言語']||it['確認言語']||it['言語']||'';
  return '<div class="item structured"><div class="head"><span>'+esc(it['公式名'])+'</span><span class="muted">'+esc(it['Tリファレンス番号'])+'</span></div><div class="muted">'+esc(it['検出種別'])+' / '+esc(it['ステータス'])+'</div><div class="section"><h3>対象</h3><div class="kv">対象VersionKey: '+esc(target)+'</div><div class="kv">現在の公式説明: '+esc(it['現在値']||'なし')+'</div></div><div class="section"><h3>原文</h3><div class="evidence">'+esc(it['根拠原文']||it['公式説明抜粋']||'')+'</div><div class="muted">'+esc(lang)+'公式</div>'+link('根拠URL',it['根拠URL']||it['公式URL'])+'</div>'+translationActionControls(it,idx)+'</div>';
}
function renderImageReview(it,idx){
  var info=parseInfo(it);
  var imageUrl=info.resolved_image_url||info.discovered_image_url||'';
  var verified=info.official_page_verified===true;
  var label=verified?'公式商品ページ確認済み':'画像のみ・公式商品ページ未確認';
  var img=imageUrl?'<img class="thumb" src="'+esc(imageUrl)+'" onerror="this.replaceWith(document.createTextNode(\\'画像なし\\'))">':'<div class="thumb muted">画像なし</div>';
  return '<div class="item"><div class="head">'+esc(it['Tリファレンス番号'])+' '+esc(it['公式名']||'')+'</div><div class="muted">'+esc(it['検出種別'])+' / '+esc(label)+' / '+esc(it['ステータス'])+'</div><div class="section image-card">'+img+'<div class="image-meta"><div class="kv">画像種別: '+esc(info.discovered_image_type||'')+'</div><div class="kv">証拠状態: '+esc(info.evidence_level||info.discovery_evidence_type||'image_only')+'</div><div class="kv">サイズ: '+esc(info.image_width||'')+' x '+esc(info.image_height||'')+'</div>'+link('発見元',info.discovered_image_source_url||'')+link('画像URL',imageUrl)+link('公式商品ページ',info.official_page_url||it['公式URL'])+'</div></div><div class="section"><h3>差分・根拠</h3><div class="kv">'+esc(it['差分概要'])+'</div><div class="kv"><b>根拠</b><br>'+esc(it['Collectorが取得した根拠'])+'</div></div>'+actionControls(it,idx)+'</div>';
}
function renderGeneric(it,idx){
  return '<div class="item"><div class="head">'+esc(it['Tリファレンス番号'])+' '+esc(it['公式名'])+'</div><div class="muted">'+esc(it['検出種別'])+' / '+esc(it['確認言語']||it['言語'])+' / '+esc(it['検出日時'])+' / '+esc(it['ステータス'])+'</div><div class="section"><h3>現在の公式情報</h3><div class="kv">公式名: '+esc(it['公式名'])+'</div><div class="kv">確認言語: '+esc(it['確認言語']||it['言語'])+'</div>'+link('FR',it['FR公式URL'])+link('EN',it['EN公式URL'])+link('JP',it['JP公式URL'])+link('代表URL',it['公式URL'])+'<div class="kv">名称差: '+esc(it['公式名称差']||'')+'</div><div class="kv">説明: '+esc(it['公式説明抜粋']||'')+'</div></div><div class="section"><h3>DBの現在情報</h3><div class="kv">'+esc(dbStatus(it))+'</div><div class="kv">DB既存T: '+esc(it['DB既存T']||'なし')+'</div><div class="kv">DB VersionKey: '+esc(it['DB既存VersionKey']||'なし')+'</div><div class="kv">DB Name: '+esc(it['DB既存名']||'なし')+'</div><div class="kv">類似候補: '+esc(it['DB類似候補']||'[]')+'</div></div><div class="section"><h3>差分・根拠</h3><div class="kv">'+esc(it['差分概要'])+'</div><div class="kv"><b>根拠</b><br>'+esc(it['Collectorが取得した根拠'])+'</div><div class="kv">Discovery source: '+esc(it['Discovery source']||'')+'</div></div>'+actionControls(it,idx)+'</div>';
}
function load(){
  google.script.run.withSuccessHandler(render).withFailureHandler(function(e){fail('items',e);}).mfImageCollectorGetReviewItems('要確認');
  google.script.run.withSuccessHandler(function(s){document.getElementById('summary').textContent='要確認 '+s.pending_count+'件 / 最古 '+(s.oldest_pending_at||'なし');}).withFailureHandler(function(e){fail('summary',e);}).mfImageCollectorGetReviewSummary();
}
function render(items){
  document.getElementById('items').innerHTML=(items||[]).map(function(it,idx){
    if(it['検出種別']==='unregistered_reference_image')return renderImageReview(it,idx);
    if(it['検出種別']==='official_description_translation')return renderTranslation(it,idx);
    return it['検出種別']==='structured_fact'?renderStructured(it,idx):renderGeneric(it,idx);
  }).join('')||'要確認はありません';
}
function apply(idx,row){
  var versionInput=document.getElementById('v'+idx);
  var translationInput=document.getElementById('t'+idx);
  google.script.run.withSuccessHandler(load).withFailureHandler(function(e){alert((e&&e.message)||e);}).mfImageCollectorApplyReviewDecision(row,document.getElementById('d'+idx).value,versionInput?versionInput.value:'',document.getElementById('c'+idx).value,translationInput?translationInput.value:'');
}
load();
</script></body></html>`;
}

function mfImageCollectorUpdateProductPageUrl_(payload) {
  mfImageCollectorAssertSecret_(payload);

  var reference = String(payload.reference || '').trim();
  if (!reference) throw new Error('reference is required.');

  var status = mfImageCollectorNormalizeProductUrlStatus_(payload.status);
  var productPageUrl = String(payload.product_page_url || '').trim();
  if (status === 'available') {
    if (!productPageUrl) throw new Error('product_page_url is required when status is available.');
    if (
      productPageUrl.indexOf('https://www.mariagefreres.com/fr/') !== 0 &&
      productPageUrl.indexOf('https://www.mariagefreres.com/en/') !== 0 &&
      productPageUrl.indexOf('https://www.mariagefreres.co.jp/view/item/') !== 0
    ) {
      throw new Error('Unexpected product_page_url host.');
    }
    if (!mfImageCollectorUrlHasExactReference_(productPageUrl, reference)) {
      throw new Error('product_page_url does not contain the exact reference.');
    }
  }

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Sheet has no data rows.');

  var headers = values[0].map(function(value) { return String(value).trim(); });
  var refCol = headers.indexOf('Tリファレンス番号');
  var productUrlCol = headers.indexOf('公式商品ページURL');
  var productUrlStatusCol = mfImageCollectorEnsureHeader_(sheet, headers, '公式商品ページURL状態');
  if (refCol < 0 || productUrlCol < 0) throw new Error('Required product URL columns are missing.');

  var rowIndex = mfImageCollectorFindMasterRowByVersionOrReference_(values, headers, '', reference) - 1;
  if (rowIndex < 0) throw new Error('Reference not found: ' + reference);

  if (status === 'available') {
    sheet.getRange(rowIndex + 1, productUrlCol + 1).setValue(productPageUrl);
  }
  sheet.getRange(rowIndex + 1, productUrlStatusCol + 1).setValue(status);

  return {
    ok: true,
    reference: reference,
    sheet_row: rowIndex + 1,
    product_page_url: status === 'available' ? productPageUrl : '',
    status: status
  };
}

function mfImageCollectorUpdateMasterOfficialInfo_(payload) {
  mfImageCollectorAssertSecret_(payload);

  var reference = String(payload.reference || '').trim();
  if (!reference) throw new Error('reference is required.');
  var versionKey = String(payload.version_key || '').trim();
  var productPageUrl = String(payload.product_page_url || '').trim();
  var officialDescription = String(payload.official_description || '').trim();
  var officialDescriptionOriginal = String(payload.official_description_original || '').trim();
  var officialDescriptionSourceLanguage = String(payload.official_description_source_language || payload.source_language || '').trim();
  var officialDescriptionSourceUrl = String(payload.official_description_source_url || payload.source_url || '').trim();
  var officialCategory = mfImageCollectorNormalizeClassificationValueForMaster_(payload.official_category);
  if (!officialDescription && !officialCategory) throw new Error('official_description or official_category is required.');
  if (productPageUrl && !mfImageCollectorUrlHasExactReference_(productPageUrl, reference)) {
    throw new Error('product_page_url does not contain the exact reference.');
  }

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Sheet has no data rows.');

  var headers = values[0].map(function(value) { return String(value).trim(); });
  var refCol = headers.indexOf('Tリファレンス番号');
  var versionCol = headers.indexOf('VersionKey');
  var productUrlCol = headers.indexOf('公式商品ページURL');
  var descriptionCol = headers.indexOf('現在の公式説明');
  var categoryCol = headers.indexOf('現在のカテゴリ');
  var descriptionSourceLanguageCol = mfImageCollectorEnsureHeader_(sheet, headers, '現在の公式説明根拠言語');
  var descriptionSourceUrlCol = mfImageCollectorEnsureHeader_(sheet, headers, '現在の公式説明根拠URL');
  var descriptionOriginalCol = mfImageCollectorEnsureHeader_(sheet, headers, '現在の公式説明原文');
  if (refCol < 0 || productUrlCol < 0 || descriptionCol < 0) {
    throw new Error('Required official info columns are missing.');
  }

  var rowIndex = -1;
  for (var i = 1; i < values.length; i += 1) {
    if (versionKey && versionCol >= 0) {
      if (String(values[i][versionCol]).trim().toUpperCase() !== versionKey.toUpperCase()) continue;
    } else if (String(values[i][refCol]).trim().toUpperCase() !== reference.toUpperCase()) {
      continue;
    }
    rowIndex = i;
    break;
  }
  if (rowIndex < 0) throw new Error('Reference not found: ' + reference);

  var existingUrl = String(values[rowIndex][productUrlCol] || '').trim();
  if (productPageUrl && existingUrl && existingUrl !== productPageUrl) {
    throw new Error('product_page_url does not match the master row URL.');
  }

  var updatedDescription = false;
  var updatedCategory = false;
  if (officialDescription && !String(values[rowIndex][descriptionCol] || '').trim()) {
    sheet.getRange(rowIndex + 1, descriptionCol + 1).setValue(officialDescription);
    if (officialDescriptionSourceLanguage && !String(values[rowIndex][descriptionSourceLanguageCol] || '').trim()) {
      sheet.getRange(rowIndex + 1, descriptionSourceLanguageCol + 1).setValue(officialDescriptionSourceLanguage);
    }
    if (officialDescriptionSourceUrl && !String(values[rowIndex][descriptionSourceUrlCol] || '').trim()) {
      sheet.getRange(rowIndex + 1, descriptionSourceUrlCol + 1).setValue(officialDescriptionSourceUrl);
    }
    if (officialDescriptionOriginal && !String(values[rowIndex][descriptionOriginalCol] || '').trim()) {
      sheet.getRange(rowIndex + 1, descriptionOriginalCol + 1).setValue(officialDescriptionOriginal);
    }
    updatedDescription = true;
  }
  if (officialCategory && categoryCol >= 0 && !String(values[rowIndex][categoryCol] || '').trim()) {
    sheet.getRange(rowIndex + 1, categoryCol + 1).setValue(officialCategory);
    updatedCategory = true;
  }

  return {
    ok: true,
    reference: reference,
    version_key: versionKey,
    sheet_row: rowIndex + 1,
    updated_description: updatedDescription,
    updated_category: updatedCategory
  };
}

function mfImageCollectorUpdateMasterNewTeaDefaults_(payload) {
  mfImageCollectorAssertSecret_(payload);

  var dryRun = payload.dry_run !== false;
  var reference = String(payload.reference || '').trim().toUpperCase();
  if (!reference) throw new Error('reference is required.');
  var versionKey = String(payload.version_key || '').trim().toUpperCase();
  var productPageUrl = String(payload.product_page_url || '').trim();
  var officialName = String(payload.official_name || '').trim();
  var officialCategory = mfImageCollectorNormalizeClassificationValueForMaster_(payload.official_category);
  if (mfImageCollectorIsTfbfReference_(reference)) officialCategory = 'ティザン';
  var teaTypeTag = mfImageCollectorTeaTypeTagFromCategory_(officialCategory);
  var masterAbsenceConfirmed = payload.master_absence_confirmed === true;
  var officialDescription = mfImageCollectorReviewOfficialDescriptionForMaster_({
    '言語': payload.source_language || '',
    '確認言語': payload.source_language || '',
    '公式説明抜粋': payload.description_excerpt || '',
    '公式情報JSON': mfImageCollectorStableJson_({
      description_snippets_by_language: payload.description_snippets_by_language || {},
      approved_japanese_description: payload.approved_japanese_description || '',
      planned_japanese_description: payload.planned_japanese_description || ''
    })
  });

  if (productPageUrl && !mfImageCollectorUrlHasExactReference_(productPageUrl, reference)) {
    throw new Error('product_page_url does not contain the exact reference.');
  }

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Sheet has no data rows.');
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var refCol = headers.indexOf('Tリファレンス番号');
  var versionCol = headers.indexOf('VersionKey');
  if (refCol < 0) throw new Error('Tリファレンス番号 column is required.');

  var rowIndex = -1;
  for (var i = 1; i < values.length; i += 1) {
    if (versionKey && versionCol >= 0) {
      if (String(values[i][versionCol]).trim().toUpperCase() !== versionKey) continue;
    } else if (String(values[i][refCol]).trim().toUpperCase() !== reference) {
      continue;
    }
    rowIndex = i;
    break;
  }
  if (rowIndex < 0) throw new Error('Reference not found: ' + reference);

  if (!versionKey && versionCol >= 0) versionKey = String(values[rowIndex][versionCol] || '').trim().toUpperCase();
  var changes = [];
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, 'バージョン', versionKey ? mfImageCollectorVersionLabelFromVersionKey_(reference, versionKey) : '', changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '現在の公式名', officialName, changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '公式商品ページURL', productPageUrl, changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '公式商品ページURL状態', productPageUrl ? 'available' : '', changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '黒い本掲載', masterAbsenceConfirmed ? 'いいえ' : '', changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '現在のカテゴリ', officialCategory, changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '茶種タグ', teaTypeTag, changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '燻製茶', mfImageCollectorIsSmokyTeaReference_(reference, payload.sales_references) ? 'はい' : '', changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '現在の公式説明', officialDescription, changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '茶葉画像状態', 'pending', changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '茶葉サムネイル状態', 'pending', changes, dryRun);
  mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, '水色画像状態', 'pending', changes, dryRun);

  return {
    ok: true,
    dry_run: dryRun,
    reference: reference,
    version_key: versionKey,
    sheet_row: rowIndex + 1,
    changed_count: changes.length,
    changes: changes
  };
}

function mfImageCollectorQueueBlankCellUpdate_(sheet, values, headers, rowIndex, header, value, changes, dryRun) {
  var col = headers.indexOf(header);
  if (col < 0 || value === null || value === undefined || String(value).trim() === '') return;
  var before = String(values[rowIndex][col] || '').trim();
  if (before) return;
  var after = String(value).trim();
  changes.push({
    row_number: rowIndex + 1,
    column: header,
    before: before,
    after: after
  });
  if (!dryRun) sheet.getRange(rowIndex + 1, col + 1).setValue(after);
}

function mfImageCollectorNormalizeTeaTypeTags_(payload) {
  mfImageCollectorAssertSecret_(payload);
  var dryRun = payload.dry_run !== false;
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, dry_run: dryRun, changed_count: 0, changes: [] };

  var headers = values[0].map(function(value) { return String(value).trim(); });
  var refCol = headers.indexOf('Tリファレンス番号');
  var versionCol = headers.indexOf('VersionKey');
  var tagCol = headers.indexOf('茶種タグ');
  var categoryCol = headers.indexOf('現在のカテゴリ');
  if (tagCol < 0 && categoryCol < 0) throw new Error('茶種タグ or 現在のカテゴリ column is required.');

  var changes = [];
  for (var i = 1; i < values.length; i += 1) {
    var reference = refCol >= 0 ? String(values[i][refCol] || '').trim() : '';
    var versionKey = versionCol >= 0 ? String(values[i][versionCol] || '').trim() : '';
    if (tagCol >= 0) {
      var tagBefore = String(values[i][tagCol] || '').trim();
      var tagAfter = mfImageCollectorNormalizeTeaTypeTagsForMaster_(tagBefore);
      if (tagBefore !== tagAfter) {
        changes.push({
          row_number: i + 1,
          reference: reference,
          version_key: versionKey,
          column: '茶種タグ',
          before: tagBefore,
          after: tagAfter
        });
        if (!dryRun) {
          sheet.getRange(i + 1, tagCol + 1).setValue(tagAfter);
        }
      }
    }
    if (categoryCol >= 0) {
      var categoryBefore = String(values[i][categoryCol] || '').trim();
      var categoryAfter = mfImageCollectorNormalizeClassificationValueForMaster_(categoryBefore);
      if (categoryBefore !== categoryAfter) {
        changes.push({
          row_number: i + 1,
          reference: reference,
          version_key: versionKey,
          column: '現在のカテゴリ',
          before: categoryBefore,
          after: categoryAfter
        });
        if (!dryRun) {
          sheet.getRange(i + 1, categoryCol + 1).setValue(categoryAfter);
        }
      }
    }
  }

  return {
    ok: true,
    dry_run: dryRun,
    changed_count: changes.length,
    changes: changes
  };
}

function mfImageCollectorTaxonomyDryRun_() {
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return {
    ok: true,
    dry_run: true,
    summary: mfImageCollectorEmptyTaxonomySummary_(0),
    rows: []
  };

  var headers = values[0].map(function(value) { return String(value).trim(); });
  var refCol = headers.indexOf('Tリファレンス番号');
  var versionCol = headers.indexOf('VersionKey');
  var nameCol = headers.indexOf('現在の公式名');
  var fallbackNameCol = headers.indexOf('銘柄名（黒い本）');
  var tagCol = headers.indexOf('茶種タグ');
  var categoryCol = headers.indexOf('現在のカテゴリ');
  var aromaCol = headers.indexOf('香味大分類');
  var detailCol = headers.indexOf('香味詳細タグ');
  var blackBookDescriptionCol = headers.indexOf('黒い本説明');
  var officialDescriptionCol = headers.indexOf('現在の公式説明');
  var officialDescriptionOriginalCol = headers.indexOf('現在の公式説明原文');
  var summary = mfImageCollectorEmptyTaxonomySummary_(values.length - 1);
  var rows = [];

  for (var i = 1; i < values.length; i += 1) {
    var currentTeaType = tagCol >= 0 ? String(values[i][tagCol] || '').trim() : '';
    var currentOfficialCategory = categoryCol >= 0 ? String(values[i][categoryCol] || '').trim() : '';
    var currentAroma = aromaCol >= 0 ? String(values[i][aromaCol] || '').trim() : '';
    var currentDetails = detailCol >= 0 ? String(values[i][detailCol] || '').trim() : '';
    var trustedEvidenceTexts = [
      blackBookDescriptionCol >= 0 ? values[i][blackBookDescriptionCol] : '',
      officialDescriptionCol >= 0 ? values[i][officialDescriptionCol] : '',
      officialDescriptionOriginalCol >= 0 ? values[i][officialDescriptionOriginalCol] : ''
    ];
    var newTeaType = mfImageCollectorNormalizeTeaTypeTagsForMaster_(currentTeaType);
    var newOfficialCategory = mfImageCollectorNormalizeClassificationValueForMaster_(currentOfficialCategory);
    var aroma = mfImageCollectorNormalizeAromaCategoriesForMaster_(currentAroma, currentDetails, trustedEvidenceTexts);
    var reasons = [];

    mfImageCollectorAccumulateTaxonomyStats_(summary, currentAroma, currentDetails, aroma.categories, aroma.unknown);
    for (var derivedIndex = 0; derivedIndex < aroma.evidence_derived.length; derivedIndex += 1) {
      var evidenceKey = 'trusted evidence -> ' + aroma.evidence_derived[derivedIndex].category;
      summary.evidence_derived_counts[evidenceKey] = (summary.evidence_derived_counts[evidenceKey] || 0) + 1;
    }
    if (currentTeaType !== newTeaType) reasons.push('茶種タグ normalized');
    if (currentOfficialCategory !== newOfficialCategory) reasons.push('現在のカテゴリ normalized');
    if (currentAroma !== aroma.value) reasons.push('香味大分類 normalized/derived from 香味詳細タグ');
    if (currentAroma !== aroma.value && aroma.evidence_derived.length) reasons.push('香味大分類 derived from trusted evidence text');
    if (currentAroma !== aroma.value && aroma.unknown.length) reasons.push('unknown aroma category kept out: ' + aroma.unknown.join('、'));
    if (currentTeaType === newTeaType && currentOfficialCategory === newOfficialCategory && currentAroma === aroma.value) continue;

    summary.changed_rows += 1;
    if (currentTeaType !== newTeaType) {
      summary.tea_type_changed_cells += 1;
      summary.changed_cells += 1;
    }
    if (currentOfficialCategory !== newOfficialCategory) {
      summary.tea_type_changed_cells += 1;
      summary.changed_cells += 1;
    }
    if (currentAroma !== aroma.value) {
      summary.aroma_changed_rows += 1;
      summary.changed_cells += 1;
    }
    rows.push({
      row_number: i + 1,
      version_key: versionCol >= 0 ? String(values[i][versionCol] || '').trim() : '',
      reference: refCol >= 0 ? String(values[i][refCol] || '').trim() : '',
      name: nameCol >= 0 ? String(values[i][nameCol] || '').trim() : (fallbackNameCol >= 0 ? String(values[i][fallbackNameCol] || '').trim() : ''),
      current_tea_type_tags: currentTeaType,
      new_tea_type_tags: newTeaType,
      current_official_category: currentOfficialCategory,
      new_official_category: newOfficialCategory,
      current_aroma_categories: currentAroma,
      new_aroma_categories: aroma.value,
      flavor_detail_tags: currentDetails,
      evidence_derived_aroma_categories: aroma.evidence_derived,
      reasons: reasons
    });
  }
  return { ok: true, dry_run: true, summary: summary, rows: rows };
}

function mfImageCollectorApplyTaxonomyInternal_(payload) {
  var dryRun = payload.dry_run !== false;
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var dryRunResult = mfImageCollectorTaxonomyDryRun_();
  var changes = mfImageCollectorTaxonomyChangeCells_(dryRunResult.rows);
  var validation = mfImageCollectorValidateTaxonomyApply_(values, headers, dryRunResult.summary, changes);
  if (!validation.ok) {
    return {
      ok: false,
      dry_run: dryRun,
      error: 'taxonomy apply validation failed',
      conflicts: validation.conflicts
    };
  }
  var batchId = String(payload.batch_id || '').trim() || mfImageCollectorTaxonomyBatchId_();
  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      batch_id: batchId,
      would_apply_count: changes.length,
      summary: dryRunResult.summary,
      changes: changes
    };
  }

  var logSheet = mfImageCollectorGetOrCreateTaxonomyLogSheet_(ss);
  var timestamp = new Date();
  var logRows = changes.map(function(change) {
    return MF_IMAGE_COLLECTOR_TAXONOMY_LOG_HEADERS.map(function(header) {
      if (header === 'batch_id') return batchId;
      if (header === 'timestamp') return timestamp;
      if (header === 'status') return 'applied';
      if (header === 'rollback_at') return '';
      if (header === 'rollback_status') return '';
      if (header === 'row_number') return change.row_number;
      if (header === 'VersionKey') return change.version_key;
      if (header === 'Tリファレンス番号') return change.reference;
      if (header === '銘柄名') return change.name;
      if (header === 'column') return change.column;
      if (header === 'before') return change.before;
      if (header === 'after') return change.after;
      if (header === 'reason') return change.reason;
      return '';
    });
  });
  if (logRows.length) {
    logSheet.getRange(logSheet.getLastRow() + 1, 1, logRows.length, MF_IMAGE_COLLECTOR_TAXONOMY_LOG_HEADERS.length).setValues(logRows);
  }
  for (var i = 0; i < changes.length; i += 1) {
    var col = headers.indexOf(changes[i].column);
    sheet.getRange(changes[i].row_number, col + 1).setValue(changes[i].after);
  }
  return {
    ok: true,
    dry_run: false,
    batch_id: batchId,
    applied_count: changes.length,
    summary: dryRunResult.summary
  };
}

function mfImageCollectorRollbackTaxonomyInternal_(payload) {
  var dryRun = payload.dry_run !== false;
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var logSheet = mfImageCollectorGetOrCreateTaxonomyLogSheet_(ss);
  var batchId = String(payload.batch_id || '').trim();
  if (!batchId) {
    var latest = mfImageCollectorLatestAppliedTaxonomyBatch_();
    if (!latest) throw new Error('No taxonomy batch is available for rollback.');
    batchId = latest.batch_id;
  }
  var logValues = logSheet.getDataRange().getValues();
  var logHeaders = logValues[0].map(function(value) { return String(value).trim(); });
  var rollbackRows = [];
  for (var i = 1; i < logValues.length; i += 1) {
    if (String(logValues[i][logHeaders.indexOf('batch_id')] || '').trim() !== batchId) continue;
    if (String(logValues[i][logHeaders.indexOf('status')] || '').trim() !== 'applied') continue;
    if (String(logValues[i][logHeaders.indexOf('rollback_status')] || '').trim()) continue;
    rollbackRows.push(mfImageCollectorTaxonomyLogRowToChange_(logValues[i], logHeaders, i + 1));
  }
  if (!rollbackRows.length) {
    return { ok: false, dry_run: dryRun, batch_id: batchId, error: 'No unapplied rollback rows found for batch. It may already be rolled back.' };
  }

  var conflicts = [];
  var toRollback = [];
  for (var r = 0; r < rollbackRows.length; r += 1) {
    var change = rollbackRows[r];
    var col = headers.indexOf(change.column);
    var rowIndex = change.row_number - 1;
    if (col < 0 || rowIndex < 1 || rowIndex >= values.length) {
      conflicts.push({ change: change, error: 'target row or column not found' });
      continue;
    }
    var currentVersionKey = String(values[rowIndex][headers.indexOf('VersionKey')] || '').trim();
    var currentValue = String(values[rowIndex][col] || '').trim();
    if (currentVersionKey !== change.version_key) {
      conflicts.push({ change: change, current_version_key: currentVersionKey, error: 'VersionKey mismatch' });
      continue;
    }
    if (currentValue !== change.after) {
      conflicts.push({ change: change, current_value: currentValue, error: 'after value mismatch' });
      continue;
    }
    toRollback.push(change);
  }
  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      batch_id: batchId,
      would_rollback_count: toRollback.length,
      conflict_count: conflicts.length,
      conflicts: conflicts
    };
  }

  var now = new Date();
  for (var j = 0; j < toRollback.length; j += 1) {
    var targetCol = headers.indexOf(toRollback[j].column);
    sheet.getRange(toRollback[j].row_number, targetCol + 1).setValue(toRollback[j].before);
    mfImageCollectorMarkTaxonomyRollbackLog_(logSheet, logHeaders, toRollback[j].log_row_number, now, 'rolled_back');
  }
  for (var c = 0; c < conflicts.length; c += 1) {
    mfImageCollectorMarkTaxonomyRollbackLog_(logSheet, logHeaders, conflicts[c].change.log_row_number, now, 'conflict');
  }
  return {
    ok: conflicts.length === 0,
    dry_run: false,
    batch_id: batchId,
    rollback_count: toRollback.length,
    conflict_count: conflicts.length,
    conflicts: conflicts
  };
}

function mfImageCollectorTaxonomyChangeCells_(rows) {
  var changes = [];
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    var reason = (row.reasons || []).join('; ');
    if (row.current_tea_type_tags !== row.new_tea_type_tags) {
      changes.push(mfImageCollectorTaxonomyChangeCell_(row, '茶種タグ', row.current_tea_type_tags, row.new_tea_type_tags, reason));
    }
    if (row.current_official_category !== row.new_official_category) {
      changes.push(mfImageCollectorTaxonomyChangeCell_(row, '現在のカテゴリ', row.current_official_category, row.new_official_category, reason));
    }
    if (row.current_aroma_categories !== row.new_aroma_categories) {
      changes.push(mfImageCollectorTaxonomyChangeCell_(row, '香味大分類', row.current_aroma_categories, row.new_aroma_categories, reason));
    }
  }
  return changes;
}

function mfImageCollectorTaxonomyChangeCell_(row, column, before, after, reason) {
  return {
    row_number: row.row_number,
    version_key: row.version_key,
    reference: row.reference,
    name: row.name,
    column: column,
    before: before,
    after: after,
    reason: reason
  };
}

function mfImageCollectorValidateTaxonomyApply_(values, headers, summary, changes) {
  var conflicts = [];
  var versionCol = headers.indexOf('VersionKey');
  if (versionCol < 0) conflicts.push({ error: 'VersionKey column not found' });
  var seen = {};
  for (var i = 1; versionCol >= 0 && i < values.length; i += 1) {
    var versionKey = String(values[i][versionCol] || '').trim();
    if (!versionKey) conflicts.push({ row_number: i + 1, error: 'VersionKey is empty' });
    if (versionKey && seen[versionKey]) conflicts.push({ row_number: i + 1, version_key: versionKey, error: 'duplicate VersionKey' });
    seen[versionKey] = true;
  }
  if (Object.keys(summary.unknown_old_categories || {}).length) {
    conflicts.push({ error: 'unknown aroma categories exist', unknown_old_categories: summary.unknown_old_categories });
  }
  for (var c = 0; c < changes.length; c += 1) {
    var change = changes[c];
    if (MF_IMAGE_COLLECTOR_TAXONOMY_COLUMNS.indexOf(change.column) < 0) {
      conflicts.push({ change: change, error: 'column is not allowed for taxonomy apply' });
      continue;
    }
    var rowIndex = change.row_number - 1;
    var col = headers.indexOf(change.column);
    if (rowIndex < 1 || rowIndex >= values.length || col < 0) {
      conflicts.push({ change: change, error: 'target row or column not found' });
      continue;
    }
    var actualVersionKey = versionCol >= 0 ? String(values[rowIndex][versionCol] || '').trim() : '';
    var actualBefore = String(values[rowIndex][col] || '').trim();
    if (actualVersionKey !== change.version_key) {
      conflicts.push({ change: change, actual_version_key: actualVersionKey, error: 'VersionKey mismatch' });
    }
    if (actualBefore !== change.before) {
      conflicts.push({ change: change, actual_before: actualBefore, error: 'before value mismatch' });
    }
    if ((change.column === '茶種タグ' || change.column === '現在のカテゴリ') && String(change.after || '').indexOf('紅茶') >= 0) {
      conflicts.push({ change: change, error: '紅茶 remains in classification value' });
    }
    if (change.column === '香味大分類') {
      var invalid = mfImageCollectorDelimitedValues_(change.after).filter(function(token) {
        return mfImageCollectorAromaCategoryOrder_().indexOf(token) < 0;
      });
      if (invalid.length) conflicts.push({ change: change, invalid_categories: invalid, error: 'invalid aroma category' });
    }
  }
  return { ok: conflicts.length === 0, conflicts: conflicts };
}

function mfImageCollectorGetOrCreateTaxonomyLogSheet_(ss) {
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_TAXONOMY_LOG_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(MF_IMAGE_COLLECTOR_TAXONOMY_LOG_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, MF_IMAGE_COLLECTOR_TAXONOMY_LOG_HEADERS.length).setValues([MF_IMAGE_COLLECTOR_TAXONOMY_LOG_HEADERS]);
    return sheet;
  }
  var headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(function(value) { return String(value).trim(); });
  for (var i = 0; i < MF_IMAGE_COLLECTOR_TAXONOMY_LOG_HEADERS.length; i += 1) {
    if (headers.indexOf(MF_IMAGE_COLLECTOR_TAXONOMY_LOG_HEADERS[i]) < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(MF_IMAGE_COLLECTOR_TAXONOMY_LOG_HEADERS[i]);
    }
  }
  return sheet;
}

function mfImageCollectorTaxonomyLogRowToChange_(row, headers, logRowNumber) {
  function value(header) {
    return String(row[headers.indexOf(header)] || '').trim();
  }
  return {
    log_row_number: logRowNumber,
    row_number: Number(value('row_number')),
    version_key: value('VersionKey'),
    reference: value('Tリファレンス番号'),
    name: value('銘柄名'),
    column: value('column'),
    before: value('before'),
    after: value('after'),
    reason: value('reason')
  };
}

function mfImageCollectorMarkTaxonomyRollbackLog_(sheet, headers, rowNumber, when, status) {
  sheet.getRange(rowNumber, headers.indexOf('rollback_at') + 1).setValue(when);
  sheet.getRange(rowNumber, headers.indexOf('rollback_status') + 1).setValue(status);
}

function mfImageCollectorLatestAppliedTaxonomyBatch_() {
  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_TAXONOMY_LOG_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return null;
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var batches = {};
  for (var i = 1; i < values.length; i += 1) {
    var status = String(values[i][headers.indexOf('status')] || '').trim();
    var rollbackStatus = String(values[i][headers.indexOf('rollback_status')] || '').trim();
    if (status !== 'applied' || rollbackStatus) continue;
    var batchId = String(values[i][headers.indexOf('batch_id')] || '').trim();
    if (!batchId) continue;
    batches[batchId] = (batches[batchId] || 0) + 1;
  }
  var ids = Object.keys(batches).sort();
  if (!ids.length) return null;
  var latest = ids[ids.length - 1];
  return { batch_id: latest, count: batches[latest] };
}

function mfImageCollectorTaxonomyBatchId_() {
  return 'taxonomy-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 8);
}

function mfImageCollectorEmptyTaxonomySummary_(masterRows) {
  var counts = {};
  var order = mfImageCollectorAromaCategoryOrder_();
  for (var i = 0; i < order.length; i += 1) counts[order[i]] = 0;
  return {
    master_rows: masterRows,
    changed_rows: 0,
    changed_cells: 0,
    tea_type_changed_cells: 0,
    aroma_changed_rows: 0,
    new_category_counts: counts,
    old_category_conversion_counts: {},
    unknown_old_categories: {},
    detail_derived_counts: {},
    evidence_derived_counts: {}
  };
}

function mfImageCollectorAccumulateTaxonomyStats_(summary, currentAroma, detailTags, categories, unknown) {
  var oldTokens = mfImageCollectorDelimitedValues_(currentAroma);
  for (var i = 0; i < oldTokens.length; i += 1) {
    var normalized = mfImageCollectorNormalizeAromaCategoryToken_(oldTokens[i]);
    if (normalized.length) {
      var key = oldTokens[i] + ' -> ' + normalized.join('、');
      summary.old_category_conversion_counts[key] = (summary.old_category_conversion_counts[key] || 0) + 1;
    }
  }
  for (var u = 0; u < unknown.length; u += 1) {
    summary.unknown_old_categories[unknown[u]] = (summary.unknown_old_categories[unknown[u]] || 0) + 1;
  }
  var detailTokens = mfImageCollectorDelimitedValues_(detailTags);
  for (var d = 0; d < detailTokens.length; d += 1) {
    var derived = mfImageCollectorAromaCategoriesFromDetailTag_(detailTokens[d]);
    for (var j = 0; j < derived.length; j += 1) {
      var detailKey = detailTokens[d] + ' -> ' + derived[j];
      summary.detail_derived_counts[detailKey] = (summary.detail_derived_counts[detailKey] || 0) + 1;
    }
  }
  for (var c = 0; c < categories.length; c += 1) {
    summary.new_category_counts[categories[c]] = (summary.new_category_counts[categories[c]] || 0) + 1;
  }
}

/*
 * 現在のカテゴリは、現在公式で確認できる茶の基本カテゴリを日本語canonical表記で保持する。
 * 産地・香味・時間帯・等級・収穫時期等は含めず、複数茶種を実際に含む場合のみ／区切りで併記する。
 */
function mfImageCollectorCanonicalCurrentCategories_() {
  return ['黒茶', '緑茶', '青茶', '白茶', '黄茶', 'ルイボス', 'ダージリン', '抹茶', 'プーアル茶', 'ティザン'];
}

function mfImageCollectorCurrentCategoryNormalizationMap_() {
  return {
    '黒茶': '黒茶',
    '緑茶': '緑茶',
    '青茶': '青茶',
    '白茶': '白茶',
    '黄茶': '黄茶',
    'ルイボス': 'ルイボス',
    'ダージリン': 'ダージリン',
    '抹茶': '抹茶',
    'プーアル茶': 'プーアル茶',
    'ティザン': 'ティザン',
    '緑茶／中国': '緑茶',
    '緑茶／日本': '緑茶',
    '青茶／中国': '青茶',
    '黒茶／中国': '黒茶',
    '白茶／中国': '白茶',
    '青茶／タイ': '青茶',
    '青茶／ニュージーランド': '青茶',
    '青茶／インドネシア': '青茶',
    '緑茶／韓国': '緑茶',
    '黒茶／セイロン': '黒茶',
    '黒茶／南アフリカ': '黒茶',
    '黒茶／アッサム': '黒茶',
    '黄茶／中国・雲南': '黄茶',
    '緑茶／ジャスミン': '緑茶',
    '緑茶／ジャスミン／中国': '緑茶',
    '白茶／ジャスミン': '白茶',
    '白茶／ジャスミン／中国': '白茶',
    '青茶／ジャスミン': '青茶',
    '白茶／フルーツ＆フラワー': '白茶',
    '白茶／フローラル': '白茶',
    '黒茶／アールグレイ': '黒茶',
    '青茶／フレーバード': '青茶',
    '黒茶／ダージリン／フレーバード': '黒茶',
    '黒茶／ブレックファースト': '黒茶',
    '黒茶／ダージリン／春摘み': 'ダージリン',
    '青茶／チャイ': '青茶',
    'ルイボス／チャイ': 'ルイボス',
    '紅茶／チャイ／アールグレイ': '黒茶',
    '紅茶／ルワンダ': '黒茶',
    'Thé noir': '黒茶',
    'Thé noir parfumé': '黒茶',
    'Thé noir parfumé - après-midi': '黒茶',
    'Thé noir à la vanille - Darjeeling': '黒茶',
    'Thé vert - Sencha à la vanille': '緑茶',
    'Thé mûr Chine': 'プーアル茶',
    'Thé mûr, Chine': 'プーアル茶',
    'Darjeeling Nouveau': 'ダージリン',
    'SFTGFOP1 - Assemblage de Darjeeling': 'ダージリン',
    'FTGFOP1 - Assemblage de Darjeeling': 'ダージリン',
    '黒茶, darjeeling au parfum gourmand de rose': '黒茶',
    '黒茶, assemblage de printemps et d\'été': '黒茶',
    '黒茶, assemblage de crus de printemps': '黒茶',
    '青茶™ Formose': '青茶',
    '熟成茶': 'プーアル茶',
    '焙じ緑茶': '緑茶',
    '緑茶／抹茶／スパイス': '抹茶',
    '黒茶・白茶・青茶': '黒茶／白茶／青茶'
  };
}

function mfImageCollectorNormalizeCurrentCategory_(value) {
  var raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { known: false, blank: true, current: '', value: '', changed: false };
  var lookupKey = mfImageCollectorCurrentCategoryLookupKey_(raw);
  var map = mfImageCollectorCurrentCategoryNormalizationMap_();
  var matchedKey = '';
  Object.keys(map).some(function(key) {
    if (mfImageCollectorCurrentCategoryLookupKey_(key) !== lookupKey) return false;
    matchedKey = key;
    return true;
  });
  if (!matchedKey) {
    return { known: false, blank: false, current: raw, value: '', changed: false };
  }
  return { known: true, blank: false, current: raw, value: map[matchedKey], changed: raw !== map[matchedKey] };
}

function mfImageCollectorCurrentCategoryLookupKey_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\//g, '／')
    .replace(/&/g, '＆')
    .replace(/\s+/g, ' ')
    .trim();
}

function mfImageCollectorAuditCurrentCategories_() {
  var ss = mfImageCollectorOpenSpreadsheet_();
  var masterSheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!masterSheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = masterSheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var versionCol = headers.indexOf('VersionKey');
  var primaryRefCol = headers.indexOf('Primary Reference');
  var refCol = headers.indexOf('Tリファレンス番号');
  var nameCol = headers.indexOf('現在の公式名');
  var categoryCol = headers.indexOf('現在のカテゴリ');
  if (versionCol < 0 || categoryCol < 0) throw new Error('Master columns required for current category audit are missing.');

  var reviewSheet = mfImageCollectorGetOrCreateReviewSheet_();
  var reviewHeaders = mfImageCollectorSheetHeaders_(reviewSheet);
  var reviewValues = reviewSheet.getLastRow() > 1
    ? reviewSheet.getRange(2, 1, reviewSheet.getLastRow() - 1, reviewSheet.getLastColumn()).getValues()
    : [];
  var result = { target_rows: 0, canonical_rows: 0, created: 0, duplicate_skips: 0, blank_rows: 0, unknown_rows: 0, unknown_values: [] };

  for (var i = 1; i < values.length; i += 1) {
    var versionKey = String(values[i][versionCol] || '').trim();
    if (!versionKey) continue;
    result.target_rows += 1;
    var normalized = mfImageCollectorNormalizeCurrentCategory_(values[i][categoryCol]);
    if (normalized.blank) {
      result.blank_rows += 1;
      continue;
    }
    if (!normalized.known) {
      result.unknown_rows += 1;
      if (result.unknown_values.indexOf(normalized.current) < 0) result.unknown_values.push(normalized.current);
      continue;
    }
    if (!normalized.changed) {
      result.canonical_rows += 1;
      continue;
    }
    if (mfImageCollectorHasOpenCategoryNormalizationReview_(reviewValues, reviewHeaders, versionKey, normalized.value)) {
      result.duplicate_skips += 1;
      continue;
    }
    var primaryReference = primaryRefCol >= 0 ? String(values[i][primaryRefCol] || '').trim() : '';
    var tReference = refCol >= 0 ? String(values[i][refCol] || '').trim() : '';
    var candidate = mfImageCollectorBuildCurrentCategoryReviewCandidate_({
      version_key: versionKey,
      reference: primaryReference || tReference || versionKey.replace(/-[BN]\d{2}$/i, ''),
      t_reference: tReference,
      name: nameCol >= 0 ? String(values[i][nameCol] || '').trim() : '',
      current_value: normalized.current,
      suggested_value: normalized.value
    });
    var detectionId = mfImageCollectorReviewDedupeKey_(candidate);
    var rowValues = mfImageCollectorReviewCandidateToRow_(candidate, detectionId);
    reviewSheet.appendRow(MF_IMAGE_COLLECTOR_REVIEW_HEADERS.map(function(header) { return rowValues[header] || ''; }));
    reviewValues.push(MF_IMAGE_COLLECTOR_REVIEW_HEADERS.map(function(header) { return rowValues[header] || ''; }));
    result.created += 1;
  }
  if (result.created) mfImageCollectorApplyReviewValidation_(reviewSheet);
  result.unknown_values.sort();
  return result;
}

function mfImageCollectorBuildCurrentCategoryReviewCandidate_(input) {
  return {
    detection_type: 'structured_fact',
    reference: String(input.reference || '').trim(),
    t_reference: String(input.t_reference || '').trim(),
    official_name: String(input.name || '').trim(),
    existing_reference: String(input.t_reference || '').trim(),
    existing_version_key: String(input.version_key || '').trim(),
    existing_name: String(input.name || '').trim(),
    target_version_key: String(input.version_key || '').trim(),
    target_column: '現在のカテゴリ',
    current_value: String(input.current_value || '').trim(),
    suggested_value: String(input.suggested_value || '').trim(),
    diff_summary: '現在のカテゴリをcanonical表記へ正規化',
    evidence: 'カテゴリ正規化ルール: ' + input.current_value + ' → ' + input.suggested_value,
    evidence_text: 'カテゴリ正規化ルール: ' + input.current_value + ' → ' + input.suggested_value,
    source_type: 'category_normalization',
    confidence: 'high',
    status: '要確認'
  };
}

function mfImageCollectorHasOpenCategoryNormalizationReview_(values, headers, versionKey, suggestedValue) {
  var statusCol = headers.indexOf('ステータス');
  var typeCol = headers.indexOf('検出種別');
  var versionCol = headers.indexOf('対象VersionKey');
  var dbVersionCol = headers.indexOf('DB既存VersionKey');
  var targetCol = headers.indexOf('対象列');
  var suggestedCol = headers.indexOf('候補値');
  if (statusCol < 0 || typeCol < 0 || targetCol < 0 || suggestedCol < 0) return false;
  for (var i = 0; i < values.length; i += 1) {
    var status = String(values[i][statusCol] || '').trim();
    if (MF_IMAGE_COLLECTOR_REVIEW_APPLY_STATUSES.indexOf(status) < 0) continue;
    if (String(values[i][typeCol] || '').trim() !== 'structured_fact') continue;
    var rowVersion = versionCol >= 0 ? String(values[i][versionCol] || '').trim() : '';
    if (!rowVersion && dbVersionCol >= 0) rowVersion = String(values[i][dbVersionCol] || '').trim();
    if (rowVersion !== String(versionKey || '').trim()) continue;
    if (String(values[i][targetCol] || '').trim() !== '現在のカテゴリ') continue;
    if (String(values[i][suggestedCol] || '').trim() === String(suggestedValue || '').trim()) return true;
  }
  return false;
}

function mfImageCollectorNormalizeTeaTypeTagsForMaster_(value) {
  var parts = String(value || '').split(/[、,;／|\n]+/);
  var out = [];
  for (var i = 0; i < parts.length; i += 1) {
    var normalized = mfImageCollectorNormalizeTeaTypeTagTokenForMaster_(parts[i]);
    if (normalized && out.indexOf(normalized) < 0) out.push(normalized);
  }
  return out.join('、');
}

function mfImageCollectorNormalizeTeaTypeTagTokenForMaster_(token) {
  var raw = String(token || '').trim();
  if (!raw) return '';
  var normalized = raw.replace(/™/g, '').toLowerCase();
  if (raw === '紅茶') return '黒茶';
  if (normalized === 'black tea' || normalized === 'thé noir' || normalized === 'the noir' || normalized === 'smoky tea' || normalized === 'smoky teas') return '黒茶';
  if (raw === 'チザン') return 'ティザン';
  if (normalized === 'tisane' || normalized === 'fruit tea' || normalized === 'fruit teas') return 'ティザン';
  if (normalized === 'maté' || normalized === 'mate') return 'マテ';
  return raw;
}

function mfImageCollectorNormalizeClassificationValueForMaster_(value) {
  var raw = String(value || '').trim();
  var normalized = raw.replace(/™/g, '').toLowerCase();
  if (!normalized) return '';
  if (normalized === 'black tea' || normalized === 'thé noir' || normalized === 'the noir' || normalized === 'smoky tea' || normalized === 'smoky teas') return '黒茶';
  if (normalized === 'blue tea' || normalized === 'thé bleu' || normalized === 'the bleu') return '青茶';
  if (normalized === 'green tea' || normalized === 'thé vert') return '緑茶';
  if (normalized === 'white tea' || normalized === 'thé blanc') return '白茶';
  if (normalized === 'yellow tea' || normalized === 'thé jaune') return '黄茶';
  if (normalized === 'rooibos') return 'ルイボス';
  if (normalized === 'tisane' || normalized === 'fruit tea' || normalized === 'fruit teas') return 'ティザン';
  if (normalized === 'maté' || normalized === 'mate') return 'マテ';
  if (/tisane|fruit tea|infusion fruit[ée]e?/.test(normalized)) return 'ティザン';
  if (normalized === 'infusion' || normalized === 'herbal tea') return 'インフュージョン';
  return raw
    .replace(/紅茶/g, '黒茶')
    .replace(/\bBlack tea\b/gi, '黒茶')
    .replace(/\bBlue tea\b/gi, '青茶')
    .replace(/\bGreen tea\b/gi, '緑茶')
    .replace(/\bWhite tea\b/gi, '白茶')
    .replace(/\bYellow tea\b/gi, '黄茶')
    .replace(/\bThé noir\b/gi, '黒茶')
    .replace(/\bthe noir\b/gi, '黒茶')
    .replace(/\bThé bleu\b/gi, '青茶')
    .replace(/\bthe bleu\b/gi, '青茶')
    .replace(/\bThé vert\b/gi, '緑茶')
    .replace(/\bThé blanc\b/gi, '白茶')
    .replace(/\bThé jaune\b/gi, '黄茶')
    .replace(/\bFruit tea\b/gi, 'ティザン')
    .replace(/\bTisane\b/gi, 'ティザン');
}

function mfImageCollectorAromaCategoryOrder_() {
  return ['花', '果実', 'ベリー', '柑橘', 'スパイス', 'ハーブ', 'ミント', '甘香・菓子', 'カカオ', 'キャラメル', 'ナッツ', 'モルト', '植物・青葉', 'ウッディ'];
}

function mfImageCollectorNormalizeAromaCategoriesForMaster_(currentValue, detailTags, evidenceTexts) {
  var categories = [];
  var unknown = [];
  var evidenceDerived = [];
  var currentTokens = mfImageCollectorDelimitedValues_(currentValue);
  for (var i = 0; i < currentTokens.length; i += 1) {
    var normalized = mfImageCollectorNormalizeAromaCategoryToken_(currentTokens[i]);
    if (normalized.length) {
      categories = categories.concat(normalized);
    } else {
      unknown.push(currentTokens[i]);
    }
  }
  var detailTokens = mfImageCollectorDelimitedValues_(detailTags);
  for (var d = 0; d < detailTokens.length; d += 1) {
    categories = categories.concat(mfImageCollectorAromaCategoriesFromDetailTag_(detailTokens[d]));
  }
  evidenceTexts = evidenceTexts || [];
  for (var e = 0; e < evidenceTexts.length; e += 1) {
    var derived = mfImageCollectorAromaCategoriesFromTrustedEvidenceText_(evidenceTexts[e]);
    if (derived.length) {
      categories = categories.concat(derived);
      for (var c = 0; c < derived.length; c += 1) {
        evidenceDerived.push({
          category: derived[c],
          evidence_text: mfImageCollectorCompactText_(evidenceTexts[e], 180)
        });
      }
    }
  }
  categories = mfImageCollectorOrderedUniqueAromaCategories_(categories);
  return {
    value: categories.join('、'),
    categories: categories,
    unknown: mfImageCollectorUnique_(unknown),
    evidence_derived: evidenceDerived
  };
}

function mfImageCollectorNormalizeAromaCategoryToken_(token) {
  var raw = String(token || '').trim();
  var map = {
    '花系': ['花'],
    '花': ['花'],
    '果実系': ['果実'],
    '果実': ['果実'],
    'ベリー系': ['果実', 'ベリー'],
    'ベリー': ['果実', 'ベリー'],
    '柑橘系': ['柑橘'],
    '柑橘': ['柑橘'],
    'スパイス': ['スパイス'],
    'ハーブ系': ['ハーブ'],
    'ハーブ・清涼系': ['ハーブ'],
    'ハーブ': ['ハーブ'],
    'ミント': ['ハーブ', 'ミント'],
    '甘香': ['甘香・菓子'],
    '甘香・木質': ['甘香・菓子', 'ウッディ'],
    '甘香・菓子系': ['甘香・菓子'],
    '甘香・菓子': ['甘香・菓子'],
    '乳香': ['甘香・菓子'],
    '旨味': [],
    'カカオ系': ['カカオ'],
    'カカオ': ['カカオ'],
    'キャラメル系': ['甘香・菓子', 'キャラメル'],
    'キャラメル': ['甘香・菓子', 'キャラメル'],
    'ナッツ系': ['ナッツ'],
    'ナッツ': ['ナッツ'],
    'モルト': ['モルト'],
    'グリーン': ['植物・青葉'],
    '植物・青葉': ['植物・青葉'],
    '木質': ['ウッディ'],
    'ウッディ': ['ウッディ'],
    '樹脂・木質系': ['ウッディ'],
    'アーシー': ['ウッディ']
  };
  return map[raw] || [];
}

function mfImageCollectorAromaCategoriesFromDetailTag_(token) {
  var raw = String(token || '').trim();
  if (!raw) return [];
  if (/ベリー|ストロベリー|苺|いちご|イチゴ|ラズベリー|フランボワーズ|ブルーベリー|ブラックベリー|クランベリー|カシス/.test(raw)) return ['果実', 'ベリー'];
  if (/ミント|ペパーミント|スペアミント/.test(raw)) return ['ハーブ', 'ミント'];
  if (/キャラメル|カラメル|ブロンドキャラメル/.test(raw)) return ['甘香・菓子', 'キャラメル'];
  if (/モルト|麦芽/.test(raw)) return ['モルト'];
  if (/チョコレート|ショコラ|カカオ/.test(raw)) return ['カカオ'];
  if (/木質|樹脂|杉|杉樹脂|森林|下草|土香|土|ウッディ/.test(raw)) return ['ウッディ'];
  if (/植物香|青葉|若葉|竹|樹液|グリーン/.test(raw)) return ['植物・青葉'];
  if (/ベルガモット|柑橘|シトラス|レモン|オレンジ|グレープフルーツ|マンダリン|ゆず|柚子/.test(raw)) return ['柑橘'];
  if (/ジャスミン|ローズ|薔薇|バラ|花|フローラル|すみれ|スミレ|ラベンダー/.test(raw)) return ['花'];
  return [];
}

function mfImageCollectorAromaCategoriesFromTrustedEvidenceText_(text) {
  var raw = String(text || '').trim();
  if (!raw) return [];
  if (/モルト|麦芽|\bmalt(?:y|ed)?\b|malt[ée](?:e|es|s)?/i.test(raw)) return ['モルト'];
  return [];
}

function mfImageCollectorCompactText_(text, maxLength) {
  var compacted = String(text || '').replace(/\s+/g, ' ').trim();
  var limit = maxLength || 180;
  return compacted.length > limit ? compacted.slice(0, limit) : compacted;
}

function mfImageCollectorOrderedUniqueAromaCategories_(values) {
  var order = mfImageCollectorAromaCategoryOrder_();
  var unique = mfImageCollectorUnique_(values);
  unique.sort(function(a, b) {
    var ai = order.indexOf(a);
    var bi = order.indexOf(b);
    if (ai < 0) ai = order.length + 100;
    if (bi < 0) bi = order.length + 100;
    if (ai !== bi) return ai - bi;
    return String(a).localeCompare(String(b), 'ja');
  });
  return unique;
}

function mfImageCollectorUnique_(values) {
  var out = [];
  for (var i = 0; i < values.length; i += 1) {
    var value = String(values[i] || '').trim();
    if (value && out.indexOf(value) < 0) out.push(value);
  }
  return out;
}

function mfImageCollectorUrlHasExactReference_(url, reference) {
  var escaped = String(reference || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('(^|[^a-z0-9])' + escaped + '([^a-z0-9]|$)', 'i');
  return re.test(String(url || '').toLowerCase());
}

function mfImageCollectorUpdateSheet_(reference, images) {
  var ss = mfImageCollectorOpenSpreadsheet_();

  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Sheet has no data rows.');

  var headers = values[0].map(function(value) { return String(value).trim(); });
  var refCol = headers.indexOf('Tリファレンス番号');
  var teaCol = headers.indexOf('茶葉画像URL');
  var teaThumbnailCol = mfImageCollectorEnsureHeader_(sheet, headers, '茶葉サムネイルURL');
  var liqueurCol = headers.indexOf('水色画像URL');
  var teaStatusCol = mfImageCollectorEnsureHeader_(sheet, headers, '茶葉画像状態');
  var teaThumbnailStatusCol = mfImageCollectorEnsureHeader_(sheet, headers, '茶葉サムネイル状態');
  var liqueurStatusCol = mfImageCollectorEnsureHeader_(sheet, headers, '水色画像状態');
  if (refCol < 0 || teaCol < 0 || teaThumbnailCol < 0 || liqueurCol < 0) {
    throw new Error('Required columns are missing.');
  }

  var rowIndex = -1;
  for (var i = 1; i < values.length; i += 1) {
    if (String(values[i][refCol]).trim() === reference) {
      rowIndex = i;
      break;
    }
  }
  if (rowIndex < 0) throw new Error('Reference not found: ' + reference);

  for (var j = 0; j < images.length; j += 1) {
    var image = images[j];
    var col = image.image_type === 'tea'
      ? teaCol
      : image.image_type === 'teaThumbnail'
        ? teaThumbnailCol
        : liqueurCol;
    var statusCol = image.image_type === 'tea'
      ? teaStatusCol
      : image.image_type === 'teaThumbnail'
        ? teaThumbnailStatusCol
        : liqueurStatusCol;

    if (image.url) {
      sheet.getRange(rowIndex + 1, col + 1).setValue(image.url);
    } else if (image.status === 'not_available') {
      sheet.getRange(rowIndex + 1, col + 1).setValue('');
    }
    sheet.getRange(rowIndex + 1, statusCol + 1).setValue(image.status || (image.url ? 'available' : 'error'));
  }

  return rowIndex + 1;
}

function mfImageCollectorEnsureHeader_(sheet, headers, headerName) {
  var existing = headers.indexOf(headerName);
  if (existing >= 0) {
    if (headerName.indexOf('状態') >= 0) {
      mfImageCollectorApplyStatusValidation_(sheet, existing + 1, headerName);
    }
    return existing;
  }

  var lastColumn = sheet.getLastColumn();
  sheet.insertColumnAfter(lastColumn);
  sheet.getRange(1, lastColumn + 1).setValue(headerName);
  if (headerName.indexOf('状態') >= 0) {
    mfImageCollectorApplyStatusValidation_(sheet, lastColumn + 1, headerName);
  }
  headers.push(headerName);
  return lastColumn;
}

function mfImageCollectorApplyStatusValidation_(sheet, columnNumber, headerName) {
  var values = headerName === '公式商品ページURL状態'
    ? ['available', 'not_found', 'pending', 'error']
    : ['available', 'not_available', 'pending', 'error'];
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  var maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, columnNumber, maxRows, 1).setDataValidation(rule);
}

function mfImageCollectorThumbnailUrl_(fileId, size) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=' + encodeURIComponent(size || 'w1200');
}

function mfImageCollectorJson_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function mfImageCollectorJsonOrJsonp_(data, callback) {
  var json = JSON.stringify(data);
  var callbackName = String(callback || '').trim();
  if (callbackName) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callbackName)) {
      callbackName = '';
    }
  }
  if (callbackName) {
    return ContentService
      .createTextOutput(callbackName + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return mfImageCollectorJson_(data);
}
