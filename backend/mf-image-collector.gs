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
    .addItem('変更レビュー', 'mfImageCollectorShowReviewDialog')
    .addItem('要確認件数を表示', 'mfImageCollectorShowReviewSummary')
    .addItem('レビュー更新', 'mfImageCollectorRefreshReviewSheet')
    .addItem('分類整理 dry-run', 'mfImageCollectorShowTaxonomyDryRun')
    .addItem('分類整理を反映', 'mfImageCollectorShowTaxonomyApplyConfirm')
    .addItem('分類整理を元に戻す', 'mfImageCollectorShowTaxonomyRollbackConfirm')
    .addToUi();
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
  mfImageCollectorGetOrCreateReviewSheet_();
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

function mfImageCollectorApplyReviewDecision(rowNumber, decision, targetVersionKey, comment) {
  var sheet = mfImageCollectorGetOrCreateReviewSheet_();
  var row = Number(rowNumber);
  if (!row || row < 2 || row > sheet.getLastRow()) throw new Error('Invalid review row.');
  var values = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  var review = {};
  for (var i = 0; i < headers.length; i += 1) review[headers[i]] = values[i];

  if (MF_IMAGE_COLLECTOR_REVIEW_DECISIONS.indexOf(decision) < 0) throw new Error('Unsupported review decision.');
  var finalStatus = '反映済み';
  if (decision === '保留') finalStatus = '保留';
  if (decision === '誤検出') finalStatus = '却下';

  if (finalStatus === '反映済み') {
    mfImageCollectorApplyApprovedReview_(review, decision, targetVersionKey);
  }

  mfImageCollectorSetReviewRowValues_(sheet, row, {
    'ステータス': finalStatus,
    '人間判定': decision,
    '対象VersionKey': targetVersionKey || review['対象VersionKey'] || '',
    'コメント': comment || review['コメント'] || '',
    '処理日時': new Date()
  });
  return { ok: true, row_number: row, status: finalStatus, decision: decision };
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
    for (var i = 0; i < MF_IMAGE_COLLECTOR_REVIEW_HEADERS.length; i += 1) {
      if (headers.indexOf(MF_IMAGE_COLLECTOR_REVIEW_HEADERS[i]) < 0) {
        var lastColumn = Math.max(sheet.getLastColumn(), 1);
        sheet.insertColumnAfter(lastColumn);
        sheet.getRange(1, lastColumn + 1).setValue(MF_IMAGE_COLLECTOR_REVIEW_HEADERS[i]);
        headers.push(MF_IMAGE_COLLECTOR_REVIEW_HEADERS[i]);
      }
    }
  }
  mfImageCollectorApplyReviewValidation_(sheet);
  return sheet;
}

function mfImageCollectorApplyReviewValidation_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  var statusCol = headers.indexOf('ステータス') + 1;
  var decisionCol = headers.indexOf('人間判定') + 1;
  var maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  if (statusCol > 0) {
    sheet.getRange(2, statusCol, maxRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(MF_IMAGE_COLLECTOR_REVIEW_STATUSES, true).setAllowInvalid(false).build()
    );
  }
  if (decisionCol > 0) {
    sheet.getRange(2, decisionCol, maxRows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(MF_IMAGE_COLLECTOR_REVIEW_DECISIONS, true).setAllowInvalid(false).build()
    );
  }
}

