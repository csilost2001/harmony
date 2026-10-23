/**
 * AI の出力の評価 (eval): 「この依頼で作って」と AI に頼んだ結果のワークスペースが、決めた期待を満たすかを、LLM なしで採点する。
 *
 * 資料・スキル・tool の説明を変えたとき、AI の出来が悪くならないかを測る道具。期待は**構造**で書く (名前に依存せず、種類・件数・参照・検査の結果で見る)。
 * 使い方: docs/evals/README.md。事例: docs/evals/cases/*.json
 */
import { buildDesignDocument, deriveTestViewpointSheet, returnStatus, walkAllSteps, type DesignDocInput, type FlowStep } from "@harmony/shared";
import { loadDesignInputFromRoot } from "../designInput.js";
import { collectExtraIssues } from "../schemaIssues.js";

export type Expectation =
  | { type: "noIssues"; note?: string }
  | { type: "hasTable"; matches: string; minColumns?: number; hasPrimaryKey?: boolean; note?: string }
  | { type: "hasFlow"; matches: string; stepKinds?: string[]; dbOperations?: string[]; successStatus?: number; errorStatus?: boolean; usesTable?: string; note?: string }
  | { type: "hasScreen"; matches: string; minItems?: number; note?: string }
  | { type: "flowsCallable"; note?: string }
  | { type: "testViewpoints"; min: number; note?: string };

export interface EvalCase {
  id: string;
  title: string;
  /** AI に渡す依頼 (そのまま貼る) */
  request: string;
  /** 期待。すべて満たすと合格 */
  expectations: Expectation[];
  /** 採点の道具の自己確認に使う正解のワークスペース (リポジトリの根からの相対)。この事例は、そこで合格しなければならない */
  selfTest?: string;
}

export interface EvalResult { caseId: string; passed: boolean; checks: Array<{ expectation: Expectation; ok: boolean; detail: string }> }

const re = (s: string) => new RegExp(s, "i");
const nameOf = (x: { id?: string; name?: string; physicalName?: string }) => `${x.id ?? ""} ${x.name ?? ""} ${x.physicalName ?? ""}`;

