/**
 * step card の marker バッジ表示 (#261)
 *
 * #297 以降は kind 別チップ (.step-marker-chip) 表示に切り替え。
 * このテストは「件数・tooltip・新規追加時の +1」という役割観点は #297 前と同じだが、
 * セレクタを新 UI (.step-marker-chip / .step-marker-badges) に合わせる。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";
import { buildProject, buildProcessFlow } from "./__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../src/types/v3";


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
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const dummyProject = buildProject({
  name: "smb",
  entities: {
    processFlows: [{ id: groupId, no: 1, name: dummyGroup.name, kind: dummyGroup.type, actionCount: 1, updatedAt: FIXED_TS, maturity: "draft" }],
  } as ProjectEntities,
});

async function setup(page: Page) {
  await ws.gotoActive(page, `/process-flow/edit/${normalizeId(groupId)}`);
  await expect(page.locator(".step-editor, .process-flow-content").first()).toBeVisible({ timeout: 10000 });
  // ResumeOrDiscardDialog 遅延表示への retry-loop (#683 edit-session-draft 残骸対応)
  await page.waitForTimeout(500);
  for (let _i = 0; _i < 3; _i++) {
    if (await page.locator(".edit-mode-modal-backdrop").isVisible().catch(() => false)) {
      await page.evaluate(() => (document.querySelector('[data-testid="resume-discard"]') as HTMLButtonElement | null)?.click());
      await page.locator(".edit-mode-modal-backdrop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
    } else {
      break;
    }
  }
  await page.getByTestId("edit-mode-start").click();
  await expect(page.getByTestId("edit-mode-save")).toBeVisible();
}

// realWorkspace 移植 (#926): 実 backend 経由の dummy fixture
// ProcessFlow body は dummyGroup を v3 shape (top-level id + meta) で再利用する。
const baseGroupBody = buildProcessFlow({
  id: groupId,
  name: dummyGroup.name,
  kind: (dummyGroup.type ?? "screen") as Parameters<typeof buildProcessFlow>[0]["kind"],
  mode: "upstream",
  actions: dummyGroup.actions as ReturnType<typeof buildProcessFlow>["actions"],
});
const dummyGroupBody = dummyGroup.markers !== undefined
  ? { ...baseGroupBody, authoring: { markers: dummyGroup.markers } }
  : baseGroupBody;

const WS_KEY = "issue-926-step-marker-badge";
let mcpAvailable = false;
let ws: OpenedWorkspace;

test.beforeAll(async () => {
  mcpAvailable = await isMcpRunning();
});

test.afterAll(async () => {
  if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
});

test.beforeEach(async () => {
  test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    processFlows: [dummyGroupBody],
  });
});
test.describe("step marker badge (#261)", () => {
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
