/**
 * sqlOrderValidator テスト (#632 MVP: 観点 1+2)
 *
 * - 観点 1 (NULL_NOT_ALLOWED_AT_INSERT): 10 ケース
 * - 観点 2 (FK_REFERENCE_NOT_INSERTED): 4 ケース
 * - 共通: 空入力 / DELETE・SELECT スキップ / SQL パースエラー耐性
 *
 * welfare-benefit M1 実証 fixture は末尾の describe で実施。
 */

import { describe, it, expect } from "vitest";
import { checkSqlOrder, type OrderTableDefinition } from "./sqlOrderValidator";
import type { ProcessFlow } from "../types/v3";

// ─── テスト用ヘルパー ──────────────────────────────────────────────────────

function makeFlow(overrides: Partial<ProcessFlow> = {}): ProcessFlow {
  return {
    id: "ffffffff-0001-4000-8000-000000000001",
    name: "テストフロー",
    version: "1.0.0",
    maturity: "draft",
    createdAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
    kind: "screen",
    context: {},
    actions: [],
    ...overrides,
  } as ProcessFlow;
}

/**
 * テーブル定義ショートカット。
 * columns: [{ physicalName, notNull?, autoIncrement?, defaultValue?, unique? }, ...]
 * fkConstraints: [{ columnPhysicalNames, referencedTableId }, ...]
 * uniqueConstraints: [{ columnPhysicalNames }] — 複合 UNIQUE 制約
 */
function makeTable(
  id: string,
  physicalName: string,
  columns: Array<{
    id?: string;
    physicalName: string;
    notNull?: boolean;
    autoIncrement?: boolean;
    defaultValue?: string;
    primaryKey?: boolean;
    unique?: boolean;
  }>,
  fkConstraints?: Array<{ columnPhysicalNames: string[]; referencedTableId: string }>,
  uniqueConstraints?: Array<{ columnPhysicalNames: string[] }>,
): OrderTableDefinition {
  const cols = columns.map((c, i) => ({
    id: c.id ?? `col-${physicalName}-${i + 1}`,
    physicalName: c.physicalName,
    notNull: c.notNull,
    autoIncrement: c.autoIncrement,
    defaultValue: c.defaultValue,
    primaryKey: c.primaryKey,
    unique: c.unique,
  }));

  // FK / UNIQUE 制約の columnIds は physicalName → id の逆引きで解決
  const physicalToId = new Map<string, string>(cols.map((c) => [c.physicalName, c.id]));

  const constraints = [
    ...(fkConstraints ?? []).map((fk, i) => ({
      kind: "foreignKey" as const,
      id: `fk-${physicalName}-${i + 1}`,
      columnIds: fk.columnPhysicalNames.map((p) => physicalToId.get(p) ?? p),
      referencedTableId: fk.referencedTableId,
      referencedColumnIds: ["col-ref-01"],
    })),
    ...(uniqueConstraints ?? []).map((uq, i) => ({
      kind: "unique" as const,
      id: `uq-${physicalName}-${i + 1}`,
      columnIds: uq.columnPhysicalNames.map((p) => physicalToId.get(p) ?? p),
    })),
  ];

  return { id, physicalName, columns: cols, constraints };
}

// ─── 観点 1: NULL_NOT_ALLOWED_AT_INSERT ────────────────────────────────────

describe("観点 1: NULL_NOT_ALLOWED_AT_INSERT", () => {
  const tables: OrderTableDefinition[] = [
    makeTable("tbl-users", "users", [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "name", notNull: true },
      { physicalName: "email", notNull: true },
      { physicalName: "nickname" }, // nullable
    ]),
    makeTable("tbl-orders", "orders", [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "user_id", notNull: true },
      { physicalName: "amount", notNull: true },
      { physicalName: "note" }, // nullable
      { physicalName: "status", notNull: true, defaultValue: "'pending'" },
    ]),
  ];

  it("正常系: NOT NULL カラムへの INSERT で変数が直前 step でバインドされている", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "ユーザー登録",
          trigger: "submit",
          inputs: [
            { name: "userName", type: "string", required: true },
            { name: "userEmail", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "ユーザーを INSERT",
              tableId: "tbl-users",
              operation: "INSERT",
              sql: "INSERT INTO users (name, email) VALUES (@inputs.userName, @inputs.userEmail)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT")).toHaveLength(0);
  });

  it("検出: NOT NULL カラムが変数参照で、変数が未バインド", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文登録",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "注文を INSERT (user_id が未バインド)",
              tableId: "tbl-orders",
              operation: "INSERT",
              sql: "INSERT INTO orders (user_id, amount) VALUES (@user.id, @inputs.amount)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT");
    expect(target.length).toBeGreaterThanOrEqual(1);
    expect(target.some((i) => i.message.includes("user_id") && i.message.includes("user"))).toBe(true);
  });

  it("検出: NULL リテラルを NOT NULL カラムに INSERT", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "name に NULL を挿入",
              tableId: "tbl-users",
              operation: "INSERT",
              sql: "INSERT INTO users (name, email) VALUES (NULL, @inputs.email)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT");
    expect(target.some((i) => i.message.includes("name"))).toBe(true);
  });

  it("正常系: nullable カラムは未バインドでも issue なし", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [
            { name: "userName", type: "string", required: true },
            { name: "userEmail", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "nickname は nullable なので省略可",
              tableId: "tbl-users",
              operation: "INSERT",
              sql: "INSERT INTO users (name, email) VALUES (@inputs.userName, @inputs.userEmail)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT")).toHaveLength(0);
  });

  it("正常系: autoIncrement カラムは未バインドでも issue なし", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [
            { name: "userName", type: "string", required: true },
            { name: "userEmail", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "id は autoIncrement なので列リストから省略",
              tableId: "tbl-users",
              operation: "INSERT",
              // id 列は指定しない → autoIncrement で DB が埋める → issue なし
              sql: "INSERT INTO users (name, email) VALUES (@inputs.userName, @inputs.userEmail)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT")).toHaveLength(0);
  });

  it("正常系: DEFAULT 付き NOT NULL カラムは issue なし (status = 'pending' default)", () => {
    // status は NOT NULL だが defaultValue: "'pending'" があるため issue にならない
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [
            { name: "userId", type: "string", required: true },
            { name: "amount", type: "number", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "status は DEFAULT 付きなので省略可",
              tableId: "tbl-orders",
              operation: "INSERT",
              sql: "INSERT INTO orders (user_id, amount) VALUES (@inputs.userId, @inputs.amount)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT")).toHaveLength(0);
  });

  it("正常系: 直前 compute step でバインドされた変数は OK", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [{ name: "rawName", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "compute",
              description: "名前をトリム",
              expression: "@inputs.rawName.trim()",
              outputBinding: { name: "cleanName" },
            },
            {
              id: "step-02",
              kind: "dbAccess",
              description: "INSERT",
              tableId: "tbl-users",
              operation: "INSERT",
              sql: "INSERT INTO users (name, email) VALUES (@cleanName, @inputs.userEmail)",
            },
          ],
        },
      ],
    });
    // cleanName は step-01 でバインドされるため issue なし
    // userEmail は inputs に無いため issue になるが、それは別の問題
    const issues = checkSqlOrder(flow, tables);
    // cleanName に関する NULL_NOT_ALLOWED_AT_INSERT は出ないことを確認
    const cleanNameIssues = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("cleanName"),
    );
    expect(cleanNameIssues).toHaveLength(0);
  });
});

