/*
 * MARIAGE FRERES image collector writeback helpers.
 *
 * Add this file to the existing Google Apps Script project, or copy the
 * functions into the current Code.gs. If that project already has doPost(e),
 * call mfImageCollectorDoPost(e) from the existing dispatcher when
 * action === 'uploadImageResults' instead of defining a second doPost.
 */

var MF_IMAGE_COLLECTOR_FOLDER_ID = '192M8W9aopop-k0H_xHMJBWkEVy3fK4eX';
var MF_IMAGE_COLLECTOR_SHEET_NAME = '銘柄マスター';
var MF_IMAGE_COLLECTOR_SECRET_PROPERTY = 'MF_COLLECTOR_WRITE_SECRET';

function doPost(e) {
  return mfImageCollectorDoPost(e);
}

function mfImageCollectorDoPost(e) {
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.action !== 'uploadImageResults') {
      return mfImageCollectorJson_({ ok: false, error: 'Unsupported action.' });
    }
    return mfImageCollectorJson_(mfImageCollectorUploadImageResults_(payload));
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

  var folder = DriveApp.getFolderById(folderId);
  var duplicatePolicy = String(payload.duplicate_policy || 'skip').toLowerCase();
  var urlSize = String(payload.url_size || 'w1200');
  var uploaded = [];
  var images = payload.images || [];

  for (var i = 0; i < images.length; i += 1) {
    var image = images[i] || {};
    var imageType = String(image.image_type || '').trim();
    if (imageType !== 'tea' && imageType !== 'liqueur') continue;

    var fileName = String(image.file_name || '').trim();
    if (!fileName) throw new Error('file_name is required.');
    var mimeType = String(image.mime_type || 'application/octet-stream');
    var base64 = String(image.data_base64 || '');
    if (!base64) throw new Error('data_base64 is required.');

    var fileResult = mfImageCollectorUpsertFile_(folder, fileName, mimeType, base64, duplicatePolicy);
    uploaded.push({
      image_type: imageType,
      file_id: fileResult.file.getId(),
      name: fileResult.file.getName(),
      mime_type: mimeType,
      action: fileResult.action,
      url: mfImageCollectorThumbnailUrl_(fileResult.file.getId(), urlSize)
    });
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

function mfImageCollectorUpdateSheet_(reference, images) {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('MF_MASTER_SPREADSHEET_ID');
  var ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet not found. Bind this script or set MF_MASTER_SPREADSHEET_ID.');

  var sheet = ss.getSheetByName(MF_IMAGE_COLLECTOR_SHEET_NAME);
  if (!sheet) throw new Error('Sheet not found: ' + MF_IMAGE_COLLECTOR_SHEET_NAME);

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Sheet has no data rows.');

  var headers = values[0].map(function(value) { return String(value).trim(); });
  var refCol = headers.indexOf('Tリファレンス番号');
  var teaCol = headers.indexOf('茶葉画像URL');
  var liqueurCol = headers.indexOf('水色画像URL');
  if (refCol < 0 || teaCol < 0 || liqueurCol < 0) {
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
    var col = image.image_type === 'tea' ? teaCol : liqueurCol;
    sheet.getRange(rowIndex + 1, col + 1).setValue(image.url);
  }

  return rowIndex + 1;
}

function mfImageCollectorThumbnailUrl_(fileId, size) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=' + encodeURIComponent(size || 'w1200');
}

function mfImageCollectorJson_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
