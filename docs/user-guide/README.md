# ユーザーガイド

`CLAUDE.md` / `docs/spec/` は AI / 開発者向けのリファレンスです。本ディレクトリは **このツールを使う人 (プロダクトマネージャー / 業務設計者 / AI エージェントを運用する開発リーダー)** 向けの手引きです。

## 目的別ガイド

- [処理フロー編集ワークフロー](process-flow-workflow.md) — 上流 (概要) → 下流 (実装) までの詳細化をリモート AI と往復しながら進める方法
- [AI マーカーと `/designer-work`](marker-workflow.md) — 画面に指示を書いて Claude Code に処理させる使い方
- [画面項目 ID の AI 自動命名 `/rename-screen-ids`](rename-screen-ids-workflow.md) — 自動採番 ID を業務名に一括リネームする
- [マルチエディタ / Puck デザイナ](multi-editor-puck-guide.md) — 画面単位で GrapesJS と Puck を選択、cssFramework 混在、動的コンポーネント登録の使い方 (#806)
- [`/generate-code` ワークフロー](generate-code-workflow.md) — 設計した処理フロー / 画面を業務アプリ project root にコード生成して Dev Container で開発する流れ
- [トラブルシューティング](troubleshooting.md) — よくある詰まりと回避策

## UI 操作リファレンス

各画面 (Dashboard / 一覧 / Editor 等) の目的・到達経路・主要操作・データ前提を screenshot 付きで解説:

- [`ui-reference/`](ui-reference/README.md) — 全 27 画面のリファレンス (`/document-ui` skill で生成 / 更新)

## 前提ツール

- **designer (フロントエンド)** — `http://localhost:5173` で起動する React アプリ
- **backend (バックエンド + MCP)** — `npm run backend` (root、#1400) で HTTP + WebSocket (5179) を起動
- **Claude Code** — Anthropic の AI エージェント CLI。本プロジェクトを開く前に `npm run backend` で backend を常駐起動する (`.mcp.json` は URL mode、自動 spawn しない、#302 以降)

起動 (root から、#1400):

```bash
npm run frontend     # ブラウザ向けフロント (port 5173)
npm run backend      # バックエンド (port 5179、一度起動すれば AI セッション切替時も使い回し可)
# Claude Code は claude コマンドで起動 (backend は `npm run backend` で手動常駐起動)
```

subdir に `cd` して `npm run dev` を直接叩いても等価。

## スクリーンショット索引

代表的な画面は [`docs/ui-screenshots/`](../ui-screenshots/README.md) 参照。
