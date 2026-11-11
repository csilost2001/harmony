/**
 * カタログへの 1 件の追加・削除と、Arazzo の書き出しの v3 対応 (#1601)
 *
 * 検証観点:
 * 1. add_catalog_entry は処理フローの context.catalogs.<種類> に書き、v3 のスキーマを通る (一番上に古い名前を書かない)
 * 2. 古い名前 (errorCatalog など) も v3 の名前に読み替える
 * 3. processFlowId を省くと catalogs/external.json に書く。errors / domains は置けない
 * 4. スキーマに合わない値・キーは書かずにエラー
 * 5. remove_catalog_entry は無いキーをエラーにする
 * 6. export_arazzo が meta.id / meta.name / context.catalogs.externalSystems とプロジェクト共通のカタログを読む
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { handleProcessFlowTool } from "./processFlow.js";
import {
  harmonyFile,
  ensureDataDir,
  readProcessFlow,
  readExternalCatalogs,
  validateEntitySchema,
  writeProcessFlow,
} from "../projectStorage.js";

const TMP_ROOT = path.join(os.tmpdir(), `catalogEntry-handler-test-${process.pid}-${Date.now()}`);
const SESSION_ID = "test-session";

async function makeWorkspace(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const harmony = {
    schemaVersion: "v3",
    dataDir: "harmony",
    meta: {
      id: "test-ws",
      uuid: "11111111-1111-4111-8111-111111111111",
      name: "test-ws",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    extensionsApplied: [],
    entities: {},
  };
  await fs.writeFile(harmonyFile(root), JSON.stringify(harmony, null, 2), "utf-8");
  await ensureDataDir(root, "harmony");
}

async function addFlow(root: string): Promise<string> {
  const res = await handleProcessFlowTool("designer__add_process_flow", { name: "カタログ試験", flowType: "common" }, root, SESSION_ID);
  const id = /ID: ([a-z0-9][a-z0-9-]*)/.exec(res!.content[0].text)?.[1];
  if (!id) throw new Error("処理フローの id が取れません");
  return id;
}

const call = (name: string, args: Record<string, unknown>, root: string) => handleProcessFlowTool(name, args, root, SESSION_ID);

const FN = { signature: "formatCurrency(amount: number, currency: string): string", returnType: "string", description: "金額を通貨の書式にする", examples: ["@fn.formatCurrency(150000, 'JPY') // => \"¥150,000\""] };

afterAll(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
});

describe("designer__add_catalog_entry / remove_catalog_entry — 処理フロー (#1601)", () => {
  const root = path.join(TMP_ROOT, "ws-flow");
  let flowId = "";
  beforeAll(async () => { await makeWorkspace(root); flowId = await addFlow(root); });

  it("context.catalogs に書き、v3 のスキーマを通る。一番上に古い名前を書かない", async () => {
    await call("designer__add_catalog_entry", { processFlowId: flowId, catalog: "functions", key: "formatCurrency", value: FN }, root);
    await call("designer__add_catalog_entry", { processFlowId: flowId, catalog: "errorCatalog", key: "STOCK_SHORTAGE", value: { httpStatus: 409 } }, root);
    const pf = await readProcessFlow(flowId, root) as Record<string, any>;
    expect(pf.context.catalogs.functions.formatCurrency).toEqual(FN);
    expect(pf.context.catalogs.errors.STOCK_SHORTAGE).toEqual({ httpStatus: 409 });
    expect(pf).not.toHaveProperty("errorCatalog");
    const errors = await validateEntitySchema("processFlow", pf);
    expect(errors.filter((e) => e.instancePath === "" || e.instancePath.startsWith("/context"))).toEqual([]);
  });

  it("スキーマに合わない値は書かない", async () => {
    await expect(call("designer__add_catalog_entry", { processFlowId: flowId, catalog: "functions", key: "bad", value: { signature: "x" } }, root))
      .rejects.toThrow(/スキーマに合いません/);
    await expect(call("designer__add_catalog_entry", { processFlowId: flowId, catalog: "envVars", key: "lowerCase", value: { description: "x" } }, root))
      .rejects.toThrow(/スキーマに合いません/);
    const pf = await readProcessFlow(flowId, root) as Record<string, any>;
    expect(pf.context.catalogs.functions.bad).toBeUndefined();
  });

  it("知らない種類はエラー", async () => {
    await expect(call("designer__add_catalog_entry", { processFlowId: flowId, catalog: "nope", key: "a", value: {} }, root))
      .rejects.toThrow(/catalog が不正です/);
  });

  it("削除する。無いキーはエラー", async () => {
    await call("designer__remove_catalog_entry", { processFlowId: flowId, catalog: "errors", key: "STOCK_SHORTAGE" }, root);
    const pf = await readProcessFlow(flowId, root) as Record<string, any>;
    expect(pf.context.catalogs.errors).toBeUndefined();
    expect(pf.context.catalogs.functions.formatCurrency).toBeDefined();
    await expect(call("designer__remove_catalog_entry", { processFlowId: flowId, catalog: "errors", key: "STOCK_SHORTAGE" }, root))
      .rejects.toThrow(/はありません/);
  });
});

describe("designer__add_catalog_entry / remove_catalog_entry — プロジェクト共通 (#1601)", () => {
  const root = path.join(TMP_ROOT, "ws-project");
  beforeAll(async () => { await makeWorkspace(root); });

  it("processFlowId を省くと catalogs/external.json に書く", async () => {
    await call("designer__add_catalog_entry", { catalog: "functions", key: "formatCurrency", value: FN }, root);
    await call("designer__add_catalog_entry", { catalog: "envVars", key: "STRIPE_API_BASE", value: { type: "string", description: "Stripe の URL" } }, root);
    const doc = await readExternalCatalogs(root) as Record<string, any>;
    expect(doc.functions.formatCurrency).toEqual(FN);
    expect(doc.envVars.STRIPE_API_BASE).toEqual({ type: "string", description: "Stripe の URL" });
  });

  it("errors / domains はプロジェクト共通に置けない", async () => {
    await expect(call("designer__add_catalog_entry", { catalog: "errors", key: "X_ERR", value: { httpStatus: 400 } }, root))
      .rejects.toThrow(/プロジェクト共通のカタログに置けません/);
    await expect(call("designer__add_catalog_entry", { catalog: "domains", key: "Money", value: {} }, root))
      .rejects.toThrow(/プロジェクト共通のカタログに置けません/);
  });

  it("削除して空になった種類は取り除く。無いキーはエラー", async () => {
    await call("designer__remove_catalog_entry", { catalog: "envVars", key: "STRIPE_API_BASE" }, root);
    const doc = await readExternalCatalogs(root) as Record<string, any>;
    expect(doc.envVars).toBeUndefined();
    expect(doc.functions.formatCurrency).toBeDefined();
    await expect(call("designer__remove_catalog_entry", { catalog: "envVars", key: "STRIPE_API_BASE" }, root))
      .rejects.toThrow(/はありません/);
  });
});

describe("designer__export_arazzo — v3 の形を読む (#1601)", () => {
  const root = path.join(TMP_ROOT, "ws-arazzo");
  beforeAll(async () => { await makeWorkspace(root); });

  it("meta の id・名前と、処理フロー側を優先したカタログの OpenAPI の場所を出す", async () => {
    const flow = {
      meta: { id: "pay-flow", name: "支払い", flowType: "common" },
      context: { catalogs: { externalSystems: { stripe: { name: "Stripe", openApiSpec: "https://flow.example/stripe.yaml" } } } },
      actions: [{
        id: "act-1", name: "実行", trigger: "other", steps: [
          { id: "s1", kind: "externalSystem", description: "課金", systemRef: "stripe", operationId: "createCharge" },
          { id: "s2", kind: "externalSystem", description: "通知", systemRef: "mailer", httpCall: { method: "POST", path: "/send" } },
        ],
      }],
    };
    await writeProcessFlow("pay-flow", flow, root);
    await call("designer__add_catalog_entry", { catalog: "externalSystems", key: "stripe", value: { name: "Stripe", openApiSpec: "https://project.example/stripe.yaml" } }, root);
    await call("designer__add_catalog_entry", { catalog: "externalSystems", key: "mailer", value: { name: "Mailer", openApiSpec: "https://project.example/mailer.yaml" } }, root);
    const res = await call("designer__export_arazzo", { processFlowId: "pay-flow", outputFormat: "json" }, root);
    const doc = JSON.parse(res!.content[0].text);
    expect(doc.info.title).toBe("支払い");
    expect(doc.workflows[0].workflowId).toBe("pay-flow");
    expect(doc.sourceDescriptions).toEqual([
      { name: "stripe", url: "https://flow.example/stripe.yaml", type: "openapi" },
      { name: "mailer", url: "https://project.example/mailer.yaml", type: "openapi" },
    ]);
    expect(doc.workflows[0].steps).toEqual([
      { stepId: "s1", operationId: "createCharge" },
      { stepId: "s2", operationPath: "POST /send" },
    ]);
  });
});
