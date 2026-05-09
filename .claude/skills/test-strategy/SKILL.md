---
description: テスト実装・修正・Vitest・Playwright・E2E・スペック・spec・test
paths:
  - "frontend/src/**/*.test.ts"
  - "frontend/e2e/**/*.spec.ts"
  - "frontend/e2e/**/*"
---

# テスト戦略

このプロジェクトのテストは **3層・3視点** で実装する。同じ機能でも視点が異なるため、3つは競合ではなく補完関係にある。

## 3層の役割分担

| 層 | ツール | テストの主体 | 何を保証するか |
|----|--------|------------|---------------|
| ロジック層 | Vitest | 開発者 | コードの振る舞いの正しさ |
| UI層 | Playwright (.spec.ts) | ユーザー | 見た目・操作の正しさ |
| 統合層 | wsBridge E2E | ブラウザ↔ファイル | WebSocket通信とファイル永続化の正しさ |

## 各層のスコープ

**Vitest（`frontend/src/**/*.test.ts`）**
- ストアのロジック（tabStore の状態遷移、dirty フラグ管理など）
- ユーティリティ関数
- データ変換・バリデーション
- GrapesJS / ReactFlow / WebSocket は含めない

**Playwright（`frontend/e2e/**/*.spec.ts`）**
- TabBar の操作（開閉・右クリックメニュー・D&D）
- ナビゲーション・ルーティング・URL 同期
- 保存ボタンの表示/非表示（isDirty の UI 反映）
- GrapesJS キャンバス内部はスコープ外（iframe 制約・費用対効果が低い）
- テストコードは AI が生成し、実行は `npx playwright test` で自律実行する

**MCP テスト（`frontend/e2e/mcp/**/*.spec.ts`）**
- ブラウザ役として `{ type: "request" }` プロトコルで wsBridge に接続し、ファイル操作を検証する
- テスト可能（主要リソース）:
  - project: `loadProject` / `saveProject`
  - screen: `loadScreen` / `saveScreen` / `deleteScreen`
  - table: `loadTable` / `saveTable` / `deleteTable`
  - processFlow: `loadProcessFlow` / `saveProcessFlow` / `deleteProcessFlow`
  - mtime: `getFileMtime`
- payload の id フィールド名は kind によって異なる: `screen` は `screenId`、`table` は `tableId`、`processFlow` は `id`
- テスト不可（stdio 経由のみ）: `designer__open_tab` 等のタブ操作コマンド → Issue #67 参照
- backend が ws://localhost:5179 で起動していない場合は自動スキップ

## バグの切り分け方針

```
Vitest 失敗               → ロジックバグ（store/utils 層）
Playwright 失敗のみ       → UI 実装バグ（コンポーネント層）
MCP テスト失敗のみ        → WebSocket/ファイル永続化バグ
```

## Playwright 実装ルール

### AI の役割
- AI は `.spec.ts` ファイルを生成するだけ。テストの実行は `npx playwright test` で自律実行する
- AI が Playwright MCP を直接操作するのは「探索・デバッグ」目的の一時的な用途に限定する
- テスト失敗時のみ、失敗ログを AI に渡して修正を依頼する

### addInitScript の挙動（重要）
`page.addInitScript()` は `page.goto()` と `page.reload()` を含む**全ナビゲーションで再実行**される。

- タブ状態の事前設定は addInitScript 内で行い、`harmony-open-tabs` と `harmony-active-tab` を両方セットする
- 「UIで操作した状態がリロード後も保持される」テストは書けない（addInitScript が毎回上書きするため）
  → 代わりにリロード後の期待状態を addInitScript で事前設定して検証する

```typescript
await page.addInitScript(({ project, tabs, activeTabId }) => {
  localStorage.setItem("flow-project", JSON.stringify(project));
  localStorage.setItem("harmony-open-tabs", JSON.stringify(tabs));
  localStorage.setItem("harmony-active-tab", activeTabId);
}, { project, tabs, activeTabId });
```

### ブラウザにインターセプトされるキー操作
`Ctrl+Tab`（タブ切り替え）と `Ctrl+W`（タブを閉じる）はChromiumがページより先に処理するため、`page.keyboard.press()` では届かない。`document.dispatchEvent()` で直接送出する：

