/**
 * StepCard の kind 別マーカーバッジ (#261)
 *
 * StepCard ヘッダに todo/question/attention/chat 各色のチップが表示されることを検証。
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-stepchip";

const dummyGroup = {
  id: groupId, name: "stepchip test", type: "screen", description: "",
  mode: "upstream", maturity: "draft",
  actions: [{
    id: "act-1", name: "ボタン", trigger: "click", maturity: "draft",
    responses: [{ id: "201-ok", status: 201 }],
    steps: [
      { id: "s1", type: "validation", description: "チェック", conditions: "", maturity: "draft" },
      { id: "s2", type: "compute", description: "計算", expression: "", maturity: "draft" },
    ],
  }],
  markers: [
    // s1 に 3 kind (todo ×2, question ×1, attention ×1)
    { id: "m1", kind: "todo", body: "A", stepId: "s1", author: "human", createdAt: "2026-04-20T00:00:00Z" },
    { id: "m2", kind: "todo", body: "B", stepId: "s1", author: "human", createdAt: "2026-04-20T00:00:00Z" },
    { id: "m3", kind: "question", body: "?", stepId: "s1", author: "human", createdAt: "2026-04-20T00:00:00Z" },
    { id: "m4", kind: "attention", body: "!", stepId: "s1", author: "human", createdAt: "2026-04-20T00:00:00Z" },
    // resolved は除外される
    { id: "m5", kind: "todo", body: "done", stepId: "s1", author: "human", createdAt: "2026-04-20T00:00:00Z", resolvedAt: "2026-04-20T01:00:00Z" },
    // s2 には未解決 marker なし (バッジなし)
  ],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const dummyProject = {
  version: 1, name: "stepchip", screens: [], groups: [], edges: [], tables: [],
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

test.describe("StepCard kind 別マーカーバッジ (#261)", () => {
  test("s1 に todo/question/attention 色分けチップが表示される", async ({ page }) => {
    await setup(page);
    // s1 の StepCard ヘッダ内に step-marker-chip 要素あり
    const chips = page.locator(".step-card").filter({ hasText: "チェック" }).locator(".step-marker-chip");
    // 3 種類 (chat は 0 件なので表示されない)
    await expect(chips).toHaveCount(3);
    // todo は 2、question/attention は 1
    await expect(chips.filter({ has: page.locator(".bi-robot") })).toContainText("2");
    await expect(chips.filter({ has: page.locator(".bi-question-circle-fill") })).toContainText("1");
    await expect(chips.filter({ has: page.locator(".bi-exclamation-triangle-fill") })).toContainText("1");
  });

  test("s2 (未解決なし) にはバッジ表示なし", async ({ page }) => {
    await setup(page);
    const s2Card = page.locator(".step-card").filter({ hasText: "計算" });
    await expect(s2Card.locator(".step-marker-chip")).toHaveCount(0);
    await expect(s2Card.locator(".step-marker-badge")).toHaveCount(0);
  });

  test("resolved marker はカウントに含まれない (todo が 2、3 にならない)", async ({ page }) => {
    await setup(page);
    const todoChip = page.locator(".step-card").filter({ hasText: "チェック" })
      .locator(".step-marker-chip.kind-todo");
    await expect(todoChip).toContainText("2");
    await expect(todoChip).not.toContainText("3");
  });
});
