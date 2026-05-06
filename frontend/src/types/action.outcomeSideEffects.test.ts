import { describe, it, expect } from "vitest";
import type { ProcessFlow, ExternalSystemStep, ExternalCallOutcomeSpec, Step } from "./action";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("ExternalCallOutcomeSpec の sideEffects (#172)", () => {
  it("outcome.failure.sideEffects に副作用ステップ列を保持できる (capture 失敗時の例)", () => {
    const failure: ExternalCallOutcomeSpec = {
      action: "continue",
      description: "同期レスポンスは 201 維持、後段で手動対応",
      sideEffects: [
        {
          id: "se-1",
          type: "dbAccess",
          description: "orders.status を payment_failed に更新",
          tableName: "orders",
          operation: "UPDATE",
          sql: "UPDATE orders SET status='payment_failed', updated_at=CURRENT_TIMESTAMP WHERE id = @registeredOrder.id",
        } as Step,
        {
          id: "se-2",
          type: "other",
          description: "Sentry error 記録 + 運用通知チャネルに送信",
        } as Step,
      ],
    };
    expect(failure.sideEffects).toHaveLength(2);
    expect(failure.sideEffects?.[0].type).toBe("dbAccess");
    expect(failure.sideEffects?.[1].type).toBe("other");
  });

  it("sideEffects は空配列 / 省略どちらも許容", () => {
    const spec1: ExternalCallOutcomeSpec = { action: "continue" };
    const spec2: ExternalCallOutcomeSpec = { action: "abort", sideEffects: [] };
    expect(spec1.sideEffects).toBeUndefined();
    expect(spec2.sideEffects).toEqual([]);
  });

  it("sameAs で他 outcome の定義を流用できる (timeout=failure と同じ)", () => {
    const step: ExternalSystemStep = {
      id: "s",
      type: "externalSystem",
      description: "",
      systemName: "X",
      outcomes: {
        success: { action: "continue" },
        failure: { action: "abort", description: "失敗時は中断" },
        timeout: { action: "abort", sameAs: "failure" },
      },
    };
    expect(step.outcomes?.timeout?.sameAs).toBe("failure");
  });

  it("abort + sideEffects の組合せ (補償後に中断する Saga パターン)", () => {
    const spec: ExternalCallOutcomeSpec = {
      action: "abort",
      description: "HTTP 402 で return する前に補償を行う",
      sideEffects: [
        { id: "comp-1", type: "other", description: "Stripe void_authorization 呼出" } as Step,
      ],
      jumpTo: "end-of-action",
    };
    expect(spec.action).toBe("abort");
    expect(spec.sideEffects).toHaveLength(1);
    expect(spec.jumpTo).toBe("end-of-action");
  });
});

describe("migrateProcessFlow — outcome sideEffects / sameAs 透過保持 (#172)", () => {
  it("新フィールドを持つ outcome を冪等にマイグレーションできる", () => {
    const raw = {
      id: "g",
      name: "x",
      type: "screen",
      description: "",
      actions: [
        {
          id: "a",
          name: "a",
          trigger: "submit",
          steps: [
            {
              id: "s",
              type: "externalSystem",
              description: "capture",
              systemName: "Stripe",
              outcomes: {
                success: { action: "continue" },
                failure: {
                  action: "continue",
                  description: "稀なケース",
                  sideEffects: [
                    {
                      id: "se",
                      type: "dbAccess",
                      description: "status 更新",
                      tableName: "orders",
                      operation: "UPDATE",
                    },
                  ],
                },
                timeout: { action: "continue", sameAs: "failure" },
              },
            },
          ],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const once = migrateProcessFlow(raw) as ProcessFlow;
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));

    const step = once.actions[0].steps[0] as ExternalSystemStep;
    expect(step.outcomes?.failure?.sideEffects).toHaveLength(1);
    // sideEffects 内のステップも通常通りマイグレーションされている (maturity 既定)
    const sideStep = step.outcomes?.failure?.sideEffects?.[0] as Step;
    expect(sideStep.maturity).toBe("draft");
    expect(step.outcomes?.timeout?.sameAs).toBe("failure");
  });
});
