/**
 * 処理フローの目次 (UI 改善提案 第 5 弾 #90)。工程の入れ子 (配下の工程・分岐・繰り返し・トランザクション) を、深さつきの 1 本の並びにする。
 * 画面に依存しない純関数。番号は、1・2・2.1・2.2 のように、入れ子を点でつなぐ。
 */
import type { Step } from "../types/v3";
import { STEP_TYPE_LABELS } from "./processFlowMetadata";

export interface OutlineItem {
  id: string;
  /** 1 / 2.1 / 3.2.1 */
  number: string;
  depth: number;
  kind: string;
  /** 「DB アクセス」などの種類名 */
  typeLabel: string;
  /** 名前・説明の先頭 (無ければ空) */
  text: string;
  /** 入れ子の中の見出し (分岐の条件・else など)。目次では、その工程の前に、1 行の区切りとして出す */
  group?: string;
}

const short = (s: unknown, n = 28): string => (typeof s === "string" ? (s.length > n ? `${s.slice(0, n)}…` : s) : "");

type Loose = Step & {
  subSteps?: Step[]; steps?: Step[]; branches?: Array<{ condition?: string; steps: Step[] }>; elseBranch?: { steps: Step[] };
  onCommit?: Step[]; onRollback?: Step[]; name?: string; description?: string;
};

export function buildStepOutline(steps: readonly Step[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  // 番号は、同じ親の配下の中で通して振る (分岐・else・繰り返しの中が、同じ番号にならないように)
  const walk = (list: readonly Step[], prefix: string, depth: number, group: string | undefined, counter: { n: number }) => {
    list.forEach((raw, i) => {
      const s = raw as Loose;
      counter.n += 1;
      const number = prefix ? `${prefix}.${counter.n}` : String(counter.n);
      out.push({
        id: s.id, number, depth, kind: s.kind, typeLabel: STEP_TYPE_LABELS[s.kind as keyof typeof STEP_TYPE_LABELS] ?? String(s.kind),
        text: short(s.name ?? s.description), ...(i === 0 && group ? { group } : {}),
      });
      const child = { n: 0 };
      if (s.subSteps?.length) walk(s.subSteps, number, depth + 1, undefined, child);
      if (s.branches) s.branches.forEach((b, bi) => { if (b.steps?.length) walk(b.steps, number, depth + 1, `分岐 ${bi + 1}${b.condition ? `: ${short(b.condition, 24)}` : ""}`, child); });
      if (s.elseBranch?.steps?.length) walk(s.elseBranch.steps, number, depth + 1, "それ以外 (else)", child);
      if (s.steps?.length) walk(s.steps, number, depth + 1, s.kind === "loop" ? "繰り返しの中" : undefined, child);
      if (s.onCommit?.length) walk(s.onCommit, number, depth + 1, "コミット時", child);
      if (s.onRollback?.length) walk(s.onRollback, number, depth + 1, "ロールバック時", child);
      void i;
    });
  };
  walk(steps, "", 0, undefined, { n: 0 });
  return out;
}

/** 目次を、文字で絞り込む (番号・種類名・名前・説明。全角半角・かなの違いは問わない) */
export function filterOutline(items: readonly OutlineItem[], query: string, normalize: (s: string) => string): OutlineItem[] {
  const q = normalize(query.trim());
  if (!q) return [...items];
  return items.filter((it) => normalize(`${it.number} ${it.typeLabel} ${it.text} ${it.group ?? ""}`).includes(q));
}
