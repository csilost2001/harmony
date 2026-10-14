# 設計書ビュー

> **ルート**: `/w/:wsId/document`
> **仕様**: [design-document.md](../../spec/design-document.md) / [test-viewpoints.md](../../spec/test-viewpoints.md)

## 概要

設計データ (JSON) から、日本の現場で使われる設計書の体裁 (表紙・一覧・項目定義表・処理記述表・CRUD 図・業務フロー・帳票・要確認事項・テスト観点) を作って読めるようにする。**読み取り専用**で、ここで直しても原本には戻らない。修正は各画面で行う。

## 操作

| 操作 | 内容 |
|---|---|
| 目次 | 左の目次から章へ移動 |
| 再生成 | 原本の最新から作り直す |
| 別タブで開く | 印刷用の単独ページとして開く |
| HTML で保存 | 目次・スタイル込みの 1 ファイルとして保存 (そのまま配布・印刷できる) |
| Word / Excel | Word (.docx) / Excel (.xlsx、章ごとのシート) として保存。図と画面の見本は含まない。PDF は「別タブで開く」から、ブラウザの印刷 → PDF として保存 |
| 体裁・改訂履歴 | 文書名・文書番号・組織・秘区分・押印欄・ヘッダー / フッター・強調の色・載せる章・改訂履歴を設定する (`document-template.json`)。「更新から下書き」は、前回の改訂のあとに保存された設計から、改訂履歴の下書きを作る |
| 要確認 N 件 | 設計の抜け・矛盾の一覧へ |

紙面は、アプリのテーマ (ライト / ダーク) に関係なく明色で表示する (印刷・PDF 化のため)。

詳細: [integration-ops.md](../../spec/integration-ops.md) §1・§2

## コマンドラインから

| 目的 | コマンド |
|---|---|
| 設計書 HTML を書き出す | `npm run export:doc -- examples/<project-id> --out .tmp/doc.html` |
| 要確認事項を検査する | `npm run check:design -- examples/<project-id> [--strict]` |
| テスト観点表を書き出す | `npm run export:tests -- examples/<project-id> --format csv` |
