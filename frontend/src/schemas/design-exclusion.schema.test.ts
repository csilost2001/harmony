/**
 * Design exclusion schema tests (#1185 提案 D)
 *
 * ScreenDesign / PageLayoutDesign の editorKind ↔ ref 排他を if/then で強制したことを検証:
 * - editorKind=grapesjs + designFileRef のみ → pass
 * - editorKind=puck + puckDataRef のみ → pass
 * - editorKind=grapesjs + puckDataRef → fail (mismatch)
 * - editorKind=puck + designFileRef → fail (mismatch)
 * - editorKind=grapesjs only (ref 未設定) → pass (draft-state 互換)
 * - editorKind=puck only (ref 未設定) → pass (draft-state 互換)
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildHarmonyAjv } from "../utils/buildHarmonyAjv";
import type Ajv2020 from "ajv/dist/2020";

const repoRoot = resolve(__dirname, "../../../");
const v3Dir = resolve(repoRoot, "schemas/v3");

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

let validateScreen: ReturnType<InstanceType<typeof Ajv2020>["compile"]>;
let validatePageLayout: ReturnType<InstanceType<typeof Ajv2020>["compile"]>;

beforeAll(() => {
  const ajv = buildHarmonyAjv();
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  ajv.addSchema(loadJson(join(v3Dir, "screen-item.v3.schema.json")) as object);
  validateScreen = ajv.compile(loadJson(join(v3Dir, "screen.v3.schema.json")) as object);
  validatePageLayout = ajv.compile(loadJson(join(v3Dir, "page-layout.v3.schema.json")) as object);
});

const SCREEN_BASE = {
  $schema: "../../../schemas/v3/screen.v3.schema.json",
  id: "11111111-1111-4111-8111-111111111111",
  name: "fixture screen",
  kind: "form" as const,
  path: "/fixture",
  auth: "required" as const,
  maturity: "draft" as const,
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:00.000Z",
  items: [],
};

const PL_BASE = {
  $schema: "../../../schemas/v3/page-layout.v3.schema.json",
  id: "22222222-2222-4222-8222-222222222222",
  name: "fixture layout",
  maturity: "draft" as const,
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:00.000Z",
  regions: [{ name: "main", description: "content slot" }],
  assignments: {},
};

function makeScreen(design: Record<string, unknown> | undefined) {
  return design === undefined ? SCREEN_BASE : { ...SCREEN_BASE, design };
}
function makePL(design: Record<string, unknown>) {
  return { ...PL_BASE, design };
}

describe("ScreenDesign editorKind ↔ ref exclusion (#1185 提案 D)", () => {
  it("pass: editorKind=grapesjs + designFileRef のみ", () => {
    const ok = validateScreen(makeScreen({
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
      designFileRef: "design.json",
    }));
    expect(ok, JSON.stringify(validateScreen.errors)).toBe(true);
  });

  it("pass: editorKind=puck + puckDataRef のみ", () => {
    const ok = validateScreen(makeScreen({
      editorKind: "puck",
      cssFramework: "tailwind",
      puckDataRef: "puck-data.json",
    }));
    expect(ok, JSON.stringify(validateScreen.errors)).toBe(true);
  });

  it("pass: editorKind=grapesjs のみ (ref 未設定、draft-state 互換)", () => {
    const ok = validateScreen(makeScreen({
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
    }));
    expect(ok, JSON.stringify(validateScreen.errors)).toBe(true);
  });

  it("pass: editorKind=puck のみ (ref 未設定、draft-state 互換)", () => {
    const ok = validateScreen(makeScreen({
      editorKind: "puck",
      cssFramework: "tailwind",
    }));
    expect(ok, JSON.stringify(validateScreen.errors)).toBe(true);
  });

  it("fail: editorKind=grapesjs + puckDataRef (mismatch)", () => {
    const ok = validateScreen(makeScreen({
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
      puckDataRef: "puck-data.json",
    }));
    expect(ok).toBe(false);
  });

  it("fail: editorKind=puck + designFileRef (mismatch)", () => {
    const ok = validateScreen(makeScreen({
      editorKind: "puck",
      cssFramework: "tailwind",
      designFileRef: "design.json",
    }));
    expect(ok).toBe(false);
  });

  it("pass: design セクション自体が無い (省略可)", () => {
    const ok = validateScreen(makeScreen(undefined));
    expect(ok, JSON.stringify(validateScreen.errors)).toBe(true);
  });
});

describe("PageLayoutDesign editorKind ↔ ref exclusion (#1185 提案 D)", () => {
  it("pass: editorKind=grapesjs + designFileRef のみ", () => {
    const ok = validatePageLayout(makePL({
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
      designFileRef: "design.json",
    }));
    expect(ok, JSON.stringify(validatePageLayout.errors)).toBe(true);
  });

  it("pass: editorKind=puck + puckDataRef のみ", () => {
    const ok = validatePageLayout(makePL({
      editorKind: "puck",
      cssFramework: "tailwind",
      puckDataRef: "puck-data.json",
    }));
    expect(ok, JSON.stringify(validatePageLayout.errors)).toBe(true);
  });

  it("pass: editorKind=grapesjs のみ (ref 未設定、draft-state 互換)", () => {
    const ok = validatePageLayout(makePL({
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
    }));
    expect(ok, JSON.stringify(validatePageLayout.errors)).toBe(true);
  });

  it("fail: editorKind=grapesjs + puckDataRef (mismatch)", () => {
    const ok = validatePageLayout(makePL({
      editorKind: "grapesjs",
      cssFramework: "bootstrap",
      puckDataRef: "puck-data.json",
    }));
    expect(ok).toBe(false);
  });

  it("fail: editorKind=puck + designFileRef (mismatch)", () => {
    const ok = validatePageLayout(makePL({
      editorKind: "puck",
      cssFramework: "tailwind",
      designFileRef: "design.json",
    }));
    expect(ok).toBe(false);
  });
});
