/**
 * 「流れ」表示で、工程を置くときの、ひな型。必要な欄が空の状態で入る (あとから、その場で直せる)。
 *
 * - 型ごとの 1 工程 (DB・繰り返し・まとまり・承認 ほか。すべての種類は「ほかの種類」から)
 * - 業務で毎回出る、複数工程の型: 「ガード」(〜なら、ここで返す)・「1 件取得して、無ければ返す」
 *
 * 仕様: docs/spec/process-flow-story-view.md
 */
import type { ActionDefinition, Step, StepKind } from "../../../types/v3";
import { createDefaultStep } from "../../../store/processFlowStore";
import { nextLocalId } from "../../../utils/localIdGenerator";

type Rec = Record<string, unknown>;
const rec = (s: unknown): Rec => s as Rec;

export interface TemplateCtx {
  /** 流れ全体の、使用済みの ID (作った分は、この集合に足される) */
  ids: Set<string>;
  responses: ActionDefinition["responses"];
  /** すでにある変数の名前 */
  usedVars: ReadonlySet<string>;
  /** 入力のうち、一覧 (配列) の名前。繰り返しの「何の一覧か」の初期値に使う */
  arrayInputs?: readonly string[];
}

export interface StoryTemplate {
  key: string;
  label: string;
  description: string;
  /** 検索に使う言葉 (読み・別の呼び方) */
  keywords: string[];
  build: (ctx: TemplateCtx) => Step[];
}

/** base が使われていれば、2, 3… を付ける */
export function uniqueName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
  return `${base}${used.size + 1}`;
}

/** 「返す」の応答の候補: 失敗系 (4xx / 5xx) の最初。無ければ最初の応答 */
function errorResponseId(ctx: TemplateCtx, prefer?: number): string | undefined {
  const rs = ctx.responses ?? [];
  return (prefer ? rs.find((r) => r.status === prefer) : undefined)?.id ?? rs.find((r) => r.status >= 400)?.id ?? rs[0]?.id;
}

function makeReturn(ctx: TemplateCtx, prefer?: number): Step {
  const s = createDefaultStep("return", ctx.ids);
  const id = errorResponseId(ctx, prefer);
  if (id) rec(s).responseId = id;
  return s;
}

/** 「〜なら、ここで返す」: 腕が 1 つで、中が「返す」だけ。それ以外の道は、次へ進む */
function makeGuard(ctx: TemplateCtx, condition: string, description: string, prefer?: number): Step {
  const g = createDefaultStep("branch", ctx.ids);
  const o = rec(g);
  const arms = o.branches as Rec[];
  const armA = arms[0];
  armA.condition = { kind: "expression", expression: condition };
  armA.steps = [makeReturn(ctx, prefer)];
  o.branches = [armA];
  const elseId = nextLocalId(ctx.ids, "br", 2);
  ctx.ids.add(elseId);
  o.elseBranch = { id: elseId, code: "B", steps: [] };
  o.description = description;
  return g;
}

const one = (kind: StepKind, patch: Rec = {}): ((ctx: TemplateCtx) => Step[]) => (ctx) => {
  const s = createDefaultStep(kind, ctx.ids);
  Object.assign(rec(s), patch);
  return [s];
};

