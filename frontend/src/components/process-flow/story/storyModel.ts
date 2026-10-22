/**
 * 処理フローの「流れ」表示のための、純粋な解析 (表示に依存しない)。
 *
 * - 入れ子の取り出し (分岐の腕・繰り返し・トランザクション・承認の結果 ほか)
 * - ガード (「〜なら、ここで返す」だけの判定) の判別
 * - 見出しによる区切り
 * - 出口 (どう終わるか) と、そこへ行く条件の道すじ
 * - 変数の流れ (作る場所・使う場所)
 * - 行の見出し・印 (チップ)・コード
 *
 * 仕様: docs/spec/process-flow-story-view.md
 */
import { dbOperationLabel, kindLabel, returnStatus, type FlowContext, type FlowStep } from "@harmony/shared";
import type { ActionDefinition, Step } from "../../../types/v3";
import { buildVarLabels, conditionText, expressionSegments, parseVarRef, segsToText, type VarLabels } from "@harmony/shared";
import { selectShape, type ShapeEnv } from "./sqlShape";

/** 型の細かい違い (拡張 step など) を気にせず読むための、ゆるい形 */
export type Loose = FlowStep & Record<string, unknown>;
export const asLoose = (s: Step | FlowStep): Loose => s as unknown as Loose;
export const asLooseList = (l: readonly (Step | FlowStep)[] | undefined): Loose[] => (Array.isArray(l) ? l : []) as unknown as Loose[];

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

// ─── 入れ子 ────────────────────────────────────────────

export type GroupRole = "arm" | "else" | "body" | "ng" | "ok" | "approved" | "rejected" | "timeout" | "commit" | "rollback" | "sub";

export interface ChildGroup {
  /** 同じ工程の中で一意 (描画のキー・追加先の指定に使う) */
  key: string;
  role: GroupRole;
  /** 腕・結果の呼び名 (「取引先が存在しない」など) */
  label: string;
  /** 分岐の腕の条件 */
  condition?: unknown;
  /** 番号に含める記号。腕は A, B…、それ以外は役割ごとの 1 文字 (「3-A-1」「6-確-1」)。本体は無し (「7.1」) */
  code?: string;
  steps: Loose[];
}

/** その工程の中に入る、工程の並び。順序は、読む順。editing のときは、空の枠 (確定したあと・取り消したあと・不正なときの処理) も出す (中に足せるように) */
export function childGroups(step: Loose, editing = false): ChildGroup[] {
  const out: ChildGroup[] = [];
  const add = (g: ChildGroup) => out.push(g);
  switch (step.kind) {
    case "branch": {
      asLooseList(step.branches as Step[] | undefined).forEach((b, i) => {
        const br = b as unknown as Record<string, unknown>;
        add({ key: `arm:${str(br.id) || i}`, role: "arm", label: str(br.label), condition: br.condition, code: str(br.code) || String.fromCharCode(65 + i), steps: asLooseList(br.steps as Step[]) });
      });
      const e = rec(step.elseBranch);
      if (step.elseBranch) add({ key: "else", role: "else", label: str(e.label), code: str(e.code) || "X", steps: asLooseList(e.steps as Step[]) });
      break;
    }
    case "loop":
      add({ key: "body", role: "body", label: "", steps: asLooseList(step.steps as Step[]) });
      break;
    case "transactionScope":
      add({ key: "body", role: "body", label: "", steps: asLooseList(step.steps as Step[]) });
      if (Array.isArray(step.onCommit) && (editing || step.onCommit.length)) add({ key: "commit", role: "commit", label: "確定したあと", steps: asLooseList(step.onCommit as Step[]) });
      if (Array.isArray(step.onRollback) && (editing || step.onRollback.length)) add({ key: "rollback", role: "rollback", label: "取り消したあと", steps: asLooseList(step.onRollback as Step[]) });
      break;
    case "validation": {
      const ib = rec(step.inlineBranch);
      if (Array.isArray(ib.ok) && ib.ok.length) add({ key: "ok", role: "ok", label: "すべて正しければ", steps: asLooseList(ib.ok as Step[]) });
      if (Array.isArray(ib.ng) && (editing || ib.ng.length)) add({ key: "ng", role: "ng", label: "ひとつでも不正なら", steps: asLooseList(ib.ng as Step[]) });
      break;
    }
    case "workflow":
      if (Array.isArray(step.onApproved)) add({ key: "approved", role: "approved", label: "承認されたら", steps: asLooseList(step.onApproved as Step[]) });
      if (Array.isArray(step.onRejected)) add({ key: "rejected", role: "rejected", label: "却下されたら", steps: asLooseList(step.onRejected as Step[]) });
      if (Array.isArray(step.onTimeout)) add({ key: "timeout", role: "timeout", label: "期限が切れたら", steps: asLooseList(step.onTimeout as Step[]) });
      break;
    default:
      break;
  }
  if (Array.isArray(step.subSteps) && step.subSteps.length) add({ key: "sub", role: "sub", label: "このあとに続けて", steps: asLooseList(step.subSteps as Step[]) });
  const ROLE_CODES: Partial<Record<GroupRole, string>> = { ng: "NG", ok: "OK", approved: "承", rejected: "却", timeout: "期", commit: "確", rollback: "戻", sub: "続" };
  for (const g of out) if (!g.code) g.code = ROLE_CODES[g.role];
  return out;
}

