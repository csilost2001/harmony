import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildViewDefinition } from "./viewDefinitionBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateViewDefinition: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateViewDefinition = ajv.compile(loadJson(join(v3Dir, "view-definition.v3.schema.json")) as object);
});

describe("buildViewDefinition", () => {
  it("returns a v3-valid ViewDefinition with defaults", () => {
    const vd = buildViewDefinition();
    const ok = validateViewDefinition(vd);
    if (!ok) {
      console.error(validateViewDefinition.errors);
    }
    expect(ok).toBe(true);
    expect(vd.kind).toBe("list");
    expect(vd.columns.length).toBeGreaterThanOrEqual(1);
  });

  it("respects overrides", () => {
    const vd = buildViewDefinition({ name: "受注カンバン", kind: "kanban" });
    expect(vd.name).toBe("受注カンバン");
    expect(vd.kind).toBe("kanban");
  });

  it("Level 2 (query) — AJV pass and sourceTableId absent", () => {
    const tableId = "cccccccc-0001-4000-8000-000000000001";
    const vd = buildViewDefinition({
      query: {
        from: {
          tableId: tableId as unknown as import("../../../src/types/v3").TableId,
          alias: "t",
        },
      },
    });
    const ok = validateViewDefinition(vd);
    if (!ok) {
      console.error(validateViewDefinition.errors);
    }
    expect(ok).toBe(true);
    // query 形式では sourceTableId が存在しないこと
    expect((vd as { sourceTableId?: unknown }).sourceTableId).toBeUndefined();
    expect((vd as { query?: unknown }).query).toBeDefined();
  });
});
