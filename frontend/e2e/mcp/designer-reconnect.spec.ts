/**
 * Designer MCP reconnect / screenChanged broadcast 動作の E2E テスト (#578 / #948)。
 *
 * #948: 旧 FakeWebSocket + localStorage seed 駆動の legacy パターンは
 * #683 (real backend 必須) + #924 (localStorage fallback なし) で動作不能になったため、
 * realWorkspace fixture + 永続 WS (sendBrowserRequest, #958) で全面書き直し。
 *
 * 検証する挙動:
 * 1. MCP 再接続時に editor.load が呼ばれない (unnecessary reload を起こさない)
 * 2. screenChanged broadcast 受信時に editor.reload() で canvas を更新
 */
import { test, expect, type Page } from "@playwright/test";
import { setupTestWorkspace, cleanupRealWorkspaces, isMcpRunning, normalizeId, type OpenedWorkspace } from "../helpers/realWorkspace";
import { sendBrowserRequest, openBrowserSessionWorkspace, closeBrowserSession } from "./_helpers";
import { buildProject } from "../__fixtures__/builders";
import type { ProjectEntities, Timestamp } from "../../src/types/v3";

// RFC #1284 / I-7: top-level entity id は kebab-case EntityId (UUID-like reject)
const SCREEN_ID = "mcp-reconnect-screen";
const SCREEN_NORM = normalizeId(SCREEN_ID);
const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

const initialScreen = {
  dataSources: [],
  assets: [],
  styles: [],
  pages: [{
    frames: [{
      component: { type: "wrapper", components: "<main><h1>Initial server HTML</h1></main>" },
      id: "frame-initial",
    }],
    id: "page-initial",
    type: "main",
  }],
  symbols: [],
};

const changedScreen = {
  dataSources: [],
  assets: [],
  styles: [],
  pages: [{
    frames: [{
      component: { type: "wrapper", components: "<main><h1>Changed by server broadcast</h1></main>" },
      id: "frame-changed",
    }],
    id: "page-changed",
    type: "main",
  }],
  symbols: [],
};

const project = buildProject({
  name: "issue-578-designer-reconnect",
  entities: {
    screens: [{ id: SCREEN_ID, no: 1, name: "Issue 578 Designer", path: "/issue-578", kind: "form", hasDesign: true, updatedAt: FIXED_TS }],
  } as ProjectEntities,
});

const dummyTab = {
  id: `design:${SCREEN_NORM}`,
  type: "design",
  resourceId: SCREEN_NORM,
  label: "Issue 578 Designer",
  isDirty: false,
  isPinned: false,
};

const WS_KEY = "issue-578-designer-reconnect";

async function setupDesigner(page: Page, ws: OpenedWorkspace): Promise<void> {
  await page.addInitScript((tab) => {
    localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
    localStorage.setItem("harmony-active-tab", tab.id);
  }, dummyTab);
  await ws.gotoActive(page, `/screen/design/${SCREEN_NORM}`);

  // edit-mode-start (= Designer 起動成功) + editor global expose を待つ
  await expect(page.getByTestId("edit-mode-start")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const w = window as unknown as { editor?: { getHtml: () => string } };
    return !!w.editor && typeof w.editor.getHtml === "function";
  }, { timeout: 15000 });

  // initial server HTML 描画完了を確認
  await page.waitForFunction(() => {
    const w = window as unknown as { editor?: { getHtml: () => string } };
    return w.editor?.getHtml().includes("Initial server HTML");
  }, { timeout: 15000 });

  // editor.loadProjectData を override してカウント (#815 PR-C で reload は loadProjectData ベース)
  await page.evaluate(() => {
    const w = window as unknown as {
      editor?: { loadProjectData: (...args: unknown[]) => unknown };
      __e2eLoadCalls?: number;
    };
    if (!w.editor) throw new Error("GrapesJS editor not found");
    const original = w.editor.loadProjectData.bind(w.editor);
    w.__e2eLoadCalls = 0;
    w.editor.loadProjectData = ((...args: unknown[]) => {
      w.__e2eLoadCalls = (w.__e2eLoadCalls ?? 0) + 1;
      return original(...args);
    }) as never;
  });
}

