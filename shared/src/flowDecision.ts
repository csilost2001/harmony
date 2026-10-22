/**
 * 判定表: 分岐の条件を「条件の行 × 道の列」の表にする (画面の「流れ」表示・設計書で共有する。直す操作は frontend 側)。
 *
 * - 条件の式を、「かつ」でつないだ条件の並び (列) の「または」に直す (OR を列に展開する)。同じ条件は 1 つの行にまとまる
 * - 行の見方: ○ = その条件が成り立つ / × = 成り立たない (反対の条件) / － = 関係しない
 * - 道は、上から順に調べて、最初に成り立った道に進む (process-flow-runtime-conventions.md §11.5)
 * - 見落としの指摘: 先に成り立つ道のせいで選ばれない道・重なり・どの道にも入らない組み合わせ
 *
 * 画面に依存しない純関数。仕様: docs/spec/process-flow-story-view.md
 */
import type { FlowStep } from "./flowStructure.js";
import { conditionSegments, expressionSegments, hasTopLevelChar, parseVarRef, segsToText, splitTopLevel, stripOuterParens, type Seg } from "./flowWords.js";

// ─── 条件の部品 (比較) ───────────────────────────────

export type CondOp = "==" | "!=" | ">" | ">=" | "<" | "<=" | "null" | "notNull" | "true" | "false" | "notTrue" | "notFalse";

export interface Clause {
  /** `@customer.isActive` のように、先頭に @ を付けた参照 */
  subject: string;
  op: CondOp;
  /** 式としての値 (`0` `'prepaid'` `@credit.creditUsed`)。値の要らない比較では空 */
  value: string;
  /** もとの式が、厳密な比較 (`===` `!==`) だったか。触らない限り、そのまま書き戻す (意味を変えないため) */
  strict?: boolean;
}