```typescript
await page.evaluate(() => {
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "Tab", ctrlKey: true, bubbles: true, cancelable: true,
  }));
});
```

### opacity:0 要素のクリック
タブの閉じるボタン（`.tabbar-tab-close`）はホバー前は `opacity: 0`。Playwright の actionability チェックをスキップするために `{ force: true }` を使う：

```typescript
await tabLocator.locator(".tabbar-tab-close").click({ force: true });
```

### 複数要素への toContainText は strict モード違反
複数の要素にマッチするロケータに `toContainText()` を使うと strict モード違反になる。`.filter()` で絞り込む：

```typescript
// NG: locator(".tabbar-tab") が複数マッチすると失敗
await expect(page.locator(".tabbar-tab")).toContainText("画面A");

// OK
await expect(page.locator(".tabbar-tab").filter({ hasText: "画面A" })).toBeVisible();
```

## テスト実装の優先順位

1. **Vitest 優先** — 純ロジックは即効性が高くメンテコストが低い
2. **Playwright 次** — TabBar・ナビゲーションはこのプロジェクトと相性が良い
3. **MCP テスト** — ファイル永続化パイプラインなどこのシステム特有の価値がある箇所に適用

## 抑制系修正のフィクスチャ選定（偽陽性テスト回避）

「特定イベントを無視／抑制する」系の修正（例: ロード中は dirty にしない、リセット中は autosave を無効化、フォーカス変更を debounce する等）をテストするとき、**抑制対象のイベントが実際に発火するフィクスチャ**を使うこと。発火しないフィクスチャでは、テストが通っても「ガードが効いたから」なのか「そもそもイベントが起きなかったから」なのか区別できず、偽陽性になる。

### 過去の実例: #121 → #127

- #121 で「リセット後も dirty が残る」を修正。追加テスト `save-reset-designer.spec.ts` は `gjs-screen-${id}` を `{}` で setup していた
- 空データだと GrapesJS の `editor.load()` で `component:add` が一切発火しない
- 結果: リセット抑制ガードを検証していない偽陽性テストが通過
- 副次的に、同じ経路で発生する「初期ロード時の dirty 誤マーク」も見逃し、#127 として再修正が必要になった

### チェックリスト

抑制系修正を書く／レビューするときは以下を確認する：

- [ ] 抑制対象のイベント（例: `component:add`, `input`, `scroll`）を実際に発火させるフィクスチャになっているか？
- [ ] 「何もしない」テストで通るのは、ガードが効いたからか、前提条件が揃わないからか、明確に区別できるか？
- [ ] 修正対象の経路（リセット、ロード、切り替え等）を **別々のケースで** 網羅できているか？ 一つのイベント源のテストで複数経路を代表させようとしていないか？

## React フック単体テスト

`@testing-library/react` の `renderHook` + `act` を使う（`frontend/` に導入済み）。

```typescript
import { renderHook, act, waitFor } from "@testing-library/react";
import { useResourceEditor } from "./useResourceEditor";

const hook = renderHook(() => useResourceEditor({ ... }));
await waitFor(() => expect(hook.result.current.state).not.toBeNull());
act(() => hook.result.current.update((d) => { d.name = "changed"; }));
```

### モジュール全体のモック
mcpBridge のような WebSocket 依存モジュールは `vi.mock()` でスタブ化し、テスト側から broadcast を発火できるエミッタを公開する:

```typescript
vi.mock("../mcp/mcpBridge", () => {
  const handlers = new Map<string, Set<(d: unknown) => void>>();
  return {
    mcpBridge: {
      onBroadcast(event, h) { ... },
      onStatusChange(cb) { ... },
      _emit(event, data) { handlers.get(event)?.forEach((h) => h(data)); },
    },
  };
});
```

### 純関数抽出パターン
フックの判定ロジックは純関数として export しておくと、React mount 不要でテストが書ける（例: `shouldTriggerSaveShortcut` in `useSaveShortcut.ts`）。

## 共通フック利用時のテスト観点

