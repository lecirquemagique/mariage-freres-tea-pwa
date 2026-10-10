# PWA販売状態表示

表示範囲は買い物（初期値）／すべて／過去・終売。検索・茶種・香味・産地との併用が可能。旧「終売を除く」の状態は保存せず、resetで買い物へ戻る。

APIの `salesStateMigration: {version:1, complete:true}` がある場合のみ厳格モード。未設定・false・不正値ではfallbackを維持する。本リリースはフラグを変更しない。

- 買い物：掲載中かつ終売確定でない。移行中は空欄／未確認も含むが、旧ステータスの終売／販売終了は従来どおり除く。明示された未掲載・終売確定は除く。
- すべて：販売状態で除外しない。各VersionKeyの行を保持し、Primary Referenceでdedupeしない。
- 過去・終売：未掲載または終売確定。

状態バッジを小さく表示。旧版は同一Primaryに掲載中の別Versionがあり、自身が未掲載の場合のみ示す。Version番号の大小では推測しない。

service workerのキャッシュを更新しsales-state.jsを含める。API/GASの変更は不要。T8307は今回分離しない。

検証コマンド：`node --test tests/sales-state.test.js tests/collector-version-safety.test.js`、`node tests/sales-state.browser.cjs`。browser testはChromeとPlaywrightを使い、通信は全てmockする。未公開GAS用テストは別ファイルに保持し本リリースに含めない。

2026-10-10の本番API766件ではfallback買い物760件（従来フィルタと一致）、すべて766件、過去・終売0件。件数は実データの更新により変わる。
