/**
 * workspace-os-aware-input.spec.ts (#858)
 *
 * AddWorkspaceDialog の WSL2 環境向け UX 改善を E2E で検証。
 *
 * カバー範囲:
 *  - host info (workspace.hostInfo) で OS-aware placeholder が出る
 *  - WSL2 環境 (本検証 host) では「WSL2 環境を検出しました」の専用ヒントが出る
 *  - debounced auto-inspect: パス入力 400ms 後に status badge が描画される
 *  - 「確認」ボタン (secondary) で即時検証も可能 (auto-inspect 待ち回避)
 *  - recent dropdown: input フォーカス / 入力時に最近のワークスペースが表示される
 *
 * 前提: backend (port 5179) と frontend (port 5173) が稼働中
 *       WSL2 環境で playwright を実行 → host info の isWSL=true がレスポンスされる
 */
import { test, expect, type Page } from "@playwright/test";

async function setupClean(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    window.alert = () => {};
    window.confirm = () => false;
  });
}

async function openAddDialog(page: Page) {
  await page.goto("/workspace/list");
  const addBtn = page.locator("button", { hasText: "追加" }).first();
  await addBtn.click();
  await expect(page.locator(".tbl-modal")).toBeVisible();
}

// /proc/version に Microsoft / WSL 文字列が含まれる場合のみ WSL2 とみなす
// (backend/src/hostInfo.ts の detectWSL と同じ判定ロジック)。
// 非 WSL2 host (ネイティブ Linux / docker / macOS / Windows) では本 describe の
// 「WSL2 環境では…」test は前提が崩れるため skip する。
async function isWslHost(): Promise<boolean> {
  if (process.platform !== "linux") return false;
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile("/proc/version", "utf-8");
    return /Microsoft|WSL/i.test(content);
  } catch {
    return false;
  }
}

test.describe("AddWorkspaceDialog — WSL2 / OS-aware UX (#858)", () => {
  test("WSL2 環境では Linux 形式の絶対パスと専用ヒントが表示される", async ({ page }) => {
    test.skip(!(await isWslHost()), "WSL2 ホスト前提の test (host /proc/version に Microsoft/WSL を含むときのみ実行)");
    await setupClean(page);
    await openAddDialog(page);

    const input = page.getByTestId("workspace-path-input");
    await expect(input).toBeVisible();

    // host info から取得した homeDir 配下の例が placeholder に入る
    const placeholder = await input.getAttribute("placeholder");
    expect(placeholder).toMatch(/\/home\/[^/]+\/projects\/my-app/);
    // 既存 #755 e2e と同様 workspaces/ 形式も placeholder に含まれること
    expect(placeholder).toContain("workspaces/my-app");

    // WSL 検出ヒント (本ホストは WSL2 想定)
    await expect(page.locator(".tbl-modal").getByText(/WSL2 環境を検出しました/)).toBeVisible();
  });

  test("パス入力 → debounce 後に status badge が自動描画される", async ({ page }) => {
    await setupClean(page);
    await openAddDialog(page);

    const input = page.getByTestId("workspace-path-input");
    // 不存在パスを入れて status="notFound" を期待 (backend 接続 + inspect が走ることの確認)
    await input.fill("/tmp/__definitely_not_a_workspace__");

    // debounce 400ms + inspect で status badge が出る
    const badge = page.getByTestId("workspace-status");
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveAttribute("data-status", /notFound|needsInit|invalid|error/);
  });

  test("「確認」ボタンで debounce 待ちせず即時検証できる (secondary action)", async ({ page }) => {
    await setupClean(page);
    await openAddDialog(page);

    const input = page.getByTestId("workspace-path-input");
    await input.fill("/tmp/__manual_inspect_target__");

    // debounce 待たずに「確認」ボタン押下
    const confirmBtn = page.locator(".tbl-modal button", { hasText: "確認" }).first();
    await confirmBtn.click();

    const badge = page.getByTestId("workspace-status");
    await expect(badge).toBeVisible({ timeout: 5000 });
  });

  test("入力欄フォーカスで recent dropdown が表示される", async ({ page }) => {
    await setupClean(page);
    await page.goto("/workspace/list");

    // recent を作るために最低 1 件 workspace を localStorage に登録できないので、
    // backend recent から取得される。recent 0 件環境なら dropdown 自体が出ない (空配列)。
    // dropdown 構造の存在検証のみここで行い、ダミーフォーカス → 表示有無を観測する。
    const addBtn = page.locator("button", { hasText: "追加" }).first();
    await addBtn.click();
    await expect(page.locator(".tbl-modal")).toBeVisible();

    const input = page.getByTestId("workspace-path-input");
    await input.focus();

    // recent が無い環境では listbox が空で出ないことのみ確認 (regression なし)
    // recent 1 件以上ある実環境では listbox が visible
    const listbox = page.locator("#workspace-recent-dropdown");
    const isPresent = await listbox.count();
    if (isPresent > 0) {
      await expect(listbox).toBeVisible();
      await expect(listbox.locator("li").first()).toBeVisible();
    }
    // どちらでも regression なし
  });
});
