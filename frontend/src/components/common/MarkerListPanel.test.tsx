import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { MarkerListPanel, type MarkerListPanelProps } from "./MarkerListPanel";
import type { Marker } from "../../types/v3";
import { isUuid } from "@harmony/shared";

const mk = (over: Partial<Marker> = {}): Marker => ({
  id: "11111111-1111-4111-8111-111111111111" as Marker["id"], kind: "todo", body: "金額の列を足して", author: "human",
  createdAt: "2026-01-01T00:00:00.000Z" as Marker["createdAt"], ...over,
});

function Harness({ initial = [], ...rest }: { initial?: Marker[] } & Partial<MarkerListPanelProps>) {
  const [markers, setMarkers] = useState<Marker[]>(initial);
  return (
    <>
      <MarkerListPanel markers={markers} onChange={setMarkers} entity={{ type: "table", id: "orders", name: "注文" }} expanded {...rest} />
      <output data-testid="json">{JSON.stringify(markers)}</output>
    </>
  );
}
const stored = (): Marker[] => JSON.parse(screen.getByTestId("json").textContent ?? "[]");

describe("MarkerListPanel", () => {
  beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); });

  it("Enter で追加 (UUID の id・人間・種類)。Shift+Enter は改行で追加しない。日本語の変換中の Enter は追加しない", () => {
    render(<Harness />);
    const box = screen.getByTestId("marker-add-input");
    fireEvent.change(screen.getByLabelText("マーカーの種類"), { target: { value: "question" } });
    fireEvent.change(box, { target: { value: "1 行目\n2 行目" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(stored()).toHaveLength(0);
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    expect(stored()).toHaveLength(0);
    fireEvent.keyDown(box, { key: "Enter" });
    const [m] = stored();
    expect(isUuid(m.id)).toBe(true);
    expect(m).toMatchObject({ kind: "question", author: "human", body: "1 行目\n2 行目" });
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("位置の選択肢があれば、選んだ位置が anchor.fieldPath に入る。無ければ位置の選択を出さない", () => {
    const { unmount } = render(<Harness anchorChoices={[{ value: "$.columns[col-01]", label: "カラム ID" }, { value: "$.columns[col-02]", label: "カラム 金額" }]} />);
    fireEvent.change(screen.getByTestId("marker-anchor-select"), { target: { value: "$.columns[col-02]" } });
    fireEvent.change(screen.getByTestId("marker-add-input"), { target: { value: "型を DECIMAL に" } });
    fireEvent.click(screen.getByTestId("marker-add-btn"));
    expect(stored()[0].anchor).toEqual({ fieldPath: "$.columns[col-02]" });
    expect(screen.getByText("カラム col-02")).toBeInTheDocument(); // 位置の表示
    unmount();
    render(<Harness />);
    expect(screen.queryByTestId("marker-anchor-select")).toBeNull();
  });

  it("位置の指定 (presetAnchor) が、追加欄の位置の選択に反映される", () => {
    const choices = [{ value: "$.columns[col-02]", label: "カラム 金額" }];
    const { rerender } = render(<MarkerListPanel markers={[]} onChange={() => undefined} entity={{ type: "table", id: "orders" }} expanded anchorChoices={choices} />);
    rerender(<MarkerListPanel markers={[]} onChange={() => undefined} entity={{ type: "table", id: "orders" }} expanded anchorChoices={choices} presetAnchor="$.columns[col-02]" />);
    expect((screen.getByTestId("marker-anchor-select") as HTMLSelectElement).value).toBe("$.columns[col-02]");
  });

  it("解決 (メモつき・Ctrl+Enter)・未解決に戻す・削除。解決済みは、既定では出さない", () => {
    render(<Harness initial={[mk()]} />);
    fireEvent.click(screen.getByTitle("解決済みにする (メモ付き)"));
    const note = screen.getByPlaceholderText(/解決メモ/);
    fireEvent.change(note, { target: { value: "列を足した" } });
    fireEvent.keyDown(note, { key: "Enter", ctrlKey: true });
    expect(stored()[0]).toMatchObject({ resolution: "列を足した" });
    expect(stored()[0].resolvedAt).toBeTruthy();
    expect(screen.queryByText("金額の列を足して")).toBeNull(); // 解決済みは隠れる
    fireEvent.click(screen.getByLabelText("解決済みも表示", { exact: false }));
    expect(screen.getByText("金額の列を足して")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("未解決に戻す"));
    expect(stored()[0].resolvedAt).toBeUndefined();
    fireEvent.click(screen.getByTitle("削除"));
    expect(stored()).toHaveLength(0);
  });

  it("種類で絞り込める (凡例を兼ねる)。1 種類しか無ければ、絞り込みの印は出さない", () => {
    render(<Harness initial={[mk({ id: "a1111111-1111-4111-8111-111111111111" as Marker["id"], kind: "todo", body: "T" }), mk({ id: "b1111111-1111-4111-8111-111111111111" as Marker["id"], kind: "question", body: "Q" })]} />);
    expect(screen.getByText("T")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /質問/, pressed: false }));
    expect(screen.queryByText("T")).toBeNull();
    expect(screen.getByText("Q")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /質問/, pressed: true }));
    expect(screen.getByText("T")).toBeInTheDocument();
  });

  it("「AI に渡す文をコピー」: 未解決だけを、対象の設計と位置つきの依頼の文にする。無ければ押せない", async () => {
    const { unmount } = render(<Harness initial={[mk({ anchor: { fieldPath: "$.columns[col-02]" } })]} />);
    fireEvent.click(screen.getByTestId("marker-copy-ai"));
    const text = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(text).toContain("テーブル 「注文」(orders) の カラム col-02");
    expect(text).toContain("金額の列を足して");
    expect(text).toContain("/designer-work");
    unmount();
    render(<Harness initial={[]} />);
    expect(screen.getByTestId("marker-copy-ai")).toBeDisabled();
  });

  it("閲覧のみ (readOnly) では、追加欄を出さず、解決・削除も押せない", () => {
    render(<Harness initial={[mk()]} readOnly />);
    expect(screen.queryByTestId("marker-add-input")).toBeNull();
    expect(screen.getByTitle("削除")).toBeDisabled();
    expect(screen.getByTitle("解決済みにする (メモ付き)")).toBeDisabled();
  });

  it("折りたたみ: 見出しの件数・開閉。focusToken で、開いて追加欄へフォーカスする", () => {
    function Collapsible() {
      const [token, setToken] = useState(0);
      return (<><button onClick={() => setToken((t) => t + 1)}>go</button><MarkerListPanel markers={[mk()]} onChange={() => undefined} entity={{ type: "table", id: "orders" }} focusToken={token} /></>);
    }
    vi.useFakeTimers();
    render(<Collapsible />);
    expect(screen.getByText(/1 未解決 \/ 1 総件数/)).toBeInTheDocument();
    expect(screen.queryByTestId("marker-add-input")).toBeNull();
    fireEvent.click(screen.getByText("go"));
    act(() => { vi.advanceTimersByTime(5); });   // 開く
    act(() => { vi.advanceTimersByTime(100); }); // 追加欄へフォーカス
    expect(screen.getByTestId("marker-add-input")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("marker-add-input"));
    vi.useRealTimers();
  });

  it("位置が既に無いマーカーには「該当なし」の印、「位置へ」で位置を示す", () => {
    const onJump = vi.fn();
    const m = mk({ anchor: { fieldPath: "$.columns[gone]" } });
    render(<Harness initial={[m]} isOrphan={() => true} onJump={onJump} />);
    expect(screen.getByText(/該当なし/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/位置へ/));
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: m.id }));
  });
});
