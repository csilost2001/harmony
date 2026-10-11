import { describe, it, expect } from "vitest";
import { isPasteIntoField, looksLikeSpreadsheet } from "./pasteDetect";

describe("貼り付けの判定", () => {
  it("タブを含む複数セルの文は表、1 セルや空は表ではない", () => {
    expect(looksLikeSpreadsheet("a\tb\n1\t2")).toBe(true);
    expect(looksLikeSpreadsheet("ただの文")).toBe(false);
    expect(looksLikeSpreadsheet("")).toBe(false);
    expect(looksLikeSpreadsheet(null)).toBe(false);
    expect(looksLikeSpreadsheet("\t\n  ")).toBe(false);
  });
  it("入力欄の中の貼り付けは、ふつうの貼り付けにする", () => {
    expect(isPasteIntoField({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isPasteIntoField({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isPasteIntoField({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
    expect(isPasteIntoField(null)).toBe(false);
  });
});
