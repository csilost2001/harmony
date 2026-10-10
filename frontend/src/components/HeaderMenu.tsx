import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { clearActiveTab, getTabs, getActiveTabId } from "../store/tabStore";
import { useWorkspacePath } from "../hooks/useWorkspacePath";
import { MENU_ITEMS, DASHBOARD_ITEM, type MenuItem } from "./menuItems";
import "../styles/headerMenu.css";

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
    // /workspace/* および /ai-settings は wsId なし (workspace 横断)、
    // その他は /w/:wsId/ プレフィックス付き
    const isWorkspaceScoped = !route.startsWith("/workspace/") && route !== "/ai-settings";
    const targetRoute = isWorkspaceScoped ? wsPath(route) : route;
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
