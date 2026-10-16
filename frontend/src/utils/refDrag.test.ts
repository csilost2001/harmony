import { describe, it, expect } from "vitest";
import { REF_MIME, hasRefDrag, insertRefAt, readRefDrop, setRefDragData } from "./refDrag";

const dt = (data: Record<string, string>) => ({ types: Object.keys(data), getData: (k: string) => data[k] ?? "" });

describe("refDrag", () => {
  it("ドラッグ開始時に、専用の種類とふつうの文字の両方を持たせる", () => {
    const store: Record<string, string> = {};
    const w = { setData: (k: string, v: string) => { store[k] = v; }, effectAllowed: "none" as DataTransfer["effectAllowed"] };
    setRefDragData(w, "@table.orders");
    expect(store).toEqual({ [REF_MIME]: "@table.orders", "text/plain": "@table.orders" });
    expect(w.effectAllowed).toBe("copyMove");
  });
  it("専用の種類があるドラッグだけを受ける", () => {
    expect(hasRefDrag(dt({ [REF_MIME]: "@a" }))).toBe(true);
    expect(hasRefDrag(dt({ "text/plain": "@screen.cart" }))).toBe(false);
    expect(hasRefDrag(null)).toBe(false);
  });
  it("参照の形の文字だけを読む (形が違えば、入れない)", () => {
    expect(readRefDrop(dt({ [REF_MIME]: "@screen.cart.item.qty" }))).toBe("@screen.cart.item.qty");
    expect(readRefDrop(dt({ [REF_MIME]: "@conv" }))).toBe("@conv");
    expect(readRefDrop(dt({ [REF_MIME]: "DROP TABLE" }))).toBeNull();
    expect(readRefDrop(dt({ "text/plain": "@screen.cart" }))).toBeNull();
  });
  it("選択範囲を置き換え、無ければカーソルの位置へ入れる", () => {
    expect(insertRefAt("SELECT  FROM x", 7, 7, "@table.orders")).toEqual({ value: "SELECT @table.orders FROM x", cursor: 20 });
    expect(insertRefAt("abc XXX def", 4, 7, "@a.b")).toEqual({ value: "abc @a.b def", cursor: 8 });
    expect(insertRefAt("abc", 99, 99, "@a.b").value).toBe("abc@a.b");
  });
});
