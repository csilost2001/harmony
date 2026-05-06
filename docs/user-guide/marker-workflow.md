# AI マーカーと `/designer-work`

designer 画面に残した指示・質問・TODO・チャットを Claude Code が読み取り、処理フローを自動編集する仕組みです。

## 4 種類のマーカー (kind)

| kind | 色 | 用途 | AI の対応 |
|------|---|------|---------|
| `todo` | 緑 | 作業指示 (命令形) | 構造的に編集して resolve |
| `question` | 紫 | 質問 (疑問形) | chat 返信 marker を追加して resolve |
| `attention` | オレンジ | 注意喚起・レビュー依頼 | **編集せず** 提案を resolution に書いて resolve |
| `chat` | 青 | 雑談・確認 | chat 返信 marker を追加して resolve |

## マーカー追加の 4 経路

### (A) MarkerPanel で直接追加

ProcessFlowEditor を開くと上部に「AI へのマーカー」パネル。kind を選んで body を入力。

### (B) 警告から 1-click 起票

画面右上「N 警告」バッジをクリック → 詳細パネルの各行「AI に依頼」ボタン。validator コード (UNKNOWN_RESPONSE_REF 等) + path 付きで kind=todo が自動起票される。

### (C) step card の 3-dots メニュー

対象 step の右上「...」→「AI に指摘」→ prompt で body 入力。stepId が自動で紐付く。

### (D) 外部ツール / API

MCP tool `designer__add_marker` を Claude Code や外部スクリプトから呼ぶ。`author: "ai"` で AI 側からの返信にも使う。

### (E) 画面への赤線描画 (フリーハンド) — #261 強化

ProcessFlowEditor 右上「描画」ボタン ON でツールバーが出現。

- **ペン / 消しゴム切替**: ペンで自由描画、消しゴムで既存 shape をクリック削除
- **マルチストローク**: 複数ストロークを 1 marker (path "d" に M 区切りで合体) として確定
- **undo**: 最後のストロークを 1 本戻す
- **確定 / キャンセル**: 確定で prompt → body 入力 → kind=todo の marker 起票、キャンセルで破棄

「ここ一帯」「この範囲」のような空間的な指摘が文章だけでは書きづらいときに使う。

## マーカーの可視化

ワークフローを回すため、未解決マーカーはいくつかの画面で一覧・カウント表示される。

| 画面 | 表示内容 |
|------|---------|
| Dashboard の MarkersSummaryPanel | 全体の未解決件数 + kind 別内訳 + 最多 AG ランキング |
| 処理フロー一覧 (カード / 表) | 各 ProcessFlow の未解決件数を kind 別色分けバッジ (緑/紫/橙/青) で表示。「マーカーありのみ」フィルタで絞り込み |
| 処理フロー編集 (StepCard) | 各 step ヘッダに未解決 marker の kind 別チップ。どの step に何種類の指摘が集中しているか一目で分かる |
| 処理フロー編集 (MarkerPanel) | 詳細リスト。kind バッジ + body + 解決/削除ボタン |

## スクショ例

- [22-warning-to-marker.png](../ui-screenshots/22-warning-to-marker.png) — 警告からの 1-click 起票
- [24-step-marker-badge.png](../ui-screenshots/24-step-marker-badge.png) — step card 上のバッジ

## `/designer-work` の実行

### 基本

新しい Claude Code 窓 (本プロジェクト内で `claude` 起動) で:

```
/designer-work <processFlowId>
```

例: `/designer-work cccccccc-0005-4000-8000-cccccccccccc`

### 動作

Claude Code は内部で以下を順次実行:

1. `designer__list_markers(processFlowId, unresolvedOnly=true)` で未解決 marker を取得
2. 各 marker を kind 別に処理:
   - `todo` + 命令形 + 範囲明示 → MCP tool で編集 + `designer__resolve_marker`
   - `question` / `chat` → `designer__add_marker(kind="chat", author="ai", body=回答)` + 元を resolve
   - `attention` → 編集せず resolution に提案を書いて resolve
