/**
 * 参照元 (その設計を参照している設計) の表示用の定義。backend の references.ts の結果を画面で扱う。
 */
export type ReferrerKind =
  | "screen" | "processFlow" | "table" | "sequence" | "view" | "viewDefinition" | "pageLayout"
  | "businessFlow" | "report" | "screenFlow" | "layoutComponent" | "genericDefinition";

export interface Referrer { kind: ReferrerKind; id: string; name?: string; count: number }
export interface ReferenceResult {
  entityType: string;
  id: string;
  exists: boolean;
  referrers: Referrer[];
  total: number;
}

export type ReferenceTargetType = "screen" | "table" | "processFlow" | "sequence" | "view" | "viewDefinition" | "pageLayout";

export const REFERRER_LABELS: Record<ReferrerKind, string> = {
  screen: "画面",
  processFlow: "処理フロー",
  table: "テーブル",
  sequence: "シーケンス",
  view: "DB ビュー",
  viewDefinition: "ビュー定義",
  pageLayout: "ページレイアウト",
  businessFlow: "業務フロー",
  report: "帳票",
  screenFlow: "画面フロー (遷移)",
  layoutComponent: "独自部品",
  genericDefinition: "汎用定義",
};

/** 表示の順 (業務に近いものから) */
export const REFERRER_ORDER: ReferrerKind[] = [
  "businessFlow", "screenFlow", "screen", "processFlow", "report", "table", "view", "viewDefinition",
  "sequence", "pageLayout", "layoutComponent", "genericDefinition",
];

/** その参照元を開く画面の経路 (ワークスペース内)。開く先がないものは null */
export function referrerRoute(r: Pick<Referrer, "kind" | "id">): string | null {
  const id = encodeURIComponent(r.id);
  switch (r.kind) {
    case "screen": return `/screen/design/${id}`;
    case "processFlow": return `/process-flow/edit/${id}`;
    case "table": return `/table/edit/${id}`;
    case "sequence": return `/sequence/edit/${id}`;
    case "view": return `/view/edit/${id}`;
    case "viewDefinition": return `/view-definition/edit/${id}`;
    case "pageLayout": return `/page-layout/edit/${id}`;
    case "businessFlow": return `/business-flow/edit/${id}`;
    case "report": return `/report/edit/${id}`;
    case "screenFlow": return "/screen/flow";
    default: return null;
  }
}

/** 種類ごとにまとめる (表示の順)。空の種類は出さない */
export function groupReferrers(referrers: readonly Referrer[]): Array<{ kind: ReferrerKind; items: Referrer[] }> {
  return REFERRER_ORDER
    .map((kind) => ({ kind, items: referrers.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length > 0);
}
