/**
 * 条件を「どの値を / どうなら / 何と比べる」の選びで作る (式を書かなくてよい)。
 *
 * - 式 ⇄ 部品: 単純な比較の並び (かつ、または、のどちらか 1 種類) だけを、部品にできる。入れ子の括弧・関数・三項などは、式のまま (null)
 * - 変数の候補: その工程より前で作られる変数 (繰り返しの 1 行は、その繰り返しの中でだけ)・入力・DB の検索結果の列
 *
 * 仕様: docs/spec/process-flow-story-view.md
 */
import type { ActionDefinition } from "../../../types/v3";
import { parseVarRef, splitTopLevel } from "./expressionText";
import { asLooseList, buildVarLabels, childGroups, variableFlow, walkSteps, type Loose } from "./storyModel";

export type CondOp = "==" | "!=" | ">" | ">=" | "<" | "<=" | "null" | "notNull" | "true" | "false" | "notTrue" | "notFalse";

export const OP_CHOICES: Array<{ op: CondOp; label: string; needsValue: boolean }> = [
  { op: "==", label: "と等しい", needsValue: true },
  { op: "!=", label: "と違う", needsValue: true },
  { op: ">", label: "より大きい", needsValue: true },
  { op: ">=", label: "以上", needsValue: true },
  { op: "<", label: "より小さい", needsValue: true },
  { op: "<=", label: "以下", needsValue: true },
  { op: "null", label: "ない (空)", needsValue: false },
  { op: "notNull", label: "ある", needsValue: false },
  { op: "true", label: "「はい」", needsValue: false },
  { op: "false", label: "「いいえ」", needsValue: false },
  { op: "notTrue", label: "「はい」ではない", needsValue: false },
  { op: "notFalse", label: "「いいえ」ではない", needsValue: false },
];

export interface Clause {
  /** `@customer.isActive` のように、先頭に @ を付けた参照 */
  subject: string;
  op: CondOp;
  /** 式としての値 (`0` `'prepaid'` `@credit.creditUsed`)。値の要らない比較では空 */
  value: string;
  /** もとの式が、厳密な比較 (`===` `!==`) だったか。触らない限り、そのまま書き戻す (意味を変えないため) */
  strict?: boolean;
}

export interface CondModel {
  join: "&&" | "||";
  clauses: Clause[];
}

const CMP_RE = /^(@[\w.[\]]+)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/;
const SIMPLE_VALUE_RE = /^(@[\w.[\]]+|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(\.\d+)?|null|true|false)$/;

