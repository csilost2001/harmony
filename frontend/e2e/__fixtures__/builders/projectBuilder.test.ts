import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildProject } from "./projectBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateProject: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateProject = ajv.compile(loadJson(join(v3Dir, "harmony.v3.schema.json")) as object);
});

describe("buildProject", () => {
  it("returns a v3-valid Project with defaults", () => {
    const p = buildProject();
    const ok = validateProject(p);
    if (!ok) {
      console.error(validateProject.errors);
    }
    expect(ok).toBe(true);
    expect(p.schemaVersion).toBe("v3");
    expect(p.meta.maturity).toBe("draft");
  });

  it("respects overrides", () => {
    const p = buildProject({ name: "MyApp", mode: "downstream" });
    expect(p.meta.name).toBe("MyApp");
    expect(p.meta.mode).toBe("downstream");
  });

  it("uses normalizeId for human-readable id", () => {
    const p1 = buildProject({ id: "my-project" });
    const p2 = buildProject({ id: "my-project" });
    // 同じ入力 id からは常に同じ UUID が生成される (決定論的)
    expect(p1.meta.id).toBe(p2.meta.id);
    // UUID v4 形式になっている
    expect(p1.meta.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