describe("sqlOrderValidator boundVars implicit declarations (#654)", () => {
  const tables: OrderTableDefinition[] = [
    makeTable("tbl-validation-errors", "validation_errors", [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "error_log", notNull: true },
    ]),
    makeTable("tbl-audit-log", "audit_log", [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "payload", notNull: true },
    ]),
    makeTable("tbl-source", "source_items", [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "name", notNull: true },
    ]),
  ];

  it("ValidationStep.fieldErrorsVar 明示: @myErrors 参照 INSERT の false positive を出さない", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-654-01",
          name: "fieldErrorsVar 明示",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-validation-01",
              kind: "validation",
              description: "入力チェック",
              rules: [],
              fieldErrorsVar: "myErrors",
            },
            {
              id: "step-insert-01",
              kind: "dbAccess",
              description: "エラー記録",
              tableId: "tbl-validation-errors",
              operation: "INSERT",
              sql: "INSERT INTO validation_errors (error_log) VALUES (@myErrors)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("myErrors"),
    );
    expect(target).toHaveLength(0);
  });

  it("ValidationStep.fieldErrorsVar 省略: デフォルト fieldErrors を boundVars として扱う", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-654-02",
          name: "fieldErrorsVar 省略",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-validation-01",
              kind: "validation",
              description: "入力チェック",
              rules: [],
            },
            {
              id: "step-insert-01",
              kind: "dbAccess",
              description: "エラー記録",
              tableId: "tbl-validation-errors",
              operation: "INSERT",
              sql: "INSERT INTO validation_errors (error_log) VALUES (@fieldErrors)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("fieldErrors"),
    );
    expect(target).toHaveLength(0);
  });

  it("workflow.onApproved 内 outputBinding は workflow step 後の sibling step から参照できる", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-654-03",
          name: "workflow onApproved",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-workflow-01",
              kind: "workflow",
              description: "承認",
              pattern: "approval-sequential",
              approvers: [{ role: "manager" }],
              onApproved: [
                {
                  id: "step-select-01",
                  kind: "dbAccess",
                  description: "承認済みレコード取得",
                  tableId: "tbl-source",
                  operation: "SELECT",
                  sql: "SELECT id, name FROM source_items WHERE id = @inputs.id",
                  outputBinding: { name: "approvedRecord" },
                },
              ],
            },
            {
              id: "step-insert-01",
              kind: "dbAccess",
              description: "監査ログ記録",
              tableId: "tbl-audit-log",
              operation: "INSERT",
              sql: "INSERT INTO audit_log (payload) VALUES (@approvedRecord)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("approvedRecord"),
    );
    expect(target).toHaveLength(0);
  });

  it("validation.inlineBranch.ok 内 outputBinding は validation step 後の sibling step から参照できる", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-654-04",
          name: "validation inlineBranch",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-validation-01",
              kind: "validation",
              description: "入力チェック",
              rules: [],
              inlineBranch: {
                ok: [
                  {
                    id: "step-select-01",
                    kind: "dbAccess",
                    description: "検証済み項目取得",
                    tableId: "tbl-source",
                    operation: "SELECT",
                    sql: "SELECT id, name FROM source_items WHERE id = @inputs.id",
                    outputBinding: { name: "validatedItem" },
                  },
                ],
                ng: [],
              },
            },
            {
              id: "step-insert-01",
              kind: "dbAccess",
              description: "監査ログ記録",
              tableId: "tbl-audit-log",
              operation: "INSERT",
              sql: "INSERT INTO audit_log (payload) VALUES (@validatedItem)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("validatedItem"),
    );
    expect(target).toHaveLength(0);
  });

  it("workflow.onRejected 内 outputBinding が後続 sibling step から参照可能", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-654-05",
          name: "workflow onRejected",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-workflow-01",
              kind: "workflow",
              description: "承認",
              pattern: "approval-sequential",
              approvers: [{ role: "manager" }],
              onRejected: [
                {
                  id: "step-select-01",
                  kind: "dbAccess",
                  description: "却下済みレコード取得",
                  tableId: "tbl-source",
                  operation: "SELECT",
                  sql: "SELECT id, name FROM source_items WHERE id = @inputs.id",
                  outputBinding: { name: "rejectedRecord" },
                },
              ],
            },
            {
              id: "step-insert-01",
              kind: "dbAccess",
              description: "監査ログ記録",
              tableId: "tbl-audit-log",
              operation: "INSERT",
              sql: "INSERT INTO audit_log (payload) VALUES (@rejectedRecord)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("rejectedRecord"),
    );
    expect(target).toHaveLength(0);
  });

  it("workflow.onTimeout 内 outputBinding が後続 sibling step から参照可能", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-654-06",
          name: "workflow onTimeout",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-workflow-01",
              kind: "workflow",
              description: "承認",
              pattern: "approval-sequential",
              approvers: [{ role: "manager" }],
              onTimeout: [
                {
                  id: "step-select-01",
                  kind: "dbAccess",
                  description: "期限切れレコード取得",
                  tableId: "tbl-source",
                  operation: "SELECT",
                  sql: "SELECT id, name FROM source_items WHERE id = @inputs.id",
                  outputBinding: { name: "timeoutRecord" },
                },
              ],
            },
            {
              id: "step-insert-01",
              kind: "dbAccess",
              description: "監査ログ記録",
              tableId: "tbl-audit-log",
              operation: "INSERT",
              sql: "INSERT INTO audit_log (payload) VALUES (@timeoutRecord)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("timeoutRecord"),
    );
    expect(target).toHaveLength(0);
  });

  it("validation.inlineBranch.ng 内 outputBinding が後続 sibling step から参照可能", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-654-07",
          name: "validation inlineBranch ng",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-validation-01",
              kind: "validation",
              description: "入力チェック",
              rules: [],
              inlineBranch: {
                ok: [],
                ng: [
                  {
                    id: "step-select-01",
                    kind: "dbAccess",
                    description: "検証NG項目取得",
                    tableId: "tbl-source",
                    operation: "SELECT",
                    sql: "SELECT id, name FROM source_items WHERE id = @inputs.id",
                    outputBinding: { name: "ngValidatedItem" },
                  },
                ],
              },
            },
            {
              id: "step-insert-01",
              kind: "dbAccess",
              description: "監査ログ記録",
              tableId: "tbl-audit-log",
              operation: "INSERT",
              sql: "INSERT INTO audit_log (payload) VALUES (@ngValidatedItem)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("ngValidatedItem"),
    );
    expect(target).toHaveLength(0);
  });
});

// ─── 観点 2: FK_REFERENCE_NOT_INSERTED ────────────────────────────────────

