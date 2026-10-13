/**
 * 設計の点検の設定 (`<データフォルダ>/design-check.json`)。
 *
 * - 抑制: 「意図どおり」として、個々の要確認を理由つきで止める (期限つきにできる)
 * - 独自ルール: プロジェクトごとの検査を、コードではなく宣言 (対象・項目の場所・条件) で足す
 *
 * 設計の原本ではなく運用の設定なので、スキーマ (schemas/v3) には載せず、ここで検証する。
 * 手で書き換えた壊れた値は、捨てて `problems` に積む (設定ファイルの 1 行の誤りで、点検全体を止めない)。
 */

export type IssueSeverity = "error" | "warning" | "info";

export interface IssueSuppression {
  /** 要確認の印 (`issueKey`) */
  key: string;
  /** 抑制する理由 (必須。なぜ問題ないかを残す) */
  reason: string;
  /** 抑制の期限 (YYYY-MM-DD。この日を過ぎると、抑制は効かなくなり、要確認が再び出る) */
  expiresOn?: string;
  /** 抑制した人 */
  by?: string;
  /** 抑制した日時 (ISO) */
  at: string;
  /** 抑制した時点の指摘 (一覧の表示用。指摘が変わっても、何を止めたか分かる) */
  severity: IssueSeverity;
  section: string;
  message: string;
}

export const RULE_TARGETS = ["screen", "screenItem", "processFlow", "action", "table", "column", "businessFlow", "report"] as const;
export type RuleTarget = (typeof RULE_TARGETS)[number];
export const RULE_TARGET_LABELS: Record<RuleTarget, string> = {
  screen: "画面", screenItem: "画面項目", processFlow: "処理フロー", action: "処理フローのアクション", table: "テーブル", column: "カラム", businessFlow: "業務フロー", report: "帳票",
};

export type RuleCheck =
  | { type: "required" }
  | { type: "forbidden" }
  | { type: "pattern"; pattern: string; flags?: string }
  | { type: "oneOf"; values: string[] }
  | { type: "range"; min?: number; max?: number };

export interface RuleWhen { path: string; equals?: string | number | boolean; notEmpty?: boolean }

export interface CustomRule {
  id: string;
  name: string;
  target: RuleTarget;
  /** 対象の中の項目の場所 (例: `description` / `meta.maturity` / `length`) */
  path: string;
  check: RuleCheck;
  /** 条件 (省略なら、対象すべてに適用) */
  when?: RuleWhen;
  severity: IssueSeverity;
  /** 違反時の文言 (省略なら自動) */
  message?: string;
  enabled?: boolean;
}

export interface CheckSettings {
  version: 1;
  suppressions: IssueSuppression[];
  rules: CustomRule[];
}

export const MAX_SUPPRESSIONS = 5000;
export const MAX_RULES = 200;
const MAX_TEXT = 2000;
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const emptyCheckSettings = (): CheckSettings => ({ version: 1, suppressions: [], rules: [] });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === "string" && v.length <= max ? v : undefined);

export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isValidRulePath(p: string): boolean {
  return PATH_RE.test(p) && p.length <= 100 && !p.split(".").some((seg) => FORBIDDEN_SEGMENTS.has(seg));
}

/**
 * 利用者が書く正規表現の安全性の検査 (ReDoS を避ける)。許す形を絞る:
 *  - 後方参照・先読み / 後読みは使えない。長さは 200 文字まで。フラグは i m s u だけ
 *  - 「終わりのない繰り返し」(`*` `+` `{n,}`) は 3 つまで
 *  - 繰り返し (`*` `+` `{n,}`、または上限が 5 を超える `{n,m}`) をつけたグループは、区切りの文字 (`_` `-` `.` `/` `:`) で始まり、
 *    選択 (`|`)・入れ子のグループを含まず、残りが区切りの文字を含まない文字 (リテラル・`\d`・区切りを含まない文字クラス) だけの形に限る。
 *    例: `(_[a-z0-9]+)*` は可 (区切りで必ず切れるので、どこで繰り返しが終わるかが 1 通りに決まる)。`(a|aa)+`・`(a+)+`・`([a-z])+` は不可
 * これで、入力の長さに対して指数的に遅くなる式を除く (3 つまでの繰り返しの重なりによる、多項式の遅さは残るので、検査する値の長さを抑える)。
 */
