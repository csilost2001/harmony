# ユーザーガイド

`CLAUDE.md` / `docs/spec/` は AI / 開発者向けのリファレンスです。本ディレクトリは **このツールを使う人 (プロダクトマネージャー / 業務設計者 / AI エージェントを運用する開発リーダー)** 向けの手引きです。

## 目的別ガイド

- [処理フロー編集ワークフロー](process-flow-workflow.md) — 上流 (概要) → 下流 (実装) までの詳細化をリモート AI と往復しながら進める方法
- [AI マーカーと `/designer-work`](marker-workflow.md) — 画面に指示を書いて Claude Code に処理させる使い方
- [画面項目 ID の AI 自動命名 `/rename-screen-ids`](rename-screen-ids-workflow.md) — 自動採番 ID を業務名に一括リネームする
- [マルチエディタ / Puck デザイナ](multi-editor-puck-guide.md) — 画面単位で GrapesJS と Puck を選択、cssFramework 混在、動的コンポーネント登録の使い方 (#806)
- [トラブルシューティング](troubleshooting.md) — よくある詰まりと回避策

## 前提ツール

- **designer (フロントエンド)** — `http://localhost:5173` で起動する React アプリ
- **backend (バックエンド + MCP)** — `npm run dev` で stdio + WebSocket (5179) を起動
- **Claude Code** — Anthropic の AI エージェント CLI。本プロジェクトを開くと backend が自動 spawn される (`.mcp.json` で設定済み)

起動:

```bash
cd frontend && npm run dev       # ブラウザ向けフロント
cd backend && npm run dev   # バックエンド (単独起動の場合)
# Claude Code は claude コマンドで起動 (backend は .mcp.json から自動起動)
```

## スクリーンショット索引

代表的な画面は [`docs/ui-screenshots/`](../ui-screenshots/README.md) 参照。
