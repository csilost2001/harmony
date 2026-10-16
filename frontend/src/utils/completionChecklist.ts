/**
 * 設計ごとの完了チェックリスト (UI 改善提案 続編 第 9 弾 #172)。「完了の定義」を、設計の中身から自動で判定する。画面に依存しない純関数。
 * 判定するのは、機械で分かる項目だけ (要確認・命名規約・マーカー・レビューコメント・承認)。設計の中身の正しさは、判定しない。
 * 設計者のプロジェクトごとの項目 (独自のチェック) は持たない。
 */
import type { ApprovalStatus, DocIssue } from "@harmony/shared";

export type CheckStatus = "ok" | "ng" | "unknown";
export interface ChecklistItem { id: string; label: string; status: CheckStatus; detail: string }

export interface ChecklistInput {
  /** この設計に紐づく要確認 (検査の結果。抑制済みは除いたもの)。命名規約の指摘も含んでよい (区別して数える) */
  issues: readonly DocIssue[];
  unresolvedMarkers: number;
  openThreads: number;
  approval: ApprovalStatus;
  /** 成熟度 (draft / provisional / committed)。あれば表示する */
  maturity?: string;
}

const MATURITY_LABELS: Record<string, string> = { draft: "作成中", provisional: "レビュー中", committed: "確定" };
const NAMING_SECTION = "命名規約";
const isNaming = (i: DocIssue): boolean => i.section === NAMING_SECTION || /命名規約/.test(i.message);

export function completionChecklist(i: ChecklistInput): ChecklistItem[] {
  const naming = i.issues.filter(isNaming);
  const others = i.issues.filter((x) => !isNaming(x) && x.severity !== "info");
  const errors = others.filter((x) => x.severity === "error").length;
  const warnings = others.length - errors;
  const items: ChecklistItem[] = [
    {
      id: "issues", label: "要確認の指摘がない", status: others.length === 0 ? "ok" : "ng",
      detail: others.length === 0 ? "エラー・警告はありません" : `エラー ${errors} 件・警告 ${warnings} 件`,
    },
    {
      id: "naming", label: "命名規約に合っている", status: naming.length === 0 ? "ok" : "ng",
      detail: naming.length === 0 ? "合っています (規約が未設定のときも、指摘はありません)" : `${naming.length} 件が合っていません`,
    },
    {
      id: "markers", label: "マーカー (AI への指示・質問) がすべて解決している", status: i.unresolvedMarkers === 0 ? "ok" : "ng",
      detail: i.unresolvedMarkers === 0 ? "未解決はありません" : `未解決 ${i.unresolvedMarkers} 件`,
    },
    {
      id: "threads", label: "レビューコメントがすべて解決している", status: i.openThreads === 0 ? "ok" : "ng",
      detail: i.openThreads === 0 ? "未解決はありません" : `未解決 ${i.openThreads} 件`,
    },
    {
      id: "approval", label: "レビューで承認されている", status: i.approval === "approved" ? "ok" : "ng",
      detail: ({ none: "未申請です", draft: "下書きです", review: "承認待ちです", approved: "承認済みです", rejected: "差し戻されています", stale: "承認のあとに内容が変わっています (承認し直しが必要です)" } as Record<ApprovalStatus, string>)[i.approval],
    },
  ];
  if (i.maturity) items.push({ id: "maturity", label: "成熟度が「確定」", status: i.maturity === "committed" ? "ok" : "ng", detail: `成熟度: ${MATURITY_LABELS[i.maturity] ?? i.maturity}` });
  return items;
}

export function checklistSummary(items: readonly ChecklistItem[]): { ok: number; total: number; done: boolean } {
  const ok = items.filter((x) => x.status === "ok").length;
  return { ok, total: items.length, done: ok === items.length };
}
