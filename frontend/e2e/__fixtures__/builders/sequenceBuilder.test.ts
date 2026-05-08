import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildSequence } from "./sequenceBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateSequence: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateSequence = ajv.compile(loadJson(join(v3Dir, "sequence.v3.schema.json")) as object);
});

describe("buildSequence", () => {
  it("returns a v3-valid Sequence with defaults", () => {
    const s = buildSequence();
    const ok = validateSequence(s);
    if (!ok) {
      console.error(validateSequence.errors);
    }
    expect(ok).toBe(true);
    expect(s.physicalName).toBe("seq_test");
  });

  it("respects overrides", () => {
    const s = buildSequence({ name: "注文採番", physicalName: "seq_order_no", conventionRef: "@conv.numbering.orderNo" });
    expect(s.name).toBe("注文採番");
    expect(s.physicalName).toBe("seq_order_no");
    expect(s.conventionRef).toBe("@conv.numbering.orderNo");
  });
});
