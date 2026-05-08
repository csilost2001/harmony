import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildProcessFlow } from "./processFlowBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateProcessFlow: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateProcessFlow = ajv.compile(loadJson(join(v3Dir, "process-flow.v3.schema.json")) as object);
});

describe("buildProcessFlow", () => {
  it("returns a v3-valid ProcessFlow with defaults", () => {
    const pf = buildProcessFlow();
    const ok = validateProcessFlow(pf);
    if (!ok) {
      console.error(validateProcessFlow.errors);
    }
    expect(ok).toBe(true);
    expect(pf.meta.kind).toBe("other");
    expect(pf.meta.maturity).toBe("draft");
    expect(pf.actions).toEqual([]);
  });

  it("respects overrides", () => {
    const pf = buildProcessFlow({ name: "注文処理", kind: "screen", mode: "upstream" });
    expect(pf.meta.name).toBe("注文処理");
    expect(pf.meta.kind).toBe("screen");
    expect(pf.meta.mode).toBe("upstream");
  });

  it("authoring が指定されたら反映される", () => {
    const pf = buildProcessFlow({
      authoring: {
        markers: [
          {
            id: "m1",
            kind: "todo",
            body: "x",
            author: "human",
            createdAt: "2026-04-20T00:00:00Z",
          },
        ],
      },
    });
    expect(pf.authoring?.markers).toHaveLength(1);
  });
});
