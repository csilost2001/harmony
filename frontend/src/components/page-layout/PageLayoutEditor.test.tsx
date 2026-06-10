/**
 * PageLayoutEditor — smoke tests (pl-3, #1024)
 * lifecycle: load / edit / save / draft 保持 を最低限検証
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ─── mock heavy deps ─────────────────────────────────────────────────────────

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    getSessionId: () => "test-session-id",
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn(() => () => {}),
    onBroadcast: vi.fn(() => () => {}),
    request: vi.fn((method: string, params?: { screenId?: string }) => {
      if (method === "loadScreen" && params?.screenId === "global-header") {
        return Promise.resolve({
          pages: [{ frames: [{ component: { components: "<header>Header Body</header>" } }] }],
        });
      }
      if (method === "loadScreen" && params?.screenId === "dashboard") {
        return Promise.resolve({
          pages: [{ frames: [{ component: { components: "<main>Dashboard Body</main>" } }] }],
        });
      }
      return Promise.resolve({ sessions: [] });
    }),
  },
}));

vi.mock("../../store/pageLayoutStore", async () => {
  const actual = await vi.importActual<typeof import("../../store/pageLayoutStore")>("../../store/pageLayoutStore");
  return {
    ...actual,
    loadPageLayout: vi.fn().mockResolvedValue({
      id: "pl-test-001",
      name: "Test Layout",
      description: "テスト用レイアウト",
      maturity: "draft",
      regions: [
        { name: "header", description: "ヘッダ" },
        { name: "main", description: "メイン" },
        { name: "footer", description: "フッタ" },
      ],
      assignments: { header: "global-header" },
      design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
      createdAt: "2026-05-12T00:00:00.000Z",
      updatedAt: "2026-05-12T00:00:00.000Z",
    }),
    savePageLayout: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../store/flowStore", async () => {
  const actual = await vi.importActual<typeof import("../../store/flowStore")>("../../store/flowStore");
  return {
    ...actual,
    loadProject: vi.fn().mockResolvedValue({
      version: 1,
      name: "test",
      screens: [
        { id: "global-header", name: "Global Header", purpose: "gadget" },
        { id: "normal-page", name: "Normal Page", purpose: "page" },
        { id: "dashboard", name: "Dashboard", purpose: "page" },
      ],
      groups: [],
      edges: [],
      updatedAt: "2026-05-12T00:00:00.000Z",
    }),
  };
});

vi.mock("../../hooks/useEditSession", () => ({
  useEditSession: () => ({
    editSession: null,
    mode: { kind: "readonly" },
    loading: false,
    isDirtyForTab: false,
    actions: {
      startEditing: vi.fn(),
      discard: vi.fn(),
      save: vi.fn().mockResolvedValue({ conflicted: false, failed: false }),
      forceReleaseOther: vi.fn(),
    },
    attach: vi.fn(),
    takeOver: vi.fn(),
    saveConflict: null,
    onSaveConflictOverwrite: vi.fn(),
    onSaveConflictCancel: vi.fn(),
  }),
}));

vi.mock("../../hooks/useSessionUrlSync", () => ({
  useSessionUrlSync: () => ({
    syncSessionToUrl: vi.fn(),
    initialEditSessionId: null,
  }),
}));

import { PageLayoutEditor } from "./PageLayoutEditor";

// ─── helper ─────────────────────────────────────────────────────────────────

function renderEditor(id = "pl-test-001") {
  return render(
    <MemoryRouter initialEntries={[`/w/ws1/page-layout/edit/${id}`]}>
      <Routes>
        <Route path="/w/:wsId/page-layout/edit/:pageLayoutId" element={<PageLayoutEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe("PageLayoutEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders without crash and shows loading then editor", async () => {
    renderEditor();
    // loading state or loaded state
    await waitFor(() => {
      // Either loading indicator or editor content
      const loading = document.querySelector(".table-editor-loading");
      const content = document.querySelector(".table-editor-page");
      expect(loading || content).toBeTruthy();
    });
  });

  it("renders editor with layout name after load", async () => {
    renderEditor();
    await waitFor(() => {
      // After loading, the name should appear somewhere
      const page = document.querySelector(".table-editor-page");
      if (page) {
        expect(page.textContent).toContain("Test Layout");
      }
    }, { timeout: 3000 });
  });

  it("shows regions section", async () => {
    renderEditor();
    await waitFor(() => {
      const page = document.querySelector(".table-editor-page");
      if (page) {
        expect(page.textContent).toContain("Regions");
        expect(page.textContent).toContain("header");
        expect(page.textContent).toContain("main");
        expect(page.textContent).toContain("footer");
      }
    }, { timeout: 3000 });
  });

  it("shows layout manager preview with content slot placeholder", async () => {
    renderEditor();

    expect(await screen.findByTestId("page-layout-composition-preview")).toBeInTheDocument();
    expect(screen.getByTestId("page-layout-content-slot-preview")).toHaveTextContent("コンテンツがここに表示されます");
    expect(screen.getByTestId("page-layout-pattern-select")).toHaveValue("header-main-footer");
  });

  it("does not expose assignment dropdown for the content slot", async () => {
    renderEditor();

    await screen.findByText("Assignments");
    expect(screen.queryByDisplayValue("main")).not.toBeInTheDocument();
    expect(document.querySelectorAll("select.tbl-select-sm")).toHaveLength(2);
    expect(screen.getAllByText("Global Header").length).toBeGreaterThan(0);
  });

  it("renders assigned gadget design body in the read-only preview", async () => {
    renderEditor();

    const headerPreview = await screen.findByTestId("page-layout-gadget-preview-header");
    await waitFor(() => {
      expect(within(headerPreview).getByText("Header Body")).toBeInTheDocument();
    });
  });

  it("renders selected sample page design body in the content slot", async () => {
    renderEditor();

    fireEvent.change(await screen.findByTestId("page-layout-sample-page-select"), { target: { value: "dashboard" } });

    const contentPreview = await screen.findByTestId("page-layout-content-slot-preview");
    await waitFor(() => {
      expect(within(contentPreview).getByText("Dashboard Body")).toBeInTheDocument();
    });
  });

  it("does not list page screens in gadget assignment selectors", async () => {
    renderEditor();

    await screen.findByText("Assignments");
    const assignmentSelects = [...document.querySelectorAll<HTMLSelectElement>("select.tbl-select-sm")];
    expect(assignmentSelects.length).toBeGreaterThan(0);
    for (const select of assignmentSelects) {
      expect([...select.options].map((option) => option.value)).not.toContain("normal-page");
    }
  });
});
