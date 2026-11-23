# 公式掲載分類の限定release計画

この文書とJSONは準備物であり、本番処理は実行しない。作業ブランチ全体をmergeしない。公開元mainに、分類だけのrelease commitをfast-forwardで適用する。remote mainが準備基点から進んだ場合は停止・再基点化・再検証し、force pushは使わない。

## 公開対象と維持対象

| 対象 | 予定差分 |
|---|---|
| PWA `sales-state.js` | 4標準分類＋互換用「未掲載」の読取と表示。販売状態とは独立。旧未掲載を別分類へ変換しない |
| PWA `service-worker.js` | CACHEだけを `mf-tea-pwa-v1-6-official-listing` に更新。CORE資産一覧やfetch戦略は公開mainのまま |
| GAS既存 `mf-image-collector.gs` | teaDataの独立根拠列fallbackと入力規則の分岐だけ。v97現行ソースを基点に準備 |
| GAS新規 `official-listing.gs` | 純粋な分類・根拠検証・スキーマ計画。Sheet書込routingや定期実行なし |
| Master | CM列を1列末尾追加、CM1ヘッダー1セル、CJ2:CJ808の入力規則だけ |
| リポジトリだけ | 仕様・この手順・宣言的migration JSON・オフライン準備スクリプト・fixture・分類テスト |

PWAのindex.html、app-config.js、research-request.js、画像・アイコン・manifestは無変更。GASのimage-intent.gs、image-identity.gs、他の既存4ソースとmanifest、Script Properties、deployment ID／URL／実行者／公開範囲は維持する。GASは既存deploymentを新versionへ更新する方式であり、新しいdeploymentを作らない。

backend/mf-image-collector.gsのリポジトリ版は本番v97全体の代替ではない。本番固有correction routingを保持するため、リポジトリ版全体をエディターへコピーしない。

## Masterの具体的な変更案

正本ID・sheetId・リクエストの正確な形は `official-listing-migration.json`。準備時点の正本は808grid行／90列、VersionKey793件、CJは掲載中480／未確認293／未掲載3／空欄17。T2215-B01は行9、T935-B01は行454で未確認。CJの対象既存行は入力規則なし。

1. 承認後、metadataと対象CellDataを再読し、ヘッダー・数式・値・規則・行列数に差があれば再計画する。Master全既存値／数式、変更履歴・分類変更履歴、両キューをsnapshotする。
2. `公式掲載根拠／出典` が存在しない場合だけ末尾にCM列を追加し、CM1へヘッダーを書く。CM2:CM808は空の新規セルのまま。既存CL「販売状態根拠／出典」をコピー／移動／消去しない。
3. CJ2:CJ808に `未確認／掲載中／公式掲載なし／公式掲載終了／未掲載` のONE_OF_LIST、strict=true、showCustomUi=trueを設定。空欄は維持し、既存値・数式を更新しない。別の旧値が見つかれば許容値に加えるか停止して精査する。
4. 同一の根拠列が既にある場合はappendせず、その位置・内容を確認して再計画する。途中失敗後も証跡と再読から再開し、無条件に再実行しない。

既存A1:CL808の値・数式は全て維持。販売状態・茶種・香味・画像・VersionKey・Primary Reference・日付・T2215/T935・旧未掲載は変更しない。変更履歴／分類変更履歴の行は追記も更新もしない。今回の商品データ変更は0件のため、schema操作は実行結果とGoogleのrevisionに記録し、商品変更ログと混同しない。

## GAS v97からの候補作成

`node scripts/prepare-official-listing-gas.cjs <fresh-v97-main-file> <new-local-output-directory>`

入力SHAが検証済みv97 mainと異なる場合は停止する。出力はローカルの限定編集済みmain、新module、SHA manifestだけで、本番接続はない。v97入力を再取得し、他7ファイル（manifestを含む）も前回snapshotに一致することを確認する。

受付のimage-intent分離、公式URL不足時のdeferred、T719既存画像のnot_needed、operation IDの検証、dedupe、claim・hash・receiptはそのまま。新moduleは既存受付から呼ばれず、画像workerのJP URL制限も変更しない。新しい否定分類のSheet書込APIは追加しない。今回の標準4分類は候補と表示に限定し、実値変更には別途商品ごとの根拠と承認が必要。

## 承認後の反映順序

1. remote mainの基点と公開PWAの5資産、GAS v97／8ソース、Master・規則をfresh read。準備時から差があれば停止する。
2. 上記のschema metadataだけを整備し、既存90列の全値／数式と履歴／キューが前後一致することを確認する。
3. v97のmainへ2箇所だけを適用し、新moduleを追加。保存後に9ソースとmanifestを再読し、予定した2ソース以外が不変であることを確認する。既存deploymentを新versionへ更新し、実公開ソースでも回帰を行う。Propertyやmigration完了フラグを変更しない。
4. release worktreeのcommitだけを公開mainへpush（今回実行しない）。Pagesの成功と公開commitを確認し、公開2資産のSHA一致、他資産のSHA不変、キャッシュ名・service worker更新を確認する。
5. 実Masterへ新分類をテスト入力しない。ブラウザー内fixtureで旧3分類／新4分類／販売状態との組合せを確認する。受付と画像は既存pending／completedを増減させないfixtureと実公開ソースのmockで検証する。実ボタン操作が必要なら対象・期待write数を別途限定する。workerや画像保存を検証目的で自動実行しない。
6. Masterと履歴・キュー・Propertiesを前後比較し、商品値の変更0件を確認する。個別銘柄の新分類変更はこのreleaseとは別工程。

## rollback

- **停止だけ**：まだ本番へ書いていなければremote／GAS／Masterを触らない。
- **PWA**：公開前のsales-state.jsを戻す限定revert commitをmainに適用し、service workerは新しいrollback専用名 `mf-tea-pwa-v1-7-official-listing-rollback` にする。indexや受付clientを戻さない。新分類を後日実データに採用済みなら旧readerへ戻す前に互換性を再確認し、値を逆変換しない。
- **GAS**：同じdeploymentをversion97へ戻す。エディターの原状復帰が必要なら、後発変更がないことを確認したうえでmainをsnapshotへ戻し、新moduleを取り除く。他ソース／manifest／Propertiesを変更しない。
- **Master**：CJ入力規則は実行前のCellDataから復元する。今回の基点では規則なし。CM列は位置・ヘッダーが一致し、全データセルが空欄で、参照や同時編集がない場合だけ削除できる。根拠が記入済みなら列とデータを保持し、コードだけrollbackする。分類値・販売状態・旧根拠を戻す一括更新は行わない。
- **順序**：PWA互換確保→GASをv97→規則復元→必要かつ安全な場合だけCM削除。各段階で再読し、受付client・画像契約・データが不変であることを確認する。

今回の停止位置は「ローカルclassification commitとrelease commit、隔離テスト・移行案・rollback案が完成した時点」。push、GAS保存／deploy、Master変更、PWA切り替えは全て未実施とする。
