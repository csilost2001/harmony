/**
 * examples/**\/\*.json を v3 schema で全件 AJV 検証 (#680 / #706)。
 *
 * examples/<project>/ 直下のディレクトリをエンティティ種別と見なし、対応する schemas/v3/*.v3.schema.json で
 * 各 json を検証する。schema 進化時に examples/ が breakage したら本テストで検出。
 *
 * 配置ルール (docs/spec/examples-retail.md § 2 / `project_samples_strategy_2026_05_02.md`):
 *  - examples/<project>/project.json
 *  - examples/<project>/screens/<uuid>.json
 *  - examples/<project>/screen-items/<screenId>.json
 *  - examples/<project>/tables/<uuid>.json
 *  - examples/<project>/process-flows/<uuid>.json
 *  - examples/<project>/views/<uuid>.json
 *  - examples/<project>/view-definitions/<uuid>.json
 *  - examples/<project>/sequences/<uuid>.json
 *  - examples/<project>/extensions/<namespace>.v3.json (canonical combined format)
 *  - examples/<project>/conventions/*.json
 *  - examples/<project>/screen-layout.json (任意)
 */
import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(__dirname, "../../../");
const v3Dir = join(repoRoot, "schemas/v3");
const samplesDir = join(repoRoot, "examples");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const ENTITY_TO_SCHEMA: Record<string, string> = {
  screens: "screen.v3.schema.json",
  "screen-items": "screen-item.v3.schema.json",
  tables: "table.v3.schema.json",
  "process-flows": "process-flow.v3.schema.json",
  views: "view.v3.schema.json",
  "view-definitions": "view-definition.v3.schema.json",
  sequences: "sequence.v3.schema.json",
};

const SINGLETON_FILES: Record<string, string> = {
  "project.json": "project.v3.schema.json",
  "screen-layout.json": "screen-layout.v3.schema.json",
};

const validators = new Map<string, ValidateFunction>();

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  // 全 v3 schema を addSchema (相互 $ref 解決のため、$id をキーに登録)
  const schemasByFile = new Map<string, { schema: object; id: string }>();
  for (const f of readdirSync(v3Dir)) {
    if (!f.endsWith(".json")) continue;
    const schemaObj = loadJson(join(v3Dir, f)) as { $id?: string };
    if (typeof schemaObj.$id !== "string") continue;
    ajv.addSchema(schemaObj as object, schemaObj.$id);
    schemasByFile.set(f, { schema: schemaObj as object, id: schemaObj.$id });
  }
  // 必要な schema の validator を getSchema で取得 (compile しない、重複登録回避)
  const allSchemaFiles = new Set([
    ...Object.values(ENTITY_TO_SCHEMA),
    ...Object.values(SINGLETON_FILES),
    "extensions.v3.schema.json",
    "conventions.v3.schema.json",
  ]);
  for (const sf of allSchemaFiles) {
    const entry = schemasByFile.get(sf);
    if (!entry) throw new Error(`schema not loaded: ${sf}`);
    const validator = ajv.getSchema(entry.id);
    if (!validator) throw new Error(`validator not retrievable for ${sf} (${entry.id})`);
    validators.set(sf, validator);
  }
});

interface FileEntry {
  filePath: string;
  schemaFile: string;
  relativePath: string;
}

function listSampleProjects(): string[] {
  if (!existsSync(samplesDir)) return [];
  return readdirSync(samplesDir).filter((name) => {
    const sub = join(samplesDir, name);
    return statSync(sub).isDirectory() && existsSync(join(sub, "project.json"));
  });
}

function collectFiles(projectDir: string): FileEntry[] {
  const entries: FileEntry[] = [];

  // singleton 系 (project.json / screen-layout.json)
  for (const [fname, schema] of Object.entries(SINGLETON_FILES)) {
    const fp = join(projectDir, fname);
    if (existsSync(fp)) {
      entries.push({ filePath: fp, schemaFile: schema, relativePath: fname });
    }
  }

  // 各 entity ディレクトリ
  for (const [dirName, schema] of Object.entries(ENTITY_TO_SCHEMA)) {
    const dir = join(projectDir, dirName);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      // *.design.json は GrapesJS state ファイルで entity schema とは別形式 — スキップ
      if (f.endsWith(".design.json")) continue;
      entries.push({
        filePath: join(dir, f),
        schemaFile: schema,
        relativePath: `${dirName}/${f}`,
      });
    }
  }

  // extensions/ — v3 canonical format: <namespace>.v3.json (flat combined)
  const extDir = join(projectDir, "extensions");
  if (existsSync(extDir)) {
    for (const entry of readdirSync(extDir)) {
      if (!entry.endsWith(".json")) continue;
      entries.push({
        filePath: join(extDir, entry),
        schemaFile: "extensions.v3.schema.json",
        relativePath: `extensions/${entry}`,
      });
    }
  }

  // conventions/*.json
  const convDir = join(projectDir, "conventions");
  if (existsSync(convDir)) {
    for (const f of readdirSync(convDir)) {
      if (!f.endsWith(".json")) continue;
      entries.push({
        filePath: join(convDir, f),
        schemaFile: "conventions.v3.schema.json",
        relativePath: `conventions/${f}`,
      });
    }
  }

  return entries;
}

function dumpErrors(v: ValidateFunction, file: string): string {
  const errs = v.errors ?? [];
  return `${file}\n${errs
    .slice(0, 20)
    .map((e) => `  ${e.instancePath || "<root>"} ${e.keyword}: ${e.message ?? ""}`)
    .join("\n")}`;
}

describe("examples/**/*.json (v3 全件 AJV 検証)", () => {
  const projects = listSampleProjects();

  if (projects.length === 0) {
    it("no sample projects yet (skip)", () => {
      expect(true).toBe(true);
    });
    return;
  }

  for (const projectName of projects) {
    describe(`examples/${projectName}`, () => {
      const projectDir = join(samplesDir, projectName);
      const entries = collectFiles(projectDir);

      // entity が空のときの protective check
      it(`should have at least project.json`, () => {
        const hasProject = entries.some((e) => e.relativePath === "project.json");
        expect(hasProject).toBe(true);
      });

      for (const e of entries) {
        it(`${e.relativePath} validates against ${e.schemaFile}`, () => {
          const validator = validators.get(e.schemaFile);
          expect(validator, `validator for ${e.schemaFile} not found`).toBeDefined();
          const data = loadJson(e.filePath);
          const ok = validator!(data);
          expect(ok, ok ? "" : dumpErrors(validator!, e.relativePath)).toBe(true);
        });
      }
    });
  }
});