export function checkRegexSafety(pattern: string, flags?: string): string | null {
  if (pattern.length === 0) return "正規表現が空です";
  if (pattern.length > 200) return "正規表現が長すぎます (200 文字まで)";
  if (flags !== undefined && !/^[imsu]*$/.test(flags)) return "正規表現のフラグは i / m / s / u だけ使えます";
  if (/\\[1-9]|\\k</.test(pattern)) return "後方参照は使えません";
  if (/\(\?(?:=|!|<=|<!)/.test(pattern)) return "先読み・後読みは使えません";
  try { new RegExp(pattern, flags); } catch (e) { return `正規表現として読めません: ${e instanceof Error ? e.message : String(e)}`; }
  return structuralRegexProblem(pattern);
}

const DELIMITERS = "_-./:";
interface Atom { kind: "lit" | "esc" | "class" | "any" | "group"; ch?: string; body?: string; negated?: boolean; group?: Grp; quantified?: boolean }
interface Grp { alt: boolean; hasGroup: boolean; atoms: Atom[] }

/** 文字クラス (`[...]` の中身) が、その 1 文字を含むか。判断できない書き方 (\w \W \D \S の否定形など) は、含むとみなす */
function classContains(body: string, ch: string): boolean {
  const code = ch.charCodeAt(0);
  let i = 0;
  while (i < body.length) {
    let c = body[i];
    if (c === "\\") {
      const e = body[i + 1] ?? "";
      if (e === "w" || e === "W" || e === "D" || e === "S") return true; // \w は _ を含む。否定形は、広い
      if (e === "d" || e === "s") { i += 2; continue; }
      c = e; i += 2;
    } else i += 1;
    if (body[i] === "-" && i + 1 < body.length) {
      let hi = body[i + 1];
      i += 2;
      if (hi === "\\") { hi = body[i] ?? ""; i += 1; }
      if (code >= c.charCodeAt(0) && code <= hi.charCodeAt(0)) return true;
    } else if (c === ch) return true;
  }
  return false;
}

function delimiterGroupOk(g: Grp): boolean {
  if (g.alt || g.hasGroup || g.atoms.length === 0) return false;
  const first = g.atoms[0];
  const delim = first.kind === "lit" || first.kind === "esc" ? first.ch : undefined;
  if (!delim || delim.length !== 1 || !DELIMITERS.includes(delim) || first.quantified) return false;
  return g.atoms.slice(1).every((a) => {
    if (a.kind === "lit") return a.ch !== delim;
    if (a.kind === "esc") return a.ch === "d" || (a.ch !== undefined && /^[^A-Za-z0-9]$/.test(a.ch) && a.ch !== delim);
    if (a.kind === "class") return !a.negated && !classContains(a.body ?? "", delim);
    return false; // . と、入れ子のグループ
  });
}

function structuralRegexProblem(p: string): string | null {
  const root: Grp = { alt: false, hasGroup: false, atoms: [] };
  const stack: Grp[] = [root];
  let unbounded = 0;
  let i = 0;
  const cur = () => stack[stack.length - 1];
  while (i < p.length) {
    const c = p[i];
    if (c === "\\") { cur().atoms.push({ kind: "esc", ch: p[i + 1] }); i += 2; continue; }
    if (c === "[") {
      let j = i + 1;
      const negated = p[j] === "^";
      if (negated) j++;
      const start = j;
      if (p[j] === "]") j++; // 先頭の ] は文字
      while (j < p.length && p[j] !== "]") j += p[j] === "\\" ? 2 : 1;
      cur().atoms.push({ kind: "class", body: p.slice(start, j), negated });
      i = j + 1; continue;
    }
    if (c === "(") {
      cur().hasGroup = true;
      if (p.startsWith("(?:", i)) i += 3;
      else if (p[i + 1] === "?" && p[i + 2] === "<") i = p.indexOf(">", i) + 1 || p.length; // 名前つき
      else i += 1;
      stack.push({ alt: false, hasGroup: false, atoms: [] });
      continue;
    }
    if (c === ")") {
      if (stack.length > 1) { const g = stack.pop()!; cur().atoms.push({ kind: "group", group: g }); }
      i += 1; continue;
    }
    if (c === "|") { cur().alt = true; i += 1; continue; }
    if (c === "^" || c === "$") { i += 1; continue; }
    if (c === "*" || c === "+" || c === "?" || c === "{") {
      let unb = c === "*" || c === "+";
      let max = c === "?" ? 1 : Infinity;
      let len = 1;
      if (c === "{") {
        const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(p.slice(i));
        if (!m) { cur().atoms.push({ kind: "lit", ch: c }); i += 1; continue; } // 量指定ではない {
        len = m[0].length;
        unb = !!m[2] && m[3] === "";
        max = m[2] ? (m[3] === "" ? Infinity : Number(m[3])) : Number(m[1]);
      }
      const last = cur().atoms[cur().atoms.length - 1];
      if (last) {
        last.quantified = true;
        if (unb) unbounded++;
        if (last.kind === "group" && last.group && (unb || max > 5) && !delimiterGroupOk(last.group)) {
          return "繰り返しのグループは、区切りの文字 (_ - . / :) で始まり、選択・入れ子を含まない形 (例: (_[a-z0-9]+)*) だけ使えます (入力しだいで、極端に遅くなる式を避けるため)";
        }
      }
      i += len;
      if (p[i] === "?") i += 1; // 最短一致
      continue;
    }
    cur().atoms.push(c === "." ? { kind: "any" } : { kind: "lit", ch: c });
    i += 1;
  }
  if (unbounded > 3) return "終わりのない繰り返し (* + {n,}) が多すぎます (3 つまで)";
  return null;
}

function parseCheck(raw: unknown): { check?: RuleCheck; problem?: string } {
  if (!isRecord(raw)) return { problem: "条件がありません" };
  switch (raw.type) {
    case "required": return { check: { type: "required" } };
    case "forbidden": return { check: { type: "forbidden" } };
    case "pattern": {
      const pattern = str(raw.pattern, 200); const flags = raw.flags === undefined ? undefined : str(raw.flags, 8);
      if (pattern === undefined) return { problem: "正規表現がありません" };
      const bad = checkRegexSafety(pattern, flags);
      return bad ? { problem: bad } : { check: { type: "pattern", pattern, ...(flags ? { flags } : {}) } };
    }
    case "oneOf": {
      const values = Array.isArray(raw.values) ? raw.values.filter((v): v is string => typeof v === "string" && v.length <= 200).slice(0, 200) : [];
      return values.length ? { check: { type: "oneOf", values } } : { problem: "候補がありません" };
    }
    case "range": {
      const min = typeof raw.min === "number" && Number.isFinite(raw.min) ? raw.min : undefined;
      const max = typeof raw.max === "number" && Number.isFinite(raw.max) ? raw.max : undefined;
      if (min === undefined && max === undefined) return { problem: "最小・最大のどちらかが要ります" };
      if (min !== undefined && max !== undefined && min > max) return { problem: "最小が最大より大きいです" };
      return { check: { type: "range", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) } };
    }
    default: return { problem: "条件の種類が分かりません" };
  }
}

