import { describe, expect, it } from "vitest";
import { stepSummaryText } from "./stepSummaryText";
import type { Step } from "../../../types/v3";

/**
 * stepSummaryText() の出力確認テスト。
 * 元 StepCard.tsx 内 closure を抽出 (#1145) したため、各 step kind の summary
 * 文字列フォーマットを回帰防止する。
 */
describe("stepSummaryText", () => {
  it("validation: conditions を優先", () => {
    const step = {
      id: "s1",
      kind: "validation",
      conditions: "X is required",
      description: "fallback",
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("X is required");
  });

  it("validation: conditions 空時は description fallback", () => {
    const step = {
      id: "s1",
      kind: "validation",
      conditions: "",
      description: "fallback",
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("fallback");
  });

  it("validation: 両方空時は規定文言", () => {
    const step = {
      id: "s1",
      kind: "validation",
      conditions: "",
      description: "",
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("バリデーション");
  });

  it("dbAccess: tableId + 操作名 + description を結合", () => {
    const step = {
      id: "s1",
      kind: "dbAccess",
      tableId: "orders",
      operation: "SELECT",
      description: "明細取得",
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("orders SELECT - 明細取得");
  });

  it("dbAccess: tableId 未設定時は ? 表示", () => {
    const step = {
      id: "s1",
      kind: "dbAccess",
      operation: "INSERT",
    } as unknown as Step;
    const summary = stepSummaryText(step, []);
    expect(summary.startsWith("? ")).toBe(true);
    expect(summary).toContain("INSERT");
  });

  it("commonProcess: refId 優先", () => {
    const step = {
      id: "s1",
      kind: "commonProcess",
      refId: "calcTax",
      description: "ignored",
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("calcTax");
  });

  it("loop: loopKind=count では countExpression を返す", () => {
    const step = {
      id: "s1",
      kind: "loop",
      loopKind: "count",
      countExpression: "10",
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("10");
  });

  it("loop: loopKind=collection では collectionSource + item を返す", () => {
    const step = {
      id: "s1",
      kind: "loop",
      loopKind: "collection",
      collectionSource: "@items",
      collectionItemName: "item",
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("@items [item]");
  });

  it("loopBreak: 規定文言", () => {
    const step = { id: "s1", kind: "loopBreak" } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("ループ終了");
  });

  it("transactionScope: isolationLevel + ステップ数", () => {
    const step = {
      id: "s1",
      kind: "transactionScope",
      isolationLevel: "SERIALIZABLE",
      steps: [{ id: "a" }, { id: "b" }, { id: "c" }],
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("TX (SERIALIZABLE, 3 ステップ)");
  });

  it("transactionScope: isolationLevel 未指定で READ_COMMITTED にフォールバック", () => {
    const step = {
      id: "s1",
      kind: "transactionScope",
      steps: [],
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("TX (READ_COMMITTED, 0 ステップ)");
  });

  it("不明な kind は description / その他 にフォールバック", () => {
    const step = {
      id: "s1",
      kind: "unknown-kind",
      description: "詳細",
    } as unknown as Step;
    expect(stepSummaryText(step, [])).toBe("詳細");

    const noDesc = { id: "s2", kind: "unknown-kind" } as unknown as Step;
    expect(stepSummaryText(noDesc, [])).toBe("その他");
  });
});
