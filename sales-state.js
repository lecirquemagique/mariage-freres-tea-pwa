(function(root) {
  'use strict';
  const text = value => String(value || '').trim();
  function listing(row) {
    const value = text(row['公式掲載状態']);
    return ['掲載中', '未掲載'].includes(value) ? value : '未確認';
  }
  function confirmed(row) {
    // Legacy 終売/販売終了 alone is not evidence of confirmed discontinuation.
    return text(row['現行ステータス']) === '終売確定';
  }
  function migrationComplete(payload) {
    return payload?.salesStateMigration?.version === 1 && payload.salesStateMigration.complete === true;
  }
  function matchesScope(row, scope, complete = false) {
    if (scope === 'all') return true;
    if (scope === 'past') return listing(row) === '未掲載' || confirmed(row);
    if (confirmed(row) || listing(row) === '未掲載') return false;
    if (listing(row) === '掲載中') return true;
    // Until audited initialization is explicitly complete, preserve old shopping visibility.
    return !complete && !['終売', '販売終了'].includes(text(row['現行ステータス']));
  }
  function isOldVersion(row, rows) {
    const primary = text(row['Primary Reference']);
    return !!primary && listing(row) === '未掲載' && rows.some(other =>
      other !== row && text(other['Primary Reference']) === primary &&
      text(other.VersionKey) !== text(row.VersionKey) && listing(other) === '掲載中');
  }
  function badges(row, rows) {
    const result = [];
    if (confirmed(row)) result.push('終売確定');
    else if (listing(row) === '掲載中') result.push('公式掲載中');
    else if (listing(row) === '未掲載') result.push('公式未掲載');
    else result.push('掲載未確認');
    if (isOldVersion(row, rows)) result.push('旧版');
    return result;
  }
  const api = { listing, confirmed, migrationComplete, matchesScope, isOldVersion, badges };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MFSalesState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
