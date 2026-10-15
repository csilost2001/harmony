import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const request = vi.fn();
vi.mock("../../../mcp/mcpBridge", () => ({
  mcpBridge: { request: (...a: unknown[]) => request(...(a as [string, unknown])), onBroadcast: () => () => undefined, onStatusChange: () => () => undefined },
}));
import { MarkersSummaryPanel } from "./MarkersSummaryPanel";

const it_ = (type: string, id: string, name: string, kind: string, body: string, createdAt: string) => ({
  entityType: type, entityId: id, entityName: name,
  marker: { id: `${id}-${body}`, kind, body, author: "human", createdAt },
});
function Where() { return <output data-testid="where">{useLocation().pathname}</output>; }
const mount = () => render(
  <MemoryRouter initialEntries={["/w/ws1/"]}>
    <Routes><Route path="/w/:wsId/*" element={<><MarkersSummaryPanel /><Where /></>} /></Routes>
  </MemoryRouter>,
);

describe("MarkersSummaryPanel (全設計)", () => {
  beforeEach(() => request.mockReset());

  it("処理フロー以外 (テーブル・画面) も数える。種類別・設計の種類別・いちばん古い日数。クリックで編集画面へ", async () => {
    const old = new Date(Date.now() - 9 * 86_400_000).toISOString();
    request.mockResolvedValue({ items: [
      it_("table", "orders", "注文", "todo", "金額の列", old),
      it_("screen", "cart", "カート", "question", "ボタンの位置", new Date().toISOString()),
      it_("processFlow", "confirm", "注文確定", "todo", "SQL", new Date().toISOString()),
    ] });
    mount();
    await waitFor(() => expect(screen.getByTestId("markers-summary-total")).toHaveTextContent("3"));
    expect(request).toHaveBeenCalledWith("listAllMarkers", { unresolvedOnly: true });
    expect(screen.getByTestId("markers-summary-oldest")).toHaveTextContent("最長 9 日");
    expect(screen.getByText(/テーブル 1/)).toBeInTheDocument();
    expect(screen.getByText(/TODO 2/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("編集画面を開く").find((b) => b.textContent?.includes("カート"))!);
    expect(screen.getByTestId("where")).toHaveTextContent("/w/ws1/screen/items/cart");
    fireEvent.click(screen.getByTestId("markers-summary-all"));
    expect(screen.getByTestId("where")).toHaveTextContent("/w/ws1/markers");
  });

  it("未解決が無いとき、案内を出す。失敗したら失敗を出す", async () => {
    request.mockResolvedValue({ items: [] });
    const { unmount } = mount();
    expect(await screen.findByText(/未解決のマーカーはありません/)).toBeInTheDocument();
    unmount();
    request.mockRejectedValue(new Error("つながりません"));
    mount();
    expect(await screen.findByText(/集計失敗/)).toBeInTheDocument();
  });
});
