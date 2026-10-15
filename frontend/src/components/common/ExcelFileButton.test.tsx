import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { buildXlsx } from "@harmony/shared";

const reportFailure = vi.fn();
vi.mock("../../utils/failureToast", () => ({ reportFailure: (...a: unknown[]) => reportFailure(...a) }));
import { ExcelFileButton } from "./ExcelFileButton";

beforeEach(() => reportFailure.mockReset());
const fileOf = (bytes: Uint8Array, name = "a.xlsx") => new File([bytes as BlobPart], name);
const pick = (f: File) => fireEvent.change(screen.getByTestId("excel-file-input"), { target: { files: [f] } });

describe("Excel ファイルを読む", () => {
  it("1 シートなら、そのシートをタブ区切りにして渡し、読んだことを示す", async () => {
    const onText = vi.fn();
    render(<ExcelFileButton onText={onText} />);
    pick(fileOf(buildXlsx([{ name: "カラム", rows: [{ cells: ["物理名", "表示名"] }, { cells: ["id", "ID"] }] }])));
    await waitFor(() => expect(onText).toHaveBeenCalledWith("物理名\t表示名\nid\tID"));
    expect((await screen.findByTestId("excel-file")).textContent).toContain("a.xlsx の「カラム」を読みました");
  });

  it("複数シートなら、選べる (空のシートは出さない)。選び直すと、そのシートを渡す", async () => {
    const onText = vi.fn();
    render(<ExcelFileButton onText={onText} />);
    pick(fileOf(buildXlsx([{ name: "表紙", rows: [{ cells: ["題"] }] }, { name: "空", rows: [] }, { name: "項目", rows: [{ cells: ["a", "b"] }] }])));
    const sel = (await screen.findByTestId("excel-file-sheet")) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["表紙", "項目"]);
    expect(onText).toHaveBeenLastCalledWith("題");
    fireEvent.change(sel, { target: { value: "1" } });
    expect(onText).toHaveBeenLastCalledWith("a\tb");
  });

  it("xlsx でないファイル・表のないファイルは、理由を知らせて、入力欄は変えない", async () => {
    const onText = vi.fn();
    render(<ExcelFileButton onText={onText} />);
    pick(fileOf(new TextEncoder().encode("これは Excel ではない"), "x.xlsx"));
    await waitFor(() => expect(reportFailure).toHaveBeenCalledTimes(1));
    expect((reportFailure.mock.calls[0][0] as Error).message).toContain("ZIP として読めません");
    pick(fileOf(buildXlsx([{ name: "空", rows: [] }])));
    await waitFor(() => expect(reportFailure).toHaveBeenCalledTimes(2));
    expect((reportFailure.mock.calls[1][0] as Error).message).toContain("表のあるシートが見つかりませんでした");
    expect(onText).not.toHaveBeenCalled();
  });
});
