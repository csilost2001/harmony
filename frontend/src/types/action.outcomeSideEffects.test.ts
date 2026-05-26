import { describe, it, expect } from "vitest";
import type {
  ProcessFlow,
  ExternalSystemStep,
  ExternalCallOutcomeSpec,
  NonReturnStep,
  Step,
  LocalId,
  Description,
  Identifier,
  TableId,
} from "../types/v3";
import { migrateProcessFlow } from "../utils/actionMigration";

// #1355 Codex Must-fix: type 注釈で type shape を検証、brand のみ局所 cast。

describe("ExternalCallOutcomeSpec の sideEffects (#172)", () => {
  it("outcome.failure.sideEffects に副作用ステップ列を保持できる (capture 失敗時の例)", () => {
    const sideEffects: NonReturnStep[] = [
      {
        id: "se-1" as LocalId,
        kind: "dbAccess",
        description: "orders.status を payment_failed に更新" as Description,
        tableId: "orders" as TableId,
        operation: "UPDATE",
        sql: "UPDATE orders SET status='payment_failed', updated_at=CURRENT_TIMESTAMP WHERE id = @registeredOrder.id",
      },
      {
        id: "se-2" as LocalId,
        kind: "legacy:OtherStep",
        description: "Sentry error 記録 + 運用通知チャネルに送信" as Description,
      },
    ];
    const failure: ExternalCallOutcomeSpec = {
      action: "continue",
      description: "同期レスポンスは 201 維持、後段で手動対応" as Description,
      sideEffects,
    };
    expect(failure.sideEffects).toHaveLength(2);
    expect(failure.sideEffects?.[0].kind).toBe("dbAccess");
    expect(failure.sideEffects?.[1].kind).toBe("legacy:OtherStep");
  });

  it("sideEffects は空配列 / 省略どちらも許容", () => {
    const spec1: ExternalCallOutcomeSpec = { action: "continue" };
    const spec2: ExternalCallOutcomeSpec = { action: "abort", sideEffects: [] };
    expect(spec1.sideEffects).toBeUndefined();
    expect(spec2.sideEffects).toEqual([]);
  });

  it("sameAs で他 outcome の定義を流用できる (timeout=failure と同じ)", () => {
    // #1263 Phase X3: outcomes は errorHandling.outcomes に集約済
    const step: ExternalSystemStep = {
      id: "s" as LocalId,
      kind: "externalSystem",
      description: "" as Description,
      systemRef: "x" as Identifier,
      errorHandling: {
        outcomes: {
          success: { action: "continue" },
          failure: { action: "abort", description: "失敗時は中断" as Description },
          timeout: { action: "abort", sameAs: "failure" },
        },
      },
    };
    expect(step.errorHandling?.outcomes?.timeout?.sameAs).toBe("failure");
  });

  it("abort + sideEffects の組合せ (補償後に中断する Saga パターン)", () => {
    const spec: ExternalCallOutcomeSpec = {
      action: "abort",
      description: "HTTP 402 で return する前に補償を行う" as Description,
      sideEffects: [
        {
          id: "comp-1" as LocalId,
          kind: "legacy:OtherStep",
          description: "Stripe void_authorization 呼出" as Description,
        },
      ],
      jumpTo: "end-of-action" as LocalId,
    };
    expect(spec.action).toBe("abort");
    expect(spec.sideEffects).toHaveLength(1);
    expect(spec.jumpTo).toBe("end-of-action");
  });
});

describe("migrateProcessFlow — outcome sideEffects / sameAs 透過保持 (#172)", () => {
  it("新フィールドを持つ outcome を冪等にマイグレーションできる", () => {
    const raw: unknown = {
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
    // #1263 Phase X3: outcomes は errorHandling.outcomes に集約
    expect(step.errorHandling?.outcomes?.failure?.sideEffects).toHaveLength(1);
    // sideEffects 内のステップも通常通りマイグレーションされている (maturity 既定)
    const sideStep = step.errorHandling?.outcomes?.failure?.sideEffects?.[0] as Step;
    expect(sideStep.maturity).toBe("draft");
    expect(step.errorHandling?.outcomes?.timeout?.sameAs).toBe("failure");
  });
});
