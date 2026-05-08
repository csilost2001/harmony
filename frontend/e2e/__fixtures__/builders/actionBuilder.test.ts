import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildAction } from "./actionBuilder";
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

describe("buildAction", () => {
  it("returns a valid ActionDefinition with defaults", () => {
    const action = buildAction();
    expect(action.id).toBe("action-01");
    expect(action.trigger).toBe("click");
    expect(action.steps).toEqual([]);
  });

  it("validates within a ProcessFlow", () => {
    const action = buildAction({ id: "action-01", name: "ボタンクリック", trigger: "click" });
    const pf = buildProcessFlow({ actions: [action] });
    const ok = validateProcessFlow(pf);
    if (!ok) {
      console.error(validateProcessFlow.errors);
    }
    expect(ok).toBe(true);
  });

  it("respects overrides", () => {
    const action = buildAction({ id: "submit-01", name: "送信", trigger: "submit", maturity: "committed" });
    expect(action.id).toBe("submit-01");
    expect(action.name).toBe("送信");
    expect(action.trigger).toBe("submit");
    expect(action.maturity).toBe("committed");
  });
});
