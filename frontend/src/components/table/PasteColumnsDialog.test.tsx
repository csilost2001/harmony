import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PasteColumnsDialog } from "./PasteColumnsDialog";

const SAMPLE = "物理名\t表示名\tデータ型\t長さ\tNOT NULL\tPK\ncustomer_id\t顧客ID\tBIGINT\t\t○\t○\ncustomer_name\t顧客名\tvarchar(100)\t\t○\t\nid\t重複\tint\t\t\t";

describe("PasteColumnsDialog", () => {
  it("貼り付けた表をプレビューし、既にある物理名は除いて追加する", () => {
    const onApply = vi.fn(); const onClose = vi.fn();
    render(<PasteColumnsDialog existing={[{ id: "c1", physicalName: "id", name: "ID", dataType: "INTEGER" } as never]} onApply={onApply} onClose={onClose} />);
    expect((screen.getByTestId("paste-columns-add") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("paste-columns-text"), { target: { value: SAMPLE } });
    const preview = screen.getByTestId("paste-columns-preview");
    expect(preview.textContent).toContain("customer_id");
    expect(preview.textContent).toContain("顧客名");
    expect(screen.getByTestId("paste-columns-dup").textContent).toContain("id");
    fireEvent.click(screen.getByTestId("paste-columns-add"));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].map((c: { physicalName: string }) => c.physicalName)).toEqual(["customer_id", "customer_name"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("読み取れない点は警告として出す", () => {
    render(<PasteColumnsDialog existing={[]} onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("paste-columns-text"), { target: { value: "物理名\t型\na\tgeometry" } });
    expect(screen.getByTestId("paste-columns-warnings").textContent).toContain("geometry");
  });

  it("Esc で閉じる", () => {
    const onClose = vi.fn();
    render(<PasteColumnsDialog existing={[]} onApply={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("いまのカラムを、貼り戻せる形式の表としてコピーできる", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PasteColumnsDialog existing={[{ id: "c1", physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true } as never]} onApply={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("paste-columns-copy-current"));
    expect(writeText.mock.calls[0][0]).toContain("id\tID\tBIGINT");
  });

  it("「既にあるカラムも更新する」にすると、表にある項目だけを更新として渡す", () => {
    const onApply = vi.fn();
    render(<PasteColumnsDialog existing={[{ id: "c1", physicalName: "id", name: "ID", dataType: "INTEGER" } as never]} onApply={onApply} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("paste-columns-text"), { target: { value: "物理名\t表示名\nid\t識別子" } });
    expect((screen.getByTestId("paste-columns-add") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("paste-columns-update"));
    expect(screen.getByTestId("paste-columns-update-list").textContent).toContain("name");
    fireEvent.click(screen.getByTestId("paste-columns-add"));
    expect(onApply).toHaveBeenCalledWith([], [{ id: "c1", physicalName: "id", patch: { name: "識別子" } }]);
  });
});
