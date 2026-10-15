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
  /** ヘッダーメニューでの区分 (同じ区分は続けて並べる) */
  group?: MenuGroup;
};

/** ヘッダーメニューの区分 (この順に並べる) */
export const MENU_GROUPS = ["画面", "処理", "データ", "規約・定義", "出力", "設定"] as const;
export type MenuGroup = typeof MENU_GROUPS[number];

export const MENU_ITEMS: MenuItem[] = [
  {
    id: "screen-flow", label: "画面フロー", icon: "bi-diagram-3", route: "/screen/flow",
    activePaths: ["/screen/flow"],
    group: "画面",
  },
  {
    id: "screen-list", label: "画面一覧", icon: "bi-list-ul", route: "/screen/list",
    activePaths: ["/screen/list"], activePrefixes: ["/screen/design/"],
    group: "画面",
  },
  {
    id: "page-layout-list", label: "ページレイアウト一覧", icon: "bi-layout-wtf", route: "/page-layout/list",
    activePaths: ["/page-layout/list"], activePrefixes: ["/page-layout/edit/", "/page-layout/design/"],
    group: "画面",
  },
  {
    id: "gadget-list", label: "ガジェット一覧", icon: "bi-puzzle-fill", route: "/gadget/list",
    activePaths: ["/gadget/list"], activePrefixes: [],
    group: "画面",
  },
  {
    id: "process-flow", label: "処理フロー一覧", icon: "bi-lightning", route: "/process-flow/list",
    activePaths: ["/process-flow/list"], activePrefixes: ["/process-flow/edit/"],
    group: "処理",
  },
  {
    id: "business-flow-list", label: "業務フロー", icon: "bi-diagram-2", route: "/business-flow/list",
    activePaths: ["/business-flow/list"], activePrefixes: ["/business-flow/edit/"],
    group: "処理",
  },
  {
    id: "report-list", label: "帳票", icon: "bi-file-earmark-text", route: "/report/list",
    activePaths: ["/report/list"], activePrefixes: ["/report/edit/"],
    group: "処理",
  },
  {
    id: "table-list", label: "テーブル一覧", icon: "bi-table", route: "/table/list",
    activePaths: ["/table/list"], activePrefixes: ["/table/edit/"],
    group: "データ",
  },
  {
    id: "er", label: "ER図", icon: "bi-share", route: "/table/er",
    activePaths: ["/table/er"],
    group: "データ",
  },
  {
    id: "view-list", label: "ビュー一覧", icon: "bi-eye", route: "/view/list",
    activePaths: ["/view/list"], activePrefixes: ["/view/edit/"],
    group: "データ",
  },
  {
    id: "view-definition-list", label: "ビュー定義一覧", icon: "bi-layout-text-window", route: "/view-definition/list",
    activePaths: ["/view-definition/list"], activePrefixes: ["/view-definition/edit/"],
    group: "データ",
  },
  {
    id: "sequence-list", label: "シーケンス一覧", icon: "bi-arrow-repeat", route: "/sequence/list",
    activePaths: ["/sequence/list"], activePrefixes: ["/sequence/edit/"],
    group: "データ",
  },
  {
    id: "conventions-catalog", label: "規約カタログ", icon: "bi-file-text", route: "/conventions/catalog",
    activePaths: ["/conventions/catalog"],
    group: "規約・定義",
  },
  {
    id: "generic-definition-catalog", label: "汎用定義", icon: "bi-collection", route: "/generic-definition",
    activePaths: ["/generic-definition"], activePrefixes: ["/generic-definition/"],
    group: "規約・定義",
  },
  {
    id: "extensions", label: "拡張管理", icon: "bi-puzzle", route: "/extensions",
    activePaths: ["/extensions"],
    group: "規約・定義",
  },
  {
    id: "tech-stack", label: "技術スタック", icon: "bi-stack", route: "/project/tech-stack",
    activePaths: ["/project/tech-stack"],
    group: "規約・定義",
  },
  {
    id: "design-document", label: "設計書", icon: "bi-journal-text", route: "/document",
    activePaths: ["/document"],
    group: "出力",
  },
  {
    id: "design-analysis", label: "設計の分析", icon: "bi-search-heart", route: "/analysis",
    activePaths: ["/analysis"],
    group: "出力",
  },
  {
    id: "markers", label: "マーカー (AI への指示)", icon: "bi-megaphone", route: "/markers",
    activePaths: ["/markers"],
    group: "出力",
  },
  {
    id: "operations", label: "連携と運用", icon: "bi-diagram-2", route: "/operations",
    activePaths: ["/operations"],
    group: "出力",
  },
  {
    id: "workspace-list", label: "ワークスペース", icon: "bi-folder2-open", route: "/workspace/list",
    activePaths: ["/workspace/list", "/workspace/select"],
    group: "設定",
  },
  {
    id: "ai-settings", label: "AI 設定", icon: "bi-robot", route: "/ai-settings",
    activePaths: ["/ai-settings"],
    group: "設定",
  },
];

export const DASHBOARD_ITEM: MenuItem = {
  id: "dashboard",
  label: "ダッシュボード",
  icon: "bi-speedometer2",
  route: "/",
  activePaths: ["/"],
};