/** 読み込んだ値 (ファイルの中身・利用者の入力) を、検証して設定にする。壊れた項目は捨てて、理由を `problems` に返す */
export function parseCheckSettings(raw: unknown): { settings: CheckSettings; problems: string[] } {
  const problems: string[] = [];
  const settings = emptyCheckSettings();
  if (raw === null || raw === undefined) return { settings, problems };
  if (!isRecord(raw)) return { settings, problems: ["設定の形が正しくありません (オブジェクトではありません)"] };

  const seenKeys = new Set<string>();
  (Array.isArray(raw.suppressions) ? raw.suppressions : []).forEach((s, i) => {
    if (settings.suppressions.length >= MAX_SUPPRESSIONS) return;
    if (!isRecord(s)) { problems.push(`抑制 ${i + 1} 件目: 形が正しくありません`); return; }
    const key = str(s.key, 100), reason = str(s.reason), at = str(s.at, 40);
    const section = str(s.section) ?? "", message = str(s.message) ?? "";
    const severity = s.severity === "error" || s.severity === "warning" || s.severity === "info" ? s.severity : undefined;
    if (!key || !reason?.trim() || !at || !severity) { problems.push(`抑制 ${i + 1} 件目: key・理由・日時・重大度が要ります`); return; }
    if (seenKeys.has(key)) return;
    const expiresOn = s.expiresOn === undefined ? undefined : str(s.expiresOn, 10);
    if (expiresOn !== undefined && !isValidDate(expiresOn)) { problems.push(`抑制 ${i + 1} 件目: 期限は YYYY-MM-DD の日付で書いてください`); return; }
    seenKeys.add(key);
    settings.suppressions.push({ key, reason, ...(expiresOn ? { expiresOn } : {}), ...(str(s.by, 100) ? { by: str(s.by, 100) } : {}), at, severity, section, message });
  });

  const seenRules = new Set<string>();
  (Array.isArray(raw.rules) ? raw.rules : []).forEach((r, i) => {
    if (settings.rules.length >= MAX_RULES) return;
    if (!isRecord(r)) { problems.push(`ルール ${i + 1} 件目: 形が正しくありません`); return; }
    const id = str(r.id, 40), name = str(r.name, 200);
    const target = (RULE_TARGETS as readonly string[]).includes(String(r.target)) ? (r.target as RuleTarget) : undefined;
    const path = str(r.path, 100);
    const severity = r.severity === "error" || r.severity === "warning" || r.severity === "info" ? r.severity : undefined;
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !name?.trim() || !target || !path || !severity) { problems.push(`ルール ${i + 1} 件目: ID (英数字・- _)・名前・対象・項目の場所・重大度が要ります`); return; }
    if (!isValidRulePath(path)) { problems.push(`ルール「${name}」: 項目の場所「${path}」は、英数字と . だけで書いてください`); return; }
    if (seenRules.has(id)) { problems.push(`ルール「${name}」: ID「${id}」が重複しています`); return; }
    const c = parseCheck(r.check);
    if (!c.check) { problems.push(`ルール「${name}」: ${c.problem}`); return; }
    let when: RuleWhen | undefined;
    if (r.when !== undefined) {
      if (!isRecord(r.when) || typeof r.when.path !== "string" || !isValidRulePath(r.when.path)) { problems.push(`ルール「${name}」: 適用する条件の項目の場所が正しくありません`); return; }
      const eq = r.when.equals;
      when = { path: r.when.path, ...(typeof eq === "string" || typeof eq === "number" || typeof eq === "boolean" ? { equals: eq } : {}), ...(r.when.notEmpty === true ? { notEmpty: true } : {}) };
    }
    seenRules.add(id);
    settings.rules.push({ id, name, target, path, check: c.check, severity, ...(when ? { when } : {}), ...(str(r.message) ? { message: str(r.message) } : {}), ...(r.enabled === false ? { enabled: false } : {}) });
  });
  return { settings, problems };
}
