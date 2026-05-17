/**
 * validateHarmony.test.ts — AJV バリデーション動作確認 (#835, #1142)
 */
import { describe, it, expect } from "vitest";
import { validateHarmony, assertValidHarmony } from "./validateHarmony";
import type { Harmony } from "../types/v3/harmony";
import type { ProjectId, Timestamp } from "../types/v3";

const TS = "2026-05-05T00:00:00.000Z" as Timestamp;
const ID = "aaaabbbb-0000-4000-8000-000000000001" as ProjectId;

function validHarmony(): Harmony {
  return {
    $schema: "../../schemas/v3/harmony.v3.schema.json",
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: ID,
      name: "テスト",
      createdAt: TS,
      updatedAt: TS,
      mode: "upstream",
      maturity: "draft",
    },
    extensionsApplied: [],
    entities: {
      screens: [],
      screenGroups: [],
      screenTransitions: [],
    },
  };
}

describe("validateHarmony", () => {
  it("valid な Harmony は { valid: true, errors: [] } を返す", () => {
    const r = validateHarmony(validHarmony());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("schemaVersion が欠けると invalid", () => {
    const p = { ...validHarmony(), schemaVersion: undefined };
    const r = validateHarmony(p);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("meta.id が UUID でない形式なら invalid", () => {
    const p: Harmony = {
      ...validHarmony(),
      meta: {
        ...validHarmony().meta,
        id: "not-a-uuid" as ProjectId,
      },
    };
    const r = validateHarmony(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("未知の追加プロパティがあると invalid (additionalProperties: false)", () => {
    const p = { ...validHarmony(), unknownField: "forbidden" };
    const r = validateHarmony(p);
    expect(r.valid).toBe(false);
  });
});

describe("assertValidHarmony", () => {
  it("valid な Harmony で例外を投げない", () => {
    expect(() => assertValidHarmony(validHarmony())).not.toThrow();
  });

  it("invalid な Harmony で Error を投げる", () => {
    const bad = { schemaVersion: "v3" }; // meta が欠けている
    expect(() => assertValidHarmony(bad)).toThrowError("[validateHarmony] schema validation failed");
  });
});
