import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Step, StepType } from "../../../types/v3";
import { OutlineEditor } from "./OutlineEditor";

const KINDS: StepType[] = ["validation", "dbAccess", "commonProcess"];
const steps = [
  { id: "step-01", kind: "validation", description: "入力を検証する" },
  { id: "step-02", kind: "dbAccess", description: "カートを取得する" },
] as unknown as Step[];

describe("OutlineEditor", () => {
  it("工程を 1 行 1 工程の文字で見せる", () => {
    render(<OutlineEditor steps={steps} kinds={KINDS} readonly={false} onApply={vi.fn()} />);
    expect((screen.getByTestId("pf-outline-text") as HTMLTextAreaElement).value).toBe(
      "[入力チェック] 入力を検証する ^step-01\n[DBアクセス] カートを取得する ^step-02",
    );
  });

  it("行を足すと「追加 1 件」と出て、反映で行の内容が渡る", () => {
    const onApply = vi.fn();
    render(<OutlineEditor steps={steps} kinds={KINDS} readonly={false} onApply={onApply} />);
    const area = screen.getByTestId("pf-outline-text");
    fireEvent.change(area, { target: { value: "[入力チェック] 入力を検証する ^step-01\n[DBアクセス] カートを取得する ^step-02\n[共通処理] 在庫を引き当てる" } });
    expect(screen.getByRole("status").textContent).toContain("追加 1 件");
    fireEvent.click(screen.getByTestId("pf-outline-apply"));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toHaveLength(3);
  });

  it("書式の誤りがあると行番号を出し、反映できない", () => {
    render(<OutlineEditor steps={steps} kinds={KINDS} readonly={false} onApply={vi.fn()} />);
    fireEvent.change(screen.getByTestId("pf-outline-text"), { target: { value: "種類のない行" } });
    expect(screen.getByTestId("pf-outline-errors").textContent).toContain("1 行目");
    expect((screen.getByTestId("pf-outline-apply") as HTMLButtonElement).disabled).toBe(true);
  });

  it("閲覧中は読み取り専用", () => {
    render(<OutlineEditor steps={steps} kinds={KINDS} readonly onApply={vi.fn()} />);
    expect((screen.getByTestId("pf-outline-text") as HTMLTextAreaElement).readOnly).toBe(true);
  });
});

describe("OutlineEditor — 元の内容が変わったとき", () => {
  it("入力中の内容は、元の工程が変わったら破棄して知らせる (別のアクションの工程を置き換えない)", () => {
    const onApply = vi.fn();
    const other = [{ id: "step-09", kind: "commonProcess", description: "別アクションの工程" }] as unknown as Step[];
    const { rerender } = render(<OutlineEditor steps={steps} kinds={KINDS} readonly={false} onApply={onApply} />);
    // 削除を含む入力 (自動では反映されない)
    fireEvent.change(screen.getByTestId("pf-outline-text"), { target: { value: "[入力チェック] 入力を検証する ^step-01" } });
    expect(screen.getByRole("status").textContent).toContain("削除 1 件");
    // 元の工程が別のもの (アクションの切り替え・元に戻す等) になった
    rerender(<OutlineEditor steps={other} kinds={KINDS} readonly={false} onApply={onApply} />);
    expect((screen.getByTestId("pf-outline-text") as HTMLTextAreaElement).value).toBe("[共通処理] 別アクションの工程 ^step-09");
    expect(screen.getByTestId("pf-outline-stale")).toBeTruthy();
    expect(screen.queryByTestId("pf-outline-apply")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("OutlineEditor — 字下げ (入れ子)", () => {
  it("Tab で行を字下げ、Shift+Tab で戻す。字下げすると「入れ子の位置を変更」になる", () => {
    render(<OutlineEditor steps={steps} kinds={KINDS} readonly={false} onApply={vi.fn()} />);
    const area = screen.getByTestId("pf-outline-text") as HTMLTextAreaElement;
    const secondLineStart = area.value.indexOf("\n") + 1;
    area.focus();
    area.setSelectionRange(secondLineStart + 2, secondLineStart + 2);
    fireEvent.keyDown(area, { key: "Tab" });
    expect(area.value.split("\n")[1].startsWith("  [DBアクセス]")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("順序を変更");
    fireEvent.keyDown(area, { key: "Tab", shiftKey: true });
    expect(area.value.split("\n")[1].startsWith("[DBアクセス]")).toBe(true);
  });
});

describe("OutlineEditor — 参照先の選択", () => {
  it("[DBアクセス の直後の ':' でテーブルの候補が出て、選ぶと [DBアクセス:orders] になる", async () => {
    const onApply = vi.fn();
    render(<OutlineEditor steps={[]} kinds={["dbAccess", "validation"] as StepType[]} readonly={false} onApply={onApply}
      refCandidates={{ dbAccess: [{ id: "orders", label: "注文" }, { id: "customers", label: "顧客" }] }} />);
    const area = screen.getByTestId("pf-outline-text") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "[DBアクセス" } });
    area.setSelectionRange(area.value.length, area.value.length);
    fireEvent.keyDown(area, { key: ":" });
    expect(await screen.findByTestId("outline-ref-menu")).toBeTruthy();
    expect(area.value).toBe("[DBアクセス:");
    fireEvent.change(screen.getByTestId("outline-ref-input"), { target: { value: "注" } });
    const items = screen.getAllByTestId("outline-ref-item");
    expect(items).toHaveLength(1);
    fireEvent.click(items[0]);
    await waitFor(() => expect((screen.getByTestId("pf-outline-text") as HTMLTextAreaElement).value).toBe("[DBアクセス:orders] "));
    expect(screen.getByRole("status").textContent).toContain("追加 1 件");
  });

  it("参照先を持たない種類では、':' で候補を出さない", () => {
    render(<OutlineEditor steps={[]} kinds={["dbAccess", "validation"] as StepType[]} readonly={false} onApply={vi.fn()} refCandidates={{ dbAccess: [{ id: "a", label: "a" }] }} />);
    const area = screen.getByTestId("pf-outline-text") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "[入力チェック" } });
    area.setSelectionRange(area.value.length, area.value.length);
    fireEvent.keyDown(area, { key: ":" });
    expect(screen.queryByTestId("outline-ref-menu")).toBeNull();
  });
});
