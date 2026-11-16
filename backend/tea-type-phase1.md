# 茶種管理 Phase 1

## 管理語彙

既存GAS structured_fact validatorの12語を維持する。

黒茶、青茶、緑茶、白茶、黄茶、後発酵茶、プーアル茶、抹茶、ルイボス、ティザン、マテ、インフュージョン。

`熟成茶`は追加しない。プーアル茶・後発酵茶・熟成茶の関係は人間判断待ち。
茶種マスター新設・語彙追加UI・未知語専用Review種別の導入はPhase 1の対象外。

## 読取りとPWA

`index.html`の`parseTeaTypes()`は`{tags, unknown}`を返す。
正規の保存形式は読点区切り。既存の`,` `;` `／` `|` 改行も読取互換として受け付け、重複を除く。
中黒`・`は区切らない。共通`sp()`・香味parserは変更しない。
元のMasterレコードは変更しない。未知値を含むフィールドは茶種フィルターでは一致させないが、全件表示・通常検索から行を除外しない。

フィルター選択肢は固定の12語だけ。Masterのdistinct値を追加しない。
正式複数値`黒茶、ルイボス`は黒茶・ルイボスの各フィルターに一致する。
未知値`黒茶・ルイボス`を変換する例外表は存在しない。

aliasはNFKC、前後空白除去、小文字化、連続空白正規化後の完全一致のみ。
`black tea`/`紅茶`→黒茶、`oolong`/`烏龍茶`/`ウーロン茶`→青茶、`rooibos`→ルイボス。
既存のFR/EN茶種名、ティザン、マテ等の明示aliasも完全一致で維持。
`ティザン風未知茶`や`黒茶・マテ`を部分一致で既存語彙へ縮退させない。
香味語彙と混同しない。各実装の語彙・aliasの一致は横断テストで確認する。

## 書込み制限

GASの`mfImageCollectorAssertTeaTypes_()`は未知tokenが1つでもあれば例外。
structured_fact候補の反映、新規銘柄builder、Master新規行追加、apply planの茶種セル、空欄補完、分類移行・rollback、共通セル更新で適用する。
管理用`master-audit.gs`の茶種ガードはローカル差分として分離済みだが、本番への反映済み実装ではない。現在の本番ではこの管理writerは未接続・無効である（下記の適用条件参照）。既存本体全体を今回の変更として扱わない。
structured_factの空候補は従来どおり拒否。新規行で茶種未取得の空欄は許容する。
新規銘柄で明示された未知茶種は、既知カテゴリへのfallbackで隠蔽しない。
カテゴリからの茶種導出も完全一致・明示複数値のみとし、部分一致は使用しない。

管理用normalizeは未知フィールドをそのまま残し、その茶種セルを更新しない。分類移行の未知のafter値は事前検証で拒否する。
rollbackも未知語の再導入は拒否し、既存のconflict機構へ載せる。
既存の未知値があるだけで他の列の正常な通常applyを拒否する仕組みではない。
既存のMaster全体を自動修正・正規化する処理は実行しない。

Collectorの茶種structured_fact候補は既知語だけに限定する。未知値を診断用normalizerから黙って消さない。
Masterへの最終書込み許可は常にGAS側で再検証する。
complete_card/recovery/correctionの永続化・承認・v92 apply identity/hash/read-back/receiptは既存契約を維持する。

## 2件の表現訂正

`scripts/tea-type-review-plan.cjs`はオフライン専用。明示的な操作JSONとMaster snapshotを受け、既存の
`mfImageCollectorReviewCandidateToRow_()`で通常structured_fact Reviewの候補を組み立てる。
新しいReview種別・手動セル書込み・自動承認・自動applyは行わない。

対象操作:

| VersionKey | REF | current | suggested |
|---|---|---|---|
| T733-B01 | T733 | 黒茶・ルイボス | 黒茶、ルイボス |
| T708-B01 | T708 | 黒茶・マテ | 黒茶、マテ |

操作JSONに`version_key`, `reference`, `current_value`, `suggested_value`, `reason`を明示する。
VersionKey一意・Primary/T完全一致・before一致・候補語彙を検証する。
根拠はMasterの現値と人間が指定した表現訂正理由。公式商品ページの根拠を捏造しない。
source_typeは`taxonomy_representation_normalization`、statusは要確認、人間判定は空欄。
検出IDは既存`mfImageCollectorReviewDedupeKey_()`を使用する（structured_fact / REF / VersionKey / 対象列 / 候補値）。通常受付APIと同じID・重複判定であり、専用ID体系は追加しない。
before/after・理由・rule versionのSHA-1は`structured_fact.normalization.fingerprint`に別途保持する。同じ計画の再生成は同じIDとfingerprint。
生成だけでは一切保存しない。承認後の反映は通常v92経路で行い、茶種は既存値一致を必須とする全候補値置換（香味unionは適用しない）。