function check(input: DesignDocInput, issues: Array<{ severity: string; message: string }>, e: Expectation): { ok: boolean; detail: string } {
  switch (e.type) {
    case "noIssues": {
      const bad = issues.filter((i) => i.severity === "error" || i.severity === "warning");
      return { ok: bad.length === 0, detail: bad.length ? `要確認 ${bad.length} 件: ${bad.slice(0, 3).map((i) => i.message.slice(0, 80)).join(" / ")}` : "要確認 0 件" };
    }
    case "hasTable": {
      const hits = input.tables.filter((t) => re(e.matches).test(nameOf(t)));
      const ok = hits.some((t) => (e.minColumns === undefined || (t.columns ?? []).length >= e.minColumns) && (!e.hasPrimaryKey || (t.columns ?? []).some((c) => c.primaryKey) || (t.constraints ?? []).some((c) => c.kind === "primaryKey")));
      return { ok, detail: hits.length ? `${hits.map((t) => t.id).join(", ")}${ok ? "" : " (条件に合わない)"}` : `名前が /${e.matches}/ に合うテーブルがない` };
    }
    case "hasFlow": {
      const flows = input.flows.filter((f) => re(e.matches).test(nameOf({ id: f.meta.id, name: f.meta.name })));
      let why = flows.length ? "条件に合う処理フローがない" : `名前が /${e.matches}/ に合う処理フローがない`;
      for (const f of flows) {
        const steps: Array<{ s: FlowStep; act: (typeof f.actions)[number] }> = [];
        for (const act of f.actions ?? []) for (const s of walkAllSteps(act.steps as never)) steps.push({ s, act });
        const kinds = new Set(steps.map((x) => String(x.s.kind)));
        const ops = new Set(steps.filter((x) => x.s.kind === "dbAccess").map((x) => String((x.s as { operation?: string }).operation ?? "").toUpperCase()));
        const statuses = steps.filter((x) => x.s.kind === "return").map((x) => returnStatus(x.s, x.act as never)).filter((n): n is number => typeof n === "number");
        const tables = new Set(steps.map((x) => (x.s as { tableId?: string }).tableId).filter(Boolean) as string[]);
        const fails: string[] = [];
        for (const k of e.stepKinds ?? []) if (!kinds.has(k)) fails.push(`工程 ${k} がない`);
        for (const o of e.dbOperations ?? []) if (!ops.has(o.toUpperCase())) fails.push(`DB 操作 ${o} がない`);
        if (e.successStatus !== undefined && !statuses.includes(e.successStatus)) fails.push(`HTTP ${e.successStatus} を返す工程がない`);
        if (e.errorStatus && !statuses.some((n) => n >= 400)) fails.push("異常終了 (4xx / 5xx) を返す工程がない");
        if (e.usesTable && ![...tables].some((t) => re(e.usesTable!).test(t))) fails.push(`テーブル /${e.usesTable}/ を使っていない`);
        if (fails.length === 0) return { ok: true, detail: `処理フロー ${f.meta.id}` };
        why = `${f.meta.id}: ${fails.join(" / ")}`;
      }
      return { ok: false, detail: why };
    }
    case "hasScreen": {
      const hits = input.screens.filter((s) => re(e.matches).test(nameOf(s)));
      const ok = hits.some((s) => e.minItems === undefined || (s.items ?? []).length >= e.minItems);
      return { ok, detail: hits.length ? (ok ? hits.map((s) => s.id).join(", ") : `項目が ${e.minItems} 件に満たない`) : `名前が /${e.matches}/ に合う画面がない` };
    }
    case "flowsCallable": {
      // 画面が呼ぶ処理フローが実在し、処理フローの呼び出し元の画面が実在する (参照が切れていない)
      const flowIds = new Set(input.flows.map((f) => f.meta.id));
      const screenIds = new Set(input.screens.map((s) => s.id));
      const broken = [
        ...input.screens.flatMap((s) => (s.items ?? []).flatMap((i) => (i.events ?? []).filter((ev) => ev.handlerFlowId && !flowIds.has(ev.handlerFlowId)).map((ev) => `${s.id}.${i.id} → ${ev.handlerFlowId}`))),
        ...input.flows.filter((f) => f.meta.screenId && !screenIds.has(f.meta.screenId)).map((f) => `${f.meta.id} → 画面 ${f.meta.screenId}`),
      ];
      return { ok: broken.length === 0, detail: broken.length ? `参照が切れている: ${broken.slice(0, 3).join(", ")}` : "参照は切れていない" };
    }
    case "testViewpoints": {
      const n = deriveTestViewpointSheet({ limits: input.limits, regex: input.regex, messages: input.messages, screens: input.screens.filter((s) => s.purpose !== "gadget"), flows: input.flows }).total;
      return { ok: n >= e.min, detail: `テスト観点 ${n} 件` };
    }
  }
}

export async function runEval(root: string, c: EvalCase): Promise<EvalResult> {
  const { input } = await loadDesignInputFromRoot(root);
  const doc = buildDesignDocument({ ...input, extraIssues: await collectExtraIssues(root) });
  const checks = c.expectations.map((e) => ({ expectation: e, ...check(input, doc.issues, e) }));
  return { caseId: c.id, passed: checks.every((x) => x.ok), checks };
}

/** 事例の JSON を読んだ値の形を確かめる (不正な事例を黙って通さない) */
export function parseEvalCase(v: unknown, where: string): EvalCase {
  const o = v as Partial<EvalCase> | null;
  if (!o || typeof o.id !== "string" || typeof o.title !== "string" || typeof o.request !== "string" || !Array.isArray(o.expectations) || !o.expectations.length) throw new Error(`${where}: id / title / request / expectations が必要です`);
  const types = ["noIssues", "hasTable", "hasFlow", "hasScreen", "flowsCallable", "testViewpoints"];
  for (const e of o.expectations) if (!e || !types.includes((e as { type: string }).type)) throw new Error(`${where}: 知らない期待の種類です: ${JSON.stringify(e).slice(0, 80)}`);
  return o as EvalCase;
}
