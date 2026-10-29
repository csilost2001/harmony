/**
 * 設計の検査 (designer__check_design) の回帰試験: 正しい設計 (retail のサンプル) を**わざと壊し**、壊した点を検査が見つけることを確かめる。
 * 検査に穴があると、AI が「要確認 0 件」で完了を報告しても、参照の切れた設計が残る。穴を見つけたら、ここに足す。
 * 比べるのは「壊す前に無かった要確認」(= この破壊で増えたもの) で、文言の一部を確かめる。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDesignDocument } from "@harmony/shared";
import { loadDesignInputFromRoot } from "./designInput.js";
import { collectExtraIssues } from "./schemaIssues.js";
import { validateEntitySchema } from "./projectStorage.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = path.join(os.tmpdir(), `design-mutation-${process.pid}-${Date.now()}`);

async function copyRetail(dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  await fs.copyFile(path.join(REPO, "examples/retail/harmony.json"), path.join(dest, "harmony.json"));
  await fs.cp(path.join(REPO, "examples/retail/harmony"), path.join(dest, "harmony"), { recursive: true });
}
async function issuesOf(root: string): Promise<string[]> {
  const { input, skipped } = await loadDesignInputFromRoot(root);
  const r = buildDesignDocument({ ...input, extraIssues: await collectExtraIssues(root) });
  return [...skipped.map((s) => `error|読み込み|${s}`), ...r.issues.filter((i) => i.severity !== "info").map((i) => `${i.severity}|${i.section}|${i.message}`)];
}
const rw = async (f: string, fn: (j: any) => void) => { const j = JSON.parse(await fs.readFile(f, "utf8")); fn(j); await fs.writeFile(f, JSON.stringify(j, null, 2)); };
const flow = (ws: string, id = "cart-add") => path.join(ws, "harmony/process-flows", `${id}.json`);

/** 壊し方 → 増えるはずの要確認の文言 (部分一致)、増える件数の上限 (雑音で本当の原因が埋もれないこと) */
const MUTATIONS: Array<{ name: string; mutate: (ws: string) => Promise<void>; expect: RegExp; max: number }> = [
  { name: "処理フローが使うテーブルのファイルを消す", mutate: (ws) => fs.rm(path.join(ws, "harmony/tables/store-master.json")), expect: /store-master|店舗マスタ/, max: 10 },
  { name: "DB アクセスの tableId を、ないテーブルにする", mutate: (ws) => rw(flow(ws), (j) => { j.actions[0].steps.find((s: any) => s.kind === "dbAccess").tableId = "no-such-table"; }), expect: /テーブル「no-such-table」がありません/, max: 2 },
  { name: "呼び出す画面 (meta.screenId) を、ない画面にする", mutate: (ws) => rw(flow(ws), (j) => { j.meta.screenId = "no-such-screen"; }), expect: /呼び出す画面「no-such-screen」がありません/, max: 2 },
  { name: "同じアクションに、同じ工程 id を作る", mutate: (ws) => rw(flow(ws), (j) => { j.actions[0].steps[1].id = j.actions[0].steps[0].id; }), expect: /工程の id「step-01」が 2 回/, max: 3 },
  { name: "規約にない上限値 (@conv.limit.*) を参照する", mutate: (ws) => rw(flow(ws), (j) => { j.actions[0].steps.push({ id: "step-99", kind: "compute", description: "x", expression: "@conv.limit.noSuchLimit + 1" }); }), expect: /@conv\.limit\.noSuchLimit/, max: 2 },
  { name: "入力チェックの必須の項目 fieldErrorsVar を消す", mutate: (ws) => rw(flow(ws), (j) => { delete j.actions[0].steps.find((s: any) => s.kind === "validation").fieldErrorsVar; }), expect: /fieldErrorsVar/, max: 2 },
  { name: "工程の種類 (kind) を、ない種類にする", mutate: (ws) => rw(flow(ws), (j) => { j.actions[0].steps[0].kind = "bogus"; }), expect: /kind/, max: 2 },
  { name: "画面項目の結びつき先を、ないテーブルにする", mutate: (ws) => rw(path.join(ws, "harmony/screens/cart.json"), (j) => { j.items[0].binding = { kind: "tableColumn", ref: { tableId: "no-such-table", columnId: "x" } }; }), expect: /結びつき先のテーブル「no-such-table」/, max: 2 },
  { name: "画面項目の結びつき先を、ないカラムにする", mutate: (ws) => rw(path.join(ws, "harmony/screens/cart.json"), (j) => { j.items[0].binding = { kind: "tableColumn", ref: { tableId: "cart", columnId: "no-such-column" } }; }), expect: /カラム「no-such-column」/, max: 2 },
  { name: "テーブルの JSON を壊す", mutate: (ws) => fs.writeFile(path.join(ws, "harmony/tables/cart.json"), "{ broken"), expect: /JSON として読めません/, max: 13 },
  { name: "外部キーの参照先を、ないテーブルにする", mutate: (ws) => rw(path.join(ws, "harmony/tables/cart-item.json"), (j) => { (j.constraints ??= []).push({ id: "fk-x", kind: "foreignKey", columnIds: [j.columns[0].id], referencedTableId: "no-such-table", referencedColumnIds: ["x"] }); }), expect: /参照先のテーブル「no-such-table」/, max: 2 },
  { name: "アクションの responses を空にする (return の responseId が切れる)", mutate: (ws) => rw(flow(ws), (j) => { j.actions[0].responses = []; }), expect: /レスポンス「[^」]+」が、このアクションの responses にありません/, max: 8 },
  { name: "分岐の道の条件を空にする", mutate: (ws) => rw(flow(ws), (j) => { j.actions[0].steps.find((s: any) => s.kind === "branch").branches[0].condition = { kind: "expression", expression: "" }; }), expect: /条件が空です/, max: 2 },
  { name: "画面項目のイベントが呼ぶ処理フローを、ないものにする", mutate: (ws) => rw(path.join(ws, "harmony/screens/cart.json"), (j) => { j.items[0].events = [{ id: "ev-x", handlerFlowId: "no-such-flow" }]; }), expect: /処理フロー「no-such-flow」がありません/, max: 2 },
  { name: "入力チェックの NG のときのレスポンスを、ないレスポンスにする", mutate: (ws) => rw(flow(ws), (j) => { j.actions[0].steps.find((s: any) => s.kind === "validation").inlineBranch.ngResponseId = "no-such-response"; }), expect: /レスポンス「no-such-response」/, max: 2 },
  { name: "画面遷移の工程の行き先を、ない画面にする", mutate: (ws) => rw(flow(ws), (j) => { j.actions[0].steps.push({ id: "step-98", kind: "screenTransition", description: "x", targetScreenId: "no-such-screen" }); }), expect: /遷移先の画面「no-such-screen」/, max: 3 },
];

