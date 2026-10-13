/**
 * 運用の設計の一覧: 性能の目標 (SLA) の宣言と、ジョブ (バッチ・定期処理) の一覧・依存。
 * 既存の項目 (処理フロー・アクションの `sla`、`flowType`、イベントの発行・購読、共通処理の呼び出し) から導く。
 * 新しい要件の定義 (要件の一覧) や、ジョブの時刻・再実行の定義は、スキーマに無いので扱わない。
 */
import type { DesignDocInput } from "../designDocument.js";
import { forEachStep, toCsv } from "./common.js";

export interface SlaValues { timeoutMs?: number; p95LatencyMs?: number; warningThresholdMs?: number; onTimeout?: string }
export interface SlaRow {
  flow: { id: string; name: string };
  action: { id: string; name: string };
  /** 利用の形 (外部から呼ぶ API / 画面の操作 / バッチ・定期 / 内部) */
  kind: "api" | "screen" | "job" | "internal";
  http?: { method: string; path: string };
  /** 宣言の場所: アクション / 処理フロー全体 / なし */
  declaredAt: "action" | "flow" | "none";
  sla: SlaValues;
  /** 外部システム呼び出しに、ステップごとの SLA が付いているか (呼び出しの数 / 付いている数) */
  externalCalls: { total: number; withSla: number };
}

const pickSla = (x: unknown): SlaValues | null => {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const out: SlaValues = {};
  for (const k of ["timeoutMs", "p95LatencyMs", "warningThresholdMs"] as const) if (typeof o[k] === "number") out[k] = o[k] as number;
  if (typeof o.onTimeout === "string") out.onTimeout = o.onTimeout;
  return Object.keys(out).length ? out : null;
};

export function deriveSla(input: DesignDocInput): SlaRow[] {
  const rows: SlaRow[] = [];
  for (const f of input.flows) {
    const flowSla = pickSla(f.meta.sla);
    for (const [ai, a] of f.actions.entries()) {
      const own = pickSla(a.sla);
      let total = 0, withSla = 0;
      forEachStep(a.steps, (st) => { if (st.kind === "externalSystem") { total++; if (pickSla((st as Record<string, unknown>).sla)) withSla++; } });
      const kind: SlaRow["kind"] = f.meta.flowType === "batch" || f.meta.flowType === "scheduled" ? "job" : a.httpRoute ? "api" : f.meta.flowType === "screen" || f.meta.screenId ? "screen" : "internal";
      rows.push({
        flow: { id: f.meta.id, name: f.meta.name ?? f.meta.id },
        action: { id: a.id ?? `action${ai + 1}`, name: a.name ?? a.id ?? `アクション ${ai + 1}` },
        kind, ...(a.httpRoute?.method && a.httpRoute.path ? { http: { method: a.httpRoute.method, path: a.httpRoute.path } } : {}),
        declaredAt: own ? "action" : flowSla ? "flow" : "none", sla: own ?? flowSla ?? {}, externalCalls: { total, withSla },
      });
    }
  }
  return rows;
}

export const SLA_KIND_LABELS: Record<SlaRow["kind"], string> = { api: "外部から呼ぶ API", screen: "画面の操作", job: "ジョブ", internal: "内部の処理" };

/** 性能の目標 (SLA) の宣言が必要なのに無いもの: API とジョブ。外部システム呼び出しにタイムアウトが無いものも */
export function slaGaps(rows: readonly SlaRow[]): Array<{ row: SlaRow; message: string }> {
  const out: Array<{ row: SlaRow; message: string }> = [];
  for (const r of rows) {
    if ((r.kind === "api" || r.kind === "job") && r.declaredAt === "none") out.push({ row: r, message: `${SLA_KIND_LABELS[r.kind]}「${r.flow.name} / ${r.action.name}」に、性能の目標 (SLA) が宣言されていません` });
    if (r.externalCalls.total > r.externalCalls.withSla && r.declaredAt === "none") out.push({ row: r, message: `「${r.flow.name} / ${r.action.name}」の外部システム呼び出し ${r.externalCalls.total - r.externalCalls.withSla} 件に、タイムアウトの宣言がありません` });
  }
  return out;
}

