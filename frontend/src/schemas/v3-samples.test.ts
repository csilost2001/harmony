import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(__dirname, "../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");
const examplesDir = resolve(repoRoot, "examples");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let ajv: Ajv2020;
let validateProject: ValidateFunction;
let validateScreen: ValidateFunction;
let validateTable: ValidateFunction;
let validateProcessFlow: ValidateFunction;
let validateExtension: ValidateFunction;
let validateSequence: ValidateFunction;
let validateScreenLayout: ValidateFunction;
let validateErLayout: ValidateFunction;
let validateViewDefinition: ValidateFunction;

beforeAll(() => {
  ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  ajv.addSchema(loadJson(join(v3Dir, "screen-item.v3.schema.json")) as object);
  validateProject = ajv.compile(loadJson(join(v3Dir, "project.v3.schema.json")) as object);
  validateScreen = ajv.compile(loadJson(join(v3Dir, "screen.v3.schema.json")) as object);
  validateTable = ajv.compile(loadJson(join(v3Dir, "table.v3.schema.json")) as object);
  validateProcessFlow = ajv.compile(loadJson(join(v3Dir, "process-flow.v3.schema.json")) as object);
  validateExtension = ajv.compile(loadJson(join(v3Dir, "extensions.v3.schema.json")) as object);
  validateSequence = ajv.compile(loadJson(join(v3Dir, "sequence.v3.schema.json")) as object);
  validateScreenLayout = ajv.compile(loadJson(join(v3Dir, "screen-layout.v3.schema.json")) as object);
  validateErLayout = ajv.compile(loadJson(join(v3Dir, "er-layout.v3.schema.json")) as object);
  validateViewDefinition = ajv.compile(loadJson(join(v3Dir, "view-definition.v3.schema.json")) as object);
});

function dumpErrors(file: string, validate: ValidateFunction): string {
  const errs = validate.errors ?? [];
  return `${file}\n${errs.map((e) => `  ${e.instancePath || "<root>"} ${e.keyword}: ${e.message ?? ""}`).join("\n")}`;
}

function listJsonRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...listJsonRecursive(join(dir, entry.name)));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(join(dir, entry.name));
  }
  return out;
}

