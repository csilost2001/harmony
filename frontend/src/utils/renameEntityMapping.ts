/**
 * 7 top-level entity の rename refactor 機能 (RFC #1284 / メタ #1292 / ISSUE #1298 I-6) で
 * 各 editor / dialog / ListView から共通参照する mapping ヘルパー。
 *
 * - `RenameEntityType`: backend `RenameEntityType` と 1:1 (kebab-case + camelCase 形式)
 * - `entityLabel`:      ダイアログ表示・toast 文言用日本語ラベル
 * - `tabType`:          rename 成功後の tab id 計算用 (`makeTabId(tabType, newId)`)
 * - `editRoute`:        rename 成功後の URL navigate 用 (workspace-scoped `wsPath` に渡す前のパス)
 */
import type { TabType } from "../store/tabStore";

export type RenameEntityType =
  | "screen"
  | "table"
  | "processFlow"
  | "sequence"
  | "view"
  | "viewDefinition"
  | "pageLayout";

export interface RenameEntityMeta {
  /** ダイアログ・toast に出す日本語ラベル */
  entityLabel: string;
  /** tabStore.makeTabId(tabType, id) の第 1 引数 */
  tabType: TabType;
  /** rename 成功後 navigate(wsPath(editRoute(newId))) で使う関数 */
  editRoute: (id: string) => string;
}

export const RENAME_ENTITY_META: Record<RenameEntityType, RenameEntityMeta> = {
  screen: {
    entityLabel: "画面",
    tabType: "design",
    editRoute: (id) => `/screen/design/${id}`,
  },
  table: {
    entityLabel: "テーブル定義",
    tabType: "table",
    editRoute: (id) => `/table/edit/${id}`,
  },
  processFlow: {
    entityLabel: "処理フロー",
    tabType: "process-flow",
    editRoute: (id) => `/process-flow/edit/${id}`,
  },
  sequence: {
    entityLabel: "シーケンス",
    tabType: "sequence",
    editRoute: (id) => `/sequence/edit/${id}`,
  },
  view: {
    entityLabel: "ビュー",
    tabType: "view",
    editRoute: (id) => `/view/edit/${id}`,
  },
  viewDefinition: {
    entityLabel: "ビュー定義",
    tabType: "view-definition",
    editRoute: (id) => `/view-definition/edit/${id}`,
  },
  pageLayout: {
    entityLabel: "ページレイアウト",
    tabType: "page-layout",
    editRoute: (id) => `/page-layout/edit/${id}`,
  },
};

export function getRenameEntityMeta(type: RenameEntityType): RenameEntityMeta {
  return RENAME_ENTITY_META[type];
}
