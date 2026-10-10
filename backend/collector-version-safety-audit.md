# Collector複数Version安全化

安全化の15関数を既存deploymentのv81へ反映（2026-10-09）。2026-10-10にread-only APIを確認。Master実データへの書込み、T8307実分離、Collector writeback実行はしていない。

保存後に再読したGASソースSHA-256: `2a72d87cebc75bf7ce0935a11a53ddd7cf938e9110152b661b7450d3ab57ab7b`。既存deployment IDは維持。販売状態/PWAの未commit変更は今回の反映に含めず、作業ツリーに保持する。

## 対象解決の規則

`mfImageCollectorFindMasterRowByVersionOrReference_`を通常更新の共通解決器にした。

- 明示VersionKey: 完全一致かつ1行だけ。Primary/T番号/VersionKeyの整合も検査。不在・重複・不整合はエラーとし、Referenceへfallbackしない。
- Referenceだけ: 一致する行を全部数え、1行の場合だけ処理。複数行はAmbiguousエラー。順番・B/C/N系列・名前・商品URL・掲載状態から選ばない。旧データの空PrimaryはT番号やVersionKeyのReference部分で識別できるが、系列を選択条件に使わない。
- 画像uploadはDrive操作前、各Master更新は列追加／validation設定前に解決する。画像upload後のセル更新時も再解決する。手動編集を含む外部同時更新に対するトランザクション保証を追加したものではない。

## 更新経路一覧

| 更新経路・項目 | 対応 |
|---|---|
| uploadImageResults / UpdateSheet: 茶葉画像・サムネイル・水色URL、各状態 | 全3種を共通解決器で保護。曖昧ならDrive操作・列追加・セル変更0。明示C01ならC01のみ |
| updateProductPageUrl: 商品URL・URL状態 | 先頭Reference選択を廃止。明示version_keyを受け付けるが、不一致時fallbackなし |
| updateMasterOfficialInfo: 現在説明・カテゴリ・原文・根拠言語/URL | 先頭行走査を廃止。通常Collectorは列挙した行のVersionKeyを自動ターゲット扱いせずReferenceだけ送信し、GAS側で現在の一意性を再判定 |
| updateMasterNewTeaDefaults: 現在名・説明・カテゴリ・URL・画像状態・URL状態等の空欄補完 | 一意性確認後にのみ補完。N系列の既存VersionLabelにも対応 |
| 通常Review apply: 現在名・商品URL | 明示Review target/DB既存VersionKeyを厳密に解決。それらがなければReference一意性を要求 |
| structured facts / target repair | 自動の名前/URL一致による複数Version絞込みを廃止。明示対象は完全一致・一意・Primary整合。Review dispatchの明示targetも保持 |
| 公式説明翻訳Review | 人間承認済み説明、明示VersionKey、before値確認を維持しPrimary整合を追加 |
| 販売SKU Review apply | B系列だけを候補にする処理を廃止。自動候補は曖昧なら拒否。明示Review targetは完全一致。自動の名前絞込み後にも親Primaryの一意性を検査 |
| 現行ステータス | 通常画像/URL/公式情報経路は書かない。未commitの販売状態機能にある専用sales-status Reviewも別途テスト済みだが、今回の本番反映対象ではない |
| 初回／最終確認日 | 監査した通常Master更新経路に日付setterはない。fixtureで両日付の不変を確認。分離・新規行作成の人間承認フローと混同しない |
| 分類正規化 / taxonomy apply・rollback | 各行自身の値から変換する保守経路。Primary先頭選択はない。taxonomy apply/rollbackは既存の行位置＋VersionKey＋before/after検査を維持。現在ページ情報の自動注入経路ではない |
| Primary Reference backfill | VersionKey単位の既存preflight/競合検証経路。今回の自動対象選択変更とは分離し維持 |

## Node Collector側

全Master行は保持したまま、同じPrimary/参照に複数行あるものをreferenceAmbiguousとして記録。通常収集、--refs、説明backfill、enrichment、過去not_found状態の再送から除外する。Reference単位cacheを両Versionのどちらにも流用しない。書込みhelperでも既知の曖昧性を拒否。現行掲載フラグでC01を選ぶ機能は追加していない。

structured factsの名前/URL推測解決、独立hybrid属性候補作成時の先頭行fallback、汎用Reference検索のfind先頭選択を廃止。opportunistic画像は複数Version拒否を維持し、同一キー重複行も拒否。SKU親候補で曖昧な行・重複行を1件へ潰して選ばない。C系列はReference部分の読取り対象に加えたが、優先順位には使わない。

## テスト

今回のcommit単体: `node --test tests/collector-version-safety.test.js`（54件）。

作業ツリー全体: `node --test tests/collector-version-safety.test.js tests/sales-state.test.js tests/sales-state-preflight.test.js`（96件）。後二者は未commitの販売状態機能のテスト。

全96件成功。安全化用54件は切り分けた本番GASでも全件成功。販売状態に依存する1件を販売状態テストへ移し、検証を削除せずcommit依存を分離した。B01/C01の行順を正逆にしたfixtureで、upload、画像セル更新、商品URL、公式情報、新規行補完、通常Review、structured factsを検証。Primaryだけの呼出しは全経路でセル・header・validation・Drive変更0。明示C01と別Primaryの単一Versionは成功。誤ったPrimary、存在しないキー、重複キーは書込みなし。翻訳Review、SKU候補、Nodeの選択／fetch／write helperも検証。PWAブラウザテスト、Node/GAS構文検査、git diff --check成功。

書込み検証は全てmock/ローカルであり、本番書込みテストではない。v81の `/exec?action=teaData` はHTTP200、ok:true、766件。採用済みbaseline763件からの増加は別記録とし、baselineの置換や追加行へのwriteは行わない。T2006-N01/T2008-N01/T1921-N01の販売状態新3列は全て空欄。T8307はB01のみ。PWAの未commit変更は引き続き未反映。
