# complete_card Collector接続（ローカル実装・未導入）

対象request_idは `2a855a7a-a012-449b-ab9a-393639ace1a2`、VersionKeyは `T2306-B01`。
本番169行を実行する承認ではない。今回の実行はメモリ内mockのみ。本番GAS保存・deployment・Sheets変更・commit/pushは未実施。

## 分離と識別

legacy `getTargetDiscoveryRequest` / `completeTargetDiscoveryRequest` とtargeted discoveryの本体は変更しない。
complete_cardは専用POSTだけを使用する。全POSTは既存Collector secretで認証し、ScriptLock内でfresh readする。

毎回、request_idの完全一致・一意性、request_type=complete_card、source=PWA、MasterのVersionKey完全一致・一意性、Primary/T番号/target_refの整合を検証する。
行番号、REFのprefix/suffix、B/C/N、名前の類似からVersionを選ばない。公式ページのexact REFと、対象Versionの現在公式名（空欄なら黒い本名、その両方が空欄なら依頼名）の正規化完全一致が必要。名前変更・T番号再利用で対応が曖昧なら候補を出さない。

調査対象は `依頼時missing_fields ∩ 最新Masterで空欄または未確認の列`。依頼後に埋まったセルは変更候補にしない。
既存Masterの正規語彙もclaim応答へ含めるが、語彙自体は事実の根拠にしない。

## 専用API

すべて同じ既存Web Appへ `text/plain;charset=utf-8` のJSON POST。

| action | 必須入力 | 結果／書込み |
| --- | --- | --- |
| claimCardResearchRequest | secret, request_id。dryRun=trueでpreview | preview / claimed / busy / already_completed。実claimのみキューF status・G started_at、所有tokenをScript Propertiesへ保存 |
| recordCardResearchCandidate | secret, request_id, claim_token, version_key, primary_reference, tea_reference, candidate | recorded / already_recorded。対象Review行だけ追記・入力規則設定。既存の別候補を上書きしない |
| completeCardResearchRequest | secret, request_id, claim_token, version_key, primary_reference, tea_reference, unresolved | completed / already_completed。キューF:Lを単一range write（G開始日時は保持）。Masterは書かない |

candidateはtarget_column/current_value/suggested_value/evidence_text/evidence_url/evidence_language/official_name/verified_references。
サーバーで再度対象・不足状態・期待旧値・公式商品URL・REF・商品名・列allowlistを検証し、既存candidate serializerでReviewを作る。
Version/REFとReference Resolutionはサーバーが既存Masterから確定する。人間判定は空欄、ステータスは要確認。新規Primary・新Version候補は作らない。
Master用の任意列名や、画像アップロード／直接更新APIへ転送する仕組みはない。

## Reviewの範囲

- 茶種・産地・香味・特徴は既存structured_factの根拠抽出・Review経路を再利用。茶種にREF由来のdefaultは使わない。
- URL、掲載状態、販売状態、現在公式名はcomplete_card来歴・既存Primary・明示Version・根拠の揃ったstructured_fact Reviewだけで扱う。一般structured_fact allowlistは変更しない。
- 掲載状態は有効な公式商品ページから「掲載中」だけ候補化。検索失敗から未掲載・終売を生成しない。
- 販売状態は同じexact SKUのProduct JSON-LD、または可視の商品内Notify me等の明示情報が必要。単なるカート文言から販売中を推測しない。矛盾した在庫根拠は保留。
- 公式説明はofficial_description_translation候補にし、承認済み日本語説明を空欄に保つ。候補値を承認文章へ自動流用しない。
- 水出し用ブレンドの専用根拠抽出は未対応。通常の水出しレシピだけでブレンド区分を埋めない。
- 画像3列は `image_review_pipeline_required` として未解決に残す。既存画像Collectorの取得・キャッシュ・Drive配置処理を変更せず、Masterへ書くuploadImageResults等は呼ばない。安全なDrive保存→画像Review経路の追加は後続作業。
- 公式アクセスが403/Cloudflare等で止まれば回避せず未解決を記録する。

完了messageはJSONでmode=review_only、version_key、proposed（列・検出ID・Review行）、unresolved（列・理由）、already_filledを保持する。
proposedはクライアント申告ではなく、そのrequest_idで実際に保存されたReviewからサーバーが集計する。
`completed`は調査試行・候補記録の完了であり、Master補完完了を意味しない。

## CLI

導入後にのみ使用する例（今回、実行しない）：

```powershell
# 既定はpreview。キュー／Reviewへの書込みなし。
node collector/collector.js --connect-cdp http://127.0.0.1:9222 --research-queue-only --request-id 2a855a7a-a012-449b-ab9a-393639ace1a2

# 将来の個別承認後だけ実行する。
.\collector\run-cdp-once.ps1 -ResearchQueueOnly -RequestId 2a855a7a-a012-449b-ab9a-393639ace1a2 -WriteBack -Debug
```

`--research-queue-only` と `--request-id` は必ず併用。他の処理モードやREF指定との併用は拒否する。
設定ファイルのwriteBack.enabledだけではclaimしない。実書込みは明示--write-backが必要で、--dry-runが優先する。
実claimの前にCDP接続を確認し、ブラウザーに接続できない場合はpending依頼を消費しない。
mainは通常Master読込・ローカル状態初期化・URL状態自動更新・通常5件選択より先に専用経路へ分岐してreturnする。
通常画像処理、新規探索、他のqueue claimへフォールバックしない。

## 失敗・再実行

claim所有tokenはrequest_id・Version・Primary/T・依頼時missing_fieldsに拘束する。別workerのclaimはbusy。completedの再claimはalready_completedで無書込み。
Reviewの検出IDはrequest_idと既存candidate dedupe keyから生成する。同じ候補の再送は既存行を返し、必要な入力規則を再設定する。
Review記録の失敗／応答不明時は完了へ進まない。MasterとReviewの対象、期待旧値を各POSTで再検証する。
完了statusと結果messageは同じrange writeで保存する。書込み成功後の応答だけを失った場合、再送はalready_completedとなり、結果が欠けたcompleted行を作らない。

SheetsとPropertiesに跨る完全なtransactionはない。claim token保存後にstatus更新が失敗した場合や、通信結果不明のprocessingを自動的にpendingへ戻すことはしない。
状態不明時はrequest_idを保持して停止。再readしてキュー・Review・所有tokenを照合したうえで、別途承認した回復操作を行う。現CLIに自動再claimやtoken引継ぎはない。

## 検証・導入上の注意

tests/complete-card-queue.test.jsは本番169行相当のメモリ内Sheetと書込み検出adapterを使用。
tests/complete-card-collector.test.jsは公式ページもmockし、専用workerから実GAS関数へ接続する。実際のMaster/Review/queueへの接続は一切ない。
既存テスト・ブラウザー回帰も維持する。

GitHub mainのGASは本番のResearch受付や保護ガードをまだ含まない。本作業前からの未commit差分が混在するので、mainのGAS全体を本番へ上書きしない。
将来、専用POSTを導入するには既存本番プロジェクトへの保存と既存Web App deployment更新が必要。今回どちらも行わない。
