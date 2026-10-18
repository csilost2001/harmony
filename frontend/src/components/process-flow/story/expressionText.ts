/**
 * 条件式を、人が読む言葉に直す (処理フローの「流れ」表示)。
 *
 * 例: `@customer == null` → [変数 customer] が ない
 *     `@inputs.paymentTerm == 'prepaid' && @credit.creditUsed > @customer.creditLimit`
 *       → [入力 の paymentTerm] が「prepaid」と等しい かつ [credit の creditUsed] が [customer の creditLimit] より大きい
 *
 * 直せない式 (関数呼び出し・三項演算子・入れ子の括弧など) は、そのまま「式」として返す。
 * 式の意味は変えない (表示だけ)。docs/spec/process-flow-story-view.md
 */

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
function stripOuterParens(s: string): string {
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

/** `@a.b[0].c` → { name: "a", path: ["b", "[0]", "c"] }。変数でなければ null */
export function parseVarRef(token: string): { name: string; path: string[]; raw: string } | null {
  const m = token.trim().match(VAR_RE);
  if (!m) return null;
  const path = (m[2].match(/\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\]/g) ?? []).map((p) => (p.startsWith(".") ? p.slice(1) : p));
  // `@var.action.txResult.committed` は、txResult の committed として扱う
  if (m[1] === "var" && path[0] === "action" && path.length >= 2) {
    return { name: path[1], path: path.slice(2), raw: token.trim() };
  }
  return { name: m[1], path, raw: token.trim() };
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
    const neg = c.match(/^!\s*(@.+)$/);
    if (neg && parseVarRef(neg[1])) return [...operandSegs(neg[1]), { k: "text", v: " が「いいえ」" }];
    if (parseVarRef(c)) return [...operandSegs(c), { k: "text", v: " が「はい」" }];
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
  const stripped = stripOuterParens(e);
  const or = splitTopLevel(stripped, "||");
  if (or) return joinSegs(or.map((p) => expressionSegments(p)), " または ");
  const and = splitTopLevel(stripped, "&&");
  if (and) return joinSegs(and.map((p) => expressionSegments(p)), " かつ ");
  return clauseSegs(stripped);
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
