# Axis 08 — dogfood smoke (browser + backend integration)

## scope

`cd backend && npm run dev` を確認 (前提として user が常駐起動)、`cd frontend && npm run dev` で UI を立て、Playwright **headless** で全画面 navigate + console error / network 4xx-5xx 監視。MCP 連携の smoke も含む。

## 前提

- backend dev server が **既に常駐起動済** (port 5179) であること
- frontend dev server は本 Agent が `run_in_background` で起動し、終了前に kill
- Playwright MCP は `mcp__playwright__*` (headless) を使用、`mcp__playwright-headed__*` は使わない (memory `feedback_no_ai_managed_dev_server.md` / `feedback_browser_smoke_headless_chrome_devtools.md`)

## 必須 step

### 0. 環境前提チェック

```bash
# backend 常駐確認
curl -sf http://localhost:5179/mcp -o /dev/null && echo "backend OK" || echo "backend NOT RUNNING"
# 常駐していない場合は本軸 skip (ユーザーに通知して issue 起票)
```

### 1. frontend dev server 起動

```bash
cd frontend
npm run dev &  # 注意: Agent 自身が manage、終了前に kill
# 5-10 秒待って http://localhost:5173 が listen するか確認
```

### 2. 全 view navigate + console error 監視

`AGENTS.md` Tab policy 表の全 view path に対し:

```javascript
// 擬似コード
const views = [
  "/", "/screen/flow", "/screen/list", "/table/list", "/table/er",
  "/process-flow/list", "/sequence/list", "/view/list",
  "/view-definition/list", "/page-layout/list", "/gadget/list",
  "/generic-definition", "/extensions", "/conventions/catalog",
  "/project/tech-stack", "/workspace/list", "/ai-settings",
];

for (const path of views) {
  await mcp__playwright__browser_navigate({ url: `http://localhost:5173/w/<wsId>${path}` });
  await mcp__playwright__browser_wait_for({ time: 1.5 });
  const errors = await mcp__playwright__browser_console_messages({ level: "error" });
  const networkBad = (await mcp__playwright__browser_network_requests({}))
    .filter(r => r.status >= 400);
  // 各 view の error / 4xx-5xx を finding として記録
  // screenshot を .tmp/screenshots/release-review-<axis>-<view>.png に保存
}
```

### 3. per-resource view (individual resource navigation)

各 examples/<project>/ の harmony.json から id を 1-2 件 sample し:

- `/screen/design/<screenId>` (GrapesJS or Puck)
- `/screen/items/<screenId>`
- `/table/edit/<tableId>`
- `/process-flow/edit/<flowId>`
- `/view/edit/<viewId>`
- `/view-definition/edit/<viewDefId>`
- `/page-layout/edit/<plId>` / `/page-layout/design/<plId>`

各で console error / network 4xx-5xx を採集。

### 4. CRUD smoke (1 resource type につき 1 sequence)

例: テーブル定義で「新規作成 → カラム追加 → 保存 → 再読込 → 削除」を 1 sequence こなして:

- 各 step で network 200 確認
- save 後の sessionStorage / WebSocket message が backend に届いて persisted file が生成されているか

### 5. workspace switch smoke

```bash
# 別 workspace への切替で前 workspace のデータが残らないか
# active workspace の harmony.json と workspaces/ 配下の整合
```

### 6. MCP tool smoke (selected handful)

```bash
# 主要 MCP tool が backend 経由で動くか
# (本 Agent から MCP tool を直接呼ぶ - mcp__harmony-mcp__designer__list_screens 等)
```

### 7. 終了処理

```bash
# frontend dev server を kill (起動した PID を track して kill)
# screenshot を .tmp/release-review/<branch>/screenshots/ に整理
```

## 出力 format

findings.jsonl に append。本軸特有 field:

- `screenshot_path`: 該当 view の screenshot
- `console_errors`: 観測されたエラー (truncated)
- `failed_requests`: 4xx-5xx の URL list

## classification 指針

- console error が release blocker (例: TypeError で全画面 unmountable) → **issue** (severity=must)
- 4xx-5xx (例: 404 on /api/X) → **issue**
- 軽微な warning (deprecated API 警告等) → **nit issue** or **auto-fix** (内容次第)
- 視覚的崩れ (alignment / spacing 等) → **issue** (should 級)
- UX 改善提案 (機能改善案) → **issue** (nit 級) or **spec-pending** (機能仕様変更なら)

## 完了判定

全 view + per-resource sampling + CRUD smoke + workspace switch + MCP tool smoke の 5 領域を 1 巡し、findings.jsonl 0 件追加で `completed`。

## 重さ

本軸は重い (1 round で 30-60 分かかる可能性)。orchestrator は本軸の dispatch slot を 1 本固定、他 2 軸を並列で消化する。

## 注意

- frontend dev server を放置すると port 5173 を専有し続けるため、Agent 終了前に必ず kill (memory `feedback_no_ai_managed_dev_server.md` 違反防止)
- screenshot 大量生成で `.tmp/screenshots/` が肥大化するため、本 round 終了時に古い screenshot (前 round 分) を削除
