import { describe, it, expect } from "vitest";
import type { ProcessFlow, ExternalSystemStep } from "./action";
import { EXTERNAL_CALL_OUTCOME_VALUES } from "./action";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("ExternalSystemStep の新規フィールド (#158)", () => {
  it("outcomes / timeoutMs / retryPolicy / fireAndForget をすべて保持できる", () => {
    const step: ExternalSystemStep = {
      id: "s1",
      type: "externalSystem",
      description: "決済呼出",
      systemName: "Stripe",
      protocol: "HTTPS",
      outcomes: {
        success: { action: "continue" },
        failure: { action: "abort", description: "402 で返す" },
        timeout: { action: "abort", description: "failure と同じ扱い" },
      },
      timeoutMs: 10000,
      retryPolicy: { maxAttempts: 2, backoff: "exponential", initialDelayMs: 500 },
      fireAndForget: false,
    };
    expect(step.outcomes?.success?.action).toBe("continue");
    expect(step.outcomes?.failure?.action).toBe("abort");
    expect(step.timeoutMs).toBe(10000);
    expect(step.retryPolicy?.maxAttempts).toBe(2);
    expect(step.fireAndForget).toBe(false);
  });

  it("すべて省略可能 (既存コードの型互換)", () => {
    const step: ExternalSystemStep = {
      id: "s2",
      type: "externalSystem",
      description: "",
      systemName: "SomeService",
    };
    expect(step.outcomes).toBeUndefined();
    expect(step.timeoutMs).toBeUndefined();
    expect(step.retryPolicy).toBeUndefined();
    expect(step.fireAndForget).toBeUndefined();
  });

  it("EXTERNAL_CALL_OUTCOME_VALUES に 3 値が列挙されている", () => {
    expect(EXTERNAL_CALL_OUTCOME_VALUES).toEqual(["success", "failure", "timeout"]);
  });

  it("outcomes の partial 指定 (success のみ) も可能", () => {
    const step: ExternalSystemStep = {
      id: "s3",
      type: "externalSystem",
      description: "",
      systemName: "X",
      outcomes: {
        success: { action: "continue", description: "ログ記録" },
      },
    };
    expect(step.outcomes?.success).toBeDefined();
    expect(step.outcomes?.failure).toBeUndefined();
  });

  it("fireAndForget=true の形式", () => {
    const step: ExternalSystemStep = {
      id: "s4",
      type: "externalSystem",
      description: "メール送信",
      systemName: "SendGrid",
      fireAndForget: true,
      outcomes: {
        failure: { action: "continue", description: "ログのみ、続行" },
        timeout: { action: "continue", description: "同上" },
      },
    };
    expect(step.fireAndForget).toBe(true);
    expect(step.outcomes?.failure?.action).toBe("continue");
  });
});

describe("migrateProcessFlow — ExternalSystemStep の新フィールド透過保持 (#158)", () => {
  it("新フィールドを持つ ExternalSystemStep を冪等にマイグレーションできる", () => {
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
              description: "",
              systemName: "Stripe",
              timeoutMs: 10000,
              fireAndForget: false,
              outcomes: {
                success: { action: "continue" },
                failure: { action: "abort" },
              },
              retryPolicy: { maxAttempts: 3, backoff: "fixed", initialDelayMs: 1000 },
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
    expect(step.timeoutMs).toBe(10000);
    expect(step.retryPolicy?.maxAttempts).toBe(3);
    expect(step.outcomes?.success?.action).toBe("continue");
    expect(step.outcomes?.failure?.action).toBe("abort");
    expect(step.fireAndForget).toBe(false);
    // maturity は既定付与 (既存挙動)
    expect(step.maturity).toBe("draft");
  });

  it("新フィールドなしの旧データでも破壊されない", () => {
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
              description: "",
              systemName: "Legacy",
            },
          ],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw) as ProcessFlow;
    const step = migrated.actions[0].steps[0] as ExternalSystemStep;
    expect(step.systemRef).toBe("Legacy");
    expect(step.outcomes).toBeUndefined();
    expect(step.timeoutMs).toBeUndefined();
  });
});
