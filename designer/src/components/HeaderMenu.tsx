import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { clearActiveTab, getTabs, getActiveTabId } from "../store/tabStore";
import { useWorkspacePath } from "../hooks/useWorkspacePath";
import "../styles/headerMenu.css";

type MenuItem = {
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

const MENU_ITEMS: MenuItem[] = [
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
    id: "workspace-list", label: "ワークスペース", icon: "bi-folder2-open", route: "/workspace/list",
    activePaths: ["/workspace/list", "/workspace/select"],
  },
  {
    id: "tech-stack", label: "技術スタック", icon: "bi-stack", route: "/project/tech-stack",
    activePaths: ["/project/tech-stack"],
  },
];

const DASHBOARD_ITEM: MenuItem = {
  id: "dashboard",
  label: "ダッシュボード",
  icon: "bi-speedometer2",
  route: "/",
  activePaths: ["/"],
};

function isDesignTabActive(): boolean {
  const activeId = getActiveTabId();
  return getTabs().some((t) => t.id === activeId && t.type === "design");
}

export function HeaderMenu() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { wsPath } = useWorkspacePath();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleSelect = (route: string) => {
    // デザインタブがアクティブな場合は解除して非デザインルートを表示できるようにする
    if (isDesignTabActive()) {
      clearActiveTab();
    }
    // /workspace/list は wsId なし、その他は /w/:wsId/ プレフィックス付き
    const targetRoute = route.startsWith("/workspace/") ? route : wsPath(route);
    navigate(targetRoute);
    setOpen(false);
  };

  const isActive = (item: MenuItem) => {
    // /w/:wsId/ プレフィックス付きのパスでも一致判定するため、
    // pathname から /w/<wsId> プレフィックスを除去して比較
    const pathWithoutWs = location.pathname.replace(/^\/w\/[^/]+/, "");
    const normalizedPath = pathWithoutWs || "/";
    if (item.activePaths?.includes(normalizedPath)) return true;
    return item.activePrefixes?.some((p) => normalizedPath.startsWith(p)) ?? false;
  };

  return (
    <div className="header-menu" ref={menuRef}>
      <button
        className={`header-menu-btn${open ? " open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title="メニュー"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <i className="bi bi-list" />
      </button>

      {open && (
        <div className="header-menu-dropdown" role="menu">
          <div className="header-menu-section-label">ナビゲーション</div>

          <button
            key={DASHBOARD_ITEM.id}
            className={`header-menu-item${isActive(DASHBOARD_ITEM) ? " active" : ""}`}
            onClick={() => handleSelect(DASHBOARD_ITEM.route)}
            role="menuitem"
          >
            <i className={`bi ${DASHBOARD_ITEM.icon}`} />
            <span>{DASHBOARD_ITEM.label}</span>
          </button>

          <div className="header-menu-separator" />

          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`header-menu-item${isActive(item) ? " active" : ""}`}
              onClick={() => handleSelect(item.route)}
              role="menuitem"
            >
              <i className={`bi ${item.icon}`} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
