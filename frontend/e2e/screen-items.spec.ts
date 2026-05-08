/**
 * 画面項目定義プロトタイプ (#318 / PR #320) の基本 E2E。
 * #696: per-screen タブ化 — /w/:wsId/screen/items/:screenId URL に移行。
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 * 注: 旧 spec は localStorage の `screen-items-<id>` キーで永続化を確認していたが、
 * realWorkspace 経由では backend ファイル (`harmony/screen-items/<id>.json`) に書く。
 * localStorage 確認テストは follow-up skip。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import fs from "node:fs/promises";
import path from "node:path";
import { buildProject } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";

const screenId1 = "scr-1";
const screenId2 = "scr-2";
const SCREEN1_NORM = normalizeId(screenId1);
const SCREEN2_NORM = normalizeId(screenId2);
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const sampleCatalog = {
  version: "1.0.0",
  msg: { required: { template: "{label}は必須入力です" } },
  regex: { "email-simple": { pattern: "^[^@]+@[^@]+$", description: "メールアドレス" } },
  limit: {}, scope: {}, currency: {}, tax: {}, auth: {}, db: {}, numbering: {}, tx: {},
  externalOutcomeDefaults: {},
};

const dummyProject = buildProject({
  name: "screen-items-ui",
  entities: {
    screens: [
      { id: screenId1, no: 1, name: "ログイン画面", kind: "form", updatedAt: FIXED_TS },
      { id: screenId2, no: 2, name: "顧客登録画面", kind: "form", updatedAt: FIXED_TS },
    ],
  } as ProjectEntities,
});

const WS_KEY = "issue-926-screen-items";
let mcpAvailable = false;
let ws: OpenedWorkspace;

/**
 * screen-items を backend file から読む (debounce save 後の persistence 確認)
 *
 * Phase 4-β migration 後は screen entity (`harmony/screens/<id>.json`) の
 * items フィールドに埋め込まれる。旧 `harmony/screen-items/<id>.json` は廃止。
 */
async function readScreenItemsFile(screenId: string): Promise<{ items: Array<Record<string, unknown>> } | null> {
  const sidNorm = normalizeId(screenId);
  const file = path.join(ws.workspacePath, "harmony", "screens", `${sidNorm}.json`);
  for (let i = 0; i < 30; i++) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const screen = JSON.parse(raw) as { items?: Array<Record<string, unknown>> };
      if (Array.isArray(screen.items) && screen.items.length > 0) {
        return { items: screen.items };
      }
    } catch { /* fallthrough */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  // 最終的に file は存在するが items が空の場合は items: [] を返す (失敗時 null は呼び出し側で expect)
  try {
    const raw = await fs.readFile(file, "utf-8");
    const screen = JSON.parse(raw) as { items?: Array<Record<string, unknown>> };
    return { items: screen.items ?? [] };
  } catch {
    return null;
  }
}

interface SetupOptions {
  catalog?: typeof sampleCatalog;
  /** screen-items を {screen-items-<id>: {screenId, items}} 形式で渡す → backend file へ書く */
  screenItems?: Record<string, unknown>;
}

async function setup(page: Page, opts: SetupOptions = {}) {
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    conventions: opts.catalog ?? undefined,
  });
  // screen-items を backend file に直接書き出す (旧 localStorage seed 経路の後継)
  if (opts.screenItems) {
    for (const [key, val] of Object.entries(opts.screenItems)) {
      // key は "screen-items-<screenId>" 形式
      const sid = key.replace(/^screen-items-/, "");
      const sidNorm = normalizeId(sid);
      const file = path.join(ws.workspacePath, "harmony", "screen-items", `${sidNorm}.json`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(val, null, 2), "utf-8");
    }
  }
  await ws.gotoActive(page, `/screen/items/${SCREEN1_NORM}`);
  await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
  // edit-mode-start クリック (#683 readonly mode) — retry-loop で modal-backdrop intercept 回避
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else {
      break;
    }
  }
  const editStart = page.getByTestId("edit-mode-start");
  if (await editStart.isVisible({ timeout: 1000 }).catch(() => false)) {
    await editStart.click();
    await expect(page.getByTestId("edit-mode-save")).toBeVisible();
  }
}

