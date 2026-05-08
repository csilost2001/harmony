import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildTable } from "./tableBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateTable: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateTable = ajv.compile(loadJson(join(v3Dir, "table.v3.schema.json")) as object);
});

describe("buildTable", () => {
  it("returns a v3-valid Table with defaults", () => {
    const t = buildTable();
    const ok = validateTable(t);
    if (!ok) {
      console.error(validateTable.errors);
    }
    expect(ok).toBe(true);
    expect(t.physicalName).toBe("test_table");
    expect(t.columns.length).toBeGreaterThanOrEqual(1);
    expect(t.maturity).toBe("draft");
  });

  it("respects overrides", () => {
    const t = buildTable({ name: "ユーザー", physicalName: "users", category: "マスタ" });
    expect(t.name).toBe("ユーザー");
    expect(t.physicalName).toBe("users");
    expect(t.category).toBe("マスタ");
  });
});