/** 工程を、入れ子ごと順に歩く */
export function walkSteps(steps: readonly Loose[], visit: (s: Loose, parent: Loose | null, depth: number) => void, parent: Loose | null = null, depth = 0): void {
  for (const s of steps) {
    visit(s, parent, depth);
    for (const g of childGroups(s)) walkSteps(g.steps, visit, s, depth + 1);
  }
}

export function countSteps(steps: readonly Loose[]): number {
  let n = 0;
  walkSteps(steps, () => { n++; });
  return n;
}

/** 「〜なら、ここで返す」だけの判定か (腕が 1 つで、その中が「返す」1 つ。それ以外の道は、次へ進む) */
export function isGuardBranch(step: Loose): boolean {
  if (step.kind !== "branch") return false;
  const groups = childGroups(step);
  const arms = groups.filter((g) => g.role === "arm");
  const els = groups.find((g) => g.role === "else");
  if (arms.length !== 1) return false;
  if (els && els.steps.length > 0) return false;
  if (groups.some((g) => g.role !== "arm" && g.role !== "else")) return false;
  return arms[0].steps.length === 1 && arms[0].steps[0].kind === "return";
}

/** 「確認済み」を付ける対象 (画面に行として出る工程)。ガードの中の「返す」と、繰り返しの出入り口は含めない */
export function reviewTargets(steps: readonly Loose[]): Loose[] {
  const out: Loose[] = [];
  const rec = (list: readonly Loose[]) => {
    for (const s of list) {
      if (s.kind === "loopContinue" || s.kind === "loopBreak") continue;
      out.push(s);
      if (isGuardBranch(s)) continue;
      for (const g of childGroups(s)) rec(g.steps);
    }
  };
  rec(steps);
  return out;
}

// ─── 変数の名前・条件の言葉 (本体は @harmony/shared。設計書と共有) ───

export { buildVarLabels, conditionSegments, conditionText, type VarLabels } from "@harmony/shared";

// ─── 見出しによる区切り ─────────────────────────────────

export interface StorySection {
  /** 見出し (なければ null: 見出しの前の工程、または見出しが 1 つも無い流れ) */
  heading: string | null;
  steps: Loose[];
  /** 全体の中での、最初の工程の番号 (0 始まり) */
  startIndex: number;
}

/** 最上位の工程を、見出し (`heading`) のある工程から新しい区切りにして並べる */
export function sectionsOf(steps: readonly Loose[]): StorySection[] {
  const out: StorySection[] = [];
  steps.forEach((s, i) => {
    const h = str(s.heading).trim();
    const last = out[out.length - 1];
    if (h || !last) out.push({ heading: h || null, steps: [s], startIndex: i });
    else last.steps.push(s);
  });
  return out;
}

// ─── 出口 ──────────────────────────────────────────────

export interface ExitInfo {
  stepId: string;
  status: number | undefined;
  /** 4xx / 5xx */
  error: boolean;
  /** 応答の説明、なければ工程の説明 */
  label: string;
  /** そこへ行く条件の道すじ (外側から順に) */
  path: string[];
}

