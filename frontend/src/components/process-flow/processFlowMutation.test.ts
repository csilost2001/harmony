// ── #1149: browser-first 経路の v3 mutation 受信を検証 ─────────────────────
//
// 検証観点 (PR #1148 follow-up):
// - backend (v3 化済) が `kind` field を送ったとき step が正しく追加されること
// - 旧 `type` field では追加されない (v3 になり受容しない)
// - id は RFC 4122 v4 UUID 形式 (legacy prefix を受容しない)
// - update / remove / move 各 mutation が UUID 形式の stepId を引けること
// - description / detail を step に merge できること

import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyProcessFlowMutation } from "./processFlowMutation";
import { setProcessFlowStorageBackend } from "../../store/processFlowStore";
import type { ProcessFlow, ActionDefinition } from "../../types/v3";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeProcessFlow(actions: ActionDefinition[] = []): ProcessFlow {
  return {
    $schema: "../../schemas/v3/process-flow.v3.schema.json",
    meta: {
      id: "11111111-1111-4111-8111-111111111111",
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

describe("applyProcessFlowMutation (browser-first v3, #1149)", () => {
  beforeEach(() => {
    // processFlowStore.addStep は内部で backend を要求しないが、
    // 他テストの副作用を避けて null 初期化しておく。
    setProcessFlowStorageBackend(null);
  });

  describe("designer__add_step", () => {
    it("v3 `kind` field を受けて step を追加する", () => {
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "log",
        description: "テストログ",
      });

      expect(g.actions[0].steps).toHaveLength(1);
      const step = g.actions[0].steps[0];
      expect(step.kind).toBe("log");
      expect(step.type).toBeUndefined(); // v3: 旧 type field は生成されない
      expect(step.description).toBe("テストログ");
      expect(step.id).toMatch(UUID_V4_RE);
    });

    it("v1/v2 旧 `type` field のみでは追加されない (kind 必須)", () => {
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        type: "log", // 旧 field、受容しない
        description: "壊れた呼び出し",
      });

      // backend は v3 化済で `kind` を送るので、`type` のみは事故・互換切れ前提
      expect(g.actions[0].steps).toHaveLength(0);
    });

    it("位置指定で挿入できる (position)", () => {
      const existing = { id: "33333333-3333-4333-8333-333333333333", kind: "log", description: "" };
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [existing]);
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "audit",
        position: 0,
      });

      expect(g.actions[0].steps).toHaveLength(2);
      expect(g.actions[0].steps[0].kind).toBe("audit");
      expect(g.actions[0].steps[1].id).toBe(existing.id);
    });

    it("detail を step に merge する (kind 固有 field)", () => {
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "log",
        detail: { level: "warn", message: "テスト" },
      });

      const step = g.actions[0].steps[0];
      expect(step.kind).toBe("log");
      expect(step.level).toBe("warn");
      expect(step.message).toBe("テスト");
    });

    it("actionId が見つからない場合は no-op", () => {
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__add_step", {
        actionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        kind: "log",
      });

      expect(g.actions[0].steps).toHaveLength(0);
    });
  });

  describe("designer__update_step", () => {
    it("v3 UUID 形式 stepId で step を patch する", () => {
      const stepId = "44444444-4444-4444-8444-444444444444";
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [
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
    it("v3 UUID 形式 stepId で step を削除する", () => {
      const stepId = "55555555-5555-4555-8555-555555555555";
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [
        { id: stepId, kind: "log", description: "" },
      ]);
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__remove_step", { stepId });

      expect(g.actions[0].steps).toHaveLength(0);
    });

    it("legacy `step-XXX` prefix では一致しない (v3 移行済)", () => {
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [
        { id: "66666666-6666-4666-8666-666666666666", kind: "log", description: "" },
      ]);
      const g = makeProcessFlow([act]);

      applyProcessFlowMutation(g, "designer__remove_step", { stepId: "step-1234567890" });

      expect(g.actions[0].steps).toHaveLength(1); // 削除されない
    });
  });

  describe("designer__move_step", () => {
    it("v3 UUID 形式 stepId で step を新位置に移動する", () => {
      const stepA = { id: "77777777-7777-4777-8777-777777777777", kind: "log", description: "A" };
      const stepB = { id: "88888888-8888-4888-8888-888888888888", kind: "audit", description: "B" };
      const stepC = { id: "99999999-9999-4999-8999-999999999999", kind: "log", description: "C" };
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", [stepA, stepB, stepC]);
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
      const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
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
        const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        const g = makeProcessFlow([act]);
        applyProcessFlowMutation(g, "designer__add_step", {
          actionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
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
        const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        const g = makeProcessFlow([act]);
        applyProcessFlowMutation(g, "designer__add_step", {
          actionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
        const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        const g = makeProcessFlow([act]);
        applyProcessFlowMutation(g, "designer__update_step", {
          stepId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
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
        const act = makeAction("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
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
