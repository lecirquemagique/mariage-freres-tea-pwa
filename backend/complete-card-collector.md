# complete_card Collector接続（ローカル実装・未導入）

## Review永続化確認とHOJICHA復旧計画（2026-11-03、今回分はローカルのみ）

以下を今回の保存・完了プロトコルとする。後段の過去の実装記録より優先する。HOJICHAで実際に保存が欠落した直接原因は未確定であり、この変更を原因確定の根拠にはしない。

### 保存と完了

- Collectorは各recordとcompleteに `expected_candidates`（生成した全候補）を送る。最初のrecordでGASは全候補を既存builder/validatorに通し、検出ID・対象列・内容fingerprintのmanifestをclaim所有情報へ保存してからappendする。証拠全文をScript Propertiesへ入れない。明示manifestは後続で変更・縮小・拡大できない。
- 低水準record APIは単体候補も扱えるが、その候補をclaim manifestへ先に記録する。completeには常に明示manifestが必要で、既知候補を省略できない。旧Collectorがmanifestなしでcompleteしようとした場合は停止するため、将来の反映ではGAS/Collectorの両方を揃える。本作業では反映しない。
- append後にflushして実Reviewを再読する。検出IDの一意性と、request_id、VersionKey、Primary/T、検出種別、対象列、旧値・候補値、公式名、根拠本文・言語・URL、source_type/confidence、reference_resolutionとcard_research来歴を比較する。DataValidation設定後にも再確認する。
- 成功時のみ `recorded` / `already_recorded` と `verified:true, review_row, sheet_row, detection_id, fingerprint`、対象識別情報・列・候補値・根拠URLを返す。既存同IDでも内容不一致や来歴欠落なら成功扱いしない。人間が編集する承認状態・判定・承認済み日本語説明・コメントはfingerprintから除外する。
- FR/EN等のlanguage_evidenceとofficial_urls_by_languageもcard_research内へ保持し、fingerprintへ含める。通常のReference resolverや汎用Review serializerの規則は変更しない。
- Collectorはreceiptの対象・列・値・URL・行番号・ID・検証フラグを確認し、期待数のreceiptが揃うまでcompleteしない。返却値に `persistence.expected/persisted/receipts` を残す。
- completeはmanifestをclaimと照合し、実Reviewを再読する。期待0/実0の正当な探索完了は許可する。期待N/実Nで、内容・来歴一致かつ余分なrequest紐付きReviewがない場合だけcompletedにする。proposedにはverified/fingerprintを含め、完了応答にもexpected/persisted/verifiedを返す。

### 失敗の表現と再試行

新しいqueue statusは追加しない。失敗時は既存 `processing` とclaim所有権を保持し、completedにしない。Masterは更新しない。APIは `ok:false,status:persistence_error` と次のcodeを返す。

- `review_persistence_failed`: 保存確認対象の行がない。completeで0/Nの場合もこれ。
- `review_persistence_partial`: completeで1〜N-1/Nだけ保存確認できた。
- `review_verification_failed`: 対象・内容・来歴・manifest・receiptに不整合がある。

確認できた場合のみexpected/persistedを返す。不明な保存結果を0件と断定しない。Collectorの失敗情報ではacknowledged（過去に検証済みreceiptを受け取った数）とpersisted（今回のサーバー確認値。不明ならnull）を分ける。生成した候補の保存欠落を `no_official_evidence` へ変換しない。

同じ所有token・同じrequest/Version/列/候補内容を再送すると、検出ID・fingerprintを確認して同じReviewを返す。ネットワーク結果不明後のAPI再送はこれを使う。CLIでprocessingを無断reclaimする機能や、completed履歴を再利用する機能は追加しない。PWAはprocessingを既存のalready_queuedとして扱うため、再調査の1年ルールやstatus体系の変更は不要。

### queue211復旧dry-run

`scripts/complete-card-recovery-dry-run.cjs <snapshot.json>` はローカルの読み取り専用planner。通信・token・Sheet書込み・status遷移を持たない。対象をrequest `76c49d5c-9fd2-4385-9ab4-34a9dc6116cd` / row211 / T425-B01 / T425に限定する。

