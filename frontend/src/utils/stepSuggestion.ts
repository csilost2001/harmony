/**
 * 工程の挿入メニューで、「この後によく置かれる種類」を上に出すための統計と、組み込みの目安。
 *
 * ワークスペースの処理フローを走査して、「ある種類の直後に、どの種類が置かれているか」を数える。
 * 数がまだ少ない (ほとんど流れが無い) ときは、一般的な流れの目安 (BUILTIN_NEXT) で補う。
 */
import type { ProcessFlow } from "../types/v3";

/** 先頭 (どの工程の後でもない) を表すキー */
export const START = "^";

export type TransitionStats = Map<string, Map<string, number>>;

interface StepLike { id?: unknown; kind?: unknown }

function isStepList(v: unknown): v is StepLike[] {
  return Array.isArray(v) && v.length > 0 && v.every((e) => e && typeof e === "object" && typeof (e as StepLike).kind === "string" && typeof (e as StepLike).id === "string");
}

/** 処理フロー (または任意の JSON) の中の、工程の並び (入れ子を含む) を順に渡す。 */
export function forEachStepList(root: unknown, cb: (steps: StepLike[]) => void, depth = 0): void {
  if (depth > 40 || root === null || typeof root !== "object") return;
  if (Array.isArray(root)) {
    if (isStepList(root)) cb(root);
    for (const el of root) forEachStepList(el, cb, depth + 1);
    return;
  }
  for (const v of Object.values(root as Record<string, unknown>)) forEachStepList(v, cb, depth + 1);
}

export function buildTransitionStats(flows: Iterable<ProcessFlow>): TransitionStats {
  const stats: TransitionStats = new Map();
  const bump = (prev: string, next: string) => {
    const row = stats.get(prev) ?? new Map<string, number>();
    row.set(next, (row.get(next) ?? 0) + 1);
    stats.set(prev, row);
  };
  for (const flow of flows) {
    forEachStepList(flow, (steps) => {
      steps.forEach((s, i) => bump(i === 0 ? START : String(steps[i - 1].kind), String(s.kind)));
    });
  }
  return stats;
}

/** 組み込みの目安: 一般的な処理の流れ (ワークスペースに十分な実績が無いときの補い)。 */
export const BUILTIN_NEXT: Record<string, string[]> = {
  [START]: ["validation", "dbAccess", "compute"],
  validation: ["dbAccess", "branch", "compute"],
  dbAccess: ["branch", "compute", "log"],
  compute: ["dbAccess", "branch", "return"],
  branch: ["log", "dbAccess", "return"],
  externalSystem: ["branch", "compute", "log"],
  componentCall: ["branch", "compute", "log"],
  transactionScope: ["log", "eventPublish", "return"],
  loop: ["compute", "dbAccess", "log"],
  log: ["return", "screenTransition", "displayUpdate"],
  audit: ["return", "log"],
  eventPublish: ["return", "log"],
  displayUpdate: ["screenTransition", "return"],
  screenTransition: ["return"],
};

export interface NextKindSuggestion {
  kind: string;
  /** ワークスペースでの実績 (回数)。目安だけのときは undefined */
  count?: number;
  source: "このワークスペース" | "よくある流れ";
}

/** 直前の種類 (無ければ先頭) の後に置かれやすい種類を、最大 limit 件返す。選べる種類 (kinds) の中からだけ。 */
export function suggestNextKinds(
  kinds: readonly string[],
  prev: string | undefined,
  stats?: TransitionStats,
  limit = 3,
): NextKindSuggestion[] {
  const allowed = new Set(kinds);
  const row = stats?.get(prev ?? START);
  const fromStats = row
    ? [...row.entries()].filter(([k, n]) => allowed.has(k) && n >= 2).sort((a, b) => b[1] - a[1]).map(([kind, count]) => ({ kind, count, source: "このワークスペース" as const }))
    : [];
  const out: NextKindSuggestion[] = fromStats.slice(0, limit);
  for (const kind of BUILTIN_NEXT[prev ?? START] ?? []) {
    if (out.length >= limit) break;
    if (allowed.has(kind) && !out.some((o) => o.kind === kind)) out.push({ kind, source: "よくある流れ" });
  }
  return out;
}

/** 工程 id から、その工程の種類を探す。 */
export function findStepKind(flow: unknown, stepId: string): string | undefined {
  let found: string | undefined;
  forEachStepList(flow, (steps) => {
    for (const s of steps) if (s.id === stepId) found = String(s.kind);
  });
  return found;
}
