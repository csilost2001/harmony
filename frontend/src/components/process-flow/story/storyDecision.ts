/**
 * 判定表 (処理フローの「流れ」表示): 分岐の条件を「条件の行 × 道の列」の表にして、見る・直す。
 *
 * - 条件の式を、「かつ」でつないだ条件の並び (列) の「または」に直す (OR を列に展開する)。同じ条件は 1 つの行にまとまる
 * - 行の見方: ○ = その条件が成り立つ / × = 成り立たない (反対の条件) / － = 関係しない
 * - 道は、上から順に調べて、最初に成り立った道に進む。「それ以外」は、どれにも当てはまらないとき
 * - 見落としの指摘: 先に成り立つ道のせいで選ばれない道・重なり・どの道にも入らない組み合わせ
 * - 表のマスを直すと、その道の条件の式を組み立て直す。触らない道の式は、そのまま
 *
 * 画面に依存しない純関数。仕様: docs/spec/process-flow-story-view.md
 */
import type { Step } from "../../../types/v3";
import { findStepDeep } from "../../../utils/stepTree";
import { composeClause, parseClause, type Clause, type CondOp } from "./conditionBuilder";
import { expressionSegments, hasTopLevelChar, segsToText, splitTopLevel, stripOuterParens, type Seg } from "./expressionText";
import { setArmCondition } from "./storyEdit";
import { childGroups, conditionSegments, type Loose } from "./storyModel";

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
  if (a.clause) return `c|${a.clause.subject}|${family(a.clause.op)}|${a.clause.value.trim()}`;
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
  steps: Loose[];
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

/** 2 つの列が、同時に成り立つことが無いか (反対の条件、または、同じ値の項目が別の値と等しい) */
function exclusive(rows: readonly DtRowSpec[], a: readonly DtCell[], b: readonly DtCell[]): boolean {
  for (let i = 0; i < rows.length; i++) if ((a[i] === "yes" && b[i] === "no") || (a[i] === "no" && b[i] === "yes")) return true;
  return mutuallyExclusiveValues(rows, a, b);
}