fresh readしたMaster/Review/queueと保存済みbaselineを入力し、Version一意性、Primary/T、元missing_fields、completed/review_only/proposed=[]履歴、主要根拠列の不変性、既存同候補・request紐付きReviewの不存在を確認する。証拠は2026-11-03の検証済みFR/EN planをhash付きで再構成したものと明記し、新たな公式アクセス成功とは扱わない。既存builderで「現在の公式説明=翻訳レビュー候補」「香味詳細タグ=キャラメル」「香味大分類=甘香・菓子」の3候補を作る。翻訳の承認済み日本語説明は空欄のまま。対象情報が変われば停止する。Master/Review/queue書込みは常に0。

### 将来の実復旧方式の比較（実装・実行は未承認）

1. 同じrequestの別recovery ledgerを作って復旧する案：元行の保存は可能だが、completedの通常ガードを別経路で扱う必要があり、通常のclaim/completionとの状態管理が複雑になる。
2. **別のrecovery request行を新UUIDで作り、元row211を全セル保持する案を推奨。** 新行のmessageへrecovery_of、元の結果・時刻・manifest hash、承認者、復旧理由を記録し、同じrecovery operation IDを再登録しない。既存pending/processing/completedを使用でき、列追加は不要。対象をfresh readし、不足Reviewだけをbuilder＋read-back検証APIで作成し、全件照合後に新行へ復旧結果を記録する。

第2案でも現行の通常APIをそのまま使うことはできない。PWAの1年制限を無断で迂回せず、将来承認された管理者専用の作成・所有権検証が必要。sourceはPWAを偽装せずHuman等、request_typeは明示的なrecovery用途として区別する案とし、許可値・限定APIは実復旧前に別途レビューする。現在の通常workerの `source=PWA/request_type=complete_card` ガードは維持する。dry-run内の元request由来の検出IDは照合用で、新requestを採用するなら新IDで再生成する。通常の再調査受付・既存履歴を変更しない。

今回は復旧の作成API、状態変更API、実Review生成経路を追加しない。queue211、Master、Review、本番GAS/deployment、Git commit/pushは変更しない。

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

### 2026-10-29：所有商品タブの有限待機・商品名抽出（ローカルのみ）

所有タブの商品ページnavigationだけは、初回403またはCloudflare challenge表示時に自然な表示完了を有限時間観察する。`researchProductReadyTimeoutMs`は既定12000ms、上限30000ms。商品領域の出現後、既存DOM検証helperでREF・名称・canonicalを再検証できた場合だけ続行する。初回statusだけをHTTP200へ書き換えない。challenge操作、CAPTCHA操作、reload、再navigation、Cookie操作、外部本文注入は行わない。検索ページ/検索UIにはこの待機を適用せず、借用タブの非操作契約も維持する。

lookup_diagnosticsにはinitial_http_status、cf_mitigated、waited_ms、final_http_status、final_dom_validationを追加。後続Document応答を観測できなければ、正常DOMが出ても最終HTTP200を捏造しない。初回403のnetwork記録は保持。期限内に検証できなければblocked/未解決のまま。商品名は空要素を除き、h1.page-titleの明示name/base、h1.page-title、商品情報領域のname、page-title-wrapperの商品見出し、商品領域h1、generic h1の順に抽出する。document titleはそれらが空の場合だけ既存の最終fallbackとして使う。FR専用の例外は作らない。

上記2不具合だけの修正段階では、異なる検証済みURLを複数候補として停止していた。続く言語別ページ集約の条件は次節による。ローカル修正のみで、本番GAS/deploymentや実queue/Review/Masterは変更しない。

### 2026-10-29：証拠付き言語別商品ページの集約（ローカルのみ）

