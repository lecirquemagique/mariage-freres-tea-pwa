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

## Preview失敗理由の分類（ローカル修正・未反映）

complete_card専用readerは検索・商品ページのHTTP statusを確認し、403/429/503、またはCloudflare等のtitle/bodyをofficial_access_blockedとする。その他のHTTP失敗・通信失敗・不明な検索画面はofficial_lookup_inconclusive。HTTP200で明示された検索結果なしはofficial_search_no_result。空の検索画面だけでは検索結果なしと断定しない。

複数ソースの失敗理由が混在する場合はofficial_lookup_inconclusive。plan.lookup_diagnosticsにはURL・HTTP status・title・理由を残す。Version/REF/名称不一致、canonical衝突、異なる検証済み商品URLが複数残る場合はversion_ambiguousとして配列先頭を採用しない。正しい単一ページが確認できた場合も既存の公式URL・exact REF・名称検証は必須。アクセス阻害や検索結果なしを未掲載・終売に変換しない。

画像3種のimage_review_pipeline_required、水出しのunsupportedは、アクセス失敗時も専用理由を維持する。例外で理由を全項目上書きしない。根拠のない候補は生成せず、Master更新なし。

T2306のfixtureを、検索を省略するresolved-product成功ケース（5候補/9未解決）とFR/EN403＋日本公式200検索結果なしの検索失敗ケース（0候補/14未解決）に分離。後者は10項目official_lookup_inconclusive＋画像3項目＋unsupported1項目。HTTP403本文空、本文Cloudflare、429、503、titleのみchallenge、200検索結果なしも個別検証する。

GAS側のローカル変更は完了APIの理由allowlistに新3分類を加えるだけ。旧理由も保持し、Master/Reviewへの書込み制御・対象検証は変更しない。本番には未保存のため、実write-back前には対応版の安全な統合が必要。今回はpreview/mockのみ。

## CDP探索強化（ローカル実装・本番GAS変更なし）

探索順序はMaster既存URL、既存表示済み公式商品タブ、REF検索、商品名検索、FR/EN/JP各公式検索UI、候補商品URL検証。既存Chrome contextとconnectBrowserを使い、専用mainの早期returnで通常画像5件・通常URL状態更新・legacy queueと分離する。

acquireCardResearchPagesはgetProductPageの所有権契約を利用しつつ、useExistingPages=falseで所有作業タブを確保する。借用タブは候補を全件検証し、REF URLの先頭一致では選択しない。借用タブではgoto/reload/closeを禁止したviewで既存inspectTargetedProductPageの検証を再利用する。所有タブだけnavigate/closeし、finallyでresponse listenerと作業タブを解放する。processProduct全体や画像専用createCdpNetworkCaptureを呼ばないため画像処理・画像body取得は発生しない。

inspectRenderedCardResearchPageは現在URL/canonical/exact REF/正規化名を検証し、既存collectDiscoveryPageFactsからdescriptionを取得する。Product JSON-LDまたは可視商品操作からavailabilityを確認。canonical未確認は未解決、canonical相違は競合。REFが関連商品欄だけに現れる場合は根拠にしない。現在URLが読取り中に変化した場合も候補化しない。

searchCardResearchOfficialUiは所有タブ上の公式FR/EN検索ボタン・q欄、JPのmakeshop-search-keyword/search_keyword欄と公式検索リンクを使用する。GETの公式検索formのみsubmitを許可し、cart/account/newsletter等を送信しない。challengeを自動操作せず、HTTP403等なら失敗記録を残す。各ソースの情報は集約するが、複数商品URLのfail-closed条件は維持する。別REFのURLは候補から除外し、検索語自動補正があっても対象REF/Version/名称を変更しない。

captureCardResearchNavigationはDocumentと検索XHR/fetchのメタデータだけを記録する。lookup_diagnosticsにtransport、stage、source_region、observed_at、submitted_query/effective_query、query_corrected、現在/最終/canonical URL、HTTP statusまたはnull、redirect chainを残す。既存DOMにHTTP200を捏造しない。challenge token・認証値をURLから除去する。direct_httpの公式取得はこのworkerでは実行しないため、その方式の記録は0件。cdp_navigation/cdp_existing_dom/cdp_search_uiは実際に使用した場合だけ記録する。

検証用にconfig.researchSearchUi=falseで既存navigation fixtureを単独確認できる。通常は未指定でUI探索有効。UI待機はresearchUiTimeoutMs（既定3000ms）、検索送信はnoWaitAfterで結果ページ到達待機と分離し、操作後待機はresearchUiSettleMs（既定1500ms）、通常navigationはnavigationTimeoutMsを使用。待機上限超過は未解決とし、検索結果なしとは断定しない。

previewでは従来どおりclaim dryRun=trueの参照だけを行い、record/completeは呼ばない。missing_fieldsの交差条件、GAS側のexact Version/Primary/T検証、Review-only方式、unsupported/画像理由を維持。GAS・deployment・Sheet構造は変更不要。

## complete_card再調査ポリシー（2026-10-22、ローカルのみ）

責務は受付側に限定する。Collectorの探索・claim・Review生成・キュー完了処理は、再調査可能時期や新しい依頼を作るかを判断しない。

