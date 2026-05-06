import { describe, it, expect } from "vitest";
import type {
  ProcessFlow,
  DbAccessStep,
  ExternalSystemStep,
  TxBoundary,
  ExternalChain,
} from "./action";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("StepBase の txBoundary / transactional / compensatesFor / externalChain (#162)", () => {
  it("txBoundary を保持できる", () => {
    const tx: TxBoundary = { role: "begin", txId: "tx-order" };
    const step: DbAccessStep = {
      id: "s",
      type: "dbAccess",
      description: "",
      tableName: "orders",
      operation: "INSERT",
      txBoundary: tx,
    };
    expect(step.txBoundary?.role).toBe("begin");
    expect(step.txBoundary?.txId).toBe("tx-order");
  });

  it("transactional 簡易フラグを保持できる", () => {
    const step: DbAccessStep = {
      id: "s",
      type: "dbAccess",
      description: "",
      tableName: "x",
      operation: "UPDATE",
      transactional: true,
    };
    expect(step.transactional).toBe(true);
  });

  it("compensatesFor で別ステップ ID を指せる", () => {
    const cancel: ExternalSystemStep = {
      id: "step-cancel",
      type: "externalSystem",
      description: "Stripe 与信解放",
      systemName: "Stripe",
      compensatesFor: "step-authorize",
    };
    expect(cancel.compensatesFor).toBe("step-authorize");
  });

  it("externalChain で authorize/capture/cancel を同一 chainId で紐付けられる", () => {
    const auth: ExternalSystemStep = {
      id: "s-auth",
      type: "externalSystem",
      description: "",
      systemName: "Stripe",
      externalChain: { chainId: "stripe-pi-1", phase: "authorize" },
    };
    const capture: ExternalSystemStep = {
      id: "s-cap",
      type: "externalSystem",
      description: "",
      systemName: "Stripe",
      externalChain: { chainId: "stripe-pi-1", phase: "capture" },
    };
    const cancel: ExternalSystemStep = {
      id: "s-canc",
      type: "externalSystem",
      description: "",
      systemName: "Stripe",
      externalChain: { chainId: "stripe-pi-1", phase: "cancel" },
    };
    expect(auth.externalChain?.chainId).toBe("stripe-pi-1");
    expect(capture.externalChain?.phase).toBe("capture");
    expect(cancel.externalChain?.phase).toBe("cancel");
  });

  it("外部チェーンの phase='other' (将来拡張用) も許容", () => {
    const chain: ExternalChain = { chainId: "x", phase: "other" };
    expect(chain.phase).toBe("other");
  });

  it("すべて省略可能 (optional)", () => {
    const step: DbAccessStep = {
      id: "s",
      type: "dbAccess",
      description: "",
      tableName: "x",
      operation: "SELECT",
    };
    expect(step.txBoundary).toBeUndefined();
    expect(step.transactional).toBeUndefined();
    expect(step.compensatesFor).toBeUndefined();
    expect(step.externalChain).toBeUndefined();
  });
});

describe("migrateProcessFlow — TX/Saga/externalChain 透過保持 (#162)", () => {
  it("新フィールドを持つ複数ステップの冪等マイグレーション (TX chain + Saga)", () => {
    const raw = {
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
              txBoundary: { role: "begin", txId: "tx-main" },
            },
            {
              id: "ins-items",
              type: "dbAccess",
              description: "INSERT order_items",
              tableName: "order_items",
              operation: "INSERT",
              txBoundary: { role: "member", txId: "tx-main" },
              transactional: true,
            },
            {
              id: "upd-inv",
              type: "dbAccess",
              description: "在庫引当",
              tableName: "inventory",
              operation: "UPDATE",
              txBoundary: { role: "end", txId: "tx-main" },
            },
            {
              id: "cap",
              type: "externalSystem",
              description: "capture",
              systemName: "Stripe",
              externalChain: { chainId: "pi-1", phase: "capture" },
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
    expect((steps[1] as DbAccessStep).txBoundary?.role).toBe("begin");
    expect((steps[2] as DbAccessStep).txBoundary?.role).toBe("member");
    expect((steps[5] as ExternalSystemStep).compensatesFor).toBe("auth");
  });

  it("新フィールドなしの旧データでも破壊なし", () => {
    const raw = {
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
    expect(step.txBoundary).toBeUndefined();
    expect(step.externalChain).toBeUndefined();
  });
});
