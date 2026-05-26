// ── #1149: browser-first 経路の v3 mutation 受信を検証 ─────────────────────
//
// 検証観点 (PR #1148 follow-up / #1332 Codex 10 巡目 M1 で LocalId 化):
// - backend (v3 化済) が `kind` field を送ったとき step が正しく追加されること
// - 旧 `type` field では追加されない (v3 になり受容しない)
// - id は schema 規範 LocalId (`step-NN`, `act-NNN`) で採番される
//   (旧 UUID v4 期待は #1332 で訂正、Step.id / Action.id / Branch.id は LocalId 規範)
// - update / remove / move 各 mutation が LocalId 形式の stepId を引けること
// - description / detail を step に merge できること
//
// #1332 Codex 10 巡目 M1: 以前 (v3 移行直後) は id を UUID v4 として期待していたが、
// schema (Action.id / Step.id / Branch.id: LocalId) との不整合だったため LocalId 期待に修正。

import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyProcessFlowMutation } from "./processFlowMutation";
import { setProcessFlowStorageBackend } from "../../store/processFlowStore";
import type { ProcessFlow, ActionDefinition } from "../../types/v3";

// schema 規範: step-NN / step-NNN / step-NNNN (将来桁数増加にも追随)
const LOCAL_STEP_ID_RE = /^step-\d{2,}$/;

function makeProcessFlow(actions: ActionDefinition[] = []): ProcessFlow {
  return {
    $schema: "../../schemas/v3/process-flow.v3.schema.json",
    meta: {
      // RFC #1284: top-level entity id は EntityId (kebab-case)
      id: "test-flow",
      uuid: "11111111-1111-4111-8111-111111111111",
      name: "テストフロー",
      kind: "screen",
      version: "1.0.0",
      maturity: "draft",
      mode: "upstream",
      createdAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T00:00:00.000Z",
    },
    actions,
  };
}

function makeAction(id: string, steps: unknown[] = []): ActionDefinition {
  return { id, name: "act1", trigger: "click", steps } as ActionDefinition;
}

