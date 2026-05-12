import { describe, expect, it, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../../");
const v3Dir = join(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateProject: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateProject = ajv.compile(loadJson(join(v3Dir, "harmony.v3.schema.json")) as object);
});

function dumpErrors(file: string): string {
  const errs = validateProject.errors ?? [];
  return `${file}\n${errs.map((e) => `  ${e.instancePath || "<root>"} ${e.keyword}: ${e.message ?? ""}`).join("\n")}`;
}

describe("project v3 schema (harmony.v3.schema.json)", () => {
  it("empty project fixture validates against harmony.v3.schema.json", () => {
    const fixture = {
      $schema: "../schemas/v3/harmony.v3.schema.json",
      schemaVersion: "v3",
      dataDir: "harmony",
      meta: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "新規プロジェクト",
        createdAt: "2026-04-28T00:00:00.000Z",
        updatedAt: "2026-04-28T00:00:00.000Z",
        mode: "upstream",
        maturity: "draft",
      },
      extensionsApplied: [],
      entities: {
        screens: [],
        screenGroups: [],
        screenTransitions: [],
        tables: [],
        views: [],
        sequences: [],
        processFlows: [],
      },
    };

    const ok = validateProject(fixture);
    expect(ok, ok ? "" : dumpErrors("empty fixture")).toBe(true);
  });
});