async function canvasHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { editor?: { getHtml: () => string } };
    if (!w.editor) throw new Error("GrapesJS editor not found");
    return w.editor.getHtml();
  });
}

async function loadCallCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as unknown as { __e2eLoadCalls?: number };
    return w.__e2eLoadCalls ?? 0;
  });
}

test.describe("Designer MCP reconnect reload behavior (#578) (#948)", { tag: ["@regression"] }, () => {
  let mcpAvailable = false;
  let ws: OpenedWorkspace;

  test.beforeAll(async () => {
    mcpAvailable = await isMcpRunning();
    if (!mcpAvailable) return;
    ws = await setupTestWorkspace({
      key: WS_KEY,
      project,
      screenDesigns: [{ id: SCREEN_ID, data: initialScreen }],
    });
    // 永続 WS (sendBrowserRequest 用) を ws.workspacePath に open しておく (#958)
    await openBrowserSessionWorkspace(ws.workspacePath);
  });

  test.afterAll(async () => {
    await closeBrowserSession();
    if (mcpAvailable) await cleanupRealWorkspaces([WS_KEY]);
  });

  test.beforeEach(async () => {
    if (!mcpAvailable) test.skip(true, "backend (port 5179) が起動していません");
  });

  test("MCP reconnect does not call editor.loadProjectData or change clean canvas HTML", async ({ page }) => {
    await setupDesigner(page, ws);

    const beforeHtml = await canvasHtml(page);
    const beforeLoads = await loadCallCount(page);

    // __mcpBridge.stop() / start() で再接続シミュレート (real backend に対して新 WS)
    const statuses = await page.evaluate(async () => {
      const w = window as unknown as {
        editor?: unknown;
        __mcpBridge?: {
          stop: () => void;
          start: (editor: unknown) => void;
          getStatus: () => string;
          onStatusChange: (cb: (status: string) => void) => () => void;
        };
      };
      if (!w.editor || !w.__mcpBridge) throw new Error("Designer MCP bridge not ready");

      const seen: string[] = [];
      const unsubscribe = w.__mcpBridge.onStatusChange((status) => seen.push(status));
      w.__mcpBridge.stop();
      w.__mcpBridge.start(w.editor);
      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
          if (w.__mcpBridge?.getStatus() === "connected") resolve();
          else if (Date.now() - startedAt > 5000) reject(new Error("Timed out waiting for MCP reconnect"));
          else setTimeout(tick, 20);
        };
        tick();
      });
      unsubscribe();
      // 再接続後 broadcast 等が来ていれば 100ms 内に load が呼ばれる猶予
      await new Promise((resolve) => setTimeout(resolve, 200));
      return seen;
    });

    expect(statuses).toContain("disconnected");
    expect(statuses).toContain("connected");
    // 再接続だけで loadProjectData が呼ばれてはいけない (= unnecessary reload を起こさない)
    expect(await loadCallCount(page)).toBe(beforeLoads);
    // server-change-banner は出ない (broadcast を受信していないため)
    await expect(page.locator(".server-change-banner")).toHaveCount(0);
    // 再接続前後で canvas HTML が等価 (内部状態を壊さない)。
    // ただし mcpBridge.stop()/start() の lifecycle で getHtml が一時的に
    // throw する場合があるので、 polling で安定値を取得する。
    await expect.poll(async () => {
      try {
        return await canvasHtml(page);
      } catch {
        return null;
      }
    }, { timeout: 5000 }).toBe(beforeHtml);
  });

  test("screenChanged broadcast reloads a clean Designer canvas from server state", async ({ page }) => {
    await setupDesigner(page, ws);

    // 別 WS client (sendBrowserRequest 経由) で saveScreen → backend が screenChanged broadcast
    await sendBrowserRequest("saveScreen", { screenId: SCREEN_NORM, data: changedScreen });

    // browser が broadcast を受信して reload → loadProjectData が呼ばれて canvas 更新
    await expect.poll(() => loadCallCount(page), { timeout: 10000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => canvasHtml(page), { timeout: 10000 }).toContain("Changed by server broadcast");
  });
});
