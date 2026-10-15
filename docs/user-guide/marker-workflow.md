# AI マーカーと `/designer-work`

designer 画面に残した指示・質問・TODO・チャットを Claude Code が読み取り、設計を自動編集する仕組みです。

**どの設計にも付けられます**: 処理フロー・画面・テーブル・ビュー・ビュー定義・シーケンス・ページレイアウト (業務フロー・帳票は、スキーマに置き場がなく、未対応)。マーカーは、設計の `authoring.markers` に保存され、画面と AI (MCP) が同じ場所を読み書きします。位置は `anchor` で指します (処理フロー: 工程の id / ほか: `$.columns[<カラム id>]` `$.items[<項目 id>]` など)。

## 4 種類のマーカー (kind)

| kind | 色 | 用途 | AI の対応 |
|------|---|------|---------|
| `todo` | 緑 | 作業指示 (命令形) | 構造的に編集して resolve |
| `question` | 紫 | 質問 (疑問形) | chat 返信 marker を追加して resolve |
| `attention` | オレンジ | 注意喚起・レビュー依頼 | **編集せず** 提案を resolution に書いて resolve |
| `chat` | 青 | 雑談・確認 | chat 返信 marker を追加して resolve |

## マーカー追加の 4 経路

### (A) マーカーのパネルで直接追加

各設計の編集画面にある「AI へのマーカー」パネル (テーブルは「マーカー」タブ、画面は画面項目の画面の上部、シーケンス・ビュー・ビュー定義・ページレイアウトは画面の先頭、処理フローは上部)。種類を選び、(位置を選べる設計では) 位置を選び、本文を書く。**Enter で追加、Shift+Enter で改行**。**Ctrl+Alt+M** で、フォーカスのあるカラム・項目について、追加欄を開く。パネルの「**AI に渡す文をコピー**」は、未解決のマーカーを、Claude Code などにそのまま貼れる依頼の文にする。

画面 (項目) のマーカーは、設計の保存とは別に、**その場で保存**される (AI が並行して足したマーカーを消さないよう、差分だけを重ねて保存する)。ほかの設計は、設計の保存で保存される。

### (B) 警告から 1-click 起票

画面右上「N 警告」バッジをクリック → 詳細パネルの各行「AI に依頼」ボタン。validator コード (UNKNOWN_RESPONSE_REF 等) + path 付きで kind=todo が自動起票される。

### (C) step card の 3-dots メニュー

対象 step の右上「...」→「AI に指摘」→ ダイアログ (複数行、種類を選べる) で body 入力。stepId が自動で紐付く。工程の見出しにフォーカスがあるとき **Ctrl+Alt+M** でも開く。

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
| Dashboard の MarkersSummaryPanel | 全設計の未解決件数 + kind 別・設計の種類別の内訳 + 最も古い未解決の経過日数 + 設計ごとの件数 |
| マーカー一覧 (メニュー「マーカー (AI への指示)」、`/markers`) | 全設計のマーカーを古いものから並べる。設計の種類・種類・語・解決済みで絞り込み。選んだものを、メモつきでまとめて解決。「AI に渡す文をコピー」 |
| テーブル / 画面項目の行 | 未解決のマーカーがあるカラム・項目に、件数のバッジ (クリックでパネルを開く) |
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
/designer-work <entityType> <entityId>     # 例: /designer-work table orders
/designer-work                             # 全設計の未解決マーカーを一望してから、順に
```

例: `/designer-work confirm-order` / `/designer-work table orders`。entityType は `processFlow` `screen` `table` `view` `viewDefinition` `sequence` `pageLayout`。

### 動作

Claude Code は内部で以下を順次実行:

1. `designer__list_markers(entityType, entityId, unresolvedOnly=true)` (処理フローは `processFlowId` だけでもよい) で未解決 marker を取得。id を指定しないときは `designer__find_all_markers` で全設計を一望
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

`examples/<project-id>/harmony/process-flows/` 配下に「詳細化途中」の ProcessFlow サンプルが含まれる場合がある (6 種マーカー入りなど)。`workspaces/` 配下に作業 copy してブラウザで開き、`/designer-work` を試せる (`docs/sample-project/` は #774 で廃止済、`examples/<project-id>/` に統合)。

## 事前準備 (初回のみ)

### `.mcp.json` を確認

本プロジェクトには `.mcp.json` に `harmony-mcp` が登録済み (URL mode、自動 spawn しない)。Claude Code を本ディレクトリで起動する前に backend を常駐起動しておくこと。

```json
{
  "mcpServers": {
    "harmony-mcp": {
      "type": "http",
      "url": "http://localhost:5179/mcp"
    }
  }
}
```

### ポート 5179 の扱い (#302 以降)

backend は HTTP + WebSocket を port 5179 で listen する常駐サーバ。以下の方法で起動:

```bash
# 推奨 (root から、#1400)
npm run backend     # 端末を 1 つ占有して常駐、Ctrl+C で終了

# 等価 (subdir 派)
cd backend && npm run dev
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

- `npm run backend` (または `cd backend && npm run dev`) で **常駐サーバを起動済みか** 確認 (#302 以降は自動 spawn しない)
- `netstat -ano | grep :5179` で LISTENING プロセスが存在するか
- `curl http://localhost:5179/` で `{"status":"ok",...}` が返るか
- `.mcp.json` の backend エントリが URL 形式 (`"type": "http"`, `"url": "http://localhost:5179/mcp"`) か
- 依存がインストール済みか (repo root で `npm install`、PR #1378 で npm workspaces 化以降は root 1 発)

### 「marker 起票したのにブラウザに反映されない」

- ブラウザが wsBridge に接続できているか (DevTools Console で `mcpBridge` のログ確認)
- backend が古いプロセスのままで、新しい Claude Code 窓の tool 呼出を聞いていない可能性 → backend 再起動

### 「/designer-work が committed ステップを一切触らない」

仕様通り。committed は AI の独断編集を保護。編集させたい場合:
- kind を `todo` にする (attention では編集されない)
- body を命令形に (「〜を追加して」「〜を削除して」)
- 対象 step / field を明示

詳細は `.claude/commands/designer-work.md` 参照。
