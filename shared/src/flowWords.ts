/**
 * 処理フローの条件を、人が読む言葉にする (画面の「流れ」表示・設計書で共有する)。
 * 式の意味は変えない (表示だけ)。仕様: docs/spec/process-flow-story-view.md
 */
import type { FlowStep } from "./flowStructure.js";

type Loose = FlowStep & Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** 入れ子の中も含め、すべての工程を順に歩く */
export function* walkAllSteps(steps: readonly FlowStep[] | undefined): Generator<FlowStep> {
  for (const s of steps ?? []) {
    yield s;
    const x = s as Record<string, unknown>;
    for (const k of ["steps", "subSteps", "onCommit", "onRollback", "onApproved", "onRejected", "onTimeout"]) if (Array.isArray(x[k])) yield* walkAllSteps(x[k] as FlowStep[]);
    if (Array.isArray(x.branches)) for (const b of x.branches as Array<{ steps?: FlowStep[] }>) yield* walkAllSteps(b?.steps);
    const eb = x.elseBranch as { steps?: FlowStep[] } | undefined;
    if (eb) yield* walkAllSteps(eb.steps);
    const ib = x.inlineBranch as { ok?: FlowStep[]; ng?: FlowStep[] } | undefined;
    if (ib) { yield* walkAllSteps(ib.ok); yield* walkAllSteps(ib.ng); }
  }
}

export type Seg =
  | { k: "text"; v: string }
  /** 変数への参照。name は先頭の名前 (`@customer.isActive` なら customer)、path はその後ろ (`isActive`) */
  | { k: "var"; name: string; path: string[]; raw: string }
  | { k: "code"; v: string };

const OPERATOR_WORDS: Record<string, string> = {
  "==": "と等しい",
  "===": "と等しい",
  "!=": "と違う",
  "!==": "と違う",
  ">": "より大きい",
  ">=": "以上",
  "<": "より小さい",
  "<=": "以下",
};

/** 引用符・括弧の外側にある演算子 (`||` `&&`) で分ける */
export function splitTopLevel(expr: string, op: "||" | "&&"): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(start, i).trim());
      i += op.length - 1;
      start = i + 1;
    }
  }
  if (parts.length === 0) return null;
  parts.push(expr.slice(start).trim());
  return parts;
}

/** 外側の括弧を 1 組だけ外す (中が 1 つのまとまりのときだけ) */
export function stripOuterParens(s: string): string {
  // 二重の括弧 ((A || B)) も、外れなくなるまで外す
  let cur = s.trim();
  for (;;) {
    const next = stripOnce(cur);
    if (next === cur) return cur;
    cur = next;
  }
}

function stripOnce(s: string): string {
  const t = s.trim();
  if (!t.startsWith("(") || !t.endsWith(")")) return t;
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0 && i < t.length - 1) return t; }
  }
  return t.slice(1, -1).trim();
}

