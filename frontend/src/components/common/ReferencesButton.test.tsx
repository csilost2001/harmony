import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const request = vi.fn();
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { request: (...a: unknown[]) => request(...a) } }));
const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));
vi.mock("../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => `/w/ws1${p}` }) }));
import { ReferencesButton } from "./ReferencesButton";

const renderBtn = () => render(<MemoryRouter><ReferencesButton entityType="screen" id="cart" name="カート" /></MemoryRouter>);

describe("ReferencesButton", () => {
  beforeEach(() => { request.mockReset(); navigate.mockReset(); });

  it("開くと参照元を種類ごとに出し、クリックでその設計を開く", async () => {
    request.mockResolvedValue({
      entityType: "screen", id: "cart", exists: true, total: 3,
      referrers: [
        { kind: "report", id: "slip", name: "伝票", count: 1 },
        { kind: "businessFlow", id: "order", name: "注文", count: 2 },
      ],
    });
    renderBtn();
    fireEvent.click(screen.getByTestId("references-open-btn"));
    await waitFor(() => expect(screen.getByTestId("references-summary")).toBeTruthy());
    expect(request).toHaveBeenCalledWith("findEntityReferences", { entityType: "screen", id: "cart" });
    expect(screen.getByTestId("references-summary").textContent).toContain("2 件の設計から 3 か所");
    fireEvent.click(screen.getByTestId("references-item-businessFlow-order"));
    expect(navigate).toHaveBeenCalledWith("/w/ws1/business-flow/edit/order");
    expect(screen.queryByTestId("references-dialog")).toBeNull();
  });

  it("参照元がなければ、その旨を出す", async () => {
    request.mockResolvedValue({ entityType: "screen", id: "cart", exists: true, total: 0, referrers: [] });
    renderBtn();
    fireEvent.click(screen.getByTestId("references-open-btn"));
    await waitFor(() => expect(screen.getByTestId("references-empty")).toBeTruthy());
  });

  it("調べられなかったときはエラーを出し、Esc で閉じる", async () => {
    request.mockRejectedValue(new Error("接続できません"));
    renderBtn();
    fireEvent.click(screen.getByTestId("references-open-btn"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("接続できません"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("references-dialog")).toBeNull();
  });
});
