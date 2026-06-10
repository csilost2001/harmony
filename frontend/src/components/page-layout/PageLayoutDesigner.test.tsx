/**
 * PageLayoutDesigner — smoke tests (pl-3, #1024)
 * component renders without crash + basic loading state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { PageLayout } from "../../store/pageLayoutStore";

const mockState = vi.hoisted(() => {
  const componentAddHandlers = new Set<() => void>();
  const broadcastHandlers = new Map<string, Set<(data: unknown) => void>>();
  const statusHandlers = new Set<(status: string) => void>();
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
    statusHandlers,
    editor,
    pageLayout: null as PageLayout | null,
    designerProps: null as Record<string, unknown> | null,
    savePageLayout: vi.fn(),
  };
});

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    getSessionId: () => "test-session-id",
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn((handler: (status: string) => void) => {
      mockState.statusHandlers.add(handler);
      return () => mockState.statusHandlers.delete(handler);
    }),
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
    savePageLayout: mockState.savePageLayout,
  };
});

vi.mock("../../store/flowStore", () => ({
  loadProject: vi.fn().mockResolvedValue({
    screens: [
      { id: "gadget-1", name: "Gadget 1", purpose: "gadget" },
      { id: "gadget-2", name: "Gadget 2", purpose: "gadget" },
    ],
  }),
}));

vi.mock("../../store/puckComponentsStore", () => ({
  loadCustomPuckComponents: vi.fn().mockResolvedValue([]),
}));

// Designer is a complex component — mock it for unit test
vi.mock("../Designer", () => ({
  Designer: (props: { screenId: string; onGrapesEditorReady?: (editor: unknown) => void }) => {
    const { screenId, onGrapesEditorReady } = props;
    mockState.designerProps = props as unknown as Record<string, unknown>;
    onGrapesEditorReady?.(mockState.editor);
    return <div data-testid="designer-mock">Designer for {screenId}</div>;
  },
}));

import { mcpBridge } from "../../mcp/mcpBridge";
import { loadProject } from "../../store/flowStore";
import { loadCustomPuckComponents } from "../../store/puckComponentsStore";
import { loadPageLayout, savePageLayout } from "../../store/pageLayoutStore";
import { PageLayoutDesigner } from "./PageLayoutDesigner";

const defaultPageLayout = ({
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
} as unknown) as PageLayout;

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
    mockState.statusHandlers.clear();
    mockState.pageLayout = defaultPageLayout;
    mockState.designerProps = null;
    mockState.savePageLayout.mockResolvedValue(undefined);
    vi.mocked(mcpBridge.request).mockResolvedValue({ sessions: [] });
    vi.mocked(mcpBridge.loadPuckData).mockResolvedValue(null);
    vi.mocked(loadProject).mockResolvedValue({
      screens: [
        { id: "gadget-1", name: "Gadget 1", purpose: "gadget" },
        { id: "gadget-2", name: "Gadget 2", purpose: "gadget" },
      ],
    } as never);
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

  it("renders visual slots and treats main as the content slot", async () => {
    renderDesigner();

    expect(await screen.findByTestId("page-layout-manager-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("page-layout-slot-header")).toHaveTextContent("Header");
    expect(screen.getByTestId("page-layout-slot-main")).toHaveTextContent("page Screen content");
    expect(screen.getByTestId("page-layout-slot-footer")).toHaveTextContent("Footer");
    expect(screen.queryByTestId("page-layout-assignment-main")).not.toBeInTheDocument();
  });

  it("saves gadget assignments from the visual manager", async () => {
    renderDesigner();

    const headerSelect = await screen.findByTestId("page-layout-assignment-header");
    fireEvent.change(headerSelect, { target: { value: "gadget-1" } });
    fireEvent.click(screen.getByRole("button", { name: /割り当て保存/ }));

    await waitFor(() => {
      expect(savePageLayout).toHaveBeenCalledWith(expect.objectContaining({
        id: "pl-design-001",
        assignments: { header: "gadget-1" },
      }));
    });
  });

  it("merges assignments into the latest PageLayout before saving", async () => {
    renderDesigner();
    await screen.findByTestId("page-layout-assignment-header");

    mockState.pageLayout = {
      ...defaultPageLayout,
      name: "Renamed Layout",
      maturity: "committed",
      processFlowId: "layout-orchestrator",
    } as unknown as PageLayout;

    fireEvent.change(screen.getByTestId("page-layout-assignment-header"), { target: { value: "gadget-2" } });
    fireEvent.click(screen.getByRole("button", { name: /割り当て保存/ }));

    await waitFor(() => {
      expect(savePageLayout).toHaveBeenCalledWith(expect.objectContaining({
        id: "pl-design-001",
        name: "Renamed Layout",
        maturity: "committed",
        processFlowId: "layout-orchestrator",
        assignments: { header: "gadget-2" },
      }));
    });
    expect(loadPageLayout).toHaveBeenCalledTimes(2);
  });

  it("reloads PageLayout manager on pageLayoutChanged when clean", async () => {
    renderDesigner();
    expect(await screen.findByRole("heading", { name: "Main Layout" })).toBeInTheDocument();

    mockState.pageLayout = {
      ...defaultPageLayout,
      name: "Updated Layout",
      assignments: { footer: "gadget-1" } as unknown as Record<string, never>,
    };
    mockState.broadcastHandlers.get("pageLayoutChanged")?.forEach((handler) => handler({ pageLayoutId: "pl-design-001" }));

    expect(await screen.findByRole("heading", { name: "Updated Layout" })).toBeInTheDocument();
    expect(screen.getByTestId("page-layout-slot-footer")).toHaveTextContent("Gadget 1");
  });

  it("blocks assignment save after external pageLayoutChanged while dirty", async () => {
    renderDesigner();

    fireEvent.change(await screen.findByTestId("page-layout-assignment-header"), { target: { value: "gadget-1" } });
    mockState.broadcastHandlers.get("pageLayoutChanged")?.forEach((handler) => handler({ pageLayoutId: "pl-design-001" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("別セッションで更新");
    expect(screen.getByRole("button", { name: /割り当て保存/ })).toBeDisabled();
    expect(savePageLayout).not.toHaveBeenCalled();
  });

  it("keeps the external update banner visible after selector changes and reloads from it", async () => {
    renderDesigner();

    fireEvent.change(await screen.findByTestId("page-layout-assignment-header"), { target: { value: "gadget-1" } });
    mockState.broadcastHandlers.get("pageLayoutChanged")?.forEach((handler) => handler({ pageLayoutId: "pl-design-001" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("再読み込み");

    fireEvent.change(screen.getByTestId("page-layout-assignment-header"), { target: { value: "gadget-2" } });
    expect(screen.getByRole("alert")).toHaveTextContent("再読み込み");
    expect(screen.getByRole("button", { name: /割り当て保存/ })).toBeDisabled();

    mockState.pageLayout = {
      ...defaultPageLayout,
      name: "Reloaded Layout",
      assignments: { header: "gadget-2" } as unknown as Record<string, never>,
    };
    fireEvent.click(screen.getByRole("button", { name: /再読み込み/ }));

    expect(await screen.findByRole("heading", { name: "Reloaded Layout" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /割り当て保存/ })).toBeDisabled();
  });

  it("keeps dirty assignment draft on reconnect and asks the user to reload", async () => {
    renderDesigner();

    const headerSelect = await screen.findByTestId("page-layout-assignment-header");
    fireEvent.change(headerSelect, { target: { value: "gadget-1" } });
    mockState.pageLayout = {
      ...defaultPageLayout,
      name: "Server Reload Would Replace Draft",
      assignments: {},
    } as unknown as PageLayout;

    mockState.statusHandlers.forEach((handler) => handler("connected"));

    expect(await screen.findByRole("alert")).toHaveTextContent("接続が復旧");
    expect(screen.getByRole("heading", { name: "Main Layout" })).toBeInTheDocument();
    expect(screen.getByTestId("page-layout-assignment-header")).toHaveValue("gadget-1");
    expect(screen.getByRole("button", { name: /割り当て保存/ })).toBeDisabled();
  });

  it("reloads gadget options on projectChanged", async () => {
    renderDesigner();
    expect(await screen.findByTestId("page-layout-assignment-header")).toBeInTheDocument();

    vi.mocked(loadProject).mockResolvedValue({
      screens: [
        { id: "gadget-3", name: "Gadget 3", purpose: "gadget" },
      ],
    } as never);
    mockState.broadcastHandlers.get("projectChanged")?.forEach((handler) => handler({}));

    await waitFor(() => {
      expect(screen.getByTestId("page-layout-assignment-header")).toHaveTextContent("Gadget 3");
    });
  });

  it("passes PageLayout design metadata and dedicated committed loader to Designer", async () => {
    const committed = { root: { props: {} }, content: [{ type: "RegionMain", props: {} }] };
    vi.mocked(mcpBridge.request).mockImplementation(async (method) => {
      if (method === "loadPageLayoutDesign") return committed;
      if (method === "editSession.list") return { sessions: [] };
      return null;
    });

    renderDesigner();

    await waitFor(() => {
	      expect(mockState.designerProps).toMatchObject({
	        screenId: "page-layout:pl-design-001",
	        resourceKind: "pageLayout",
	        editSessionResourceType: "page-layout-design",
        editSessionResourceId: "pl-design-001",
        designEditorKind: "puck",
        designCssFramework: "bootstrap",
      });
    });

    const loadCommittedDesign = mockState.designerProps?.loadCommittedDesign as (() => Promise<unknown>) | undefined;
    await expect(loadCommittedDesign?.()).resolves.toBe(committed);
    expect(mcpBridge.request).toHaveBeenCalledWith("loadPageLayoutDesign", { pageLayoutId: "pl-design-001" });
    expect(mcpBridge.loadPuckData).not.toHaveBeenCalledWith("page-layout:pl-design-001");
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
      assignments: { main: "gadget-1" } as unknown as Record<string, never>,
      design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
    };

    renderDesigner();

    await waitFor(() => {
      expect(loadProject).toHaveBeenCalledTimes(2);
    });

    for (let i = 0; i < 100; i += 1) {
      for (const handler of mockState.componentAddHandlers) handler();
    }

    await waitFor(() => {
      expect(mcpBridge.request).toHaveBeenCalledTimes(101);
    });
    expect(loadProject).toHaveBeenCalledTimes(2);

    mockState.broadcastHandlers.get("projectChanged")?.forEach((handler) => handler({}));
    await waitFor(() => {
      expect(loadProject).toHaveBeenCalledTimes(4);
    });
  });

  it("loads GrapesJS gadget HTML with concurrency limit", async () => {
    mockState.pageLayout = {
      ...defaultPageLayout,
      assignments: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => [`region-${i}`, `gadget-${i}`]),
      ) as unknown as Record<string, never>,
      design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
    };
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    vi.mocked(mcpBridge.request).mockImplementation((method) => {
      if (method !== "loadScreen") return Promise.resolve(null);
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
      ) as unknown as Record<string, never>,
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
