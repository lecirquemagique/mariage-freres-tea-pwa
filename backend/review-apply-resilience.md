# Resumable Review application (local implementation)

This changes the spreadsheet Review application entry point, not Collector discovery,
queue/recovery/correction processing, Reference Resolution, or Master-wide audit policy.
No Sheet schema, status vocabulary, public POST action, or deployment change is included.

## Apply contract

`mfImageCollectorApplyReviewDecision()` captures a stable detection ID and approved
content/target descriptor before taking ScriptLock, then locates that ID and rebuilds
the descriptor from fresh Review/Master reads inside the lock. All resume persistence,
Master writes/read-back, Review completion/read-back and receipt compaction happen
under that same lock. It releases the lock in finally. Interactive batch confirmation
and completion alerts remain outside the lock. Batch/single-row menu confirmation
pins the descriptor before showing the alert. The Review dialog sends the displayed
detection ID and approval snapshot hash; it cannot act on a different row after sorting.
Explicit dialog decisions/AK are stored under lock only after the displayed snapshot
still matches, preserving the existing dialog approval flow. Other calls require the
human decision and translation AK to be stored on the Review already.

1. Existing decision/Reference/Version/SKU/column/evidence guards still run. Translation
   requires nonblank AK; any caller-provided description must equal AK. AE is never a
   translation source. A duplicate/missing detection ID is rejected.
2. Resolve the existing target or new Version using the existing resolver/builder and
   its snapshot-only dry-run. Derive final expected cells before real Master writes.
   For structured facts, compute canonicalization/union using the **reviewed current
   value**, then freeze the final result. Name updates use DB既存名 as the reviewed
   old name when supplied. Other compound-operation cells use the current snapshot
   accepted by the existing guards as their initial baseline. A concurrent third value is not silently
   included in a newly recomputed merge. For translation the exact AK string is frozen.
3. Save/read-back a schema2 active record in Script Properties under
   `MF_REVIEW_APPLY_V2_<SHA1([spreadsheet ID, sheet ID, detection ID])>`. Validate the
   complete JSON checksum and reconstruct its approval, target mapping and expected
   values before reuse. Saving requires byte-for-byte JSON read-back, not existence.
   A schema1 record is refused and requires explicit investigation/migration.
   Review evidence/provenance/fingerprints are not rewritten.
4. Re-resolve exact Version/Primary/REF and validate **all** affected current cells
   before writing any remaining cell. Exact expected value: skip. Exact old value:
   eligible to write. Neither: fail closed. New rows use the existing append helper;
   an already present exact row is reused, a conflicting/partial row is refused.
   SKU ownership is checked again. Only remaining old cells are written on a multi-cell
   retry. An unfinished Review whose Master already matches but has **no valid active
   record** cannot be marked applied merely because its values happen to match.
5. Flush and reread Master via a new Sheet read, re-resolve identity, and compare all
   expected cells exactly. Missing/duplicated identity/columns, third values, lost
   writes, or mismatches prevent Review finalization.
6. Reread Review and verify immutable identity, decision, target and status still
   match. Save processed_at once in the intent. Write completion timestamp before
   final status, using the saved timestamp on retry. Flush/reread Review and verify
   status, timestamp, decision, target and immutable content hash. Detection ID,
   candidate, evidence, provenance and AK must remain unchanged.
7. A direct replay of an already finalized Review verifies Master and Review without
   rewriting either or changing its timestamp. A finalized Review cannot rewrite
   reverted Master values. A missing timestamp after a partial completion write can
   be completed from the original intent. A divergent existing timestamp is an error.
   The finished path runs before the normal existing-Primary/append guards and creates
   no new resume record. Its approved final cells, exact Version/REF and approval are
   still reconstructed and checked. Retained receipts additionally bind the historical
   identity. An active REVIEW_WRITTEN record resumes any dependent refresh interrupted
   before final receipt creation.

## Resume schema and identity

Active records contain:

- `schema_version=2`, `record_kind=active`, `property_key`, `apply_id`, `state`;
- `detection_id`, `review_row` (diagnostic hint only), `spreadsheet_id`, `sheet_id`;
- `version_key`, `ref`, `primary_reference`, `tea_reference`, `detection_type`;
- `target_column`, `human_decision`, `approved_value`, `expected_master_value`;
- `expected_value_hash`, `review_identity_hash`, `approved_content_hash`, `source_hash`;
- nonempty `cells[{column,old_value,expected_value}]`, append/result metadata,
  original target, creation time, optional frozen `processed_at`, and `record_hash`.

`expected_value_hash` covers the full column-to-final-value map. `record_hash` covers
every saved field except itself. `review_identity_hash` and `approved_content_hash`
use separate domain labels over the same semantic input: detection ID, effective
VersionKey, REF, Primary/T reference, detection type, target column(s), approved final
value(s), human decision, and source hash. Source hash covers immutable candidate,
reviewed old value, AK, evidence and provenance. Translation final value is **AK**;
structured facts use the canonical union computed against the reviewed old value.
Row number, detection/processing time and mutable completion fields are excluded
from semantic identity. A row move changes neither hash nor property key.

