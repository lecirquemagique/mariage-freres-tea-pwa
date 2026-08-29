/*
 * MARIAGE FRERES image collector writeback helpers.
 *
 * Replace the existing mf-image-collector.gs file with this whole file.
 * Keep exactly one top-level doPost(e); mfImageCollectorDoPost(e) handles
 * both uploadImageResults and updateProductPageUrl actions.
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
    if (payload.action === 'uploadImageResults') {
      return mfImageCollectorJson_(mfImageCollectorUploadImageResults_(payload));
    }
    if (payload.action === 'updateProductPageUrl') {
      return mfImageCollectorJson_(mfImageCollectorUpdateProductPageUrl_(payload));
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

function mfImageCollectorOpenSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('MF_MASTER_SPREADSHEET_ID');
  if (!spreadsheetId && typeof SPREADSHEET_ID !== 'undefined') {
    spreadsheetId = SPREADSHEET_ID;
  }
  var ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet not found. Bind this script, define SPREADSHEET_ID, or set MF_MASTER_SPREADSHEET_ID.');
  return ss;
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
