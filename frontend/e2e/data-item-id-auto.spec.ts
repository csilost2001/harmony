/**
 * GrapesJS 部品配置時の name / id / data-item-id 自動入力 E2E (#328, #331)
 *
 * Designer に input/button ブロックをプログラム的に追加し、
 * ensureFormFieldIdentity() が自動で種別+連番形式の属性を付与することを検証する。
 * window.editor が GrapesJS editor を公開している前提 (Designer.tsx)。
 */
import { test, expect, type Page } from "@playwright/test";

const SCREEN_ID = "aaaaaaaa-0001-4000-8000-aaaaaaaaaaaa";

const dummyProject = {
  version: 1,
  name: "data-item-id-auto-test",
  screens: [
    {
      id: SCREEN_ID,
      no: 1,
      name: "テスト画面",
      type: "standard",
      updatedAt: new Date().toISOString(),
    },
  ],
  groups: [],
  edges: [],
  tables: [],
  processFlows: [],
  updatedAt: new Date().toISOString(),
};

const emptyScreen = {
  dataSources: [],
  assets: [],
  styles: [],
  pages: [
    {
      frames: [
        {
          component: { type: "wrapper", components: "<div></div>" },
          id: "fr-auto-0001",
        },
      ],
      type: "main",
      id: "pg-auto-0001",
    },
  ],
  symbols: [],
};

async function setupDesigner(page: Page) {
  const tab = {
    id: `design:${SCREEN_ID}`,
    type: "design",
    resourceId: SCREEN_ID,
    label: "テスト画面",
    isDirty: false,
    isPinned: false,
  };

  await page.addInitScript(
    ({ project, screenId, tab, screenData }) => {
      localStorage.setItem("workspace-e2e-bypass", "true");
      localStorage.setItem("flow-project", JSON.stringify(project));
      localStorage.setItem(`gjs-screen-${screenId}`, JSON.stringify(screenData));
      localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
      localStorage.setItem("harmony-active-tab", tab.id);
      localStorage.removeItem(`gjs-screen-${screenId}-draft`);
    },
    { project: dummyProject, screenId: SCREEN_ID, tab, screenData: emptyScreen },
  );

  await page.goto(`/screen/design/${SCREEN_ID}`);
  await expect(page.locator(".gjs-frame")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => !!(window as unknown as { editor?: unknown }).editor, {
    timeout: 15000,
  });
}

type GEditor = {
  DomComponents: {
    addComponent: (def: Record<string, unknown>) => {
      getAttributes: () => Record<string, string>;
    };
  };
};

test.describe("部品配置時 name / id / data-item-id 自動入力 (#328, #331)", () => {
  test("input[text] を追加すると textInput1 / data-item-id が付与される", async ({ page }) => {
    await setupDesigner(page);

    const attrs = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found on window.editor");
      const cmp = editor.DomComponents.addComponent({
        tagName: "input",
        attributes: { type: "text", class: "form-control" },
      });
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
      editor.DomComponents.addComponent({
        tagName: "input",
        attributes: { type: "text", class: "form-control" },
      });
      const cmp2 = editor.DomComponents.addComponent({
        tagName: "input",
        attributes: { type: "text", class: "form-control" },
      });
      return cmp2.getAttributes();
    });

    expect(result.name).toBe("textInput2");
  });

  test("種別が異なる場合は独立した連番 (textInput1 + button1)", async ({ page }) => {
    await setupDesigner(page);

    const result = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found");
      editor.DomComponents.addComponent({
        tagName: "input",
        attributes: { type: "text", class: "form-control" },
      });
      const btn = editor.DomComponents.addComponent({
        tagName: "button",
        attributes: { type: "button", class: "btn btn-primary" },
      });
      return btn.getAttributes();
    });

    expect(result.name).toBe("button1");
  });

  test("既に name がある input を追加しても name は上書きされない", async ({ page }) => {
    await setupDesigner(page);

    const attrs = await page.evaluate(() => {
      const editor = (window as unknown as { editor?: GEditor }).editor;
      if (!editor) throw new Error("GrapesJS editor not found");
      const cmp = editor.DomComponents.addComponent({
        tagName: "input",
        attributes: { type: "text", name: "existing_name" },
      });
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
      const cmp = editor.DomComponents.addComponent({
        tagName: "input",
        attributes: { type: "button", value: "送信" },
      });
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
      const cmp = editor.DomComponents.addComponent({
        tagName: "input",
        attributes: { type: "checkbox" },
      });
      return cmp.getAttributes();
    });

    expect(attrs.name).toBe("checkbox1");
  });
});
