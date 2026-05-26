/**
 * v3 TS 型 smoke test (#541)
 *
 * 型レベルでの基本的な検証:
 * - Branded types が正しく解決される
 * - Step discriminated union が kind narrowing で機能する
 * - WorkflowApprover の order semantics が JSDoc で参照可能 (型は number)
 * - examples/<project-id>/ (現行 canonical サンプル) の実 JSON と TS 型の互換性 (parseable)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

import type {
  ProcessFlow,
  Step,
  WorkflowStep,
  DbAccessStep,
  ValidationStep,
  TransactionScopeStep,
} from "./process-flow";
import type { Harmony } from "./harmony";
import type { Table, Constraint, ForeignKeyConstraint } from "./table";
import type { Screen } from "./screen";
import type { ScreenItem, ScreenItemEvent, ScreenItemEventEffect, ValueSource } from "./screen-item";
import type {
  Uuid,
  EntityId,
  ScreenId,
  TableId,
  Identifier,
  IdentifierPath,
  FieldType,
  StructuredField,
  TemplateString,
  EntityMeta,
  // #1332 Codex 再 review M4: ScreenGroupId / CustomBlockId brand 同期
  ScreenGroupId,
  CustomBlockId,
} from "./common";

// ─── Branded types compile-time check ─────────────────────────────────────

describe("v3 branded types", () => {
  it("EntityId 系 brand と Uuid は別 base (代入互換性なし)", () => {
    const tableId = "table-customer" as TableId;
    const asEntityId: EntityId = tableId; // TableId は EntityId base → 共通 base に代入可能
    expect(typeof asEntityId).toBe("string");

    // @ts-expect-error - TableId (EntityId base) を Uuid に直接代入不可 (base brand 不一致)
    const wrongUuid: Uuid = tableId;
    void wrongUuid;
  });

  it("EntityId と Uuid は別 base brand (代入不可)", () => {
    const eid = "screen-list-page" as EntityId;
    expect(typeof eid).toBe("string");

    // @ts-expect-error - EntityId と Uuid は別 base brand のため代入不可
    const wrongUuid: Uuid = eid;
    void wrongUuid;
  });

  it("ScreenId と TableId は別 brand (代入互換性なし、同じ EntityId base でも区別される)", () => {
    const screenId = "screen-list-page" as ScreenId;
    const asEntityId: EntityId = screenId; // OK (共通 base)
    expect(typeof asEntityId).toBe("string");

    // @ts-expect-error - ScreenId と TableId は narrow brand discriminator が異なるため直接代入不可
    const wrongTableId: TableId = screenId;
    void wrongTableId;
  });

  it("EntityMeta.uuid は required field (RFC #1284 / I-7-1)", () => {
    // 正常 case: uuid 含めた EntityMeta は受理される
    const meta: EntityMeta = {
      id: "screen-list-page" as EntityId,
      uuid: "11111111-1111-4111-8111-111111111111" as Uuid,
      name: "test",
      createdAt: "2026-01-01T00:00:00.000Z" as EntityMeta["createdAt"],
      updatedAt: "2026-01-01T00:00:00.000Z" as EntityMeta["updatedAt"],
    };
    expect(meta.uuid).toBeDefined();

    // @ts-expect-error - uuid 欠落の object literal は EntityMeta を満たさない
    const metaWithoutUuid: EntityMeta = {
      id: "screen-list-page" as EntityId,
      name: "test",
      createdAt: "2026-01-01T00:00:00.000Z" as EntityMeta["createdAt"],
      updatedAt: "2026-01-01T00:00:00.000Z" as EntityMeta["updatedAt"],
    };
    void metaWithoutUuid;
  });

  it("Identifier と IdentifierPath は別ブランド", () => {
    const id = "userId" as Identifier;
    const path = "createdOrder.order_number" as IdentifierPath;
    expect(typeof id).toBe("string");
    expect(typeof path).toBe("string");

    // @ts-expect-error - Identifier と IdentifierPath は別 brand
    const wrongAssign: Identifier = path;
    void wrongAssign;
  });

  // #1332 Codex 再 review M4 regression assertions
  it("ScreenGroupId は EntityId base (schema 同期、kebab-case 受理 / Uuid 拒否)", () => {
    // kebab-case EntityId として代入できること (schema 上 group ID は EntityId)
    const groupId = "group-default" as ScreenGroupId;
    const asEntityId: EntityId = groupId;
    expect(typeof asEntityId).toBe("string");

    // @ts-expect-error - ScreenGroupId (EntityId base) を Uuid に直接代入不可
    const wrongUuid: Uuid = groupId;
    void wrongUuid;

    // @ts-expect-error - ScreenGroupId と ScreenId は narrow brand discriminator が異なる
    const wrongScreenId: ScreenId = groupId;
    void wrongScreenId;
  });

  it("CustomBlockId は Uuid base かつ narrow brand で subtype guarantee あり", () => {
    const blockUuid = "11111111-1111-4111-8111-111111111111" as Uuid;
    const customBlockId = blockUuid as CustomBlockId;
    // CustomBlockId は Uuid base → Uuid に代入可能 (subtype guarantee)
    const asUuid: Uuid = customBlockId;
    expect(typeof asUuid).toBe("string");

    // @ts-expect-error - CustomBlockId (Uuid base) を EntityId に直接代入不可
    const wrongEntityId: EntityId = customBlockId;
    void wrongEntityId;

    // @ts-expect-error - 同じ Uuid base でも narrow brand 違いの ScreenGroupId 等とは別物
    //                    (CustomBlockId は Uuid 系、ScreenGroupId は EntityId 系で base ごと別)
    const wrongScreenGroup: ScreenGroupId = customBlockId;
    void wrongScreenGroup;
  });
});

// ─── Step discriminated union narrowing ─────────────────────────────────

describe("v3 Step discriminated union", () => {
  it("kind narrowing で variant が型推論される", () => {
    const step: Step = {
      id: "step-01" as Step["id"],
      kind: "validation",
      description: "test",
      fieldErrorsVar: "fieldErrors" as Identifier,
    };
    if (step.kind === "validation") {
      // Narrowed to ValidationStep
      const v: ValidationStep = step;
      expect(v.kind).toBe("validation");
      // v.tableId は存在しない (compile error)
    }
  });

  it("DbAccessStep は tableId 必須", () => {
    const dbStep: DbAccessStep = {
      id: "step-02" as DbAccessStep["id"],
      kind: "dbAccess",
      description: "select",
      tableId: "table-customer" as TableId,
      operation: "SELECT",
    };
    expect(dbStep.tableId).toBeDefined();
  });

  it("WorkflowStep approval-quorum は quorum 必須 (型レベルでは optional だが TS 側で実装)", () => {
    const wf: WorkflowStep = {
      id: "step-wf" as WorkflowStep["id"],
      kind: "workflow",
      description: "test",
      pattern: "approval-quorum",
      approvers: [{ role: "@conv.role.x" }],
      quorum: { type: "nOfM", n: 2 },
    };
    expect(wf.quorum?.type).toBe("nOfM");
  });

  it("TransactionScopeStep の steps と onCommit/onRollback", () => {
    const tx: TransactionScopeStep = {
      id: "step-tx" as TransactionScopeStep["id"],
      kind: "transactionScope",
      description: "test",
      steps: [
        {
          id: "step-tx-1" as DbAccessStep["id"],
          kind: "dbAccess",
          description: "insert",
          tableId: "table-customer" as TableId,
          operation: "INSERT",
        },
      ],
      isolationLevel: "SERIALIZABLE",
    };
    expect(tx.steps.length).toBe(1);
    expect(tx.isolationLevel).toBe("SERIALIZABLE");
  });
});

// ─── Constraint discriminated union ─────────────────────────────────────

describe("v3 Constraint discriminated union", () => {
  it("kind narrowing で variant が型推論", () => {
    const fk: ForeignKeyConstraint = {
      id: "fk-1" as ForeignKeyConstraint["id"],
      kind: "foreignKey",
      columnIds: ["col-1" as ForeignKeyConstraint["columnIds"][number]],
      referencedTableId: "table-order" as TableId,
      referencedColumnIds: ["col-2" as ForeignKeyConstraint["referencedColumnIds"][number]],
    };
    const c: Constraint = fk;
    if (c.kind === "foreignKey") {
      expect(c.referencedTableId).toBeDefined();
    }
  });
});

// ─── FieldType discriminated union ──────────────────────────────────────

describe("v3 FieldType", () => {
  it("プリミティブ型と object 型の使い分け", () => {
    const stringType: FieldType = "string";
    const objectType: FieldType = {
      kind: "object",
      fields: [
        {
          name: "id" as Identifier,
          type: "integer",
          required: true,
        },
      ],
    };
    expect(stringType).toBe("string");
    expect(typeof objectType).toBe("object");
  });

  it("StructuredField の name は Identifier", () => {
    const f: StructuredField = {
      name: "userId" as Identifier,
      type: "string",
      required: true,
    };
    expect(f.name).toBe("userId");
  });
});

// ─── ValueSource discriminated union ────────────────────────────────────

describe("v3 ScreenItem.valueFrom", () => {
  it("flowVariable は IdentifierPath で object field 参照可", () => {
    const item: ScreenItem = {
      id: "orderNumber" as Identifier,
      label: "指示番号",
      type: "string",
      direction: "output",
      valueFrom: {
        kind: "flowVariable",
        variableName: "createdOrder.order_number" as IdentifierPath,
      },
    };
    expect(item.valueFrom?.kind).toBe("flowVariable");
  });

  it("expression variant", () => {
    const v: ValueSource = { kind: "expression", expression: "@x + @y" };
    expect(v.kind).toBe("expression");
  });
});

// ─── ScreenItemEventEffect discriminated union (#1283) ──────────────────

describe("v3 ScreenItemEventEffect", () => {
  it("clear variant — target のみ", () => {
    const e: ScreenItemEventEffect = { kind: "clear", target: "cityList" as Identifier };
    expect(e.kind).toBe("clear");
    if (e.kind === "clear") {
      expect(e.target).toBe("cityList");
    }
  });

  it("setReadonly / setEnabled / setVisible — boolean value", () => {
    const ro: ScreenItemEventEffect = { kind: "setReadonly", target: "nameInput" as Identifier, value: true };
    const en: ScreenItemEventEffect = { kind: "setEnabled", target: "submitBtn" as Identifier, value: false };
    const vi: ScreenItemEventEffect = { kind: "setVisible", target: "errorMsg" as Identifier, value: true };
    expect(ro.kind).toBe("setReadonly");
    expect(en.kind).toBe("setEnabled");
    expect(vi.kind).toBe("setVisible");
  });

  it("setReadonly — TemplateString value (条件式)", () => {
    const e: ScreenItemEventEffect = {
      kind: "setReadonly",
      target: "amountInput" as Identifier,
      value: "@self.roleCode === 'admin'" as TemplateString,
    };
    expect(e.kind).toBe("setReadonly");
    if (e.kind === "setReadonly") {
      expect(typeof e.value).toBe("string");
    }
  });

  it("setOptions — target + value (string)", () => {
    const e: ScreenItemEventEffect = { kind: "setOptions", target: "prefectureSelect" as Identifier, value: "pref-options" };
    expect(e.kind).toBe("setOptions");
  });

  it("showDialog — target + optional value", () => {
    const withValue: ScreenItemEventEffect = { kind: "showDialog", target: "confirmDialog", value: "confirm message" };
    const withoutValue: ScreenItemEventEffect = { kind: "showDialog", target: "infoDialog" };
    expect(withValue.kind).toBe("showDialog");
    expect(withoutValue.value).toBeUndefined();
  });

  it("setMessage — target + optional value", () => {
    const e: ScreenItemEventEffect = { kind: "setMessage", target: "errorArea" };
    expect(e.kind).toBe("setMessage");
    expect(e.value).toBeUndefined();
  });

  it("refreshList — target のみ", () => {
    const e: ScreenItemEventEffect = { kind: "refreshList", target: "orderList" as Identifier };
    expect(e.kind).toBe("refreshList");
  });

  it("applyAjaxResult — mapping Record<string, Identifier>", () => {
    const e: ScreenItemEventEffect = {
      kind: "applyAjaxResult",
      mapping: { "data.cities": "cityList" as Identifier },
    };
    expect(e.kind).toBe("applyAjaxResult");
    if (e.kind === "applyAjaxResult") {
      expect(e.mapping["data.cities"]).toBe("cityList");
    }
  });

  it("discriminated narrowing — switch で kind 別 access が type-safe", () => {
    const effects: ScreenItemEventEffect[] = [
      { kind: "clear", target: "fieldA" as Identifier },
      { kind: "setVisible", target: "fieldB" as Identifier, value: false },
      { kind: "applyAjaxResult", mapping: { result: "outputField" as Identifier } },
    ];
    for (const eff of effects) {
      switch (eff.kind) {
        case "clear":
          expect(eff.target).toBeDefined();
          break;
        case "setVisible":
          expect(eff.value).toBeDefined();
          break;
        case "applyAjaxResult":
          expect(eff.mapping).toBeDefined();
          break;
      }
    }
  });

  it("ScreenItemEvent.effects?: ScreenItemEventEffect[] — ScreenItem に含めた compile + parse", () => {
    const item: ScreenItem = {
      id: "submitBtn" as Identifier,
      label: "送信",
      type: "string",
      events: [
        {
          id: "click",
          handlerFlowId: "11111111-1111-4111-8111-111111111111" as ScreenItemEvent["handlerFlowId"],
          effects: [
            { kind: "clear", target: "messageArea" as Identifier },
            { kind: "setVisible", target: "spinner" as Identifier, value: true },
          ],
        } as ScreenItemEvent,
      ],
    };
    expect(item.events?.[0].effects?.length).toBe(2);
  });
});

// ─── 実 JSON との互換性 (examples/ canonical サンプル、#774) ─────────────

const repoRoot = resolve(__dirname, "../../../../");
const examplesDir = resolve(repoRoot, "examples");

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

describe("v3 TS 型 と examples/ JSON の compatibility", () => {
  // R-4 #853: project.json → harmony.json + harmony/ (dataDir) 形式に migration 済
  it("retail harmony.json を Harmony 型として parse できる", () => {
    const project = loadJson<Harmony>(join(examplesDir, "retail/harmony.json"));
    expect(project.schemaVersion).toBe("v3");
    expect(project.meta.name).toBeDefined();
  });

  it("retail 在庫照会フローを ProcessFlow 型として parse できる + Step narrow", () => {
    const flow = loadJson<ProcessFlow>(
      join(examplesDir, "retail/harmony/process-flows/cart-summary.json"),
    );
    expect(flow.meta.flowType).toBe("common"); // #1263 Phase X1: meta.kind → meta.flowType
    const firstStep: Step = flow.actions[0].steps[0];
    expect(firstStep.kind).toBe("dbAccess");
  });

  it("retail テーブルを Table 型として parse + Constraint narrow", () => {
    const files = readdirSync(join(examplesDir, "retail/harmony/tables")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const table = loadJson<Table>(join(examplesDir, "retail/harmony/tables", files[0]));
    expect(table.physicalName).toBeDefined();
    for (const c of table.constraints ?? []) {
      switch (c.kind) {
        case "unique":
          expect(c.columnIds).toBeDefined();
          break;
        case "check":
          expect(c.expression).toBeDefined();
          break;
        case "foreignKey":
          expect(c.referencedTableId).toBeDefined();
          break;
      }
    }
  });

  it("retail 画面を Screen 型として parse できる", () => {
    const files = readdirSync(join(examplesDir, "retail/harmony/screens"))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".design.json"));
    expect(files.length).toBeGreaterThan(0);
    const screen = loadJson<Screen>(join(examplesDir, "retail/harmony/screens", files[0]));
    expect(screen.kind).toBeDefined();
  });

  it("realestate harmony.json を Harmony 型として parse できる", () => {
    const project = loadJson<Harmony>(join(examplesDir, "realestate/harmony.json"));
    expect(project.schemaVersion).toBe("v3");
    expect(project.meta.name).toBeDefined();
  });

  it("realestate 処理フローを ProcessFlow 型として parse できる", () => {
    const flow = loadJson<ProcessFlow>(
      join(examplesDir, "realestate/harmony/process-flows/property-search.json"),
    );
    expect(flow.meta.flowType).toBeDefined(); // #1263 Phase X1: meta.kind → meta.flowType
  });
});