エディタ共通の状態管理（保存・リセット・ドラフト・broadcast）は `useResourceEditor` に集約済み。個別エディタのテストは **フックが正しく配線されているか** を確認すれば十分で、ロジック自体の網羅は `useResourceEditor.test.ts` 側で担保される。

| 確認観点 | テスト層 | 具体例 |
|---------|---------|-------|
| フック内部のロジック | Vitest | `useResourceEditor.test.ts`（15 ケース）|
| エディタへの配線 | Playwright | `save-reset.spec.ts` / `save-reset-action.spec.ts` / `save-reset-flow.spec.ts` |
| WS↔ファイル永続化 | MCP E2E | `mcp-tools.spec.ts`（14 ケース）|

エディタ側のテストは最小限で OK: 「保存ボタンが有効化される」「タブに ● が出る」「Ctrl+S で保存される」を確認すればフック配線は通る。

## EditSessionDropdown / 多重 context 系テストの注意 (#980-A 教訓)

`[data-testid^="esd-"]` のボタン (`esd-toggle-btn` / `esd-viewer-btn-*` /
`esd-takeover-btn-*` / `esd-discard-btn-*` / `esd-new-draft-btn` / `esd-history-btn`) の
クリックは **絶対に Playwright の `locator.click()` を使わない**。**必ず**
[`frontend/e2e/helpers/editSessionDropdown.ts`](../../frontend/e2e/helpers/editSessionDropdown.ts)
の helper を使う。

```ts
// ✗ NG: これは 180s timeout する。Playwright actionability check が `.esd-root` 親 div を拾うため。
await page.getByTestId("esd-toggle-btn").click();
await page.locator('[data-testid^="esd-takeover-btn-"]').first().click();

// ✓ OK: helper 経由 (`page.evaluate(() => btn.click())` で actionability bypass)
import { openEsdDropdown, attachAsViewer, takeOver, startNewDraft, openHistoryModal } from "../helpers/editSessionDropdown";
await openEsdDropdown(page);
await attachAsViewer(page);
await takeOver(page);
```

### なぜ Playwright click() がダメか

EditSessionDropdown の DOM は `<div class="esd-root"><button class="esd-toggle">...</button></div>`。
Chromium の `document.elementFromPoint(centerX, centerY)` が `.esd-root` の方を返すため
Playwright actionability check が「intercepts pointer events」を出して click を待ち続ける。
`force: true` でも Playwright は座標経由で click するため React onClick が `.esd-root` で発火し
button の onClick に届かない。`page.evaluate(() => btn.click())` で **DOM 上の button 要素に
直接 click イベントを dispatch** する必要がある。

### 多重 browser context テストのお作法 (collab/* / edit-session/*)

- **両 page で `seedTabsForWorkspace` + `gotoEditorAndDismiss`**: 片方だけだと
  ResumeOrDiscardDialog の backdrop が click を遮蔽する
- **alice の payload を非 null にしてから take-over**: backend `editSessionStore.transferEdit`
  は `session.payload === null` の場合 history snapshot を skip する。alice 側で
  「アクション追加」等の編集を 1 つ加えてから bob が take-over する
- **`window.confirm` override は click と同期 evaluate 内で**: `page.on("dialog", ...)` は
  async race で取りこぼす場合がある。helper の `takeOver(page)` は内部で同期 evaluate を
  使っているのでこの問題を回避済
- **`finally` で context.close() に任せる**: 明示 discard を入れると state race で hang
  しがち。context が閉じれば WS 切断 → backend の `presenceUnregisterAllForSession` で
  cleanup される (#980-A の追加 fix)

### よくある誤った期待値 (旧仕様の名残)

- 「リセット後 dirty マーク消える」は **削除済**: edit-session-protocol §4 で reset 後も
  EditSession Active 継続 (Edit role 維持) のため `isDirtyForTab = myRole === "Edit"` で
  tab dirty は維持される設計
- 「他人の Active session があれば ResumeOrDiscardDialog が出る」は **誤動作**:
  `participants[mcpBridge.getSessionId()]` がいる Active session のみが「自分の draft」。
  全エディタで filter 適用済 (#980-A)。新エディタを追加する際は同じ filter を踏襲すること
