import { describe, expect, it } from "vitest";
import { buildVarLabels, noteWithWords } from "@harmony/shared";

describe("noteWithWords", () => {
  const labels = buildVarLabels({ steps: [{ id: "s", kind: "dbAccess", outputBinding: { name: "cust", label: "顧客$&様$$" } }] });
  it("実行条件の式を言葉にし、もとの式を返す。呼び名に $ が入っていても、備考が壊れない", () => {
    const n = noteWithWords("実行条件: @cust == null / HTTP 200", "@cust == null", labels);
    expect(n.text).toBe("実行条件: 顧客$&様$$ が ない / HTTP 200");
    expect(n.raw).toBe("@cust == null");
  });
  it("実行条件が無い・言葉にできないときは、そのまま", () => {
    expect(noteWithWords("HTTP 200", undefined, labels)).toEqual({ text: "HTTP 200", raw: null });
    expect(noteWithWords("実行条件: fn(@x)", "fn(@x)", labels).raw).toBeNull();
  });
});