export function collectExits(action: Pick<ActionDefinition, "steps" | "responses" | "inputs">, labels: VarLabels = buildVarLabels(action)): ExitInfo[] {
  const out: ExitInfo[] = [];
  const walk = (steps: readonly Loose[], path: string[]) => {
    for (const s of steps) {
      const p = s.runIf ? [...path, `「${segsToText(expressionSegments(str(s.runIf)), labels.full)}」のとき`] : path;
      if (s.kind === "return") {
        const status = returnStatus(s, action);
        const resp = action.responses?.find((r) => r.id === s.responseId);
        out.push({ stepId: s.id, status, error: (status ?? 200) >= 400, label: resp?.description || str(s.description), path: p });
        continue;
      }
      if (s.kind === "validation") {
        const ib = rec(s.inlineBranch);
        const ng = Array.isArray(ib.ng) ? (ib.ng as Array<{ kind?: string }>) : [];
        if (str(ib.ngResponseId) && !ng.some((x) => x.kind === "return")) {
          const resp = action.responses?.find((r) => r.id === ib.ngResponseId);
          const m = str(ib.ngResponseId).match(/^(\d{3})/);
          const status = resp?.status ?? (m ? Number(m[1]) : undefined);
          out.push({ stepId: s.id, status, error: (status ?? 400) >= 400, label: resp?.description || str(s.description), path: [...p, "入力が不正"] });
        }
      }
      const groups = childGroups(s);
      const armLabels = groups.filter((g) => g.role === "arm").map((g) => g.label || conditionText(g.condition, labels)).filter(Boolean);
      for (const g of groups) {
        let step: string;
        switch (g.role) {
          case "arm": step = conditionText(g.condition, labels) || g.label; break;
          case "else": step = armLabels.length ? `「${armLabels.join("」「")}」のどれでもない` : "それ以外"; break;
          case "ng": step = "入力が不正"; break;
          case "approved": step = "承認された"; break;
          case "rejected": step = "却下された"; break;
          case "timeout": step = "期限が切れた"; break;
          case "commit": step = "確定したあと"; break;
          case "rollback": step = "取り消したあと"; break;
          case "body": step = s.kind === "loop" ? `${str(s.collectionItemLabel) || "繰り返しの 1 回"}ごとの途中で` : "まとまりの中で"; break;
          case "sub": step = "あとに続く工程で"; break;
          default: step = g.label;
        }
        walk(g.steps, step ? [...p, step] : p);
      }
    }
  };
  walk(asLooseList(action.steps as Step[]), []);
  return out;
}

// ─── 変数の流れ ────────────────────────────────────────

export interface VarInfo {
  name: string;
  label: string;
  /** 作る工程 */
  defIds: string[];
  /** 使う工程 */
  useIds: string[];
  how: "binding" | "loopItem" | "loopIndex" | "fieldErrors" | "errorVar";
}

const CHILD_KEYS = new Set(["steps", "subSteps", "elseBranch", "onApproved", "onRejected", "onTimeout", "onCommit", "onRollback", "inlineBranch", "branches"]);

/** キーの並び順に依らない文字列 (保存で並びが変わっても、指紋が変わらないように) */
function stableStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => (val && typeof val === "object" && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : val));
}

/** その工程そのものに書かれた文字列 (入れ子の中は含めない)。変数の参照を探すのに使う */
export function ownText(step: Loose): string {
  const own: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) if (!CHILD_KEYS.has(k)) own[k] = v;
  let s = stableStringify(own);
  if (Array.isArray(step.branches)) s += stableStringify((step.branches as unknown as Array<Record<string, unknown>>).map((b) => b.condition));
  const ib = rec(step.inlineBranch);
  if (Object.keys(ib).length) s += JSON.stringify({ a: ib.ngBodyExpression, b: ib.ngResponseId, c: ib.ngJumpTo, d: ib.ngEventPublish });
  return s;
}

/** 変数の参照 (`@x` / `@var.x` / `@var.action|loop|flowParameter|global.x` / `@var.step|tx.<工程>.x`)。名前は 1〜5 のどれかに入る */
const REF_RE = /@var\.(?:action|loop|flowParameter|global)\.([A-Za-z_]\w*)|@var\.(?:step|tx)\.[\w-]+\.([A-Za-z_]\w*)|@var\.([A-Za-z_]\w*)|@([A-Za-z_]\w*)/g;

