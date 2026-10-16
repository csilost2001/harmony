/**
 * 開いている設計 1 件だけの設計書 (UI 改善提案 続編 第 9 弾 #169)。設計書の入力 (DesignDocInput) を、その 1 件に絞る。画面に依存しない純関数。
 * 1 件に絞ると、ほかの設計への参照 (遷移先・参照先テーブルなど) は、設計書の中で「見つからない」要確認として出ることがある。
 * 対応する種類: 画面・テーブル・処理フロー・業務フロー・帳票 (設計書の章がある種類)。
 */
import type { DesignDocInput } from "@harmony/shared";
import type { HistoryKind } from "./designHistory";

export const SINGLE_DESIGN_KINDS: readonly HistoryKind[] = ["screen", "table", "processFlow", "businessFlow", "report"];
export const supportsSingleDesign = (kind: HistoryKind): boolean => SINGLE_DESIGN_KINDS.includes(kind);

/** 1 件だけの入力。その設計が見つからない・種類が対象外なら null */
export function inputForDesign(input: DesignDocInput, kind: HistoryKind, id: string): DesignDocInput | null {
  const base: DesignDocInput = { ...input, screens: [], flows: [], tables: [], businessFlows: [], reports: [], transitions: [] };
  switch (kind) {
    case "screen": { const s = input.screens.find((x) => x.id === id); return s ? { ...base, screens: [s] } : null; }
    case "table": { const t = input.tables.find((x) => x.id === id); return t ? { ...base, tables: [t] } : null; }
    case "processFlow": { const f = input.flows.find((x) => x.meta.id === id); return f ? { ...base, flows: [f] } : null; }
    case "businessFlow": { const b = (input.businessFlows ?? []).find((x) => x.id === id); return b ? { ...base, businessFlows: [b] } : null; }
    case "report": { const r = (input.reports ?? []).find((x) => x.id === id); return r ? { ...base, reports: [r] } : null; }
    default: return null;
  }
}

/** 保存するファイル名の元 (英数字だけ。日本語の名前は、ブラウザが無視するため使わない) */
export function singleDesignFileStem(projectId: string | undefined, kind: HistoryKind, id: string): string {
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "");
  return [safe(projectId ?? "") || "harmony", kind, safe(id) || "design"].join("-");
}
