/**
 * 汎用定義のうち、状態遷移 (state-machine)・初期データ (seed-data)・非機能要件 (requirement)・ジョブ (job-definition) の点検 (#1499)。
 * 設計どうしの参照 (テーブル・処理フローの有無) は integrity.ts の x-ref-kind の検査が見る。ここは、定義の中の整合と、他の設計との突き合わせ。
 * 純粋関数で、書き込まない。仕様: docs/spec/generic-definition-layer.md §4.2.1 / docs/spec/design-check.md
 */
import type { DesignDocInput, DocIssue, DocTable } from "../designDocument.js";

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const KIND_LABEL: Record<string, string> = { "state-machine": "状態遷移", "seed-data": "初期データ", requirement: "非機能要件", "job-definition": "ジョブ" };
const NUMERIC = /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|NUMBER)\b/i;
const ISO_DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;
const CRON_MACROS = new Set(["@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"]);
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** cron の 1 つの欄 (`*` `?` 数 `a-b` `*\/n` `a-b/n` と、コンマの並び。月・曜日は英名も)。範囲を外れた数は不可。Quartz の `L` `W` `#` は、形だけ許す */
function cronFieldOk(field: string, min: number, max: number, names?: string[]): boolean {
  return field.split(",").every((item) => {
    const [range, step, ...extra] = item.split("/");
    if (extra.length || item === "") return false;
    if (step !== undefined && !/^\d+$/.test(step)) return false;
    if (range === "*" || range === "?") return true;
    const num = (x: string): number | null => {
      if (/^\d+$/.test(x)) { const n = Number(x); return n >= min && n <= max ? n : null; }
      const i = names ? names.indexOf(x.toUpperCase()) : -1;
      return i >= 0 ? i + (min === 0 && names === WEEKDAYS ? 0 : min) : null;
    };
    if (/[LW#]/.test(range) && /^[0-9LW#\-]+$/i.test(range)) return true;
    const parts = range.split("-");
    if (parts.length > 2) return false;
    const nums = parts.map(num);
    return nums.every((n) => n !== null) && (nums.length < 2 || (nums[0] as number) <= (nums[1] as number));
  });
}
function cronOk(expr: string): boolean {
  if (CRON_MACROS.has(expr.toLowerCase())) return true;
  const f = expr.split(/\s+/).filter(Boolean);
  return f.length === 5 && cronFieldOk(f[0], 0, 59) && cronFieldOk(f[1], 0, 23) && cronFieldOk(f[2], 1, 31) && cronFieldOk(f[3], 1, 12, MONTHS) && cronFieldOk(f[4], 0, 7, WEEKDAYS);
}

export function checkGenericDefinitions(input: DesignDocInput): DocIssue[] {
  const out: DocIssue[] = [];
  const tableById = new Map(input.tables.map((t) => [t.id, t] as const));
  const flowById = new Map(input.flows.map((f) => [f.meta.id, f] as const));
  const defs = (input.genericDefinitions ?? []).filter((g) => KIND_LABEL[g.kind]);

  for (const g of defs) {
    const sec = `${KIND_LABEL[g.kind]} ${g.name}`;
    const warn = (message: string): void => { out.push({ severity: "warning", section: sec, message }); };
    const info = (message: string): void => { out.push({ severity: "info", section: sec, message }); };
    if (g.kind === "state-machine") checkStateMachine(g, warn, tableById, flowById);
    else if (g.kind === "seed-data") checkSeedData(g, warn, tableById);
    else if (g.kind === "requirement") checkRequirement(g, warn, info, flowById);
    else checkJob(g, warn, info);
  }

  // 同じテーブルへの初期データが複数あると、どちらが正か分からない
  const byTable = new Map<string, string[]>();
  for (const g of defs) if (g.kind === "seed-data" && typeof g.tableId === "string") byTable.set(g.tableId, [...(byTable.get(g.tableId) ?? []), g.name]);
  for (const [tableId, names] of byTable) {
    if (names.length > 1) out.push({ severity: "warning", section: `初期データ ${names[0]}`, message: `テーブル「${tableId}」への初期データが ${names.length} つあります (${names.join("・")})。1 つにまとめてください` });
  }
  return out;
}

type Warn = (message: string) => void;
type G = DesignDocInput["genericDefinitions"] extends Array<infer T> | undefined ? T : never;

function columnMatches(t: DocTable, key: string): boolean {
  return (t.columns ?? []).some((c) => c.id === key || c.physicalName === key);
}

function checkStateMachine(g: G, warn: Warn, tableById: Map<string, DocTable>, flowById: Map<string, DesignDocInput["flows"][number]>): void {
  const states = recs(g.states);
  const transitions = recs(g.transitions);
  const names = states.map((s) => str(s.name));
  const seen = new Set<string>();
  for (const n of names) { if (n && seen.has(n)) warn(`状態「${n}」が重複しています`); seen.add(n); }
  const initial = states.filter((s) => s.initial === true).map((s) => str(s.name));
  if (states.length && initial.length === 0) warn("最初の状態 (initial) がありません");
  if (initial.length > 1) warn(`最初の状態 (initial) が ${initial.length} つあります (${initial.join("・")})。1 つにしてください`);
  const known = new Set(names);
  for (const t of transitions) {
    const from = str(t.from), to = str(t.to);
    if (from && !known.has(from)) warn(`遷移「${str(t.trigger)}」の元の状態「${from}」が、状態の一覧にありません`);
    if (to && !known.has(to)) warn(`遷移「${str(t.trigger)}」の先の状態「${to}」が、状態の一覧にありません`);
    const pid = str(t.processFlowId);
    const aid = str(t.actionId);
    if (aid && !pid) warn(`遷移「${str(t.trigger)}」にアクション「${aid}」がありますが、処理フロー (processFlowId) がありません`);
    if (pid && aid) {
      const f = flowById.get(pid);
      if (f && !(f.actions ?? []).some((a) => a.id === aid)) warn(`遷移「${str(t.trigger)}」のアクション「${aid}」が、処理フロー「${f.meta.name ?? pid}」にありません`);
    }
  }
  // 同じ状態から同じ契機で、条件なしの遷移が複数あると、どれになるか決まらない
  const dup = new Map<string, number>();
  for (const t of transitions) if (!str(t.guard)) { const k = `${str(t.from)}\u0000${str(t.trigger)}`; dup.set(k, (dup.get(k) ?? 0) + 1); }
  for (const [k, n] of dup) if (n > 1) { const [from, trigger] = k.split("\u0000"); warn(`状態「${from}」から契機「${trigger}」で、条件なしの遷移が ${n} つあります (どれになるか決まりません)`); }
  // 終わりの状態からの遷移・行き止まり・到達できない状態
  const out = new Map<string, string[]>();
  for (const t of transitions) out.set(str(t.from), [...(out.get(str(t.from)) ?? []), str(t.to)]);
  // 自分への遷移だけの状態は、先へ進めない (行き止まりと同じ)
  const leaves = (n: string): boolean => !(out.get(n) ?? []).some((to) => to !== n);
  for (const s of states) {
    const n = str(s.name);
    if (s.final === true && (out.get(n) ?? []).length) warn(`終わりの状態「${n}」から、遷移が出ています`);
    if (s.final !== true && n && leaves(n) && transitions.length) warn(`状態「${n}」は、行き先の遷移がなく、終わりの状態でもありません (行き止まり)`);
  }
  if (initial.length === 1) {
    const reach = new Set<string>([initial[0]]);
    const queue = [initial[0]];
    while (queue.length) for (const to of out.get(queue.shift()!) ?? []) if (!reach.has(to)) { reach.add(to); queue.push(to); }
    for (const n of names) if (n && !reach.has(n)) warn(`状態「${n}」は、最初の状態からたどり着けません`);
  }
  const sc = isRecord(g.stateColumn) ? g.stateColumn : undefined;
  if (sc) {
    const t = tableById.get(str(sc.tableId));
    if (t && str(sc.columnId) && !columnMatches(t, str(sc.columnId))) warn(`状態を入れるカラム「${str(sc.columnId)}」が、テーブル「${t.name ?? t.id}」にありません`);
  }
}

function checkSeedData(g: G, warn: Warn, tableById: Map<string, DocTable>): void {
  const t = tableById.get(str(g.tableId));
  const rows = recs(g.rows);
  if (!t || !rows.length) return; // テーブルがない指摘は、参照の検査 (tableId) が出す
  const cols = t.columns ?? [];
  const keyOf = (c: (typeof cols)[number]) => (c.id ?? c.physicalName);
  const unknown = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!columnMatches(t, k)) unknown.add(k);
  for (const k of unknown) warn(`カラム「${k}」が、テーブル「${t.name ?? t.id}」にありません (初期データの行のキー)`);
  const valueOf = (r: Rec, c: (typeof cols)[number]): unknown => (c.id !== undefined && c.id in r ? r[c.id] : c.physicalName in r ? r[c.physicalName] : undefined);
  for (const c of cols) {
    const label = c.name ?? c.physicalName;
    const required = (c.notNull === true || c.primaryKey === true) && c.autoIncrement !== true && c.defaultValue === undefined;
    let missingAt = -1, nullAt = -1, typeAt = -1, lenAt = -1;
    rows.forEach((r, i) => {
      const v = valueOf(r, c);
      if (v === undefined) { if (required && missingAt < 0) missingAt = i; return; }
      if (v === null) { if ((c.notNull === true || c.primaryKey === true) && nullAt < 0) nullAt = i; return; }
      const numeric = !!c.dataType && NUMERIC.test(c.dataType);
      // 数のカラムに、真偽 (TINYINT(1) など) を入れるのは、よくある書き方なので咎めない
      if (numeric && !(typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim()))) && typeAt < 0) typeAt = i;
      // 長さは文字のカラムだけ (DECIMAL の length は桁数)
      if (!numeric && typeof v === "string" && typeof c.length === "number" && c.length > 0 && v.length > c.length && lenAt < 0) lenAt = i;
    });
    if (missingAt >= 0) warn(`${missingAt + 1} 行目に、必須のカラム「${label}」の値がありません`);
    if (nullAt >= 0) warn(`${nullAt + 1} 行目の、必須のカラム「${label}」が null です`);
    if (typeAt >= 0) warn(`${typeAt + 1} 行目の、カラム「${label}」(${c.dataType}) の値が数ではありません`);
    if (lenAt >= 0) warn(`${lenAt + 1} 行目の、カラム「${label}」の値が、長さ ${c.length} を超えています`);
  }
  // 主キーの重複 (主キーの制約があればその列、なければ primaryKey のカラム)
  const pkIds = (t.constraints ?? []).find((c) => c.kind === "primaryKey")?.columnIds;
  const pkCols = pkIds?.length ? cols.filter((c) => c.id !== undefined && pkIds.includes(c.id)) : cols.filter((c) => c.primaryKey === true);
  if (pkCols.length) {
    const seen = new Map<string, number>();
    rows.forEach((r, i) => {
      const key = JSON.stringify(pkCols.map((c) => valueOf(r, c) ?? null));
      if (pkCols.every((c) => valueOf(r, c) === undefined)) return;
      if (seen.has(key)) warn(`${i + 1} 行目は、${seen.get(key)! + 1} 行目と主キー (${pkCols.map(keyOf).join("・")}) が重複しています`);
      else seen.set(key, i);
    });
  }
}

