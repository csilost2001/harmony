/**
 * LoopStep conditional required schema tests (#1185 提案 A)
 *
 * loopKind 別に必要な field が if/then で強制されることを検証:
 * - count → countExpression 必須
 * - condition → conditionMode + conditionExpression 必須
 * - collection → collectionSource + collectionItemName 必須
 *
 * draft-state 互換性: loopKind 自体が省略されれば本制約は発動しない (kind=loop の base required で steps は引き続き必須)。
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

let validateProcessFlow: ReturnType<InstanceType<typeof Ajv2020>["compile"]>;

beforeAll(() => {
  const ajv = buildHarmonyAjv();
  ajv.addSchema(loadJson(join(v3Dir, "common.v3.schema.json")) as object);
  ajv.addSchema(loadJson(join(v3Dir, "screen-item.v3.schema.json")) as object);
  validateProcessFlow = ajv.compile(loadJson(join(v3Dir, "process-flow.v3.schema.json")) as object);
});

const META_BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "fixture flow",
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:00.000Z",
  kind: "screen",
};

function makeFlowWithLoopStep(loopStep: Record<string, unknown>) {
  return {
    meta: META_BASE,
    actions: [
      {
        id: "act-001",
        name: "fixture action",
        trigger: "submit",
        steps: [loopStep],
      },
    ],
  };
}

const STEP_BASE = {
  id: "step-loop-01",
  kind: "loop" as const,
  description: "ループ fixture",
  steps: [],
};

describe("LoopStep conditional required (#1185 提案 A)", () => {
  describe("loopKind=count", () => {
    it("pass: countExpression 有り", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
        loopKind: "count",
        countExpression: "@input.itemCount",
      }));
      expect(ok, JSON.stringify(validateProcessFlow.errors)).toBe(true);
    });
    it("fail: countExpression 欠落", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
        loopKind: "count",
      }));
      expect(ok).toBe(false);
      expect(JSON.stringify(validateProcessFlow.errors)).toContain("countExpression");
    });
  });

  describe("loopKind=condition", () => {
    it("pass: conditionMode + conditionExpression 有り", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
        loopKind: "condition",
        conditionMode: "continue",
        conditionExpression: "@var.hasMore",
      }));
      expect(ok, JSON.stringify(validateProcessFlow.errors)).toBe(true);
    });
    it("fail: conditionMode のみ (conditionExpression 欠落)", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
        loopKind: "condition",
        conditionMode: "continue",
      }));
      expect(ok).toBe(false);
      expect(JSON.stringify(validateProcessFlow.errors)).toContain("conditionExpression");
    });
    it("fail: conditionExpression のみ (conditionMode 欠落)", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
        loopKind: "condition",
        conditionExpression: "@var.hasMore",
      }));
      expect(ok).toBe(false);
      expect(JSON.stringify(validateProcessFlow.errors)).toContain("conditionMode");
    });
  });

  describe("loopKind=collection", () => {
    it("pass: collectionSource + collectionItemName 有り", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
        loopKind: "collection",
        collectionSource: "@var.items",
        collectionItemName: "item",
      }));
      expect(ok, JSON.stringify(validateProcessFlow.errors)).toBe(true);
    });
    it("fail: collectionSource のみ (collectionItemName 欠落)", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
        loopKind: "collection",
        collectionSource: "@var.items",
      }));
      expect(ok).toBe(false);
      expect(JSON.stringify(validateProcessFlow.errors)).toContain("collectionItemName");
    });
    it("fail: collectionItemName のみ (collectionSource 欠落)", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
        loopKind: "collection",
        collectionItemName: "item",
      }));
      expect(ok).toBe(false);
      expect(JSON.stringify(validateProcessFlow.errors)).toContain("collectionSource");
    });
  });

  describe("base required (loopKind 自体)", () => {
    it("fail: loopKind 欠落 → base required で reject", () => {
      const ok = validateProcessFlow(makeFlowWithLoopStep({
        ...STEP_BASE,
      }));
      expect(ok).toBe(false);
      expect(JSON.stringify(validateProcessFlow.errors)).toContain("loopKind");
    });
  });
});