## ソース管理上の境界

管理API本体と既存テストはPhase 1以前から未追跡のため、その本体を今回のcommitへ取り込まない。茶種ガード関連patchは作業前snapshotから分離して保管し、7ファイルの独立commitからは除外する。有効化する際には正本の追跡・茶種ガード・対応テストを別工程で正式化する。
mainへのpushはPages自動公開を起こすため、公開変更禁止の今回工程は専用ブランチへpushする。mainへの統合と公開は別途承認後に行う。

## 管理writerの本番適用条件（2026-11-16確認）

`master-audit.gs`は本番と同じApps Scriptプロジェクトのv92ソースに存在する。別プロジェクト・ローカル専用ファイルではない。ただし存在と書込み可能な運用経路は区別する。

- 通常`mfImageCollectorDoPost` / `mfImageCollectorDoGet`から`mfMasterAuditApply_`へ接続するrouteはない。通常apply・Collectorもこのwriterへ接続されていない。
- 公開診断`mfMasterAuditProductionDryRun()`だけが同writerを呼ぶが、常に`dryRun:true`。今回この本番診断関数は実行していない。
- 実writeには`dryRun:false`と`MF_MASTER_AUDIT_WRITE_ENABLED='true'`の両方が必要。本番プロパティは未設定、pendingもなし。管理writerを呼ぶインストール型トリガーもない（現在の所有者のトリガー一覧は0件）。
- このrepoにclasp設定は見つからず、ローカル未追跡ファイルが自動同期される根拠はない。本番保存済みソースを正本として照合する。

この無効・未接続状態を維持する限り、管理API patchは今回の有効なMaster書込み入口の必須変更から外す。これは茶種ガードなしで同writerを有効化してよいという承認ではない。プロパティ設定・新route/triggerの接続・直接管理呼出しの有効化時には、先に正本への茶種ガードとテストの正式化を必須とする。

`tests/tea-type-management-boundary.test.js`で通常GET/POSTの拒否と、実本番関数の無効ゲート/既定previewを確認する。テスト専用fixtureはv92のwriter関数だけの抜粋で、未追跡管理API本体を採用・公開するものではない。`MF_MASTER_AUDIT_TEST_SOURCE`でfresh本番ソース自体にも同じテストを実行できる。

## 並行書込みと旧deployment

2026-11-15 20:00〜20:07のキュー230〜241行は、同プロジェクトの旧Web App v69の`mfImageCollectorCreateTargetDiscoveryRequest`実行時刻に対応する。URL-only legacy依頼で、complete_cardではない。人の操作とブラウザー自動操作のどちらが送信したかはログだけでは未特定。

v69はv92とは別deployment IDであり、v92だけを更新しても旧v69は更新されない。観測されたenqueue経路はMaster/Reviewを書かないが、旧v69には認証付きMaster更新POST routeも残っている。旧URL利用を把握せず全入口が新validatorに保護されたとは扱わない。

Windowsの`MF New Tea Discovery`は毎日09:15、旧checkoutの`collector/run-discovery-once.ps1`から`--discover-new-references --write-back`で稼働し、Reviewへ並行保存し得る。本番反映時はこのタスクの一時無効化と稼働済み処理の終了確認、手動Collector/Review applyの停止、旧bookmark/UI送信の抑止が必要。旧v69の利用停止・archiveまたは更新方針も承認後に確定する。今回これらの処理・設定は一切停止/変更しない。

## 本番反映の次工程

1. 今回差分だけを監査・隔離検証し、人間確認後にcommit/push。
2. 本番fresh source基準で茶種関連GAS差分だけを限定統合。v92の既存安全ガードを保持。
3. 既存deploymentの更新とPWA公開を別途承認後に実施。
4. Master/Reviewをfresh readして2件のbefore・競合を再確認し、正規Review受付APIで候補を登録。既存IDなら再利用。
5. Review read-back確認→人間承認→対象2件だけ通常apply→Master/Review read-back。
6. T2017-B01の熟成茶は変更しない。語彙の追加は別の人間レビューとする。

Phase 1は未知語候補を自動登録する新機構を含まない。未知茶種は候補抑止または明示エラーで停止し、既存の人間レビューで判断する。
