import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { resolve } from "node:path";
import {
  buildExtendedSchema,
  loadExtensionsFromBundle,
  loadExtensionsFromDir,
  type ExtensionsBundle,
} from "./loadExtensions";

const repoRoot = resolve(__dirname, "../../../");
const dataExtensionsDir = resolve(repoRoot, "data/extensions");

/**
 * 最小有効ベーススキーマ (v1 schema ファイル削除 #774 に伴いインライン化)。
 * loadExtensions / buildExtendedSchema のユニットテスト専用。
 *
 * buildExtendedSchema が参照する $defs を含む:
 *   - FieldType.oneOf  → 拡張 fieldType の globalConflict 検出
 *   - ActionTrigger.enum → 拡張 trigger の globalConflict 検出
 *   - DbOperation.enum  → 拡張 dbOperation の globalConflict 検出
 */
const baseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    type: { type: "string" },
    description: { type: "string" },
    actions: { type: "array" },
  },
  $defs: {
    FieldType: {
      oneOf: [
        { type: "string", enum: ["string", "number", "integer", "boolean", "date", "datetime", "json"] },
        { type: "object", required: ["kind"], additionalProperties: false, properties: { kind: { const: "array" } } },
        { type: "object", required: ["kind"], additionalProperties: false, properties: { kind: { const: "object" } } },
        { type: "object", required: ["kind"], additionalProperties: false, properties: { kind: { const: "domain" } } },
      ],
    },
    ActionTrigger: {
      enum: ["click", "submit", "select", "change", "load", "timer", "auto", "other"],
    },
    DbOperation: {
      enum: ["SELECT", "INSERT", "UPDATE", "DELETE", "MERGE", "LOCK"],
    },
    StepType: {
      enum: ["return", "compute", "dbAccess", "externalSystem", "validation", "branch", "loop",
             "loopBreak", "loopContinue", "jump", "log", "audit", "workflow", "transactionScope",
             "eventPublish", "eventSubscribe", "screenTransition", "displayUpdate", "closing",
             "cdc", "other"],
    },
  },
};

function compile(schema: object) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

