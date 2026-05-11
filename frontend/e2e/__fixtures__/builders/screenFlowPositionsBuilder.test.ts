import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildScreenFlowPositions } from "./screenFlowPositionsBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateScreenFlowPositions: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateScreenFlowPositions = ajv.compile(loadJson(join(v3Dir, "screen-flow-positions.v3.schema.json")) as object);
});

describe("buildScreenFlowPositions", () => {
  it("returns a v3-valid ScreenFlowPositions with defaults", () => {
    const sl = buildScreenFlowPositions();
    const ok = validateScreenFlowPositions(sl);
    if (!ok) {
      console.error(validateScreenFlowPositions.errors);
    }
    expect(ok).toBe(true);
    expect(sl.positions).toEqual({});
    expect(sl.updatedAt).toBe("2026-05-08T00:00:00.000Z");
  });

  it("respects overrides", () => {
    const nodeId = "cccccccc-0000-4000-8000-000000000001";
    const sl = buildScreenFlowPositions({
      positions: { [nodeId]: { x: 100, y: 200 } },
    });
    expect(sl.positions[nodeId]).toEqual({ x: 100, y: 200 });
  });
});
