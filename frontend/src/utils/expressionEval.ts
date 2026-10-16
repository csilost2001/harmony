/**
 * 条件式・式の「試し実行」(UI 改善提案 続編 第 8 弾 #150)。設計に書かれた式 (`@cartItems.length === 0 && @inputs.note != null` のような、
 * `@名前` の参照と、JavaScript に近い演算) を、サンプルの値で評価して、結果を見せる。
 * eval / Function は使わない。読み解く文法は下の範囲だけで、範囲の外 (アロー関数・代入・関数の呼び出し・new など) は、「試せません」と返す。
 * 設計は外から取り込まれることがあるので、式を実行する道具を、安全な範囲に限っている。
 *   リテラル (数・文字・true / false / null / undefined)・`@名前` と `.名前` `[式]` の参照 (null の先は undefined)・
 *   `! - +` `* / %` `+ -` `< <= > >=` `== != === !==` `&&` `||` `?:`・括弧・許した文字列 / 配列の操作 (includes startsWith など)
 */
export type EvalResult = { ok: true; value: unknown } | { ok: false; error: string };

type Tok =
  | { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "ref"; v: string }
  | { t: "op"; v: string } | { t: "end" };

const MAX_LENGTH = 2000;
const MAX_DEPTH = 40;
const OPS = ["===", "!==", "&&", "||", "==", "!=", "<=", ">=", "=>", "?.", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", "(", ")", "[", "]", ".", ","];
const METHODS = new Set(["includes", "startsWith", "endsWith", "toLowerCase", "toUpperCase", "trim", "indexOf", "join"]);

class Unsupported extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i))!;
      out.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, v = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) { j++; v += ({ n: "\n", t: "\t" } as Record<string, string>)[src[j]] ?? src[j]; } else v += src[j]; j++; }
      if (j >= src.length) throw new Unsupported("文字列の引用符が閉じていません");
      out.push({ t: "str", v }); i = j + 1; continue;
    }
    if (c === "@") {
      const m = /^@([A-Za-z_][\w]*)/.exec(src.slice(i));
      if (!m) throw new Unsupported("@ の後ろに名前がありません");
      out.push({ t: "ref", v: m[1] }); i += m[0].length; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] }); i += m[0].length; continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Unsupported(`この文字は試せません: ${c}`);
    out.push({ t: "op", v: op }); i += op.length;
  }
  out.push({ t: "end" });
  return out;
}

class Parser {
  private p = 0;
  private depth = 0;
  private readonly toks: Tok[];
  private readonly vars: Readonly<Record<string, unknown>>;
  constructor(toks: Tok[], vars: Readonly<Record<string, unknown>>) { this.toks = toks; this.vars = vars; }
  private peek(): Tok { return this.toks[this.p]; }
  private isOp(v: string): boolean { const t = this.peek(); return t.t === "op" && t.v === v; }
  private eat(v: string): boolean { if (this.isOp(v)) { this.p++; return true; } return false; }
  private enter(): void { if (++this.depth > MAX_DEPTH) throw new Unsupported("式が深く入れ子になりすぎています"); }
  private leave(): void { this.depth--; }

  parseAll(): unknown {
    const v = this.ternary();
    if (this.peek().t !== "end") throw new Unsupported("式の途中に、読めない部分があります");
    return v;
  }

