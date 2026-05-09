/**
 * editSessionDropdown e2e helper (#980-A 教訓を封じ込め)
 *
 * EditSessionDropdown コンポーネント (`.esd-root` / `[data-testid="esd-toggle-btn"]` 等) は
 * Playwright の `locator.click()` で **180s timeout** に陥る既知問題がある。
 *
 * ## なぜ普通の click() が効かないのか
 *
 * Playwright の actionability check は `document.elementFromPoint(centerX, centerY)` で
 * 「クリック対象が最前面か」を確認する。EditSessionDropdown は構造上:
 *
 * ```html
 * <div class="esd-root" data-testid="edit-session-dropdown">  ← 親 div
 *   <button class="esd-toggle btn" data-testid="esd-toggle-btn">  ← 実際の click target
 *     <span class="esd-badge-icon">📄</span>
 *     <span class="esd-badge-label">正規版</span>
 *   </button>
 * </div>
 * ```
 *
 * `.esd-root` は `position:relative; display:inline-flex` で button と同サイズ。同 stacking
 * context で button が後にあるため理論上 button が前面になるべきだが、実際には
 * `elementFromPoint` が `.esd-root` の方を返してくる (Chromium のレイアウト計算上の挙動)。
 * Playwright は「intercepts pointer events」と判定して click を待ち続ける。
 *
 * 当初は CSS `.esd-toggle > * { pointer-events: none }` で内部 span を貫通させたが、
 * 親 `.esd-root` 自体の干渉は残る。`force: true` でも actionability の hit-test 干渉は
 * 完全には bypass できない (Playwright の実装上、force はクリック先座標を使うため
 * `.esd-root` がクリックされて React onClick が発火しない)。
 *
 * ## 解決策 — 本 helper を必ず使う
 *
 * `page.evaluate(() => document.querySelector(sel)?.click())` で **DOM 上の button 要素に
 * 直接 click イベントを発火** する。Playwright actionability check を完全 bypass し、
 * React の onClick handler に確実に届く (save-reset-action.spec.ts で実証済の同パターン)。
 *
 * ## 適用範囲
 *
 * `[data-testid^="esd-"]` のすべてのボタン:
 *  - `esd-toggle-btn` (集約バッジ / dropdown 開閉)
 *  - `esd-viewer-btn-<sessionId>` ([👁 観察])
 *  - `esd-takeover-btn-<sessionId>` ([↪ 引継])
 *  - `esd-discard-btn-<sessionId>` ([× 破棄])
 *  - `esd-new-draft-btn` ([+ 新規 draft 作成])
 *  - `esd-history-btn` (履歴)
 *
 * これらの click は **必ず本 helper の関数を経由** すること。直接 `locator.click()` を
 * 書くと再発する。.claude/skills/test-strategy/SKILL.md と stop hook で機械検知される
 * 仕組みも合わせて入れている。
 *
 * 参考 commit: e7ad810 / 8054836 / 8ae5305 (#980-A シリーズ)
 */
import { expect, type Page } from "@playwright/test";

/**
 * `[data-testid="<testid>"]` のボタン (typically `esd-*-btn`) を `dispatchEvent('click')`
 * 経由でクリックする。Playwright actionability check (= `.esd-root` 干渉) を bypass する。
 */
export async function esdClick(page: Page, testid: string): Promise<void> {
  await page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLButtonElement | null)?.click(),
    `[data-testid="${testid}"]`,
  );
}

/**
 * `[data-testid^="<prefix>"]` のうち最初のボタンを click する (動的 sessionId 付き ID 用)。
 * 例: `esd-viewer-btn-` / `esd-takeover-btn-` / `esd-discard-btn-`
 */
export async function esdClickPrefix(page: Page, prefix: string): Promise<void> {
  await page.evaluate(
    (sel) => (document.querySelector(sel) as HTMLButtonElement | null)?.click(),
    `[data-testid^="${prefix}"]`,
  );
}

/**
 * dropdown を開く (toggle button をクリック)。既に開いていれば閉じてから再 open。
 * 関数を呼び終わった時点で dropdown 内の任意の testid が visible 待ちできる状態。
 */
export async function openEsdDropdown(page: Page): Promise<void> {
  await expect(page.getByTestId("esd-toggle-btn")).toBeVisible({ timeout: 15000 });
  await esdClick(page, "esd-toggle-btn");
}

/**
 * 既存 EditSession に Viewer (View role) として attach する。
 *
 * 前提: 別 session が Edit role として該当 resource を編集中で、自分はまだ未参加 ( myRole=null )。
 *
 * 実行内容:
 *  1. dropdown を開く
 *  2. `esd-viewer-btn-*` を click ( `useEditSession.attach` 経由で myRole=View に同期)
 *  3. attach broadcast 反映まで 1500ms 待機 (sessions 再 fetch + dropdown 再 render)
 *  4. dropdown を再 open (`setOpen(false)` で閉じているため)
 *
 * 関数終了時点で dropdown は **開いた状態**。後続で `esd-takeover-btn-*` 等を click できる。
 */
export async function attachAsViewer(page: Page): Promise<void> {
  await openEsdDropdown(page);
  await expect(page.locator('[data-testid^="esd-viewer-btn-"]').first()).toBeVisible({ timeout: 5000 });
  await esdClickPrefix(page, "esd-viewer-btn-");
  // attach 反映 (broadcast → sessions 再 fetch → dropdown 再 render) を待つ
  await page.waitForTimeout(1500);
  // viewer attach 直後 setOpen(false) で dropdown が閉じるため再 open
  await esdClick(page, "esd-toggle-btn");
}

/**
 * Viewer 状態から take-over (transferEdit) を実行する。
 *
 * 前提: `attachAsViewer(page)` を実行済 (= dropdown が開いた状態 + 自分が View)。
 *
 * 実行内容:
 *  1. `esd-takeover-btn-*` の visibility を待つ
 *  2. `window.confirm` を `() => true` に override + click を **同期 evaluate 内で** 実行
 *     (Playwright の `page.on("dialog")` 方式は handleTakeOver 内 confirm を取りこぼす場合あり)
 *  3. take-over 後 myRole=Edit に同期されるまでは呼び出し側で確認すること
 *     (例: `await expect(page.getByTestId("edit-mode-save")).toBeVisible({ timeout: 10000 })`)
 */
export async function takeOver(page: Page): Promise<void> {
  await expect(page.locator('[data-testid^="esd-takeover-btn-"]').first()).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    window.confirm = () => true;
    (document.querySelector('[data-testid^="esd-takeover-btn-"]') as HTMLButtonElement | null)?.click();
  });
}

/**
 * dropdown から `esd-new-draft-btn` を click して新規 EditSession を作成する。
 * spec §9 (複数 EditSession 並存) の B 案起動用。
 *
 * 関数終了時点で myRole=Edit に遷移する。呼び出し側で `edit-mode-save` 表示を確認すること。
 */
export async function startNewDraft(page: Page): Promise<void> {
  await openEsdDropdown(page);
  await expect(page.getByTestId("esd-new-draft-btn")).toBeVisible({ timeout: 5000 });
  await esdClick(page, "esd-new-draft-btn");
}

/**
 * dropdown から `esd-history-btn` を click して draft-history modal を開く。
 *
 * 関数終了時点で `[data-testid="draft-history-modal"]` が表示される。
 */
export async function openHistoryModal(page: Page): Promise<void> {
  await openEsdDropdown(page);
  await expect(page.getByTestId("esd-history-btn")).toBeVisible({ timeout: 5000 });
  await esdClick(page, "esd-history-btn");
}
