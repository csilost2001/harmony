import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText, saveTextFile, withBom } from "./fileIo";

const toast = vi.fn();
vi.mock("../../utils/toast", () => ({ showToast: (...a: unknown[]) => toast(...a) }));

afterEach(() => { vi.restoreAllMocks(); toast.mockReset(); });

describe("fileIo", () => {
  it("CSV の先頭に BOM を付ける", () => {
    expect(withBom("a,b").charCodeAt(0)).toBe(0xfeff);
    expect(withBom("a,b").slice(1)).toBe("a,b");
  });

  it("ファイルとして保存する (ファイル名・種類つき)。リンクは、保存のあとに片づける", () => {
    const click = vi.fn();
    const created: HTMLAnchorElement[] = [];
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => { const el = orig(tag); if (tag === "a") { created.push(el as HTMLAnchorElement); (el as HTMLAnchorElement).click = click; } return el; });
    const url = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: url, revokeObjectURL: vi.fn() });
    saveTextFile("a.csv", "x", "text/csv");
    expect(click).toHaveBeenCalledTimes(1);
    expect(created[0].download).toBe("a.csv");
    expect(document.body.contains(created[0])).toBe(false);
    expect((url.mock.calls[0] as unknown as [Blob])[0].type).toBe("text/csv;charset=utf-8");
  });

  it("コピーできたら知らせ、できなければ、許可が要ることを知らせる", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    await copyText("x");
    expect(toast).toHaveBeenLastCalledWith("コピーしました");
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await copyText("x");
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining("許可"), "error");
  });
});
