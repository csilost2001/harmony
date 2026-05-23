import { describe, it, expect } from "vitest";
import { screenItemTypeResolver } from "./screenItemTypeResolver";
import type { CompletionContext } from "../../utils/reference-completer/types";
import type { LoadedExtensions } from "../../schemas/loadExtensions";

const mockExtensions: LoadedExtensions = {
  steps: {},
  fieldTypes: [
    { kind: "productCode", label: "商品コード", namespace: "retail" },
    { kind: "janCode", label: "JAN", namespace: "retail" },
  ],
  triggers: [],
  dbOperations: [],
  responseTypes: {},
};

const ctx = (extensions?: LoadedExtensions): CompletionContext => ({
  fieldKind: "extensionRef",
  extensions,
});

describe("screenItemTypeResolver", () => {
  it("空 prefix → primitives + extensions 全候補", () => {
    const r = screenItemTypeResolver.match("", 0, ctx(mockExtensions));
    expect(r?.phase).toBe("active");
    if (r?.phase === "active") {
      const vals = r.candidates.map((c) => c.value);
      expect(vals).toContain("string");
      expect(vals).toContain("number");
      expect(vals).toContain("retail:productCode");
      expect(vals).toContain("retail:janCode");
    }
  });

  it("\"str\" prefix → primitive filter", () => {
    const r = screenItemTypeResolver.match("str", 3, ctx(mockExtensions));
    expect(r?.phase).toBe("active");
    if (r?.phase === "active") {
      const vals = r.candidates.map((c) => c.value);
      expect(vals).toEqual(["string"]);
    }
  });

  it("\"retail\" prefix → extension filter", () => {
    const r = screenItemTypeResolver.match("retail", 6, ctx(mockExtensions));
    expect(r?.phase).toBe("active");
    if (r?.phase === "active") {
      const vals = r.candidates.map((c) => c.value);
      expect(vals).toContain("retail:productCode");
      expect(vals).toContain("retail:janCode");
      expect(vals).not.toContain("string");
    }
  });

  it("ctx.extensions が undefined → primitives のみ", () => {
    const r = screenItemTypeResolver.match("", 0, ctx(undefined));
    expect(r?.phase).toBe("active");
    if (r?.phase === "active") {
      const vals = r.candidates.map((c) => c.value);
      expect(vals).toContain("string");
      expect(vals).not.toContain("retail:productCode");
    }
  });
});
