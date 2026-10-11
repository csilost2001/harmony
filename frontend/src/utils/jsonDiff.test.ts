import { describe, it, expect } from "vitest";
import { describePath, diffJson, formatValue, summarizeChanges } from "./jsonDiff";

describe("jsonDiff", () => {
  const before = {
    name: "注文", updatedAt: "2026-01-01",
    columns: [{ id: "col-01", physicalName: "order_id", name: "注文ID", notNull: true }, { id: "col-02", physicalName: "note", name: "備考" }],
  };

  it("同じなら差はない (更新日時の差は無視)", () => {
    expect(diffJson(before, { ...structuredClone(before), updatedAt: "2026-02-02" })).toEqual([]);
  });

  it("値の変更・追加・削除を、場所つきで返す", () => {
    const after = structuredClone(before) as typeof before & { columns: Array<Record<string, unknown>> };
    after.name = "受注";
    after.columns[0].name = "注文番号";
    delete after.columns[0].notNull;
    after.columns.push({ id: "col-03", physicalName: "qty", name: "数量" });
    after.columns.splice(1, 1);
    const changes = diffJson(before, after);
    const text = changes.map((c) => `${c.kind}:${describePath(c.path)}`);
    expect(text).toContain("changed:表示名");
    expect(text).toContain("changed:カラム › 注文ID (col-01) › 表示名");
    expect(text).toContain("removed:カラム › 注文ID (col-01) › NOT NULL");
    expect(text).toContain("added:カラム › 数量 (col-03)");
    expect(text).toContain("removed:カラム › 備考 (col-02)");
    expect(summarizeChanges(changes)).toEqual({ added: 1, removed: 2, changed: 2, reordered: 0 });
  });

  it("行の挿入でも、id で対応づけるので、ほかの行が変更に見えない", () => {
    const after = structuredClone(before);
    after.columns.unshift({ id: "col-00", physicalName: "pk", name: "主キー" } as never);
    const changes = diffJson(before, after);
    expect(changes.map((c) => c.kind)).toEqual(["added"]); // 共通の要素の並びは同じなので、順序の変更は出ない
  });

  it("並べ替えだけなら、順序の変更として返す", () => {
    const after = structuredClone(before);
    after.columns.reverse();
    const changes = diffJson(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("reordered");
    expect(changes[0].after).toEqual(["col-02", "col-01"]);
  });

  it("id の無い配列は位置で比べる", () => {
    const changes = diffJson({ tags: ["a", "b"] }, { tags: ["a", "c", "d"] });
    expect(changes.map((c) => `${c.kind}:${describePath(c.path)}`)).toEqual(["changed:tags › 2", "added:tags › 3"]);
  });

  it("値を 1 行の文字にする", () => {
    expect(formatValue("")).toBe("(空)");
    expect(formatValue(undefined)).toBe("(なし)");
    expect(formatValue("a\nb")).toBe("a ↵ b");
    expect(formatValue({ name: "x", y: 1 })).toBe("{x …}");
    expect(formatValue([1, 2])).toBe("[2 件]");
    expect(formatValue("x".repeat(100))).toHaveLength(81);
  });
});