3. **参照整合性チェック**: 新しい responseRef / tableId / typeRef / systemRef / @secret / @conv を追加する前に対象が存在するか確認。未定義なら別 attention を起票
4. **committed 保護**: ProcessFlow / action / step が committed の場合、body が命令形 + 範囲明示でない限り編集しない

### リアルタイム観察

開いているブラウザは wsBridge broadcast で自動更新される。人間は画面を見ながら結果を確認し、追加 marker を書いて次の往復へ。

### サンプル実行結果

[20-dogfood-before.png](../ui-screenshots/20-dogfood-before.png) / [21-dogfood-after.png](../ui-screenshots/21-dogfood-after.png) — 4 marker 投入 → /designer-work (シミュレータ) → AI 返信 2 + errorCatalog 追加 + 4 resolve。

### 試用サンプル

`docs/sample-project/process-flows/cccccccc-0099-4000-8000-cccccccccccc.json` に「詳細化途中」の ProcessFlow サンプルを同梱。6 種マーカー (3 todo + 1 question + 1 attention + 1 chat) 入り。`node docs/sample-project/seed.mjs` で data/ に展開、ブラウザで `/process-flow/edit/cccccccc-0099-4000-8000-cccccccccccc` を開いて `/designer-work` を試せる。

## 事前準備 (初回のみ)

### `.mcp.json` を確認

本プロジェクトには `.mcp.json` に `backend` が登録済み。Claude Code を本ディレクトリで起動すると自動 spawn される。

```json
{
  "mcpServers": {
    "backend": {
      "command": "npx",
      "args": ["tsx", "backend/src/index.ts"]
    }
  }
}
```

### ポート 5179 の扱い (#302 以降)

backend は HTTP + WebSocket を port 5179 で listen する常駐サーバ。以下の方法で起動:

```bash
cd backend
npm run dev    # 端末を 1 つ占有して常駐、Ctrl+C で終了
```

同 port に HTTP MCP endpoint (`/mcp`) とブラウザ向け WebSocket を同居。`.mcp.json` の URL エントリ経由で Claude Code が接続、複数 Claude Code セッション同時接続 OK。

旧仕様 (#302 以前): `.mcp.json` の command エントリで `npx tsx backend/src/index.ts` を自動 spawn していた → port 競合・orphan 発生で廃止。

古い orphan プロセスが残っていた場合は kill:

```bash
netstat -ano | grep :5179  # PID 取得
taskkill //F //PID <PID>   # Windows (Git Bash は //F の escape 必要)
# kill -9 <PID>            # macOS/Linux
```

## トラブル例

### 「backend に接続できない / MCP FAIL」

- `cd backend && npm run dev` で **常駐サーバを起動済みか** 確認 (#302 以降は自動 spawn しない)
- `netstat -ano | grep :5179` で LISTENING プロセスが存在するか
- `curl http://localhost:5179/` で `{"status":"ok",...}` が返るか
- `.mcp.json` の backend エントリが URL 形式 (`"type": "http"`, `"url": "http://localhost:5179/mcp"`) か
- `backend` の依存がインストール済みか (`cd backend && npm install`)

### 「marker 起票したのにブラウザに反映されない」

- ブラウザが wsBridge に接続できているか (DevTools Console で `mcpBridge` のログ確認)
- backend が古いプロセスのままで、新しい Claude Code 窓の tool 呼出を聞いていない可能性 → backend 再起動

### 「/designer-work が committed ステップを一切触らない」

仕様通り。committed は AI の独断編集を保護。編集させたい場合:
- kind を `todo` にする (attention では編集されない)
- body を命令形に (「〜を追加して」「〜を削除して」)
- 対象 step / field を明示

詳細は `.claude/commands/designer-work.md` 参照。
