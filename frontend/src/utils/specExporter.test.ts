import { describe, it, expect } from "vitest";
import { generateSpecJson, type SpecStep } from "./specExporter";
import type { Table, TableId, LocalId, PhysicalName, DisplayName, Timestamp, ErLayout } from "../types/v3";
import type { FlowProject } from "../types/flow";
import type {
  AuditStep,
  CdcStep,
  ClosingStep,
  ComputeStep,
  DbAccessStep,
  EventPublishStep,
  EventSubscribeStep,
  LogStep,
  LoopBreakStep,
  LoopContinueStep,
  OtherStep,
  ProcessFlow,
  ReturnStep,
  Step,
  ValidationStep,
  WorkflowStep,
} from "../types/action";

function makeFlow(steps: Step[]): ProcessFlow {
  return {
    id: "pf1",
    name: "テストフロー",
    type: "screen",
    description: "テスト用",
    maturity: "draft",
    actions: [{ id: "a1", name: "アクション", trigger: "click", steps }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getStep(stepDef: Step): SpecStep {
  const spec = generateSpecJson(emptyProject, [], emptyErLayout, [makeFlow([stepDef])]);
  return spec.processFlows![0].actions[0].steps[0];
}

const emptyProject: FlowProject = {
  version: 1,
  name: "テストプロジェクト",
  screens: [],
  groups: [],
  edges: [],
  updatedAt: new Date().toISOString() as Timestamp,
};

const emptyErLayout: ErLayout = {
  positions: {},
  updatedAt: new Date().toISOString() as Timestamp,
};

const customersTable: Table = {
  id: "t-customers" as TableId,
  name: "顧客" as DisplayName,
  physicalName: "customers" as PhysicalName,
  description: "",
  createdAt: new Date().toISOString() as Timestamp,
  updatedAt: new Date().toISOString() as Timestamp,
  columns: [
    {
      id: "cust-id" as LocalId, no: 1, physicalName: "id" as PhysicalName, name: "ID" as DisplayName,
      dataType: "INTEGER", notNull: true, primaryKey: true, unique: false,
    },
  ],
};

function makeTable(overrides: Partial<Table> = {}): Table {
  return {
    id: "t1" as TableId,
    name: "注文" as DisplayName,
    physicalName: "orders" as PhysicalName,
    description: "注文テーブル",
    createdAt: new Date().toISOString() as Timestamp,
    updatedAt: new Date().toISOString() as Timestamp,
    columns: [
      {
        id: "c1" as LocalId, no: 1, physicalName: "id" as PhysicalName, name: "ID" as DisplayName,
        dataType: "INTEGER", notNull: true, primaryKey: true, unique: false, autoIncrement: true,
      },
      {
        id: "c2" as LocalId, no: 2, physicalName: "customer_id" as PhysicalName, name: "顧客ID" as DisplayName,
        dataType: "INTEGER", notNull: true, primaryKey: false, unique: false,
      },
      {
        id: "c3" as LocalId, no: 3, physicalName: "created_at" as PhysicalName, name: "作成日時" as DisplayName,
        dataType: "TIMESTAMP", notNull: false, primaryKey: false, unique: false,
      },
      {
        id: "c4" as LocalId, no: 4, physicalName: "status" as PhysicalName, name: "ステータス" as DisplayName,
        dataType: "VARCHAR", length: 20, notNull: false, primaryKey: false, unique: false,
      },
    ],
    indexes: [],
    ...overrides,
  };
}

describe("generateSpecJson — SpecTable", () => {
  it("constraints/defaults/triggers が空のとき出力に含まれない", () => {
    const spec = generateSpecJson(emptyProject, [makeTable()], emptyErLayout);
    const t = spec.tables[0];
    expect(t.constraints).toBeUndefined();
    expect(t.defaults).toBeUndefined();
    expect(t.triggers).toBeUndefined();
  });

  it("UNIQUE 制約が出力に含まれる (v3 columnIds → SpecTable では原構造を維持)", () => {
    const table = makeTable({
      constraints: [
        { id: "uq1" as LocalId, kind: "unique", physicalName: "uq_customer" as PhysicalName, columnIds: ["c2" as LocalId], description: "顧客IDは一意" },
      ],
    });
    const spec = generateSpecJson(emptyProject, [table], emptyErLayout);
    const t = spec.tables[0];
    expect(t.constraints).toHaveLength(1);
    expect(t.constraints![0]).toMatchObject({ kind: "unique", columnIds: ["c2"] });
  });

  it("CHECK 制約が出力に含まれる", () => {
    const table = makeTable({
      constraints: [
        { id: "ck1" as LocalId, kind: "check", physicalName: "ck_amount" as PhysicalName, expression: "amount > 0", description: "金額は正の値" },
      ],
    });
    const spec = generateSpecJson(emptyProject, [table], emptyErLayout);
    expect(spec.tables[0].constraints![0]).toMatchObject({ kind: "check", expression: "amount > 0" });
  });

  it("FOREIGN KEY 制約が出力に含まれる (referencedTableId UUID は allTables から物理名解決)", () => {
    const table = makeTable({
      constraints: [
        {
          id: "fk1" as LocalId,
          kind: "foreignKey",
          physicalName: "fk_orders_customer" as PhysicalName,
          columnIds: ["c2" as LocalId],
          referencedTableId: customersTable.id,
          referencedColumnIds: ["cust-id" as LocalId],
          onDelete: "cascade",
        },
      ],
    });
    const spec = generateSpecJson(emptyProject, [table, customersTable], emptyErLayout);
    expect(spec.tables[0].constraints![0]).toMatchObject({
      kind: "foreignKey", onDelete: "cascade",
    });
    // SpecColumn.reference で参照先テーブル / カラムが物理名解決されること
    const customerCol = spec.tables[0].columns.find((c) => c.name === "customer_id");
    expect(customerCol?.reference).toEqual({
      table: "customers",
      column: "id",
      type: "physical",
    });
  });

  it("DEFAULT 定義が v3 columnId 参照で出力される", () => {
    const table = makeTable({
      defaults: [
        { columnId: "c3" as LocalId, kind: "function", value: "NOW()", description: "作成日時自動設定" },
        { columnId: "c4" as LocalId, kind: "literal", value: "'active'" },
      ],
    });
    const spec = generateSpecJson(emptyProject, [table], emptyErLayout);
    const t = spec.tables[0];
    expect(t.defaults).toHaveLength(2);
    expect(t.defaults![0]).toMatchObject({ columnId: "c3", kind: "function", value: "NOW()" });
    expect(t.defaults![1]).toMatchObject({ columnId: "c4", kind: "literal" });
  });

  it("トリガー定義が出力に含まれる", () => {
    const table = makeTable({
      triggers: [
        {
          id: "tr1" as LocalId, physicalName: "trg_audit" as PhysicalName, timing: "BEFORE", events: ["INSERT", "UPDATE"],
          body: "SET NEW.updated_at = NOW();", description: "更新日時自動セット",
        },
      ],
    });
    const spec = generateSpecJson(emptyProject, [table], emptyErLayout);
    const t = spec.tables[0];
    expect(t.triggers).toHaveLength(1);
    expect(t.triggers![0]).toMatchObject({ timing: "BEFORE", events: ["INSERT", "UPDATE"] });
  });

  it("constraints / defaults / triggers が混在しても全て出力される", () => {
    const table = makeTable({
      constraints: [{ id: "uq1" as LocalId, kind: "unique", physicalName: "uq1" as PhysicalName, columnIds: ["c2" as LocalId] }],
      defaults: [{ columnId: "c4" as LocalId, kind: "literal", value: "'active'" }],
      triggers: [{ id: "tr1" as LocalId, physicalName: "trg_t" as PhysicalName, timing: "AFTER", events: ["INSERT"], body: "..." }],
    });
    const spec = generateSpecJson(emptyProject, [table], emptyErLayout);
    const t = spec.tables[0];
    expect(t.constraints).toHaveLength(1);
    expect(t.defaults).toHaveLength(1);
    expect(t.triggers).toHaveLength(1);
  });
});

describe("toSpecStep — step detail", () => {
  it("validation: conditions and optional inlineBranch", () => {
    const withInlineBranch = getStep({
      id: "v1",
      kind: "validation",
      description: "入力検証",
      conditions: "@amount > 0",
      inlineBranch: { ok: "ok", ng: "ng", ngJumpTo: "input-error" },
    } as ValidationStep);

    expect(withInlineBranch.detail.conditions).toBe("@amount > 0");
    expect(withInlineBranch.detail.inlineBranch).toEqual({
      ok: "ok",
      ng: "ng",
      ngJumpTo: "input-error",
    });

    const withoutInlineBranch = getStep({
      id: "v2",
      kind: "validation",
      description: "入力検証",
      conditions: "@name != ''",
    } as ValidationStep);

    expect(withoutInlineBranch.detail.conditions).toBe("@name != ''");
    expect(withoutInlineBranch.detail).not.toHaveProperty("inlineBranch");
  });

  it("dbAccess: tableId and operation (v3 vocabulary)", () => {
    const step = getStep({
      id: "db1",
      kind: "dbAccess",
      description: "注文登録",
      tableId: "tbl-orders-uuid",
      operation: "INSERT",
    } as DbAccessStep);

    expect(step.detail).toMatchObject({
      tableId: "tbl-orders-uuid",
      operation: "INSERT",
    });
  });

  it("externalSystem: systemRef (v3 vocabulary)", () => {
    const step = getStep({
      id: "ex1",
      kind: "externalSystem",
      description: "外部決済",
      systemRef: "stripe",
    } as Step);

    expect(step.detail.systemRef).toBe("stripe");
  });

  it("commonProcess: refId (v3 vocabulary、refName は廃止)", () => {
    const step = getStep({
      id: "cp1",
      kind: "commonProcess",
      description: "共通処理",
      refId: "common-1",
    } as Step);

    expect(step.detail.refId).toBe("common-1");
    expect(step.detail).not.toHaveProperty("refName");
  });

  it("screenTransition: targetScreenId (v3 vocabulary)", () => {
    const step = getStep({
      id: "st1",
      kind: "screenTransition",
      description: "完了画面へ遷移",
      targetScreenId: "scr-uuid-completion",
    } as Step);

    expect(step.detail.targetScreenId).toBe("scr-uuid-completion");
  });

  it("displayUpdate: target", () => {
    const step = getStep({
      id: "du1",
      kind: "displayUpdate",
      description: "表示更新",
      target: "明細一覧",
    } as Step);

    expect(step.detail.target).toBe("明細一覧");
  });

  it("branch: conditions in branches", () => {
    const step = getStep({
      id: "br1",
      kind: "branch",
      description: "条件分岐",
      branches: [
        {
          id: "b1",
          code: "A",
          label: "承認済み",
          condition: "@status == 'approved'",
          steps: [],
        },
      ],
    } as Step);

    expect(step.detail.branches).toEqual([
      expect.objectContaining({ condition: "@status == 'approved'" }),
    ]);
  });

  it("loop: count expression and nested steps", () => {
    const step = getStep({
      id: "lp1",
      kind: "loop",
      description: "3回繰り返し",
      loopKind: "count",
      countExpression: "3",
      steps: [],
    } as Step);

    expect(step.detail.countExpression).toBe("3");
    expect(step.detail.steps).toHaveLength(0);
  });

  it("jump: jumpTo label", () => {
    const step = getStep({
      id: "jp1",
      kind: "jump",
      description: "終了へ移動",
      jumpTo: "done",
    } as Step);

    expect(step.detail.jumpTo).toBe("done");
  });

  it("transactionScope: steps sub-array (v3 vocabulary)", () => {
    const step = getStep({
      id: "tx1",
      kind: "transactionScope",
      description: "トランザクション",
      isolationLevel: "READ_COMMITTED",
      propagation: "REQUIRED",
      steps: [
        {
          id: "db1",
          kind: "dbAccess",
          description: "注文登録",
          tableId: "tbl-orders-uuid",
          operation: "INSERT",
        } as DbAccessStep,
      ],
    } as Step);

    expect(step.detail.steps).toHaveLength(1);
    expect((step.detail.steps as Array<{ kind: string }>)[0].kind).toBe("dbAccess");
  });

  it("closing: period and rollbackOnFailure false", () => {
    const step = getStep({
      id: "cl1",
      kind: "closing",
      description: "月次締め",
      period: "monthly",
      rollbackOnFailure: false,
    } as ClosingStep);

    expect(step.detail.period).toBe("monthly");
    expect(step.detail.rollbackOnFailure).toBe(false);
  });

  it("cdc: tableIds, captureMode, and destination (v3 vocabulary)", () => {
    const destination = { kind: "auditLog", auditAction: "insert" } as const;
    const step = getStep({
      id: "cdc1",
      kind: "cdc",
      description: "注文変更通知",
      tableIds: ["tbl-orders-uuid", "tbl-order-items-uuid"],
      captureMode: "incremental",
      destination,
    } as CdcStep);

    expect(step.detail.tableIds).toEqual(["tbl-orders-uuid", "tbl-order-items-uuid"]);
    expect(step.detail.captureMode).toBe("incremental");
    expect(step.detail.destination).toEqual(destination);
  });

  it("eventPublish: topic and optional payload", () => {
    const withPayload = getStep({
      id: "ep1",
      kind: "eventPublish",
      description: "イベント発行",
      topic: "order.created",
      payload: "{ orderId: @orderId }",
    } as EventPublishStep);

    expect(withPayload.detail.topic).toBe("order.created");
    expect(withPayload.detail.payload).toBe("{ orderId: @orderId }");

    const withoutPayload = getStep({
      id: "ep2",
      kind: "eventPublish",
      description: "イベント発行",
      topic: "order.created",
    } as EventPublishStep);

    expect(withoutPayload.detail.topic).toBe("order.created");
    expect(withoutPayload.detail).not.toHaveProperty("payload");
  });

  it("eventSubscribe: topic and optional filter", () => {
    const withFilter = getStep({
      id: "es1",
      kind: "eventSubscribe",
      description: "イベント購読",
      topic: "order.created",
      filter: "@event.region == 'jp'",
    } as EventSubscribeStep);

    expect(withFilter.detail.topic).toBe("order.created");
    expect(withFilter.detail.filter).toBe("@event.region == 'jp'");

    const withoutFilter = getStep({
      id: "es2",
      kind: "eventSubscribe",
      description: "イベント購読",
      topic: "order.created",
    } as EventSubscribeStep);

    expect(withoutFilter.detail.topic).toBe("order.created");
    expect(withoutFilter.detail).not.toHaveProperty("filter");
  });

  it("loopBreak: detail は空オブジェクト", () => {
    const step = getStep({
      id: "lb1",
      kind: "loopBreak",
      description: "ループ脱出",
    } as LoopBreakStep);
    expect(step.type).toBe("loopBreak");
    expect(step.detail).toEqual({});
  });

  it("loopContinue: detail は空オブジェクト", () => {
    const step = getStep({
      id: "lc1",
      kind: "loopContinue",
      description: "ループ継続",
    } as LoopContinueStep);
    expect(step.type).toBe("loopContinue");
    expect(step.detail).toEqual({});
  });

  it("return: detail は空オブジェクト", () => {
    const step = getStep({
      id: "r1",
      kind: "return",
      description: "レスポンス返却",
    } as ReturnStep);
    expect(step.type).toBe("return");
    expect(step.detail).toEqual({});
  });

  it("log: level and message in detail", () => {
    const step = getStep({
      id: "l1",
      kind: "log",
      description: "ログ記録",
      level: "info",
      message: "処理完了",
    } as LogStep);
    expect(step.type).toBe("log");
    expect(step.detail.level).toBe("info");
    expect(step.detail.message).toBe("処理完了");
  });

  it("audit: action in detail", () => {
    const step = getStep({
      id: "au1",
      kind: "audit",
      description: "監査ログ",
      action: "order.create",
    } as AuditStep);
    expect(step.type).toBe("audit");
    expect(step.detail.action).toBe("order.create");
  });

  it("workflow: pattern, approvers, quorum in detail", () => {
    const step = getStep({
      id: "wf1",
      kind: "workflow",
      description: "承認フロー",
      pattern: "approval-sequential",
      approvers: [{ role: "manager" }],
      quorum: { type: "any" },
    } as WorkflowStep);
    expect(step.type).toBe("workflow");
    expect(step.detail.pattern).toBe("approval-sequential");
    expect(step.detail.approvers).toEqual([{ role: "manager" }]);
  });

  it("compute: expression in detail", () => {
    const step = getStep({
      id: "comp1",
      kind: "compute",
      description: "税額計算",
      expression: "@subtotal * 0.10",
    } as ComputeStep);
    expect(step.type).toBe("compute");
    expect(step.detail.expression).toBe("@subtotal * 0.10");
  });

  it("other (legacy:OtherStep): detail は空オブジェクト", () => {
    const step = getStep({
      id: "oth1",
      kind: "legacy:OtherStep",
      description: "その他処理",
    } as OtherStep);
    expect(step.type).toBe("legacy:OtherStep");
    expect(step.detail).toEqual({});
  });
});
