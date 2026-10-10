/**
 * 画面 ID の改名が、独自部品の定義 (layout-components.json) の差し込み口 (種類 = 画面) に追従し、
 * 開いている独自部品の管理画面にも知らせる (古い値のまま保存して、改名を巻き戻さないため)。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { openBrowserSessionWorkspace, closeBrowserSession, sendBrowserRequest, observeBroadcastDuring } from "./mcp/_helpers";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, type OpenedWorkspace } from "./helpers/realWorkspace";

test.describe.configure({ mode: "serial" });

const KEY = `rename-lc-${Date.now()}`;
let ws: OpenedWorkspace;

test.describe("画面の改名と独自部品", () => {
  test.beforeAll(async () => {
    test.skip(!(await isMcpRunning()), "backend 未起動");
    ws = await setupTestWorkspace({ key: KEY, fromExample: "retail" });
  });
  test.afterAll(async () => { await closeBrowserSession(); await cleanupRealWorkspaces([KEY]); });

  test("画面を改名すると、独自部品の差し込み口 (種類 = 画面) の既定値が追従し、layoutComponentsChanged が届く @regression", async () => {
    const file = path.join(ws.workspacePath, "harmony", "layout-components.json");
    const doc = JSON.parse(await fs.readFile(file, "utf-8")) as { components: Array<{ id: string; params: Array<{ id: string; kind: string; default?: string }> }> };
    doc.components.push({
      id: "back-link", label: "戻るリンク",
      params: [{ id: "target", label: "遷移先", kind: "screen", default: "cart" }, { id: "caption", label: "文言", kind: "text", default: "cart" }],
      nodes: [{ id: "n", type: "link", props: { label: "{{caption}}", screenRef: "{{target}}" } }],
    } as never);
    await fs.writeFile(file, JSON.stringify(doc, null, 2));

    await openBrowserSessionWorkspace(ws.workspacePath);
    const { broadcast } = await observeBroadcastDuring(ws.workspacePath, "layoutComponentsChanged", () =>
      sendBrowserRequest("renameEntityId", { entityType: "screen", oldId: "cart", newId: "cart-renamed-lc" }));
    expect(broadcast).toMatchObject({ reload: true });

    const after = JSON.parse(await fs.readFile(file, "utf-8")) as typeof doc;
    const def = after.components.find((c) => c.id === "back-link")!;
    expect(def.params.find((p) => p.id === "target")!.default).toBe("cart-renamed-lc");
    expect(def.params.find((p) => p.id === "caption")!.default).toBe("cart"); // 文言は触れない
  });
});