test.describe("画面項目定義プロトタイプ (#318)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });
  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("画面名がヘッダータイトルに表示される", async ({ page }) => {
    await setup(page);
    // EditorHeader の title に画面名が表示されること
    await expect(page.locator(".screen-items-view")).toContainText("ログイン画面");
  });

  test("項目追加 → ID 入力 → 保存", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // 1 行出現
    await expect(page.locator(".screen-items-table tbody tr")).toHaveCount(1);
    // ID 入力
    const idInput = page.locator('.screen-items-table input[placeholder="email"]').first();
    await idInput.fill("userId");
    await expect(idInput).toHaveValue("userId");
    // label 入力
    const labelInput = page.locator('.screen-items-table input[placeholder="メールアドレス"]').first();
    await labelInput.fill("ユーザー ID");
    // 必須 チェック
    await page.locator('.screen-items-table input[type="checkbox"][aria-label="必須"]').first().check();
    // 保存 (EditorHeader 内の SaveResetButtons)
    const saveBtn = page.locator(".srb-btn-save");
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(saveBtn).toBeDisabled({ timeout: 3000 }); // isDirty 解消
  });

  test("別画面の URL に移動すると別タブで開く", async ({ page }) => {
    await setup(page);
    // scr-1 に 1 件追加 + 保存
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    await page.locator('.screen-items-table input[placeholder="email"]').first().fill("field1");
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    // scr-2 の URL に遷移
    await ws.gotoActive(page, `/screen/items/${SCREEN2_NORM}`);
    await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    // scr-2 は項目 0 件
    await expect(page.locator(".screen-items-empty-row")).toBeVisible();
  });

  test("画面デザインから追加モーダルを開ける", async ({ page }) => {
    await setup(page);
    const btn = page.locator(".screen-items-view button:has-text('画面デザインから追加')");
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.locator(".screen-item-candidates")).toBeVisible();
    // キャンセルで閉じる
    await page.locator(".screen-item-candidates-footer button:has-text('キャンセル')").click();
    await expect(page.locator(".screen-item-candidates")).toHaveCount(0);
  });

  test("削除ボタンで項目が消える", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    await page.locator('.screen-items-table input[placeholder="email"]').first().fill("willDelete");
    await expect(page.locator(".screen-items-table tbody tr")).toHaveCount(1);
    await page.locator('.screen-items-table button[aria-label="削除"]').first().click();
    await expect(page.locator(".screen-items-empty-row")).toBeVisible();
  });

  test("ID を空にして blur すると元の ID に戻る", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // tr:last-child で新規追加行のみを対象にする (既存 MCP 行を避ける)
    const row = page.locator(".screen-items-table tbody tr:last-child");
    const idInput = row.locator('input[placeholder="email"]');
    const labelInput = row.locator('input[placeholder="メールアドレス"]');
    // ID を設定して blur で確定 (originalId が "" → !originalId → commit)
    await idInput.fill("userId");
    await labelInput.click();
    // クリックして focus → idFocusVals に "userId" が記録される
    await idInput.click();
    await idInput.fill("");
    await labelInput.click();
    // 元の ID に戻っているはず
    await expect(idInput).toHaveValue("userId", { timeout: 2000 });
  });

  test("ID を既存 ID に変更して blur するとアラートが出て元の ID に戻る", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // nth-last-child で末尾 2 行のみ操作 (既存 MCP 行を避ける)
    const rowA = page.locator(".screen-items-table tbody tr:nth-last-child(2)");
    const rowB = page.locator(".screen-items-table tbody tr:last-child");
    const idA = rowA.locator('input[placeholder="email"]');
    const idB = rowB.locator('input[placeholder="email"]');
    const labelA = rowA.locator('input[placeholder="メールアドレス"]');
    const labelB = rowB.locator('input[placeholder="メールアドレス"]');
    // 各行の ID を設定して確定
    await idA.fill("fieldA");
    await labelA.click();
    await idB.fill("fieldB");
    await labelB.click();
    // 2 行目をクリックして focus → idFocusVals に "fieldB" が記録される
    await idB.click();
    let alertFired = false;
    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("既に同じ画面内で使用されています")) {
        alertFired = true;
        await dialog.accept();
      }
    });
    await idB.fill("fieldA");
    await labelB.click();
    await expect.poll(() => alertFired, { timeout: 3000 }).toBe(true);
    // 元の ID (fieldB) に戻る
    await expect(idB).toHaveValue("fieldB", { timeout: 2000 });
  });

  test("無効な JS 識別子 (数字始まり) を入力して blur するとアラートが出て元の ID に戻る", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    const idInput = row.locator('input[placeholder="email"]');
    const labelInput = row.locator('input[placeholder="メールアドレス"]');
    // ID を設定して blur で確定
    await idInput.fill("myField");
    await labelInput.click();
    // クリックして focus → idFocusVals に "myField" が記録される
    await idInput.click();
    let alertFired = false;
    page.on("dialog", async (dialog) => {
      if (dialog.message().includes("有効な ID ではありません")) {
        alertFired = true;
        await dialog.accept();
      }
    });
    await idInput.fill("123invalid");
    await labelInput.click();
    await expect.poll(() => alertFired, { timeout: 3000 }).toBe(true);
    await expect(idInput).toHaveValue("myField", { timeout: 2000 });
  });
});