const VAR_RE = /^@([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*)$/;

/**
 * 変数の参照の形のうち、「どの範囲の」を表す前置き。`@var.action.x` `@var.loop.x` `@var.flowParameter.x` `@var.global.x`
 * `@var.step.<工程>.x` `@var.tx.<工程>.x` は、x の変数として扱う。`@var.x` (暗黙) も x。
 */
function stripVarScope(name: string, path: string[]): { name: string; path: string[] } {
  if (name !== "var" || path.length === 0) return { name, path };
  const [scope, ...rest] = path;
  if ((scope === "action" || scope === "loop" || scope === "flowParameter" || scope === "global") && rest.length >= 1) return { name: rest[0], path: rest.slice(1) };
  if ((scope === "step" || scope === "tx") && rest.length >= 2) return { name: rest[1], path: rest.slice(2) };
  return { name: scope, path: rest };
}

/** `@a.b[0].c` → { name: "a", path: ["b", "[0]", "c"] }。変数でなければ null */
export function parseVarRef(token: string): { name: string; path: string[]; raw: string } | null {
  // `@var.step.<工程 ID>.x` の工程 ID だけは、ハイフンを含み得る (ほかの名前に、ハイフンは含めない: `@x.n-1` は減算)
  const normalized = token.trim().replace(/^(@var\.(?:step|tx)\.)([\w-]+)/, (_m, a: string, b: string) => a + b.replace(/-/g, "_"));
  const m = normalized.match(VAR_RE);
  if (!m) return null;
  const path = (m[2].match(/\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) ?? []).map((p) => (p.startsWith(".") ? p.slice(1) : p));
  return { ...stripVarScope(m[1], path), raw: token.trim() };
}

function operandSegs(token: string): Seg[] {
  const t = stripOuterParens(token);
  const v = parseVarRef(t);
  if (v) return [{ k: "var", ...v }];
  const s = t.match(/^(['"])(.*)\1$/);
  if (s) return [{ k: "text", v: `「${s[2]}」` }];
  if (/^-?\d+(\.\d+)?$/.test(t)) return [{ k: "text", v: t }];
  return [{ k: "code", v: t }];
}

const CMP_RE = /^(.+?)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/;

function clauseSegs(clause: string): Seg[] {
  const c = stripOuterParens(clause);
  const m = c.match(CMP_RE);
  if (!m) {
    // `!@x` → x が ない / `@x` だけ → x が「はい」
    // 変数だけの式 (`@x` `!@x`) は、真偽値とは限らない (件数・値の有無・0 かどうか) ので、言葉にせず、そのまま式で出す
    return [{ k: "code", v: c }];
  }
  const [, left, op, right] = m;
  // 左右どちらかに、演算子や関数呼び出しが残っていたら、読めない: そのまま式
  const simple = (x: string) => /^(@[\w.[\]]+|'[^']*'|"[^"]*"|-?\d+(\.\d+)?|null|true|false)$/.test(stripOuterParens(x));
  if (!simple(left) || !simple(right)) return [{ k: "code", v: c }];
  const r = stripOuterParens(right);
  const eq = op === "==" || op === "===";
  const ne = op === "!=" || op === "!==";
  if (r === "null" && (eq || ne)) return [...operandSegs(left), { k: "text", v: eq ? " が ない" : " が ある" }];
  if ((r === "true" || r === "false") && (eq || ne)) {
    const yes = (r === "true") === eq;
    return [...operandSegs(left), { k: "text", v: yes ? " が「はい」" : " が「いいえ」" }];
  }
  return [...operandSegs(left), { k: "text", v: " が " }, ...operandSegs(right), { k: "text", v: ` ${OPERATOR_WORDS[op]}` }];
}

/** 式 → 表示の部品。空の式は空配列 */
export function expressionSegments(expr: string | undefined): Seg[] {
  const e = (expr ?? "").trim();
  if (!e) return [];
  // 三項演算子・`??` が外側にある式は、読み方が変わるので、言葉にしない
  if (hasTopLevelChar(e, "?")) return [{ k: "code", v: e }];
  return segsOf(e);
}

function segsOf(expr: string): Seg[] {
  const stripped = stripOuterParens(expr);
  // 括弧の中の三項演算子 (`(@x ? A : B)`) も、途中で切れて別々の断片に読まれないよう、式のまま出す
  if (hasTopLevelChar(stripped, "?")) return [{ k: "code", v: stripped }];
  const or = splitTopLevel(stripped, "||");
  if (or) return joinSegs(or.map((p) => segsOf(p)), " または ");
  const and = splitTopLevel(stripped, "&&");
  if (and) {
    // 「かつ」の項に「または」が入るときは、括弧で、まとまりを残す (A かつ (B または C))
    return joinSegs(and.map((p) => {
      const inner = stripOuterParens(p);
      const sub = segsOf(inner);
      return splitTopLevel(inner, "||") ? [{ k: "text", v: "（" } as Seg, ...sub, { k: "text", v: "）" } as Seg] : sub;
    }), " かつ ");
  }
  return clauseSegs(stripped);
}

/** 引用符・括弧の外側にある、指定の文字があるか */
export function hasTopLevelChar(expr: string, ch: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && c === ch) return true;
  }
  return false;
}

function joinSegs(groups: Seg[][], sep: string): Seg[] {
  const out: Seg[] = [];
  groups.forEach((g, i) => {
    if (i > 0) out.push({ k: "text", v: sep });
    out.push(...g);
  });
  return out;
}

/** 部品を、1 本の文字列にする (出口の道すじ・検索・テスト用)。変数の名前は label で言い換える */
export function segsToText(segs: readonly Seg[], label: (name: string, path: string[]) => string = (n, p) => [n, ...p].join(".")): string {
  return segs.map((s) => (s.k === "text" ? s.v : s.k === "code" ? s.v : label(s.name, s.path))).join("");
}

// ─── 変数の名前と呼び名 ────────────────────────────────

export interface VarLabels {
  /** 先頭の名前 → 呼び名 */
  base: (name: string) => string;
  /** `@name.path` の全体の呼び名 */
  full: (name: string, path: string[]) => string;
  /** この処理の中で作られる変数か (結果変数・繰り返しの 1 行・入力エラー・捕まえたエラー)。規約・セッションの値などは false */
  isDefined: (name: string) => boolean;
}

const PROP_LABELS: Record<string, string> = {
  length: "長さ(件数)",
  code: "コード",
  message: "メッセージ",
  id: "ID",
};
/** トランザクションの結果 (`txResult`) だけが持つ項目 */
const TX_PROP_LABELS: Record<string, string> = {
  committed: "確定したか",
  error: "エラー",
  diagnostics: "実行の記録",
};

export function buildVarLabels(action: { inputs?: ReadonlyArray<{ name: string; label?: string }>; steps?: readonly object[] }): VarLabels {
  const labels = new Map<string, string>();
  const txNames = new Set<string>();
  const defined = new Set<string>();
  const inputLabels = new Map<string, string>();
  for (const i of action.inputs ?? []) if (i.label) inputLabels.set(i.name, i.label);
  for (const s0 of walkAllSteps(action.steps as readonly FlowStep[] | undefined)) {
    const s = s0 as Loose;
    const ob = rec(s.outputBinding);
    if (str(ob.name)) {
      defined.add(str(ob.name));
      if (str(ob.label)) labels.set(str(ob.name), str(ob.label));
      if (s.kind === "transactionScope") txNames.add(str(ob.name));
    }
    if (s.kind === "loop") {
      for (const n of [str(s.collectionItemName), str(s.collectionIndexName)]) if (n) defined.add(n);
      if (str(s.collectionItemName) && str(s.collectionItemLabel)) labels.set(str(s.collectionItemName), str(s.collectionItemLabel));
    }
    if (s.kind === "validation" && str(s.fieldErrorsVar)) defined.add(str(s.fieldErrorsVar));
    if (s.kind === "branch") for (const b of (Array.isArray(s.branches) ? (s.branches as Array<Record<string, unknown>>) : [])) { const c = rec(b.condition); if (c.kind === "tryCatch" && str(c.errorVar)) defined.add(str(c.errorVar)); }
  }
  const base = (name: string) => (name === "inputs" ? "入力" : labels.get(name) ?? name);
  const prop = (name: string, p: string) => (txNames.has(name) ? TX_PROP_LABELS[p] : undefined) ?? PROP_LABELS[p] ?? p;
  return {
    base,
    isDefined: (name) => defined.has(name),
    full: (name, path) => {
      // この処理の中で作られない値 (規約・セッション・環境など) は、書かれた名前のまま
      if (name !== "inputs" && !defined.has(name)) return [name, ...path].join(".");
      if (path.length === 0) return base(name);
      if (name === "inputs" && !path[0].startsWith("[")) {
        const rest = path.slice(1).map((p) => prop(name, p));
        return [inputLabels.get(path[0]) ?? path[0], ...rest].join(" の ");
      }
      return [base(name), ...path.map((p) => prop(name, p))].join(" の ").replace(/ の \[/g, "[");
    },
  };
}

// ─── 条件 ──────────────────────────────────────────────

/** 分岐の腕の条件を、表示の部品にする (式以外の条件も含む) */
export function conditionSegments(cond: unknown): Seg[] {
  const c = rec(cond);
  switch (c.kind) {
    case "expression": return expressionSegments(str(c.expression));
    case "tryCatch": return [{ k: "text", v: `エラー「${str(c.errorCode)}」が起きたとき` }];
    case "affectedRowsZero": return [{ k: "text", v: "更新・削除の件数が 0 件だったとき" }];
    case "externalOutcome": {
      const o = { success: "成功した", failure: "失敗した", timeout: "時間切れになった" }[str(c.outcome)] ?? str(c.outcome);
      return [{ k: "text", v: `外部への呼び出しが${o}とき` }];
    }
    default: return [];
  }
}

export function conditionText(cond: unknown, labels: VarLabels): string {
  return segsToText(conditionSegments(cond), labels.full);
}

/**
 * 処理記述表の「条件・備考」の文字 (`実行条件: 式 / HTTP 200` など) の、実行条件の式を、言葉にする。
 * 言葉にできないとき・同じ文字のときは、そのまま (raw は null)。raw は、言葉の下に添える、もとの式
 */
export function noteWithWords(note: string, runIf: string | undefined, labels: VarLabels): { text: string; raw: string | null } {
  if (!runIf) return { text: note, raw: null };
  const words = conditionText({ kind: "expression", expression: runIf }, labels);
  if (!words || words === runIf) return { text: note, raw: null };
  return { text: note.replace(`実行条件: ${runIf}`, `実行条件: ${words}`), raw: runIf };
}
