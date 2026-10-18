# complete_card PWA受付UI

カードの「情報を補完」からREF・銘柄名入り確認ダイアログを開き、確認後だけGAS_API_URLへPOSTする。action=requestResearch / requestType=complete_cardは既存本番APIと一致。ユーザー合意済みのtext/plain;charset=utf-8＋JSON本文を使用する。

payloadは元Master行のVersionKey、Primary Reference、Tリファレンス番号、公式名（なければ黒い本名）とrequestedAt。REFを推測せず、VersionKey空欄・重複・確認後の識別値変化を拒否する。正式な依頼時刻とmissing_fieldsはサーバーが確定し、PWAはMasterを変更しない。

送信コードはindex.html内に同梱。app-config.jsは既存GAS_API_URLをそのまま使用し変更不要。service-worker.jsはCACHEキーのみ変更し、CORE/install/activate/fetchは維持する。未commitの検索・香味・カード再設計やGAS/harnessへの依存なし。

確認前/キャンセル時はPOST0。送信中と成功後の再送を抑止する。queuedは「調査依頼を登録しました」、already_queuedは「この銘柄はすでに調査待ちです」。disabled/conflict/reference_mismatch/invalid_version/error/通信失敗は日本語表示し、未加工の応答文字列を表示しない。名称等はtextContent/escapeで安全に表示する。

恒久テストはpayload/transport/受付結果/Version安全性、連打、XSS、stale行、確認・キャンセル、モバイル/desktopを対象とする。ブラウザーテストの全通信と受付応答はmockで、実GAS/Sheetsへ書き込まない。既存販売状態テストのDOM stubはresearchボタンのquerySelectorAllに対応する1行だけ追加。
