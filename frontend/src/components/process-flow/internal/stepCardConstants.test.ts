import { describe, expect, it } from "vitest";
import {
  ALL_SUB_STEP_TYPES,
  DB_OPS,
  trimToUndefined,
} from "./stepCardConstants";

/**
 * StepCard.tsx から抽出した定数とヘルパー (#1145) の回帰防止テスト。
 */
describe("stepCardConstants", () => {
  describe("ALL_SUB_STEP_TYPES", () => {
    it("22 種類の step kind を持つ (現行 spec)", () => {
      expect(ALL_SUB_STEP_TYPES).toHaveLength(22);
    });

    it("代表的な kind を含む", () => {
      expect(ALL_SUB_STEP_TYPES).toContain("validation");
      expect(ALL_SUB_STEP_TYPES).toContain("dbAccess");
      expect(ALL_SUB_STEP_TYPES).toContain("externalSystem");
      expect(ALL_SUB_STEP_TYPES).toContain("transactionScope");
      expect(ALL_SUB_STEP_TYPES).toContain("workflow");
      expect(ALL_SUB_STEP_TYPES).toContain("eventPublish");
      expect(ALL_SUB_STEP_TYPES).toContain("eventSubscribe");
      expect(ALL_SUB_STEP_TYPES).toContain("cdc");
    });

    it("重複が無い", () => {
      expect(new Set(ALL_SUB_STEP_TYPES).size).toBe(ALL_SUB_STEP_TYPES.length);
    });
  });

  describe("DB_OPS", () => {
    it("4 種類の DB 操作を含む", () => {
      expect(DB_OPS).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
    });
  });

  describe("trimToUndefined", () => {
    it("空白のみは undefined", () => {
      expect(trimToUndefined("")).toBeUndefined();
      expect(trimToUndefined("   ")).toBeUndefined();
      expect(trimToUndefined("\t\n")).toBeUndefined();
    });

    it("有効文字列は trim 結果を返す", () => {
      expect(trimToUndefined("hello")).toBe("hello");
      expect(trimToUndefined("  hello  ")).toBe("hello");
    });
  });
});
