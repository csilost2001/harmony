/**
 * トレーサビリティ表。業務フローの工程 → 画面 → 処理フロー → テーブル (CRUD) → テスト観点 の対応を 1 枚の表にし、
 * 対応が欠けているところ (実現する画面も処理も無い工程・どの業務フローにも出てこない画面・どこからも呼ばれない処理) を出す。
 */
import { deriveCrud, type DesignDocInput, type DocIssueRef } from "../designDocument.js";
import { deriveFlowCases, deriveScreenInputCases } from "../testViewpoints.js";
import { forEachStep, toCsv } from "./common.js";

export interface TraceRef { id: string; name: string }
export interface TraceRow {
  businessFlow?: TraceRef;
  step?: { id: string; name: string; lane: string };
  screens: TraceRef[];
  flows: TraceRef[];
  /** 触るテーブルと操作 (C / R / U / D) */
  tables: Array<TraceRef & { ops: string }>;
  /** テスト観点の件数 (画面入力 + 処理の分岐) */
  viewpoints: number;
  gaps: string[];
}
export interface TraceGap { kind: "step-unrealized" | "screen-no-business-flow" | "flow-unreferenced"; message: string; ref?: DocIssueRef }
export interface TraceabilityResult { rows: TraceRow[]; gaps: TraceGap[] }

