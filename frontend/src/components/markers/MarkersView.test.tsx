import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const request = vi.fn();
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: (...a: unknown[]) => request(...(a as [string, unknown])),
    onBroadcast: () => () => undefined,
    onStatusChange: () => () => undefined,
    startWithoutEditor: () => undefined,
  },
}));
import { MarkersView } from "./MarkersView";

const U = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const item = (n: number, type: string, id: string, name: string, over: Record<string, unknown> = {}) => ({
  entityType: type, entityId: id, entityName: name,
  marker: { id: U(n), kind: "todo", body: `指示${n}`, author: "human", createdAt: `2026-10-0${n}T00:00:00.000Z`, ...over },
});
const ITEMS = [
  item(3, "screen", "cart", "カート", { kind: "question" }),
  item(1, "table", "orders", "注文", { anchor: { fieldPath: "$.columns[col-02]" } }),
  item(2, "processFlow", "confirm", "注文確定", { resolvedAt: "2026-10-04T00:00:00.000Z", resolution: "済" }),
];

function Where() { return <output data-testid="where">{useLocation().pathname}</output>; }
const mount = () => render(
  <MemoryRouter initialEntries={["/w/ws1/markers"]}>
    <Routes><Route path="/w/:wsId/*" element={<><MarkersView /><Where /></>} /></Routes>
  </MemoryRouter>,
);
const rowsText = () => within(screen.getByTestId("markers-table")).getAllByRole("row").slice(1).map((r) => r.textContent ?? "");

describe("MarkersView", () => {
  beforeEach(() => {
    request.mockReset();
    request.mockImplementation(async (method: string) => (method === "listAllMarkers" ? { items: ITEMS, total: 3, unresolved: 2 } : { markers: [] }));
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("全設計のマーカーを、古いものから並べる。既定では未解決だけ。位置も出る", async () => {
    mount();
    await waitFor(() => expect(rowsText()).toHaveLength(2));
    expect(rowsText()[0]).toContain("注文");
    expect(rowsText()[0]).toContain("カラム col-02");
    expect(rowsText()[1]).toContain("カート");
    expect(screen.queryByText("指示2")).toBeNull();
  });

  it("絞り込み: 設計の種類・種類 (チップ)・語・解決済み", async () => {
    mount();
    await waitFor(() => expect(rowsText()).toHaveLength(2));
    fireEvent.change(screen.getByTestId("markers-type"), { target: { value: "table" } });
    expect(rowsText()).toHaveLength(1);
    fireEvent.change(screen.getByTestId("markers-type"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("markers-kind-question"));
    expect(rowsText()).toHaveLength(1);
    expect(rowsText()[0]).toContain("カート");
    fireEvent.click(screen.getByTestId("markers-kind-question"));
    fireEvent.click(screen.getByTestId("markers-resolved"));
    expect(rowsText()).toHaveLength(3);
    expect(screen.getByText(/— 済/)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("markers-query"), { target: { value: "確定" } });
    expect(rowsText()).toHaveLength(1);
  });

  it("設計の名前を押すと、その設計の編集画面を開く (画面は、画面項目の画面)", async () => {
    mount();
    await waitFor(() => expect(rowsText()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "カート" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/w/ws1/screen/items/cart");
  });

  it("「AI に渡す文をコピー」: 選んでいなければ未解決のすべて、選べば選んだものだけ", async () => {
    mount();
    await waitFor(() => expect(rowsText()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("markers-copy-ai"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
    const all = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(all).toContain("2 件");
    expect(all).toContain("指示1");
    expect(all).toContain("指示3");
    fireEvent.click(screen.getByLabelText("注文のマーカーを選ぶ"));
    fireEvent.click(screen.getByTestId("markers-copy-ai"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2));
    const one = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    expect(one).toContain("1 件");
    expect(one).not.toContain("指示3");
  });

  it("選んだものを、メモつきでまとめて解決する (設計ごとの差分の保存の要求)", async () => {
    mount();
    await waitFor(() => expect(rowsText()).toHaveLength(2));
    fireEvent.click(screen.getByTestId("markers-pick-all"));
    expect(screen.getByTestId("markers-bulk")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("markers-note"), { target: { value: "確認済み" } });
    fireEvent.click(screen.getByTestId("markers-resolve-picked"));
    await waitFor(() => expect(request.mock.calls.filter((c) => c[0] === "applyMarkerChanges")).toHaveLength(2));
    const calls = request.mock.calls.filter((c) => c[0] === "applyMarkerChanges").map((c) => c[1] as { entityType: string; entityId: string; changes: { updated: Array<{ resolution: string; resolvedAt: string }> } });
    expect(calls.map((c) => `${c.entityType}:${c.entityId}`).sort()).toEqual(["screen:cart", "table:orders"]);
    expect(calls[0].changes.updated[0].resolution).toBe("確認済み");
    expect(calls[0].changes.updated[0].resolvedAt).toBeTruthy();
  });

  it("読み込みの失敗・マーカーが無いときの案内", async () => {
    request.mockImplementation(async () => { throw new Error("つながりません"); });
    const { unmount } = mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("つながりません");
    unmount();
    request.mockImplementation(async () => ({ items: [], total: 0, unresolved: 0 }));
    mount();
    expect(await screen.findByText(/該当するマーカーはありません/)).toBeInTheDocument();
  });
});
