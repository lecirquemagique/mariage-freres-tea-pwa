# Reviewの人間判定による独立Primary確定（ローカル案）

2026-10-18。新しいoverride登録制度は作らない。既存の「人間判定」列を最終決定として使用する。

従来の拒否箇所は `mfImageCollectorReviewDecisionOptions_()` のunresolved除外と、追加時のReferenceInfo／VersionKey検証。自動resolver、一般Primary validator、Hybrid prefix一覧、販売SKU ownership、TFBF、Review status定数は変更しない。

`unregistered_reference` かつ `unresolved` のReviewに限り、exact REF、公式名、公式商品URL、既存JSONのprimary_reference・同一言語のnames_by_language/urls_by_language、REF・商品名・URL入りの根拠が一致すれば「新規銘柄として追加」を選択可能にする。URLはHTTPSのwww.mariagefreres.comのFR/EN商品ページで、パスにexact REFが必要。DB既存対象、解決済み親、未解決でも明示親REF/親名の証拠がある候補、sales_sku／existing_primary、TFBFは例外対象外。

実際の追加には既存の人間判定列で「新規銘柄として追加」が必要。自動resolverのmodeはunresolvedのまま。Review限定の検証コンテキストでexact REF-B01を許可し、Primary／VersionKeyの重複検査は維持する。REF末尾やprefixから親を推定しない。

586–591の修復案は既存candidate builderとGAS serializerで公式根拠を補完する。人間判定・承認・ID・日時・コメント・対象VersionKeyを保持。JSONをindependent_primaryへ昇格させず、独立扱いは実行時に人間判定から確定する。Hybridは既存independent_hybrid_primary、S付き非Hybridは既存primaryの表現を使用。自分自身をsales_referencesへ登録しない。

公式情報は前回確認した公式検索本文の保存証跡を使用。直接取得HTTP403の制約も保持する。今回は新しいライブ確認・書込みなし。将来修復／反映前にはfresh readと再preflightが必要。

`scripts/review-human-decision-plan.cjs` は586–591だけの純粋planner。`scripts/review-human-decision-dry-run.cjs` は保存snapshotへ仮適用し、6件・既存11件・19行全体を試験する。生成物はlogs配下、commit対象外。

結果：6件すべてunresolvedのままpreflight通過。19行全体でapply17・skip_finalized2・error0。592/600と対象外行、Masterはsnapshot上不変。実Sheet・Master・Apps Script・deployment・commit/pushは未変更。

## 最終コードレビュー

独立Primaryとしての実行には「人間判定=新規銘柄として追加」が必須。空欄・販売SKU判定は拒否。保留は従来のhold処理のみでMaster追加しない。Master上のPrimary/VersionKey重複は最新contextで検出し拒否する。一般validatorは引き続き特殊REFを拒否し、このReviewコンテキスト以外の呼出しには影響しない。

根拠検証はReviewへ記録した公式証跡の整合検査であり、apply時にWebページを取得して内容を再検証する機能ではない。plannerは確認済みpageのexact REF・名称・URLを照合し、既存証跡にある/en/tea/パスの別名だけを許容する。根拠のない別商品URLを転記しない。直接HTTP403の制約は隠さない。

| 行 | Primary Reference | VersionKey |
| --- | --- | --- |
| 586 | TB8884 | TB8884-B01 |
| 587 | T4233S | T4233S-B01 |
| 588 | T4236S | T4236S-B01 |
| 589 | T4272S | T4272S-B01 |
| 590 | TE9004V | TE9004V-B01 |
| 591 | TE9003N | TE9003N-B01 |

最終ローカル検証：全165テスト＋ブラウザー4本成功。追加6テストでURL/REF不一致、URL/名称証跡不一致、言語を跨ぐ誤一致、明示親証拠、判断空欄/保留/販売SKU、planner対象外、TFBF独立経路を検証。既存11件・status修正・numeric suffix安全性のテストも維持。Git commitのみ承認、push/本番保存/deployment/Sheets/Review修復/Master反映は未実施。

commit対象だけをindexから隔離コピーして90テスト成功。無関係な販売状態・調査キュー・B/C版対応はcommitから除外し作業ツリーへ保持。commit予定ソースでも保存snapshotの17反映候補・592/600の2スキップ・エラー0を確認した。一般validator、resolver mode、SKU parser、TFBF関数、Version allocator、Hybrid prefixes、status定数はHEADと同一であることをコード比較した。
