/**
 * 業務フロー (スイムレーン) の E2E。
 *
 * - 一覧: 新規作成 → 編集画面へ
 * - 編集: 工程を追加してつなぎ、保存 → 原本 JSON に反映 / 開いただけでは原本が変わらない
 * - サンプル (retail) の業務フローを開ける / 設計書に章が出る
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `business-flow-${Date.now()}`;
let ws: OpenedWorkspace;
const flowFile = (id: string) => path.join(ws.workspacePath, "harmony", "business-flows", `${id}.json`);
const readFlow = async (id: string) => JSON.parse(await fs.readFile(flowFile(id), "utf-8"));

async function openEditor(page: Page, id: string) {
  await ws.gotoActive(page, `/business-flow/edit/${id}`);
  await expect(page.getByTestId("business-flow-editor")).toBeVisible({ timeout: 15000 });
}

test.describe("業務フロー", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await cleanupRealWorkspaces([KEY]); });
  test.afterEach(async () => { await ws?.resetRuntimeState(); });

  test("サンプルの業務フローを開いても原本が変わらず、図に工程が出る @regression", async ({ page }) => {
    const before = await fs.readFile(flowFile("order-to-shipment"), "utf-8");
    await openEditor(page, "order-to-shipment");
    await expect(page.getByTestId("bf-step-search")).toBeVisible();
    await expect(page.getByTestId("bf-step-dispatch")).toBeVisible();
    await expect(page.getByTestId("bf-dirty")).toHaveCount(0);
    await page.getByTestId("bf-step-search").click();
    await expect(page.getByTestId("bf-step-inspector")).toBeVisible();
    await expect(page.getByTestId("bf-step-name")).toHaveValue("商品を検索する");
    expect(await fs.readFile(flowFile("order-to-shipment"), "utf-8")).toBe(before);
  });

  test("図を縮小・全体表示できる @regression", async ({ page }) => {
    await openEditor(page, "order-to-shipment");
    await expect(page.getByTestId("bf-zoom-val")).toHaveText("100%");
    await page.getByTestId("bf-zoom-out").click();
    await expect(page.getByTestId("bf-zoom-val")).toHaveText("90%");
    await page.getByTestId("bf-zoom-fit").click();
    const fitted = Number((await page.getByTestId("bf-zoom-val").innerText()).replace("%", ""));
    expect(fitted).toBeLessThan(90);
    expect(fitted).toBeGreaterThanOrEqual(40);
  });

  test("一覧から新規作成し、工程を足してつなぎ、保存できる @regression", async ({ page }) => {
    await ws.gotoActive(page, "/business-flow/list");
    await expect(page.getByTestId("business-flow-list")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("bf-add").click();
    await page.getByTestId("bf-add-name").fill("返品の流れ");
    await page.locator("#bf-add-id").fill("return-flow");
    await page.getByTestId("bf-add-submit").click();
    await expect(page.getByTestId("business-flow-editor")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("bf-name")).toHaveValue("返品の流れ");

    // 開始を選び、「次の工程を追加」で作業をつなぐ
    await page.getByTestId("bf-step-start").click();
    await page.getByTestId("bf-add-following").click();
    await page.getByTestId("bf-step-name").fill("返品を受け付ける");
    await expect(page.getByTestId("bf-dirty")).toBeVisible();
    // 作業 → 終了 をつなぐ
    await page.getByTestId("bf-add-next").click();
    await page.getByTestId("bf-save").click();
    await expect.poll(async () => (await readFlow("return-flow")).steps.length, { timeout: 10000 }).toBe(3);
    const f = await readFlow("return-flow");
    expect(f.$schema).toContain("business-flow.v3.schema.json");
    const task = f.steps.find((s: { name: string }) => s.name === "返品を受け付ける");
    expect(task).toMatchObject({ kind: "task", lane: "lane1" });
    expect(task.next?.length).toBeGreaterThanOrEqual(1);
    expect(f.steps.find((s: { id: string }) => s.id === "start").next.map((n: { to: string }) => n.to)).toContain(task.id);
    await expect(page.getByTestId("bf-dirty")).toHaveCount(0);
  });

  test("レーンを足して工程を移し、判断の分岐に条件を付けられる / 画面と処理を割り当てられる @regression", async ({ page }) => {
    await openEditor(page, "return-flow");
    await page.getByTestId("bf-add-lane").click();
    await page.getByTestId("bf-lane-name").fill("店舗");
    await page.getByTestId("bf-lane-role").selectOption("staff");
    await page.getByTestId("bf-list-step-start").click();
    await page.getByTestId("bf-add-decision").click();
    await page.getByTestId("bf-step-name").fill("返品可能?");
    const lane = page.getByTestId("bf-step-lane");
    await lane.selectOption({ label: "店舗" });
    await page.getByTestId("bf-step-screen").selectOption("order-list");
    await page.getByTestId("bf-step-flow").selectOption("order-confirm");
    await page.getByTestId("bf-save").click();
    await expect.poll(async () => (await readFlow("return-flow")).lanes.length, { timeout: 10000 }).toBe(2);
    const f = await readFlow("return-flow");
    expect(f.lanes[1]).toMatchObject({ name: "店舗", roleRef: "staff" });
    const d = f.steps.find((s: { name: string }) => s.name === "返品可能?");
    expect(d).toMatchObject({ kind: "decision", lane: f.lanes[1].id, screenRef: "order-list", processFlowRef: "order-confirm" });
  });

  test("変更は元に戻せ、破棄で保存済みの状態に戻る @regression", async ({ page }) => {
    await openEditor(page, "return-flow");
    const count = (await readFlow("return-flow")).steps.length;
    await page.getByTestId("bf-add-task").click();
    await expect(page.getByTestId("bf-dirty")).toBeVisible();
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByTestId("bf-dirty")).toHaveCount(0);
    await page.getByTestId("bf-add-task").click();
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("bf-discard").click();
    await expect(page.getByTestId("bf-dirty")).toHaveCount(0);
    expect((await readFlow("return-flow")).steps.length).toBe(count);
  });

  test("設計書に「業務フロー」の章 (図と工程表) が出る @regression", async ({ page }) => {
    await ws.gotoActive(page, "/document");
    await expect(page.locator("#business-flows")).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".hd-bf .bf-svg").first()).toBeVisible();
    await expect(page.locator("#access")).toBeVisible();
  });
});
