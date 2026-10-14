import { describe, it, expect } from "vitest";
import { conflictingItemIds, planItemPaste } from "./itemClipboard";
import type { ScreenItem } from "../types/v3/screen-item";

const item = (id: string, extra: Partial<ScreenItem> = {}): ScreenItem => ({ id, label: id, type: "string", ...extra }) as unknown as ScreenItem;

describe("planItemPaste", () => {
  const existing = [item("email"), item("emailCopy"), item("name")];

  it("重ならない ID はそのまま。重なるものは Copy を付け、すでにあれば番号を足す", () => {
    const plan = planItemPaste(existing, [item("zip"), item("email"), item("name")]);
    expect(plan.items.map((i) => i.id)).toEqual(["zip", "emailCopy2", "nameCopy"]);
    expect(plan.renamed).toEqual([{ from: "email", to: "emailCopy2" }, { from: "name", to: "nameCopy" }]);
  });

  it("貼る中で同じ ID が並んでも、別々の ID にする", () => {
    const plan = planItemPaste([], [item("a"), item("a")]);
    expect(plan.items.map((i) => i.id)).toEqual(["a", "aCopy"]);
  });

  it("ID が空の項目は、そのまま貼る (まだ ID を付けていない行)", () => {
    expect(planItemPaste(existing, [item("")]).items.map((i) => i.id)).toEqual([""]);
  });

  it("項目のほかの内容 (型・必須・refKey など) は保つ。元の項目は書き換えない", () => {
    const src = item("email", { required: true, refKey: "customerEmail" } as Partial<ScreenItem>);
    const plan = planItemPaste(existing, [src]);
    expect(plan.items[0]).toMatchObject({ required: true, refKey: "customerEmail", type: "string" });
    expect(src.id).toBe("email");
  });
});

describe("conflictingItemIds", () => {
  it("重なる ID を 1 度ずつ返す。空の ID は数えない", () => {
    const ex = [item("a"), item("b")];
    expect(conflictingItemIds(ex, [item("a"), item("a"), item("c"), item("")])).toEqual(["a"]);
  });
});
