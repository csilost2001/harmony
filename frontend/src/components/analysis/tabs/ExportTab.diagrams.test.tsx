/** 設計の分析 > 書き出し > 図: 対象と形式を選んで、コピー・保存できる (図の中身そのものは、document/officeExport.test.ts) */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { loadExample } from "../logic/fixtures";

const saveTextFile = vi.fn();
const copyText = vi.fn();
vi.mock("../fileIo", () => ({ saveTextFile: (...a: unknown[]) => saveTextFile(...a), copyText: (...a: unknown[]) => copyText(...a), withBom: (s: string) => s }));
import { ExportTab } from "./ExportTab";

beforeEach(() => { saveTextFile.mockReset(); copyText.mockReset(); });
const open = () => { render(<ExportTab input={loadExample("retail")} />); fireEvent.click(screen.getByRole("button", { name: /^図/ })); };

describe("図の書き出し", () => {
  it("最初は ER 図の Mermaid。PlantUML に切り替えられる。ER 図の SVG は選べない", () => {
    open();
    const preview = screen.getByTestId("an-diagram-preview");
    expect(preview.textContent).toContain("erDiagram");
    expect((screen.getByTestId("an-diagram-format-svg") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("an-diagram-format-plantuml"));
    expect(screen.getByTestId("an-diagram-preview").textContent).toContain("@startuml");
  });

  it("処理フロー・業務フローは SVG も選べて、図 (画像) を表示する。コピーと保存は、そのときの形式と名前で行う", () => {
    open();
    const target = screen.getByTestId("an-diagram-target") as HTMLSelectElement;
    const opt = [...target.options].find((o) => o.textContent === "処理フロー図: カート追加")!;
    fireEvent.change(target, { target: { value: opt.value } });
    fireEvent.click(screen.getByTestId("an-diagram-format-svg"));
    const preview = screen.getByTestId("an-diagram-preview");
    expect(preview.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(preview.textContent).toContain("<svg");
    fireEvent.click(screen.getByTestId("an-diagram-save"));
    expect(saveTextFile).toHaveBeenCalledWith("processFlow-cart-add.svg", expect.stringContaining("<svg"), "image/svg+xml");
    fireEvent.click(screen.getByTestId("an-diagram-copy"));
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining("<svg"));
    // SVG を選んだまま、SVG のない図 (ER) へ変えると、Mermaid に戻る
    fireEvent.change(target, { target: { value: "0" } });
    expect(screen.getByTestId("an-diagram-preview").textContent).toContain("erDiagram");
    fireEvent.click(screen.getByTestId("an-diagram-save"));
    expect(saveTextFile).toHaveBeenLastCalledWith("er.mmd", expect.stringContaining("erDiagram"), "text/plain");
  });

  it("業務フロー図は、レーンごとにまとめた PlantUML の package になる", () => {
    open();
    const target = screen.getByTestId("an-diagram-target") as HTMLSelectElement;
    const opt = [...target.options].find((o) => o.textContent?.startsWith("業務フロー図:"))!;
    fireEvent.change(target, { target: { value: opt.value } });
    fireEvent.click(screen.getByTestId("an-diagram-format-plantuml"));
    expect(screen.getByTestId("an-diagram-preview").textContent).toContain('package "');
    fireEvent.click(screen.getByTestId("an-diagram-save"));
    expect(saveTextFile.mock.calls[0][0]).toMatch(/^businessFlow-[A-Za-z0-9_-]+\.puml$/);
  });
});