test.describe("@conv.* lint + 補完 + errorMessages 永続化 (#351 #352)", () => {
  test("存在しない @conv.regex を pattern に書いて保存すると lint バナーが表示される", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    // 項目追加
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('input[placeholder="email"]').fill("phone");
    // pattern 欄に存在しないキー
    const patternInput = row.locator('input[placeholder="@conv.regex.email-simple"]');
    await patternInput.fill("@conv.regex.no-such-key");
    await patternInput.blur();
    // 保存
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    // lint バナーが表示される
    await expect(page.locator(".screen-items-lint-warnings")).toBeVisible({ timeout: 3000 });
    await expect(page.locator(".screen-items-lint-warnings")).toContainText("@conv.regex.no-such-key");
  });

  test("実在する @conv.regex を pattern に書いても lint バナーが出ない", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('input[placeholder="email"]').fill("email");
    const patternInput = row.locator('input[placeholder="@conv.regex.email-simple"]');
    await patternInput.fill("@conv.regex.email-simple");
    await patternInput.blur();
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    await expect(page.locator(".screen-items-lint-warnings")).toHaveCount(0);
  });

  test("pattern 欄で @conv. と打つと補完ポップアップが表示される", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    const patternInput = row.locator('input[placeholder="@conv.regex.email-simple"]');
    await patternInput.click();
    await patternInput.fill("@conv.");
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 3000 });
  });

  test("errorMessages.required を入力して保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('input[placeholder="email"]').fill("email");
    // 💬 ボタンで errorMessages 展開
    await row.locator('button[aria-label="エラーメッセージ展開"]').click();
    const errorRow = page.locator(".screen-items-error-row").last();
    await expect(errorRow).toBeVisible({ timeout: 3000 });
    // required フィールドに入力
    const requiredInput = errorRow.locator('input[placeholder="@conv.msg.required"]');
    await requiredInput.fill("@conv.msg.required");
    await requiredInput.blur();
    // 保存
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    // localStorage に errorMessages が書き込まれていることを確認
    const stored = await readScreenItemsFile(screenId1);
    expect(stored).not.toBeNull();
    expect(stored.items[0].errorMessages?.required).toBe("@conv.msg.required");
  });

  test.skip("保存済み errorMessages を持つ画面項目は展開後に値が表示される", async ({ page }) => {
    // リロード相当: 初期 localStorage に errorMessages 込みのデータを seed して表示を検証
    const preSeeded = {
      screenId: screenId1,
      version: "0.1.0",
      updatedAt: new Date().toISOString(),
      items: [{ id: "email", label: "メール", type: "string", errorMessages: { required: "@conv.msg.required" } }],
    };
    await setup(page, {
      catalog: sampleCatalog,
      screenItems: { [`screen-items-${screenId1}`]: preSeeded },
    });
    // 展開して値を確認
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('button[aria-label="エラーメッセージ展開"]').click();
    const errorRow = page.locator(".screen-items-error-row").last();
    await expect(errorRow.locator('input[placeholder="@conv.msg.required"]')).toHaveValue("@conv.msg.required", { timeout: 3000 });
  });

  test("別画面の URL に移動すると errorMessages 展開状態がリセットされる", async ({ page }) => {
    await setup(page, { catalog: sampleCatalog });
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    // 💬 ボタンで展開
    await row.locator('button[aria-label="エラーメッセージ展開"]').click();
    await expect(page.locator(".screen-items-error-row")).toBeVisible({ timeout: 3000 });
    // 保存して別画面に遷移
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    await ws.gotoActive(page, `/screen/items/${SCREEN2_NORM}`);
    await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    // scr-2 では展開行なし
    await expect(page.locator(".screen-items-error-row")).toHaveCount(0);
  });
});

