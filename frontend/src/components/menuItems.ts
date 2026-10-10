/** ヘッダーメニュー (HeaderMenu) とクイックオープン (Ctrl+K) が共有するページの一覧 */

export type MenuItem = {
  id: string;
  label: string;
  icon: string;
  route: string;
  /** active 判定に一致する pathname（完全一致） */
  activePaths?: string[];
  /** active 判定に一致する pathname の接頭辞（例: "/table/edit/" で編集ページも active にする） */
  activePrefixes?: string[];
  disabled?: boolean;
};

export const MENU_ITEMS: MenuItem[] = [
  {
    id: "screen-flow", label: "画面フロー", icon: "bi-diagram-3", route: "/screen/flow",
    activePaths: ["/screen/flow"],
  },
  {
    id: "screen-list", label: "画面一覧", icon: "bi-list-ul", route: "/screen/list",
    activePaths: ["/screen/list"], activePrefixes: ["/screen/design/"],
  },
  {
    id: "table-list", label: "テーブル一覧", icon: "bi-table", route: "/table/list",
    activePaths: ["/table/list"], activePrefixes: ["/table/edit/"],
  },
  {
    id: "er", label: "ER図", icon: "bi-share", route: "/table/er",
    activePaths: ["/table/er"],
  },
  {
    id: "process-flow", label: "処理フロー一覧", icon: "bi-lightning", route: "/process-flow/list",
    activePaths: ["/process-flow/list"], activePrefixes: ["/process-flow/edit/"],
  },
  {
    id: "business-flow-list", label: "業務フロー", icon: "bi-diagram-2", route: "/business-flow/list",
    activePaths: ["/business-flow/list"], activePrefixes: ["/business-flow/edit/"],
  },
  {
    id: "report-list", label: "帳票", icon: "bi-file-earmark-text", route: "/report/list",
    activePaths: ["/report/list"], activePrefixes: ["/report/edit/"],
  },
  {
    id: "design-document", label: "設計書", icon: "bi-journal-text", route: "/document",
    activePaths: ["/document"],
  },
  {
    id: "extensions", label: "拡張管理", icon: "bi-puzzle", route: "/extensions",
    activePaths: ["/extensions"],
  },
  {
    id: "conventions-catalog", label: "規約カタログ", icon: "bi-file-text", route: "/conventions/catalog",
    activePaths: ["/conventions/catalog"],
  },
  {
    id: "sequence-list", label: "シーケンス一覧", icon: "bi-arrow-repeat", route: "/sequence/list",
    activePaths: ["/sequence/list"], activePrefixes: ["/sequence/edit/"],
  },
  {
    id: "view-list", label: "ビュー一覧", icon: "bi-eye", route: "/view/list",
    activePaths: ["/view/list"], activePrefixes: ["/view/edit/"],
  },
  {
    id: "view-definition-list", label: "ビュー定義一覧", icon: "bi-layout-text-window", route: "/view-definition/list",
    activePaths: ["/view-definition/list"], activePrefixes: ["/view-definition/edit/"],
  },
  {
    id: "page-layout-list", label: "ページレイアウト一覧", icon: "bi-layout-wtf", route: "/page-layout/list",
    activePaths: ["/page-layout/list"], activePrefixes: ["/page-layout/edit/", "/page-layout/design/"],
  },
  {
    id: "gadget-list", label: "ガジェット一覧", icon: "bi-puzzle-fill", route: "/gadget/list",
    activePaths: ["/gadget/list"], activePrefixes: [],
  },
  {
    id: "generic-definition-catalog", label: "汎用定義", icon: "bi-collection", route: "/generic-definition",
    activePaths: ["/generic-definition"], activePrefixes: ["/generic-definition/"],
  },
  {
    id: "workspace-list", label: "ワークスペース", icon: "bi-folder2-open", route: "/workspace/list",
    activePaths: ["/workspace/list", "/workspace/select"],
  },
  {
    id: "tech-stack", label: "技術スタック", icon: "bi-stack", route: "/project/tech-stack",
    activePaths: ["/project/tech-stack"],
  },
  {
    id: "ai-settings", label: "AI 設定", icon: "bi-robot", route: "/ai-settings",
    activePaths: ["/ai-settings"],
  },
];

export const DASHBOARD_ITEM: MenuItem = {
  id: "dashboard",
  label: "ダッシュボード",
  icon: "bi-speedometer2",
  route: "/",
  activePaths: ["/"],
};