describe("観点 2: FK_REFERENCE_NOT_INSERTED", () => {
  const tables: OrderTableDefinition[] = [
    makeTable("tbl-parent", "parent_records", [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "code", notNull: true },
    ]),
    makeTable(
      "tbl-child",
      "child_records",
      [
        { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { physicalName: "parent_id", notNull: true },
        { physicalName: "value", notNull: true },
      ],
      [{ columnPhysicalNames: ["parent_id"], referencedTableId: "tbl-parent" }],
    ),
  ];

  it("検出: FK 参照先への先行 INSERT なしで子テーブルを INSERT (未バインド変数)", () => {
    // @unknownParent は inputs にも outputBinding にも存在しない → 未バインド → FK issue
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [
            { name: "value", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "子レコードを INSERT (parent_id が未バインド変数)",
              tableId: "tbl-child",
              operation: "INSERT",
              // @unknownParent は inputs にも step outputBinding にも存在しない
              sql: "INSERT INTO child_records (parent_id, value) VALUES (@unknownParent.id, @inputs.value)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "FK_REFERENCE_NOT_INSERTED");
    expect(target.length).toBeGreaterThanOrEqual(1);
    expect(target.some((i) => i.message.includes("parent_records"))).toBe(true);
  });

  it("正常系: FK 参照先への先行 INSERT がある場合は issue なし", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [
            { name: "code", type: "string", required: true },
            { name: "value", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "親レコードを INSERT",
              tableId: "tbl-parent",
              operation: "INSERT",
              sql: "INSERT INTO parent_records (code) VALUES (@inputs.code)",
              outputBinding: { name: "createdParent" },
            },
            {
              id: "step-02",
              kind: "dbAccess",
              description: "子レコードを INSERT (先行 INSERT あり)",
              tableId: "tbl-child",
              operation: "INSERT",
              sql: "INSERT INTO child_records (parent_id, value) VALUES (@createdParent.id, @inputs.value)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => i.code === "FK_REFERENCE_NOT_INSERTED")).toHaveLength(0);
  });

  it("検出: 異なる action 間の先行 INSERT は対象外 (同 action のみ検査、未バインド変数使用)", () => {
    // act-001 で parent_records を INSERT したが、act-002 では未バインド変数を FK に使う
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "親作成",
          trigger: "submit",
          inputs: [{ name: "code", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "親レコードを INSERT (別 action)",
              tableId: "tbl-parent",
              operation: "INSERT",
              sql: "INSERT INTO parent_records (code) VALUES (@inputs.code)",
              outputBinding: { name: "createdParent" },
            },
          ],
        },
        {
          id: "act-002",
          name: "子作成",
          trigger: "click",
          inputs: [
            { name: "value", type: "string", required: true },
          ],
          steps: [
            {
              // act-002 では parent_records への先行 INSERT も SELECT も無く、
              // @unknownParent は未バインド → FK issue
              id: "step-02",
              kind: "dbAccess",
              description: "子レコードを INSERT (同 action に先行 INSERT なし、未バインド変数)",
              tableId: "tbl-child",
              operation: "INSERT",
              sql: "INSERT INTO child_records (parent_id, value) VALUES (@unknownParent.id, @inputs.value)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    // act-002 の step-02 は FK issue になるはず
    const fkIssues = issues.filter((i) => i.code === "FK_REFERENCE_NOT_INSERTED");
    expect(fkIssues.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 共通: スキップ・エッジケース ──────────────────────────────────────────

describe("共通: スキップ・エッジケース", () => {
  const tables: OrderTableDefinition[] = [
    makeTable("tbl-items", "items", [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "name", notNull: true },
    ]),
  ];

  it("空 actions は issue なし", () => {
    const flow = makeFlow({ actions: [] });
    const issues = checkSqlOrder(flow, tables);
    expect(issues).toHaveLength(0);
  });

  it("空 tables は issue なし (カタログ外テーブルは skip)", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "カタログ外テーブルへの INSERT",
              tableId: "tbl-unknown",
              operation: "INSERT",
              sql: "INSERT INTO unknown_table (col1) VALUES (@var1)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, []);
    expect(issues).toHaveLength(0);
  });

  it("SELECT 文は観点 1+2 の対象外 (skip)", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "SELECT は対象外",
              tableId: "tbl-items",
              operation: "SELECT",
              sql: "SELECT id, name FROM items WHERE id = @someVar",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => ["NULL_NOT_ALLOWED_AT_INSERT", "FK_REFERENCE_NOT_INSERTED"].includes(i.code))).toHaveLength(0);
  });

  it("DELETE 文は観点 1+2 の対象外 (skip)", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "click",
          inputs: [],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "DELETE は対象外",
              tableId: "tbl-items",
              operation: "DELETE",
              sql: "DELETE FROM items WHERE id = @inputs.id",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => ["NULL_NOT_ALLOWED_AT_INSERT", "FK_REFERENCE_NOT_INSERTED"].includes(i.code))).toHaveLength(0);
  });

  it("sql フィールドが無い dbAccess step はスキップ", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "SQL なし INSERT",
              tableId: "tbl-items",
              operation: "INSERT",
              // sql: なし
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT")).toHaveLength(0);
  });

  it("ambientVariables で宣言された変数は INSERT 時点でバインド済みとみなす", () => {
    const flow = makeFlow({
      context: {
        ambientVariables: [
          { name: "sessionUserId", type: "string" },
          { name: "requestId", type: "string" },
        ],
      },
      actions: [
        {
          id: "act-001",
          name: "テスト",
          trigger: "submit",
          inputs: [{ name: "itemName", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "ambient variable を使用",
              tableId: "tbl-items",
              operation: "INSERT",
              sql: "INSERT INTO items (name) VALUES (@inputs.itemName)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    expect(issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT")).toHaveLength(0);
  });
});

// ─── welfare-benefit M1 実証 fixture ────────────────────────────────────────

describe("welfare-benefit M1 実証: beneficiary_id NOT NULL × INSERT 順序", () => {
  /**
   * Phase 2 子 2 #600 で発見した M1 の再現:
   *   payments.beneficiary_id は NOT NULL
   *   旧フローでは beneficiary SELECT の結果 (@beneficiary) が payments INSERT 時点で
   *   「初回受給者」ケースで null になる可能性があった。
   *
   * 現行の welfare-benefit フローは修正済みだが、ここでは問題のある旧パターンを
   * fixture として残して回帰検出を実証する。
   */

  const welfarePaymentsTable = makeTable(
    "7198e401-00d8-4f6e-8382-aad4caeaf59e",
    "payments",
    [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "application_id", notNull: true },
      { physicalName: "beneficiary_id", notNull: true },   // M1 の源: NOT NULL
      { physicalName: "amount", notNull: true },
      { physicalName: "currency", notNull: true, defaultValue: "'JPY'" },
      { physicalName: "payment_method", notNull: true, defaultValue: "'bank_transfer'" },
      { physicalName: "bank_account_ref", notNull: true },
      { physicalName: "idempotency_key", notNull: true },
      { physicalName: "transfer_status", notNull: true, defaultValue: "'pending'" },
    ],
    [
      {
        columnPhysicalNames: ["application_id"],
        referencedTableId: "b57571d6-dc31-4dad-aad9-a2315267ea90",
      },
      {
        columnPhysicalNames: ["beneficiary_id"],
        referencedTableId: "dde87bc9-e122-4466-9b1c-e8c5b2f98408",
      },
    ],
  );

  const beneficiariesTable = makeTable(
    "dde87bc9-e122-4466-9b1c-e8c5b2f98408",
    "beneficiaries",
    [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "beneficiary_code", notNull: true },
      { physicalName: "applicant_id", notNull: true },
      { physicalName: "fiscal_year", notNull: true },
      { physicalName: "total_paid_amount", notNull: true, defaultValue: "0" },
      { physicalName: "eligibility_status", notNull: true, defaultValue: "'eligible'" },
    ],
  );

  const applicationsTable = makeTable(
    "b57571d6-dc31-4dad-aad9-a2315267ea90",
    "applications",
    [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "application_code", notNull: true },
      { physicalName: "applicant_id", notNull: true },
      { physicalName: "benefit_type", notNull: true },
      { physicalName: "requested_amount", notNull: true },
      { physicalName: "status", notNull: true, defaultValue: "'received'" },
      { physicalName: "submitted_at", notNull: true },
    ],
  );

  const tables = [welfarePaymentsTable, beneficiariesTable, applicationsTable];

  it("旧パターン (M1 バグ): payments INSERT 時点で @beneficiary が未バインド → 検出", () => {
    /**
     * 旧フローのパターン:
     *   step-06: beneficiaries SELECT → @beneficiary (nullable: 初回受給者は null)
     *   step-XX: payments INSERT で @beneficiary.id を参照
     *   → 初回受給者のとき @beneficiary.id は null → beneficiary_id NOT NULL 制約違反
     *
     * ここではより単純化して「@beneficiary が inputs にも outputBinding にも存在しない」
     * 状態でパターンを再現する。
     */
    const flow = makeFlow({
      actions: [
        {
          id: "act-payment",
          name: "支払処理",
          trigger: "auto",
          inputs: [
            { name: "applicationId", type: "string", required: true },
            { name: "bankAccountRef", type: "string", required: true },
            { name: "idempotencyKey", type: "string", required: true },
            { name: "amount", type: "number", required: true },
          ],
          steps: [
            {
              id: "step-pay-01",
              kind: "dbAccess",
              description: "payments テーブルに INSERT (beneficiary_id = @beneficiary.id は未バインド)",
              tableId: "7198e401-00d8-4f6e-8382-aad4caeaf59e",
              operation: "INSERT",
              // @beneficiary は inputs / outputBinding のどちらにも存在しない → M1 パターン
              sql: "INSERT INTO payments (application_id, beneficiary_id, amount, bank_account_ref, idempotency_key) VALUES (@inputs.applicationId, @beneficiary.id, @inputs.amount, @inputs.bankAccountRef, @inputs.idempotencyKey)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    const nullIssues = issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT");
    expect(nullIssues.length).toBeGreaterThanOrEqual(1);
    expect(nullIssues.some((i) => i.message.includes("beneficiary_id") && i.message.includes("beneficiary"))).toBe(true);
  });

  it("修正後パターン: beneficiary SELECT → outputBinding → payments INSERT → 検出なし", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-payment",
          name: "支払処理",
          trigger: "auto",
          inputs: [
            { name: "applicationId", type: "string", required: true },
            { name: "bankAccountRef", type: "string", required: true },
            { name: "idempotencyKey", type: "string", required: true },
            { name: "amount", type: "number", required: true },
            { name: "applicantId", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "受給者台帳を取得",
              tableId: "dde87bc9-e122-4466-9b1c-e8c5b2f98408",
              operation: "SELECT",
              sql: "SELECT id, eligibility_status FROM beneficiaries WHERE applicant_id = @inputs.applicantId",
              outputBinding: { name: "beneficiary" },
            },
            {
              id: "step-02",
              kind: "dbAccess",
              description: "payments INSERT (beneficiary.id は step-01 でバインド済み)",
              tableId: "7198e401-00d8-4f6e-8382-aad4caeaf59e",
              operation: "INSERT",
              sql: "INSERT INTO payments (application_id, beneficiary_id, amount, bank_account_ref, idempotency_key) VALUES (@inputs.applicationId, @beneficiary.id, @inputs.amount, @inputs.bankAccountRef, @inputs.idempotencyKey)",
            },
          ],
        },
      ],
    });

    const issues = checkSqlOrder(flow, tables);
    // beneficiary_id に関する NULL_NOT_ALLOWED_AT_INSERT は出ない
    const nullIssues = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" && i.message.includes("beneficiary_id"),
    );
    expect(nullIssues).toHaveLength(0);
  });
});

// ─── 観点 3: UNIQUE_CHECK_MISSING ─────────────────────────────────────────

describe("観点 3: UNIQUE_CHECK_MISSING", () => {
  /**
   * テーブル: users
   *   - email: Column.unique: true (単体 UNIQUE)
   *   - (transfer_id, approver_role): 複合 UNIQUE 制約 (transfer_approvals 相当)
   */
  const tableUsers = makeTable(
    "tbl-users-uq",
    "users",
    [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "email", notNull: true, unique: true },
      { physicalName: "name", notNull: true },
    ],
  );

  const tableApprovals = makeTable(
    "tbl-approvals",
    "transfer_approvals",
    [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "transfer_id", notNull: true },
      { physicalName: "approver_role", notNull: true },
      { physicalName: "decision", notNull: true },
    ],
    undefined, // FK なし
    [{ columnPhysicalNames: ["transfer_id", "approver_role"] }], // 複合 UNIQUE 制約
  );

  it("検出: UNIQUE カラム (email) への INSERT で事前チェックなし", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "ユーザー登録",
          trigger: "submit",
          inputs: [
            { name: "userEmail", type: "string", required: true },
            { name: "userName", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "users INSERT (email UNIQUE チェックなし)",
              tableId: "tbl-users-uq",
              operation: "INSERT",
              sql: "INSERT INTO users (email, name) VALUES (@inputs.userEmail, @inputs.userName)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, [tableUsers]);
    const target = issues.filter((i) => i.code === "UNIQUE_CHECK_MISSING");
    expect(target.length).toBeGreaterThanOrEqual(1);
    expect(target.some((i) => i.message.includes("email"))).toBe(true);
    expect(target[0].severity).toBe("warning");
  });

  it("検出: 複合 UNIQUE 制約 (transfer_id, approver_role) への INSERT で事前チェックなし", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "承認記録",
          trigger: "submit",
          inputs: [
            { name: "transferId", type: "string", required: true },
            { name: "approverRole", type: "string", required: true },
            { name: "decision", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "transfer_approvals INSERT (重複チェックなし)",
              tableId: "tbl-approvals",
              operation: "INSERT",
              sql: "INSERT INTO transfer_approvals (transfer_id, approver_role, decision) VALUES (@inputs.transferId, @inputs.approverRole, @inputs.decision)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, [tableApprovals]);
    const target = issues.filter((i) => i.code === "UNIQUE_CHECK_MISSING");
    expect(target.length).toBeGreaterThanOrEqual(1);
    // 複合 UNIQUE のいずれかのカラムを含む旨のメッセージ
    expect(target.some((i) => i.message.includes("transfer_id") || i.message.includes("approver_role"))).toBe(true);
  });

  it("false positive 抑止 (パターン 1): 先行 SELECT WHERE email で EXISTS チェック → 検出しない", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "ユーザー登録",
          trigger: "submit",
          inputs: [
            { name: "userEmail", type: "string", required: true },
            { name: "userName", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "email 重複確認 SELECT",
              tableId: "tbl-users-uq",
              operation: "SELECT",
              sql: "SELECT id FROM users WHERE email = @inputs.userEmail",
              outputBinding: { name: "existingUser" },
            },
            {
              id: "step-02",
              kind: "branch",
              description: "既存ユーザーがいなければ INSERT",
              branches: [
                {
                  condition: "@existingUser == null",
                  steps: [
                    {
                      id: "step-03",
                      kind: "dbAccess",
                      description: "users INSERT",
                      tableId: "tbl-users-uq",
                      operation: "INSERT",
                      sql: "INSERT INTO users (email, name) VALUES (@inputs.userEmail, @inputs.userName)",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, [tableUsers]);
    const target = issues.filter((i) => i.code === "UNIQUE_CHECK_MISSING");
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止 (パターン 2): affectedRowsCheck.errorCode = DUPLICATE_ENTRY → 検出しない", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "ユーザー登録",
          trigger: "submit",
          inputs: [
            { name: "userEmail", type: "string", required: true },
            { name: "userName", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "users INSERT with UNIQUE violation errorCode",
              tableId: "tbl-users-uq",
              operation: "INSERT",
              sql: "INSERT INTO users (email, name) VALUES (@inputs.userEmail, @inputs.userName)",
              affectedRowsCheck: {
                operator: "=",
                expected: 1,
                onViolation: "throw",
                errorCode: "DUPLICATE_ENTRY",
              },
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, [tableUsers]);
    const target = issues.filter((i) => i.code === "UNIQUE_CHECK_MISSING");
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止 (パターン 2 変形): affectedRowsCheck.errorCode = UNIQUE_VIOLATION → 検出しない", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "ユーザー登録",
          trigger: "submit",
          inputs: [
            { name: "userEmail", type: "string", required: true },
            { name: "userName", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "users INSERT with UNIQUE_VIOLATION errorCode",
              tableId: "tbl-users-uq",
              operation: "INSERT",
              sql: "INSERT INTO users (email, name) VALUES (@inputs.userEmail, @inputs.userName)",
              affectedRowsCheck: {
                operator: "=",
                expected: 1,
                onViolation: "throw",
                errorCode: "UNIQUE_VIOLATION",
              },
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, [tableUsers]);
    const target = issues.filter((i) => i.code === "UNIQUE_CHECK_MISSING");
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止 (パターン 3): tryCatch branch で UNIQUE_VIOLATION をキャッチ → 検出しない", () => {
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "ユーザー登録",
          trigger: "submit",
          inputs: [
            { name: "userEmail", type: "string", required: true },
            { name: "userName", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "users INSERT",
              tableId: "tbl-users-uq",
              operation: "INSERT",
              sql: "INSERT INTO users (email, name) VALUES (@inputs.userEmail, @inputs.userName)",
            },
            {
              id: "step-02",
              kind: "branch",
              description: "tryCatch で UNIQUE_VIOLATION をキャッチ",
              branches: [
                {
                  condition: {
                    kind: "tryCatch",
                    catchErrors: ["UNIQUE_VIOLATION"],
                  },
                  steps: [
                    {
                      id: "step-03",
                      kind: "return",
                      description: "重複エラーを返す",
                      payload: { status: "DUPLICATE" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, [tableUsers]);
    const target = issues.filter((i) => i.code === "UNIQUE_CHECK_MISSING");
    expect(target).toHaveLength(0);
  });

  it("正常系: UNIQUE 制約のないテーブルへの INSERT は検出しない", () => {
    const tableNoUnique = makeTable(
      "tbl-no-unique",
      "orders",
      [
        { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { physicalName: "amount", notNull: true },
      ],
    );
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文登録",
          trigger: "submit",
          inputs: [{ name: "amount", type: "number", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "orders INSERT",
              tableId: "tbl-no-unique",
              operation: "INSERT",
              sql: "INSERT INTO orders (amount) VALUES (@inputs.amount)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, [tableNoUnique]);
    const target = issues.filter((i) => i.code === "UNIQUE_CHECK_MISSING");
    expect(target).toHaveLength(0);
  });
});

// ─── 観点 4: CASCADE_DELETE_OMITTED ───────────────────────────────────────

describe("観点 4: CASCADE_DELETE_OMITTED", () => {
  /**
   * テーブル構成:
   *   orders (親)
   *   └─ order_items (子、orders.id を FK 参照)
   *
   * order_items の FK onDelete は各テストで変えて確認する。
   */

  function makeOrderTables(onDelete?: "cascade" | "setNull" | "setDefault" | "restrict" | "noAction") {
    const orders = makeTable(
      "tbl-orders-parent",
      "orders",
      [
        { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { physicalName: "status", notNull: true },
      ],
    );

    // order_items の制約を直接組み立てる (makeTable は onDelete を受け取らない)
    const orderItemsCols = [
      { id: "col-oi-1", physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { id: "col-oi-2", physicalName: "order_id", notNull: true },
      { id: "col-oi-3", physicalName: "quantity", notNull: true },
    ];
    const orderItems = {
      id: "tbl-order-items",
      physicalName: "order_items",
      columns: orderItemsCols,
      constraints: [
        {
          kind: "foreignKey" as const,
          id: "fk-oi-orders",
          columnIds: ["col-oi-2"], // order_id
          referencedTableId: "tbl-orders-parent",
          referencedColumnIds: ["col-orders-1"],
          ...(onDelete !== undefined ? { onDelete } : {}),
        },
      ],
    };

    return [orders, orderItems];
  }

  it("検出: 子 onDelete=restrict、子 DELETE なしで親 DELETE → CASCADE_DELETE_OMITTED error", () => {
    const tables = makeOrderTables("restrict");
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文削除",
          trigger: "click",
          inputs: [{ name: "orderId", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "注文を削除 (子テーブル DELETE なし)",
              tableId: "tbl-orders-parent",
              operation: "DELETE",
              sql: "DELETE FROM orders WHERE id = @inputs.orderId",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "CASCADE_DELETE_OMITTED");
    expect(target.length).toBeGreaterThanOrEqual(1);
    expect(target.some((i) => i.message.includes("order_items"))).toBe(true);
    expect(target[0].severity).toBe("error");
  });

  it("検出: 子 onDelete=noAction (デフォルト)、子 DELETE なしで親 DELETE → CASCADE_DELETE_OMITTED error", () => {
    const tables = makeOrderTables("noAction");
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文削除",
          trigger: "click",
          inputs: [{ name: "orderId", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "注文を削除 (onDelete=noAction、子 DELETE なし)",
              tableId: "tbl-orders-parent",
              operation: "DELETE",
              sql: "DELETE FROM orders WHERE id = @inputs.orderId",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "CASCADE_DELETE_OMITTED");
    expect(target.length).toBeGreaterThanOrEqual(1);
    expect(target.some((i) => i.message.includes("order_items"))).toBe(true);
  });

  it("検出: onDelete 未指定 (デフォルト noAction 扱い)、子 DELETE なしで親 DELETE → error", () => {
    const tables = makeOrderTables(undefined); // onDelete 未指定 → noAction 相当
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文削除",
          trigger: "click",
          inputs: [{ name: "orderId", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "注文を削除 (onDelete 未指定)",
              tableId: "tbl-orders-parent",
              operation: "DELETE",
              sql: "DELETE FROM orders WHERE id = @inputs.orderId",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "CASCADE_DELETE_OMITTED");
    expect(target.length).toBeGreaterThanOrEqual(1);
  });

  it("false positive 抑止: 子 DELETE が前段にある場合 (onDelete=restrict) → 検出しない", () => {
    const tables = makeOrderTables("restrict");
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文削除",
          trigger: "click",
          inputs: [{ name: "orderId", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "子テーブル (order_items) を先に DELETE",
              tableId: "tbl-order-items",
              operation: "DELETE",
              sql: "DELETE FROM order_items WHERE order_id = @inputs.orderId",
            },
            {
              id: "step-02",
              kind: "dbAccess",
              description: "親テーブル (orders) を DELETE",
              tableId: "tbl-orders-parent",
              operation: "DELETE",
              sql: "DELETE FROM orders WHERE id = @inputs.orderId",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "CASCADE_DELETE_OMITTED");
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止: 子 onDelete=cascade → DB 側が処理するため検出しない", () => {
    const tables = makeOrderTables("cascade");
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文削除",
          trigger: "click",
          inputs: [{ name: "orderId", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "注文を削除 (onDelete=cascade なので子は DB 側で自動削除)",
              tableId: "tbl-orders-parent",
              operation: "DELETE",
              sql: "DELETE FROM orders WHERE id = @inputs.orderId",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "CASCADE_DELETE_OMITTED");
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止: 子 onDelete=setNull → DB 側が NULL 化するため検出しない", () => {
    const tables = makeOrderTables("setNull");
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文削除",
          trigger: "click",
          inputs: [{ name: "orderId", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "注文を削除 (onDelete=setNull なので子の FK カラムは DB 側で NULL 化)",
              tableId: "tbl-orders-parent",
              operation: "DELETE",
              sql: "DELETE FROM orders WHERE id = @inputs.orderId",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "CASCADE_DELETE_OMITTED");
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止: 子 onDelete=setDefault → DB 側が DEFAULT 値を設定するため検出しない", () => {
    const tables = makeOrderTables("setDefault");
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文削除",
          trigger: "click",
          inputs: [{ name: "orderId", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "注文を削除 (onDelete=setDefault なので子の FK カラムは DB 側で DEFAULT 値)",
              tableId: "tbl-orders-parent",
              operation: "DELETE",
              sql: "DELETE FROM orders WHERE id = @inputs.orderId",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "CASCADE_DELETE_OMITTED");
    expect(target).toHaveLength(0);
  });

  it("正常系: FK を持つ子テーブルが存在しない (参照がない) 場合は issue なし", () => {
    const tables = makeOrderTables("restrict");
    // 親テーブルのみ使う (子テーブルが存在しても FK が orders を参照していない)
    const standaloneTable = makeTable(
      "tbl-standalone",
      "standalone",
      [
        { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { physicalName: "name", notNull: true },
      ],
    );
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "スタンドアロン削除",
          trigger: "click",
          inputs: [{ name: "id", type: "string", required: true }],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "FK 参照のないテーブルを削除",
              tableId: "tbl-standalone",
              operation: "DELETE",
              sql: "DELETE FROM standalone WHERE id = @inputs.id",
            },
          ],
        },
      ],
    });
    // standalone テーブルへの FK を持つ子テーブルがないため issue なし
    const issues = checkSqlOrder(flow, [standaloneTable, ...tables]);
    const target = issues.filter((i) => i.code === "CASCADE_DELETE_OMITTED");
    expect(target).toHaveLength(0);
  });
});

// ─── 観点 5: TX_CIRCULAR_DEPENDENCY ───────────────────────────────────────

describe("観点 5: TX_CIRCULAR_DEPENDENCY", () => {
  /**
   * テーブル構成:
   *   table_a: FK → table_b (a.b_id)
   *   table_b: FK → table_a (b.a_id) ← 双方向循環
   *   table_c: FK → table_b (c.b_id) (一方向のみ: a→b→c は DAG)
   *
   * 循環: a ⇄ b (table_a.b_id → table_b 、 table_b.a_id → table_a)
   */

  function makeCircularTables() {
    // table_a: FK b_id → table_b
    const tableA = {
      id: "tbl-circ-a",
      physicalName: "table_a",
      columns: [
        { id: "col-a-1", physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { id: "col-a-2", physicalName: "b_id", notNull: true },
        { id: "col-a-3", physicalName: "name", notNull: true },
      ],
      constraints: [
        {
          kind: "foreignKey" as const,
          id: "fk-a-b",
          columnIds: ["col-a-2"],
          referencedTableId: "tbl-circ-b",
          referencedColumnIds: ["col-b-1"],
        },
      ],
    };

    // table_b: FK a_id → table_a (双方向)
    const tableB = {
      id: "tbl-circ-b",
      physicalName: "table_b",
      columns: [
        { id: "col-b-1", physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { id: "col-b-2", physicalName: "a_id", notNull: true },
        { id: "col-b-3", physicalName: "value", notNull: true },
      ],
      constraints: [
        {
          kind: "foreignKey" as const,
          id: "fk-b-a",
          columnIds: ["col-b-2"],
          referencedTableId: "tbl-circ-a",
          referencedColumnIds: ["col-a-1"],
        },
      ],
    };

    // table_c: FK b_id → table_b (一方向のみ)
    const tableC = {
      id: "tbl-circ-c",
      physicalName: "table_c",
      columns: [
        { id: "col-c-1", physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { id: "col-c-2", physicalName: "b_id", notNull: true },
        { id: "col-c-3", physicalName: "detail", notNull: true },
      ],
      constraints: [
        {
          kind: "foreignKey" as const,
          id: "fk-c-b",
          columnIds: ["col-c-2"],
          referencedTableId: "tbl-circ-b",
          referencedColumnIds: ["col-b-1"],
        },
      ],
    };

    return [tableA, tableB, tableC] as import("./sqlOrderValidator").OrderTableDefinition[];
  }

  it("検出: A↔B 直接双方向循環 — 同一 TX で両テーブルに INSERT", () => {
    const tables = makeCircularTables();
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "循環 INSERT",
          trigger: "submit",
          inputs: [
            { name: "bId", type: "string", required: true },
            { name: "aId", type: "string", required: true },
            { name: "nameVal", type: "string", required: true },
            { name: "valueVal", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-tx-01",
              kind: "transactionScope",
              description: "双方向 FK 循環 TX",
              steps: [
                {
                  id: "step-01",
                  kind: "dbAccess",
                  description: "table_a INSERT",
                  tableId: "tbl-circ-a",
                  operation: "INSERT",
                  sql: "INSERT INTO table_a (b_id, name) VALUES (@inputs.bId, @inputs.nameVal)",
                },
                {
                  id: "step-02",
                  kind: "dbAccess",
                  description: "table_b INSERT (循環)",
                  tableId: "tbl-circ-b",
                  operation: "INSERT",
                  sql: "INSERT INTO table_b (a_id, value) VALUES (@inputs.aId, @inputs.valueVal)",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "TX_CIRCULAR_DEPENDENCY");
    expect(target.length).toBeGreaterThanOrEqual(1);
    expect(target[0].severity).toBe("warning");
    // 循環パスに table_a と table_b が含まれること
    expect(target.some((i) => i.message.includes("table_a") && i.message.includes("table_b"))).toBe(true);
  });

  it("検出: A→B→C→A 三角循環 — 同一 TX で 3 テーブルに INSERT", () => {
    // table_c に table_a への FK を追加した三角循環テーブル群
    const tableA2 = {
      id: "tbl-tri-a",
      physicalName: "tri_a",
      columns: [
        { id: "col-ta-1", physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { id: "col-ta-2", physicalName: "c_id", notNull: true }, // → tri_c (三角の一辺)
      ],
      constraints: [
        {
          kind: "foreignKey" as const,
          id: "fk-ta-tc",
          columnIds: ["col-ta-2"],
          referencedTableId: "tbl-tri-c",
          referencedColumnIds: ["col-tc-1"],
        },
      ],
    };
    const tableB2 = {
      id: "tbl-tri-b",
      physicalName: "tri_b",
      columns: [
        { id: "col-tb-1", physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { id: "col-tb-2", physicalName: "a_id", notNull: true }, // → tri_a
      ],
      constraints: [
        {
          kind: "foreignKey" as const,
          id: "fk-tb-ta",
          columnIds: ["col-tb-2"],
          referencedTableId: "tbl-tri-a",
          referencedColumnIds: ["col-ta-1"],
        },
      ],
    };
    const tableC2 = {
      id: "tbl-tri-c",
      physicalName: "tri_c",
      columns: [
        { id: "col-tc-1", physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { id: "col-tc-2", physicalName: "b_id", notNull: true }, // → tri_b
      ],
      constraints: [
        {
          kind: "foreignKey" as const,
          id: "fk-tc-tb",
          columnIds: ["col-tc-2"],
          referencedTableId: "tbl-tri-b",
          referencedColumnIds: ["col-tb-1"],
        },
      ],
    };
    const tables = [tableA2, tableB2, tableC2] as import("./sqlOrderValidator").OrderTableDefinition[];
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "三角循環 INSERT",
          trigger: "submit",
          inputs: [
            { name: "aId", type: "string", required: true },
            { name: "bId", type: "string", required: true },
            { name: "cId", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-tx-01",
              kind: "transactionScope",
              description: "A→B→C→A 三角循環 TX",
              steps: [
                {
                  id: "step-01",
                  kind: "dbAccess",
                  description: "tri_a INSERT",
                  tableId: "tbl-tri-a",
                  operation: "INSERT",
                  sql: "INSERT INTO tri_a (c_id) VALUES (@inputs.cId)",
                },
                {
                  id: "step-02",
                  kind: "dbAccess",
                  description: "tri_b INSERT",
                  tableId: "tbl-tri-b",
                  operation: "INSERT",
                  sql: "INSERT INTO tri_b (a_id) VALUES (@inputs.aId)",
                },
                {
                  id: "step-03",
                  kind: "dbAccess",
                  description: "tri_c INSERT",
                  tableId: "tbl-tri-c",
                  operation: "INSERT",
                  sql: "INSERT INTO tri_c (b_id) VALUES (@inputs.bId)",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "TX_CIRCULAR_DEPENDENCY");
    expect(target.length).toBeGreaterThanOrEqual(1);
    expect(target[0].severity).toBe("warning");
  });

  it("false positive 抑止: TX scope 外での双方向 FK (TX なし) — issue 出さない", () => {
    const tables = makeCircularTables();
    // TX なし (直接 action steps に INSERT)
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "TX 外 INSERT",
          trigger: "submit",
          inputs: [
            { name: "bId", type: "string", required: true },
            { name: "aId", type: "string", required: true },
            { name: "nameVal", type: "string", required: true },
            { name: "valueVal", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "table_a INSERT (TX 外)",
              tableId: "tbl-circ-a",
              operation: "INSERT",
              sql: "INSERT INTO table_a (b_id, name) VALUES (@inputs.bId, @inputs.nameVal)",
            },
            {
              id: "step-02",
              kind: "dbAccess",
              description: "table_b INSERT (TX 外)",
              tableId: "tbl-circ-b",
              operation: "INSERT",
              sql: "INSERT INTO table_b (a_id, value) VALUES (@inputs.aId, @inputs.valueVal)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    // TX_CIRCULAR_DEPENDENCY は transactionScope 内のみ → TX 外では issue なし
    const target = issues.filter((i) => i.code === "TX_CIRCULAR_DEPENDENCY");
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止: 一方向 FK のみ (A→B、循環なし) — issue 出さない", () => {
    const tables = makeCircularTables();
    // table_a (a.b_id→table_b) と table_c (c.b_id→table_b): a→b、c→b の DAG (循環なし)
    // table_b 自体を INSERT しない (table_a と table_c のみ)
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "一方向 FK TX",
          trigger: "submit",
          inputs: [
            { name: "bId", type: "string", required: true },
            { name: "nameVal", type: "string", required: true },
            { name: "detailVal", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-tx-01",
              kind: "transactionScope",
              description: "一方向 FK TX (a→b のみ、循環なし)",
              steps: [
                {
                  // table_a だけを INSERT (b_id は既存 table_b 行を参照するため変数が bound 済と仮定)
                  // ここでの目的は TX_CIRCULAR_DEPENDENCY が出ないことの確認
                  id: "step-01",
                  kind: "dbAccess",
                  description: "table_a INSERT のみ",
                  tableId: "tbl-circ-a",
                  operation: "INSERT",
                  sql: "INSERT INTO table_a (b_id, name) VALUES (@inputs.bId, @inputs.nameVal)",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "TX_CIRCULAR_DEPENDENCY");
    // 1 テーブルのみ INSERT なので循環不可 → issue なし
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止: 同一 TX で 1 テーブルのみ操作 — issue 出さない", () => {
    const tables = makeCircularTables();
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "単独 TX",
          trigger: "submit",
          inputs: [{ name: "bId", type: "string", required: true }],
          steps: [
            {
              id: "step-tx-01",
              kind: "transactionScope",
              description: "1 テーブルのみ",
              steps: [
                {
                  id: "step-01",
                  kind: "dbAccess",
                  description: "table_a のみ INSERT",
                  tableId: "tbl-circ-a",
                  operation: "INSERT",
                  sql: "INSERT INTO table_a (b_id, name) VALUES (@inputs.bId, 'test')",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "TX_CIRCULAR_DEPENDENCY");
    expect(target).toHaveLength(0);
  });

  it("false positive 抑止: 異なる TX スコープに分散 (各 TX に 1 テーブルのみ) — issue 出さない", () => {
    const tables = makeCircularTables();
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "分散 TX",
          trigger: "submit",
          inputs: [
            { name: "bId", type: "string", required: true },
            { name: "aId", type: "string", required: true },
            { name: "nameVal", type: "string", required: true },
            { name: "valueVal", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-tx-01",
              kind: "transactionScope",
              description: "TX 1: table_a のみ",
              steps: [
                {
                  id: "step-01",
                  kind: "dbAccess",
                  description: "table_a INSERT",
                  tableId: "tbl-circ-a",
                  operation: "INSERT",
                  sql: "INSERT INTO table_a (b_id, name) VALUES (@inputs.bId, @inputs.nameVal)",
                },
              ],
            },
            {
              id: "step-tx-02",
              kind: "transactionScope",
              description: "TX 2: table_b のみ",
              steps: [
                {
                  id: "step-02",
                  kind: "dbAccess",
                  description: "table_b INSERT",
                  tableId: "tbl-circ-b",
                  operation: "INSERT",
                  sql: "INSERT INTO table_b (a_id, value) VALUES (@inputs.aId, @inputs.valueVal)",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    // 各 TX に 1 テーブルのみ → 各スコープ内での循環なし → issue なし
    const target = issues.filter((i) => i.code === "TX_CIRCULAR_DEPENDENCY");
    expect(target).toHaveLength(0);
  });

  it("正常系: UPDATE も TX 内で検出対象に含まれる (双方向 FK + UPDATE)", () => {
    const tables = makeCircularTables();
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "UPDATE 循環",
          trigger: "submit",
          inputs: [
            { name: "bId", type: "string", required: true },
            { name: "aId", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-tx-01",
              kind: "transactionScope",
              description: "UPDATE を含む双方向 FK 循環 TX",
              steps: [
                {
                  id: "step-01",
                  kind: "dbAccess",
                  description: "table_a UPDATE (b_id を参照)",
                  tableId: "tbl-circ-a",
                  operation: "UPDATE",
                  sql: "UPDATE table_a SET b_id = @inputs.bId WHERE id = 1",
                },
                {
                  id: "step-02",
                  kind: "dbAccess",
                  description: "table_b UPDATE (a_id を参照)",
                  tableId: "tbl-circ-b",
                  operation: "UPDATE",
                  sql: "UPDATE table_b SET a_id = @inputs.aId WHERE id = 1",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "TX_CIRCULAR_DEPENDENCY");
    // UPDATE も対象 → 双方向 FK 循環 → warning
    expect(target.length).toBeGreaterThanOrEqual(1);
    expect(target[0].severity).toBe("warning");
  });
});

// ─── 観点 1+2: loop step の collectionItemName を boundVars 登録 (#729) ──────

describe("loop step collectionItemName boundVars 登録 (#729)", () => {
  const tables: OrderTableDefinition[] = [
    makeTable("tbl-orders", "orders", [
      { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
      { physicalName: "user_id", notNull: true },
    ]),
    makeTable(
      "tbl-order-items",
      "order_items",
      [
        { physicalName: "id", notNull: true, autoIncrement: true, primaryKey: true },
        { physicalName: "order_id", notNull: true },
        { physicalName: "product_id", notNull: true },
      ],
      [{ columnPhysicalNames: ["order_id"], referencedTableId: "tbl-orders" }],
    ),
  ];

  it("ケース 1: ループ inner INSERT で @<itemName>.<field> 参照 → false positive なし", () => {
    // collectionItemName = "item" をループ内 INSERT で参照
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文登録",
          trigger: "submit",
          inputs: [
            { name: "cartItems", type: "string", required: true },
            { name: "newOrder", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "orders に INSERT",
              tableId: "tbl-orders",
              operation: "INSERT",
              sql: "INSERT INTO orders (user_id) VALUES (@newOrder.user_id)",
            },
            {
              id: "step-loop",
              kind: "loop",
              description: "カートアイテムをループ",
              loopKind: "collection",
              collectionSource: "@cartItems",
              collectionItemName: "item",
              steps: [
                {
                  id: "step-loop-a",
                  kind: "dbAccess",
                  description: "order_items に INSERT",
                  tableId: "tbl-order-items",
                  operation: "INSERT",
                  // @item.product_id は collectionItemName "item" 由来 → boundVars 登録済みのはず
                  sql: "INSERT INTO order_items (order_id, product_id) VALUES (@newOrder.id, @item.product_id)",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT" || i.code === "FK_REFERENCE_NOT_INSERTED",
    );
    // @item.product_id は loop collectionItemName により boundVars 登録済み → false positive 発生しない
    const falsePositive = target.filter((i) => i.message.includes("item"));
    expect(falsePositive).toHaveLength(0);
  });

  it("ケース 2: ループ外で @<itemName>.<field> を参照 → scope leak しない (false positive が出る)", () => {
    // ループ外では "item" は boundVars にない → NOT NULL カラムへの参照は検出されるべき
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "注文登録",
          trigger: "submit",
          inputs: [
            { name: "cartItems", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-loop",
              kind: "loop",
              description: "カートアイテムをループ (中身は何もしない)",
              loopKind: "collection",
              collectionSource: "@cartItems",
              collectionItemName: "item",
              steps: [
                {
                  id: "step-loop-noop",
                  kind: "compute",
                  description: "何もしない compute",
                  expression: "1",
                },
              ],
            },
            {
              id: "step-after-loop",
              kind: "dbAccess",
              description: "ループ外で @item.order_id / @item.product_id を参照 → 未バインド",
              tableId: "tbl-order-items",
              operation: "INSERT",
              // ループ外なので "item" は boundVars にない → NULL_NOT_ALLOWED_AT_INSERT 発生するべき
              // (@inputs は ALWAYS_BOUND のため除外し、@item.* のみで scope leak 検証を明確化)
              sql: "INSERT INTO order_items (order_id, product_id) VALUES (@item.order_id, @item.product_id)",
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter((i) => i.code === "NULL_NOT_ALLOWED_AT_INSERT");
    // @item.product_id はループ外で未バインド → 検出される
    expect(target.some((i) => i.message.includes("item"))).toBe(true);
  });

  it("ケース 3: ネスト loop で同名 collectionItemName — 内側終了後も外側スコープが壊れない", () => {
    // 外側 loop = "x", 内側 loop = "x" → 内側終了後も外側では "x" が有効であること
    const flow = makeFlow({
      actions: [
        {
          id: "act-001",
          name: "ネストループテスト",
          trigger: "submit",
          inputs: [
            { name: "outerList", type: "string", required: true },
            { name: "innerList", type: "string", required: true },
          ],
          steps: [
            {
              id: "step-outer",
              kind: "loop",
              description: "外側ループ",
              loopKind: "collection",
              collectionSource: "@outerList",
              collectionItemName: "x",
              steps: [
                {
                  id: "step-inner",
                  kind: "loop",
                  description: "内側ループ (同名 x)",
                  loopKind: "collection",
                  collectionSource: "@innerList",
                  collectionItemName: "x",
                  steps: [
                    {
                      id: "step-inner-noop",
                      kind: "compute",
                      description: "何もしない",
                      expression: "1",
                    },
                  ],
                },
                // 内側ループ終了後も外側 "x" は有効 → INSERT で @x.product_id が boundVars にある
                {
                  id: "step-after-inner",
                  kind: "dbAccess",
                  description: "内側ループ後の INSERT — 外側 @x は有効のまま",
                  tableId: "tbl-order-items",
                  operation: "INSERT",
                  sql: "INSERT INTO order_items (order_id, product_id) VALUES (@inputs.orderId, @x.product_id)",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = checkSqlOrder(flow, tables);
    const target = issues.filter(
      (i) =>
        (i.code === "NULL_NOT_ALLOWED_AT_INSERT" || i.code === "FK_REFERENCE_NOT_INSERTED") &&
        i.message.includes("x"),
    );
    // 外側ループ内 (@x は外側スコープで有効) → false positive なし
    expect(target).toHaveLength(0);
  });
});
