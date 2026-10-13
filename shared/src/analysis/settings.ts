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
 * 利用者が書く正規表現の安全性の簡易検査。入れ子の繰り返し (`(a+)+` など) と後方参照は、
 * 入力しだいで極端に遅くなる (ReDoS) ので受け付けない。長さにも上限を置く。
 */
export function checkRegexSafety(pattern: string, flags?: string): string | null {
  if (pattern.length === 0) return "正規表現が空です";
  if (pattern.length > 200) return "正規表現が長すぎます (200 文字まで)";
  if (flags !== undefined && !/^[imsu]*$/.test(flags)) return "正規表現のフラグは i / m / s / u だけ使えます";
  if (/\\[1-9]|\\k</.test(pattern)) return "後方参照は使えません";
  // 繰り返しのついたグループの中に、さらに繰り返しがある
  if (/\((?:[^()\\]|\\.)*[*+}](?:[^()\\]|\\.)*\)[*+{]/.test(pattern)) return "繰り返しの入れ子 (例: (a+)+) は使えません";
  try { new RegExp(pattern, flags); } catch (e) { return `正規表現として読めません: ${e instanceof Error ? e.message : String(e)}`; }
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
