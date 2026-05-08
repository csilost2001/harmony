import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildProject } from "./projectBuilder";

const repoRoot = resolve(__dirname, "../../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FIXED_TS = "2026-05-08T00:00:00.000Z";

let validateProject: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  validateProject = ajv.compile(loadJson(join(v3Dir, "harmony.v3.schema.json")) as object);
});

describe("buildProject", () => {
  it("returns a v3-valid Project with defaults", () => {
    const p = buildProject();
    const ok = validateProject(p);
    if (!ok) {
      console.error(validateProject.errors);
    }
    expect(ok).toBe(true);
    expect(p.schemaVersion).toBe("v3");
    expect(p.meta.maturity).toBe("draft");
  });

  it("respects overrides", () => {
    const p = buildProject({ name: "MyApp", mode: "downstream" });
    expect(p.meta.name).toBe("MyApp");
    expect(p.meta.mode).toBe("downstream");
  });

  it("uses normalizeId for human-readable id", () => {
    const p1 = buildProject({ id: "my-project" });
    const p2 = buildProject({ id: "my-project" });
    // 同じ入力 id からは常に同じ UUID が生成される (決定論的)
    expect(p1.meta.id).toBe(p2.meta.id);
    // UUID v4 形式になっている
    expect(p1.meta.id).toMatch(UUID_V4);
  });
});

describe("normalizeEntityIds (via buildProject)", () => {
  it("UUID v4 既に正規な id は変換されない (passthrough)", () => {
    const validId = "12345678-1234-4234-9234-123456789abc";
    const p = buildProject({
      entities: {
        screens: [{ id: validId as never, no: 1, name: "テスト画面", updatedAt: FIXED_TS as never }],
      },
    });
    expect((p.entities as { screens?: Array<{ id: string }> }).screens?.[0].id).toBe(validId);
  });

  it("人間可読 id は決定論的に UUID v4 に変換される", () => {
    const p1 = buildProject({
      entities: {
        screens: [{ id: "scr-1" as never, no: 1, name: "テスト画面", updatedAt: FIXED_TS as never }],
      },
    });
    const p2 = buildProject({
      entities: {
        screens: [{ id: "scr-1" as never, no: 1, name: "テスト画面", updatedAt: FIXED_TS as never }],
      },
    });
    const id1 = (p1.entities as { screens?: Array<{ id: string }> }).screens?.[0].id ?? "";
    const id2 = (p2.entities as { screens?: Array<{ id: string }> }).screens?.[0].id ?? "";
    expect(id1).toBe(id2);
    expect(id1).toMatch(UUID_V4);
  });

  it("cross-reference field (screenId 等) も同じ正規化 UUID になる", () => {
    const p = buildProject({
      entities: {
        screens: [{ id: "scr-1" as never, no: 1, name: "テスト画面", updatedAt: FIXED_TS as never }],
        processFlows: [{ id: "pf-1" as never, no: 1, name: "テストフロー", updatedAt: FIXED_TS as never, screenId: "scr-1" as never }],
      },
    });
    const screens = (p.entities as { screens?: Array<{ id: string }> }).screens ?? [];
    const flows = (p.entities as { processFlows?: Array<{ id: string; screenId: string }> }).processFlows ?? [];
    expect(flows[0].screenId).toBe(screens[0].id);
  });

  it("複数 entity 種別 (screens / tables / processFlows) に同時適用される", () => {
    const p = buildProject({
      entities: {
        screens: [{ id: "scr-1" as never, no: 1, name: "テスト画面", updatedAt: FIXED_TS as never }],
        tables: [{ id: "tbl-1" as never, no: 1, name: "テストテーブル", updatedAt: FIXED_TS as never }],
        processFlows: [{ id: "pf-1" as never, no: 1, name: "テストフロー", updatedAt: FIXED_TS as never }],
      },
    });
    const screens = (p.entities as { screens?: Array<{ id: string }> }).screens ?? [];
    const tables = (p.entities as { tables?: Array<{ id: string }> }).tables ?? [];
    const flows = (p.entities as { processFlows?: Array<{ id: string }> }).processFlows ?? [];
    expect(screens[0].id).toMatch(UUID_V4);
    expect(tables[0].id).toMatch(UUID_V4);
    expect(flows[0].id).toMatch(UUID_V4);
  });

  it("非 id field (name 等) は変換されない", () => {
    const p = buildProject({
      entities: {
        screens: [{ id: "scr-1" as never, no: 1, name: "テスト画面", updatedAt: FIXED_TS as never }],
      },
    });
    const screens = (p.entities as { screens?: Array<{ name: string }> }).screens ?? [];
    expect(screens[0].name).toBe("テスト画面");
  });
});