受付は既存のScriptLock内でMasterとキューを再読する。明示VersionKeyの一意性、Primary/T番号との整合を従来どおり確認する。同じVersionKeyの未完了依頼（pending/processing/claimed/error/不明状態等）があれば、完了履歴より優先してalready_queuedを返す。Primaryが同じでも異なるVersionKeyの履歴は独立。

完了履歴はrequest_type=complete_card、status=completed、completed_atを基準に選ぶ。requested_atは年限判定に使わない。行順ではなく最新completed_atを使う。完了日時は有効なDateセルまたはタイムゾーン付きISO日時に限定し、ロケール依存文字列・不正日付・未来日付・欠落したrequest_id/依頼種別等は自動再登録を停止する。同じVersionKeyに検証不能な完了履歴が残る場合も安全側に停止する。他の明示的request_typeのcompleted履歴をcomplete_card完了へ転用しない。

1年はAsia/Tokyoの年月日・同時刻で判定する。365日ミリ秒加算ではない。うるう日の翌年は2月28日の同時刻へ補正する。例：2026-10-18 12:00 JST完了は2027-10-18 12:00 JSTから可。境界の1ms前は不可、境界一致から可。2024-02-29完了は2025-02-28同時刻から可。

レスポンス：
- queued：初回の新規pending依頼を追加。
- already_queued：未完了が存在。無書込み。
- recently_completed：1年未満、または履歴検証不能。無書込み。通常はcompletedAt/nextEligibleAt/policyTimezoneを返す。履歴検証不能はreason=completion_history_unverifiable、nextEligibleAt=null。
- requeued_after_expiry：新request_id、新pending行を追加。旧completed行は変更・再利用しない。
- dry_run：追加可能な場合も計画のみ。plan.requeuedで初回/再調査を区別。UUID発行・Sheet書込みなし。

再登録時はその時点の最新Masterから名称、Primary/T番号、missing_fieldsを再計算し、source=PWA、request_type=complete_card、依頼日時はGASサーバー時刻とする。旧missing_fields・PWA時刻を再利用しない。既存キューA:Sで実現し、列追加不要。書込み対象は受付時の新しいキュー行1行（19セル）のみ。Master/Reviewには書かない。

PWAは受付結果を受けて表示を分ける。already_queuedは「この銘柄はすでに調査待ちです」、recently_completedは「この銘柄は最近調査済みです」と表示し、そのページ内でボタンを無効にする。履歴不明は「完了履歴の確認が必要」と表示して停止する。requeued_after_expiryは「再調査依頼を登録しました」。初期ボタンは従来どおり「情報を補完」。事前に全カードのキュー履歴を取得するAPIやクライアント独自の年限判定は追加しない。リロード後はサーバーが再判定する。

検証：tests/research-recheck.test.jsで年境界、うるう日、最新完了、履歴不明、Version独立、20連打、新ID、新Master不足項目、旧行不変、T2306 pending169をメモリ内検証。tests/research-recheck.browser.cjsは全通信をmockし、状態表示/無効化/フィルター併用/連打/表示データ不変を検証する。

本番GASへの保存・deployment・Sheet write・commit/pushは今回行わない。本番v85の受付はまだこの新ポリシーではない。現在のT2306 pending依頼は新旧いずれでもalready_queued対象であり、再調査のために状態を変更しない。

## 香味詳細タグの集合マージ（2026-10-22、ローカルのみ）

structured_factの香味詳細タグだけに適用する。既存タグと公式根拠で確認したタグをcanonical化し、集合の和をReview候補値にする。既存の未知タグ・今回の根拠にないタグを保持する。カラメル→キャラメル、バニラ→ヴァニラ、ノワゼット→ヘーゼルナッツ、蜂蜜→ハニー等を統合し、同義語・重複は1件にする。現在値は元のまま監査・旧値比較に保持する。canonical化した既存集合を減らす処理や削除フラグは追加しない。明示的な削除根拠の有無を自動判定して削除する経路も作らず、削除は別途の人間判断が必要。

Collectorは1商品ページの香味詳細タグ候補を1件に集約し、個々の公式根拠とconfirmed_valuesを保持する。表示順は確認タグの順、次に既存だけのタグの順。既存値があることは新しい公式確認の根拠にしない。語彙allowlistの同義語比較を正規化し、noisette/hazelnutとmiel/honeyの明示表現を詳細タグへ対応付ける。追加した2つの明示語ルールは、Masterの語彙に未出現でもヘーゼルナッツ／ハニーの候補を作成できる。他の任意タグを無条件許可せず、他列の候補も生成しない。否定・アレルゲン注意書きだけの新規根拠は採用しない。

通常Review builder、保存済み調査planからのReview builder、GASのReview serializer、GAS apply評価にも同じ保持ルールを適用する。古い部分候補やtag_spelling_normalizationでも既存詳細タグを削除しない。apply時は最新Masterを使ってマージし、候補生成時に存在したタグが現在消えていればfail closed。候補作成後に増えたタグは保持する。semanticな再適用は無変更だが、canonical表記の修正だけが必要なら正規化候補として扱う。香味大分類・産地・真偽値・他列の既存処理は維持。

PHÉNIX fixture：ヴァニラ、カラメル、ハニー＋vanille Bourbon, caramel, noisette, miel → ヴァニラ、キャラメル、ヘーゼルナッツ、ハニー。tests/aroma-detail-merge.test.jsで候補生成・Review表示・GAS評価・再適用・古い値の拒否を検証する。今回は本番への保存、既存Review修復、Master反映は実施しない。
