import { test, expect, type Page } from "@playwright/test";

const SCREEN_ID = "issue-578-designer-reconnect";

const initialScreen = {
  dataSources: [],
  assets: [],
  styles: [],
  pages: [{
    frames: [{
      component: {
        type: "wrapper",
        components: "<main><h1>Initial server HTML</h1></main>",
      },
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
      component: {
        type: "wrapper",
        components: "<main><h1>Changed by server broadcast</h1></main>",
      },
      id: "frame-changed",
    }],
    id: "page-changed",
    type: "main",
  }],
  symbols: [],
};

const project = {
  version: 1,
  name: "issue-578-designer-reconnect",
  screens: [{
    id: SCREEN_ID,
    no: 1,
    name: "Issue 578 Designer",
    kind: "standard",
    updatedAt: new Date("2026-04-29T00:00:00.000Z").toISOString(),
  }],
  groups: [],
  edges: [],
  tables: [],
  processFlows: [],
  updatedAt: new Date("2026-04-29T00:00:00.000Z").toISOString(),
};

const tab = {
  id: `design:${SCREEN_ID}`,
  type: "design",
  resourceId: SCREEN_ID,
  label: "Issue 578 Designer",
  isDirty: false,
  isPinned: false,
};

async function setupDesigner(page: Page) {
  await page.addInitScript(({ project, tab, screenId, initialScreen }) => {
    localStorage.setItem("flow-project", JSON.stringify(project));
    localStorage.setItem("harmony-open-tabs", JSON.stringify([tab]));
    localStorage.setItem("harmony-active-tab", tab.id);
    localStorage.removeItem(`gjs-screen-${screenId}-draft`);
    localStorage.setItem(`gjs-screen-${screenId}`, JSON.stringify(initialScreen));

    type Listener = (event?: { data?: string }) => void;

    class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      readonly url: string;
      readyState = FakeWebSocket.CONNECTING;
      onopen: Listener | null = null;
      onmessage: Listener | null = null;
      onclose: Listener | null = null;
      onerror: Listener | null = null;
      private listeners = new Map<string, Set<Listener>>();

      constructor(url: string) {
        this.url = url;
        const w = window as unknown as {
          __e2eMcpSockets?: FakeWebSocket[];
        };
        w.__e2eMcpSockets = [...(w.__e2eMcpSockets ?? []), this];
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.onopen?.();
          this.emit("open");
        }, 0);
      }

      addEventListener(type: string, listener: Listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(listener);
      }

      removeEventListener(type: string, listener: Listener) {
        this.listeners.get(type)?.delete(listener);
      }

      send(raw: string) {
        const msg = JSON.parse(raw) as {
          type?: string;
          id?: string;
          method?: string;
          params?: { screenId?: string };
        };
        if (msg.type !== "request" || !msg.id) return;

        let result: unknown = { success: true };
        if (msg.method === "loadScreen") {
          const w = window as unknown as {
            __e2eMcpScreenData?: Record<string, unknown>;
          };
          result = msg.params?.screenId === screenId ? w.__e2eMcpScreenData : null;
        } else if (msg.method === "getFileMtime") {
          result = { mtime: Date.now() };
        } else if (msg.method === "loadCustomBlocks") {
          result = [];
        } else if (msg.method === "getExtensions") {
          result = {};
        }

        setTimeout(() => {
          this.serverMessage({ type: "response", id: msg.id, result });
        }, 0);
      }

      close() {
        if (this.readyState === FakeWebSocket.CLOSED) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
        this.emit("close");
      }

      serverMessage(message: unknown) {
        this.onmessage?.({ data: JSON.stringify(message) });
        this.emit("message", { data: JSON.stringify(message) });
      }

      private emit(type: string, event?: { data?: string }) {
        this.listeners.get(type)?.forEach((listener) => listener(event));
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });

    const w = window as unknown as {
      __e2eMcpScreenData?: Record<string, unknown>;
      __e2eMcpBroadcast?: (event: string, data: unknown) => void;
      __e2eMcpSockets?: Array<{ serverMessage: (message: unknown) => void }>;
    };
    w.__e2eMcpScreenData = initialScreen;
    w.__e2eMcpBroadcast = (event, data) => {
      const socket = w.__e2eMcpSockets?.at(-1);
      socket?.serverMessage({ type: "broadcast", event, data });
    };
  }, { project, tab, screenId: SCREEN_ID, initialScreen });

  await page.goto(`/screen/design/${SCREEN_ID}`);
  await expect(page.locator(".gjs-frame")).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const w = window as unknown as {
      editor?: { getHtml: () => string };
      __mcpBridge?: { getStatus: () => string };
    };
    return !!w.editor && w.__mcpBridge?.getStatus() === "connected";
  }, { timeout: 15000 });

  await page.waitForFunction(() => {
    const w = window as unknown as { editor?: { getHtml: () => string } };
    return w.editor?.getHtml().includes("Initial server HTML");
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const w = window as unknown as {
      editor?: { load: (...args: unknown[]) => Promise<unknown> };
      __e2eLoadCalls?: number;
    };
    if (!w.editor) throw new Error("GrapesJS editor not found");
    const originalLoad = w.editor.load.bind(w.editor);
    w.__e2eLoadCalls = 0;
    w.editor.load = async (...args: unknown[]) => {
      w.__e2eLoadCalls = (w.__e2eLoadCalls ?? 0) + 1;
      return originalLoad(...args);
    };
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

test.describe("Designer MCP reconnect reload behavior (#578)", () => {
  test("MCP reconnect does not call editor.load or change clean canvas HTML", async ({ page }) => {
    await setupDesigner(page);

    const beforeHtml = await canvasHtml(page);
    const beforeLoads = await loadCallCount(page);

    const statuses = await page.evaluate(async ({ changedScreen }) => {
      const w = window as unknown as {
        editor?: unknown;
        __mcpBridge?: {
          stop: () => void;
          start: (editor: unknown) => void;
          getStatus: () => string;
          onStatusChange: (cb: (status: string) => void) => () => void;
        };
        __e2eMcpScreenData?: Record<string, unknown>;
      };
      if (!w.editor || !w.__mcpBridge) throw new Error("Designer MCP bridge not ready");

      const seen: string[] = [];
      const unsubscribe = w.__mcpBridge.onStatusChange((status) => seen.push(status));
      w.__e2eMcpScreenData = changedScreen;
      w.__mcpBridge.stop();
      w.__mcpBridge.start(w.editor);
      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
          if (w.__mcpBridge?.getStatus() === "connected") {
            resolve();
          } else if (Date.now() - startedAt > 5000) {
            reject(new Error("Timed out waiting for MCP reconnect"));
          } else {
            setTimeout(tick, 20);
          }
        };
        tick();
      });
      unsubscribe();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return seen;
    }, { changedScreen });

    expect(statuses).toContain("disconnected");
    expect(statuses).toContain("connected");
    expect(await loadCallCount(page)).toBe(beforeLoads);
    expect(await canvasHtml(page)).toBe(beforeHtml);
    await expect(page.locator(".server-change-banner")).toHaveCount(0);
  });

  test("screenChanged broadcast reloads a clean Designer canvas from server state", async ({ page }) => {
    await setupDesigner(page);

    await page.evaluate(({ changedScreen, screenId }) => {
      const w = window as unknown as {
        __e2eMcpScreenData?: Record<string, unknown>;
        __e2eMcpBroadcast?: (event: string, data: unknown) => void;
      };
      if (!w.__e2eMcpBroadcast) throw new Error("MCP broadcast test helper not ready");
      w.__e2eMcpScreenData = changedScreen;
      w.__e2eMcpBroadcast("screenChanged", { screenId });
    }, { changedScreen, screenId: SCREEN_ID });

    await expect.poll(() => loadCallCount(page)).toBe(1);
    await expect.poll(() => canvasHtml(page)).toContain("Changed by server broadcast");
  });
});