describe("schema v3 examples (#774: examples/ を canonical サンプル領域として使用)", () => {
  it("project.json (retail + realestate) validates against project.v3.schema.json", () => {
    const files = [
      join(examplesDir, "retail", "project.json"),
      join(examplesDir, "realestate", "project.json"),
    ];
    for (const file of files) {
      const data = loadJson(file);
      const ok = validateProject(data);
      expect(ok, ok ? "" : dumpErrors(file, validateProject)).toBe(true);
    }
  });

  it("table samples validate against table.v3.schema.json", () => {
    const files = [
      ...listJsonRecursive(join(examplesDir, "retail", "tables")),
      ...listJsonRecursive(join(examplesDir, "realestate", "tables")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const data = loadJson(file);
      const ok = validateTable(data);
      expect(ok, ok ? "" : dumpErrors(file, validateTable)).toBe(true);
    }
  });

  it("screen samples validate against screen.v3.schema.json", () => {
    const files = [
      ...listJsonRecursive(join(examplesDir, "retail", "screens")),
      ...listJsonRecursive(join(examplesDir, "realestate", "screens")),
    ].filter((f) => !f.endsWith(".design.json")); // .design.json は GrapesJS デザインデータ — screen schema 対象外
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const data = loadJson(file);
      const ok = validateScreen(data);
      expect(ok, ok ? "" : dumpErrors(file, validateScreen)).toBe(true);
    }
  });

  it("process-flow / process-flows samples validate against process-flow.v3.schema.json", () => {
    const files = [
      ...listJsonRecursive(join(examplesDir, "retail", "process-flows")),
      ...listJsonRecursive(join(examplesDir, "realestate", "process-flows")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const data = loadJson(file);
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors(file, validateProcessFlow)).toBe(true);
    }
  });

  it("extension samples validate against extensions.v3.schema.json", () => {
    const files = [
      ...listJsonRecursive(join(examplesDir, "retail", "extensions")),
      ...listJsonRecursive(join(examplesDir, "realestate", "extensions")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const data = loadJson(file);
      const ok = validateExtension(data);
      expect(ok, ok ? "" : dumpErrors(file, validateExtension)).toBe(true);
    }
  });

  it("view-definition samples validate against view-definition.v3.schema.json", () => {
    const files = [
      ...listJsonRecursive(join(examplesDir, "retail", "view-definitions")),
      ...listJsonRecursive(join(examplesDir, "realestate", "view-definitions")),
    ];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const data = loadJson(file);
      const ok = validateViewDefinition(data);
      expect(ok, ok ? "" : dumpErrors(file, validateViewDefinition)).toBe(true);
    }
  });

  it("F-2: ExtensionStep can declare lineage at top-level (StepBaseProps への移植)", () => {
    const fixture = {
      meta: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "F-2 lineage 透過テスト",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
        kind: "screen",
      },
      actions: [
        {
          id: "act-001",
          name: "extension step lineage test",
          trigger: "submit",
          steps: [
            {
              id: "step-01",
              kind: "retail:CartManageStep",
              description: "ExtensionStep が lineage を top-level に持てる (StepBaseProps から継承)",
              lineage: {
                writes: [
                  { tableId: "eb574288-88f2-419f-ac5e-56a9948e8f46", purpose: "upsert" },
                ],
              },
              config: {
                cartId: "cart-001",
                productCode: "PROD001",
                quantity: 2,
              },
            },
          ],
        },
      ],
    };
    const ok = validateProcessFlow(fixture);
    expect(ok, ok ? "" : dumpErrors("F-2 fixture", validateProcessFlow)).toBe(true);
  });

  it("F-2 regression: DbAccessStep が継承された lineage を保持", () => {
    // F-2 で DbAccessStep の lineage 重複宣言を削除した。継承で機能するか検証
    const fixture = {
      meta: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "F-2 DbAccessStep lineage 継承テスト",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
        kind: "screen",
      },
      actions: [
        {
          id: "act-001",
          name: "dbAccess lineage regression",
          trigger: "submit",
          steps: [
            {
              id: "step-01",
              kind: "dbAccess",
              description: "DbAccessStep の lineage は StepBaseProps から継承される",
              tableId: "eb574288-88f2-419f-ac5e-56a9948e8f46",
              operation: "SELECT",
              sql: "SELECT * FROM products",
              outputBinding: { name: "rows" },
              lineage: {
                reads: [{ tableId: "eb574288-88f2-419f-ac5e-56a9948e8f46", purpose: "lookup" }],
              },
            },
          ],
        },
      ],
    };
    const ok = validateProcessFlow(fixture);
    expect(ok, ok ? "" : dumpErrors("F-2 DbAccessStep regression", validateProcessFlow)).toBe(true);
  });

  it("F-4: BranchCondition の不正 kind は discriminator で 1 branch のみエラー", () => {
    // 不正な kind を持つ BranchCondition を Step.branches[0].condition に置く
    const fixture = {
      meta: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "F-4 discriminator テスト",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
        kind: "screen",
      },
      actions: [
        {
          id: "act-001",
          name: "branch discriminator test",
          trigger: "submit",
          steps: [
            {
              id: "step-01",
              kind: "branch",
              description: "BranchCondition kind ミスマッチで discriminator が効くか",
              branches: [
                {
                  id: "br-01-a",
                  code: "A",
                  condition: { kind: "invalidKind", expression: "@x" },
                  steps: [],
                },
              ],
            },
          ],
        },
      ],
    };
    const ok = validateProcessFlow(fixture);
    expect(ok).toBe(false);
    // discriminator が効いていれば、kind の値ミスマッチエラーが先頭に出る
    const errs = validateProcessFlow.errors ?? [];
    const discriminatorErr = errs.find(
      (e) => e.keyword === "discriminator" || (e.message ?? "").includes("discriminator"),
    );
    expect(discriminatorErr).toBeDefined();
  });

  it("F-4: CdcDestination の不正 kind は discriminator でエラー", () => {
    const fixture = {
      meta: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "F-4 CdcDestination",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
        kind: "batch",
      },
      actions: [
        {
          id: "act-001",
          name: "cdc test",
          trigger: "auto",
          steps: [
            {
              id: "step-01",
              kind: "cdc",
              description: "CdcDestination kind ミスマッチ",
              tableIds: ["eb574288-88f2-419f-ac5e-56a9948e8f46"],
              captureMode: "full",
              destination: { kind: "invalidKind", topic: "x.y" },
            },
          ],
        },
      ],
    };
    const ok = validateProcessFlow(fixture);
    expect(ok).toBe(false);
    const errs = validateProcessFlow.errors ?? [];
    const discriminatorErr = errs.find(
      (e) => e.keyword === "discriminator" || (e.message ?? "").includes("discriminator"),
    );
    expect(discriminatorErr).toBeDefined();
  });

  it("F-4: TestPrecondition の不正 kind は discriminator でエラー (common.v3 経由)", () => {
    // ProcessFlow.authoring.testScenarios.given[].kind が discriminated union
    const fixture = {
      meta: {
        id: "55555555-5555-4555-8555-555555555555",
        name: "F-4 TestPrecondition",
        createdAt: "2026-04-27T00:00:00.000Z",
        updatedAt: "2026-04-27T00:00:00.000Z",
        kind: "screen",
      },
      actions: [
        {
          id: "act-001",
          name: "minimal",
          trigger: "submit",
          steps: [
            { id: "step-01", kind: "return", description: "return" },
          ],
        },
      ],
      authoring: {
        testScenarios: [
          {
            id: "ts-01",
            name: "test",
            given: [{ kind: "invalidKind", anything: "x" }],
            when: { actionId: "act-001", input: {} },
            then: [{ kind: "outcome", expected: "200-ok" }],
          },
        ],
      },
    };
    const ok = validateProcessFlow(fixture);
    expect(ok).toBe(false);
    const errs = validateProcessFlow.errors ?? [];
    const discriminatorErr = errs.find(
      (e) => e.keyword === "discriminator" || (e.message ?? "").includes("discriminator"),
    );
    expect(discriminatorErr).toBeDefined();
  });

  it("F-4: Constraint (table.v3) の不正 kind は discriminator でエラー", () => {
    const fixture = {
      id: "eb574288-88f2-419f-ac5e-56a9948e8f47",
      name: "F-4 Constraint テスト",
      createdAt: "2026-04-27T00:00:00.000Z",
      updatedAt: "2026-04-27T00:00:00.000Z",
      physicalName: "test_table",
      columns: [{ id: "col-01", physicalName: "id", name: "ID", dataType: "INTEGER" }],
      constraints: [
        { id: "c1", kind: "invalidKind" },
      ],
    };
    const ok = validateTable(fixture);
    expect(ok).toBe(false);
    const errs = validateTable.errors ?? [];
    const discriminatorErr = errs.find(
      (e) => e.keyword === "discriminator" || (e.message ?? "").includes("discriminator"),
    );
    expect(discriminatorErr).toBeDefined();
  });
});
