/**
 * 警告 → Marker 1-click 起票 (#261)
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-w2m";

const dummyGroup = {
  id: groupId, name: "w2m test", type: "screen", description: "",
  mode: "upstream", maturity: "draft",
  actions: [{
    id: "act-1", name: "ボタン", trigger: "click", maturity: "draft",
    responses: [{ id: "201-ok", status: 201 }],
    steps: [
      // 意図的に警告を出す step (未定義 @ 参照)
      { id: "s1", type: "compute", description: "", expression: "@undefVar * 2", outputBinding: "r", maturity: "draft" },
      { id: "s2", type: "return", description: "", responseRef: "404-missing", maturity: "draft" },
    ],
  }],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const dummyProject = {
  version: 1, name: "w2m", screens: [], groups: [], edges: [], tables: [],
  processFlows: [{ id: groupId, no: 1, name: dummyGroup.name, type: dummyGroup.type, actionCount: 1, updatedAt: dummyGroup.updatedAt, maturity: "draft" }],
  updatedAt: new Date().toISOString(),
};

async function setup(page: Page) {
  await page.addInitScript(({ project, group }) => {
    localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem(`process-flow-${group.id}`, JSON.stringify(group));
    localStorage.removeItem("harmony-open-tabs");
    localStorage.removeItem("harmony-active-tab");
  }, { project: dummyProject, group: dummyGroup });
  await page.goto(`/process-flow/edit/${groupId}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
}

test.describe("警告 → Marker 起票 (#261)", () => {
  test("警告パネル内の AI に依頼ボタンで marker 作成", async ({ page }) => {
    await setup(page);
    // 警告バッジが出ていること
    await page.locator(".validation-badge.warning").click();
    const panel = page.locator(".process-flow-validation-panel");
    await expect(panel).toBeVisible();

    // UNKNOWN_IDENTIFIER 警告の行で AI に依頼
    await page.evaluate(() => {
      const btn = document.querySelector(".process-flow-validation-panel .validation-ask-ai-btn");
      btn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });

    // MarkerPanel は既定折りたたみなので展開して確認
    await page.locator(".marker-panel .catalog-panel-toggle").click();

    // marker が 1 件起票
    await expect(page.locator(".marker-panel .marker-row")).toHaveCount(1);
    await expect(page.locator(".marker-panel .marker-kind-badge")).toContainText("TODO");
    await expect(page.locator(".marker-panel .marker-body")).toContainText("警告解消");

    // 同じボタンは「依頼済」表示で disabled
    const askedBtn = panel.locator(".validation-ask-ai-btn").first();
    await expect(askedBtn).toContainText("依頼済");
    await expect(askedBtn).toBeDisabled();
  });

  test("全て AI に依頼で複数起票", async ({ page }) => {
    await setup(page);
    await page.locator(".validation-badge.warning").click();
    page.on("dialog", (d) => d.accept());
    await page.evaluate(() => {
      document.querySelector(".process-flow-validation-panel-bulk-ai")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    // MarkerPanel 展開
    await page.locator(".marker-panel .catalog-panel-toggle").click();
    // 警告は少なくとも 2 件起票される (UNKNOWN_IDENTIFIER + UNKNOWN_RESPONSE_REF)
    const rows = await page.locator(".marker-panel .marker-row").count();
    expect(rows).toBeGreaterThanOrEqual(2);
  });

  test("既に marker 起票済の警告は重複起票ガードで disabled", async ({ page }) => {
    await setup(page);
    await page.locator(".validation-badge.warning").click();
    await page.evaluate(() => {
      document.querySelector(".process-flow-validation-panel .validation-ask-ai-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });

    // パネルを閉じて開き直し、disabled のまま
    await page.locator(".validation-badge.warning").click();
    await page.waitForTimeout(200);
    await page.locator(".validation-badge.warning").click();
    const btn = page.locator(".validation-ask-ai-btn").first();
    await expect(btn).toBeDisabled();
  });
});
