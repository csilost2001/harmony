import { describe, expect, it } from "vitest";
import {
  ALL_STEP_TYPES,
  ALL_SUB_STEP_TYPES,
  DB_OPS,
  trimToUndefined,
} from "./stepCardConstants";

/**
 * StepCard.tsx / ProcessFlowEditor.tsx から抽出した定数とヘルパー (#1145) の
 * 回帰防止テスト。
 */
describe("stepCardConstants", () => {
  describe("ALL_STEP_TYPES (Phase-3 #1145 で追加、follow-up で componentCall/aiCall/aiAgent 追加)", () => {
    it("25 種類の step kind を持つ (パレット側 toolbar 用、v3 schema 全 kind)", () => {
      expect(ALL_STEP_TYPES).toHaveLength(25);
    });

    it("代表的な kind を含む", () => {
      expect(ALL_STEP_TYPES).toContain("validation");
      expect(ALL_STEP_TYPES).toContain("workflow");
      expect(ALL_STEP_TYPES).toContain("transactionScope");
    });

    it("v3 schema で追加された 3 kind (componentCall / aiCall / aiAgent) を含む", () => {
      expect(ALL_STEP_TYPES).toContain("componentCall");
      expect(ALL_STEP_TYPES).toContain("aiCall");
      expect(ALL_STEP_TYPES).toContain("aiAgent");
    });

    it("重複が無い", () => {
      expect(new Set(ALL_STEP_TYPES).size).toBe(ALL_STEP_TYPES.length);
    });
  });

  describe("ALL_SUB_STEP_TYPES", () => {
    it("25 種類の step kind を持つ (v3 schema 全 kind)", () => {
      expect(ALL_SUB_STEP_TYPES).toHaveLength(25);
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

    it("v3 schema で追加された 3 kind (componentCall / aiCall / aiAgent) を含む", () => {
      expect(ALL_SUB_STEP_TYPES).toContain("componentCall");
      expect(ALL_SUB_STEP_TYPES).toContain("aiCall");
      expect(ALL_SUB_STEP_TYPES).toContain("aiAgent");
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