明示VersionKeyの対象と整合するexact Primary/REF・商品名だけを対象にする。各ページは個別検証済みで、ページ上のREFが一致し、商品名がcanonical比較で一致、公式ドメイン・自己canonicalが正常であること。追加のREF、別VersionKey、Product JSON-LDのSKU/名称矛盾、茶種カテゴリ矛盾、対象外URLが混在すれば全体をversion_ambiguousとして停止する。

URL関係も検証する。FR/EN/ITの公式言語パスとREFを含む商品URLで、同じ販売形態（thes-au-poids/tea-by-the-weight/te-al-peso等）へ対応できること。同じ言語に異なる商品URLが複数あれば統合しない。JPのopaque item IDはREFや名称から推定せず、各公式ページ間の相互hreflangリンクが確認できる場合だけ言語別ページと認める。未対応URL形式も安全側に停止する。単なるURL相違・名称類似による集約はしない。

plan.product_groupに1商品への集約結果とofficial_urls_by_language、plan.language_evidenceに各言語のname/description/canonical/availability/source_url/acquisition_method/evidence_languageを保持する。候補にも言語別証拠を付ける。現GASの専用受付は任意の追加メタデータを保存しないため、同じ証拠を既存evidence_textにもJSONとして格納し、Reviewの根拠原文へ引き継ぐ。GAS変更・列追加は不要。scalar URL欄の候補値は既存Master URL一致を優先し、それ以外は言語/URL順で決定するが、他言語URLは別マップ・証拠欄に保持し失わない。これは対象Version選択とは独立。

同じ列の候補は全言語分を集めて比較する。値が一致した場合のみ通常候補とし、香味詳細タグは既存canonical集合mergeを利用する。その他の値が衝突した列は自動採用せずreview_conflictsへ全値と根拠を残し、その列をversion_ambiguousとして保留する。説明文は意味的な同一性を機械で断定せず、原文を言語別に保持した翻訳Review候補とし、人間承認を必須とする。FR/ENのavailabilityが食い違う場合も販売状態を先頭値で決めない。

tests/complete-card-language-variants.test.jsで言語別集約・3言語相互リンク・全矛盾ケース・証拠保持・競合保留を確認し、既存GAS record APIのメモリ内テストで両言語provenanceがReview根拠原文へ残りMaster不変であることを検証する。実queue登録、claim、write-back、実Review生成は行わない。

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

## FR香味表現と複数大分類（2026-11-03、ローカル候補生成のみ）

既存詳細語彙にチョコレート・ヴァニラ・木質が存在する場合、chocolat/chocolaté/chocolatée、vanille/vanillé/vanillée、boisé/boiséeを明示的な香味表現として抽出する。Unicode文字境界でchocolaterie、vanilline、framboisée等への部分一致を防ぐ。caroube自体からカカオやチョコレートを推定しない。muscadeはスパイス、praline/pralinesは甘香・菓子の分類根拠にだけ使い、ナツメグ・プラリネ・キャロブ等の未承認詳細タグは作らない。

addStructuredSuggestionは、既存14分類への正規化結果が複数でも保持する。空値・未知分類を含む提案は採用しない。1ページの香味大分類はcanonical順の集合として1列候補へ集約し、各分類の根拠を保持する。検証済みの同一商品に属する言語別ページ間も、明示的に確認した正の分類を集合としてまとめる。販売状態・名称等のscalar衝突、REF/Version/canonicalの安全条件は従来どおり停止する。

香味詳細タグは既存のcanonical unionを維持し、確認済みルールの順、次に保持だけの既存タグの順に並べる。HOJICHAの空欄からの候補はチョコレート、ヴァニラ、キャラメル、木質。大分類はスパイス、甘香・菓子、カカオ、キャラメル、ウッディ。既存タグの削除・他列への一律merge・自動Master反映は追加しない。公式説明翻訳の処理も変更しない。

tests/structured-aroma-extraction.test.jsが保存済みFR/EN本文で候補再生成、FR形態・境界・未承認語彙・集合保持・PHÉNIX・complete_card書込み0・同一性のfail-closedを確認する。既存Review616〜618、Master、queue、本番GAS/deploymentは変更しない。