function makeFlow(patch: Record<string, unknown>) {
  return {
    id: "a",
    name: "x",
    type: "screen",
    description: "",
    actions: [{
      id: "act-1",
      name: "test",
      trigger: "submit",
      steps: [{ id: "s1", type: "other", description: "" }],
      ...patch,
    }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("loadExtensions", () => {
  it("空 bundle で buildExtendedSchema が素通りする", () => {
    const loaded = loadExtensionsFromBundle({});
    const extended = buildExtendedSchema(baseSchema, loaded.extensions);

    expect(loaded.errors).toEqual([]);
    expect(extended.errors).toEqual([]);
    expect(extended.schema).toEqual(baseSchema);
    expect(extended.schema).not.toBe(baseSchema);
  });

  it("data/extensions/ の最小サンプルを読み込める", async () => {
    const loaded = await loadExtensionsFromDir(dataExtensionsDir);

    expect(loaded.errors).toEqual([]);
    expect(loaded.extensions.steps).toEqual({});
    expect(loaded.extensions.fieldTypes).toEqual([]);
    expect(loaded.extensions.triggers).toEqual([]);
    expect(loaded.extensions.dbOperations).toEqual([]);
    expect(loaded.extensions.responseTypes).toEqual({});
  });

  it("有効な step 拡張が追加される", () => {
    const loaded = loadExtensionsFromBundle({
      steps: {
        namespace: "gm50",
        steps: {
          BatchStep: {
            label: "Batch",
            icon: "bi-gear",
            description: "Batch step",
            schema: {
              type: "object",
              required: ["batchId"],
              additionalProperties: false,
              properties: {
                batchId: { type: "string", description: "Batch ID" },
              },
            },
          },
        },
      },
    });

    expect(loaded.errors).toEqual([]);
    expect(Object.keys(loaded.extensions.steps)).toEqual(["gm50:BatchStep"]);
  });

  it("有効な field-type 拡張が追加される", () => {
    const loaded = loadExtensionsFromBundle({
      fieldTypes: {
        namespace: "",
        fieldTypes: [{ kind: "view", label: "ビュー" }],
      },
    });
    const extended = buildExtendedSchema(baseSchema, loaded.extensions);
    const validate = compile(extended.schema);

    const ok = validate(makeFlow({
      inputs: [{ name: "viewRef", type: { kind: "view" } }],
    }));

    if (!ok) throw new Error(JSON.stringify(validate.errors));
    expect(ok).toBe(true);
  });

  it("有効な step 拡張が追加される", () => {
    const loaded = loadExtensionsFromBundle({
      steps: {
        namespace: "gm50",
        steps: {
          BatchStep: {
            label: "Batch",
            icon: "bi-gear",
            description: "Batch step",
            schema: {
              type: "object",
              required: ["batchId"],
              additionalProperties: false,
              properties: {
                batchId: { type: "string" },
              },
            },
          },
        },
      },
    });
    const extended = buildExtendedSchema(baseSchema, loaded.extensions);
    const validate = compile(extended.schema);

    const ok = validate(makeFlow({
      steps: [{
        id: "step-batch",
        type: "gm50:BatchStep",
        description: "拡張バッチステップ",
        batchId: "BATCH-001",
      }],
    }));

    if (!ok) throw new Error(JSON.stringify(validate.errors));
    expect(ok).toBe(true);
  });

  it("field-type でグローバル enum 衝突なら reject する", () => {
    const loaded = loadExtensionsFromBundle({
      fieldTypes: {
        namespace: "",
        fieldTypes: [{ kind: "string", label: "文字列" }],
      },
    });
    const extended = buildExtendedSchema(baseSchema, loaded.extensions);

    expect(extended.errors).toEqual([
      expect.objectContaining({ type: "fieldTypes", code: "globalConflict", key: "string" }),
    ]);
  });

  it("trigger でグローバル enum 衝突なら reject する", () => {
    const loaded = loadExtensionsFromBundle({
      triggers: {
        namespace: "",
        triggers: [{ value: "auto", label: "Auto" }],
      },
    });
    const extended = buildExtendedSchema(baseSchema, loaded.extensions);

    expect(extended.errors).toEqual([
      expect.objectContaining({ type: "triggers", code: "globalConflict", key: "auto" }),
    ]);
  });

  it("db-operation でグローバル enum 衝突なら reject する", () => {
    const loaded = loadExtensionsFromBundle({
      dbOperations: {
        namespace: "",
        dbOperations: [{ value: "MERGE", label: "MERGE" }],
      },
    });
    const extended = buildExtendedSchema(baseSchema, loaded.extensions);

    expect(extended.errors).toEqual([
      expect.objectContaining({ type: "dbOperations", code: "globalConflict", key: "MERGE" }),
    ]);
  });

  it("step 同名は warning 付き上書きでエラーは出ない", () => {
    const loaded = loadExtensionsFromBundle({
      steps: {
        namespace: "",
        steps: {
          other: {
            label: "Other override",
            icon: "bi-box",
            description: "Override standard other step",
            schema: { type: "object", properties: {} },
          },
        },
      },
    });
    const extended = buildExtendedSchema(baseSchema, loaded.extensions);

    expect(loaded.errors).toEqual([]);
    expect(extended.errors).toEqual([]);
    expect(extended.warnings).toEqual([
      expect.objectContaining({ type: "steps", code: "override", key: "other" }),
    ]);
  });

  it("response-type 同名は warning 付き上書きでエラーは出ない", () => {
    const localBase = {
      ...baseSchema,
      responseTypes: {
        ApiError: { schema: { type: "object" } },
      },
    };
    const loaded = loadExtensionsFromBundle({
      responseTypes: {
        namespace: "",
        responseTypes: {
          ApiError: {
            description: "override",
            schema: { type: "object", properties: { code: { type: "string" } } },
          },
        },
      },
    });
    const extended = buildExtendedSchema(localBase, loaded.extensions);

    expect(loaded.errors).toEqual([]);
    expect(extended.errors).toEqual([]);
    expect(extended.warnings).toEqual([
      expect.objectContaining({ type: "responseTypes", code: "override", key: "ApiError" }),
    ]);
  });

  it("namespace 未指定 bundle はスキーマバリデーションで reject する", () => {
    const bundle: ExtensionsBundle = {
      fieldTypes: {
        fieldTypes: [{ kind: "view", label: "ビュー" }],
      },
    };
    const loaded = loadExtensionsFromBundle(bundle);

    expect(loaded.errors).toEqual([
      expect.objectContaining({ type: "fieldTypes", code: "schemaValidation" }),
    ]);
  });

  it("steps[*].schema の非対応 keyword を reject する", () => {
    const loaded = loadExtensionsFromBundle({
      steps: {
        namespace: "",
        steps: {
          BadStep: {
            label: "Bad",
            icon: "bi-x",
            description: "Bad schema",
            schema: {
              type: "object",
              oneOf: [{ type: "string" }],
            },
          },
        },
      },
    });

    expect(loaded.errors).toEqual([
      expect.objectContaining({ type: "steps", code: "schemaValidation" }),
    ]);
    expect(loaded.extensions.steps).toEqual({});
  });
});
