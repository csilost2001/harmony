/**
 * 設計ごとの変更の記録 (監査ログ) の引き当てと、最終編集者 (UI 改善提案 続編 第 9 弾 #162・#171)。画面に依存しない純関数。
 * 監査ログの対象 (target) は、画面からの保存では設計の id、編集セッションの保存では「種類 id」(例: `table orders`)。
 * 動作 (action) の文言から、設計の種類も読み取る (同じ id の画面とテーブルを取り違えないため)。
 */
import type { AuditEntry } from "./opsApi";

export type HistoryKind = "screen" | "table" | "processFlow" | "businessFlow" | "report" | "sequence" | "view" | "viewDefinition" | "pageLayout";

/** 編集セッションの種類 (resourceType) → 設計の種類 */
const SESSION_KIND: Record<string, HistoryKind> = {
  "screen-item": "screen", screen: "screen", table: "table", "process-flow": "processFlow", "business-flow": "businessFlow", report: "report",
  sequence: "sequence", view: "view", "view-definition": "viewDefinition", "page-layout": "pageLayout",
};
/** 動作の文言の先頭 → 設計の種類 */
const ACTION_KIND: Array<[string, HistoryKind]> = [
  ["テーブル", "table"], ["処理フロー", "processFlow"], ["画面", "screen"], ["業務フロー", "businessFlow"], ["帳票", "report"], ["シーケンス", "sequence"],
  ["DB ビュー", "view"], ["ビュー定義", "viewDefinition"], ["ページレイアウト", "pageLayout"],
];

export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  screen: "画面", table: "テーブル", processFlow: "処理フロー", businessFlow: "業務フロー", report: "帳票", sequence: "シーケンス", view: "DB ビュー", viewDefinition: "ビュー定義", pageLayout: "ページレイアウト",
};

/** 変更を表す動作 (保存・削除。承認・コメントなどは含めない) */
const isChangeAction = (a: string): boolean => /(保存した|削除した|改名した|置換した|編集内容を保存)/.test(a);

/** 記録 1 件が指す設計 (読み取れなければ null) */
export function entryDesign(e: AuditEntry): { kind: HistoryKind; id: string } | null {
  const t = (e.target ?? "").trim();
  if (!t) return null;
  const sp = t.indexOf(" ");
  if (sp > 0) {
    const kind = SESSION_KIND[t.slice(0, sp)];
    if (kind) return { kind, id: t.slice(sp + 1).trim() };
  }
  const byAction = ACTION_KIND.find(([p]) => e.action.startsWith(p));
  if (byAction && !t.includes(" ")) return { kind: byAction[1], id: t };
  return null;
}

/** 設計 1 件の記録 (新しい順のまま)。変更を表す動作だけ */
export function designTimeline(entries: readonly AuditEntry[], kind: HistoryKind, id: string): AuditEntry[] {
  return entries.filter((e) => { const d = entryDesign(e); return !!d && d.kind === kind && d.id === id && isChangeAction(e.action); });
}

export interface LastEdit { actor: string; at: string; via?: AuditEntry["via"] }

/** 設計 1 件の最終編集 (新しい順の記録から、いちばん新しい変更) */
export function lastEditOf(entries: readonly AuditEntry[], kind: HistoryKind, id: string): LastEdit | null {
  const e = designTimeline(entries, kind, id)[0];
  return e ? { actor: e.actor, at: e.at, via: e.via } : null;
}

/** 設計ごとの最終編集 (一覧の列用)。キーは `<kind>:<id>`。新しい順の記録を、先頭から 1 回なぞる */
export function lastEditIndex(entries: readonly AuditEntry[]): Map<string, LastEdit> {
  const m = new Map<string, LastEdit>();
  for (const e of entries) {
    if (!isChangeAction(e.action)) continue;
    const d = entryDesign(e);
    if (!d) continue;
    const key = `${d.kind}:${d.id}`;
    if (!m.has(key)) m.set(key, { actor: e.actor, at: e.at, via: e.via });
  }
  return m;
}

/** 動作の文を、「何を」に短くする (「テーブルを保存した」→ 保存) */
export function actionVerb(action: string): string {
  if (action.includes("削除")) return "削除";
  if (action.includes("改名")) return "改名";
  if (action.includes("置換")) return "置換";
  return "保存";
}
