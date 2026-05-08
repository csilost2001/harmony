import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildScreen } from "./screenBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateScreen: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  ajv.addSchema(loadJson(join(v3Dir, "screen-item.v3.schema.json")) as object);
  validateScreen = ajv.compile(loadJson(join(v3Dir, "screen.v3.schema.json")) as object);
});

describe("buildScreen", () => {
  it("returns a v3-valid Screen with defaults", () => {
    const s = buildScreen();
    const ok = validateScreen(s);
    if (!ok) {
      console.error(validateScreen.errors);
    }
    expect(ok).toBe(true);
    expect(s.kind).toBe("other");
    expect(s.path).toBe("/test");
    expect(s.maturity).toBe("draft");
  });

  it("respects overrides", () => {
    const s = buildScreen({ name: "注文一覧", kind: "list", path: "/orders" });
    expect(s.name).toBe("注文一覧");
    expect(s.kind).toBe("list");
    expect(s.path).toBe("/orders");
  });
});
