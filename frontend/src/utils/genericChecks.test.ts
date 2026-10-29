/**
 * 状態遷移・初期データ・非機能要件・ジョブ (#1499) の点検 (shared/src/analysis/genericChecks.ts) と、
 * テーブル・処理フローへの参照 (x-ref-kind) の検査、サンプル (retail) の整合。shared には試験の実行がないので、ここに置く。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkGenericDefinitions, checkIntegrity, type DesignDocInput } from "@harmony/shared";
import { validateGenericDefinition } from "../schemas/genericDefinitionValidator";
import type { GenericDefinition } from "../types/v3";

const base = (): DesignDocInput => ({
  project: { name: "t" },
  screens: [],
  tables: [{
    id: "t1", name: "表1",
    columns: [
      { id: "c-id", physicalName: "id", dataType: "BIGINT", notNull: true, primaryKey: true, autoIncrement: true },
      { id: "c-code", physicalName: "code", dataType: "VARCHAR", length: 5, notNull: true },
      { id: "c-qty", physicalName: "qty", dataType: "INTEGER" },
      { id: "c-st", physicalName: "status", dataType: "VARCHAR" },
    ],
  }],
  flows: [{ meta: { id: "f1", name: "処理1" }, actions: [{ id: "a1" }] }],
  genericDefinitions: [],
} as unknown as DesignDocInput);
const msgs = (i: DesignDocInput) => [...checkGenericDefinitions(i), ...checkIntegrity(i)].map((x) => `${x.severity}|${x.section}|${x.message}`);
const withDef = (g: Record<string, unknown>) => { const i = base(); i.genericDefinitions = [g as never]; return i; };

const goodSm = () => ({
  kind: "state-machine", name: "S",
  states: [{ name: "A", initial: true }, { name: "B" }, { name: "C", final: true }],
  transitions: [{ from: "A", to: "B", trigger: "進む", processFlowId: "f1", actionId: "a1" }, { from: "B", to: "C", trigger: "終える" }],
  stateColumn: { tableId: "t1", columnId: "c-st" },
});

describe("状態遷移 (state-machine)", () => {
  it("整った定義は指摘なし", () => { expect(msgs(withDef(goodSm()))).toEqual([]); });

  it("最初の状態がない・複数・重複・存在しない状態への遷移・到達できない状態・行き止まり・終わりからの遷移を指摘する", () => {
    const sm = goodSm();
    sm.states = [{ name: "A" }, { name: "B", initial: true }, { name: "B" }, { name: "D" }, { name: "C", final: true }] as never;
    sm.transitions = [{ from: "A", to: "X", trigger: "t1" }, { from: "C", to: "A", trigger: "t2" }, { from: "B", to: "C", trigger: "t3" }] as never;
    const out = msgs(withDef(sm)).join("\n");
    for (const w of ["状態「B」が重複しています", "先の状態「X」が、状態の一覧にありません", "終わりの状態「C」から、遷移が出ています", "状態「D」は、行き先の遷移がなく", "状態「D」は、最初の状態からたどり着けません"]) expect(out, w).toContain(w);
    const two = goodSm(); two.states = [{ name: "A", initial: true }, { name: "B", initial: true }] as never; two.transitions = [{ from: "A", to: "B", trigger: "t" }] as never;
    expect(msgs(withDef(two)).join("\n")).toContain("最初の状態 (initial) が 2 つあります (A・B)");
    const none = goodSm(); none.states = [{ name: "A" }, { name: "B" }] as never; none.transitions = [{ from: "A", to: "B", trigger: "t" }] as never;
    expect(msgs(withDef(none)).join("\n")).toContain("最初の状態 (initial) がありません");
  });

  it("同じ状態から同じ契機の、条件なしの遷移が複数あれば指摘する (条件があれば指摘しない)", () => {
    const sm = goodSm();
    sm.transitions = [{ from: "A", to: "B", trigger: "進む" }, { from: "A", to: "C", trigger: "進む" }, { from: "B", to: "C", trigger: "終える" }] as never;
    expect(msgs(withDef(sm)).join("\n")).toContain("契機「進む」で、条件なしの遷移が 2 つあります");
    sm.transitions = [{ from: "A", to: "B", trigger: "進む", guard: "x" }, { from: "A", to: "C", trigger: "進む", guard: "y" }, { from: "B", to: "C", trigger: "終える" }] as never;
    expect(msgs(withDef(sm)).join("\n")).not.toContain("条件なしの遷移");
  });

  it("処理フロー・アクション・テーブル・カラムが、ないものを指せば指摘する", () => {
    const sm = goodSm();
    (sm.transitions[0] as Record<string, unknown>).processFlowId = "gone";
    sm.stateColumn = { tableId: "gone-table", columnId: "c-st" };
    const out = msgs(withDef(sm)).join("\n");
    expect(out).toContain("処理フロー「gone」がありません (processFlowId)");
    expect(out).toContain("テーブル「gone-table」がありません (tableId)");
    const sm2 = goodSm();
    (sm2.transitions[0] as Record<string, unknown>).actionId = "a-gone";
    sm2.stateColumn = { tableId: "t1", columnId: "c-gone" };
    const out2 = msgs(withDef(sm2)).join("\n");
    expect(out2).toContain("アクション「a-gone」が、処理フロー「処理1」にありません");
    expect(out2).toContain("状態を入れるカラム「c-gone」が、テーブル「表1」にありません");
  });
});

describe("初期データ (seed-data)", () => {
  const seed = (rows: unknown[]) => ({ kind: "seed-data", name: "Seed", tableId: "t1", rows });

  it("整った行は指摘なし (カラムは id でも物理名でもよい)", () => {
    expect(msgs(withDef(seed([{ id: 1, code: "A", qty: 3 }, { "c-id": 2, "c-code": "B", qty: "5" }])))).toEqual([]);
  });

  it("ないカラム・必須の欠け・null・数でない値・長さ超過・主キーの重複を指摘する (自動採番の主キーは必須にしない)", () => {
    const out = msgs(withDef(seed([{ code: "A", extra: 1 }, { qty: "abc" }, { code: null }, { code: "TOOLONG" }, { id: 1, code: "A" }, { id: 1, code: "B" }]))).join("\n");
    for (const w of ["カラム「extra」が、テーブル「表1」にありません", "必須のカラム「code」の値がありません", "の、必須のカラム「code」が null です", "カラム「qty」(INTEGER) の値が数ではありません", "カラム「code」の値が、長さ 5 を超えています", "6 行目は、5 行目と主キー (c-id) が重複しています"]) expect(out, w).toContain(w);
    expect(out).not.toContain("必須のカラム「id」");
  });

  it("テーブルがなければ、行の中身は見ずに、参照の指摘だけ。行の値は参照として見ない", () => {
    const i = withDef({ kind: "seed-data", name: "S", tableId: "gone", rows: [{ screenId: "nowhere", tableId: "nowhere" }] });
    const out = msgs(i).join("\n");
    expect(out).toContain("テーブル「gone」がありません (tableId)");
    expect(out).not.toContain("nowhere");
  });

  it("同じテーブルへの初期データが複数あれば指摘する", () => {
    const i = base();
    i.genericDefinitions = [seed([{ id: 1, code: "A" }]), { ...seed([{ id: 2, code: "B" }]), name: "Seed2" }] as never;
    expect(msgs(i).join("\n")).toContain("テーブル「t1」への初期データが 2 つあります (Seed・Seed2)");
  });
});

describe("非機能要件 (requirement)", () => {
  it("対象の処理フローに SLA の宣言がなければ知らせ、あれば黙る。測るものが空なら警告", () => {
    const req = { kind: "requirement", name: "R", processFlowId: "f1", measure: { metric: "応答時間", operator: "<=", value: 1, unit: "s" } };
    expect(msgs(withDef(req)).join("\n")).toContain("info|非機能要件 R|対象の処理フロー「処理1」に、SLA の宣言がありません");
    const i = withDef(req);
    (i.flows[0].meta as Record<string, unknown>).sla = { timeoutMs: 1000 };
    expect(msgs(i)).toEqual([]);
    expect(msgs(withDef({ ...req, measure: { metric: " ", operator: "<=", value: 1 } })).join("\n")).toContain("warning|非機能要件 R|測るもの (measure.metric) が空です");
  });
});

describe("ジョブ (job-definition)", () => {
  const job = (schedule: unknown, retry?: unknown) => ({ kind: "job-definition", name: "J", processFlowId: "f1", schedule, ...(retry ? { retry } : {}) });

  it("cron は 5 つの欄・interval は ISO 8601 の期間・event は名前を見る", () => {
    expect(msgs(withDef(job({ kind: "cron", expression: "0 2 * * *" })))).toEqual([]);
    expect(msgs(withDef(job({ kind: "cron", expression: "*/15 0-6 1,15 * MON-FRI" })))).toEqual([]);
    expect(msgs(withDef(job({ kind: "cron", expression: "0 2 * *" }))).join("\n")).toContain("5 つの欄");
    expect(msgs(withDef(job({ kind: "cron", expression: "0 2 * * !" }))).join("\n")).toContain("5 つの欄");
    expect(msgs(withDef(job({ kind: "interval", expression: "PT15M" })))).toEqual([]);
    expect(msgs(withDef(job({ kind: "interval", expression: "15分" }))).join("\n")).toContain("ISO 8601 の期間");
    expect(msgs(withDef(job({ kind: "event", expression: "" }))).join("\n")).toContain("出来事の名前");
    expect(msgs(withDef(job({ kind: "manual" })))).toEqual([]);
  });

  it("実行する処理フローがなければ参照の指摘。再実行で間隔の取り方だけ決めていれば知らせる", () => {
    expect(msgs(withDef({ ...job({ kind: "manual" }), processFlowId: "gone" })).join("\n")).toContain("処理フロー「gone」がありません (processFlowId)");
    expect(msgs(withDef(job({ kind: "manual" }, { maxAttempts: 3, backoff: "exponential" }))).join("\n")).toContain("最初の間隔 (intervalSeconds) がありません");
  });
});

