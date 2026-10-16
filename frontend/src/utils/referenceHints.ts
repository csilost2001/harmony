/**
 * 参照・式の入力欄の、その場の指摘 (UI 改善提案 第 5 弾 #82・#100)。画面に依存しない純関数。
 * - analyzeReferences: 参照 (@screen.cart など) の打ち間違いに、近い名前を示す (入力が終わった欄で)
 * - analyzeExpression: 式・条件の、書き間違い (括弧・引用符・演算子・「=」) を検査する。文法は決めない (書き間違いの検出だけ)
 * - describeCondition: 単純な条件を、平文で言い直す (「注文金額が 10000 以上のとき」)
 */
import { computeReferenceCompletion } from "./reference-completer/completer";
import type { CompletionContext, Resolver } from "./reference-completer/types";

export interface ReferenceHint {
  message: string;
  /** 採用すると、欄の値がこれになる (近い名前に直した全文) */
  fix?: string;
  fixLabel?: string;
}

// ── 近い名前 ───────────────────────────────────────────────────────────────

/** Damerau-Levenshtein (隣り合う 2 文字の入れ替えも 1 回) */
export function editDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 0; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[x.length][y.length];
}

/** 打ち間違いと思える、いちばん近い名前 (近すぎない・短すぎる名前では出さない)。無ければ null */
export function nearestName(typed: string, candidates: readonly string[]): string | null {
  if (typed.length < 3) return null;
  const limit = typed.length <= 5 ? 1 : 2;
  let best: { name: string; d: number } | null = null;
  for (const c of candidates) {
    if (c === typed) return null; // 一致しているものがあれば、打ち間違いではない
    const d = editDistance(typed, c);
    if (d <= limit && (!best || d < best.d)) best = { name: c, d };
  }
  return best?.name ?? null;
}

const TOKEN_RE = /@[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+/g;

/** 参照の打ち間違い (近い名前がある場合だけ)。resolvers の候補を使う */
export function analyzeReferences(value: string, resolvers: Resolver[], ctx: CompletionContext): ReferenceHint[] {
  const out: ReferenceHint[] = [];
  if (!value.includes("@")) return out;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(value)) !== null && out.length < 5) {
    const token = m[0];
    const lastDot = token.lastIndexOf(".");
    const typed = token.slice(lastDot + 1);
    const parentEnd = m.index + lastDot + 1; // 最後の「.」の直後
    const state = computeReferenceCompletion(value.slice(0, parentEnd), parentEnd, resolvers, ctx);
    if (state.phase !== "active") continue;
    const names = state.candidates.map((c) => c.value);
    if (names.length === 0 || names.includes(typed)) continue;
    const near = nearestName(typed, names);
    if (!near) continue;
    const fixed = value.slice(0, m.index + lastDot + 1) + near + value.slice(m.index + token.length);
    out.push({ message: `「${token}」は見つかりません。近い名前: ${near}`, fix: fixed, fixLabel: `「${near}」に直す` });
  }
  return out;
}

// ── 式の書き間違い ─────────────────────────────────────────────────────────

type Tok = { kind: "str" | "num" | "ref" | "ident" | "op" | "open" | "close" | "punct"; text: string };

/** 式を字句に分ける。引用符が閉じていなければ unterminated を返す */
function tokenize(src: string): { tokens: Tok[]; unterminated?: string } {
  const tokens: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      if (j >= src.length) return { tokens, unterminated: c };
      tokens.push({ kind: "str", text: src.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const num = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (num) { tokens.push({ kind: "num", text: num[0] }); i += num[0].length; continue; }
    const ref = /^@[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+|\[[^\]]*\])*/.exec(src.slice(i));
    if (ref) { tokens.push({ kind: "ref", text: ref[0] }); i += ref[0].length; continue; }
    const id = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/.exec(src.slice(i));
    if (id) { tokens.push({ kind: "ident", text: id[0] }); i += id[0].length; continue; }
    const op = /^(?:===|!==|==|!=|=>|>=|<=|&&|\|\||\?\?|\*\*|\?\.|[><!+\-*/%=?:])/.exec(src.slice(i));
    if (op) { tokens.push({ kind: "op", text: op[0] }); i += op[0].length; continue; }
    if (c === "(" || c === "[" || c === "{") { tokens.push({ kind: "open", text: c }); i++; continue; }
    if (c === ")" || c === "]" || c === "}") { tokens.push({ kind: "close", text: c }); i++; continue; }
    tokens.push({ kind: "punct", text: c });
    i++;
  }
  return { tokens };
}

