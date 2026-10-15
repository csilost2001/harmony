import { describe, it, expect, vi } from "vitest";
import { referenceAt, requestGoToReference, onGoToReference } from "./referenceTarget";

describe("referenceAt", () => {
  it("カーソルのある参照から、定義の画面の経路を求める", () => {
    const t = "SELECT * WHERE id = @screen.cart.item.qty AND x";
    const pos = t.indexOf("cart") + 1;
    expect(referenceAt(t, pos)).toEqual({ text: "@screen.cart.item.qty", prefix: "screen", route: "/screen/items/cart", label: "画面 cart", entity: { type: "screen", id: "cart" } });
  });

  it("参照の端 (先頭・末尾) でも見つかる / 外では見つからない", () => {
    const t = "a @table.orders b";
    expect(referenceAt(t, 2)?.route).toBe("/table/edit/orders");
    expect(referenceAt(t, t.indexOf(" b"))?.route).toBe("/table/edit/orders");
    expect(referenceAt(t, 0)).toBeNull();
    expect(referenceAt(t, t.length)).toBeNull();
  });

  it("実体の種類ごとの経路", () => {
    expect(referenceAt("@view.v1", 3)?.route).toBe("/view/edit/v1");
    expect(referenceAt("@viewer.vd", 3)?.route).toBe("/view-definition/edit/vd");
    expect(referenceAt("@seq.s1", 3)?.route).toBe("/sequence/edit/s1");
    expect(referenceAt("@layout.main", 3)?.route).toBe("/page-layout/edit/main");
    expect(referenceAt("@flow.order-confirm", 3)?.route).toBe("/process-flow/edit/order-confirm");
  });

  it("汎用定義・規約", () => {
    expect(referenceAt("@msg.orderConfirmed", 3)?.route).toBe("/generic-definition/message/orderConfirmed");
    expect(referenceAt("@exception.NotFound", 3)?.route).toBe("/generic-definition/exception-type/NotFound");
    expect(referenceAt("@conv.msg.required", 3)).toMatchObject({ route: "/conventions/catalog", label: "規約カタログ" });
  });

  it("対応しない接頭辞・名前の無い参照は null", () => {
    expect(referenceAt("@inputs.userId", 3)).toBeNull();
    expect(referenceAt("@var.x", 3)).toBeNull();
    expect(referenceAt("@screen.", 3)).toBeNull();
    expect(referenceAt("user@example.com", 7)).toBeNull(); // メールアドレスの @ は、接頭辞が表に無いので対象外
  });

  it("合図の送受信", () => {
    const handler = vi.fn();
    const off = onGoToReference(handler);
    const target = referenceAt("@table.orders", 3)!;
    requestGoToReference(target);
    expect(handler).toHaveBeenCalledWith(target);
    off();
    requestGoToReference(target);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("参照元を調べる対象", () => {
  it("画面・テーブルなどは、参照元を調べる種類と ID を持つ。汎用定義・規約は持たない", () => {
    expect(referenceAt("@screen.cart.item.qty", 3)?.entity).toEqual({ type: "screen", id: "cart" });
    expect(referenceAt("@table.orders", 3)?.entity).toEqual({ type: "table", id: "orders" });
    expect(referenceAt("@viewer.vd", 3)?.entity).toEqual({ type: "viewDefinition", id: "vd" });
    expect(referenceAt("@seq.s1", 3)?.entity).toEqual({ type: "sequence", id: "s1" });
    expect(referenceAt("@layout.main", 3)?.entity).toEqual({ type: "pageLayout", id: "main" });
    expect(referenceAt("@flow.f1", 3)?.entity).toEqual({ type: "processFlow", id: "f1" });
    expect(referenceAt("@msg.x", 3)?.entity).toBeUndefined();
    expect(referenceAt("@conv.msg.required", 3)?.entity).toBeUndefined();
  });

  it("参照元の合図の送受信", async () => {
    const { requestFindReferences, onFindReferences } = await import("./referenceTarget");
    const handler = vi.fn();
    const off = onFindReferences(handler);
    const t = referenceAt("@table.orders", 3)!;
    requestFindReferences(t);
    expect(handler).toHaveBeenCalledWith(t);
    off();
  });
});