describe("applyProcessFlowMutation (browser-first v3, #1149 / #1332 M1)", () => {
  beforeEach(() => {
    // processFlowStore.addStep は内部で backend を要求しないが、
    // 他テストの副作用を避けて null 初期化しておく。
    setProcessFlowStorageBackend(null);
  });

  describe("designer__add_step", () => {
    it("v3 `kind` field を受けて step を追加する (id は LocalId 採番)", () => {
      // actionId は schema 規範 LocalId (`act-NNN`)
      const act = makeAction("act-001");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "act-001",
        kind: "log",
        description: "テストログ",
      });

      expect(g.actions[0].steps).toHaveLength(1);
      const step = g.actions[0].steps[0];
      expect(step.kind).toBe("log");
      expect(step.type).toBeUndefined(); // v3: 旧 type field は生成されない
      expect(step.description).toBe("テストログ");
      // #1332 M1: id は LocalId (`step-NN`)、UUID v4 ではない
      expect(step.id).toMatch(LOCAL_STEP_ID_RE);
      expect(step.id).toBe("step-01"); // 初回追加は連番 1
    });

    it("連続して追加された step は連番採番される (#1332 M1)", () => {
      const act = makeAction("act-001");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", { actionId: "act-001", kind: "log" });
      applyProcessFlowMutation(g, "designer__add_step", { actionId: "act-001", kind: "audit" });
      applyProcessFlowMutation(g, "designer__add_step", { actionId: "act-001", kind: "log" });

      expect(g.actions[0].steps).toHaveLength(3);
      expect(g.actions[0].steps.map((s) => s.id)).toEqual(["step-01", "step-02", "step-03"]);
    });

    it("v1/v2 旧 `type` field のみでは追加されない (kind 必須)", () => {
      const act = makeAction("act-001");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "act-001",
        type: "log", // 旧 field、受容しない
        description: "壊れた呼び出し",
      });

      // backend は v3 化済で `kind` を送るので、`type` のみは事故・互換切れ前提
      expect(g.actions[0].steps).toHaveLength(0);
    });

    it("位置指定で挿入できる (position)", () => {
      // 既存 step は LocalId `step-05` 等、連番衝突を避けるため
      const existing = { id: "step-05", kind: "log", description: "" };
      const act = makeAction("act-001", [existing]);
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "act-001",
        kind: "audit",
        position: 0,
      });

      expect(g.actions[0].steps).toHaveLength(2);
      expect(g.actions[0].steps[0].kind).toBe("audit");
      // 新規 step.id は既存 step-05 と衝突しない採番 (max+1 = step-06)
      expect(g.actions[0].steps[0].id).toMatch(LOCAL_STEP_ID_RE);
      expect(g.actions[0].steps[0].id).toBe("step-06");
      expect(g.actions[0].steps[1].id).toBe(existing.id);
    });

    it("detail を step に merge する (kind 固有 field)", () => {
      const act = makeAction("act-001");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "act-001",
        kind: "log",
        detail: { level: "warn", message: "テスト" },
      });

      const step = g.actions[0].steps[0];
      expect(step.kind).toBe("log");
      expect(step.level).toBe("warn");
      expect(step.message).toBe("テスト");
    });

    it("actionId が見つからない場合は no-op", () => {
      const act = makeAction("act-001");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "act-999", // 存在しない LocalId
        kind: "log",
      });

      expect(g.actions[0].steps).toHaveLength(0);
    });
  });

  describe("designer__update_step", () => {
    it("LocalId 形式 stepId で step を patch する (#1332 M1)", () => {
      const stepId = "step-01";
      const act = makeAction("act-001", [
        { id: stepId, kind: "log", description: "旧" },
      ]);
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__update_step", {
        stepId,
        patch: { description: "新", level: "error" },
      });

      const step = g.actions[0].steps[0];
      expect(step.description).toBe("新");
      expect(step.level).toBe("error");
      expect(step.kind).toBe("log"); // 既存 field は維持
    });
  });

  describe("designer__remove_step", () => {
    it("LocalId 形式 stepId で step を削除する (#1332 M1)", () => {
      const stepId = "step-01";
      const act = makeAction("act-001", [
        { id: stepId, kind: "log", description: "" },
      ]);
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__remove_step", { stepId });

      expect(g.actions[0].steps).toHaveLength(0);
    });

    it("UUID v4 形式の stepId は一致しない (v3 schema 規範外)", () => {
      // schema 上 Step.id は LocalId のため、誤って UUID 形式を送っても一致しない
      const act = makeAction("act-001", [
        { id: "step-02", kind: "log", description: "" },
      ]);
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__remove_step", {
        stepId: "66666666-6666-4666-8666-666666666666",
      });

      expect(g.actions[0].steps).toHaveLength(1); // 削除されない
    });
  });

  describe("designer__move_step", () => {
    it("LocalId 形式 stepId で step を新位置に移動する (#1332 M1)", () => {
      const stepA = { id: "step-01", kind: "log", description: "A" };
      const stepB = { id: "step-02", kind: "audit", description: "B" };
      const stepC = { id: "step-03", kind: "log", description: "C" };
      const act = makeAction("act-001", [stepA, stepB, stepC]);
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__move_step", {
        stepId: stepA.id,
        newIndex: 2,
      });

      expect(g.actions[0].steps.map((s: { id: string }) => s.id)).toEqual([
        stepB.id, stepC.id, stepA.id,
      ]);
    });
  });

  describe("不明な type", () => {
    it("未知の mutation type は no-op", () => {
      const act = makeAction("act-001");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__unknown_mutation", { actionId: act.id });

      expect(g.actions[0].steps).toHaveLength(0);
    });
  });

  // ── #1145 Phase-3 N-3: mismatch 時 console.warn で痕跡を残す ─────────
  describe("N-3: silent no-op → console.warn 化", () => {
    it("actionId 不一致時に console.warn が呼ばれる", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const act = makeAction("act-001");
        const g = makeProcessFlow([act]);
        applyProcessFlowMutation(g, "designer__add_step", {
          actionId: "act-999",
          kind: "log",
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("actionId not found");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("kind 欠落時に console.warn が呼ばれる", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const act = makeAction("act-001");
        const g = makeProcessFlow([act]);
        applyProcessFlowMutation(g, "designer__add_step", {
          actionId: "act-001",
          type: "log", // 旧 field、v3 では拒否
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("kind is missing");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("stepId 不一致 (update) で console.warn が呼ばれる", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const act = makeAction("act-001");
        const g = makeProcessFlow([act]);
        applyProcessFlowMutation(g, "designer__update_step", {
          stepId: "step-99",
          patch: { description: "新" },
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("stepId not found");
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("未知の mutation type で console.warn が呼ばれる", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const act = makeAction("act-001");
        const g = makeProcessFlow([act]);
        applyProcessFlowMutation(g, "designer__unknown_mutation", { actionId: act.id });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0][0]).toContain("unknown mutation type");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
