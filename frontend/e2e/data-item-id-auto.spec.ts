/**
 * GrapesJS 部品配置時の name / id / data-item-id 自動入力 E2E (#328, #331)
 *
 * #926: realWorkspace + 実 backend 経由に移植。
 */
import { test, expect, type Page } from "@playwright/test";
import {
  setupTestWorkspace,
  cleanupRealWorkspaces,
  isMcpRunning,
  normalizeId,
  type OpenedWorkspace,
} from "./helpers/realWorkspace";

const SCREEN_ID = "aaaaaaaa-0001-4000-8000-aaaaaaaaaaaa";
const SCREEN_NORM = normalizeId(SCREEN_ID);

const dummyProject = {
  version: 1, name: "data-item-id-auto-test",
  screens: [{ id: SCREEN_ID, no: 1, name: "テスト画面", kind: "form", path: "/test", hasDesign: true }],
  groups: [], edges: [], tables: [], processFlows: [],
};

const emptyScreen = {
  dataSources: [], assets: [], styles: [],
  pages: [{ frames: [{ component: { type: "wrapper", components: "<div></div>" }, id: "fr-auto-0001" }], type: "main", id: "pg-auto-0001" }],
  symbols: [],
};

const dummyTab = { id: `design:${SCREEN_NORM}`, type: "design", resourceId: SCREEN_NORM, label: "テスト画面", isDirty: false, isPinned: false };

const WS_KEY = "issue-926-data-item-id-auto";
let mcpAvailable = false;
let ws: OpenedWorkspace;

async function setupDesigner(page: Page) {
  ws = await setupTestWorkspace({
    key: WS_KEY,
    project: dummyProject,
    screenDesigns: [{ id: SCREEN_ID, data: emptyScreen }],
  });
  await page.addInitScript((tab) => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
    localStorage.setItem("harmony-active-tab", tab.id);
  }, dummyTab);
  await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);
  await expect(page.locator(".gjs-frame")).toBeVisible({ timeout: 15000 });
  // edit-mode-start クリックして editing に入る (DomComponents.addComponent が可能になる)
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
  const editStart = page.getByTestId("edit-mode-start");
  if (await editStart.isVisible({ timeout: 1000 }).catch(() => false)) {
    await editStart.click();
  }
  await page.waitForFunction(() => !!(window as unknown as { editor?: unknown }).editor, { timeout: 15000 });
}

type GEditor = {
  DomComponents: {
    addComponent: (def: Record<string, unknown>) => {
      getAttributes: () => Record<string, string>;
    };
  };
};

test.describe("部品配置時 name / id / data-item-id 自動入力 (#328, #331)", () => {
  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
  });

  test.afterAll(async () => {
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    test.skip(!mcpAvailable, "backend (port 5179) が起動していません");
  });

  test("input[text] を追加すると textInput1 / data-item-id が付与される", async ({ page }) => {
    await setupDesigner(page);
    const attrs = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found on window.editor");
      const cmp = editor.DomComponents.addComponent({ tagName: "input", attributes: { type: "text", class: "form-control" } });
      return cmp.getAttributes();
    });
    expect(attrs["data-item-id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(attrs.name).toBe("textInput1");
    expect(attrs.id).toBe("textInput1");
  });

  test("2 つ目の input[text] は textInput2 になる", async ({ page }) => {
    await setupDesigner(page);
    const result = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found");
      editor.DomComponents.addComponent({ tagName: "input", attributes: { type: "text", class: "form-control" } });
      const cmp2 = editor.DomComponents.addComponent({ tagName: "input", attributes: { type: "text", class: "form-control" } });
      return cmp2.getAttributes();
    });
    expect(result.name).toBe("textInput2");
  });

  test("種別が異なる場合は独立した連番 (textInput1 + button1)", async ({ page }) => {
    await setupDesigner(page);
    const result = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found");
      editor.DomComponents.addComponent({ tagName: "input", attributes: { type: "text", class: "form-control" } });
      const btn = editor.DomComponents.addComponent({ tagName: "button", attributes: { type: "button", class: "btn btn-primary" } });
      return btn.getAttributes();
    });
    expect(result.name).toBe("button1");
  });

  test("既に name がある input を追加しても name は上書きされない", async ({ page }) => {
    await setupDesigner(page);
    const attrs = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found");
      const cmp = editor.DomComponents.addComponent({ tagName: "input", attributes: { type: "text", name: "existing_name" } });
      return cmp.getAttributes();
    });
    expect(attrs.name).toBe("existing_name");
    expect(attrs["data-item-id"]).toBeTruthy();
  });

  test("button type の input には属性付与されない", async ({ page }) => {
    await setupDesigner(page);
    const attrs = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found");
      const cmp = editor.DomComponents.addComponent({ tagName: "input", attributes: { type: "button", value: "送信" } });
      return cmp.getAttributes();
    });
    expect(attrs["data-item-id"]).toBeFalsy();
    expect(attrs.name).toBeFalsy();
  });

  test("select に select1 が付与される", async ({ page }) => {
    await setupDesigner(page);
    const attrs = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found");
      const cmp = editor.DomComponents.addComponent({ tagName: "select" });
      return cmp.getAttributes();
    });
    expect(attrs.name).toBe("select1");
  });

  test("checkbox に checkbox1 が付与される", async ({ page }) => {
    await setupDesigner(page);
    const attrs = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found");
      const cmp = editor.DomComponents.addComponent({ tagName: "input", attributes: { type: "checkbox" } });
      return cmp.getAttributes();
    });
    expect(attrs.name).toBe("checkbox1");
  });
});