  private ternary(): unknown {
    this.enter();
    const c = this.or();
    let r = c;
    if (this.eat("?")) {
      const a = this.ternary();
      if (!this.eat(":")) throw new Unsupported("三項演算子の : がありません");
      const b = this.ternary();
      r = c ? a : b;
    }
    this.leave();
    return r;
  }
  // 短絡評価でも、右の式は読み進める (文法の誤りを見つけるため)。値の評価だけを飛ばすために、毎回両方を評価する (副作用の無い式だけなので問題ない)
  private or(): unknown { let l = this.and(); while (this.eat("||")) { const r = this.and(); l = l || r; } return l; }
  private and(): unknown { let l = this.eq(); while (this.eat("&&")) { const r = this.eq(); l = l && r; } return l; }
  private eq(): unknown {
    let l = this.rel();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || !["==", "!=", "===", "!=="].includes(t.v)) return l;
      this.p++;
      const r = this.rel();
      // 設計の式の == は、JavaScript と同じゆるい比較
      l = t.v === "==" ? l == r : t.v === "!=" ? l != r : t.v === "===" ? l === r : l !== r;
    }
  }
  private rel(): unknown {
    let l = this.add();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || !["<", "<=", ">", ">="].includes(t.v)) return l;
      this.p++;
      const r = this.add() as never, a = l as never;
      l = t.v === "<" ? a < r : t.v === "<=" ? a <= r : t.v === ">" ? a > r : a >= r;
    }
  }
  private add(): unknown {
    let l = this.mul();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || (t.v !== "+" && t.v !== "-")) return l;
      this.p++;
      const r = this.mul();
      l = t.v === "+" ? (l as never) + (r as never) : Number(l) - Number(r);
    }
  }
  private mul(): unknown {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t !== "op" || !["*", "/", "%"].includes(t.v)) return l;
      this.p++;
      const r = Number(this.unary()), a = Number(l);
      l = t.v === "*" ? a * r : t.v === "/" ? a / r : a % r;
    }
  }
  private unary(): unknown {
    if (this.eat("!")) return !this.unary();
    if (this.eat("-")) return -Number(this.unary());
    if (this.eat("+")) return Number(this.unary());
    return this.postfix();
  }
  private postfix(): unknown {
    let v = this.primary();
    for (;;) {
      if (this.isOp(".") || this.isOp("?.")) {
        this.p++;
        const t = this.peek();
        if (t.t !== "id") throw new Unsupported(". の後ろに名前がありません");
        this.p++;
        if (this.isOp("(")) { v = this.call(v, t.v); continue; }
        v = this.member(v, t.v);
      } else if (this.eat("[")) {
        const k = this.ternary();
        if (!this.eat("]")) throw new Unsupported("] がありません");
        v = this.member(v, k);
      } else if (this.isOp("(")) {
        throw new Unsupported("関数の呼び出しは試せません (対応: includes / startsWith / endsWith / indexOf / join / trim / toLowerCase / toUpperCase)");
      } else return v;
    }
  }
  private member(v: unknown, key: unknown): unknown {
    if (v === null || v === undefined) return undefined; // null の先は undefined (設計の式は、null を許して書かれる)
    if (typeof key === "string" && (key === "__proto__" || key === "constructor" || key === "prototype")) return undefined;
    if (typeof v === "string" || Array.isArray(v)) return key === "length" ? v.length : (v as never)[key as never];
    if (typeof v === "object") return Object.prototype.hasOwnProperty.call(v, key as string) ? (v as Record<string, unknown>)[key as string] : undefined;
    return undefined;
  }
  private call(target: unknown, name: string): unknown {
    if (!METHODS.has(name)) throw new Unsupported(`${name}() は試せません (対応: ${[...METHODS].join(" / ")})`);
    this.eat("(");
    const args: unknown[] = [];
    if (!this.isOp(")")) {
      do {
        if (this.peek().t === "op" && this.isOp(")")) break;
        args.push(this.ternary());
      } while (this.eat(","));
    }
    if (!this.eat(")")) throw new Unsupported(") がありません");
    if (this.isOp("=>")) throw new Unsupported("アロー関数は試せません");
    if (target === null || target === undefined) return undefined;
    if (typeof target !== "string" && !Array.isArray(target)) throw new Unsupported(`${name}() は、文字列か配列に使います`);
    const fn = (target as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
    if (typeof fn !== "function") throw new Unsupported(`${name}() は、この値には使えません`);
    return fn.apply(target, args);
  }
  private primary(): unknown {
    const t = this.peek();
    this.p++;
    if (t.t === "num" || t.t === "str") return t.v;
    if (t.t === "ref") return Object.prototype.hasOwnProperty.call(this.vars, t.v) ? this.vars[t.v] : undefined;
    if (t.t === "id") {
      if (t.v === "true") return true;
      if (t.v === "false") return false;
      if (t.v === "null") return null;
      if (t.v === "undefined") return undefined;
      // 見分けのつかない名前 (関数・外の変数) は、勝手に値にせず、誤りとして返す
      throw new Unsupported(`「${t.v}」は試せません (変数は @${t.v} のように @ をつけます)`);
    }
    if (t.t === "op" && t.v === "(") {
      const v = this.ternary();
      if (!this.eat(")")) throw new Unsupported(") がありません");
      return v;
    }
    if (t.t === "end") throw new Unsupported("式が途中で終わっています");
    throw new Unsupported(`この位置に ${t.t === "op" ? t.v : "これ"} は書けません`);
  }
}

/** 式を、変数 (@名前 → 値) を与えて評価する。読めない式・範囲外の書き方は、ok: false と理由 */
export function evaluateExpression(source: string, vars: Readonly<Record<string, unknown>> = {}): EvalResult {
  if (source.length > MAX_LENGTH) return { ok: false, error: `式が長すぎます (${MAX_LENGTH} 文字まで)` };
  try {
    return { ok: true, value: new Parser(tokenize(source), vars).parseAll() };
  } catch (e) {
    if (e instanceof Unsupported) return { ok: false, error: e.message };
    return { ok: false, error: "評価できませんでした" };
  }
}

/** 式の中の `@名前` の、名前の一覧 (最初の部分だけ。`@inputs.note` なら inputs)。出てきた順・重複なし */
export function referencedRoots(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/@([A-Za-z_]\w*)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** 結果を、画面に出す文字にする (JSON。undefined は「未定義」) */
export function formatValue(v: unknown): string {
  if (v === undefined) return "未定義 (undefined)";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "object") { try { return JSON.stringify(v); } catch { return String(v); } }
  return String(v);
}

export interface ExpressionSite { stepId: string; where: string; text: string }

const EXPR_KEYS: Array<[string, string]> = [["expression", "式"], ["runIf", "実行条件"], ["bodyExpression", "返す内容"], ["condition", "条件"], ["whenExpression", "条件"]];

/** 処理 (工程の配列) に書かれた式の一覧 (分岐の条件・実行条件など)。入れ子の中も。試し実行の候補にする */
export function collectExpressions(steps: ReadonlyArray<{ id: string; [k: string]: unknown }>): ExpressionSite[] {
  const out: ExpressionSite[] = [];
  const visit = (list: ReadonlyArray<{ id: string; [k: string]: unknown }> | undefined) => {
    for (const s of list ?? []) {
      for (const [key, label] of EXPR_KEYS) { const v = s[key]; if (typeof v === "string" && v.trim()) out.push({ stepId: s.id, where: label, text: v }); }
      if (Array.isArray(s.branches)) {
        for (const b of s.branches as Array<{ code?: string; condition?: { kind?: string; expression?: string }; steps?: never }>) {
          if (b.condition?.kind === "expression" && b.condition.expression?.trim()) out.push({ stepId: s.id, where: `分岐 ${b.code ?? ""} の条件`, text: b.condition.expression });
          visit((b as { steps?: never }).steps);
        }
      }
      const eb = s.elseBranch as { steps?: never } | undefined;
      if (eb) visit(eb.steps);
      for (const k of ["steps", "subSteps", "onCommit", "onRollback"]) if (Array.isArray(s[k])) visit(s[k] as never);
    }
  };
  visit(steps);
  return out;
}
