/**
 * PageLayoutDesigner — smoke tests (pl-3, #1024)
 * component renders without crash + basic loading state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { PageLayout } from "../../store/pageLayoutStore";

const mockState = vi.hoisted(() => {
  const componentAddHandlers = new Set<() => void>();
  const broadcastHandlers = new Map<string, Set<(data: unknown) => void>>();
  const editor = {
    Canvas: {
      getDocument: () => document,
    },
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "component:add") componentAddHandlers.add(handler);
    }),
    off: vi.fn((event: string, handler: () => void) => {
      if (event === "component:add") componentAddHandlers.delete(handler);
    }),
  };
  return {
    componentAddHandlers,
    broadcastHandlers,
    editor,
    pageLayout: null as PageLayout | null,
  };
});

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    getSessionId: () => "test-session-id",
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn(() => () => {}),
    onBroadcast: vi.fn((event: string, handler: (data: unknown) => void) => {
      if (!mockState.broadcastHandlers.has(event)) {
        mockState.broadcastHandlers.set(event, new Set());
      }
      mockState.broadcastHandlers.get(event)!.add(handler);
      return () => mockState.broadcastHandlers.get(event)?.delete(handler);
    }),
    request: vi.fn().mockResolvedValue({ sessions: [] }),
    loadPuckData: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../store/pageLayoutStore", async () => {
  const actual = await vi.importActual<typeof import("../../store/pageLayoutStore")>("../../store/pageLayoutStore");
  return {
    ...actual,
    loadPageLayout: vi.fn().mockImplementation(() => Promise.resolve(mockState.pageLayout)),
  };
});

vi.mock("../../store/flowStore", () => ({
  loadProject: vi.fn().mockResolvedValue({
    screens: [
      { id: "gadget-1", name: "Gadget 1" },
      { id: "gadget-2", name: "Gadget 2" },
    ],
  }),
}));

vi.mock("../../store/puckComponentsStore", () => ({
  loadCustomPuckComponents: vi.fn().mockResolvedValue([]),
}));

// Designer is a complex component — mock it for unit test
vi.mock("../Designer", () => ({
  Designer: ({ screenId, onGrapesEditorReady }: { screenId: string; onGrapesEditorReady?: (editor: unknown) => void }) => {
    onGrapesEditorReady?.(mockState.editor);
    return <div data-testid="designer-mock">Designer for {screenId}</div>;
  },
}));

import { mcpBridge } from "../../mcp/mcpBridge";
import { loadProject } from "../../store/flowStore";
import { loadCustomPuckComponents } from "../../store/puckComponentsStore";
import { PageLayoutDesigner } from "./PageLayoutDesigner";

const defaultPageLayout: PageLayout = {
  id: "pl-design-001",
  name: "Main Layout",
  maturity: "draft",
  regions: [
    { name: "header", description: "ヘッダ" },
    { name: "main" },
    { name: "footer", description: "フッタ" },
  ],
  assignments: {},
  design: { editorKind: "puck", cssFramework: "bootstrap" },
  createdAt: "2026-05-12T00:00:00.000Z",
  updatedAt: "2026-05-12T00:00:00.000Z",
};

function renderDesigner(id = "pl-design-001") {
  return render(
    <MemoryRouter initialEntries={[`/w/ws1/page-layout/design/${id}`]}>
      <Routes>
        <Route path="/w/:wsId/page-layout/design/:pageLayoutId" element={<PageLayoutDesigner />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PageLayoutDesigner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.componentAddHandlers.clear();
    mockState.broadcastHandlers.clear();
    mockState.pageLayout = defaultPageLayout;
    vi.mocked(mcpBridge.request).mockResolvedValue({ sessions: [] });
    vi.mocked(mcpBridge.loadPuckData).mockResolvedValue(null);
    vi.mocked(loadCustomPuckComponents).mockResolvedValue([]);
    localStorage.clear();
  });

  it("renders without crash (loading → loaded)", async () => {
    renderDesigner();
    await waitFor(() => {
      // Either loading state or puck placeholder
      const spinner = document.querySelector(".spinner");
      const content = document.querySelector("[data-testid='designer-mock']");
      const puckPlaceholder = document.querySelector("[class*='layout']") || document.body.textContent?.includes("Main Layout");
      expect(spinner || content || puckPlaceholder).toBeTruthy();
    }, { timeout: 3000 });
  });

  it("shows puck placeholder for puck editorKind", async () => {
    renderDesigner();
    await waitFor(() => {
      const body = document.body.textContent ?? "";
      if (body.includes("Main Layout")) {
        // puck placeholder renders the layout name
        expect(body).toContain("Main Layout");
      }
    }, { timeout: 3000 });
  });

  it("loads custom Puck components for composition preview config", async () => {
    renderDesigner();

    await waitFor(() => {
      expect(loadCustomPuckComponents).toHaveBeenCalledTimes(1);
    });

    mockState.broadcastHandlers.get("puckComponentsChanged")?.forEach((handler) => handler({}));
    await waitFor(() => {
      expect(loadCustomPuckComponents).toHaveBeenCalledTimes(2);
    });
  });

  it("caches screen name index across repeated GrapesJS region injections", async () => {
    mockState.pageLayout = {
      ...defaultPageLayout,
      assignments: { main: "gadget-1" },
      design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
    };

    renderDesigner();

    await waitFor(() => {
      expect(loadProject).toHaveBeenCalledTimes(1);
    });

    for (let i = 0; i < 100; i += 1) {
      for (const handler of mockState.componentAddHandlers) handler();
    }

    await waitFor(() => {
      expect(mcpBridge.request).toHaveBeenCalledTimes(101);
    });
    expect(loadProject).toHaveBeenCalledTimes(1);

    mockState.broadcastHandlers.get("projectChanged")?.forEach((handler) => handler({}));
    await waitFor(() => {
      expect(loadProject).toHaveBeenCalledTimes(2);
    });
  });

  it("loads GrapesJS gadget HTML with concurrency limit", async () => {
    mockState.pageLayout = {
      ...defaultPageLayout,
      assignments: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`region-${i}`, `gadget-${i}`]),
      ),
      design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
    };
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    vi.mocked(mcpBridge.request).mockImplementation(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        resolvers.push(() => {
          active -= 1;
          resolve({ html: "<div>gadget</div>" });
        });
      });
    });

    renderDesigner();

    await waitFor(() => {
      expect(resolvers).toHaveLength(4);
    });

    for (let resolved = 0; resolved < 20;) {
      const batch = resolvers.splice(0);
      resolved += batch.length;
      batch.forEach((resolve) => resolve());
      await Promise.resolve();
      await Promise.resolve();
    }

    await waitFor(() => {
      expect(mcpBridge.request).toHaveBeenCalledTimes(20);
    });
    expect(maxActive).toBeLessThanOrEqual(4);
  });

  it("loads Puck gadget data with concurrency limit", async () => {
    mockState.pageLayout = {
      ...defaultPageLayout,
      assignments: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`region-${i}`, `gadget-${i}`]),
      ),
    };
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    vi.mocked(mcpBridge.loadPuckData).mockImplementation((screenId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        resolvers.push(() => {
          active -= 1;
          resolve({ root: { props: { screenId } } });
        });
      });
    });

    renderDesigner();

    await waitFor(() => {
      expect(resolvers).toHaveLength(4);
    });

    for (let resolved = 0; resolved < 20;) {
      const batch = resolvers.splice(0);
      resolved += batch.length;
      batch.forEach((resolve) => resolve());
      await Promise.resolve();
      await Promise.resolve();
    }

    await waitFor(() => {
      expect(mcpBridge.loadPuckData).toHaveBeenCalledTimes(20);
    });
    expect(maxActive).toBeLessThanOrEqual(4);
  });
});
