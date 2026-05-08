import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildView } from "./viewBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateView: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  // view.v3 は OutputColumn.dataType に table.v3.schema.json#/$defs/DataType を参照するため追加
  ajv.addSchema(loadJson(join(v3Dir, "table.v3.schema.json")) as object);
  validateView = ajv.compile(loadJson(join(v3Dir, "view.v3.schema.json")) as object);
});

describe("buildView", () => {
  it("returns a v3-valid View with defaults", () => {
    const v = buildView();
    const ok = validateView(v);
    if (!ok) {
      console.error(validateView.errors);
    }
    expect(ok).toBe(true);
    expect(v.physicalName).toBe("test_view");
    expect(v.outputColumns.length).toBeGreaterThanOrEqual(1);
  });

  it("respects overrides", () => {
    const v = buildView({ name: "受注一覧ビュー", physicalName: "v_orders", selectStatement: "SELECT id, name FROM orders" });
    expect(v.name).toBe("受注一覧ビュー");
    expect(v.physicalName).toBe("v_orders");
    expect(v.selectStatement).toBe("SELECT id, name FROM orders");
  });
});