On every resume, the effective Version is obtained from the freshly read Review,
even when the caller supplies an empty Version argument. A blank new-Version target
may use only the originally allocated key from a valid active record. B01 cannot
be reused after the Review targets C01. Duplicate or missing detection IDs are errors;
one matching ID at another row is followed. Approval/AK changes fail closed.

Malformed JSON, missing fields, wrong schema, empty/duplicate cells, mismatched hashes,
approved value or target mapping all refuse writes. Recomputing a damaged record's
checksum does not bypass reconstruction from the actual Review/builder.

## State and lifecycle

`PREPARED → MASTER_WRITTEN → MASTER_VERIFIED → REVIEW_WRITTEN → COMPLETED`.
State never moves backwards. A response/property error may leave an earlier phase
than the actual data: re-read and verify the exact frozen identity/cells, then advance.
A verified Master reverting to old/third values is refused, not overwritten. After
Review read-back and dependent refresh succeed, replace the active record with a
small completed receipt: schema/key, ID/Version/REF, identity/final hashes, completion
time, original processing time, apply ID and verified outcome. It retains no cell
values or full approved text. Receipt retention is **7 days, maximum100 newest**;
cleanup runs opportunistically at new intent creation and successful completion.
Only validated completed receipts may be removed. Active/corrupt records are never
TTL-evicted. Capacity is bounded at100 active records and250KB for this namespace;
capacity exhaustion fails closed and requires investigation of unfinished operations.
New detection IDs cannot collide with an old receipt merely by reusing its row.

Finished replay without a receipt remains read-only and requires valid current Review
identity/approval and exact Master cells. It creates no receipt, writes no processing
time and skips normal new-Primary checks. A missing/partial processing time can only
be repaired with the original active record. When a receipt is expired, historical
approval changes cannot be compared with that deleted receipt; current approved
Review content and actual Master must still match, and no Master write is permitted.

The private legacy handlers remain validators/simulators and are not a new public
write API. The application entry point applies the validated frozen plan, not a
second live merge. The translation simulator now supports dry-run snapshots and an
exact already-applied AK match. The name/URL simulator now models its writes too.

## Batch and partial success

The existing dependency ordering is retained. For HOJICHA-like selection616:620,
eligible order is619,620,616; rejected617/618 remain finalized skips. Preflight is
read-only; it checks an existing intent when resuming an incomplete application and
simulates pending cells/appends only in the snapshot for later dependent Reviews.
Journaled finalized rows are reverified before being skipped. A finalized row with
a missing timestamp is eligible only for verified completion from its stored intent.
Preflight validation errors still prevent starting the batch.

Runtime failure stops at the failing Review, preserves prior successes, and does not
execute remaining possible dependents. Return values distinguish:

```json
{
  "ok": false,
  "requested": 3,
  "applied": 2,
  "already_applied": 0,
  "failed": 1,
  "not_processed": 0,
  "results": [],
  "failures": [{ "row_number": 616, "error": "..." }]
}
```

`requested` counts eligible process items, excluding finalized skips.
`applied` counts newly applied, verified Master/Review results; `already_applied`
counts eligible results whose expected Master state was already present. Hold and
reject remain separately available in summary. Completed rows remain finalized
skips under the existing batch policy; an all-completed selection is `no_work` with
zero counters. Direct row replay provides explicit verified/already_applied results.
The failure response does not claim that failed-row writes were rolled back; a
read-back error may leave the intended Master state or partial Review completion.
Resend the same approved Review to reconcile against the durable intent.

## Boundaries and limits

- This is resumability, not a DB transaction. ScriptLock serializes cooperating
  executions in this project; it cannot lock out manual edits or other projects.
  Fresh checks/read-back detect conflicts observed during those operations.
- Durable intent persistence is mandatory. Property save/read-back failure or an
  intent above8500 UTF-8 bytes stops before further Master writes. Property quota
  exhaustion likewise fails closed. Failed active records retain recovery evidence.
- This patch is isolated against committed HEAD. The unrelated uncommitted sales
  status workflow/constants/fixtures are not a prerequisite or part of this change;
  that separate Review type cannot enter this new resilience engine.
- A non-recoverable third value, changed approval/provenance, missing intent for a
  historical partially applied new Version, or corrupt appended row needs human
  investigation. No automatic overwrites or intent-reset endpoint is provided.
- This does not wire the separate Master audit foundation into legacy update paths.
- No production GAS, Sheets, queue, deployment, commit or push is performed by the
  tests. Test Sheets and Script Properties are in-memory fixtures only.
