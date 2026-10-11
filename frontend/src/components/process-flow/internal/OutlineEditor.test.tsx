import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
