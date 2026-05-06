/**
 * validateProject.test.ts — AJV バリデーション動作確認 (#835)
 */
import { describe, it, expect } from "vitest";
import { validateProject, assertValidProject } from "./validateProject";
import type { Project } from "../types/v3/project";
import type { ProjectId, Timestamp } from "../types/v3";

const TS = "2026-05-05T00:00:00.000Z" as Timestamp;
const ID = "aaaabbbb-0000-4000-8000-000000000001" as ProjectId;

function validProject(): Project {
  return {
    $schema: "../../schemas/v3/project.v3.schema.json",
    schemaVersion: "v3",
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

describe("validateProject", () => {
  it("valid な Project は { valid: true, errors: [] } を返す", () => {
    const r = validateProject(validProject());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("schemaVersion が欠けると invalid", () => {
    const p = { ...validProject(), schemaVersion: undefined };
    const r = validateProject(p);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("meta.id が UUID でない形式なら invalid", () => {
    const p: Project = {
      ...validProject(),
      meta: {
        ...validProject().meta,
        id: "not-a-uuid" as ProjectId,
      },
    };
    const r = validateProject(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("未知の追加プロパティがあると invalid (additionalProperties: false)", () => {
    const p = { ...validProject(), unknownField: "forbidden" };
    const r = validateProject(p);
    expect(r.valid).toBe(false);
  });
});

describe("assertValidProject", () => {
  it("valid な Project で例外を投げない", () => {
    expect(() => assertValidProject(validProject())).not.toThrow();
  });

  it("invalid な Project で Error を投げる", () => {
    const bad = { schemaVersion: "v3" }; // meta が欠けている
    expect(() => assertValidProject(bad)).toThrowError("[validateProject] schema validation failed");
  });
});
