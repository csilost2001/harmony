/**
 * 分岐の判定表 (UI 改善提案 続編 第 8 弾 #149)。処理フローの分岐の工程ごとに、枝 (条件・行われる処理) を表にし、抜け・重複を指摘する。
 * 条件の組み合わせを網羅する本格的な判定表ではなく、「枝の一覧と、見落としの指摘」(条件式は、文字として比べる)。画面に依存しない純関数。
 */
import { branchConditionText, kindLabel, stepText, type FlowStep } from "@harmony/shared";

export interface DecisionArm {
  code: string;
  label: string;
  /** 条件の文字 (else は「上記以外」) */
  condition: string;
  stepCount: number;
  /** 枝の中の、最初の工程の説明 */
  firstStep: string;
  isElse: boolean;
}

export interface DecisionTable {
  stepId: string;
  title: string;
  arms: DecisionArm[];
  issues: string[];
}

type AnyStep = FlowStep & Record<string, unknown>;

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function* walk(steps: readonly FlowStep[] | undefined): Generator<FlowStep> {
  for (const s of steps ?? []) {
    yield s;
    const x = s as AnyStep;
    const lists: unknown[] = [x.subSteps, x.steps, x.onCommit, x.onRollback];
    if (Array.isArray(x.branches)) for (const b of x.branches as Array<{ steps?: unknown }>) lists.push(b?.steps);
    const eb = x.elseBranch as { steps?: unknown } | undefined;
    if (eb) lists.push(eb.steps);
    for (const l of lists) if (Array.isArray(l)) yield* walk(l as FlowStep[]);
  }
}

const first = (steps: readonly FlowStep[] | undefined): string => (steps && steps.length ? `${kindLabel(steps[0])}: ${stepText(steps[0])}` : "");

export function buildDecisionTables(steps: readonly FlowStep[]): DecisionTable[] {
  const out: DecisionTable[] = [];
  for (const s of walk(steps)) {
    if (s.kind !== "branch") continue;
    const x = s as AnyStep;
    const branches = (x.branches as Array<{ code: string; label?: string; condition: unknown; steps?: FlowStep[] }> | undefined) ?? [];
    const arms: DecisionArm[] = branches.map((b) => ({
      code: b.code, label: b.label ?? "", condition: branchConditionText(b.condition), stepCount: b.steps?.length ?? 0, firstStep: first(b.steps), isElse: false,
    }));
    const eb = x.elseBranch as { code?: string; label?: string; steps?: FlowStep[] } | undefined;
    if (eb) arms.push({ code: eb.code ?? "else", label: eb.label ?? "上記以外", condition: "上記以外", stepCount: eb.steps?.length ?? 0, firstStep: first(eb.steps), isElse: true });

    const issues: string[] = [];
    if (!eb) issues.push("「上記以外」の枝がありません。どの条件にも合わないとき、何も起きません");
    const seen = new Map<string, string>();
    for (const a of arms.filter((x2) => !x2.isElse)) {
      if (!a.condition.trim()) issues.push(`枝 ${a.code} の条件が空です`);
      else {
        const k = norm(a.condition);
        const prev = seen.get(k);
        if (prev) issues.push(`枝 ${prev} と ${a.code} は、同じ条件です (後ろの枝は、実行されません)`);
        else seen.set(k, a.code);
      }
    }
    for (const a of arms) if (a.stepCount === 0) issues.push(`枝 ${a.code} の中に工程がありません`);
    out.push({ stepId: s.id, title: stepText(s), arms, issues });
  }
  return out;
}