let baseline: Set<string>;
beforeAll(async () => {
  await copyRetail(path.join(BASE, "clean"));
  baseline = new Set(await issuesOf(path.join(BASE, "clean")));
});
afterAll(async () => { await fs.rm(BASE, { recursive: true, force: true }); });

describe("設計の検査の回帰試験 (わざと壊す)", () => {
  it("壊す前の retail は、要確認 (警告・エラー) が 0 件", () => {
    expect([...baseline]).toEqual([]);
  });

  for (const m of MUTATIONS) {
    it(`${m.name} → 検出する`, async () => {
      const ws = path.join(BASE, `m-${MUTATIONS.indexOf(m)}`);
      await copyRetail(ws);
      await m.mutate(ws);
      const added = (await issuesOf(ws)).filter((x) => !baseline.has(x));
      expect(added.some((x) => m.expect.test(x)), `増えた要確認: ${added.slice(0, 4).join(" / ")}`).toBe(true);
      expect(new Set(added).size, "同じ指摘が二重に出ている").toBe(added.length);
      expect(added.length, `雑音が多い: ${added.slice(0, 3).join(" / ")}`).toBeLessThanOrEqual(m.max);
    });
  }
});

describe("工程のスキーマ違反は、その種類の定義に対してだけ出す (雑音で本当の原因を埋もれさせない)", () => {
  const load = async () => JSON.parse(await fs.readFile(path.join(REPO, "examples/retail/harmony/process-flows/cart-add.json"), "utf8"));

  it("必須の項目が 1 つ足りないだけなら、違反は 1 件", async () => {
    const j = await load();
    delete j.actions[0].steps.find((s: any) => s.kind === "validation").fieldErrorsVar;
    const errs = await validateEntitySchema("processFlow", j);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ keyword: "required", instancePath: "/actions/0/steps/0" });
  });

  it("工程にない項目を足したら、その項目の違反が 1 件", async () => {
    const j = await load();
    j.actions[0].steps[0].noSuchField = 1;
    const errs = await validateEntitySchema("processFlow", j);
    expect(errs).toHaveLength(1);
    expect(errs[0].keyword).toBe("unevaluatedProperties");
  });

  it("種類の綴り間違いは、kind の違反 1 件だけ", async () => {
    const j = await load();
    j.actions[0].steps[0].kind = "bogus";
    const errs = await validateEntitySchema("processFlow", j);
    expect(errs).toHaveLength(1);
    expect(errs[0].instancePath).toBe("/actions/0/steps/0/kind");
  });

  it("入れ子の工程の違反は、その工程の位置で出る。親の違反と混ざらない", async () => {
    const j = await load();
    const br = j.actions[0].steps.find((s: any) => s.kind === "branch");
    delete br.branches[0].steps[0].responseId; // return の入れ子の工程
    br.branches[0].steps[0].noSuchField = true;
    const errs = await validateEntitySchema("processFlow", j);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.length).toBeLessThanOrEqual(3);
    expect(errs.every((e) => e.instancePath.includes("/branches/0/steps/0"))).toBe(true);
  });

  it("拡張の工程 (namespace:StepName) は、拡張の定義で検査する。種類がない拡張風の綴りは kind の違反", async () => {
    const j = await load();
    j.actions[0].steps[0] = { id: "ext-1", kind: "retail:OrderConfirmStep", description: "拡張", config: {} };
    expect(await validateEntitySchema("processFlow", j)).toEqual([]);
    j.actions[0].steps[0] = { id: "ext-2", kind: "NotAnExtension", description: "x" };
    const errs = await validateEntitySchema("processFlow", j);
    expect(errs).toHaveLength(1);
    expect(errs[0].instancePath).toBe("/actions/0/steps/0/kind");
  });

  it("失敗系の副作用 (errorHandling.outcomes.*.sideEffects) に return を置くと違反 (return 以外の工程だけ置ける)。正しい副作用は通る", async () => {
    const j = await load();
    j.actions[0].steps[0].errorHandling = { outcomes: { timeout: { action: "continue", sideEffects: [{ id: "se-1", kind: "return", description: "x" }] } } };
    const errs = await validateEntitySchema("processFlow", j);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].instancePath).toBe("/actions/0/steps/0/errorHandling/outcomes/timeout/sideEffects/0/kind");
    j.actions[0].steps[0].errorHandling = { outcomes: { timeout: { action: "continue", sideEffects: [{ id: "se-1", kind: "log", description: "x", level: "warn", message: "m" }] } } };
    expect((await validateEntitySchema("processFlow", j)).filter((e) => e.instancePath.includes("sideEffects")).map((e) => e.message)).not.toContain("must be equal to constant");
  });

  it("正しい処理フローは違反 0 件 (サンプル全部)", async () => {
    for (const p of ["retail", "diary", "english-learning", "household-budget"]) {
      const dir = path.join(REPO, "examples", p, "harmony/process-flows");
      for (const f of (await fs.readdir(dir)).filter((n) => n.endsWith(".json"))) {
        const j = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
        expect((await validateEntitySchema("processFlow", j)).length, `${p}/${f}`).toBe(0);
      }
    }
  });
});
