/** 運用の記録 (承認・コメント・権限・生成の記録) に共通の、小さな道具 */
export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 記録の対象になる設計の種類 (設計の分析・要確認と同じ呼び名) */
export const OPS_ENTITY_KINDS = ["screen", "table", "processFlow", "businessFlow", "report", "sequence", "view", "viewDefinition"] as const;
export type OpsEntityKind = (typeof OPS_ENTITY_KINDS)[number];
export const OPS_ENTITY_LABELS: Record<OpsEntityKind, string> = {
  screen: "画面", table: "テーブル", processFlow: "処理フロー", businessFlow: "業務フロー", report: "帳票", sequence: "シーケンス", view: "DB ビュー", viewDefinition: "ビュー定義",
};
export const isOpsEntityKind = (v: unknown): v is OpsEntityKind => typeof v === "string" && (OPS_ENTITY_KINDS as readonly string[]).includes(v);

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const isIsoDateTime = (s: unknown): s is string => typeof s === "string" && s.length <= 40 && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);

/** 利用者名 (自己申告)。制御文字を除き 40 文字まで */
export function cleanActor(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  return typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) : "";
}

export interface Parsed<T> { value: T; problems: string[] }
