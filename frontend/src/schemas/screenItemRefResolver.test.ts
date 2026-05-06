/**
 * screenItemRefResolver のユニットテスト (#734)
 */
import { describe, it, expect } from "vitest";
import { resolveScreenItemRefs } from "./screenItemRefResolver";
import type { ScreenItem } from "../types/v3/screen-item";
import type { Conventions } from "../types/v3/conventions";

function makeItem(partial: Partial<ScreenItem>): ScreenItem {
  return {
    id: "f1" as ScreenItem["id"],
    label: "フィールド",
    type: "integer",
    ...partial,
  };
}

function makeCatalog(limitEntries: Record<string, number>): Conventions {
  const limit: Record<string, { value: number }> = {};
  for (const [key, value] of Object.entries(limitEntries)) {
    limit[key] = { value };
  }
  return { version: "1.0.0", limit } as Conventions;
}

describe("resolveScreenItemRefs (#734)", () => {
  describe("maxRef → max 解決", () => {
    it("maxRef が @conv.limit.<key> で catalog に存在する場合、max に値を展開する", () => {
      const item = makeItem({ maxRef: "@conv.limit.cartItemMaxQuantity" });
      const catalog = makeCatalog({ cartItemMaxQuantity: 999 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.max).toBe(999);
    });

    it("max が既に存在する場合は plain 優先 (maxRef は無視)", () => {
      const item = makeItem({ max: 500, maxRef: "@conv.limit.cartItemMaxQuantity" });
      const catalog = makeCatalog({ cartItemMaxQuantity: 999 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.max).toBe(500);
    });

    it("maxRef が catalog に未登録の場合は max を展開しない", () => {
      const item = makeItem({ maxRef: "@conv.limit.unknownKey" });
      const catalog = makeCatalog({ cartItemMaxQuantity: 999 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.max).toBeUndefined();
    });

    it("maxRef が @conv.limit.* 形式でない場合は max を展開しない", () => {
      const item = makeItem({ maxRef: "@conv.regex.somePattern" });
      const catalog = makeCatalog({ somePattern: 999 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.max).toBeUndefined();
    });
  });

  describe("minRef → min 解決", () => {
    it("minRef が @conv.limit.<key> で catalog に存在する場合、min に値を展開する", () => {
      const item = makeItem({ minRef: "@conv.limit.orderMinAmount" });
      const catalog = makeCatalog({ orderMinAmount: 1 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.min).toBe(1);
    });

    it("min が既に存在する場合は plain 優先", () => {
      const item = makeItem({ min: 10, minRef: "@conv.limit.orderMinAmount" });
      const catalog = makeCatalog({ orderMinAmount: 1 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.min).toBe(10);
    });

    it("minRef が未登録の場合は min を展開しない", () => {
      const item = makeItem({ minRef: "@conv.limit.noSuchKey" });
      const catalog = makeCatalog({ orderMinAmount: 1 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.min).toBeUndefined();
    });
  });

  describe("maxLengthRef → maxLength 解決", () => {
    it("maxLengthRef が catalog に存在する場合、maxLength に値を展開する", () => {
      const item = makeItem({ type: "string", maxLengthRef: "@conv.limit.productCodeMaxLength" });
      const catalog = makeCatalog({ productCodeMaxLength: 20 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.maxLength).toBe(20);
    });

    it("maxLength が既に存在する場合は plain 優先", () => {
      const item = makeItem({ type: "string", maxLength: 10, maxLengthRef: "@conv.limit.productCodeMaxLength" });
      const catalog = makeCatalog({ productCodeMaxLength: 20 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.maxLength).toBe(10);
    });

    it("maxLengthRef が未登録の場合は maxLength を展開しない", () => {
      const item = makeItem({ type: "string", maxLengthRef: "@conv.limit.noSuchKey" });
      const catalog = makeCatalog({ productCodeMaxLength: 20 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.maxLength).toBeUndefined();
    });
  });

  describe("minLengthRef → minLength 解決", () => {
    it("minLengthRef が catalog に存在する場合、minLength に値を展開する", () => {
      const item = makeItem({ type: "string", minLengthRef: "@conv.limit.productCodeMinLength" });
      const catalog = makeCatalog({ productCodeMinLength: 4 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.minLength).toBe(4);
    });

    it("minLength が既に存在する場合は plain 優先", () => {
      const item = makeItem({ type: "string", minLength: 2, minLengthRef: "@conv.limit.productCodeMinLength" });
      const catalog = makeCatalog({ productCodeMinLength: 4 });
      const result = resolveScreenItemRefs(item, catalog);
      expect(result.minLength).toBe(2);
    });
  });

  describe("conventions が null の場合", () => {
    it("conventions null は shallow copy のみ返す (Ref フィールドは展開しない)", () => {
      const item = makeItem({ maxRef: "@conv.limit.cartItemMaxQuantity" });
      const result = resolveScreenItemRefs(item, null);
      expect(result.max).toBeUndefined();
      expect(result.maxRef).toBe("@conv.limit.cartItemMaxQuantity");
    });

    it("conventions null でも元オブジェクトとは別インスタンス", () => {
      const item = makeItem({ maxRef: "@conv.limit.cartItemMaxQuantity" });
      const result = resolveScreenItemRefs(item, null);
      expect(result).not.toBe(item);
    });
  });

  describe("元オブジェクト不変性", () => {
    it("resolveScreenItemRefs は元の ScreenItem を変更しない", () => {
      const item = makeItem({ maxRef: "@conv.limit.cartItemMaxQuantity" });
      const catalog = makeCatalog({ cartItemMaxQuantity: 999 });
      resolveScreenItemRefs(item, catalog);
      expect((item as Record<string, unknown>).max).toBeUndefined();
    });
  });
});
