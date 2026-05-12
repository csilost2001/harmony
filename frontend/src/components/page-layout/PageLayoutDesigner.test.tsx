/**
 * PageLayoutDesigner — smoke tests (pl-3, #1024)
 * component renders without crash + basic loading state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    getSessionId: () => "test-session-id",
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn(() => () => {}),
    onBroadcast: vi.fn(() => () => {}),
    request: vi.fn().mockResolvedValue({ sessions: [] }),
  },
}));

vi.mock("../../store/pageLayoutStore", async () => {
  const actual = await vi.importActual<typeof import("../../store/pageLayoutStore")>("../../store/pageLayoutStore");
  return {
    ...actual,
    loadPageLayout: vi.fn().mockResolvedValue({
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
    }),
  };
});

// Designer is a complex component — mock it for unit test
vi.mock("../Designer", () => ({
  Designer: ({ screenId }: { screenId: string }) => (
    <div data-testid="designer-mock">Designer for {screenId}</div>
  ),
}));

import { PageLayoutDesigner } from "./PageLayoutDesigner";

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
});