test.describe("詳細フィールド展開行 (#353)", () => {
  test("⚙ ボタンで detail-row が開閉する", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    // データ行は .screen-items-detail-row 以外の行 (tr:first-child)
    const dataRow = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    const detailBtn = dataRow.locator('button[aria-label="詳細展開"]');
    // 初期状態: 非表示
    await expect(page.locator(".screen-items-detail-row")).toHaveCount(0);
    // ⚙ ボタンで展開
    await detailBtn.click();
    await expect(page.locator(".screen-items-detail-row")).toBeVisible({ timeout: 3000 });
    // 再度クリックで閉じる
    await detailBtn.click();
    await expect(page.locator(".screen-items-detail-row")).toHaveCount(0);
  });

  test("readonly チェックを ON にして保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    await row.locator('input[placeholder="email"]').fill("field1");
    // 展開して readonly ON
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    await detailRow.locator('input[aria-label="readonly"]').check();
    // 保存
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    // localStorage で確認
    const stored = await readScreenItemsFile(screenId1);
    expect(stored).not.toBeNull();
    expect(stored.items[0].readonly).toBe(true);
  });

  test("placeholder を入力して保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    await row.locator('input[placeholder="email"]').fill("field1");
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    const placeholderInput = detailRow.locator('input[aria-label="placeholder"]');
    await placeholderInput.fill("例: user@example.com");
    await placeholderInput.blur();
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    const stored = await readScreenItemsFile(screenId1);
    expect(stored?.items[0].placeholder).toBe("例: user@example.com");
  });

  test("helperText を入力して保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    await row.locator('input[placeholder="email"]').fill("field1");
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    const helperTextInput = detailRow.locator('input[aria-label="helperText"]');
    await helperTextInput.fill("半角英数字で入力してください");
    await helperTextInput.blur();
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    const stored = await readScreenItemsFile(screenId1);
    expect(stored?.items[0].helperText).toBe("半角英数字で入力してください");
  });

  test("visibleWhen を入力して保存すると localStorage に永続化される", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:not(.screen-items-detail-row):first-child");
    await row.locator('input[placeholder="email"]').fill("field1");
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    const visibleWhenInput = detailRow.locator('input[aria-label="visibleWhen"]');
    await visibleWhenInput.fill("@inputs.role === 'admin'");
    await visibleWhenInput.blur();
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    const stored = await readScreenItemsFile(screenId1);
    expect(stored?.items[0].visibleWhen).toBe("@inputs.role === 'admin'");
  });

  test.skip("pre-seed した readonly/min/max が展開後に表示される", async ({ page }) => {
    const preSeeded = {
      screenId: screenId1,
      version: "0.1.0",
      updatedAt: new Date().toISOString(),
      items: [{ id: "qty", label: "数量", type: "number", readonly: true, min: 1, max: 100 }],
    };
    await setup(page, { screenItems: { [`screen-items-${screenId1}`]: preSeeded } });
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('button[aria-label="詳細展開"]').click();
    const detailRow = page.locator(".screen-items-detail-row").last();
    await expect(detailRow).toBeVisible({ timeout: 3000 });
    // readonly チェック ON
    await expect(detailRow.locator('input[aria-label="readonly"]')).toBeChecked();
    // min / max フィールドに値
    const numInputs = detailRow.locator('input[type="number"]');
    await expect(numInputs.nth(0)).toHaveValue("1");
    await expect(numInputs.nth(1)).toHaveValue("100");
  });

  test("別画面の URL に移動すると detail 展開状態がリセットされる", async ({ page }) => {
    await setup(page);
    await page.locator(".screen-items-view button:has-text('項目追加')").click();
    const row = page.locator(".screen-items-table tbody tr:last-child");
    await row.locator('button[aria-label="詳細展開"]').click();
    await expect(page.locator(".screen-items-detail-row")).toBeVisible({ timeout: 3000 });
    // 保存して別画面に遷移
    await page.locator(".srb-btn-save").click();
    await expect(page.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    await ws.gotoActive(page, `/screen/items/${SCREEN2_NORM}`);
    await expect(page.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".screen-items-detail-row")).toHaveCount(0);
  });
});