export function slaToCsv(rows: readonly SlaRow[]): string {
  return toCsv(["処理フロー", "アクション", "種類", "HTTP", "宣言の場所", "タイムアウト (ms)", "p95 (ms)", "警告しきい値 (ms)", "タイムアウト時"],
    rows.map((r) => [r.flow.name, r.action.name, SLA_KIND_LABELS[r.kind], r.http ? `${r.http.method} ${r.http.path}` : "", { action: "アクション", flow: "処理フロー全体", none: "なし" }[r.declaredAt], r.sla.timeoutMs ?? "", r.sla.p95LatencyMs ?? "", r.sla.warningThresholdMs ?? "", r.sla.onTimeout ?? ""]));
}

// ── ジョブ ─────────────────────────────────────────────────────────────

export interface JobRow {
  flow: { id: string; name: string };
  flowType: "batch" | "scheduled";
  actions: Array<{ id: string; name: string; trigger?: string; description?: string }>;
  /** 締め処理 (closing) の周期 */
  closing?: { period?: string; customCron?: string };
  timeoutMs?: number;
  writtenTables: string[];
  publishes: string[];
  subscribes: string[];
  /** このジョブより先に動く必要があるジョブ・処理 (購読するイベントの発行元・呼び出す共通処理) */
  dependsOn: Array<{ flow: { id: string; name: string }; via: "event" | "commonProcess"; label: string }>;
}

export function deriveJobs(input: DesignDocInput): JobRow[] {
  const flowName = new Map(input.flows.map((f) => [f.meta.id, f.meta.name ?? f.meta.id]));
  const publishers = new Map<string, Set<string>>();
  for (const f of input.flows) for (const a of f.actions) forEachStep(a.steps, (st) => {
    const topic = String((st as Record<string, unknown>).topic ?? "");
    if (st.kind === "eventPublish" && topic) (publishers.get(topic) ?? publishers.set(topic, new Set()).get(topic)!).add(f.meta.id);
  });
  const jobs: JobRow[] = [];
  for (const f of input.flows) {
    if (f.meta.flowType !== "batch" && f.meta.flowType !== "scheduled") continue;
    const written = new Set<string>(), pub = new Set<string>(), sub = new Set<string>(), calls = new Set<string>();
    let closing: JobRow["closing"];
    for (const a of f.actions) forEachStep(a.steps, (st) => {
      const x = st as Record<string, unknown>;
      if (st.kind === "dbAccess" && typeof x.tableId === "string" && !/^SELECT/i.test(String(x.operation ?? ""))) written.add(x.tableId);
      if (st.kind === "eventPublish" && x.topic) pub.add(String(x.topic));
      if (st.kind === "eventSubscribe" && x.topic) sub.add(String(x.topic));
      if (st.kind === "commonProcess" && typeof x.refId === "string") calls.add(x.refId);
      if (st.kind === "closing") closing = { ...(typeof x.period === "string" ? { period: x.period } : {}), ...(typeof x.customCron === "string" ? { customCron: x.customCron } : {}) };
    });
    const dependsOn: JobRow["dependsOn"] = [];
    for (const topic of sub) for (const pid of publishers.get(topic) ?? []) if (pid !== f.meta.id) dependsOn.push({ flow: { id: pid, name: flowName.get(pid) ?? pid }, via: "event", label: `イベント「${topic}」の発行元` });
    for (const cid of calls) dependsOn.push({ flow: { id: cid, name: flowName.get(cid) ?? cid }, via: "commonProcess", label: "共通処理として呼ぶ" });
    const own = pickSla(f.meta.sla);
    jobs.push({
      flow: { id: f.meta.id, name: f.meta.name ?? f.meta.id }, flowType: f.meta.flowType,
      actions: f.actions.map((a, i) => ({ id: a.id ?? `action${i + 1}`, name: a.name ?? a.id ?? `アクション ${i + 1}`, ...(a.trigger ? { trigger: a.trigger } : {}), ...(a.description ? { description: a.description } : {}) })),
      ...(closing ? { closing } : {}), ...(own?.timeoutMs !== undefined ? { timeoutMs: own.timeoutMs } : {}),
      writtenTables: [...written], publishes: [...pub], subscribes: [...sub], dependsOn,
    });
  }
  return jobs;
}
