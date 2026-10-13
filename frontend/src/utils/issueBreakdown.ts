/**
 * 設計の要確認 (DocIssue) を、対象の種類 (画面・処理フロー・テーブル・業務フロー・帳票・その他) ごとの件数にする。
 * ダッシュボードの要確認パネルで、「どの種類に何件あるか (0 件もあわせて)」を一目で見せる。
 */
import type { DocIssue } from "@harmony/shared";

export const BREAKDOWN_KINDS = ["画面", "処理フロー", "テーブル", "業務フロー", "帳票"] as const;

export interface BreakdownRow { label: string; error: number; warning: number }

/** 「画面 カート」「テーブル tables/x.json」のような対象名の先頭の語で、種類を決める。それ以外は「その他」 */
export function issueBreakdown(issues: readonly DocIssue[]): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>(BREAKDOWN_KINDS.map((k) => [k, { label: k, error: 0, warning: 0 }]));
  rows.set("その他", { label: "その他", error: 0, warning: 0 });
  for (const i of issues) {
    if (i.severity === "info") continue;
    const head = i.section.split(/\s+/)[0];
    const row = rows.get(head) ?? rows.get("その他")!;
    row[i.severity]++;
  }
  // その他は、あるときだけ出す
  return [...rows.values()].filter((r) => r.label !== "その他" || r.error + r.warning > 0);
}

/** harmony.json の一覧とファイルの食い違い (一覧にあるのにファイルが無い / ファイルがあるのに一覧に載っていない) の指摘 (backend の workspaceHealth の文言) */
export const REGISTRY_MISMATCH_PATTERN = /一覧 \(harmony\.json\) に(ありますが|載っていない)/;
