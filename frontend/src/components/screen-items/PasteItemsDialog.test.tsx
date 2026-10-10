import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PasteItemsDialog } from "./PasteItemsDialog";

describe("PasteItemsDialog", () => {
  it("貼り付けた表をプレビューし、既にある ID は除いて追加する", () => {
    const onAdd = vi.fn(); const onClose = vi.fn();
    render(<PasteItemsDialog existing={[{ id: "qty" as never }]} onAdd={onAdd} onClose={onClose} />);
    fireEvent.change(screen.getByTestId("paste-items-text"), { target: { value: "項目ID\tラベル\t型\nqty\t数量\t整数\nunitPrice\t単価\t数値" } });
    expect(screen.getByTestId("paste-items-preview").textContent).toContain("unitPrice");
    expect(screen.getByTestId("paste-items-dup").textContent).toContain("qty");
    fireEvent.click(screen.getByTestId("paste-items-add"));
    expect(onAdd.mock.calls[0][0].map((i: { id: string }) => i.id)).toEqual(["unitPrice"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("何も貼っていないあいだは追加できない", () => {
    render(<PasteItemsDialog existing={[]} onAdd={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByTestId("paste-items-add") as HTMLButtonElement).disabled).toBe(true);
  });
});
