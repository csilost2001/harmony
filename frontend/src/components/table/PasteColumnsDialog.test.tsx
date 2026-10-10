import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PasteColumnsDialog } from "./PasteColumnsDialog";

const SAMPLE = "物理名\t表示名\tデータ型\t長さ\tNOT NULL\tPK\ncustomer_id\t顧客ID\tBIGINT\t\t○\t○\ncustomer_name\t顧客名\tvarchar(100)\t\t○\t\nid\t重複\tint\t\t\t";

describe("PasteColumnsDialog", () => {
  it("貼り付けた表をプレビューし、既にある物理名は除いて追加する", () => {
    const onAdd = vi.fn(); const onClose = vi.fn();
    render(<PasteColumnsDialog existing={[{ physicalName: "id" as never }]} onAdd={onAdd} onClose={onClose} />);
    expect((screen.getByTestId("paste-columns-add") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("paste-columns-text"), { target: { value: SAMPLE } });
    const preview = screen.getByTestId("paste-columns-preview");
    expect(preview.textContent).toContain("customer_id");
    expect(preview.textContent).toContain("顧客名");
    expect(screen.getByTestId("paste-columns-dup").textContent).toContain("id");
    fireEvent.click(screen.getByTestId("paste-columns-add"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0][0].map((c: { physicalName: string }) => c.physicalName)).toEqual(["customer_id", "customer_name"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("読み取れない点は警告として出す", () => {
    render(<PasteColumnsDialog existing={[]} onAdd={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("paste-columns-text"), { target: { value: "物理名\t型\na\tgeometry" } });
    expect(screen.getByTestId("paste-columns-warnings").textContent).toContain("geometry");
  });

  it("Esc で閉じる", () => {
    const onClose = vi.fn();
    render(<PasteColumnsDialog existing={[]} onAdd={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
