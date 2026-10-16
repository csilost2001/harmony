/**
 * 処理フローの変数 (UI 改善提案 続編 第 8 弾 #146)。どの変数が、どの工程で定義され、どの工程で使われているかを集める (画面に依存しない純関数)。
 * 変数の定義: 処理の入力 (`@inputs.名前`)・工程の出力の名前 (outputBinding)・繰り返しの 1 件ぶんの名前 (collectionItemName)・自動で入る変数 (ambient)。
 * 使われ方: 工程 (その工程自身の文章・条件・SQL・対応づけ) の中の `@名前` の参照。入れ子の中の工程は、それぞれ別に数える。
 */
import type { Step } from "../types/v3";

export type VariableOrigin = "input" | "output" | "loop" | "ambient";
export const VARIABLE_ORIGIN_LABELS: Record<VariableOrigin, string> = { input: "入力", output: "工程の出力", loop: "繰り返しの 1 件", ambient: "自動で入る変数" };

export interface VariableInfo {
  /** 参照の名前 (`@` を除く。入力は `inputs.名前`) */
  name: string;
  origin: VariableOrigin;
  label?: string;
  /** 定義している工程の id (入力・ambient は無し) */
  definedAt?: string;
  /** 使っている工程の id (出てきた順) */
  uses: string[];
}

interface ActionLike { inputs?: Array<{ name?: string; label?: string }>; steps?: Step[] }

const CHILD_KEYS = new Set(["subSteps", "steps", "onCommit", "onRollback", "onApproved", "onRejected", "onTimeout", "outputBinding", "id"]);

/** その工程自身の文字 (入れ子の工程・outputBinding・id を除いた JSON) */
function ownText(step: Step): string {
  return JSON.stringify(step, (k, v) => (CHILD_KEYS.has(k) ? undefined : v)) ?? "";
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `@名前` の参照 (名前の直後が単語の文字なら、別の名前) */
function refRegex(name: string): RegExp { return new RegExp(`@${escapeRe(name)}(?![\\w])`); }

function* walk(steps: readonly Step[] | undefined): Generator<Step> {
  for (const s of steps ?? []) {
    yield s;
    const x = s as unknown as Record<string, unknown>;
    const lists: unknown[] = [x.subSteps, x.steps, x.onCommit, x.onRollback, x.onApproved, x.onRejected, x.onTimeout];
    if (Array.isArray(x.branches)) for (const b of x.branches as Array<{ steps?: unknown }>) lists.push(b?.steps);
    const eb = x.elseBranch as { steps?: unknown } | undefined;
    if (eb) lists.push(eb.steps);
    for (const l of lists) if (Array.isArray(l)) yield* walk(l as Step[]);
  }
}

export function collectVariables(action: ActionLike, ambientNames: readonly string[] = []): VariableInfo[] {
  const defs: VariableInfo[] = [];
  const seen = new Set<string>();
  const add = (v: Omit<VariableInfo, "uses">) => { if (v.name && !seen.has(v.name)) { seen.add(v.name); defs.push({ ...v, uses: [] }); } };

  for (const i of action.inputs ?? []) if (i.name) add({ name: `inputs.${i.name}`, origin: "input", label: i.label });
  for (const n of ambientNames) add({ name: n.replace(/^@/, ""), origin: "ambient" });
  for (const s of walk(action.steps)) {
    const x = s as unknown as { outputBinding?: { name?: string }; collectionItemName?: string };
    const out = x.outputBinding?.name?.trim();
    if (out) add({ name: out, origin: "output", definedAt: s.id });
    if (x.collectionItemName) add({ name: x.collectionItemName, origin: "loop", definedAt: s.id });
  }

  const texts = [...walk(action.steps)].map((s) => ({ id: s.id, text: ownText(s) }));
  for (const d of defs) {
    const re = refRegex(d.name);
    for (const t of texts) if (re.test(t.text)) d.uses.push(t.id);
  }
  return defs;
}

/** 変数 name を使っている・定義している工程の id (強調する工程) */
export function stepsOfVariable(v: VariableInfo): { defines: string[]; uses: string[] } {
  return { defines: v.definedAt ? [v.definedAt] : [], uses: v.uses };
}
