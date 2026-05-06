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
import type { Project } from "./project";
import type { Table, Constraint, ForeignKeyConstraint } from "./table";
import type { Screen } from "./screen";
import type { ScreenItem, ValueSource } from "./screen-item";
import type {
  Uuid,
  TableId,
  ProcessFlowId,
  Identifier,
  IdentifierPath,
  FieldType,
  StructuredField,
} from "./common";

// ─── Branded types compile-time check ─────────────────────────────────────

describe("v3 branded types", () => {
  it("Uuid と TableId は別ブランド (代入互換性なし)", () => {
    // 型レベルテスト — 以下は compile error にならないか確認するためのコメント例:
    // const tableId: TableId = "..." as Uuid;  // ← Error: Uuid is not assignable to TableId
    // const uuid: Uuid = "..." as TableId;     // ← OK (TableId extends Uuid)
    // 実行時テストは代用として string 型互換性のみ確認
    const tableId = "11111111-1111-4111-8111-111111111111" as TableId;
    const asUuid: Uuid = tableId; // TableId is Uuid + brand → Uuid に代入可能
    expect(typeof asUuid).toBe("string");
  });

  it("Identifier と IdentifierPath は別ブランド", () => {
    const id = "userId" as Identifier;
    const path = "createdOrder.order_number" as IdentifierPath;
    expect(typeof id).toBe("string");
    expect(typeof path).toBe("string");
    // const wrongAssign: Identifier = path;  // ← compile error (different brands)
  });
});

// ─── Step discriminated union narrowing ─────────────────────────────────

describe("v3 Step discriminated union", () => {
  it("kind narrowing で variant が型推論される", () => {
    const step: Step = {
      id: "step-01" as Step["id"],
      kind: "validation",
      description: "test",
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
      tableId: "11111111-1111-4111-8111-111111111111" as TableId,
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
          tableId: "11111111-1111-4111-8111-111111111111" as TableId,
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
      referencedTableId: "22222222-2222-4222-8222-222222222222" as TableId,
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

// ─── 実 JSON との互換性 (examples/ canonical サンプル、#774) ─────────────

const repoRoot = resolve(__dirname, "../../../../");
const examplesDir = resolve(repoRoot, "examples");

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

describe("v3 TS 型 と examples/ JSON の compatibility", () => {
  it("retail project.json を Project 型として parse できる", () => {
    const project = loadJson<Project>(join(examplesDir, "retail/project.json"));
    expect(project.schemaVersion).toBe("v3");
    expect(project.meta.name).toBeDefined();
  });

  it("retail 在庫照会フローを ProcessFlow 型として parse できる + Step narrow", () => {
    const flow = loadJson<ProcessFlow>(
      join(examplesDir, "retail/process-flows/267e94bf-0397-44b8-b665-d3c40c38935b.json"),
    );
    expect(flow.meta.kind).toBe("common");
    const firstStep: Step = flow.actions[0].steps[0];
    expect(firstStep.kind).toBe("dbAccess");
  });

  it("retail テーブルを Table 型として parse + Constraint narrow", () => {
    const files = readdirSync(join(examplesDir, "retail/tables")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const table = loadJson<Table>(join(examplesDir, "retail/tables", files[0]));
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
    const files = readdirSync(join(examplesDir, "retail/screens"))
      .filter((f) => f.endsWith(".json") && !f.endsWith(".design.json"));
    expect(files.length).toBeGreaterThan(0);
    const screen = loadJson<Screen>(join(examplesDir, "retail/screens", files[0]));
    expect(screen.kind).toBeDefined();
  });

  it("realestate project.json を Project 型として parse できる", () => {
    const project = loadJson<Project>(join(examplesDir, "realestate/project.json"));
    expect(project.schemaVersion).toBe("v3");
    expect(project.meta.name).toBeDefined();
  });

  it("realestate 処理フローを ProcessFlow 型として parse できる", () => {
    const flow = loadJson<ProcessFlow>(
      join(examplesDir, "realestate/process-flows/d4b5c6e7-f809-4112-bc3d-4e5f6a7b8c9d.json"),
    );
    expect(flow.meta.kind).toBeDefined();
  });
});
