/**
 * テーブルの列の変更が、ほかの設計へ及ぼす影響 (UI 改善提案 続編 第 8 弾 #152)。
 * 保存した列と、いまの列を比べて、型・桁・スケール・NOT NULL・主キー・ユニークを変えた列と、消した列を集める (画面に依存しない純関数)。
 * 影響先は、shared の影響分析 (analyzeImpact) の結果から、種類ごとの件数にまとめる。
 */
import { NODE_KIND_LABELS, type ImpactResult, type NodeKind } from "@harmony/shared";
import type { Column } from "../types/v3";

export interface ColumnChange { columnId: string; name: string; physicalName: string; changes: string[]; deleted: boolean }

const typeText = (c: Column): string => {
  const t = String(c.dataType ?? "");
  return c.length != null ? `${t}(${c.length}${c.scale != null ? `,${c.scale}` : ""})` : t;
};

const FLAGS: Array<[keyof Column, string]> = [["notNull", "NOT NULL"], ["primaryKey", "主キー"], ["unique", "ユニーク"]];

export function changedColumns(base: readonly Column[] | undefined, now: readonly Column[]): ColumnChange[] {
  if (!base) return [];
  const nowById = new Map(now.map((c) => [c.id as string, c]));
  const out: ColumnChange[] = [];
  for (const b of base) {
    const c = nowById.get(b.id as string);
    if (!c) { out.push({ columnId: b.id as string, name: String(b.name ?? b.physicalName), physicalName: String(b.physicalName), changes: ["削除"], deleted: true }); continue; }
    const changes: string[] = [];
    if (typeText(b) !== typeText(c)) changes.push(`型 ${typeText(b)} → ${typeText(c)}`);
    for (const [k, label] of FLAGS) if (Boolean(b[k]) !== Boolean(c[k])) changes.push(`${label} ${b[k] ? "あり" : "なし"} → ${c[k] ? "あり" : "なし"}`);
    if (changes.length) out.push({ columnId: c.id as string, name: String(c.name ?? c.physicalName), physicalName: String(c.physicalName), changes, deleted: false });
  }
  return out;
}

export interface ImpactSummary {
  total: number;
  byKind: Array<{ label: string; count: number }>;
  /** 影響先の名前 (先頭の何件か) */
  names: Array<{ kind: NodeKind; id: string; name: string }>;
}

export function summarizeImpact(result: ImpactResult | null, maxNames = 6): ImpactSummary {
  if (!result) return { total: 0, byKind: [], names: [] };
  const names = result.levels.flatMap((l) => l.hits).map((h) => ({ kind: h.node.kind, id: h.node.id, name: h.node.name }));
  return {
    total: result.total,
    byKind: Object.entries(result.byKind).map(([k, n]) => ({ label: NODE_KIND_LABELS[k as NodeKind] ?? k, count: n as number })),
    names: names.slice(0, maxNames),
  };
}
