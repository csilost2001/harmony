import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildConventions } from "./conventionsBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateConventions: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateConventions = ajv.compile(loadJson(join(v3Dir, "conventions.v3.schema.json")) as object);
});

describe("buildConventions", () => {
  it("returns a v3-valid Conventions with defaults", () => {
    const c = buildConventions();
    const ok = validateConventions(c);
    if (!ok) {
      console.error(validateConventions.errors);
    }
    expect(ok).toBe(true);
    expect(c.version).toBe("1.0.0");
  });

  it("respects overrides", () => {
    const c = buildConventions({
      version: "2.0.0",
      msg: {
        required: { template: "{label}は必須です。" },
      },
    });
    expect(c.version).toBe("2.0.0");
    expect(c.msg?.required?.template).toBe("{label}は必須です。");
  });

  it("individual field override is reflected in output (limit)", () => {
    const c = buildConventions({
      limit: {
        maxNameLength: { value: 100, unit: "char", description: "名称最大文字数" },
      },
    });
    const ok = validateConventions(c);
    if (!ok) {
      console.error(validateConventions.errors);
    }
    expect(ok).toBe(true);
    expect(c.limit?.maxNameLength?.value).toBe(100);
    expect(c.limit?.maxNameLength?.unit).toBe("char");
  });
});
