/** 評価の採点の道具 (runEval) と、評価の事例 (docs/evals/cases) の試験 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEvalCase, runEval, type EvalCase } from "./runEval.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CASES_DIR = path.join(REPO, "docs/evals/cases");
const TMP = path.join(os.tmpdir(), `eval-${process.pid}-${Date.now()}`);

async function copyRetail(dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  await fs.copyFile(path.join(REPO, "examples/retail/harmony.json"), path.join(dest, "harmony.json"));
  await fs.cp(path.join(REPO, "examples/retail/harmony"), path.join(dest, "harmony"), { recursive: true });
}
const loadCases = async (): Promise<EvalCase[]> => Promise.all((await fs.readdir(CASES_DIR)).filter((n) => n.endsWith(".json")).sort().map(async (n) => parseEvalCase(JSON.parse(await fs.readFile(path.join(CASES_DIR, n), "utf8")), n)));

beforeAll(async () => { await copyRetail(path.join(TMP, "retail")); });
afterAll(async () => { await fs.rm(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe("評価の事例", () => {
  it("すべての事例が正しい形で、id が重複せず、依頼に check_design の約束が入っている", async () => {
    const cases = await loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.request, c.id).toContain("designer__check_design");
      expect(c.expectations.some((e) => e.type === "noIssues"), `${c.id}: 要確認 0 件の期待がない`).toBe(true);
    }
  });

  it("不正な事例を黙って通さない", () => {
    expect(() => parseEvalCase({ id: "x" }, "x.json")).toThrow(/必要/);
    expect(() => parseEvalCase({ id: "x", title: "t", request: "r", expectations: [{ type: "nope" }] }, "x.json")).toThrow(/知らない期待/);
  });

  it("自己確認 (selfTest) のある事例は、その正解のワークスペースで合格する", async () => {
    const cases = (await loadCases()).filter((c) => c.selfTest);
    expect(cases.length).toBeGreaterThan(0);
    for (const c of cases) {
      const r = await runEval(path.join(TMP, "retail"), c);
      expect(r.passed, `${c.id}: ${r.checks.filter((k) => !k.ok).map((k) => k.detail).join(" / ")}`).toBe(true);
    }
  });
});

describe("採点の道具", () => {

  it("期待を満たさないものを、理由つきで不合格にする: トランザクションを外した注文確定", async () => {
    const ws = path.join(TMP, "broken-tx");
    await copyRetail(ws);
    const f = path.join(ws, "harmony/process-flows/order-confirm.json");
    const j = JSON.parse(await fs.readFile(f, "utf8"));
    const flat = (steps: any[]): any[] => steps.flatMap((s) => [s, ...flat(s.steps ?? []), ...(s.branches ?? []).flatMap((b: any) => flat(b.steps ?? []))]);
    for (const s of flat(j.actions[0].steps)) if (s.kind === "transactionScope") s.kind = "compute"; // 種類を変えて、トランザクションをなくす
    await fs.writeFile(f, JSON.stringify(j));
    const c = (await loadCases()).find((x) => x.id === "branch-status-update")!;
    const r = await runEval(ws, c);
    expect(r.passed).toBe(false);
    const flow = r.checks.find((k) => k.expectation.type === "hasFlow")!;
    expect(flow.ok).toBe(false);
    expect(flow.detail).toContain("工程 transactionScope がない");
  });

  it("参照が切れていれば flowsCallable が落ち、要確認があれば noIssues が落ちる", async () => {
    const ws = path.join(TMP, "broken-ref");
    await copyRetail(ws);
    const f = path.join(ws, "harmony/process-flows/cart-add.json");
    const j = JSON.parse(await fs.readFile(f, "utf8"));
    j.meta.screenId = "no-such-screen";
    await fs.writeFile(f, JSON.stringify(j));
    const r = await runEval(ws, { id: "t", title: "t", request: "r", expectations: [{ type: "flowsCallable" }, { type: "noIssues" }] });
    expect(r.checks.map((k) => k.ok)).toEqual([false, false]);
    expect(r.checks[0].detail).toContain("no-such-screen");
  });

  it("hasTable / hasScreen / testViewpoints / 名前の幅 (正規表現)", async () => {
    const r = await runEval(path.join(TMP, "retail"), {
      id: "t", title: "t", request: "r", expectations: [
        { type: "hasTable", matches: "cart|カート", minColumns: 3, hasPrimaryKey: true },
        { type: "hasTable", matches: "no-such-table" },
        { type: "hasScreen", matches: "cart|カート", minItems: 1 },
        { type: "hasScreen", matches: "cart", minItems: 9999 },
        { type: "testViewpoints", min: 1 },
        { type: "testViewpoints", min: 1_000_000 },
      ],
    });
    expect(r.checks.map((k) => k.ok)).toEqual([true, false, true, false, true, false]);
  });
});
