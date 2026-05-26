import { describe, it, expect } from "vitest";
import type {
  ProcessFlow,
  DbAccessStep,
  ExternalSystemStep,
  ExternalChain,
  LocalId,
  Description,
  Identifier,
  TableId,
} from "../types/v3";
import { migrateProcessFlow } from "../utils/actionMigration";

// #1355 Codex Must-fix: 各 Step literal は `const x: <Type> = {...}` で type 注釈し、
// brand のみ局所 cast。`({...} as unknown) as <Type>` のような outer cast は使わない。

describe("StepBase の compensatesFor / externalChain (#162)", () => {
  it("compensatesFor で別ステップ ID を指せる", () => {
    const cancel: ExternalSystemStep = {
      id: "step-cancel" as LocalId,
      kind: "externalSystem",
      description: "Stripe 与信解放" as Description,
      systemRef: "stripe" as Identifier,
      compensatesFor: "step-authorize" as LocalId,
    };
    expect(cancel.compensatesFor).toBe("step-authorize");
  });

  it("externalChain で authorize/capture/cancel を同一 chainId で紐付けられる", () => {
    const auth: ExternalSystemStep = {
      id: "s-auth" as LocalId,
      kind: "externalSystem",
      description: "" as Description,
      systemRef: "stripe" as Identifier,
      externalChain: { chainId: "stripe-pi-1" as LocalId, phase: "authorize" },
    };
    const capture: ExternalSystemStep = {
      id: "s-cap" as LocalId,
      kind: "externalSystem",
      description: "" as Description,
      systemRef: "stripe" as Identifier,
      externalChain: { chainId: "stripe-pi-1" as LocalId, phase: "capture" },
    };
    const cancel: ExternalSystemStep = {
      id: "s-canc" as LocalId,
      kind: "externalSystem",
      description: "" as Description,
      systemRef: "stripe" as Identifier,
      externalChain: { chainId: "stripe-pi-1" as LocalId, phase: "cancel" },
    };
    expect(auth.externalChain?.chainId).toBe("stripe-pi-1");
    expect(capture.externalChain?.phase).toBe("capture");
    expect(cancel.externalChain?.phase).toBe("cancel");
  });

  it("外部チェーンの phase='other' (将来拡張用) も許容", () => {
    const chain: ExternalChain = { chainId: "x" as LocalId, phase: "other" };
    expect(chain.phase).toBe("other");
  });

  it("すべて省略可能 (optional)", () => {
    const step: DbAccessStep = {
      id: "s" as LocalId,
      kind: "dbAccess",
      description: "" as Description,
      tableId: "x" as TableId,
      operation: "SELECT",
    };
    expect(step.compensatesFor).toBeUndefined();
    expect(step.externalChain).toBeUndefined();
  });
});

describe("migrateProcessFlow — Saga/externalChain 透過保持 + 旧 txBoundary/transactional 剥がし (#1221)", () => {
  it("compensatesFor / externalChain を冪等に保持し、txBoundary/transactional は剥がす", () => {
    // raw は v1 legacy shape (type / systemName / tableName 等)
    const raw: unknown = {
      id: "g",
      name: "x",
      type: "screen",
      description: "",
      actions: [
        {
          id: "a",
          name: "注文確定",
          trigger: "submit",
          steps: [
            {
              id: "auth",
              type: "externalSystem",
              description: "決済 authorize",
              systemName: "Stripe",
              externalChain: { chainId: "pi-1", phase: "authorize" },
            },
            {
              id: "ins-order",
              type: "dbAccess",
              description: "INSERT orders",
              tableName: "orders",
              operation: "INSERT",
              // 旧 txBoundary / transactional — migrator が剥がすことを検証
              txBoundary: { role: "begin", txId: "tx-main" },
              transactional: true,
            },
            {
              id: "cancel",
              type: "externalSystem",
              description: "TX 失敗時の補償",
              systemName: "Stripe",
              externalChain: { chainId: "pi-1", phase: "cancel" },
              compensatesFor: "auth",
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

    const steps = once.actions[0].steps;
    expect((steps[0] as ExternalSystemStep).externalChain?.phase).toBe("authorize");
    // 旧 txBoundary / transactional は v3 で廃止、migrator が剥がす
    expect((steps[1] as unknown as Record<string, unknown>).txBoundary).toBeUndefined();
    expect((steps[1] as unknown as Record<string, unknown>).transactional).toBeUndefined();
    expect((steps[2] as ExternalSystemStep).compensatesFor).toBe("auth");
  });

  it("新フィールドなしの旧データでも破壊なし", () => {
    const raw: unknown = {
      id: "g",
      name: "x",
      type: "screen",
      description: "",
      actions: [
        {
          id: "a",
          name: "a",
          trigger: "click",
          steps: [
            { id: "s", type: "dbAccess", description: "", tableName: "x", operation: "SELECT" },
          ],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw) as ProcessFlow;
    const step = migrated.actions[0].steps[0] as DbAccessStep;
    expect(step.externalChain).toBeUndefined();
  });
});
