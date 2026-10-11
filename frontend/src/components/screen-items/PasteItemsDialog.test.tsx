import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PasteItemsDialog } from "./PasteItemsDialog";

describe("PasteItemsDialog", () => {
  it("貼り付けた表をプレビューし、既にある ID は除いて追加する", () => {
    const onApply = vi.fn(); const onClose = vi.fn();
    render(<PasteItemsDialog existing={[{ id: "qty", label: "数量", type: "integer" } as never]} onApply={onApply} onClose={onClose} />);
    fireEvent.change(screen.getByTestId("paste-items-text"), { target: { value: "項目ID\tラベル\t型\nqty\t数量\t整数\nunitPrice\t単価\t数値" } });
    expect(screen.getByTestId("paste-items-preview").textContent).toContain("unitPrice");
    expect(screen.getByTestId("paste-items-dup").textContent).toContain("qty");
    fireEvent.click(screen.getByTestId("paste-items-add"));
    expect(onApply.mock.calls[0][0].map((i: { id: string }) => i.id)).toEqual(["unitPrice"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("何も貼っていないあいだは追加できない", () => {
    render(<PasteItemsDialog existing={[]} onApply={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByTestId("paste-items-add") as HTMLButtonElement).disabled).toBe(true);
  });

  it("いまの項目を、貼り戻せる形式の表としてコピーできる", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PasteItemsDialog existing={[{ id: "qty", label: "数量", type: "integer", required: true } as never]} onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("paste-items-copy-current"));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("qty\t数量\t整数");
  });

  it("「既にある項目も更新する」にすると、表にある項目だけを更新として渡す", () => {
    const onApply = vi.fn();
    render(<PasteItemsDialog existing={[{ id: "qty", label: "数量", type: "integer", required: true } as never]} onApply={onApply} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("paste-items-text"), { target: { value: "項目ID\tラベル\nqty\t購入数量" } });
    fireEvent.click(screen.getByTestId("paste-items-update"));
    fireEvent.click(screen.getByTestId("paste-items-add"));
    expect(onApply).toHaveBeenCalledWith([], [{ id: "qty", patch: { label: "購入数量" } }]);
  });
});
