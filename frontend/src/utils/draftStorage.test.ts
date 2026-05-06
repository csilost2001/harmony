import { describe, it, expect } from "vitest";
import { saveDraft, loadDraft, clearDraft, listAllDrafts, hasDraft } from "./draftStorage";

describe("saveDraft / loadDraft", () => {
  it("保存したデータを読み込める", () => {
    saveDraft("table", "abc", { name: "users" });
    expect(loadDraft("table", "abc")).toEqual({ name: "users" });
  });

  it("存在しないキーは null を返す", () => {
    expect(loadDraft("table", "nonexistent")).toBeNull();
  });

  it("上書き保存できる", () => {
    saveDraft("table", "abc", { name: "old" });
    saveDraft("table", "abc", { name: "new" });
    expect(loadDraft("table", "abc")).toEqual({ name: "new" });
  });

  it("種別が異なれば別々のキーに保存される", () => {
    saveDraft("table", "abc", { name: "users" });
    saveDraft("action", "abc", { name: "actions" });
    expect(loadDraft("table", "abc")).toEqual({ name: "users" });
    expect(loadDraft("action", "abc")).toEqual({ name: "actions" });
  });

  it("IDが異なれば別々のキーに保存される", () => {
    saveDraft("table", "abc", { name: "users" });
    saveDraft("table", "def", { name: "orders" });
    expect(loadDraft("table", "abc")).toEqual({ name: "users" });
    expect(loadDraft("table", "def")).toEqual({ name: "orders" });
  });

  it("複雑なオブジェクトを保存・復元できる", () => {
    const data = {
      id: "t1",
      columns: [{ id: "c1", name: "col1", type: "VARCHAR" }],
      nested: { a: 1, b: [2, 3] },
    };
    saveDraft("table", "t1", data);
    expect(loadDraft("table", "t1")).toEqual(data);
  });
});

describe("clearDraft", () => {
  it("下書きを削除できる", () => {
    saveDraft("table", "abc", { name: "users" });
    clearDraft("table", "abc");
    expect(loadDraft("table", "abc")).toBeNull();
  });

  it("存在しないキーを削除してもエラーにならない", () => {
    expect(() => clearDraft("table", "nonexistent")).not.toThrow();
  });

  it("別のキーに影響しない", () => {
    saveDraft("table", "abc", { name: "users" });
    saveDraft("table", "def", { name: "orders" });
    clearDraft("table", "abc");
    expect(loadDraft("table", "abc")).toBeNull();
    expect(loadDraft("table", "def")).toEqual({ name: "orders" });
  });

  it("削除後に再度保存できる", () => {
    saveDraft("table", "abc", { name: "old" });
    clearDraft("table", "abc");
    saveDraft("table", "abc", { name: "new" });
    expect(loadDraft("table", "abc")).toEqual({ name: "new" });
  });
});

describe("hasDraft", () => {
  it("保存済みキーは true", () => {
    saveDraft("table", "abc", { name: "users" });
    expect(hasDraft("table", "abc")).toBe(true);
  });

  it("未保存キーは false", () => {
    expect(hasDraft("table", "nonexistent")).toBe(false);
  });

  it("削除後は false", () => {
    saveDraft("table", "abc", { name: "users" });
    clearDraft("table", "abc");
    expect(hasDraft("table", "abc")).toBe(false);
  });
});

describe("listAllDrafts", () => {
  it("draft-* キーだけ列挙する（他の localStorage キーは無視）", () => {
    localStorage.setItem("other-key", "ignored");
    saveDraft("table", "abc", { name: "users" });
    saveDraft("action", "xyz", { name: "actions" });
    const drafts = listAllDrafts();
    expect(drafts.map((d) => d.key).sort()).toEqual(["draft-action-xyz", "draft-table-abc"]);
  });

  it("UUID（ハイフン含み）を正しく kind/id に分解する", () => {
    const uuid = "aaaaaaaa-0001-4000-8000-000000000001";
    saveDraft("table", uuid, { name: "x" });
    const drafts = listAllDrafts();
    const d = drafts.find((x) => x.kind === "table" && x.id === uuid);
    expect(d).toBeDefined();
  });

  it("各ドラフトのサイズを返す", () => {
    saveDraft("flow", "project", { foo: "bar" });
    const drafts = listAllDrafts();
    const d = drafts.find((x) => x.kind === "flow" && x.id === "project");
    expect(d?.size).toBeGreaterThan(0);
  });

  it("ドラフトが無ければ空配列", () => {
    // beforeEach で localStorage.clear() されているので空のまま
    expect(listAllDrafts()).toEqual([]);
  });
});
