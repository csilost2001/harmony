/**
 * workspace-folder-picker.spec.ts (#1056)
 *
 * AddWorkspaceDialog の「参照」ボタン → BackendFolderPicker → 選択 → 入力欄反映の
 * 一連フローを E2E で検証。
 *
 * 前提: backend (port 5179) と frontend (port 5173) が稼働中。
 *
 * backend の filesystem を実機ブラウズするため、`.tmp/e2e-folder-picker/` 配下に
 * 固定のテスト用ディレクトリ構造 (workspace fixture) を毎回作成する。
 */
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { folderPickerFixtureRoot } from "./helpers/workspaceFixture.ts";

// #1359: worker prefix 付き fixture root (`.tmp/e2e-folder-picker/w<idx>-root/`)。
// workers > 1 で複数 worker が同 path に同時 write した時の race を回避する。
const FIXTURE_ROOT = folderPickerFixtureRoot();
const FIXTURE_WS_A = path.join(FIXTURE_ROOT, "ws-a");
const FIXTURE_WS_B = path.join(FIXTURE_ROOT, "ws-b");
const FIXTURE_NOT_WS = path.join(FIXTURE_ROOT, "not-a-workspace");

async function ensureFixture(): Promise<void> {
  await fs.mkdir(FIXTURE_WS_A, { recursive: true });
  await fs.writeFile(
    path.join(FIXTURE_WS_A, "harmony.json"),
    JSON.stringify({ $schema: "harmony-project-v3", version: 3, meta: { name: "FixtureA" }, dataDir: "harmony" }),
    "utf-8",
  );
  await fs.mkdir(FIXTURE_WS_B, { recursive: true });
  await fs.writeFile(
    path.join(FIXTURE_WS_B, "harmony.json"),
    JSON.stringify({ $schema: "harmony-project-v3", version: 3, meta: { name: "FixtureB" }, dataDir: "harmony" }),
    "utf-8",
  );
  await fs.mkdir(FIXTURE_NOT_WS, { recursive: true });
  await fs.writeFile(path.join(FIXTURE_NOT_WS, "readme.md"), "# placeholder", "utf-8");
}

async function setupClean(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    window.alert = () => {};
    window.confirm = () => false;
  });
}

async function openAddDialog(page: Page): Promise<void> {
  await page.goto("/workspace/list");
  const addBtn = page.locator("button", { hasText: "追加" }).first();
  await addBtn.click();
  await expect(page.locator(".tbl-modal")).toBeVisible();
}

async function openFolderPicker(page: Page, initialPath: string): Promise<void> {
  // 「参照」ボタン押下前に、初期 path を入力欄に入れて picker の initialPath として使う
  const input = page.getByTestId("workspace-path-input");
  await input.fill(initialPath);
  await page.getByTestId("open-folder-picker").click();
  // picker overlay が見えるまで待つ
  await expect(page.getByTestId("backend-folder-picker-overlay")).toBeVisible();
}

test.describe("AddWorkspaceDialog — BackendFolderPicker (#1056)", { tag: ["@regression"] }, () => {
  test.beforeEach(async () => {
    await ensureFixture();
  });

  test("「参照」ボタンで picker が開き、fixture ディレクトリの一覧が表示される", async ({ page }) => {
    await setupClean(page);
    await openAddDialog(page);
    await openFolderPicker(page, FIXTURE_ROOT);

    // 現在 path 表示が fixture root
    await expect(page.getByTestId("folder-picker-current-path")).toHaveText(FIXTURE_ROOT);

    // entries: ws-a (workspace), ws-b (workspace), not-a-workspace (dir)
    const entries = page.getByTestId("folder-picker-entry");
    await expect(entries).toHaveCount(3);

    // ws-a / ws-b は isWorkspace=true としてバッジ付き
    await expect(entries.filter({ has: page.locator('[data-is-workspace="true"]') })).toHaveCount(0); // marker on parent
    // 上記が data-attr の継承を取らないので別の方法で確認
    const wsAEntry = entries.filter({ hasText: "ws-a" }).first();
    await expect(wsAEntry).toHaveAttribute("data-is-workspace", "true");
    const wsBEntry = entries.filter({ hasText: "ws-b" }).first();
    await expect(wsBEntry).toHaveAttribute("data-is-workspace", "true");
    const notWsEntry = entries.filter({ hasText: "not-a-workspace" }).first();
    await expect(notWsEntry).toHaveAttribute("data-is-workspace", "false");
  });

  test("フォルダクリックで cd → 「このフォルダを選択」で path 入力欄に反映 → close", async ({ page }) => {
    await setupClean(page);
    await openAddDialog(page);
    await openFolderPicker(page, FIXTURE_ROOT);

    // ws-a クリックで cd
    await page.getByTestId("folder-picker-entry").filter({ hasText: "ws-a" }).first().click();
    await expect(page.getByTestId("folder-picker-current-path")).toHaveText(FIXTURE_WS_A);

    // 「このフォルダを選択」
    await page.getByTestId("folder-picker-select").click();

    // picker が閉じる
    await expect(page.getByTestId("backend-folder-picker-overlay")).toHaveCount(0);

    // path 入力欄に絶対パスが入る
    await expect(page.getByTestId("workspace-path-input")).toHaveValue(FIXTURE_WS_A);

    // debounced auto-inspect が走り status badge が出る
    const badge = page.getByTestId("workspace-status");
    await expect(badge).toBeVisible({ timeout: 5000 });
    // FIXTURE_WS_A は harmony.json があるが minimal schema なので AJV validation は通らない
    // (project schema は project_id / 詳細 meta 等を要求)。実 fixture では invalid になる可能性が
    // 高いが、本 e2e の目的は「picker → 入力欄反映 → inspect 起動」までで十分。
    // status は ready / invalid / needsInit のいずれかであれば picker の wire は成功している。
    await expect(badge).toHaveAttribute("data-status", /ready|invalid|needsInit|notFound/);
  });

  test("「上の階層」で parent に移動", async ({ page }) => {
    await setupClean(page);
    await openAddDialog(page);
    await openFolderPicker(page, FIXTURE_WS_A);

    await expect(page.getByTestId("folder-picker-current-path")).toHaveText(FIXTURE_WS_A);

    await page.getByTestId("folder-picker-up").click();

    await expect(page.getByTestId("folder-picker-current-path")).toHaveText(FIXTURE_ROOT);
  });

  test("外側 overlay クリックで picker close、path は変更されない", async ({ page }) => {
    await setupClean(page);
    await openAddDialog(page);
    const input = page.getByTestId("workspace-path-input");
    await input.fill(FIXTURE_ROOT);
    await page.getByTestId("open-folder-picker").click();
    await expect(page.getByTestId("backend-folder-picker-overlay")).toBeVisible();

    // overlay の左上余白を狙ってクリック (modal 本体ではない位置)
    const overlay = page.getByTestId("backend-folder-picker-overlay");
    const box = await overlay.boundingBox();
    if (!box) throw new Error("overlay bounding box not available");
    await page.mouse.click(box.x + 5, box.y + 5);

    await expect(page.getByTestId("backend-folder-picker-overlay")).toHaveCount(0);
    // path 入力欄は変更されていない
    await expect(input).toHaveValue(FIXTURE_ROOT);
  });
});
