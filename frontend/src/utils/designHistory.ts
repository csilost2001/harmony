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

/**
 * AI (MCP) の記録 (`AI が <tool> を実行した`) の tool 名 → 設計の種類。設計を変える tool だけ。
 * 編集セッションの保存・保存前の版の書き戻しは、対象の種類が tool 名に無いので、記録の備考 (detail) の resourceType から引く。
 */
const AI_TOOL_KIND: Array<[RegExp, HistoryKind]> = [
  [/^(add|update|remove)_table$/, "table"],
  [/^(add|update|remove)_screen$|^set_screen_layout$|^save_screen$|^rename_screen_item$/, "screen"],
  [/^(add|update|delete)_process_flow$|^(add|update|remove|nest|move)_step$|^add_action$/, "processFlow"],
  [/^(save|delete)_business_flow$/, "businessFlow"],
  [/^(save|delete)_report$/, "report"],
  [/^(add|update|remove|save)_page_layout$/, "pageLayout"],
];
const AI_TOOL_BY_SESSION = /^(editSession__save|restore_version)$/;
const aiTool = (e: AuditEntry): string | null => /^AI が (\S+) を実行した$/.exec(e.action)?.[1] ?? null;

/** AI の記録が指す設計の種類 (設計を変える tool でなければ null) */
function aiEntryKind(e: AuditEntry, tool: string): HistoryKind | null {
  const byName = AI_TOOL_KIND.find(([re]) => re.test(tool));
  if (byName) return byName[1];
  if (AI_TOOL_BY_SESSION.test(tool)) return SESSION_KIND[(e.detail ?? "").trim()] ?? null;
  return null;
}

/** 変更を表す動作 (保存・削除。承認・コメントなどは含めない。AI の記録は、設計を変える tool のものだけ) */
const isChangeAction = (e: AuditEntry): boolean => {
  const tool = aiTool(e);
  if (tool) return aiEntryKind(e, tool) !== null;
  return /(保存した|削除した|改名した|置換した|編集内容を保存)/.test(e.action);
};

/** 記録 1 件が指す設計 (読み取れなければ null) */
export function entryDesign(e: AuditEntry): { kind: HistoryKind; id: string } | null {
  const t = (e.target ?? "").trim();
  if (!t) return null;
  const tool = aiTool(e);
  if (tool) { const kind = aiEntryKind(e, tool); return kind ? { kind, id: t } : null; }
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
  return entries.filter((e) => { const d = entryDesign(e); return !!d && d.kind === kind && d.id === id && isChangeAction(e); });
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
    if (!isChangeAction(e)) continue;
    const d = entryDesign(e);
    if (!d) continue;
    const key = `${d.kind}:${d.id}`;
    if (!m.has(key)) m.set(key, { actor: e.actor, at: e.at, via: e.via });
  }
  return m;
}

/** 動作の文を、「何を」に短くする (「テーブルを保存した」→ 保存) */
export function actionVerb(action: string): string {
  const tool = /^AI が (\S+) を実行した$/.exec(action)?.[1];
  if (tool) return /^(remove|delete)_/.test(tool) ? "削除" : /^rename_/.test(tool) ? "改名" : /^restore_version$/.test(tool) ? "版の書き戻し" : "変更";
  if (action.includes("削除")) return "削除";
  if (action.includes("改名")) return "改名";
  if (action.includes("置換")) return "置換";
  return "保存";
}

// ── 開いているタブ → 設計 ─────────────────────────────────────────────

export interface TabDesign {
  kind: HistoryKind;
  id: string;
  /** 保存前の版を引ける種類 (編集セッションの resourceType)。画面などは null */
  versionType: string | null;
  /** 承認・レビューコメントの種類 (ページレイアウトは対象外で null) */
  opsKind: "screen" | "table" | "processFlow" | "businessFlow" | "report" | "sequence" | "view" | "viewDefinition" | null;
  /** いまの内容を読む RPC と、その引数名 */
  load: { method: string; key: string };
}

const TAB_DESIGNS: Record<string, Omit<TabDesign, "id">> = {
  design: { kind: "screen", versionType: null, opsKind: "screen", load: { method: "loadScreenEntity", key: "screenId" } },
  "screen-items": { kind: "screen", versionType: null, opsKind: "screen", load: { method: "loadScreenEntity", key: "screenId" } },
  table: { kind: "table", versionType: "table", opsKind: "table", load: { method: "loadTable", key: "tableId" } },
  "process-flow": { kind: "processFlow", versionType: "process-flow", opsKind: "processFlow", load: { method: "loadProcessFlow", key: "processFlowId" } },
  "business-flow": { kind: "businessFlow", versionType: "business-flow", opsKind: "businessFlow", load: { method: "loadBusinessFlow", key: "flowId" } },
  report: { kind: "report", versionType: "report", opsKind: "report", load: { method: "loadReport", key: "reportId" } },
  sequence: { kind: "sequence", versionType: "sequence", opsKind: "sequence", load: { method: "loadSequence", key: "sequenceId" } },
  view: { kind: "view", versionType: "view", opsKind: "view", load: { method: "loadView", key: "viewId" } },
  "view-definition": { kind: "viewDefinition", versionType: "view-definition", opsKind: "viewDefinition", load: { method: "loadViewDefinition", key: "viewDefinitionId" } },
  "page-layout": { kind: "pageLayout", versionType: "page-layout", opsKind: null, load: { method: "loadPageLayout", key: "pageLayoutId" } },
};

/** タブの種類と資源 id から、設計 (設計のタブでなければ null) */
export function designOfTab(tabType: string | undefined, resourceId: string | undefined): TabDesign | null {
  if (!tabType || !resourceId) return null;
  const d = TAB_DESIGNS[tabType];
  return d ? { ...d, id: resourceId } : null;
}

/** 編集中の下書き (ブラウザ) の種類 (draftStorage の kind)。試作のもとにする */
export const DRAFT_KIND: Record<HistoryKind, string> = {
  screen: "screen-items", table: "table", processFlow: "process-flow", businessFlow: "businessFlow", report: "report", sequence: "sequence", view: "view", viewDefinition: "view-definition", pageLayout: "page-layout",
};

/**
 * 改訂履歴の下書きの文 (続編 第 9 弾 #180)。更新された設計 (保存前の版から拾ったもの) に、変更の記録から「誰が」を添える。
 * 記録に無い設計 (記録を始める前の保存) は、人の名前を付けない。
 */
export function revisionDraftText(
  items: ReadonlyArray<{ kind: HistoryKind; id: string; name: string; saves: number }>,
  audit: readonly AuditEntry[],
  sinceIso: string,
): string {
  const recent = audit.filter((e) => e.at >= sinceIso);
  return items.map((i) => {
    const actors = [...new Set(designTimeline(recent, i.kind, i.id).map((e) => e.actor))];
    return `${HISTORY_KIND_LABELS[i.kind]}「${i.name}」を更新 (${i.saves} 回${actors.length ? `、${actors.join("・")}` : ""})`;
  }).join("\n");
}
