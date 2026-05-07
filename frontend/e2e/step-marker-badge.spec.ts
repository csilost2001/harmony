/**
 * step card の marker バッジ表示 (#261)
 *
 * #297 以降は kind 別チップ (.step-marker-chip) 表示に切り替え。
 * このテストは「件数・tooltip・新規追加時の +1」という役割観点は #297 前と同じだが、
 * セレクタを新 UI (.step-marker-chip / .step-marker-badges) に合わせる。
 */
/**
 * TODO(#926 follow-up): realWorkspace 移植が未完。本 spec は既存の addInitScript-based
 * localStorage seed パターンを使っているが、#924 で fallback 経路が削除されたため
 * data が backend に渡らず動作しない。realWorkspace.setupTestWorkspace + ws.gotoActive
 * への移植を follow-up ISSUE で対応する。
 */
import { test, expect, type Page } from "@playwright/test";

const groupId = "ag-smb";

const dummyGroup = {
  id: groupId, name: "smb", type: "screen", description: "",
  mode: "upstream", maturity: "draft",
  actions: [{
    id: "act-1", name: "ボタン", trigger: "click", maturity: "draft",
    responses: [{ id: "201-ok", status: 201 }],
    steps: [
      { id: "s1", type: "validation", description: "check1", conditions: "", maturity: "draft" },
      { id: "s2", type: "dbAccess", description: "query", tableName: "x", operation: "SELECT", maturity: "draft" },
    ],
  }],
  markers: [
    { id: "m1", kind: "todo", body: "A を修正して", stepId: "s1", author: "human", createdAt: "2026-04-21T00:00:00Z" },
    { id: "m2", kind: "attention", body: "B を確認", stepId: "s1", author: "human", createdAt: "2026-04-21T00:00:00Z" },
    { id: "m3", kind: "question", body: "C?", stepId: "s2", author: "human", createdAt: "2026-04-21T00:00:00Z" },
    { id: "m4", kind: "chat", body: "解決済み", stepId: "s1", author: "human", createdAt: "2026-04-21T00:00:00Z", resolvedAt: "2026-04-21T01:00:00Z" },
    { id: "m5", kind: "chat", body: "グループ宛", author: "human", createdAt: "2026-04-21T00:00:00Z" },
  ],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};
const dummyProject = {
  version: 1, name: "smb", screens: [], groups: [], edges: [], tables: [],
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

test.describe.skip("step marker badge (#261)", () => {
  test("step-card に未解決 marker の kind 別チップが出る (解決済みは除外)", async ({ page }) => {
    await setup(page);

    // s1: 未解決 2 件 (todo 1 + attention 1)、m4 (resolved) 除外
    const s1Chips = page.locator(".step-card").nth(0).locator(".step-marker-chip");
    await expect(s1Chips).toHaveCount(2);
    await expect(page.locator(".step-card").nth(0).locator(".step-marker-chip.kind-todo")).toContainText("1");
    await expect(page.locator(".step-card").nth(0).locator(".step-marker-chip.kind-attention")).toContainText("1");
    // s1 に chat は無い (m4 は resolved、m5 は group 宛)
    await expect(page.locator(".step-card").nth(0).locator(".step-marker-chip.kind-chat")).toHaveCount(0);

    // s2: 未解決 1 件 (question)
    const s2Chips = page.locator(".step-card").nth(1).locator(".step-marker-chip");
    await expect(s2Chips).toHaveCount(1);
    await expect(page.locator(".step-card").nth(1).locator(".step-marker-chip.kind-question")).toContainText("1");
  });

  test("tooltip (title 属性) に kind + body 抜粋が含まれる", async ({ page }) => {
    await setup(page);
    // .step-marker-badges (コンテナ) の title に全件まとめ
    const title = await page.locator(".step-card").nth(0).locator(".step-marker-badges").getAttribute("title");
    expect(title).toContain("AI 依頼マーカー 2 件");
    expect(title).toContain("todo");
    expect(title).toContain("attention");
    expect(title).toContain("A を修正");
  });

  test("AI に指摘 で新規 marker 追加後チップ件数が +1 される", async ({ page }) => {
    await setup(page);
    page.on("dialog", async (d) => { if (d.type() === "prompt") await d.accept("新規指摘"); });
    await page.evaluate(() => {
      const card = document.querySelectorAll(".step-card")[1]; // s2
      const dots = Array.from(card.querySelectorAll(".step-card-menu-btn")).find(b => b.querySelector(".bi-three-dots"));
      dots?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".step-context-menu-item"));
      items.find(i => i.textContent?.includes("AI に指摘"))?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForTimeout(300);
    // 追加された marker は kind=todo (「AI に指摘」の既定) → s2 の todo チップが 1 件増える
    // 元は question 1 件のみだったので、追加後 todo 1 + question 1 = 2 チップ
    await expect(page.locator(".step-card").nth(1).locator(".step-marker-chip")).toHaveCount(2);
    await expect(page.locator(".step-card").nth(1).locator(".step-marker-chip.kind-todo")).toContainText("1");
    await expect(page.locator(".step-card").nth(1).locator(".step-marker-chip.kind-question")).toContainText("1");
  });
});
