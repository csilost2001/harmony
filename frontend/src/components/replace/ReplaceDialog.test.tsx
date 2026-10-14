import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const request = vi.fn();
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { request: (...a: unknown[]) => request(...a) } }));

import { ReplaceDialog } from "./ReplaceDialog";
import { requestHeaderPanel } from "../../utils/headerPanels";

const preview = (over: Record<string, unknown> = {}) => ({
  candidates: [
    { key: "table:orders#name", kind: "table", id: "orders", entityName: "顧客注文", where: "名前", before: "顧客注文", after: "取引先注文" },
    { key: "table:orders#comment", kind: "table", id: "orders", entityName: "顧客注文", where: "備考", before: "顧客ごとの受注", after: "取引先ごとの受注" },
    { key: "screen:cart#name", kind: "screen", id: "cart", entityName: "カート", where: "名前", before: "顧客カート", after: "取引先カート" },
  ],
  total: 3, truncated: false, entities: 2, blocked: [], ...over,
});

function setup() {
  request.mockImplementation(async (method: string) => {
    if (method === "designReplace.listUndo") return [];
    if (method === "designReplace.preview") return preview();
    if (method === "designReplace.apply") return { operationId: "op1", replaced: 3, files: 3, skipped: [], touched: [] };
    return null;
  });
  render(<MemoryRouter><ReplaceDialog /></MemoryRouter>);
  act(() => requestHeaderPanel("replace"));
}

describe("ReplaceDialog (設計全体の検索置換)", () => {
  beforeEach(() => { request.mockReset(); });

  it("探す → 一覧に置換後の文言つきで出る → 全部選択された状態で適用できる。適用には、予行で見せた文言を渡す", async () => {
    setup();
    fireEvent.change(screen.getByTestId("replace-query"), { target: { value: "顧客" } });
    fireEvent.change(screen.getByTestId("replace-replacement"), { target: { value: "取引先" } });
    fireEvent.click(screen.getByTestId("replace-search"));
    await waitFor(() => expect(screen.getByTestId("replace-summary").textContent).toContain("3 か所"));
    expect(screen.getAllByTestId("replace-group")).toHaveLength(2);
    expect(screen.getByTestId("replace-apply").textContent).toContain("3 か所を置換");
    fireEvent.click(screen.getByTestId("replace-apply"));
    await waitFor(() => expect(screen.getByTestId("replace-result").textContent).toContain("3 か所を置換しました"));
    const call = request.mock.calls.find((c) => c[0] === "designReplace.apply")!;
    expect(call[1]).toMatchObject({ query: "顧客", replacement: "取引先", caseSensitive: false });
    expect(call[1].selected).toEqual(expect.arrayContaining([{ key: "table:orders#name", before: "顧客注文" }]));
  });

  it("外したものは適用に含めない。入力を変えたら、探し直すまで適用できない", async () => {
    setup();
    fireEvent.change(screen.getByTestId("replace-query"), { target: { value: "顧客" } });
    fireEvent.click(screen.getByTestId("replace-search"));
    await waitFor(() => screen.getByTestId("replace-list"));
    fireEvent.click(screen.getAllByTestId("replace-item")[1]); // 備考を外す
    expect(screen.getByTestId("replace-apply").textContent).toContain("2 か所を置換");
    fireEvent.change(screen.getByTestId("replace-replacement"), { target: { value: "別の語" } });
    expect(screen.getByTestId("replace-stale")).toBeInTheDocument();
    expect(screen.getByTestId("replace-apply")).toBeDisabled();
  });

  it("置換後が空になる候補は、初めから選ばず、警告を出す。編集中の設計は選べない", async () => {
    request.mockImplementation(async (m: string) => (m === "designReplace.listUndo" ? [] : m === "designReplace.preview" ? preview({
      candidates: [
        { key: "table:t1#name", kind: "table", id: "t1", entityName: "顧客", where: "名前", before: "顧客", after: "" },
        { key: "table:t2#comment", kind: "table", id: "t2", entityName: "別", where: "備考", before: "顧客あ", after: "あ" },
      ],
      blocked: [{ kind: "table", id: "t2", reason: "編集中のため" }], total: 2, entities: 2,
    }) : null));
    render(<MemoryRouter><ReplaceDialog /></MemoryRouter>);
    act(() => requestHeaderPanel("replace"));
    fireEvent.change(screen.getByTestId("replace-query"), { target: { value: "顧客" } });
    fireEvent.click(screen.getByTestId("replace-search"));
    await waitFor(() => screen.getByTestId("replace-list"));
    expect(screen.getByTestId("replace-empty-warn")).toBeInTheDocument();
    expect(screen.getByTestId("replace-apply")).toBeDisabled(); // 空になるものは選んでおらず、残りは編集中
    expect(screen.getAllByTestId("replace-item").every((el) => !(el as HTMLInputElement).checked || (el as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getByText("編集中のため")).toBeInTheDocument();
  });

  it("直前の置換は、一覧に出て、取り消せる", async () => {
    request.mockImplementation(async (m: string) => (m === "designReplace.listUndo" ? [{ operationId: "op9", replaced: 5, files: 2, query: "顧客", replacement: "取引先", remainingMs: 600000 }] : m === "designReplace.undo" ? { restored: 2, conflicts: [] } : null));
    render(<MemoryRouter><ReplaceDialog /></MemoryRouter>);
    act(() => requestHeaderPanel("replace"));
    await waitFor(() => expect(screen.getByTestId("replace-undo-list").textContent).toContain("5 か所"));
    fireEvent.click(screen.getByTestId("replace-undo"));
    await waitFor(() => expect(request).toHaveBeenCalledWith("designReplace.undo", { operationId: "op9" }));
  });

  it("Ctrl+Shift+H で開き、Esc で閉じる", () => {
    request.mockResolvedValue([]);
    render(<MemoryRouter><ReplaceDialog /></MemoryRouter>);
    expect(screen.queryByTestId("replace-dialog")).toBeNull();
    fireEvent.keyDown(document, { key: "H", ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId("replace-dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("replace-dialog")).toBeNull();
  });
});