// 二項の演算子 (+ - は、前に値が無くても単項になれるので、含めない。=> のアロー関数も別)
const BINARY = new Set(["===", "!==", "==", "!=", ">=", "<=", "&&", "||", "??", ">", "<", "*", "**", "/", "%", "="]);
const MATCHING: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** 式の書き間違い (括弧・引用符・演算子・「=」)。空欄・書き間違いが無ければ、空配列 */
export function analyzeExpression(value: string): ReferenceHint[] {
  // 正規表現のリテラル (/abc/.test(x)) は、割り算と見分けられないので、文字列に置き換えてから検査する
  const src = value.trim().replace(/(^|[(,=:&|!?]\s*)\/(?:\\.|[^/\\\n])+\/[a-z]*/g, "$1''");
  if (!src) return [];
  // 日本語などの語を含む式 (「在庫数 < 注文数」のような自由記述の条件) は、式として検査しない (書き間違いと見分けられない)
  if (/[^\x20-\x7E\t\r\n]/.test(src.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, ""))) return [];
  const hints: ReferenceHint[] = [];
  const { tokens, unterminated } = tokenize(src);
  if (unterminated) hints.push({ message: `引用符 ${unterminated} が閉じていません` });

  const stack: string[] = [];
  for (const t of tokens) {
    if (t.kind === "open") stack.push(t.text);
    else if (t.kind === "close") {
      if (stack.length === 0) { hints.push({ message: `閉じ括弧 ${t.text} に対応する開き括弧がありません` }); break; }
      if (stack[stack.length - 1] !== MATCHING[t.text]) { hints.push({ message: `括弧が対応していません: ${stack[stack.length - 1]} と ${t.text}` }); break; }
      stack.pop();
    }
  }
  if (stack.length > 0 && !unterminated) hints.push({ message: `括弧が閉じていません (${stack.join("")} が ${stack.length} 個)` });

  // 演算子の並び: 演算子の直後に値が無い・演算子が続く・式の先頭 / 末尾の二項演算子
  const operandBefore = (i: number) => i > 0 && ["str", "num", "ref", "ident", "close"].includes(tokens[i - 1].kind);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== "op") continue;
    if (t.text === "=") { hints.push({ message: "「=」は代入です。等しいかを調べるときは「===」(または「==」) を使います" }); break; }
    if (!BINARY.has(t.text)) continue;
    if (!operandBefore(i)) { hints.push({ message: `演算子 ${t.text} の前に値がありません` }); break; }
    const next = tokens[i + 1];
    if (!next || next.kind === "close") { hints.push({ message: `演算子 ${t.text} の後に値がありません` }); break; }
    if (next.kind === "op" && !["!", "-", "+"].includes(next.text)) { hints.push({ message: `演算子 ${t.text} のあとに、演算子 ${next.text} が続いています` }); break; }
  }
  // 文字列の中の AND / OR は、見ない
  const outsideStrings = src.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''");
  if (/\b(AND|OR)\b/.test(outsideStrings) && !unterminated) hints.push({ message: "「AND」「OR」ではなく、「&&」「||」を使います" });
  return hints.map((h) => ({ message: h.message }));
}

// ── 平文の言い直し ─────────────────────────────────────────────────────────

const CMP: Record<string, string> = { "===": "と等しい", "==": "と等しい", "!==": "と異なる", "!=": "と異なる", ">=": "以上", "<=": "以下", ">": "より大きい", "<": "より小さい" };

/** 単純な条件 (参照と値の比較を && / || でつないだもの) を、平文にする。複雑な式は null */
export function describeCondition(value: string): string | null {
  const src = value.trim();
  if (!src || /[()?:]/.test(src.replace(/'[^']*'|"[^"]*"/g, ""))) return null;
  const orParts = src.split("||").map((s) => s.trim());
  const describeAnd = (part: string): string | null => {
    const clauses = part.split("&&").map((s) => s.trim());
    const texts: string[] = [];
    for (const cl of clauses) {
      const cmp = /^(@[A-Za-z][\w.\-[\]]*)\s*(===|!==|==|!=|>=|<=|>|<)\s*('[^']*'|"[^"]*"|-?\d+(?:\.\d+)?|true|false|null)$/.exec(cl);
      if (cmp) {
        const ref = cmp[1].slice(1);
        const lit = cmp[3].replace(/^['"]|['"]$/g, "");
        texts.push(`${ref} が ${lit} ${CMP[cmp[2]]}`);
        continue;
      }
      const neg = /^!\s*(@[A-Za-z][\w.\-[\]]*)$/.exec(cl);
      if (neg) { texts.push(`${neg[1].slice(1)} が偽 (空)`); continue; }
      const truthy = /^(@[A-Za-z][\w.\-[\]]*)$/.exec(cl);
      if (truthy) { texts.push(`${truthy[1].slice(1)} が真 (値がある)`); continue; }
      return null;
    }
    return texts.join("、かつ ");
  };
  const parts: string[] = [];
  for (const p of orParts) {
    const d = describeAnd(p);
    if (d === null) return null;
    parts.push(d);
  }
  return `${parts.join("、または ")} のとき`;
}