const CMP_RE = /^(@[\w.[\]]+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/;
export const SIMPLE_VALUE_RE = /^(@[\w.[\]]+|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(\.\d+)?|null|true|false)$/;

export function parseClause(raw: string): Clause | null {
  const c = raw.trim();
  if (c.startsWith("(") && c.endsWith(")")) return null; // 括弧つきは、部品にしない
  const m = c.match(CMP_RE);
  if (!m) return null;
  const [, subject, opRaw, rightRaw] = m;
  const right = rightRaw.trim();
  if (!parseVarRef(subject) || !SIMPLE_VALUE_RE.test(right)) return null;
  const strict = opRaw === "===" || opRaw === "!==";
  const eq = opRaw === "==" || opRaw === "===";
  const ne = opRaw === "!=" || opRaw === "!==";
  const withStrict = (cl: Clause): Clause => (strict ? { ...cl, strict: true } : cl);
  // `== null` と `!= null` は、undefined も含む (緩い比較)。厳密な `=== null` は、strict を保って書き戻す
  if (right === "null" && (eq || ne)) return withStrict({ subject, op: eq ? "null" : "notNull", value: "" });
  if ((right === "true" || right === "false") && (eq || ne)) {
    const isTrue = right === "true";
    if (eq) return withStrict({ subject, op: isTrue ? "true" : "false", value: "" });
    return withStrict({ subject, op: isTrue ? "notTrue" : "notFalse", value: "" });
  }
  const op = strict ? (opRaw === "===" ? "==" : "!=") : (opRaw as CondOp);
  return withStrict({ subject, op, value: right });
}

export function composeClause(c: Clause): string {
  const e = c.strict ? "===" : "==";
  const n = c.strict ? "!==" : "!=";
  switch (c.op) {
    case "null": return `${c.subject} ${e} null`;
    case "notNull": return `${c.subject} ${n} null`;
    case "true": return `${c.subject} ${e} true`;
    case "false": return `${c.subject} ${e} false`;
    case "notTrue": return `${c.subject} ${n} true`;
    case "notFalse": return `${c.subject} ${n} false`;
    case "==": return `${c.subject} ${e} ${c.value}`;
    case "!=": return `${c.subject} ${n} ${c.value}`;
    default: return `${c.subject} ${c.op} ${c.value}`;
  }
}


// ─── 条件の部品 ────────────────────────────────────────

/** 1 つの条件。部品にできる比較 (clause)、または式のまま (raw)。neg は raw の否定 (`!@x`) */
export interface DtAtom {
  clause: Clause | null;
  raw: string;
  neg: boolean;
}
/** 「かつ」でつないだ条件の並び (表の 1 列) */
export type DtAlt = DtAtom[];

export const COMPLEMENT: Record<CondOp, CondOp> = {
  "==": "!=", "!=": "==", ">": "<=", "<=": ">", "<": ">=", ">=": "<",
  null: "notNull", notNull: "null", true: "notTrue", notTrue: "true", false: "notFalse", notFalse: "false",
};

/** 反対の関係にある 2 つの比べ方を、同じ行にまとめるための名前 */
function family(op: CondOp): string {
  return [op, COMPLEMENT[op]].sort().join("~");
}

const NEGATABLE_RAW = /^(@[\w.[\]]+|[\w.]+\([^()]*\))$/;

/** 行の見分け (同じ条件と、その反対は、同じ行) */
export function atomKey(a: DtAtom): string {
  // 厳密な比較 (===) と緩い比較 (==) は、別の行 (null / undefined の扱いが違う)
  if (a.clause) return `c|${a.clause.subject}|${family(a.clause.op)}|${a.clause.value.trim()}|${a.clause.strict ? "s" : "l"}`;
  return `r|${a.raw.replace(/\s+/g, "")}`;
}

export function atomOf(text: string): DtAtom {
  const t = stripOuterParens(text);
  const clause = parseClause(t);
  if (clause) return { clause, raw: t, neg: false };
  const neg = t.match(/^!\s*(.+)$/);
  if (neg && NEGATABLE_RAW.test(neg[1].trim())) return { clause: null, raw: neg[1].trim(), neg: true };
  return { clause: null, raw: t, neg: false };
}

const MAX_COLUMNS = 16;

function cross(a: DtAlt[], b: DtAlt[]): DtAlt[] {
  const out: DtAlt[] = [];
  for (const x of a) for (const y of b) out.push([...x, ...y]);
  return out;
}

function dnf(expr: string): DtAlt[] | null {
  const s = stripOuterParens(expr);
  if (!s) return null;
  if (hasTopLevelChar(s, "?")) return null;
  const or = splitTopLevel(s, "||");
  if (or) {
    const out: DtAlt[] = [];
    for (const p of or) {
      const sub = dnf(p);
      if (!sub) return null;
      out.push(...sub);
      if (out.length > MAX_COLUMNS) return null;
    }
    return out;
  }
  let acc: DtAlt[] = [[]];
  for (const f of splitTopLevel(s, "&&") ?? [s]) {
    const fs = stripOuterParens(f);
    if (!fs) return null;
    const grouped = splitTopLevel(fs, "||") || splitTopLevel(fs, "&&");
    const opts = grouped ? dnf(fs) : [[atomOf(fs)]];
    if (!opts) return null;
    acc = cross(acc, opts);
    if (acc.length > MAX_COLUMNS) return null;
  }
  return acc;
}

/** 条件の式 → 「または」でつないだ列 (各列は「かつ」の並び)。空の式は空配列。表にできない式 (三項・多すぎる列) は null。同じ条件の重なりは 1 つにする */
export function parseDnf(expr: string): DtAlt[] | null {
  const e = expr.trim();
  if (!e) return [];
  const alts = dnf(e);
  if (!alts) return null;
  return alts.map((alt) => {
    const seen = new Set<string>();
    return alt.filter((a) => {
      const k = `${atomKey(a)}|${a.clause?.op ?? (a.neg ? "!" : "")}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  });
}

function atomText(a: DtAtom): string {
  if (a.clause) return composeClause(a.clause);
  return a.neg ? `!${a.raw}` : a.raw;
}

/** 列 → 式。条件のない列は、捨てる (「いつでも成り立つ」になってしまうため) */
export function composeDnf(alts: readonly DtAlt[]): string {
  return alts.filter((alt) => alt.length > 0).map((alt) => alt.map(atomText).join(" && ")).join(" || ");
}

// ─── 表 ────────────────────────────────────────────────

export type DtCell = "yes" | "no" | "any";

/** 表の行 (条件)。clause があれば部品、なければ式のまま */
export interface DtRowSpec {
  key: string;
  clause: Clause | null;
  /** 部品にできない条件の、式 (clause があれば空) */
  raw: string;
  /** × にできるか (反対の条件が作れるか) */
  negatable: boolean;
}

export interface DtRow extends DtRowSpec {
  /** 成り立つときの読み */
  segs: Seg[];
  /** 成り立たないとき (×) の読み。反対の条件が作れないときは空 */
  negSegs: Seg[];
}

export interface DtColumn {
  /** 腕の id。「それ以外」は null */
  armId: string | null;
  code: string;
  label: string;
  isElse: boolean;
  /** 「それ以外」だが、道が無く、次の工程へ進むだけのもの (ガード) */
  implicit: boolean;
  /** 同じ道の、何列目か (「または」で複数列になる) と、その道の列の数 */
  altIndex: number;
  altCount: number;
  cells: DtCell[];
  /** 表にできない条件 (エラーを捕まえる道・件数 0 件・式が複雑すぎる) の読み。直せない */
  unparsed?: string;
  /** 条件が空 */
  empty: boolean;
  /** 同じ条件が、成り立つとも成り立たないとも書かれている (どの場合も選ばれない) */
  contradictory: boolean;
  steps: FlowStep[];
}

export interface DtIssue {
  level: "warn" | "info";
  text: string;
}

export interface DecisionModel {
  ownerId: string;
  rows: DtRow[];
  columns: DtColumn[];
  issues: DtIssue[];
  /** 表で調べられたか (表にできない道があると false) */
  complete: boolean;
}

export function rowFromAtom(a: DtAtom): DtRowSpec {
  return { key: atomKey(a), clause: a.clause, raw: a.clause ? "" : a.raw, negatable: a.clause ? true : NEGATABLE_RAW.test(a.raw) };
}

/** 行の条件を、○ (neg=false) または × (neg=true) の条件の部品にする。× にできなければ null */
export function atomFromRow(row: DtRowSpec, neg: boolean): DtAtom | null {
  if (row.clause) return { clause: neg ? { ...row.clause, op: COMPLEMENT[row.clause.op] } : row.clause, raw: "", neg: false };
  if (neg && !row.negatable) return null;
  return { clause: null, raw: row.raw, neg };
}

/** 画面で見せていた行の向き (「ある」か「ない」か) を保つ。マスを × にして、その行の唯一の条件が反対の形に変わっても、行が反転して見えないように */
function withPreferred(spec: DtRowSpec, preferred: ReadonlyMap<string, CondOp> | undefined): DtRowSpec {
  const want = preferred?.get(spec.key);
  if (!want || !spec.clause || spec.clause.op === want || COMPLEMENT[spec.clause.op] !== want) return spec;
  return { ...spec, clause: { ...spec.clause, op: want } };
}

function rowView(spec: DtRowSpec): DtRow {
  if (spec.clause) {
    return { ...spec, segs: expressionSegments(composeClause(spec.clause)), negSegs: expressionSegments(composeClause({ ...spec.clause, op: COMPLEMENT[spec.clause.op] })) };
  }
  return { ...spec, segs: expressionSegments(spec.raw), negSegs: spec.negatable ? expressionSegments(`!${spec.raw}`) : [] };
}

const exprOf = (cond: unknown): string | null => {
  const c = cond as { kind?: string; expression?: unknown } | undefined;
  if (c && c.kind !== undefined && c.kind !== "expression") return null;
  return typeof c?.expression === "string" ? c.expression : "";
};

const NUM_RE = /^-?\d+(\.\d+)?$/;

/** 比べる値の書き方をそろえる: 引用符を外す・数は、書き方によらず同じ文字にする */
function normalizeLiteral(v: string): string {
  const m = v.match(/^'((?:[^'\\]|\\.)*)'$|^"((?:[^"\\]|\\.)*)"$/);
  const t = m ? (m[1] ?? m[2] ?? "") : v;
  return NUM_RE.test(t.trim()) ? String(Number(t.trim())) : t;
}

/**
 * 条件の組み合わせ (行ごとの ○ × －) が、実際に起こりうるか。同じ項目についての、次の食い違いを見つける:
 * 別々の値と等しい・数の範囲が重ならない (`x > 100` かつ `x <= 50`)・「ない」と値の比べ・「はい」と「いいえ」。
 * 見つからなければ true (見つけられない食い違いは、起こりうるとして数える)
 */
export function feasible(rows: readonly DtRowSpec[], states: readonly DtCell[]): boolean {
  const bySubject = new Map<string, Array<{ op: CondOp; value: string }>>();
  rows.forEach((r, i) => {
    const st = states[i];
    if (st === "any" || !r.clause) return;
    const op = st === "yes" ? r.clause.op : COMPLEMENT[r.clause.op];
    bySubject.set(r.clause.subject, [...(bySubject.get(r.clause.subject) ?? []), { op, value: r.clause.value.trim() }]);
  });
  for (const list of bySubject.values()) {
    let lo = -Infinity, hi = Infinity, loStrict = false, hiStrict = false;
    const eq = new Set<string>();
    const ne = new Set<string>();
    let isNull = false, isTrue = false, isFalse = false;
    for (const { op, value: raw } of list) {
      // 比べる値が変数 (@…) のものは、中身が分からないので、食い違いの判定に使わない。引用符は外し、数は数として比べる (1 と '1' と 1.0 は同じ)
      if (raw.startsWith("@")) continue;
      const value = normalizeLiteral(raw);
      const n = NUM_RE.test(value) ? Number(value) : null;
      if (op === "==") eq.add(value);
      else if (op === "!=") ne.add(value);
      else if (op === "null") isNull = true;
      else if (op === "true") isTrue = true;
      else if (op === "false") isFalse = true;
      else if (n !== null && (op === ">" || op === ">=")) { if (n > lo) { lo = n; loStrict = op === ">"; } else if (n === lo && op === ">") loStrict = true; }
      else if (n !== null && (op === "<" || op === "<=")) { if (n < hi) { hi = n; hiStrict = op === "<"; } else if (n === hi && op === "<") hiStrict = true; }
    }
    if (eq.size > 1) return false;
    for (const e of eq) {
      if (ne.has(e)) return false;
      if (NUM_RE.test(e)) { const n = Number(e); if (n < lo || (n === lo && loStrict) || n > hi || (n === hi && hiStrict)) return false; }
    }
    if (lo > hi || (lo === hi && (loStrict || hiStrict))) return false;
    // 「ない」と、値との一致・「はい」「いいえ」は、同時には起こらない (数の大小は、null の扱いが言語で違うので、見ない)
    if (isNull && (eq.size > 0 || isTrue || isFalse)) return false;
    if (isTrue && isFalse) return false;
  }
  return true;
}

/** 2 つの列の条件を重ねる。同じ行で ○ と × が食い違えば null */
function overlay(a: readonly DtCell[], b: readonly DtCell[]): DtCell[] | null {
  const out: DtCell[] = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== "any" && b[i] !== "any" && a[i] !== b[i]) return null;
    out.push(a[i] !== "any" ? a[i] : b[i]);
  }
  return out;
}

/** 2 つの列が、同時に成り立つことが無いか */
function exclusive(rows: readonly DtRowSpec[], a: readonly DtCell[], b: readonly DtCell[]): boolean {
  const o = overlay(a, b);
  return o === null || !feasible(rows, o);
}

/** 列 a が成り立つなら、必ず列 b も成り立つか (b の条件が、a の条件の一部) */
function implies(a: readonly DtCell[], b: readonly DtCell[]): boolean {
  return b.every((cb, i) => cb === "any" || a[i] === cb);
}


/**
 * 分岐の工程から、判定表を作る。分岐でなければ null。
 * 道の条件が式でない・表にできないときは、その道の列は「表にできない」として出す (直せない)。
 * implicitElse: 「それ以外」の道が無いガードで、「次の工程へ進む」列を、表の最後に足す。
 */
export function buildDecisionModel(step: FlowStep, opts: { implicitElse?: boolean; label?: (name: string, path: string[]) => string; preferred?: ReadonlyMap<string, CondOp> } = {}): DecisionModel | null {
  if (step.kind !== "branch") return null;
  const sx = step as Record<string, unknown>;
  const rawArms = Array.isArray(sx.branches) ? (sx.branches as Array<Record<string, unknown>>) : [];
  const arms = rawArms.map((b, i) => ({
    key: `arm:${String(b.id || i)}`, label: typeof b.label === "string" ? b.label : "", condition: b.condition,
    code: typeof b.code === "string" && b.code ? b.code : String.fromCharCode(65 + i), steps: (Array.isArray(b.steps) ? b.steps : []) as FlowStep[],
  }));
  const eb = sx.elseBranch as Record<string, unknown> | undefined;
  const elseGroup = eb ? { label: typeof eb.label === "string" ? eb.label : "", code: typeof eb.code === "string" && eb.code ? eb.code : "X", steps: (Array.isArray(eb.steps) ? eb.steps : []) as FlowStep[] } : undefined;

  const rowMap = new Map<string, DtRowSpec>();
  const columns: DtColumn[] = [];
  const colAtoms: Array<DtAtom[] | null> = [];
  let complete = true;

  for (const g of arms) {
    const armId = g.key.slice(4);
    const expr = exprOf(g.condition);
    const alts = expr === null ? null : parseDnf(expr);
    if (alts === null) {
      complete = false;
      const text = expr === null ? segsToText(conditionSegments(g.condition)) : segsToText(expressionSegments(expr));
      columns.push({ armId, code: g.code ?? "", label: g.label, isElse: false, implicit: false, altIndex: 0, altCount: 1, cells: [], unparsed: text || "（条件が読めません）", empty: false, contradictory: false, steps: g.steps });
      colAtoms.push(null);
      continue;
    }
    if (alts.length === 0) {
      columns.push({ armId, code: g.code ?? "", label: g.label, isElse: false, implicit: false, altIndex: 0, altCount: 1, cells: [], empty: true, contradictory: false, steps: g.steps });
      colAtoms.push([]);
      continue;
    }
    alts.forEach((alt, k) => {
      for (const a of alt) { const key = atomKey(a); if (!rowMap.has(key)) rowMap.set(key, withPreferred(rowFromAtom(a), opts.preferred)); }
      columns.push({ armId, code: g.code ?? "", label: g.label, isElse: false, implicit: false, altIndex: k, altCount: alts.length, cells: [], empty: alt.length === 0, contradictory: false, steps: g.steps });
      colAtoms.push(alt);
    });
  }
  if (elseGroup) {
    columns.push({ armId: null, code: elseGroup.code ?? "X", label: elseGroup.label, isElse: true, implicit: false, altIndex: 0, altCount: 1, cells: [], empty: false, contradictory: false, steps: elseGroup.steps });
    colAtoms.push([]);
  } else if (opts.implicitElse) {
    columns.push({ armId: null, code: "", label: "", isElse: true, implicit: true, altIndex: 0, altCount: 1, cells: [], empty: false, contradictory: false, steps: [] });
    colAtoms.push([]);
  }

  const specs = [...rowMap.values()];
  const index = new Map(specs.map((r, i) => [r.key, i]));
  columns.forEach((col, ci) => {
    col.cells = specs.map(() => "any" as DtCell);
    const atoms = colAtoms[ci];
    if (!atoms) return;
    for (const a of atoms) {
      const i = index.get(atomKey(a))!;
      const row = specs[i];
      const cell: DtCell = a.clause ? (a.clause.op === row.clause!.op ? "yes" : "no") : a.neg ? "no" : "yes";
      if (col.cells[i] !== "any" && col.cells[i] !== cell) col.contradictory = true;
      else col.cells[i] = cell;
    }
  });

  // 同じ列の中で、起こりえない組み合わせ (x == 1 かつ x == 2 など) は、どの場合も選ばれない
  for (const col of columns) if (!col.unparsed && !feasible(specs, col.cells)) col.contradictory = true;

  const model: DecisionModel = { ownerId: step.id, rows: specs.map(rowView), columns, issues: [], complete };
  model.issues = analyze(model, specs, Boolean(elseGroup), Boolean(opts.implicitElse), opts.label);
  return model;
}

/** 道の名前 (「道 B」「B（取引先がない）」) */
export function decisionColumnName(c: DtColumn): string {
  if (c.isElse) return c.implicit ? "それ以外" : `それ以外 (${c.code})`;
  const base = c.code ? `道 ${c.code}` : "道";
  return c.altCount > 1 ? `${base} の ${c.altIndex + 1} つ目` : base;
}

function analyze(model: DecisionModel, specs: readonly DtRowSpec[], hasElse: boolean, guard: boolean, label?: (name: string, path: string[]) => string): DtIssue[] {
  const wordsOf = (segs: readonly Seg[]) => segsToText(segs, label);
  const issues: DtIssue[] = [];
  const cols = model.columns;
  for (const c of cols) {
    if (c.empty && !c.isElse) issues.push({ level: "warn", text: `${decisionColumnName(c)} の条件が空です (この道には、どんなときも入りません)` });
    if (c.contradictory) issues.push({ level: "warn", text: `${decisionColumnName(c)} は、条件が食い違っていて (同じ条件が「成り立つ」と「成り立たない」の両方・別々の値と等しい・数の範囲が重ならない など)、どんなときも入りません` });
  }
  const real = cols.filter((c) => !c.isElse && !c.unparsed && !c.empty && !c.contradictory);
  // 先に調べる道のせいで、選ばれない列 / 同時に成り立ちうる列
  const overlaps: string[] = [];
  real.forEach((cj, j) => {
    for (let i = 0; i < j; i++) {
      const ci = real[i];
      if (ci.armId === cj.armId) continue;
      if (implies(cj.cells, ci.cells)) {
        issues.push({ level: "warn", text: `${decisionColumnName(cj)} は、${decisionColumnName(ci)} が成り立つときに必ず先に選ばれるので、${ci.cells.every((x) => x === "any") ? "" : "その条件を含む場合は、"}実行されません (上の道が優先)` });
        return;
      }
    }
    for (let i = 0; i < j; i++) {
      const ci = real[i];
      if (ci.armId === cj.armId || exclusive(specs, ci.cells, cj.cells)) continue;
      overlaps.push(`${decisionColumnName(ci)} と ${decisionColumnName(cj)}`);
      break;
    }
  });
  if (overlaps.length > 0) issues.push({ level: "info", text: `同時に成り立つ場合がある道: ${overlaps.join(" / ")}。その場合は上の道が選ばれます` });

  if (!model.complete) {
    issues.push({ level: "info", text: "表にできない条件の道があるので、抜けの調べは、表にできる道だけです" });
  }
  // どの道にも入らない組み合わせ (「それ以外」が無い判定のとき)
  if (!hasElse && !guard && !cols.some((c) => c.unparsed) && specs.length > 0 && specs.length <= 8 && real.length > 0) {
    const gaps: string[] = [];
    const total = 1 << specs.length;
    for (let m = 0; m < total && gaps.length < 3; m++) {
      const a: DtCell[] = specs.map((_, i) => (m & (1 << i) ? "yes" : "no"));
      // 起こらない組み合わせ (同じ項目が別々の値と等しい・数の範囲が重ならない など) は、抜けに出さない
      if (!feasible(specs, a)) continue;
      if (real.some((c) => c.cells.every((cc, i) => cc === "any" || cc === a[i]))) continue;
      gaps.push(specs.map((_, i) => `${wordsOf((a[i] === "yes" ? model.rows[i].segs : model.rows[i].negSegs.length ? model.rows[i].negSegs : model.rows[i].segs))}${a[i] === "no" && model.rows[i].negSegs.length === 0 ? " ではない" : ""}`).join("、かつ "));
    }
    if (gaps.length > 0) issues.push({ level: "warn", text: `「それ以外」の道が無く、次の場合は、どの道にも入りません (何もせず次へ進みます): ${gaps.join(" / ")}` });
    else issues.push({ level: "info", text: "条件の組み合わせは、すべてどれかの道に入ります (値が空・未設定のときは、調べていません)" });
  } else if (!hasElse && !guard && specs.length > 8) {
    issues.push({ level: "info", text: "条件が 8 個を超えるので、抜けの調べは行っていません" });
  }
  return issues;
}

/**
 * この行を消すと、条件が空になってしまう列がある道 (消すと、その道には、どんなときも入らなくなる。「または」の道の 1 列だけが空になる場合も、道が狭くなる)。
 * 道の記号の一覧を返す
 */
export function armsEmptiedByRemoving(model: DecisionModel, rowIndex: number): string[] {
  const out = new Set<string>();
  for (const c of model.columns) {
    if (!c.armId || c.unparsed || c.cells[rowIndex] === undefined || c.cells[rowIndex] === "any") continue;
    if (c.cells.every((x, i) => i === rowIndex || x === "any")) out.add(c.code);
  }
  return [...out];
}

/** 「〜なら、ここで返す」だけの判定か (道が 1 本で、その中が「返す」1 つ。「それ以外」は無いか、空)。「それ以外」は、次の工程へ進む */
export function isGuardLike(step: FlowStep): boolean {
  if (step.kind !== "branch") return false;
  const x = step as Record<string, unknown>;
  const arms = Array.isArray(x.branches) ? (x.branches as Array<{ steps?: FlowStep[] }>) : [];
  const els = x.elseBranch as { steps?: unknown[] } | undefined;
  if (arms.length !== 1) return false;
  if (els && Array.isArray(els.steps) && els.steps.length > 0) return false;
  const inner = Array.isArray(arms[0].steps) ? arms[0].steps : [];
  return inner.length === 1 && inner[0].kind === "return";
}
