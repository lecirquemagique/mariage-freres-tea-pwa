(function(root) {
  'use strict';
  const text = value => String(value || '').trim();
  function listing(row) {
    const value = text(row['公式掲載状態']);
    return ['掲載中', '公式掲載なし', '公式掲載終了', '未掲載'].includes(value) ? value : '未確認';
  }
  // Retain the historical scope for legacy rows without inventing a new classification.
  const absent = row => ['公式掲載なし', '公式掲載終了'].includes(listing(row)) || text(row['公式掲載状態']) === '未掲載';
  function confirmed(row) {
    // Legacy 終売/販売終了 alone is not evidence of confirmed discontinuation.
    return text(row['現行ステータス']) === '終売確定';
  }
  function migrationComplete(payload) {
    return payload?.salesStateMigration?.version === 1 && payload.salesStateMigration.complete === true;
  }
  function matchesScope(row, scope, complete = false) {
    if (scope === 'all') return true;
    if (scope === 'past') return absent(row) || confirmed(row);
    if (confirmed(row) || absent(row)) return false;
    if (listing(row) === '掲載中') return true;
    // Until audited initialization is explicitly complete, preserve old shopping visibility.
    return !complete && !['終売', '販売終了'].includes(text(row['現行ステータス']));
  }
  function isOldVersion(row, rows) {
    const primary = text(row['Primary Reference']);
    return !!primary && listing(row) === '公式掲載終了' && rows.some(other =>
      other !== row && text(other['Primary Reference']) === primary &&
      text(other.VersionKey) !== text(row.VersionKey) && listing(other) === '掲載中');
  }
  function badges(row, rows) {
    const result = [];
    if (listing(row) === '掲載中') result.push('公式掲載中');
    else if (listing(row) !== '未確認') result.push(listing(row));
    else result.push('未確認');
    const status = text(row['現行ステータス']);
    if (['終売推定', '終売確定'].includes(status)) result.push(status);
    if (isOldVersion(row, rows)) result.push('旧版');
    return result;
  }
  const api = { listing, confirmed, migrationComplete, matchesScope, isOldVersion, badges };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MFSalesState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
