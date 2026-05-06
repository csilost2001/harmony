import { describe, expect, it, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { existsSync, readFileSync } from "node:fs";
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
  validateProject = ajv.compile(loadJson(join(v3Dir, "project.v3.schema.json")) as object);
});

function dumpErrors(file: string): string {
  const errs = validateProject.errors ?? [];
  return `${file}\n${errs.map((e) => `  ${e.instancePath || "<root>"} ${e.keyword}: ${e.message ?? ""}`).join("\n")}`;
}

describe("project v3 schema", () => {
  it("data/project.json が存在する場合は project.v3.schema.json に適合する", () => {
    const file = join(repoRoot, "data/project.json");
    if (!existsSync(file)) {
      expect(true).toBe(true);
      return;
    }
    const content = JSON.parse(readFileSync(file, "utf-8")) as { schemaVersion?: string };
    if (content.schemaVersion !== "v3") {
      // v1 from pre-Phase-4α env; AJV 検証は v3 前提なので skip
      expect(true).toBe(true);
      return;
    }

    const ok = validateProject(content);
    expect(ok, ok ? "" : dumpErrors(file)).toBe(true);
  });

  it("empty project fixture validates against project.v3.schema.json", () => {
    const fixture = {
      $schema: "../schemas/v3/project.v3.schema.json",
      schemaVersion: "v3",
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
