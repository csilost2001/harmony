import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildCustomBlock } from "./customBlockBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateCustomBlock: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  // custom-block.v3.schema.json の root は CustomBlock[] 配列。
  // 単体オブジェクトを validate するために $defs/CustomBlock への $ref を持つラッパーを作る。
  const cbSchemaId = "https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/custom-block.v3.schema.json";
  ajv.addSchema(loadJson(join(v3Dir, "custom-block.v3.schema.json")) as object);
  validateCustomBlock = ajv.compile({ $ref: `${cbSchemaId}#/$defs/CustomBlock` });
});

describe("buildCustomBlock", () => {
  it("returns a v3-valid CustomBlock with defaults", () => {
    const cb = buildCustomBlock();
    const ok = validateCustomBlock(cb);
    if (!ok) {
      console.error(validateCustomBlock.errors);
    }
    expect(ok).toBe(true);
    expect(cb.label).toBe("テストブロック");
    expect(cb.shared).toBe(false);
  });

  it("respects overrides", () => {
    const cb = buildCustomBlock({ label: "カスタムカード", category: "カード", shared: true });
    expect(cb.label).toBe("カスタムカード");
    expect(cb.category).toBe("カード");
    expect(cb.shared).toBe(true);
  });
});