export const TEMPLATES: StoryTemplate[] = [
  {
    key: "guard",
    label: "ガードを置く",
    description: "〜なら、ここで終わりにして返す (例: 取引停止ならエラー)",
    keywords: ["がーど", "確認", "チェック", "エラー", "返す", "停止", "guard", "if", "分岐"],
    build: (ctx) => [makeGuard(ctx, "", "")],
  },
  {
    key: "decision",
    label: "条件の組み合わせで分ける (判定表)",
    description: "複数の条件の組み合わせで、道を分ける。表で、○ × を付けて決める",
    keywords: ["はんていひょう", "判定表", "分岐", "組み合わせ", "複合", "条件", "decision", "branch", "もし"],
    build: (ctx) => {
      const b = createDefaultStep("branch", ctx.ids);
      const o = rec(b);
      const arms = o.branches as Rec[];
      // 既定で、条件が空の道 A・B が入る。条件は、判定表で決める
      for (const a of arms) { a.condition = { kind: "expression", expression: "" }; a.steps = []; }
      const elseId = nextLocalId(ctx.ids, "br", 2);
      ctx.ids.add(elseId);
      o.elseBranch = { id: elseId, code: "X", steps: [] };
      o.description = "";
      return [b];
    },
  },
  {
    key: "lookup",
    label: "1 件取得して、無ければ返す",
    description: "取得と、「見つからなければ 404」を、2 行まとめて置く",
    keywords: ["しゅとく", "検索", "存在", "なければ", "404", "select", "lookup", "dbから"],
    build: (ctx) => {
      const db = createDefaultStep("dbAccess", ctx.ids);
      const name = uniqueName("found", ctx.usedVars);
      rec(db).outputBinding = { name };
      const guard = makeGuard(ctx, `@${name} == null`, "見つからなければ返す", 404);
      return [db, guard];
    },
  },
  { key: "db", label: "DB から取得 / 登録 / 更新", description: "テーブルを選んで、検索・登録・更新・削除する", keywords: ["でーたべーす", "db", "テーブル", "select", "insert", "update", "delete", "検索", "登録", "更新"], build: (ctx) => {
    const s = createDefaultStep("dbAccess", ctx.ids);
    rec(s).outputBinding = { name: uniqueName("result", ctx.usedVars) };
    return [s];
  } },
  { key: "validation", label: "入力を確かめる", description: "必須・形式・範囲などのルールを並べる", keywords: ["にゅうりょく", "チェック", "必須", "validation", "検証"], build: one("validation") },
  {
    key: "loop",
    label: "明細を 1 行ずつ繰り返す",
    description: "一覧の各行に、同じ処理をする",
    keywords: ["くりかえし", "ループ", "明細", "loop", "foreach", "各行"],
    build: (ctx) => {
      const s = createDefaultStep("loop", ctx.ids);
      // 一覧は、入力に配列があれば、その最初。無ければ空のまま (あとで選ぶ。本物に見える仮の値は入れない)
      Object.assign(rec(s), { loopKind: "collection", collectionSource: ctx.arrayInputs?.[0] ? `@inputs.${ctx.arrayInputs[0]}` : "", collectionItemName: uniqueName("line", ctx.usedVars) });
      return [s];
    },
  },
  { key: "tx", label: "1 まとまりにする (失敗したら全部取り消す)", description: "登録・更新を、まとめて確定するとき", keywords: ["とらんざくしょん", "まとまり", "tx", "transaction", "確定", "ロールバック"], build: (ctx) => {
    const s = createDefaultStep("transactionScope", ctx.ids);
    rec(s).outputBinding = { name: uniqueName("txResult", ctx.usedVars), expose: ["committed", "error"] };
    return [s];
  } },
  {
    key: "workflow",
    label: "承認を取る",
    description: "金額や状態によって、上長の承認を待つ。却下・期限切れの道つき",
    keywords: ["しょうにん", "承認", "workflow", "ワークフロー", "決裁"],
    build: (ctx) => {
      const s = createDefaultStep("workflow", ctx.ids);
      Object.assign(rec(s), { onApproved: [], onRejected: [makeReturn(ctx, 403)], onTimeout: [makeReturn(ctx, 422)] });
      return [s];
    },
  },
  { key: "external", label: "外部システムに問い合わせる", description: "配送会社・決済などの API を呼ぶ", keywords: ["がいぶ", "api", "外部", "external", "連携"], build: (ctx) => {
    const s = createDefaultStep("externalSystem", ctx.ids);
    rec(s).outputBinding = { name: uniqueName("response", ctx.usedVars) };
    return [s];
  } },
  { key: "compute", label: "計算して覚える", description: "合計や判定結果を、あとで使えるようにする", keywords: ["けいさん", "計算", "代入", "compute", "合計"], build: (ctx) => {
    const s = createDefaultStep("compute", ctx.ids);
    rec(s).outputBinding = { name: uniqueName("value", ctx.usedVars) };
    return [s];
  } },
  { key: "return", label: "結果を返す", description: "ここで終わりにして、応答を返す", keywords: ["かえす", "返す", "応答", "return", "レスポンス"], build: (ctx) => [makeReturn(ctx, 200)] },
  { key: "event", label: "イベントを知らせる", description: "出荷・請求など、ほかの処理へ知らせる", keywords: ["いべんと", "通知", "event", "publish"], build: one("eventPublish") },
  { key: "log", label: "ログ・監査を残す", description: "あとで追えるように、記録する", keywords: ["ろぐ", "監査", "log", "audit", "記録"], build: one("log") },
];

/** すべての種類 (「ほかの種類」から選ぶ)。ひな型の 1 工程と、同じ作り方 */
export function buildKind(kind: StepKind, ctx: TemplateCtx): Step[] {
  const s = createDefaultStep(kind, ctx.ids);
  return [s];
}

export function searchTemplates(query: string): StoryTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return TEMPLATES;
  return TEMPLATES.filter((t) => `${t.label} ${t.description} ${t.keywords.join(" ")}`.toLowerCase().includes(q));
}