export function deriveTraceability(input: DesignDocInput): TraceabilityResult {
  const screens = new Map(input.screens.map((s) => [s.id, s]));
  const flows = new Map(input.flows.map((f) => [f.meta.id, f]));
  const tableName = new Map(input.tables.map((t) => [t.id, t.name ?? t.physicalName ?? t.id]));
  const crud = deriveCrud(input.flows, input.tables);
  const crudOf = new Map(crud.rows.map((r) => [r.flowId, r.cells]));
  const testCtx = { limits: input.limits, regex: input.regex, messages: input.messages };

  // 共通処理 (commonProcess) の呼び出し先もたどって、触るテーブルを集める
  const callees = new Map<string, string[]>();
  for (const f of input.flows) {
    const out: string[] = [];
    for (const a of f.actions) forEachStep(a.steps, (st) => { if (st.kind === "commonProcess" && typeof (st as Record<string, unknown>).refId === "string") out.push((st as Record<string, unknown>).refId as string); });
    callees.set(f.meta.id, out);
  }
  const tablesOf = (flowId: string): Map<string, Set<string>> => {
    const acc = new Map<string, Set<string>>();
    const seen = new Set<string>();
    const go = (id: string) => {
      if (seen.has(id)) return; seen.add(id);
      for (const [t, letters] of Object.entries(crudOf.get(id) ?? {})) { const set = acc.get(t) ?? acc.set(t, new Set()).get(t)!; letters.forEach((l) => set.add(l)); }
      for (const c of callees.get(id) ?? []) go(c);
    };
    go(flowId);
    return acc;
  };

  // 画面に結び付いた処理: 処理側の screenId、または画面項目のイベントの呼び先
  const flowsOfScreen = (screenId: string): string[] => {
    const s = screens.get(screenId);
    const ids = new Set<string>();
    for (const f of input.flows) if (f.meta.screenId === screenId) ids.add(f.meta.id);
    for (const it of s?.items ?? []) for (const e of it.events ?? []) if (e.handlerFlowId && flows.has(e.handlerFlowId)) ids.add(e.handlerFlowId);
    return [...ids];
  };

  const viewpointCount = (screenIds: string[], flowIds: string[]) => {
    let n = 0;
    for (const id of screenIds) { const s = screens.get(id); if (s) n += deriveScreenInputCases(s, testCtx).length; }
    for (const id of flowIds) { const f = flows.get(id); if (f) n += deriveFlowCases(f).length; }
    return n;
  };
  const refOfScreen = (id: string): TraceRef => ({ id, name: screens.get(id)?.name ?? id });
  const refOfFlow = (id: string): TraceRef => ({ id, name: flows.get(id)?.meta.name ?? id });

  const rowOf = (screenIds: string[], flowIds: string[]) => {
    const tbl = new Map<string, Set<string>>();
    for (const fid of flowIds) for (const [t, ls] of tablesOf(fid)) { const set = tbl.get(t) ?? tbl.set(t, new Set()).get(t)!; ls.forEach((l) => set.add(l)); }
    const order = ["C", "R", "U", "D"];
    return {
      screens: screenIds.map(refOfScreen),
      flows: flowIds.map(refOfFlow),
      tables: [...tbl.entries()].map(([id, ls]) => ({ id, name: tableName.get(id) ?? id, ops: order.filter((l) => ls.has(l)).join("") })),
      viewpoints: viewpointCount(screenIds, flowIds),
    };
  };

  const rows: TraceRow[] = [];
  const gaps: TraceGap[] = [];
  const coveredScreens = new Set<string>();
  const coveredFlows = new Set<string>();

  for (const bf of input.businessFlows ?? []) {
    for (const st of bf.steps) {
      const screenIds = st.screenRef && screens.has(st.screenRef) ? [st.screenRef] : [];
      const flowIds = new Set<string>();
      if (st.processFlowRef && flows.has(st.processFlowRef)) flowIds.add(st.processFlowRef);
      for (const sid of screenIds) for (const fid of flowsOfScreen(sid)) flowIds.add(fid);
      // 開始・終了・判断の工程は、画面も処理も無くてよい (作業の工程だけ欠けを見る)
      if (st.kind !== "task" && !screenIds.length && !flowIds.size) continue;
      screenIds.forEach((s) => coveredScreens.add(s));
      flowIds.forEach((f) => coveredFlows.add(f));
      const rowGaps: string[] = [];
      if (st.kind === "task" && !screenIds.length && !flowIds.size) {
        rowGaps.push("実現する画面も処理も決まっていません");
        gaps.push({ kind: "step-unrealized", message: `業務フロー「${bf.name}」の工程「${st.name}」: 実現する画面も処理も決まっていません`, ref: { kind: "businessFlow", id: bf.id } });
      }
      rows.push({ businessFlow: { id: bf.id, name: bf.name }, step: { id: st.id, name: st.name, lane: bf.lanes.find((l) => l.id === st.lane)?.name ?? st.lane }, ...rowOf(screenIds, [...flowIds]), gaps: rowGaps });
    }
  }

  // どの業務フローにも出てこない画面・処理 (部品画面は除く)
  for (const s of input.screens.filter((x) => x.purpose !== "gadget")) {
    if (coveredScreens.has(s.id)) continue;
    const fids = flowsOfScreen(s.id);
    fids.forEach((f) => coveredFlows.add(f));
    const msg = `画面「${s.name ?? s.id}」は、どの業務フローの工程からも使われていません`;
    if ((input.businessFlows ?? []).length) gaps.push({ kind: "screen-no-business-flow", message: msg, ref: { kind: "screen", id: s.id } });
    rows.push({ screens: [refOfScreen(s.id)], flows: fids.map(refOfFlow), ...(() => { const r = rowOf([s.id], fids); return { tables: r.tables, viewpoints: r.viewpoints }; })(), gaps: (input.businessFlows ?? []).length ? ["業務フローに出てきません"] : [] });
  }
  const called = new Set<string>();
  for (const list of callees.values()) list.forEach((c) => called.add(c));
  const subscribed = new Set<string>();
  for (const f of input.flows) for (const a of f.actions) forEachStep(a.steps, (st) => { if (st.kind === "eventSubscribe") subscribed.add(f.meta.id); });
  for (const f of input.flows) {
    if (coveredFlows.has(f.meta.id)) continue;
    const entry = f.meta.flowType === "batch" || f.meta.flowType === "scheduled" || subscribed.has(f.meta.id) || called.has(f.meta.id) || f.actions.some((a) => a.httpRoute);
    const bound = !!f.meta.screenId && screens.has(f.meta.screenId);
    const gap = !entry && !bound;
    if (gap) gaps.push({ kind: "flow-unreferenced", message: `処理フロー「${f.meta.name ?? f.meta.id}」は、どの画面・業務フローからも呼ばれていません`, ref: { kind: "processFlow", id: f.meta.id } });
    rows.push({ screens: bound ? [refOfScreen(f.meta.screenId!)] : [], flows: [refOfFlow(f.meta.id)], ...(() => { const r = rowOf([], [f.meta.id]); return { tables: r.tables, viewpoints: r.viewpoints }; })(), gaps: gap ? ["どこからも呼ばれていません"] : [] });
  }
  return { rows, gaps };
}

export function traceabilityToCsv(r: TraceabilityResult): string {
  const join = (xs: Array<{ name: string }>) => xs.map((x) => x.name).join("、");
  return toCsv(
    ["業務フロー", "工程", "担当レーン", "画面", "処理フロー", "テーブル (操作)", "テスト観点の数", "欠け"],
    r.rows.map((x) => [x.businessFlow?.name ?? "", x.step?.name ?? "", x.step?.lane ?? "", join(x.screens), join(x.flows), x.tables.map((t) => `${t.name}(${t.ops})`).join("、"), x.viewpoints, x.gaps.join(" / ")]),
  );
}