function mfImageCollectorReviewCandidateToRow_(candidate, detectionId) {
  var officialInfo = {
    urls_by_language: candidate.official_urls_by_language || {},
    names_by_language: candidate.official_names_by_language || {},
    description_snippets_by_language: candidate.description_snippets_by_language || {},
    categories_by_language: candidate.categories_by_language || {},
    official_category: candidate.official_category || '',
    master_absence_confirmed: candidate.master_absence_confirmed === true,
    similar_master_candidates: candidate.similar_master_candidates || [],
    structured_fact: candidate.structured_fact || null
  };
  return {
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
    '根拠原文': String(candidate.evidence_text || '').trim(),
    '根拠言語': String(candidate.evidence_language || '').trim(),
    '根拠URL': String(candidate.evidence_url || '').trim(),
    'source_type': String(candidate.source_type || '').trim(),
    'confidence': String(candidate.confidence || '').trim()
  };
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

function mfImageCollectorApplyApprovedReview_(review, decision, targetVersionKey) {
  if (decision === '誤検出' || decision === '保留') return;
  if (String(review['検出種別'] || '').trim() === 'structured_fact') {
    mfImageCollectorApplyStructuredFact_(review);
    return;
  }
  if (decision === '販売SKUとして追加') {
    mfImageCollectorApplySalesSku_(review, targetVersionKey);
    return;
  }
  if (decision === '既存銘柄と同一' || decision === '終売情報として更新') return;

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var versionCol = headers.indexOf('VersionKey');
  var refCol = headers.indexOf('Tリファレンス番号');
  var nameCol = headers.indexOf('現在の公式名');
  var urlCol = headers.indexOf('公式商品ページURL');
  if (versionCol < 0 || refCol < 0 || nameCol < 0) throw new Error('Master columns required for approved review are missing.');

  if (decision === '新規銘柄として追加' || decision === '既存銘柄の新バージョンとして追加') {
    var reference = String(review['Tリファレンス番号'] || '').trim().toUpperCase();
    var versionKey = String(targetVersionKey || mfImageCollectorNextVersionKey_(values, headers, reference)).trim().toUpperCase();
    mfImageCollectorAssertAppendVersionKey_(values, headers, reference, versionKey);
    var versionLabel = mfImageCollectorVersionLabelFromVersionKey_(reference, versionKey);
    var newRow = mfImageCollectorBuildApprovedNewTeaRow_(headers, review, reference, versionKey, versionLabel);
    sheet.appendRow(newRow);
    return;
  }

  if (decision === '既存銘柄を更新') {
    var row = mfImageCollectorFindMasterRowByVersionOrReference_(values, headers, targetVersionKey, String(review['Tリファレンス番号'] || ''));
    if (row < 2) throw new Error('Target master row was not found.');
    if (review['公式名']) sheet.getRange(row, nameCol + 1).setValue(review['公式名']);
    if (urlCol >= 0 && review['公式URL']) sheet.getRange(row, urlCol + 1).setValue(review['公式URL']);
  }
}

function mfImageCollectorApplyStructuredFact_(review) {
  var targetVersionKey = String(review['対象VersionKey'] || review['DB既存VersionKey'] || '').trim();
  var targetColumn = String(review['対象列'] || '').trim();
  var candidateCurrentValue = String(review['現在値'] || '').trim();
  var suggestedValue = String(review['候補値'] || '').trim();
  if (!targetVersionKey) throw new Error('structured_fact target_version_key is required.');
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
  var targetRow = mfImageCollectorFindMasterRowByVersionOrReference_(values, headers, targetVersionKey, '');
  if (targetRow < 2) throw new Error('Target master row was not found for structured_fact: ' + targetVersionKey);
  var targetCol = headers.indexOf(targetColumn);
  if (targetCol < 0) throw new Error('Target master column was not found for structured_fact: ' + targetColumn);

  var range = sheet.getRange(targetRow, targetCol + 1);
  var actualCurrentValue = String(range.getValue() || '').trim();
  var nextValue = mfImageCollectorStructuredFactNextValue_(targetColumn, actualCurrentValue, candidateCurrentValue, suggestedValue);
  if (nextValue === actualCurrentValue) return;
  range.setValue(nextValue);
}

function mfImageCollectorStructuredFactAllowedColumns_() {
  return {
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
  var actual = String(actualCurrentValue || '').trim();
  var expected = String(candidateCurrentValue || '').trim();
  var incoming = mfImageCollectorNormalizeStructuredFactValue_(targetColumn, suggestedValue);
  if (mfImageCollectorStructuredFactMultiValueColumns_()[targetColumn]) {
    var values = mfImageCollectorDelimitedValues_(actual);
    var expectedValues = mfImageCollectorDelimitedValues_(expected);
    for (var i = 0; i < expectedValues.length; i += 1) {
      if (values.indexOf(expectedValues[i]) < 0) {
        throw new Error('Master value changed after structured_fact candidate was created: ' + targetColumn + ' expected token "' + expectedValues[i] + '" but found "' + actual + '".');
      }
    }
    if (values.indexOf(incoming) >= 0) return actual;
    values.push(incoming);
    return values.join('、');
  }
  if (actual === incoming) return actual;
  if (actual !== expected) {
    throw new Error('Master value changed after structured_fact candidate was created: ' + targetColumn + ' expected "' + expected + '" but found "' + actual + '".');
  }
  return incoming;
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

function mfImageCollectorDelimitedValues_(value) {
  return String(value || '').split(/[、,;／|\n]+/).map(function(part) {
    return String(part).trim();
  }).filter(Boolean);
}

function mfImageCollectorVersionLabelFromVersionKey_(reference, versionKey) {
  var ref = String(reference || '').trim().toUpperCase();
  var key = String(versionKey || '').trim().toUpperCase();
  var match = key.match(new RegExp('^' + ref + '-(B\\d{2})$'));
  if (!match) {
    throw new Error('VersionKey and バージョン are inconsistent: ' + key);
  }
  return match[1];
}

function mfImageCollectorBuildApprovedNewTeaRow_(headers, review, reference, versionKey, versionLabel) {
  var officialCategory = mfImageCollectorNormalizeClassificationValueForMaster_(mfImageCollectorReviewOfficialCategory_(review));
  var teaTypeTag = mfImageCollectorTeaTypeTagFromCategory_(officialCategory);
  var officialDescription = mfImageCollectorReviewOfficialDescriptionForMaster_(review);
  var officialUrl = String(review['公式URL'] || '').trim();
  return headers.map(function(header) {
    if (header === 'VersionKey') return versionKey;
    if (header === 'バージョン') return versionLabel;
    if (header === 'Tリファレンス番号') return reference;
    if (header === '現在の公式名') return review['公式名'] || '';
    if (header === '現在の公式説明') return officialDescription;
    if (header === '現在のカテゴリ') return officialCategory;
    if (header === '茶種タグ') return teaTypeTag;
    if (header === '公式商品ページURL') return officialUrl;
    if (header === '公式商品ページURL状態') return officialUrl ? 'available' : 'pending';
    if (header === '黒い本掲載') return 'いいえ';
    if (header === '茶葉画像状態' || header === '茶葉サムネイル状態' || header === '水色画像状態') return 'pending';
    return '';
  });
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
  var direct = ['黒茶', '青茶', '緑茶', '白茶', '黄茶', '後発酵茶', 'ルイボス', 'マテ', 'インフュージョン'];
  for (var i = 0; i < direct.length; i += 1) {
    if (normalized.indexOf(direct[i]) === 0 || normalized.indexOf(direct[i] + '／') === 0 || normalized.indexOf(direct[i] + ',') === 0) {
      return direct[i];
    }
  }
  return mfImageCollectorNormalizeTeaTypeTagsForMaster_(normalized);
}

function mfImageCollectorApplySalesSku_(review, targetVersionKey) {
  var sku = String(review['Tリファレンス番号'] || '').trim().toUpperCase();
  var skuInfo = mfImageCollectorSalesSkuInfo_(sku);
  if (!skuInfo) throw new Error('Unsupported sales SKU reference: ' + sku);

  var ss = mfImageCollectorOpenSpreadsheet_();
  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value).trim(); });
  var parentReference = mfImageCollectorResolveSalesSkuParentReference_(review, targetVersionKey, skuInfo);
  var targetRow = mfImageCollectorFindMasterRowByVersionOrReference_(values, headers, targetVersionKey || review['対象VersionKey'] || review['DB既存VersionKey'], parentReference);
  if (targetRow < 2) throw new Error('Target master row was not found for sales SKU: ' + sku);

  var mapping = mfImageCollectorSalesSkuColumns_(skuInfo.prefix);
  if (!mapping) throw new Error('Unsupported sales SKU prefix: ' + skuInfo.prefix);

  var evidence = mfImageCollectorSalesSkuEvidence_(review);
  if (mapping.flag) mfImageCollectorSetCellByHeader_(sheet, headers, targetRow, mapping.flag, 'はい');
  if (mapping.reference) mfImageCollectorAppendDelimitedCellByHeader_(sheet, headers, targetRow, mapping.reference, sku);
  if (mapping.kind) mfImageCollectorAppendDelimitedCellByHeader_(sheet, headers, targetRow, mapping.kind, skuInfo.prefix);
  if (mapping.evidence) mfImageCollectorAppendDelimitedCellByHeader_(sheet, headers, targetRow, mapping.evidence, evidence);
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

function mfImageCollectorResolveSalesSkuParentReference_(review, targetVersionKey, skuInfo) {
  var existingReference = String(review['DB既存T'] || '').trim().toUpperCase();
  if (/^T\d+$/.test(existingReference)) return existingReference;

  var versionKey = String(targetVersionKey || review['対象VersionKey'] || review['DB既存VersionKey'] || '').trim().toUpperCase();
  var versionMatch = versionKey.match(/^(T\d+)-B\d{2}$/);
  if (versionMatch) return versionMatch[1];

  if (skuInfo.numericSuffix) return 'T' + skuInfo.suffix;
  throw new Error('Parent T reference is required for sales SKU: ' + skuInfo.sku);
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
  var refCol = headers.indexOf('Tリファレンス番号');
  for (var i = 1; i < values.length; i += 1) {
    if (versionKey && versionCol >= 0 && String(values[i][versionCol] || '') === String(versionKey)) return i + 1;
    if (reference && refCol >= 0 && String(values[i][refCol] || '') === String(reference)) return i + 1;
  }
  return -1;
}

function mfImageCollectorNextVersionKey_(values, headers, reference) {
  var versionCol = headers.indexOf('VersionKey');
  if (versionCol < 0) throw new Error('VersionKey column is missing.');
  var ref = String(reference || '').trim().toUpperCase();
  if (!/^T\d+$/.test(ref)) throw new Error('Invalid T reference for VersionKey: ' + reference);
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
  if (!/^T\d+$/.test(ref)) throw new Error('Invalid T reference: ' + reference);
  if (!new RegExp('^' + ref + '-B\\d{2}$').test(key)) {
    throw new Error('VersionKey must use the B-series for this reference: ' + ref + '-B##');
  }
  for (var i = 1; i < values.length; i += 1) {
    if (String(values[i][versionCol] || '').trim().toUpperCase() === key) {
      throw new Error('VersionKey already exists: ' + key);
    }
  }
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
.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.error{background:#fff2f2;border:1px solid #f2b8b8;color:#8a1f1f;padding:10px;margin:10px 0}
</style></head><body><h2>変更候補レビュー</h2><div id="summary">読み込み中...</div><div id="items">読み込み中...</div><script>
function esc(s){return String(s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function dbStatus(it){return it['DB存在確認']||(it['DB既存T']||it['DB既存VersionKey']||it['DB既存名']?'DB既存データあり':'DB既存データなし');}
function fail(where,e){document.getElementById(where).innerHTML='<div class="error">'+esc((e&&e.message)||e||'読み込みエラー')+'</div>';}
function link(label,url){return url?'<div class="url"><b>'+esc(label)+'</b>: <a href="'+esc(url)+'" target="_blank">'+esc(url)+'</a></div>':'';}
function actionControls(it,idx){
  return '<div class="section"><h3>判定</h3><div class="actions"><select id="d'+idx+'"><option>保留</option><option>新規銘柄として追加</option><option>既存銘柄を更新</option><option>既存銘柄の新バージョンとして追加</option><option>販売SKUとして追加</option><option>既存銘柄と同一</option><option>終売情報として更新</option><option>誤検出</option></select><input id="v'+idx+'" placeholder="対象VersionKey"><textarea id="c'+idx+'" placeholder="コメント"></textarea><button onclick="apply('+idx+','+it.row_number+')">反映</button></div></div>';
}
function structuredActionControls(it,idx){
  return '<div class="section"><h3>判定</h3><div class="muted">対象VersionKey: '+esc(it['対象VersionKey']||it['DB既存VersionKey']||'')+'</div><div class="actions"><select id="d'+idx+'"><option value="保留">保留</option><option value="既存銘柄を更新">承認</option><option value="誤検出">却下</option></select><textarea id="c'+idx+'" placeholder="コメント"></textarea><button onclick="apply('+idx+','+it.row_number+')">反映</button></div></div>';
}
function renderStructured(it,idx){
  var lang=it['根拠言語']||it['確認言語']||it['言語']||'';
  var source=it['source_type']||'';
  var confidence=it['confidence']||'';
  return '<div class="item structured"><div class="head"><span>'+esc(it['公式名'])+'</span><span class="muted">'+esc(it['Tリファレンス番号'])+'</span></div><div class="muted">'+esc(it['検出種別'])+' / '+esc(it['ステータス'])+'</div><div class="section"><h3>'+esc(it['対象列'])+'</h3><div class="change"><span class="pill">現在: '+esc(it['現在値']||'なし')+'</span><span>→</span><span class="pill candidate">候補: '+esc(it['候補値'])+'</span></div></div><div class="section"><h3>根拠</h3><div class="evidence">'+esc(it['根拠原文']||'')+'</div><div class="muted">'+esc(lang)+'公式 / '+esc(source)+' / confidence: '+esc(confidence)+'</div>'+link('公式ページ',it['根拠URL']||it['公式URL'])+'</div>'+structuredActionControls(it,idx)+'</div>';
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
    return it['検出種別']==='structured_fact'?renderStructured(it,idx):renderGeneric(it,idx);
  }).join('')||'要確認はありません';
}
function apply(idx,row){
  var versionInput=document.getElementById('v'+idx);
  google.script.run.withSuccessHandler(load).withFailureHandler(function(e){alert((e&&e.message)||e);}).mfImageCollectorApplyReviewDecision(row,document.getElementById('d'+idx).value,versionInput?versionInput.value:'',document.getElementById('c'+idx).value);
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

  var rowIndex = -1;
  for (var i = 1; i < values.length; i += 1) {
    if (String(values[i][refCol]).trim() === reference) {
      rowIndex = i;
      break;
    }
  }
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
    if (String(values[i][refCol]).trim().toUpperCase() !== reference.toUpperCase()) continue;
    if (versionKey && versionCol >= 0 && String(values[i][versionCol]).trim().toUpperCase() !== versionKey.toUpperCase()) continue;
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
    if (String(values[i][refCol]).trim().toUpperCase() !== reference) continue;
    if (versionKey && versionCol >= 0 && String(values[i][versionCol]).trim().toUpperCase() !== versionKey) continue;
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
  if (normalized === 'black tea' || normalized === 'thé noir' || normalized === 'the noir') return '黒茶';
  return raw;
}

function mfImageCollectorNormalizeClassificationValueForMaster_(value) {
  var raw = String(value || '').trim();
  var normalized = raw.replace(/™/g, '').toLowerCase();
  if (!normalized) return '';
  if (normalized === 'black tea' || normalized === 'thé noir' || normalized === 'the noir') return '黒茶';
  if (normalized === 'blue tea' || normalized === 'thé bleu' || normalized === 'the bleu') return '青茶';
  if (normalized === 'green tea' || normalized === 'thé vert') return '緑茶';
  if (normalized === 'white tea' || normalized === 'thé blanc') return '白茶';
  if (normalized === 'yellow tea' || normalized === 'thé jaune') return '黄茶';
  if (normalized === 'rooibos') return 'ルイボス';
  if (normalized === 'maté' || normalized === 'mate') return 'マテ';
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
    .replace(/\bThé jaune\b/gi, '黄茶');
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
    '甘香・菓子系': ['甘香・菓子'],
    '甘香・菓子': ['甘香・菓子'],
    'カカオ系': ['カカオ'],
    'カカオ': ['カカオ'],
    'キャラメル系': ['甘香・菓子', 'キャラメル'],
    'キャラメル': ['甘香・菓子', 'キャラメル'],
    'ナッツ系': ['ナッツ'],
    'ナッツ': ['ナッツ'],
    'モルト': ['モルト'],
    'グリーン': ['植物・青葉'],
    '植物・青葉': ['植物・青葉'],
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