function checkRequirement(g: G, warn: Warn, info: Warn, flowById: Map<string, DesignDocInput["flows"][number]>): void {
  const m = isRecord(g.measure) ? g.measure : undefined;
  if (m && !str(m.metric).trim()) warn("測るもの (measure.metric) が空です");
  const f = flowById.get(str(g.processFlowId));
  if (f) {
    const declared = f.meta.sla !== undefined || (f.actions ?? []).some((a) => a.sla !== undefined);
    if (!declared) info(`対象の処理フロー「${f.meta.name ?? f.meta.id}」に、SLA の宣言がありません (要件を、処理フローの SLA に写すことを検討してください)`);
  }
}

function checkJob(g: G, warn: Warn, info: Warn): void {
  const s = isRecord(g.schedule) ? g.schedule : undefined;
  if (s) {
    const kind = str(s.kind), ex = str(s.expression).trim();
    if (kind === "cron") {
      if (!cronOk(ex)) warn(`cron の式「${ex}」が、5 つの欄 (分 時 日 月 曜日。範囲は 0-59 / 0-23 / 1-31 / 1-12 / 0-7) になっていません`);
    } else if (kind === "interval") {
      if (!ISO_DURATION.test(ex)) warn(`間隔「${ex}」が、ISO 8601 の期間 (例: PT15M) になっていません`);
    } else if (kind === "event" && !ex) warn("出来事を契機にするジョブに、出来事の名前 (expression) がありません");
  }
  const r = isRecord(g.retry) ? g.retry : undefined;
  if (r && typeof r.maxAttempts === "number" && r.maxAttempts > 1 && (r.backoff === "fixed" || r.backoff === "exponential") && r.intervalSeconds === undefined) info("再実行の間隔の取り方を決めていますが、最初の間隔 (intervalSeconds) がありません");
}
