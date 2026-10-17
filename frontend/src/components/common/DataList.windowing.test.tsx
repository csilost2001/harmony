import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { DataList, type DataListColumn } from "./DataList";
import { WINDOW_THRESHOLD, _resetWindowing, suspendWindowing } from "../../utils/windowing";

interface Row { id: string; name: string }
const rows = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `行 ${i}` }));
const columns: DataListColumn<Row>[] = [{ key: "name", header: "名前", render: (r) => r.name }];
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };

beforeEach(() => _resetWindowing());
afterEach(() => cleanup());

describe("DataList の窓表示 (続編 第 10 弾 #192)", () => {
  it("行が少なければ、全部描く (余白の行は無い)", () => {
    render(<DataList items={rows(WINDOW_THRESHOLD - 1)} columns={columns} getId={(r) => r.id} />);
    expect(screen.getAllByTestId("data-list-row")).toHaveLength(WINDOW_THRESHOLD - 1);
    expect(screen.queryByTestId("data-list-spacer-bottom")).toBeNull();
  });
  it("行が多ければ、見える範囲だけ描き、残りは余白の行で補う。表の行数 (aria-rowcount) は全体", async () => {
    render(<DataList items={rows(1000)} columns={columns} getId={(r) => r.id} ariaLabel="試験の表" />);
    await settle();
    const drawn = screen.getAllByTestId("data-list-row").length;
    expect(drawn).toBeLessThan(1000);
    expect(drawn).toBeGreaterThan(0);
    expect(screen.getByTestId("data-list-spacer-bottom")).toBeTruthy();
    expect(screen.getByRole("grid", { name: "試験の表" }).getAttribute("aria-rowcount")).toBe("1001");
    // 描いた行は、全体の中での位置を持つ
    expect(screen.getAllByTestId("data-list-row")[0].getAttribute("aria-rowindex")).toBe("2");
  });
  it("画面内の検索を開いている間は、窓表示を止めて、全行を描く。閉じると、戻る", async () => {
    render(<DataList items={rows(300)} columns={columns} getId={(r) => r.id} />);
    await settle();
    expect(screen.getAllByTestId("data-list-row").length).toBeLessThan(300);
    act(() => { suspendWindowing("editor-find", true); });
    expect(screen.getAllByTestId("data-list-row")).toHaveLength(300);
    act(() => { suspendWindowing("editor-find", false); });
    await settle();
    expect(screen.getAllByTestId("data-list-row").length).toBeLessThan(300);
  });
});
