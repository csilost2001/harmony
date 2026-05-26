/**
 * renameInProgress.ts unit test (#1299 I-7 Round 2 F-3 / Codex review M-4 / Opus review M-2)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markRenameInProgress,
  isRenameInProgressByTabType,
  _resetRenameInProgressForTest,
} from "./renameInProgress";

describe("renameInProgress", () => {
  beforeEach(() => {
    _resetRenameInProgressForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("登録した直後は in-flight 判定 true", () => {
    markRenameInProgress("table", "order");
    expect(isRenameInProgressByTabType("table", "order")).toBe(true);
  });

  it("未登録の id は false", () => {
    expect(isRenameInProgressByTabType("table", "customer")).toBe(false);
  });

  it("entityType → tabType マッピングが効く (table → 'table')", () => {
    markRenameInProgress("table", "order");
    expect(isRenameInProgressByTabType("table", "order")).toBe(true);
  });

  it("entityType → tabType マッピングが効く (processFlow → 'process-flow')", () => {
    markRenameInProgress("processFlow", "order-checkout");
    expect(isRenameInProgressByTabType("process-flow", "order-checkout")).toBe(true);
    expect(isRenameInProgressByTabType("processFlow", "order-checkout")).toBe(false);
  });

  it("entityType → tabType マッピングが効く (screen → 'design')", () => {
    markRenameInProgress("screen", "login");
    expect(isRenameInProgressByTabType("design", "login")).toBe(true);
    expect(isRenameInProgressByTabType("screen", "login")).toBe(false);
  });

  it("oldId / newId 両方を登録できる (handleRenameSuccess パターン)", () => {
    markRenameInProgress("table", "order");
    markRenameInProgress("table", "purchase-order");
    expect(isRenameInProgressByTabType("table", "order")).toBe(true);
    expect(isRenameInProgressByTabType("table", "purchase-order")).toBe(true);
  });

  it("TTL (3000ms) 経過後は false に戻る", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    markRenameInProgress("table", "order");
    expect(isRenameInProgressByTabType("table", "order")).toBe(true);

    // 2999ms 経過: まだ in-flight
    vi.setSystemTime(new Date("2026-05-25T12:00:02.999Z"));
    expect(isRenameInProgressByTabType("table", "order")).toBe(true);

    // 3001ms 経過: expire
    vi.setSystemTime(new Date("2026-05-25T12:00:03.001Z"));
    expect(isRenameInProgressByTabType("table", "order")).toBe(false);
  });

  it("entity 種別が異なれば独立 (table:order と processFlow:order)", () => {
    markRenameInProgress("table", "order");
    expect(isRenameInProgressByTabType("table", "order")).toBe(true);
    expect(isRenameInProgressByTabType("process-flow", "order")).toBe(false);
  });

  it("_resetRenameInProgressForTest で全消去できる", () => {
    markRenameInProgress("table", "order");
    markRenameInProgress("view", "customer-summary");
    expect(isRenameInProgressByTabType("table", "order")).toBe(true);
    _resetRenameInProgressForTest();
    expect(isRenameInProgressByTabType("table", "order")).toBe(false);
    expect(isRenameInProgressByTabType("view", "customer-summary")).toBe(false);
  });

  // I-7 Round 3 G-5 (#1299 Codex S-R2-1): wsId scoping
  describe("wsId scoping", () => {
    it("wsId 指定なし (legacy) と未指定で同じ key として動く (back-compat)", () => {
      markRenameInProgress("table", "order");
      expect(isRenameInProgressByTabType("table", "order")).toBe(true);
      // 引数 wsId 省略は `_` placeholder で同 key
      expect(isRenameInProgressByTabType("table", "order", undefined)).toBe(true);
    });

    it("異なる wsId は独立 (workspace A の rename は workspace B の判定に影響しない)", () => {
      markRenameInProgress("table", "order", "ws-A");
      expect(isRenameInProgressByTabType("table", "order", "ws-A")).toBe(true);
      // workspace B では false (multi-workspace 跨ぎ誤抑制 bug の再発防止)
      expect(isRenameInProgressByTabType("table", "order", "ws-B")).toBe(false);
      // wsId 未指定 (placeholder `_`) も別 key
      expect(isRenameInProgressByTabType("table", "order")).toBe(false);
    });

    it("同 wsId + 同 entityType + 同 id は in-flight 判定 true", () => {
      markRenameInProgress("processFlow", "order-checkout", "ws-retail");
      expect(isRenameInProgressByTabType("process-flow", "order-checkout", "ws-retail")).toBe(true);
      expect(isRenameInProgressByTabType("process-flow", "order-checkout", "ws-other")).toBe(false);
    });

    it("wsId scoping 下でも TTL は機能する", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-26T00:00:00.000Z"));
      markRenameInProgress("table", "order", "ws-A");
      expect(isRenameInProgressByTabType("table", "order", "ws-A")).toBe(true);
      vi.setSystemTime(new Date("2026-05-26T00:00:03.001Z"));
      expect(isRenameInProgressByTabType("table", "order", "ws-A")).toBe(false);
    });
  });
});
