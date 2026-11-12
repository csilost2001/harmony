/**
 * アクション・meta の部分更新と、工程の id の重複への対策 (#1603)
 *
 * 検証観点:
 * 1. update_action / remove_action / update_flow_meta は既定が予行で、apply: true で保存し、harmony.json の一覧も直す
 * 2. 増えたスキーマ違反を返す
 * 3. update_step / edit_steps は、重複した id を actionId なしで指すと断り、actionId つきなら正しいアクションの工程に当たる
 * 4. renumber_step_ids で振り直したあとは、actionId なしで指せる
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { handleProcessFlowTool } from "./processFlow.js";
import { handleFlowEditTool } from "./flowEdit.js";
import { handleFlowBatchTool } from "./flowBatch.js";
import { harmonyFile, ensureDataDir, readProcessFlow, readProject, writeProcessFlow } from "../projectStorage.js";

const TMP_ROOT = path.join(os.tmpdir(), `flowEdit-handler-test-${process.pid}-${Date.now()}`);
const SESSION_ID = "test-session";

async function makeWorkspace(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const harmony = {
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: { id: "test-ws", uuid: "11111111-1111-4111-8111-111111111111", name: "test-ws", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    extensionsApplied: [],
    entities: {},
  };
  await fs.writeFile(harmonyFile(root), JSON.stringify(harmony, null, 2), "utf-8");
  await ensureDataDir(root, "harmony");
}

const FLOW = {
  meta: { id: "dup-flow", name: "重複のある処理", flowType: "common" },
  actions: [
    { id: "act-a", name: "A", description: "a", trigger: "other", steps: [{ id: "step-01", kind: "compute", description: "a1", expression: "1", outputBinding: { name: "x" } }] },
    { id: "act-b", name: "B", description: "b", trigger: "other", steps: [{ id: "step-01", kind: "compute", description: "b1", expression: "2", outputBinding: { name: "y" } }] },
  ],
};

const edit = (name: string, args: Record<string, unknown>, root: string) => handleFlowEditTool(name, args, root, SESSION_ID);
const parse = (res: { content: Array<{ text: string }> } | null) => JSON.parse(res!.content[0].text);

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
});

describe("update_action / remove_action / update_flow_meta (#1603)", () => {
  const root = path.join(TMP_ROOT, "ws-partial");
  beforeAll(async () => { await makeWorkspace(root); await writeProcessFlow("dup-flow", structuredClone(FLOW), root); });

  it("既定は予行で、保存しない", async () => {
    const out = parse(await edit("designer__update_action", { processFlowId: "dup-flow", actionId: "act-a", patch: { description: "新しい説明" } }, root));
    expect(out.applied).toBe(false);
    const pf = await readProcessFlow("dup-flow", root) as Record<string, any>;
    expect(pf.actions[0].description).toBe("a");
  });

  it("apply: true でアクションを直す。id・steps は断る", async () => {
    const out = parse(await edit("designer__update_action", { processFlowId: "dup-flow", actionId: "act-a", patch: { description: "新しい説明", httpRoute: { method: "POST", path: "/a" } }, apply: true }, root));
    expect(out.applied).toBe(true);
    const pf = await readProcessFlow("dup-flow", root) as Record<string, any>;
    expect(pf.actions[0].description).toBe("新しい説明");
    expect(pf.actions[0].steps).toHaveLength(1);
    await expect(edit("designer__update_action", { processFlowId: "dup-flow", actionId: "act-a", patch: { steps: [] }, apply: true }, root)).rejects.toThrow(/steps は変えられません/);
  });

  it("スキーマに合わない項目を足すと、newSchemaIssues で知らせる", async () => {
    const out = parse(await edit("designer__update_action", { processFlowId: "dup-flow", actionId: "act-a", patch: { notAField: 1 } }, root));
    expect(out.newSchemaIssues?.length ?? 0).toBeGreaterThan(0);
  });

  it("meta を直し、harmony.json の一覧の名前も変わる", async () => {
    await edit("designer__update_flow_meta", { processFlowId: "dup-flow", patch: { name: "改めた名前", description: "本体" }, apply: true }, root);
    const pf = await readProcessFlow("dup-flow", root) as Record<string, any>;
    expect(pf.meta.name).toBe("改めた名前");
    expect(pf.meta.id).toBe("dup-flow");
    const project = await readProject(root) as Record<string, any>;
    expect(project.entities.processFlows.find((e: { id: string }) => e.id === "dup-flow").name).toBe("改めた名前");
  });

  it("アクションを消し、一覧のアクションの数も変わる", async () => {
    const out = parse(await edit("designer__remove_action", { processFlowId: "dup-flow", actionId: "act-b", apply: true }, root));
    expect(out.removedSteps).toBe(1);
    const pf = await readProcessFlow("dup-flow", root) as Record<string, any>;
    expect(pf.actions.map((x: { id: string }) => x.id)).toEqual(["act-a"]);
    const project = await readProject(root) as Record<string, any>;
    expect(project.entities.processFlows.find((e: { id: string }) => e.id === "dup-flow").actionCount).toBe(1);
    await expect(edit("designer__remove_action", { processFlowId: "dup-flow", actionId: "act-b", apply: true }, root)).rejects.toThrow(/見つかりません/);
  });
});

describe("工程の id の重複 (#1603)", () => {
  const root = path.join(TMP_ROOT, "ws-dup");
  beforeAll(async () => { await makeWorkspace(root); await writeProcessFlow("dup-flow", structuredClone(FLOW), root); });

  it("update_step は、重複した id を actionId なしで指すと断り、どちらも変えない", async () => {
    await expect(handleProcessFlowTool("designer__update_step", { processFlowId: "dup-flow", stepId: "step-01", patch: { description: "x" } }, root, SESSION_ID))
      .rejects.toThrow(/複数のアクション/);
    const pf = await readProcessFlow("dup-flow", root) as Record<string, any>;
    expect(pf.actions.map((a: any) => a.steps[0].description)).toEqual(["a1", "b1"]);
  });

  it("update_step は、actionId つきなら正しいアクションの工程に当たる", async () => {
    await handleProcessFlowTool("designer__update_step", { processFlowId: "dup-flow", actionId: "act-b", stepId: "step-01", patch: { description: "b1-new" } }, root, SESSION_ID);
    const pf = await readProcessFlow("dup-flow", root) as Record<string, any>;
    expect(pf.actions.map((a: any) => a.steps[0].description)).toEqual(["a1", "b1-new"]);
  });

  it("edit_steps も同じ (actionId なしは断る、つきは当たる)", async () => {
    await expect(handleFlowBatchTool("designer__edit_steps", { processFlowId: "dup-flow", edits: [{ op: "update", stepId: "step-01", patch: { description: "z" } }], apply: true }, root, SESSION_ID))
      .rejects.toThrow(/複数のアクション/);
    await handleFlowBatchTool("designer__edit_steps", { processFlowId: "dup-flow", edits: [{ op: "update", actionId: "act-a", stepId: "step-01", patch: { description: "a1-new" } }], apply: true }, root, SESSION_ID);
    const pf = await readProcessFlow("dup-flow", root) as Record<string, any>;
    expect(pf.actions.map((a: any) => a.steps[0].description)).toEqual(["a1-new", "b1-new"]);
  });

  it("renumber_step_ids で振り直すと、actionId なしで指せる", async () => {
    const dry = parse(await edit("designer__renumber_step_ids", { processFlowId: "dup-flow" }, root));
    expect(dry.applied).toBe(false);
    expect(dry.renamed).toHaveLength(1);
    const out = parse(await edit("designer__renumber_step_ids", { processFlowId: "dup-flow", apply: true }, root));
    const to = out.renamed[0].to as string;
    expect(out.renamed[0]).toMatchObject({ actionId: "act-b", from: "step-01" });
    await handleProcessFlowTool("designer__update_step", { processFlowId: "dup-flow", stepId: to, patch: { description: "b1-renumbered" } }, root, SESSION_ID);
    const pf = await readProcessFlow("dup-flow", root) as Record<string, any>;
    expect(pf.actions[1].steps[0]).toMatchObject({ id: to, description: "b1-renumbered" });
    const again = parse(await edit("designer__renumber_step_ids", { processFlowId: "dup-flow", apply: true }, root));
    expect(again.renamed).toEqual([]);
  });
});
