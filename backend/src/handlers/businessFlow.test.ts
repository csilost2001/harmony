/**
 * 業務フロー: 保存 (作成日時の保持・$schema・id の固定)、MCP tool (一覧・取得・保存・削除と検証結果)、
 * 画面 ID の改名への追従 (取り消しも含む)、schema への適合。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildHarmonyAjv } from "@harmony/shared";
import { handleBusinessFlowTool } from "./businessFlow.js";
import { readBusinessFlow, writeScreenEntity, deleteBusinessFlow } from "../projectStorage.js";
import { renameEntityId, undoEntityRename } from "../renameEntity.js";

const ROOT = path.join(os.tmpdir(), `business-flow-${process.pid}-${Date.now()}`);
const SESSION = "test-session";
const call = async (name: string, args: Record<string, unknown>) => {
  const res = await handleBusinessFlowTool(name, args, ROOT, SESSION) as { content: Array<{ text: string }> } | null;
  if (!res) throw new Error(`未処理のツール: ${name}`);
  return JSON.parse(res.content[0].text);
};
const flow = (extra: Record<string, unknown> = {}) => ({
  name: "注文",
  lanes: [{ id: "customer", name: "顧客", kind: "external" }, { id: "store", name: "店舗" }],
  steps: [
    { id: "start", lane: "customer", kind: "start", name: "注文したい", next: [{ to: "search" }] },
    { id: "search", lane: "store", kind: "task", name: "商品を探す", screenRef: "cart", next: [{ to: "end" }] },
    { id: "end", lane: "customer", kind: "end", name: "完了" },
  ],
  ...extra,
});

beforeAll(async () => {
  await fs.mkdir(path.join(ROOT, "harmony", "screens"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({
    schemaVersion: "v3", dataDir: "harmony",
    meta: { id: "00000000-0000-4000-8000-000000000009", name: "t", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    entities: { screens: [{ id: "cart", name: "カート", kind: "form", path: "/cart" }] },
  }));
  await writeScreenEntity("cart", {
    id: "cart", uuid: "11111111-1111-4111-8111-111111111111", name: "カート", kind: "form", path: "/cart",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", items: [],
  }, ROOT);
});
afterAll(async () => { await fs.rm(ROOT, { recursive: true, force: true }); });

describe("業務フローの MCP tool", () => {
  it("無いときは空の一覧、保存すると id がファイル名に固定され、$schema と日時が付く", async () => {
    expect((await call("designer__list_business_flows", {})).flows).toEqual([]);
    const res = await call("designer__save_business_flow", { flowId: "order-flow", flow: flow({ id: "別の id" }) });
    expect(res.saved).toBe(true);
    expect(res.counts).toEqual({ error: 0, warning: 0, info: 0 });
    const raw = JSON.parse(await fs.readFile(path.join(ROOT, "harmony", "business-flows", "order-flow.json"), "utf-8"));
    expect(raw.id).toBe("order-flow");
    expect(raw.$schema).toContain("business-flow.v3.schema.json");
    expect(raw.createdAt).toBeTruthy();
  });

  it("上書きしても作成日時は変わらない", async () => {
    const before = await readBusinessFlow("order-flow", ROOT);
    await new Promise((r) => setTimeout(r, 5));
    await call("designer__save_business_flow", { flowId: "order-flow", flow: flow({ name: "注文 (改)" }) });
    const after = await readBusinessFlow("order-flow", ROOT);
    expect(after!.createdAt).toBe(before!.createdAt);
    expect(after!.name).toBe("注文 (改)");
    expect(after!.updatedAt).not.toBe(before!.updatedAt);
  });

  it("問題があっても保存し、検証結果を返す (存在しない画面・次の工程)", async () => {
    const f = flow(); (f.steps[1] as any).screenRef = "ghost"; (f.steps[0] as any).next = [{ to: "nowhere" }];
    const res = await call("designer__save_business_flow", { flowId: "broken-flow", flow: f });
    expect(res.saved).toBe(true);
    const codes = res.issues.map((i: any) => i.code);
    expect(codes).toContain("dangling-next"); expect(codes).toContain("unknown-screen");
    const got = await call("designer__get_business_flow", { flowId: "broken-flow" });
    expect(got.issues.length).toBeGreaterThan(0);
    const list = await call("designer__list_business_flows", {});
    expect(list.flows.map((x: any) => [x.id, x.steps])).toEqual([["broken-flow", 3], ["order-flow", 3]]);
    expect(list.flows.find((x: any) => x.id === "broken-flow").issues).toBeGreaterThan(0);
  });

  it("形が違うものは保存しない / 不正な id を拒否する", async () => {
    await expect(call("designer__save_business_flow", { flowId: "bad-flow", flow: { name: "x" } })).rejects.toThrow();
    await expect(call("designer__save_business_flow", { flowId: "Bad Id", flow: flow() })).rejects.toThrow();
  });

  it("画面 ID の改名に工程の参照が追従し、取り消すと戻る", async () => {
    const { operation } = await renameEntityId("screen", "cart", "basket", ROOT);
    expect((await readBusinessFlow("order-flow", ROOT))!.steps).toEqual(expect.arrayContaining([expect.objectContaining({ id: "search", screenRef: "basket" })]));
    await undoEntityRename(operation.operationId, ROOT);
    expect((await readBusinessFlow("order-flow", ROOT))!.steps).toEqual(expect.arrayContaining([expect.objectContaining({ id: "search", screenRef: "cart" })]));
  });

  it("削除できる。無いものは false", async () => {
    expect((await call("designer__delete_business_flow", { flowId: "broken-flow" })).deleted).toBe(true);
    expect(await deleteBusinessFlow("broken-flow", ROOT)).toBe(false);
    expect(await readBusinessFlow("broken-flow", ROOT)).toBeNull();
  });
});

describe("business-flow.v3.schema", () => {
  const SCHEMAS = path.resolve(__dirname, "../../../schemas/v3");
  const compile = async () => {
    const ajv = buildHarmonyAjv();
    for (const f of ["common.v3.schema.json", "business-flow.v3.schema.json"]) ajv.addSchema(JSON.parse(await fs.readFile(path.join(SCHEMAS, f), "utf-8")));
    return ajv.getSchema("https://raw.githubusercontent.com/csilost2001/harmony/main/schemas/v3/business-flow.v3.schema.json")!;
  };
  it("保存した原本はスキーマに適合する", async () => {
    const validate = await compile();
    const saved = await readBusinessFlow("order-flow", ROOT);
    expect(validate(saved), JSON.stringify(validate.errors)).toBe(true);
  });
  it("未知のプロパティ・不正な種類は不適合", async () => {
    const validate = await compile();
    const saved = JSON.parse(JSON.stringify(await readBusinessFlow("order-flow", ROOT)));
    saved.steps[0].kind = "weird";
    expect(validate(saved)).toBe(false);
    saved.steps[0].kind = "start"; saved.extra = 1;
    expect(validate(saved)).toBe(false);
  });
});
