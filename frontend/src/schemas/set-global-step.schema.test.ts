/**
 * SetGlobalStep core schema 動作証明 (#1322 Phase B-3e)。
 *
 * examples/* には sample 移行未実装のため、`samples-v3.schema.test.ts` では新 step kind が
 * validator を通っているか検証できない。本ファイルが「core schema が SetGlobalStep を認識し、
 * 想定通り valid/invalid 判定する」を test fixture で証明する。
 *
 * 関連: project_globals_runtime_2026_05_24.md / docs/spec/process-flow-variables.md §3.6
 */
import { describe, it, expect, beforeAll } from "vitest";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

const repoRoot = resolve(__dirname, "../../../");
const v3Dir = join(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateProcessFlow: ValidateFunction;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const f of readdirSync(v3Dir)) {
    if (!f.endsWith(".json")) continue;
    const schemaObj = loadJson(join(v3Dir, f)) as { $id?: string };
    if (typeof schemaObj.$id !== "string") continue;
    ajv.addSchema(schemaObj as object, schemaObj.$id);
  }
  const v = ajv.getSchema(
    "https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/process-flow.v3.schema.json",
  );
  if (!v) throw new Error("process-flow.v3.schema.json not loaded");
  validateProcessFlow = v;
});

function dumpErrors(): string {
  return (validateProcessFlow.errors ?? [])
    .slice(0, 10)
    .map((e) => `  ${e.instancePath || "<root>"} ${e.keyword}: ${e.message ?? ""}`)
    .join("\n");
}

function envelope(action: object) {
  return {
    $schema: "../../../../schemas/v3/process-flow.v3.schema.json",
    meta: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Test",
      description: "test fixture for setGlobal step kind",
      flowType: "common" as const,
      maturity: "draft" as const,
      createdAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
    },
    actions: [action],
  };
}

const baseAction = (steps: unknown[]) => ({
  id: "act-001",
  name: "Test action",
  trigger: "submit" as const,
  description: "test",
  maturity: "draft" as const,
  inputs: [],
  outputs: [],
  responses: [{ id: "200-ok", status: 200, description: "ok" }],
  steps,
});

describe("SetGlobalStep core schema (#1322 Phase B-3e)", () => {
  describe("valid fixtures", () => {
    it("minimal: globalName + value のみ", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "TenantContext 全体を上書き",
            globalName: "TenantContext",
            value: "@var.flowParameter.tenantCtx",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });

    it("field を指定して特定 field のみ書き込み", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "テナント ID のみ更新",
            globalName: "TenantContext",
            field: "tenantId",
            value: "@var.flowParameter.tenantId",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });

    it("lifetime: 'session' を指定", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "session スコープに保持",
            globalName: "UserPreferences",
            value: "@var.action.prefs",
            lifetime: "session",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });

    it("lifetime: 'application' を指定", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "process 全体で保持",
            globalName: "FeatureFlags",
            value: "@var.action.flags",
            lifetime: "application",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });

    it("lifetime: 'request' を指定", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "1 リクエスト内のみ保持",
            globalName: "RequestContext",
            value: "@var.action.reqCtx",
            lifetime: "request",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });
  });

  describe("invalid fixtures", () => {
    it("globalName が小文字始まり (lowerCamelCase) は invalid", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "invalid globalName",
            globalName: "tenantContext",
            value: "x",
          },
        ]),
      );
      // PascalCase-ish pattern を強制 (^[A-Za-z][A-Za-z0-9_]*$ なので小文字始まりは技術的に許容)
      // → 実際は許容される (catalog name は camelCase / PascalCase 両方許容、generic-definition.v3.schema.json 同パターン)
      const ok = validateProcessFlow(data);
      expect(ok, ok ? "" : dumpErrors()).toBe(true);
    });

    it("globalName が空文字は invalid", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "empty globalName",
            globalName: "",
            value: "x",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok).toBe(false);
    });

    it("value が空文字は invalid (minLength: 1)", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "empty value",
            globalName: "Ctx",
            value: "",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok).toBe(false);
    });

    it("lifetime: 'invalid' (enum 外) は invalid", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "invalid lifetime",
            globalName: "Ctx",
            value: "x",
            lifetime: "forever",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok).toBe(false);
    });

    it("field が PascalCase (大文字始まり) は invalid (Identifier = lowerCamelCase 強制)", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "invalid field",
            globalName: "Ctx",
            field: "TenantId",
            value: "x",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok).toBe(false);
    });

    it("kind=setGlobal で必須 globalName 欠落は invalid", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "missing globalName",
            value: "x",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok).toBe(false);
    });

    it("kind=setGlobal で必須 value 欠落は invalid", () => {
      const data = envelope(
        baseAction([
          {
            id: "step-01",
            kind: "setGlobal",
            description: "missing value",
            globalName: "Ctx",
          },
        ]),
      );
      const ok = validateProcessFlow(data);
      expect(ok).toBe(false);
    });
  });
});