describe("スキーマ (4 種類) とサンプル (retail)", () => {
  const retail = path.resolve(__dirname, "../../../examples/retail/harmony/generic-definitions");
  const read = (kind: string, name: string): GenericDefinition => JSON.parse(fs.readFileSync(path.join(retail, kind, `${name}.json`), "utf-8")) as GenericDefinition;

  it("サンプルの 4 つは、スキーマに合う", () => {
    for (const [k, n] of [["state-machine", "OrderStatus"], ["seed-data", "StoreMasterSeed"], ["requirement", "OrderConfirmResponseTime"], ["job-definition", "DashboardKpiNightly"]]) {
      expect(validateGenericDefinition(read(k, n)), `${k}/${n}`).toEqual([]);
    }
  });

  it("種類に必須の項目が欠ければ、スキーマが指摘する / 不正な値も弾く", () => {
    const sm = { ...read("state-machine", "OrderStatus") } as Record<string, unknown>;
    delete sm.transitions;
    expect(validateGenericDefinition(sm as never).some((x) => x.message.includes("transitions"))).toBe(true);
    const seed = { ...read("seed-data", "StoreMasterSeed"), rows: [] } as never;
    expect(validateGenericDefinition(seed).length).toBeGreaterThan(0);
    const req = { ...read("requirement", "OrderConfirmResponseTime"), measure: { metric: "x", operator: "~", value: 1 } } as never;
    expect(validateGenericDefinition(req).length).toBeGreaterThan(0);
    const job = { ...read("job-definition", "DashboardKpiNightly"), retry: { maxAttempts: 0 } } as never;
    expect(validateGenericDefinition(job).length).toBeGreaterThan(0);
  });

  it("サンプルの状態遷移・初期データは、retail の設計と整合している (警告 0)", () => {
    const tbl = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../examples/retail/harmony/tables/store-master.json"), "utf-8"));
    const order = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../examples/retail/harmony/tables/order.json"), "utf-8"));
    const flow = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../examples/retail/harmony/process-flows/shipment-dispatch.json"), "utf-8"));
    const i = { project: { name: "r" }, screens: [], tables: [tbl, order], flows: [flow, { meta: { id: "order-confirm" }, actions: [] }, { meta: { id: "dashboard-kpi-summary" }, actions: [] }], genericDefinitions: [read("state-machine", "OrderStatus"), read("seed-data", "StoreMasterSeed"), read("job-definition", "DashboardKpiNightly")] } as unknown as DesignDocInput;
    // 最小の入力なので、画面・ほかのテーブルがない指摘は除き、汎用定義に関わる指摘だけを見る
    expect(msgs(i).filter((m) => m.startsWith("warning") && /状態遷移|初期データ|ジョブ|汎用定義/.test(m))).toEqual([]);
  });
});