function parseClause(raw: string): Clause | null {
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

/** 式 → 部品。部品にできない式 (入れ子の括弧・関数・三項・「かつ」と「または」の混在など) は null */
export function parseCondition(expr: string): CondModel | null {
  const e = expr.trim();
  if (!e) return { join: "&&", clauses: [] };
  if (/[?]/.test(e)) return null;
  const or = splitTopLevel(e, "||");
  const and = splitTopLevel(e, "&&");
  if (or && and) return null;
  const parts = or ?? and ?? [e];
  const clauses: Clause[] = [];
  for (const p of parts) {
    const c = parseClause(p);
    if (!c) return null;
    clauses.push(c);
  }
  return { join: or ? "||" : "&&", clauses };
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

export function composeCondition(m: CondModel): string {
  return m.clauses.map(composeClause).join(m.join === "||" ? " || " : " && ");
}

/** 利用者が入れた値を、式の値にする: 数・true/false/null・@変数・引用符つきは、そのまま。それ以外は、文字列として引用符で囲む */
export function valueToExpr(input: string): string {
  const t = input.trim();
  if (!t) return "";
  if (SIMPLE_VALUE_RE.test(t)) return t;
  return `'${t.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** 式の値 → 入力欄に出す形 (文字列の引用符は外す) */
export function exprToValue(expr: string): string {
  const t = expr.trim();
  const m = t.match(/^'((?:[^'\\]|\\.)*)'$|^"((?:[^"\\]|\\.)*)"$/);
  return m ? (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1") : t;
}

// ─── 変数の候補 ────────────────────────────────────────

export interface VarCandidate {
  /** `@customer` */
  ref: string;
  label: string;
  /** その変数の持つ項目の候補 (DB の検索結果の列・入力の名前・TX の結果 など) */
  props: Array<{ name: string; label: string }>;
}

/** SELECT の列名 (別名があれば別名) の並び。読めなければ空 */
export function selectColumns(sql: string): string[] {
  const m = sql.match(/\bSELECT\b\s+([\s\S]*?)\s+\bFROM\b/i);
  if (!m) return [];
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of m[1]) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) items.push(cur);
  const out: string[] = [];
  for (const it of items) {
    const t = it.trim();
    if (t === "*" || t.endsWith(".*")) continue;
    const alias = t.match(/\bAS\s+"?([A-Za-z_]\w*)"?\s*$/i);
    if (alias) { out.push(alias[1]); continue; }
    const last = t.match(/([A-Za-z_]\w*)"?\s*$/);
    if (last && !/[()]/.test(t)) out.push(last[1]);
  }
  return [...new Set(out)];
}

interface Place {
  list: readonly Loose[];
  index: number;
  /** この並びに入った道 (持ち主の工程と、枠の役割)。最上位は null */
  via: { owner: Loose; role: string } | null;
}

/** その工程までの、入っている並びと位置 (いちばん外側から、その工程自身まで) */
function chainTo(list: readonly Loose[], id: string, via: Place["via"] = null): Place[] | null {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.id === id) return [{ list, index: i, via }];
    for (const g of childGroups(s)) {
      const sub = chainTo(g.steps, id, { owner: s, role: g.role });
      if (sub) return [{ list, index: i, via }, ...sub];
    }
  }
  return null;
}

/**
 * ある工程 (beforeStepId) で使える変数の候補。検査 (identifierScope) と同じ取り決め:
 * 同じ並び、または外側の並びで、その工程の前に作られる変数。分岐の道・繰り返しの中で作った変数は、そのあとの外側の工程からも使える。
 * ただし、まとまり (トランザクション) の中の変数は、外からは使えない (まとまりの「確定したあと」「取り消したあと」の中からは見える)。
 * 別の道 (兄弟の枠) の中の変数は、使えない。繰り返しの 1 行・番号は、その繰り返しの中でだけ。beforeStepId が null なら、流れの最後 (最上位) での候補。
 */
export function varCandidates(action: Pick<ActionDefinition, "steps" | "inputs">, beforeStepId: string | null, ambient: ReadonlyArray<{ name: string; label?: string }> = []): VarCandidate[] {
  const steps = asLooseList(action.steps);
  const labels = buildVarLabels(action);
  const byId = new Map<string, Loose>();
  walkSteps(steps, (s) => { byId.set(s.id, s); });
  const chainT = beforeStepId ? chainTo(steps, beforeStepId) ?? [] : [];
  const inside = new Set(chainT.slice(0, -1).map((p) => p.list[p.index].id));
  const visible = (defId: string): boolean => {
    const chainD = chainTo(steps, defId);
    if (!chainD || chainD.length === 0) return false;
    // 変数が見える範囲 (並びと、その中の位置): 自分の並びから、外側へ。まとまりの本体を出るところで止まる
    const scopes: Array<{ list: readonly Loose[]; index: number }> = [];
    let txOwner: Loose | null = null;
    for (let k = chainD.length - 1; k >= 0; k--) {
      scopes.push({ list: chainD[k].list, index: chainD[k].index });
      const via = chainD[k].via;
      if (via && via.owner.kind === "transactionScope" && via.role === "body") { txOwner = via.owner; break; }
    }
    if (beforeStepId === null) return chainD[0].list === steps && scopes.some((s) => s.list === steps);
    if (chainT.some((p) => scopes.some((s) => p.list === s.list && p.index > s.index))) return true;
    // まとまりの「確定したあと」「取り消したあと」からは、まとまりの中の変数が見える
    return txOwner !== null && chainT.some((p) => p.via?.owner === txOwner && (p.via.role === "commit" || p.via.role === "rollback"));
  };
  const out: VarCandidate[] = [];
  for (const v of variableFlow(action, labels)) {
    const isLoopVar = v.how === "loopItem" || v.how === "loopIndex";
    if (isLoopVar ? !v.defIds.some((id) => inside.has(id)) : !v.defIds.some(visible)) continue;
    const def = byId.get(v.defIds[0]);
    const props: VarCandidate["props"] = [];
    if (def?.kind === "dbAccess") for (const c of selectColumns(String(def.sql ?? ""))) props.push({ name: c, label: c });
    if (def?.kind === "transactionScope") {
      props.push({ name: "committed", label: "確定したか" }, { name: "error.code", label: "エラーのコード" });
      for (const e of ((def.outputBinding as { expose?: string[] } | undefined)?.expose ?? [])) if (!["committed", "error", "diagnostics"].includes(e)) props.push({ name: e, label: e });
    }
    out.push({ ref: `@${v.name}`, label: v.label, props });
  }
  const inputs = (action.inputs ?? []).map((i) => ({ name: i.name, label: i.label ?? i.name }));
  out.push({ ref: "@inputs", label: "入力", props: inputs });
  // セッションなど、処理の外から来る値 (ambient)
  for (const a of ambient) out.push({ ref: `@${a.name}`, label: a.label || a.name, props: [] });
  return out;
}

/** 条件の部品の、足りないところ (空なら、決められる) */
export function clauseProblem(c: Clause): string {
  const root = c.subject.replace(/^@/, "").split(/[.[]/)[0];
  if (!root) return "どの値かを選んでください";
  if (c.subject === "@inputs") return "入力の、どの項目かを選んでください";
  if (OP_CHOICES.find((o) => o.op === c.op)?.needsValue && !c.value.trim()) return "比べる値を入れてください";
  return "";
}

/** 条件の式の中で、「この位置より前では、作られていない変数」の名前 (候補に無く、処理の外の値でもないもの) */
export function undefinedRefs(expr: string, cands: readonly VarCandidate[]): string[] {
  // 入力は、`@inputs.x` のほかに、公開された短縮形 `@x` でも使われる
  const known = new Set([...cands.map((c) => c.ref.slice(1)), ...(cands.find((c) => c.ref === "@inputs")?.props.map((p) => p.name) ?? [])]);
  const external = new Set(["inputs", "conv", "env", "secret", "const", "msg", "var", "global", "session"]);
  const out = new Set<string>();
  for (const m of expr.matchAll(/@var\.(?:action|loop|flowParameter|global)\.([A-Za-z_]\w*)|@var\.(?:step|tx)\.[\w-]+\.([A-Za-z_]\w*)|@var\.([A-Za-z_]\w*)|@([A-Za-z_]\w*)/g)) {
    const name = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!known.has(name) && !external.has(name)) out.add(name);
  }
  return [...out];
}