export function variableFlow(action: Pick<ActionDefinition, "steps" | "inputs">, labels: VarLabels = buildVarLabels(action)): VarInfo[] {
  const defs = new Map<string, VarInfo>();
  const define = (name: string, id: string, how: VarInfo["how"]) => {
    if (!name) return;
    const cur = defs.get(name);
    if (cur) { if (!cur.defIds.includes(id)) cur.defIds.push(id); return; }
    defs.set(name, { name, label: labels.base(name), defIds: [id], useIds: [], how });
  };
  const all: Loose[] = [];
  walkSteps(asLooseList(action.steps as Step[]), (s) => {
    all.push(s);
    define(str(rec(s.outputBinding).name), s.id, "binding");
    if (s.kind === "loop") { define(str(s.collectionItemName), s.id, "loopItem"); define(str(s.collectionIndexName), s.id, "loopIndex"); }
    if (s.kind === "validation") define(str(s.fieldErrorsVar), s.id, "fieldErrors");
    if (s.kind === "branch") for (const g of childGroups(s)) { const c = rec(g.condition); if (c.kind === "tryCatch") define(str(c.errorVar), s.id, "errorVar"); }
  });
  for (const s of all) {
    const text = ownText(s);
    const seen = new Set<string>();
    for (const m of text.matchAll(REF_RE)) {
      const name = m[1] ?? m[2] ?? m[3] ?? m[4];
      const info = defs.get(name);
      if (!info || seen.has(name)) continue;
      seen.add(name);
      // 自分が作るだけ (その工程の中で参照していない) は、使うには数えない
      info.useIds.push(s.id);
    }
  }
  return [...defs.values()];
}

// ─── 行の印 (チップ)・コード ────────────────────────────

export type ChipTone = "table" | "rule" | "var" | "ok" | "error" | "warn";
/** 編集中に、クリックで直せる印の種類 */
export type ChipEdit = "table" | "operation" | "binding" | "response" | "ngResponse" | "collection" | "rules" | "sql" | "approvers" | "external";

export interface Chip {
  text: string;
  tone?: ChipTone;
  edit?: ChipEdit;
  /** 変数の印: クリックで、作る場所と使う場所を光らせる */
  varName?: string;
  title?: string;
}

export interface StoryCtx {
  flow: FlowContext;
  action: Pick<ActionDefinition, "name" | "responses" | "inputs" | "steps">;
  labels: VarLabels;
  /** テーブルの 1 行を決める列 (検索の結果が 1 件か一覧かの推定に使う)。分からなければ無し */
  shapeEnv?: ShapeEnv;
}

/** 更新・削除の件数のチェックを、言葉に (演算子と、外れたときの動きまで) */
function affectedRowsText(c: Record<string, unknown>): string {
  if (c.expected === undefined) return "";
  const n = String(c.expected);
  const cond = ({ "=": `${n} 件ちょうど`, ">": `${n} 件より多い`, ">=": `${n} 件以上`, "<": `${n} 件未満`, "<=": `${n} 件以下` } as Record<string, string>)[str(c.operator) || "="] ?? `${str(c.operator)} ${n} 件`;
  const miss = ({ throw: "失敗", abort: "中止", log: "記録だけ", continue: "そのまま続ける" } as Record<string, string>)[str(c.onViolation) || "throw"] ?? str(c.onViolation);
  return `更新件数が ${cond}。外れたら${miss}${str(c.errorCode) ? ` (${str(c.errorCode)})` : ""}`;
}

/** 入力チェックの規則 1 つの言葉 (重さ・範囲・参照まで) */
function ruleText(r: Record<string, unknown>): string {
  const type = str(r.type);
  const num = (v: unknown, ref: unknown) => (v !== undefined ? String(v) : str(ref) ? `(${str(ref)})` : "");
  let detail = "";
  if (type === "maxLength" || type === "minLength") detail = ` ${num(r.length, r.lengthRef)}`;
  else if (type === "range") {
    const lo = num(r.min, r.minRef);
    const hi = num(r.max, r.maxRef);
    detail = ` ${lo}〜${hi}`;
  } else if (type === "regex") detail = ` ${str(r.patternRef) || str(r.pattern)}`;
  else if (type === "enum" && Array.isArray(r.values)) detail = ` ${(r.values as unknown[]).map(String).join(" / ")}`;
  const sev = ({ msg: "（知らせるだけ）", noaccept: "（受け付けない）", default: "（既定値を入れる）" } as Record<string, string>)[str(r.severity)] ?? "";
  return `${FIELD_RULE_WORDS[type] ?? type}${detail.trimEnd() ? detail : ""}${sev}`;
}

const FIELD_RULE_WORDS: Record<string, string> = {
  required: "必須",
  regex: "形式",
  maxLength: "最大",
  minLength: "最小",
  range: "範囲",
  enum: "選択肢",
  custom: "独自の式",
};

