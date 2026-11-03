# 管理者承認済みcomplete_card recovery（ローカル実装・未導入）

元requestをparentとして保持し、別UUIDの子依頼だけを進める。通常PWA、通常complete_card、legacy discoveryにcompleted再利用の例外を設けない。Masterへは書かず、未承認Reviewの永続化までが責務。

## schema

既存の銘柄指定調査キューA:Sを使用し、列・statusを追加しない。`request_id`が新しいrecovery_request_id、`request_type=complete_card_recovery`、`source=Human`。名称・VersionKey・Primary/T番号は親とfresh Masterからサーバーが確定する。`created_at/requested_at`はサーバー時刻。`missing_fields`は明示承認されたtarget_columnsで、作成時に親の範囲内かつ現在も不足していることを要求する。

message内の`recovery`に以下を保存する。

- recovery_request_id / parent_request_id / parent_queue_row
- version_key / primary_reference / tea_reference / target_name
- recovery_reason / operation_id / source
- approved_by_admin=true / approved_by / approved_at / created_at
- target_columns / target_values / target_snapshot_hash
- parent_snapshot（元行の全値と見出し）/ parent_snapshot_hash

statusは新行のpending→processing→completed。完了時も同じrecovery metadataを残し、recovery_resultにexpected/persisted/verified/persisted_review_idsを記録する。completed_atは既存H列。元行の全セルは一切変更しない。現在の実装は、completed/review_only/proposed=[]が確認できるPWA complete_card親だけを対象にする。別形式の失敗は自動採用しない。

## 管理者承認

GAS Script Propertiesの`MF_CARD_RECOVERY_ADMIN_SECRET`と`MF_CARD_RECOVERY_ADMIN_NAME`が必要。通常の`MF_COLLECTOR_WRITE_SECRET`とは異なるsecretを必須とする。未設定なら無効。PWAへsecretを配布しない。APIは毎回admin_secret、approved=true、parent_request_id、operation_id、Version/Primary/T一致を要求する。approved_byはpayloadを採用せずサーバー設定から確定する。

`MF_CARD_RECOVERY_OP_<hash(parent,operation)>`の承認ledgerを、子行append前に作る。新UUIDとmetadata hashを結び、手動投入行や改ざんされたmetadataを採用しない。同じparent+operationの再送は同じUUIDを返す。作成結果不明で行が見つからない場合も再発行せず照合待ちにする。別operationで同じparentの未完了復旧を競合作成することも拒否する。

これは通常PWA利用者の承認フラグだけでは利用できない。新しい本番secret設定・ファイル保存・deploymentは本作業では行わない。

## POST API

全APIがtext/plain JSON。`backend/card-research-recovery.gs`を別GASファイルとしてローカル実装し、メインdoPostから次のactionだけを振り分ける。

| action | 処理 |
|---|---|
| createCardResearchRecoveryRequest | 既定preview。target_columnsとrecovery_reasonも必要。実作成はapply=trueとpreviewで得たexpected_target_hashが必要 |
| claimCardResearchRecoveryRequest | 既定preview。dryRun=falseを明示した場合のみ子依頼をclaim |
| recordCardResearchRecoveryCandidate | 既定preview。実保存はdryRun=false、子claim token、全expected_candidatesが必要 |
| completeCardResearchRecoveryRequest | 既定preview。実完了はdryRun=false、子claim token、全expected_candidatesが必要 |

各workerで親の存在・失敗内容の全snapshot、Version/Primary/T、対象Masterの主要値、現在の不足、承認ledger、既存Reviewをロック内で再検証する。人間がMasterを更新した場合、同operationの履歴取得は可能だが、実workerはtarget_changedとして停止する。既存の別Reviewが対象列にあれば重複作成せず照合待ちにする。自分の検証済みReviewは再送可能。

v87のbuilder/read-back/fingerprint/verified/行番号/検出ID/manifest検証を共用する。回復元・operation・承認・親snapshotをReviewのcard_research.recoveryにも保存し、fingerprint対象にする。期待する全target_columnsが揃わなければcomplete不可。保存0/一部/内容不整合はpersistence errorでprocessingを保持する。日本語説明は翻訳Reviewを作るだけで、承認済み日本語説明を埋めない。Master反映は従来の人間承認が別途必要。

## CLI

通常の`--research-queue-only`と分離した`--research-recovery-only`を追加。secretは環境変数`MF_CARD_RECOVERY_ADMIN_SECRET`からだけ取得し、引数・ログへ出さない。以下は将来導入後の**dry-run例**で、現在の本番へは実行しない。

```powershell
node collector/collector.js --research-recovery-only `
  --parent-request-id 76c49d5c-9fd2-4385-9ab4-34a9dc6116cd `
  --operation-id hojicha-recovery-20261103 --approve-recovery `
  --recovery-version-key T425-B01 --recovery-primary T425 --recovery-ref T425 `
  --recovery-fields "現在の公式説明,香味詳細タグ,香味大分類" `
  --recovery-reason "Review永続化失敗の復旧" `
  --connect-cdp http://127.0.0.1:9222 --dry-run
```

実行時はまず管理者APIのpreviewと現在のCDP公式探索を行う。必要な全候補が揃わないなら子依頼を作らない。将来別途承認された`--write-back`実行だけが新UUIDを作成し、その1件をclaim→Review保存→完了へ進める。既存子を再確認する場合は`--request-id <recovery UUID>`を指定する。通常画像・通常URL状態更新へは進まない。借用タブの非navigation/非reload/非close規則、REF/名称/canonical/言語別集約の安全条件は共通のまま。

dry-runはUUID・承認ledger・子行を作らない。CLIのrecovery-previewという識別子はローカルのpreview用で、登録済みrequest IDではない。管理者が実作成後のtokenを保持して同内容のrecord APIを再送した場合は、既存Reviewをverifiedで返す。processingを自動reclaimする機能は追加していない。

## 本番実復旧までの手順案

1. 差分監査・テスト後、別途承認を受けてGAS新ファイルと限定変更、Collectorを反映する。
2. 通常Collectorとは別のadmin secret・サーバー側承認者名を安全に設定する。secretをPWAへ含めない。
3. queue211・Master・Reviewをfresh readし、CDPによる管理者dry-runで現在の根拠と3候補を確認する。変化や既存Reviewがあれば停止する。
4. 人間がその計画を承認した後、同operationで新UUIDを1件だけ作る。親行不変と子行read-backを確認する。
5. その子だけを実行し、3/3の永続化、provenance、親不変、Master無変更を検証する。子だけをcompletedにする。
6. 実Reviewは未承認で残し、Master反映は次の人間判断へ渡す。

未完了の同Version recoveryは既存PWAのalready_queued判定で安全に抑止される。完了済みrecoveryは通常complete_cardの1年履歴へ転用しない。legacyは既存のVersionKeyガードで子行をclaim/completeできない。これらの既存ロジックは変更しない。
