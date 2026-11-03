# Review correction / supersede

No new columns or statuses. `mfImageCollectorCardCorrectionApply_` is an explicit administrator-only entry point, defaulting to preview. It reuses the recovery administrator secret/server actor gate, exact parent/Version/Primary/REF resolution, completed child snapshot hashes, original immutable receipt and completion manifest. Ordinary PWA requests lack the administrator credential/approval and cannot create corrections.

`mfImageCollectorCardCorrectionApi_` accepts `previewCardResearchCorrection`, `createCardResearchCorrections`, and `recordCardResearchCorrections`. The first always forces read-only preview even if apply=true is supplied. Create/record are aliases for the same idempotent operation; neither creates a queue row, and both default to preview. Actual append additionally requires apply=true and expected_manifest. There is no separate unverified create step.

Production integration is only a new card-research-correction.gs file plus this narrow dispatch immediately after existing POST JSON parsing, leaving all other production functions/files untouched. The local working main contains unrelated changes and is neither staged nor uploaded. The exact production-only dispatch is tracked here:

```javascript
    if (['previewCardResearchCorrection','createCardResearchCorrections','recordCardResearchCorrections'].indexOf(payload.action) >= 0) {
      return mfImageCollectorJson_(mfImageCollectorCardCorrectionApi_(payload));
    }
```

This Web POST addition requires updating the existing deployment version, retaining its ID/URL. A deployment does not authorize Review writes: the production acceptance run uses preview only. GET and existing POST routing remain unchanged.

Payload: existing admin approval fields, parent_request_id, recovery_request_id, operation_id, exact version_key/primary_reference/tea_reference, correction_reason, corrected_by_rule_version, corrections[]. Each correction supplies original_detection_id, original_review_row, expected_original_fingerprint and an ordinary complete_card candidate. Scope is restricted to structured_fact 香味詳細タグ / 香味大分類. Description translation is not corrected through this path.

Current canonical `mfImageCollectorCardResearchBuildReview_` constructs each new row and keeps evidence, language variants, target validation and aroma union. A deterministic correction identity replaces the ordinary request identity. `公式情報JSON.card_research.correction` stores supersedes_detection_id, original_review_row/fingerprint, correction_reason, corrected_by_rule_version/source, server actor, original_recovery_child_id and parent_request_id. This object participates in the existing receipt fingerprint. No old receipt algorithm changes.

The new `card_research.request_id = correction-<hash>` is an audit namespace, **not a queue request**. It deliberately differs from the original recovery child; adding a new candidate to a completed child's persisted manifest would invalidate history. Detection ID is `card-correction-<hash>`. Identity covers canonical candidate/evidence/provenance, original receipt, reason, rule and actor; timestamps and operation ID are excluded. The operation ledger binds parent+operation_id to the preview manifest. Replay uses the same ID/fingerprint, returning existing verified rows; different content under the same operation or a conflicting correction fork fails closed.

Explicit apply requires `apply=true` and the preview's expected_manifest. All planning, append, read-back and validation run inside the script lock. Both rows are prepared before the first append. Append/validation/read-back failure throws, never claims completion; retry the same operation, which reuses any verified saved row. Review writes are not a database transaction: a partial append can remain, requiring the same-operation retry or administrator reconciliation. A final full read-back confirms both receipts before a retirement recommendation is returned. Master and queue have no write path; original Review rows are never edited by this function. Missing or changed Master/parent snapshot, wrong receipt, already-applied original, conflicting target/evidence or provenance prevents execution.

After both corrected rows are verified, a **separately authorized** follow-up should mark old 617/618 `却下` and add comments pointing to the replacements: the earlier candidates were validly persisted, then superseded after extraction improvements. `保留`, `要確認`, and `承認` all remain apply-eligible, so they do not prevent accidental application. No automatic retirement is implemented here. Until that follow-up, do not batch-apply old and new candidates together.

Review616 needs no replacement. AK 承認済み日本語説明, human decision, status and comments are excluded from immutable candidate fingerprints. Its FR-based approved translation can be entered and approved with the ordinary existing-update flow; without explicit AK text translation application still fails closed. No AK input is performed by this implementation.

Offline dry-run:

```powershell
node scripts/complete-card-correction-dry-run.cjs snapshot.json child-preview.json 617,618 output.json
```

The script has no network or production writer and loads saved FR/EN evidence into the current collector, refreshes target values from the supplied snapshot, then invokes the actual GAS planner with read-only sheet adapters. Fixed-range exports are trimmed to GAS getDataRange width. Where a FORMULA export contains formulas rather than evaluated values, the offline adapter uses the saved server-evaluated recovery preview target and explicitly reports those fields; it does not evaluate or guess formulas. Snapshot evidence is historical; a live deployment/apply must fresh-read and repeat the same checks. Preview outputs IDs, fingerprints, supersedes, current/corrected values, evidence and provenance. HOJICHA expected detail: チョコレート、ヴァニラ、キャラメル、木質; category: スパイス、甘香・菓子、カカオ、キャラメル、ウッディ.