function sqlWhere(sql: string): string {
  const m = sql.match(/\bWHERE\b\s+([\s\S]*?)(?:\bGROUP BY\b|\bORDER BY\b|\bLIMIT\b|$)/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : "";
}

const WORKFLOW_PATTERN_WORDS: Record<string, string> = {
  "approval-sequential": "順番に承認",
  "approval-parallel": "同時に承認",
  "approval-veto": "拒否権つきの承認",
  "approval-quorum": "定足数の承認",
  "approval-escalation": "期限でエスカレーション",
  review: "レビュー",
  "sign-off": "サインオフ",
  acknowledge: "確認",
  "branch-merge": "分岐と合流",
  discussion: "協議",
  "ad-hoc": "その場で決める",
};

function outputChip(step: Loose): Chip[] {
  const ob = rec(step.outputBinding);
  const name = str(ob.name);
  return name ? [{ text: `→ ${str(ob.label) || name}`, tone: "var", varName: name, edit: "binding", title: `この工程で作る変数 ${name}` }] : [];
}

/** 行の下に並べる、短い印 */
export function stepChips(step: Loose, ctx: StoryCtx): Chip[] {
  const chips: Chip[] = [];
  switch (step.kind) {
    case "dbAccess": {
      const t = str(step.tableId);
      chips.push({ text: ctx.flow.tableName(t) ?? (t || "（テーブルを選ぶ）"), tone: t ? "table" : "warn", edit: "table" });
      chips.push({ text: dbOperationLabel(str(step.operation)), tone: "rule", edit: "operation" });
      const w = sqlWhere(str(step.sql));
      if (w) chips.push({ text: `条件: ${w.length > 48 ? `${w.slice(0, 48)}…` : w}`, tone: "rule", title: w, edit: "sql" });
      if (!str(step.sql) && str(step.naturalQuery)) chips.push({ text: `SQL はまだ: ${str(step.naturalQuery)}`, tone: "warn", edit: "sql" });
      const arc = affectedRowsText(rec(step.affectedRowsCheck));
      if (arc) chips.push({ text: arc, tone: "rule" });
      // 検索の結果が、一覧になりうるとき (1 件に絞る条件がないとき) は、印を出す: 0 件でも「ない」にならず、項目は `[0].列` で読む
      if (step.operation === "SELECT" && str(step.sql).trim() && str(rec(step.outputBinding).name) && selectShape(str(step.sql), ctx.shapeEnv) === "list") {
        chips.push({ text: "結果は一覧", tone: "rule", title: "1 件に絞る条件 (LIMIT 1・集計だけ・主キーや一意の列の一致) がないので、結果は一覧になりえます。一覧なら、0 件でも「ない」にはならず、1 件目は 〜[0].列 で読みます (SQL からの推定。1 件を返す設計なら、気にしなくて構いません)" });
      }
      chips.push(...outputChip(step));
      break;
    }
    case "validation": {
      for (const r of (step.rules as Array<Record<string, unknown>> | undefined) ?? []) {
        const field = ctx.labels.full("inputs", [str(r.field)]);
        chips.push({ text: `${field} ${ruleText(r)}`, tone: "rule", title: str(r.message), edit: "rules" });
      }
      const ib = rec(step.inlineBranch);
      const ngTo = str(ib.ngResponseId);
      if (ngTo) {
        const m = ngTo.match(/^(\d{3})/);
        const status = ctx.action.responses?.find((x) => x.id === ngTo)?.status ?? (m ? Number(m[1]) : undefined);
        chips.push({ text: `不正なら → ${status ? `${status} を返す` : `応答 ${ngTo} を返す`}`, tone: "error", edit: "ngResponse" });
      }
      if (str(ib.ngJumpTo)) chips.push({ text: `不正なら → 「${str(ib.ngJumpTo)}」へ移る`, tone: "error" });
      const ev = rec(ib.ngEventPublish);
      if (str(ev.topic)) chips.push({ text: `不正なら 通知 ${str(ev.topic)}`, tone: "rule" });
      break;
    }
    case "compute":
      chips.push(...outputChip(step));
      break;
    case "externalSystem": {
      chips.push({ text: str(step.systemRef) || "（接続先を決める）", tone: str(step.systemRef) ? "table" : "warn", edit: "external" });
      const h = rec(step.httpCall);
      if (str(h.method) || str(h.path)) chips.push({ text: `${str(h.method)} ${str(h.path)}`.trim(), tone: "rule", edit: "external" });
      if (typeof step.timeoutMs === "number") chips.push({ text: `${step.timeoutMs / 1000} 秒で待つ`, tone: "rule", edit: "external" });
      if (step.fireAndForget) chips.push({ text: "返事は待たない", tone: "rule", edit: "external" });
      chips.push(...outputChip(step));
      break;
    }
    case "workflow": {
      chips.push({ text: WORKFLOW_PATTERN_WORDS[str(step.pattern)] ?? (str(step.pattern) || "承認"), tone: "rule" });
      for (const a of (step.approvers as Array<Record<string, unknown>> | undefined) ?? []) chips.push({ text: `承認者: ${str(a.label) || str(a.role)}`, tone: "rule", edit: "approvers" });
      if (str(step.deadlineExpression)) chips.push({ text: `期限: ${str(step.deadlineExpression)}`, tone: "rule", edit: "approvers" });
      break;
    }
    case "eventPublish":
      chips.push({ text: str(step.topic), tone: "table" });
      break;
    case "eventSubscribe":
      chips.push({ text: str(step.topic), tone: "table" });
      break;
    case "loop": {
      const src = str(step.collectionSource);
      if (step.loopKind === "collection") {
        const v = src ? parseVarRef(src) : null;
        chips.push(src ? { text: `${v ? ctx.labels.full(v.name, v.path) : src} の 1 行ごと`, tone: "rule", edit: "collection" } : { text: "（繰り返す一覧を選ぶ）", tone: "warn", edit: "collection" });
      } else if (step.loopKind === "count") chips.push({ text: `${str(step.countExpression)} 回`, tone: "rule" });
      else if (step.loopKind === "condition") chips.push({ text: `${step.conditionMode === "exit" ? "次の条件になるまで" : "次の条件の間"}: ${str(step.conditionExpression)}`, tone: "rule" });
      break;
    }
    case "transactionScope": {
      if (str(step.isolationLevel)) chips.push({ text: str(step.isolationLevel), tone: "rule" });
      if (str(step.propagation) && step.propagation !== "REQUIRED") chips.push({ text: `参加のしかた ${str(step.propagation)}`, tone: "rule" });
      if (typeof step.timeoutMs === "number") chips.push({ text: `${step.timeoutMs / 1000} 秒`, tone: "rule" });
      chips.push(...outputChip(step));
      break;
    }
    case "return": {
      const status = returnStatus(step, ctx.action);
      const resp = ctx.action.responses?.find((r) => r.id === step.responseId);
      if (status) chips.push({ text: `${status}${resp?.description ? ` ${resp.description}` : ""}`, tone: status >= 400 ? "error" : "ok", edit: "response" });
      break;
    }
    case "log":
      chips.push({ text: str(step.level), tone: "rule" });
      break;
    case "audit":
      chips.push({ text: str(step.action), tone: "rule" });
      break;
    case "commonProcess":
      chips.push({ text: str(step.refId), tone: "table" }, ...outputChip(step));
      break;
    case "componentCall":
      chips.push({ text: `${str(step.componentRef).split("/").pop()}${str(step.operation) ? `.${str(step.operation)}` : ""}`, tone: "table" }, ...outputChip(step));
      break;
    case "screenTransition": {
      const id = str(step.targetScreenId);
      chips.push({ text: ctx.flow.screenName(id) ?? id, tone: "table" });
      break;
    }
    case "setGlobal":
      chips.push({ text: str(step.globalName), tone: "table" });
      break;
    default:
      chips.push(...outputChip(step));
  }
  return chips;
}

/** 「実装」の細かさで出す、SQL や式 */
export function stepCode(step: Loose): string | undefined {
  switch (step.kind) {
    case "dbAccess": return str(step.sql) || undefined;
    case "compute": return str(step.expression) || undefined;
    case "eventPublish": return str(step.payload) || undefined;
    case "return": return str(step.bodyExpression) || undefined;
    case "setGlobal": return str(step.value) || undefined;
    default: return undefined;
  }
}

/** 行の見出し。説明が無ければ、種別と対象 */
export function stepHeadline(step: Loose): string {
  return str(step.description).trim() || kindLabel(step);
}

/** 工程の内容の指紋。「確認済み」のあとに変わったかを見分ける (入れ子の中は含めない。ただし、ガードは、中の「返す」と腕の名前も含める) */
export function stepDigest(step: Loose): string {
  let s = ownText(step);
  if (step.kind === "branch") {
    s += JSON.stringify((asLooseList(step.branches as Step[])).map((b) => [b.code, b.label]));
    const e = rec(step.elseBranch);
    s += JSON.stringify([e.code, e.label, e.description]);
    if (isGuardBranch(step)) s += childGroups(step)[0].steps.map((r) => ownText(r)).join("|");
  }
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
