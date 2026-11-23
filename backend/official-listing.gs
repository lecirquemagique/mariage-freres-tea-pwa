// Pure listing plans: no Sheet writes, deployment hooks, or background execution.
function mfOfficialListingText_(value) { return String(value || '').trim(); }
function mfOfficialListingDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    return typeof Utilities !== 'undefined' ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd') : value.toISOString().slice(0,10);
  }
  var text = mfOfficialListingText_(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  var date = new Date(text + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0,10) === text ? text : '';
}

var MF_OFFICIAL_LISTING_STATES = ['未確認', '掲載中', '公式掲載なし', '公式掲載終了'];

function mfImageCollectorOfficialListingAllowed_(values, columnIndex) {
  var allowed = MF_OFFICIAL_LISTING_STATES.slice();
  values.slice(1).forEach(function(row) {
    var value = mfOfficialListingText_(row[columnIndex]);
    if (value && allowed.indexOf(value) < 0) allowed.push(value);
  });
  return allowed;
}

// Read-only schema/validation plan; evidence must not share the sales evidence cell.
function mfImageCollectorOfficialListingSchemaPlan_(headers, rows) {
  var next = headers.slice(), additions = [];
  if (headers.some(function(h, i) { return !h || headers.indexOf(h) !== i; })) throw new Error('Ambiguous Master headers.');
  ['公式掲載状態', '公式掲載根拠／出典'].forEach(function(h) {
    if (next.indexOf(h) < 0) { next.push(h); additions.push({column: next.length, header: h}); }
  });
  return {dry_run:true, actual_writes:0, headers:next, add_columns:additions,
    canonical_states:MF_OFFICIAL_LISTING_STATES.slice(),
    listing_allowed:mfImageCollectorOfficialListingAllowed_([['公式掲載状態']].concat((rows || []).map(function(r) { return [r['公式掲載状態']]; })), 0)};
}

// Every observation produces a local plan only. Negative classifications require human review.
function mfImageCollectorListingObservationPlan_(row, observation) {
  var t = mfOfficialListingText_;
  if (!t(row.VersionKey) || observation.version_key !== t(row.VersionKey) || observation.identity_verified !== true) {
    throw new Error('Observation must verify the exact Version identity.');
  }
  var date = mfOfficialListingDate_(observation.checked_at);
  var today = typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') : new Date().toISOString().slice(0,10);
  if (!date || date > today || !t(observation.evidence) || !t(observation.identity_evidence)) throw new Error('Dated identity and observation evidence required.');
  if (MF_OFFICIAL_LISTING_STATES.indexOf(observation.listing) < 0) throw new Error('Unsupported listing observation.');
  var url = t(observation.source_url);
  if (observation.listing === '掲載中' &&
      (!mfImageCollectorListingProductUrl_(url) || observation.product_page_verified !== true || observation.access_blocked === true)) {
    throw new Error('Verified official product page required.');
  }
  var negative = ['公式掲載なし', '公式掲載終了'].indexOf(observation.listing) >= 0;
  if (negative) {
    if (observation.access_blocked === true || observation.scope_complete !== true ||
        observation.catalog_checked !== true || observation.product_page_checked !== true ||
        observation.redirects_checked !== true || observation.alternate_references_checked !== true ||
        observation.current_listing_found !== false ||
        !Array.isArray(observation.markets) || !['JP','FR','EN'].every(function(m) { return observation.markets.indexOf(m) >= 0; }) ||
        !observation.markets.every(function(m) { return ['JP','FR','EN'].indexOf(m) >= 0; }) ||
        !Array.isArray(observation.checks) || !observation.markets.every(function(m) {
          return observation.checks.some(function(c) { return c.market === m && t(c.query) &&
            mfImageCollectorListingOfficialUrl_(c.url) && ['not_found','no_matching_product','redirect_no_match'].indexOf(c.result) >= 0 && c.accessible === true; });
        })) throw new Error('Complete accessible market/search/URL checks required.');
    if (observation.listing === '公式掲載なし' && (observation.history_checked_no_match !== true || observation.matching_history_found !== false)) {
      throw new Error('No matching current or historical listing must be established.');
    }
    if (observation.listing === '公式掲載終了' &&
        (observation.matching_history_found !== true || !mfImageCollectorListingProductUrl_(observation.previous_url) ||
         !mfImageCollectorListingOfficialUrl_(observation.history_source_url) ||
         !mfOfficialListingDate_(observation.history_date) || observation.history_date > date ||
         !t(observation.history_evidence) || observation.history_identity_verified !== true ||
         observation.old_url_checked !== true || observation.relocation_checked !== true)) {
      throw new Error('Same-Version historical listing and current relocation checks required.');
    }
  }
  var updates = {'公式掲載状態': observation.listing};
  updates['公式掲載根拠／出典'] = [t(row['公式掲載根拠／出典']), JSON.stringify(observation)].filter(Boolean).join('\n');
  return {dry_run:true, actual_writes:0, version_key:row.VersionKey, requires_human_review:negative, updates:updates};
}

function mfImageCollectorListingOfficialUrl_(value) {
  return /^https:\/\/(?:www\.)?mariagefreres\.(?:com|co\.jp)\/[^\s<>"'\\]*$/i.test(mfOfficialListingText_(value));
}
function mfImageCollectorListingProductUrl_(value) {
  var url = mfOfficialListingText_(value);
  return mfImageCollectorListingOfficialUrl_(url) &&
    (/^https:\/\/(?:www\.)?mariagefreres\.com\/(?:fr|en)\/[^?#]+\.html(?:\?[^#]*)?$/i.test(url) ||
     /^https:\/\/(?:www\.)?mariagefreres\.co\.jp\/view\/item\/[0-9]+(?:\?[^#]*)?$/i.test(url));
}
