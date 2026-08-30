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
  '処理日時'
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

function doPost(e) {
  return mfImageCollectorDoPost(e);
}

function onOpen(e) {
  mfImageCollectorOnOpen(e);
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
  var items = [];
  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    if (status && String(row[statusCol] || '') !== status) continue;
    var item = { row_number: i + 1 };
    for (var j = 0; j < headers.length; j += 1) item[headers[j]] = row[j];
    items.push(item);
  }
  return items;
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
  var detectionId = String(candidate.detection_id || '').trim() || mfImageCollectorReviewDedupeKey_(candidate);
  var existingRow = mfImageCollectorFindReviewRow_(sheet, headers, detectionId);
  var rowValues = mfImageCollectorReviewCandidateToRow_(candidate, detectionId);

  if (existingRow > 0) {
    var status = String(sheet.getRange(existingRow, headers.indexOf('ステータス') + 1).getValue() || '');
    if (status === '要確認' || status === '保留') {
      mfImageCollectorSetReviewRowValues_(sheet, existingRow, {
        '検出日時': rowValues['検出日時'],
        'Collectorが取得した根拠': rowValues['Collectorが取得した根拠'],
        'コメント': rowValues['コメント']
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
    var fallbackDetectionId = String(candidate.detection_id || '').trim() || mfImageCollectorReviewDedupeKey_(candidate);
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
  var detectionId = String(candidate.detection_id || '').trim() || mfImageCollectorReviewDedupeKey_(candidate);
  var existingRow = mfImageCollectorFindReviewRow_(sheet, headers, detectionId);
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
        sheet.insertColumnAfter(sheet.getLastColumn());
        sheet.getRange(1, sheet.getLastColumn()).setValue(MF_IMAGE_COLLECTOR_REVIEW_HEADERS[i]);
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
    '処理日時': ''
  };
}

function mfImageCollectorReviewDedupeKey_(candidate) {
  var raw = [
    candidate.reference || '',
    candidate.detection_type || '',
    candidate.official_url || '',
    candidate.official_name || '',
    candidate.source_language || '',
    candidate.diff_summary || ''
  ].join('|');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, raw, Utilities.Charset.UTF_8);
  return digest.map(function(byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
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

function mfImageCollectorSetReviewRowValues_(sheet, rowNumber, updates) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value).trim(); });
  Object.keys(updates).forEach(function(header) {
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
  if (decision === '販売SKUとして追加' || decision === '既存銘柄と同一' || decision === '終売情報として更新') return;

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
    var versionKey = targetVersionKey || mfImageCollectorNextVersionKey_(values, headers, String(review['Tリファレンス番号'] || ''));
    var newRow = headers.map(function(header) {
      if (header === 'VersionKey') return versionKey;
      if (header === 'Tリファレンス番号') return review['Tリファレンス番号'] || '';
      if (header === '現在の公式名') return review['公式名'] || '';
      if (header === '公式商品ページURL') return review['公式URL'] || '';
      if (header === '公式商品ページURL状態') return review['公式URL'] ? 'available' : 'pending';
      return '';
    });
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
  var prefix = String(reference || '').trim() + '-N';
  var max = 0;
  for (var i = 1; i < values.length; i += 1) {
    var value = String(values[i][versionCol] || '');
    if (value.indexOf(prefix) !== 0) continue;
    var number = Number(value.slice(prefix.length));
    if (number > max) max = number;
  }
  return prefix + ('0' + (max + 1)).slice(-2);
}

function mfImageCollectorReviewHtml_() {
  return '<!doctype html><html><head><base target="_top"><style>body{font-family:Arial,sans-serif;margin:20px}button,select,input,textarea{font:inherit;margin:4px 0}.item{border:1px solid #ddd;padding:12px;margin:12px 0}.muted{color:#666}.url{word-break:break-all}</style></head><body><h2>変更候補レビュー</h2><div id="summary"></div><div id="items"></div><script>function esc(s){return String(s||"").replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));}function load(){google.script.run.withSuccessHandler(render).mfImageCollectorGetReviewItems("要確認");google.script.run.withSuccessHandler(s=>document.getElementById("summary").textContent="要確認 "+s.pending_count+"件 / 最古 "+(s.oldest_pending_at||"なし")).mfImageCollectorGetReviewSummary();}function render(items){document.getElementById("items").innerHTML=(items||[]).map((it,idx)=>`<div class="item"><b>${esc(it["Tリファレンス番号"])}</b> ${esc(it["公式名"])}<div class="muted">${esc(it["検出種別"])} / ${esc(it["言語"])}</div><div>DB: ${esc(it["DB既存VersionKey"])} ${esc(it["DB既存名"])}</div><div>${esc(it["差分概要"])}</div><div class="url"><a href="${esc(it["公式URL"])}" target="_blank">${esc(it["公式URL"])}</a></div><div><select id="d${idx}"><option>保留</option><option>新規銘柄として追加</option><option>既存銘柄を更新</option><option>既存銘柄の新バージョンとして追加</option><option>販売SKUとして追加</option><option>既存銘柄と同一</option><option>終売情報として更新</option><option>誤検出</option></select><input id="v${idx}" placeholder="対象VersionKey"><textarea id="c${idx}" placeholder="コメント"></textarea><button onclick="apply(${idx},${it.row_number})">反映</button></div></div>`).join("")||"要確認はありません";}function apply(idx,row){google.script.run.withSuccessHandler(load).withFailureHandler(e=>alert(e.message||e)).mfImageCollectorApplyReviewDecision(row,document.getElementById("d"+idx).value,document.getElementById("v"+idx).value,document.getElementById("c"+idx).value);}load();</script></body></html>';
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