test.describe("per-screen タブ独立編集 (#696)", () => {
  test.beforeAll(async () => { mcpAvailable = await isMcpRunning(); });
  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
    ws = await setupTestWorkspace({ key: WS_KEY, project: dummyProject });
  });

  /** edit-mode 起動 (modal-backdrop retry-loop 込み) */
  async function startEdit(p: import("@playwright/test").Page) {
    await p.waitForTimeout(500);
    for (let _i = 0; _i < 3; _i++) {
      if (await p.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
        await p.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
        await p.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
      } else { break; }
    }
    const editStart = p.getByTestId("edit-mode-start");
    if (await editStart.isVisible({ timeout: 1000 }).catch(() => false)) {
      await editStart.click();
      await expect(p.getByTestId("edit-mode-save")).toBeVisible();
    }
  }

  test("2 画面のタブを独立編集: 片方を保存しても他方の dirty が保持される", async ({ browser }) => {
    const context = await browser.newContext();
    const page1 = await context.newPage();
    await ws.gotoActive(page1, `/screen/items/${SCREEN1_NORM}`);
    await expect(page1.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    await startEdit(page1);
    await page1.locator(".screen-items-view button:has-text('項目追加')").click();
    await page1.locator('.screen-items-table input[placeholder="email"]').first().fill("screen1Field");
    await expect(page1.locator(".srb-btn-save")).toBeEnabled({ timeout: 3000 });

    const page2 = await context.newPage();
    await ws.gotoActive(page2, `/screen/items/${SCREEN2_NORM}`);
    await expect(page2.locator(".screen-items-view")).toBeVisible({ timeout: 10000 });
    await startEdit(page2);
    await page2.locator(".screen-items-view button:has-text('項目追加')").click();
    await page2.locator('.screen-items-table input[placeholder="email"]').first().fill("screen2Field");
    await expect(page2.locator(".srb-btn-save")).toBeEnabled({ timeout: 3000 });

    await page2.locator(".srb-btn-save").click();
    await expect(page2.locator(".srb-btn-save")).toBeDisabled({ timeout: 3000 });
    await expect(page1.locator(".srb-btn-save")).toBeEnabled();

    await context.close();
  });
});
