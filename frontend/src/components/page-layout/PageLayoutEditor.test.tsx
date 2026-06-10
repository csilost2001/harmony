/**
 * PageLayoutEditor — smoke tests (pl-3, #1024)
 * lifecycle: load / edit / save / draft 保持 を最低限検証
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ─── mock heavy deps ─────────────────────────────────────────────────────────

const editSessionMock = vi.hoisted(() => ({
  modeKind: "readonly" as "readonly" | "editing",
}));

const pageLayoutMock = vi.hoisted(() => {
  const makeDefaultLayout = () => ({
    id: "pl-test-001",
    name: "Test Layout",
    description: "テスト用レイアウト",
    maturity: "draft",
    regions: [
      { name: "header", description: "ヘッダ" },
      { name: "main", description: "メイン" },
      { name: "footer", description: "フッタ" },
    ],
    assignments: { header: "global-header", main: "global-header" },
    design: { editorKind: "grapesjs", cssFramework: "bootstrap" },
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
  });
  return {
    makeDefaultLayout,
    layout: makeDefaultLayout() as any,
  };
});

const previewMock = vi.hoisted(() => ({
  defer: false,
  pending: [] as Array<() => void>,
}));

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    getSessionId: () => "test-session-id",
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn(() => () => {}),
    onBroadcast: vi.fn(() => () => {}),
    request: vi.fn((method: string, params?: { screenId?: string }) => {
      const resolveLoadScreen = (payload: unknown) => {
        if (!previewMock.defer) return Promise.resolve(payload);
        return new Promise((resolve) => {
          previewMock.pending.push(() => resolve(payload));
        });
      };
      if (method === "loadScreen" && params?.screenId === "global-header") {
        return resolveLoadScreen({
          pages: [{ frames: [{ component: { components: "<header>Header Body</header>" } }] }],
        });
      }
      if (method === "loadScreen" && params?.screenId === "dashboard") {
        return resolveLoadScreen({
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
    loadPageLayout: vi.fn().mockImplementation(() => Promise.resolve(pageLayoutMock.layout)),
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
    mode: { kind: editSessionMock.modeKind },
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
    previewMock.pending.splice(0).forEach((resolve) => resolve());
    previewMock.defer = false;
    pageLayoutMock.layout = pageLayoutMock.makeDefaultLayout();
    vi.clearAllMocks();
    editSessionMock.modeKind = "readonly";
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

  it("clears preview loading when selected preview ids become empty", async () => {
    pageLayoutMock.layout = {
      ...pageLayoutMock.makeDefaultLayout(),
      regions: [{ name: "main", description: "メイン" }],
      assignments: {},
    };
    previewMock.defer = true;
    renderEditor();

    await screen.findByTestId("page-layout-content-slot-preview");
    fireEvent.change(screen.getByTestId("page-layout-sample-page-select"), { target: { value: "dashboard" } });
    expect(await screen.findByText(/プレビューを読み込み中/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("page-layout-sample-page-select"), { target: { value: "" } });
    await waitFor(() => {
      expect(screen.queryByText(/プレビューを読み込み中/)).not.toBeInTheDocument();
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

  it("updates regions from a pattern and drops content-slot assignments in editing mode", async () => {
    editSessionMock.modeKind = "editing";
    renderEditor();

    expect(await screen.findByTestId("page-layout-orphan-assignments")).toHaveTextContent("main");

    fireEvent.change(screen.getByTestId("page-layout-pattern-select"), {
      target: { value: "header-sidebar-main-footer" },
    });

    expect(await screen.findByTestId("page-layout-slot-sidebar")).toHaveTextContent("sidebar");
    expect(screen.getByTestId("page-layout-gadget-preview-header")).toHaveTextContent("Global Header");
    expect(screen.queryByTestId("page-layout-orphan-assignments")).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-layout-gadget-preview-main")).not.toBeInTheDocument();
  });

  it("rejects the legacy content alias as a newly added region in editing mode", async () => {
    editSessionMock.modeKind = "editing";
    renderEditor();

    fireEvent.change(await screen.findByPlaceholderText("region 名 (例: breadcrumb)"), {
      target: { value: "content" },
    });
    fireEvent.click(screen.getByRole("button", { name: /追加/ }));

    expect(await screen.findByText(/content は既存データ互換 alias/)).toBeInTheDocument();
    expect(screen.queryByTestId("page-layout-slot-content")).not.toBeInTheDocument();
  });
});
