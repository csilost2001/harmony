import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DesignDocInput } from "@harmony/shared";
import { tiny } from "../analysis/logic/fixtures";
import { nextVersion } from "./docTemplateUtil";

const templateSave = vi.fn();
const templateLoad = vi.fn();
const revisionsSuggest = vi.fn();
vi.mock("../../utils/opsApi", () => ({ opsApi: { templateSave: (...a: unknown[]) => templateSave(...a), templateLoad: () => templateLoad(), revisionsSuggest: () => revisionsSuggest() } }));
const toast = vi.fn();
vi.mock("../../utils/toast", () => ({ showToast: (...a: unknown[]) => toast(...a) }));
vi.mock("../../utils/failureToast", () => ({ reportFailure: vi.fn() }));
import { DocTemplateDialog } from "./DocTemplateDialog";

let input: DesignDocInput;
const onClose = vi.fn();
const onSaved = vi.fn();
beforeEach(() => {
  templateSave.mockReset(); templateLoad.mockReset(); revisionsSuggest.mockReset(); toast.mockReset(); onClose.mockReset(); onSaved.mockReset();
  templateLoad.mockResolvedValue({ template: {}, problems: [] });
  templateSave.mockImplementation(async (t: unknown) => ({ template: t, problems: [] }));
  localStorage.clear();
  input = tiny();
});
const open = async () => { render(<DocTemplateDialog input={input} onClose={onClose} onSaved={onSaved} />); await waitFor(() => expect(templateLoad).toHaveBeenCalled()); };

describe("nextVersion", () => {
  it("末尾の数字を 1 増やす。読めなければ 1.0.0", () => {
    expect(nextVersion("1.2.3")).toBe("1.2.4");
    expect(nextVersion("v9")).toBe("v10");
    expect(nextVersion("1.0")).toBe("1.1");
    expect(nextVersion("初版")).toBe("1.0.0");
    expect(nextVersion(undefined)).toBe("1.0.0");
  });
});

describe("設計書の体裁と改訂履歴のダイアログ", () => {
  it("体裁を入れて保存すると、入れた項目だけを送る (空にした項目は送らない)。保存したら閉じて、読み直しを促す", async () => {
    await open();
    fireEvent.change(screen.getByTestId("dt-documentTitle"), { target: { value: "要件定義書" } });
    fireEvent.change(screen.getByTestId("dt-docNumber"), { target: { value: "DD-1" } });
    fireEvent.change(screen.getByTestId("dt-organization"), { target: { value: "開発部" } });
    fireEvent.change(screen.getByTestId("dt-organization"), { target: { value: "" } }); // 入れて、消した
    fireEvent.change(screen.getByTestId("dt-accentColor"), { target: { value: "#aa3300" } });
    fireEvent.change(screen.getByTestId("dt-stamps"), { target: { value: "承認、確認,  " } });
    fireEvent.click(screen.getByTestId("dt-save"));
    await waitFor(() => expect(templateSave).toHaveBeenCalledTimes(1));
    const sent = templateSave.mock.calls[0][0];
    expect(sent).toMatchObject({ version: 1, documentTitle: "要件定義書", docNumber: "DD-1", accentColor: "#aa3300", stamps: ["承認", "確認"], excludeChapters: [], revisions: [] });
    expect("organization" in sent).toBe(false);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("設計書の体裁を保存しました");
  });

  it("載せる章: 外した章が excludeChapters になり、戻すと消える。既に設定してある内容を初期値にする", async () => {
    input = { ...input, template: { version: 1, documentTitle: "既存", excludeChapters: ["crud"], revisions: [] } };
    await open();
    expect((screen.getByTestId("dt-documentTitle") as HTMLInputElement).value).toBe("既存");
    fireEvent.click(screen.getByTestId("dt-tab-chapters"));
    expect((screen.getByTestId("dt-chapter-crud") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId("dt-chapter-crud"));
    fireEvent.click(screen.getByTestId("dt-chapter-messages"));
    fireEvent.click(screen.getByTestId("dt-save"));
    await waitFor(() => expect(templateSave).toHaveBeenCalled());
    expect(templateSave.mock.calls[0][0].excludeChapters).toEqual(["messages"]);
  });

  it("改訂履歴: 版を追加すると次の版・今日の日付・利用者名が入り、内容が空のあいだは保存できない。削除もできる", async () => {
    localStorage.setItem("harmony.userName", "花子");
    input = { ...input, template: { version: 1, excludeChapters: [], revisions: [{ version: "1.0", date: "2026-10-01", summary: "初版" }] } };
    await open();
    fireEvent.click(screen.getByTestId("dt-tab-revisions"));
    fireEvent.click(screen.getByTestId("dt-rev-add"));
    const rows = screen.getAllByTestId("dt-rev-row");
    expect(rows).toHaveLength(2);
    expect((within(rows[1]).getByLabelText("版") as HTMLInputElement).value).toBe("1.1");
    expect((within(rows[1]).getByLabelText("日付") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((within(rows[1]).getByLabelText("変更者") as HTMLInputElement).value).toBe("花子");
    expect((screen.getByTestId("dt-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(rows[1]).getByLabelText("内容"), { target: { value: "画面を追加" } });
    expect((screen.getByTestId("dt-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(rows[0]).getByRole("button", { name: "1.0 を削除" }));
    fireEvent.click(screen.getByTestId("dt-save"));
    await waitFor(() => expect(templateSave).toHaveBeenCalled());
    expect(templateSave.mock.calls[0][0].revisions).toEqual([expect.objectContaining({ version: "1.1", summary: "画面を追加", author: "花子" })]);
  });

  it("更新から下書き: 拾えたものは内容に入れる。何も無ければ、そう知らせる", async () => {
    revisionsSuggest.mockResolvedValueOnce({ since: "x", items: [], text: "", truncated: false });
    await open();
    fireEvent.click(screen.getByTestId("dt-tab-revisions"));
    fireEvent.click(screen.getByTestId("dt-rev-suggest"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("前回の改訂のあとに更新された設計は、見つかりませんでした"));
    expect(screen.queryAllByTestId("dt-rev-row")).toHaveLength(0);
    revisionsSuggest.mockResolvedValueOnce({ since: "x", items: [{ kind: "table", id: "a", name: "注文", saves: 2, lastAt: "x" }], text: "テーブル「注文」を更新 (2 回)", truncated: true });
    fireEvent.click(screen.getByTestId("dt-rev-suggest"));
    const row = await screen.findByTestId("dt-rev-row");
    expect((within(row).getByLabelText("内容") as HTMLTextAreaElement).value).toBe("テーブル「注文」を更新 (2 回)\n(ほかにも更新があります)");
  });

  it("設定ファイルに読めない項目があれば知らせ、そのまま保存すると捨てることを承知した保存として送る。サーバが断ったら、理由を出す", async () => {
    templateLoad.mockResolvedValue({ template: {}, problems: ["強調の色は #rrggbb の形で書いてください"] });
    templateSave.mockRejectedValueOnce(new Error("document-template.json に読めない項目があるため、書き換えません"));
    await open();
    expect((await screen.findByTestId("dt-problems")).textContent).toContain("強調の色は #rrggbb");
    fireEvent.click(screen.getByTestId("dt-save"));
    expect((await screen.findByTestId("dt-error")).textContent).toContain("書き換えません");
    expect(templateSave.mock.calls[0][1]).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape・閉じるボタンで閉じる", async () => {
    await open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
