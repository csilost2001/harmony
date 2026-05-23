import { describe, it, expect } from "vitest";
import { genericDefinitionResolver } from "./genericDefinitionResolver";
import type { CompletionContext } from "./types";

const makeCtx = (
  genericDefinitionsByKind?: Record<string, { name: string }[]>
): CompletionContext => ({ genericDefinitionsByKind });

describe("genericDefinitionResolver", () => {
  // ケース 1: @dialog. (空 prefix) → ctx.genericDefinitionsByKind.dialog 全件
  it("@dialog. (空 prefix) → dialog 全件候補", () => {
    const ctx = makeCtx({
      dialog: [{ name: "ConfirmDelete" }, { name: "AlertWarning" }],
    });
    const v = "@dialog.";
    const result = genericDefinitionResolver.match(v, v.length, ctx);
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.resolverId).toBe("genericDefinition");
      expect(result.prefix).toBe("");
      expect(result.candidates.map((c) => c.value)).toEqual(["ConfirmDelete", "AlertWarning"]);
      expect(result.replaceLen).toBe(0);
    }
  });

  // ケース 2: @dialog.conf (部分 prefix) → 部分マッチ
  it("@dialog.conf → ConfirmDelete のみ", () => {
    const ctx = makeCtx({
      dialog: [{ name: "ConfirmDelete" }, { name: "AlertWarning" }],
    });
    const v = "@dialog.Conf";
    const result = genericDefinitionResolver.match(v, v.length, ctx);
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toEqual(["ConfirmDelete"]);
      expect(result.prefix).toBe("Conf");
      expect(result.replaceLen).toBe(4);
    }
  });

  // ケース 3: @messageArea. → messageArea 候補
  it("@messageArea. → messageArea 全件候補", () => {
    const ctx = makeCtx({
      messageArea: [{ name: "ErrorArea" }, { name: "InfoArea" }],
    });
    const v = "@messageArea.";
    const result = genericDefinitionResolver.match(v, v.length, ctx);
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.resolverId).toBe("genericDefinition");
      expect(result.candidates.map((c) => c.value)).toEqual(["ErrorArea", "InfoArea"]);
    }
  });

  // ケース 4: @options. → options 候補
  it("@options. → options 全件候補", () => {
    const ctx = makeCtx({
      options: [{ name: "PrefectureList" }, { name: "StatusOptions" }],
    });
    const v = "@options.";
    const result = genericDefinitionResolver.match(v, v.length, ctx);
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toEqual(["PrefectureList", "StatusOptions"]);
    }
  });

  // ケース 5: genericDefinitionsByKind 未設定 → null
  it("genericDefinitionsByKind 未設定 → null", () => {
    const ctx = makeCtx(undefined);
    const v = "@dialog.";
    const result = genericDefinitionResolver.match(v, v.length, ctx);
    expect(result).toBeNull();
  });

  // ケース 6: 該当 kind の entries 空 → 空 candidates
  it("該当 kind の entries が空 → 空 candidates", () => {
    const ctx = makeCtx({ dialog: [] });
    const v = "@dialog.";
    const result = genericDefinitionResolver.match(v, v.length, ctx);
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates).toHaveLength(0);
    }
  });

  // ケース 7: 関係ないテキスト → null
  it("関係ないテキスト → null", () => {
    const ctx = makeCtx({ dialog: [{ name: "Confirm" }] });
    const v = "some regular text";
    const result = genericDefinitionResolver.match(v, v.length, ctx);
    expect(result).toBeNull();
  });

  // ケース 8: 文中でカーソルが @options.Pref の末尾 → active
  it("文中 @options.Pref → 部分マッチ候補", () => {
    const ctx = makeCtx({
      options: [{ name: "PrefectureList" }, { name: "StatusOptions" }],
    });
    const v = "select @options.Pref here";
    const cursor = "select @options.Pref".length;
    const result = genericDefinitionResolver.match(v, cursor, ctx);
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toEqual(["PrefectureList"]);
    }
  });
});