/** `x == 1` と `x == 2` のように、同じ値の項目が、別々の値と等しいという条件は、同時に成り立たない */
function mutuallyExclusiveValues(rows: readonly DtRowSpec[], a: readonly DtCell[], b: readonly DtCell[]): boolean {
  const eq = (i: number) => rows[i].clause && rows[i].clause!.op === "==" ? rows[i].clause! : null;
  for (let i = 0; i < rows.length; i++) {
    const ci = eq(i);
    if (!ci) continue;
    for (let j = 0; j < rows.length; j++) {
      const cj = eq(j);
      if (!cj || i === j || ci.subject !== cj.subject || ci.value.trim() === cj.value.trim()) continue;
      if (a[i] === "yes" && b[j] === "yes") return true;
    }
  }
  return false;
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
export function buildDecisionModel(step: Loose, opts: { implicitElse?: boolean; label?: (name: string, path: string[]) => string } = {}): DecisionModel | null {
  if (step.kind !== "branch") return null;
  const groups = childGroups(step);
  const arms = groups.filter((g) => g.role === "arm");
  const elseGroup = groups.find((g) => g.role === "else");

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
      const text = expr === null ? segsToText(conditionSegments(g.condition)) : `${segsToText(expressionSegments(expr))}`;
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
      for (const a of alt) { const key = atomKey(a); if (!rowMap.has(key)) rowMap.set(key, rowFromAtom(a)); }
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

  const model: DecisionModel = { ownerId: step.id, rows: specs.map(rowView), columns, issues: [], complete };
  model.issues = analyze(model, specs, Boolean(elseGroup), Boolean(opts.implicitElse), opts.label);
  return model;
}

/** 道の名前 (「道 B」「B（取引先がない）」) */
export function columnName(c: DtColumn): string {
  if (c.isElse) return c.implicit ? "それ以外" : `それ以外 (${c.code})`;
  const base = c.code ? `道 ${c.code}` : "道";
  return c.altCount > 1 ? `${base} の ${c.altIndex + 1} つ目` : base;
}

function analyze(model: DecisionModel, specs: readonly DtRowSpec[], hasElse: boolean, guard: boolean, label?: (name: string, path: string[]) => string): DtIssue[] {
  const wordsOf = (segs: readonly Seg[]) => segsToText(segs, label);
  const issues: DtIssue[] = [];
  const cols = model.columns;
  for (const c of cols) {
    if (c.empty && !c.isElse) issues.push({ level: "warn", text: `${columnName(c)} の条件が空です (この道には、どんなときも入りません)` });
    if (c.contradictory) issues.push({ level: "warn", text: `${columnName(c)} は、同じ条件が「成り立つ」と「成り立たない」の両方になっていて、どんなときも入りません` });
  }
  const real = cols.filter((c) => !c.isElse && !c.unparsed && !c.empty && !c.contradictory);
  // 先に調べる道のせいで、選ばれない列 / 同時に成り立ちうる列
  const overlaps: string[] = [];
  real.forEach((cj, j) => {
    for (let i = 0; i < j; i++) {
      const ci = real[i];
      if (ci.armId === cj.armId) continue;
      if (implies(cj.cells, ci.cells)) {
        issues.push({ level: "warn", text: `${columnName(cj)} は、${columnName(ci)} が成り立つときに必ず先に選ばれるので、${ci.cells.every((x) => x === "any") ? "" : "その条件を含む場合は、"}実行されません (上の道が優先)` });
        return;
      }
    }
    for (let i = 0; i < j; i++) {
      const ci = real[i];
      if (ci.armId === cj.armId || exclusive(specs, ci.cells, cj.cells)) continue;
      overlaps.push(`${columnName(ci)} と ${columnName(cj)}`);
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
      // 同じ項目が、複数の値と同時に等しい組み合わせは、起こらない
      if (selfContradictory(specs, a)) continue;
      if (real.some((c) => c.cells.every((cc, i) => cc === "any" || cc === a[i]))) continue;
      gaps.push(specs.map((_, i) => `${wordsOf((a[i] === "yes" ? model.rows[i].segs : model.rows[i].negSegs.length ? model.rows[i].negSegs : model.rows[i].segs))}${a[i] === "no" && model.rows[i].negSegs.length === 0 ? " ではない" : ""}`).join("、かつ "));
    }
    if (gaps.length > 0) issues.push({ level: "warn", text: `「それ以外」の道が無く、次の場合は、どの道にも入りません (何もせず次へ進みます): ${gaps.join(" / ")}` });
    else issues.push({ level: "info", text: "条件の組み合わせは、すべてどれかの道に入ります" });
  } else if (!hasElse && !guard && specs.length > 8) {
    issues.push({ level: "info", text: "条件が 8 個を超えるので、抜けの調べは行っていません" });
  }
  return issues;
}

/** 同じ項目が、別々の値と同時に等しいことになる組み合わせか (実際には起こらない) */
function selfContradictory(specs: readonly DtRowSpec[], a: readonly DtCell[]): boolean {
  return mutuallyExclusiveValues(specs, a, a);
}

// ─── 直す ──────────────────────────────────────────────

/** 道の条件の式を、列に分けて、直して、式に戻す。直せない (式でない・表にできない) 道は false */
function editArm(steps: Step[], ownerId: string, armId: string, fn: (alts: DtAlt[]) => DtAlt[] | null): boolean {
  const owner = findStepDeep(steps, ownerId) as unknown as Loose | null;
  if (!owner) return false;
  const arm = (owner.branches as Array<Record<string, unknown>> | undefined)?.find((b, i) => String(b.id || i) === armId);
  if (!arm) return false;
  const expr = exprOf(arm.condition);
  if (expr === null) return false;
  const alts = parseDnf(expr);
  if (alts === null) return false;
  const next = fn(alts.map((a) => [...a]));
  if (!next) return false;
  return setArmCondition(steps, ownerId, armId, composeDnf(next));
}

/** 表のマス (行 × 道の何列目) を、○ / × / － にする。道が無い列 (altIndex が列の数と同じ) は、「または」の列を足す */
export function setDtCell(steps: Step[], ownerId: string, armId: string, altIndex: number, row: DtRowSpec, cell: DtCell): boolean {
  return editArm(steps, ownerId, armId, (alts) => {
    if (alts.length === 0) alts.push([]);
    if (altIndex > alts.length) return null;
    if (altIndex === alts.length) alts.push([]);
    const alt = alts[altIndex];
    const at = alt.findIndex((a) => atomKey(a) === row.key);
    if (cell === "any") {
      if (at >= 0) alt.splice(at, 1);
      return alts;
    }
    const atom = atomFromRow(row, cell === "no");
    if (!atom) return null;
    if (at >= 0) alt[at] = atom;
    else alt.push(atom);
    return alts;
  });
}

/** 行の条件を、別の条件に置き換える (すべての道の、その行の ○ × を引き継ぐ)。直した道の数を返す (-1: 失敗) */
export function replaceDtRow(steps: Step[], ownerId: string, oldRow: DtRowSpec, newRow: DtRowSpec): number {
  const owner = findStepDeep(steps, ownerId) as unknown as Loose | null;
  const arms = (owner?.branches as Array<Record<string, unknown>> | undefined) ?? [];
  let n = 0;
  arms.forEach((b, i) => {
    const armId = String(b.id || i);
    const ok = editArm(steps, ownerId, armId, (alts) => {
      let touched = false;
      for (const alt of alts) {
        alt.forEach((a, k) => {
          if (atomKey(a) !== oldRow.key) return;
          const neg = oldRow.clause && a.clause ? a.clause.op !== oldRow.clause.op : a.neg;
          const na = atomFromRow(newRow, neg);
          if (na) { alt[k] = na; touched = true; }
        });
        // 置き換えで、同じ行が 2 つになったら、1 つにする
        const seen = new Set<string>();
        for (let k = alt.length - 1; k >= 0; k--) { const key = atomKey(alt[k]); if (seen.has(key)) alt.splice(k, 1); else seen.add(key); }
      }
      return touched ? alts : null;
    });
    if (ok) n++;
  });
  return n;
}

/** 行を消す (すべての道から、その条件を外す)。直した道の数 */
export function removeDtRow(steps: Step[], ownerId: string, row: DtRowSpec): number {
  const owner = findStepDeep(steps, ownerId) as unknown as Loose | null;
  const arms = (owner?.branches as Array<Record<string, unknown>> | undefined) ?? [];
  let n = 0;
  arms.forEach((b, i) => {
    const ok = editArm(steps, ownerId, String(b.id || i), (alts) => {
      let touched = false;
      for (const alt of alts) for (let k = alt.length - 1; k >= 0; k--) if (atomKey(alt[k]) === row.key) { alt.splice(k, 1); touched = true; }
      return touched ? alts : null;
    });
    if (ok) n++;
  });
  return n;
}

/** この行を消すと、条件が空になってしまう道 (消すと、その道に、どんなときも入らなくなる) */
export function armsEmptiedByRemoving(model: DecisionModel, rowIndex: number): string[] {
  const out: string[] = [];
  const byArm = new Map<string, DtColumn[]>();
  for (const c of model.columns) if (c.armId && !c.unparsed) byArm.set(c.armId, [...(byArm.get(c.armId) ?? []), c]);
  for (const cols of byArm.values()) {
    const remaining = cols.filter((c) => c.cells.some((x, i) => x !== "any" && i !== rowIndex));
    if (cols.some((c) => c.cells[rowIndex] !== "any") && remaining.length === 0) out.push(cols[0].code);
  }
  return out;
}
