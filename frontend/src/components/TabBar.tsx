import { useState, useEffect, useRef, useCallback } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  getTabs,
  getActiveTabId,
  subscribe,
  closeTab,
  setActiveTab,
  reorderTabs,
  setPinned,
  closeOtherTabs,
  closeTabsToRight,
  type TabItem,
  moveTabBy,
} from "../store/tabStore";
import "../styles/tabbar.css";
import { tabPath } from "../routing/tabPaths";
import { setSplit } from "../store/splitStore";
import { useWorkspacePath } from "../hooks/useWorkspacePath";

type ContextMenu = {
  tabId: string;
  x: number;
  y: number;
};

function useTabs() {
  const [tabs, setTabs] = useState<readonly TabItem[]>(getTabs);
  const [activeTabId, setActiveTabIdState] = useState(getActiveTabId);
  useEffect(() => {
    return subscribe(() => {
      setTabs(getTabs());
      setActiveTabIdState(getActiveTabId());
    });
  }, []);
  return { tabs, activeTabId };
}

function TabItem({
  tab,
  isActive,
  onClose,
  onContextMenu,
}: {
  tab: TabItem;
  isActive: boolean;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const icon =
    tab.type === "design" ? "bi-window"
    : tab.type === "table" ? "bi-columns-gap"
    : tab.type === "process-flow" ? "bi-lightning-charge"
    : tab.type === "screen-flow" ? "bi-diagram-3"
    : tab.type === "table-list" ? "bi-table"
    : tab.type === "er" ? "bi-share"
    : tab.type === "process-flow-list" ? "bi-list-task"
    : tab.type === "dashboard" ? "bi-speedometer2"
    : tab.type === "design-document" ? "bi-journal-text"
    : tab.type === "design-analysis" ? "bi-search-heart"
    : tab.type === "report" || tab.type === "report-list" ? "bi-file-earmark-text"
    : tab.type === "business-flow" || tab.type === "business-flow-list" ? "bi-diagram-2"
    : tab.type === "screen-list" ? "bi-list-ul"
    : tab.type === "screen-items" ? "bi-ui-checks-grid"
    : tab.type === "conventions-catalog" ? "bi-file-text"
    : tab.type === "sequence" || tab.type === "sequence-list" ? "bi-arrow-repeat"
    : tab.type === "view" || tab.type === "view-list" ? "bi-eye"
    : tab.type === "view-definition" || tab.type === "view-definition-list" ? "bi-layout-text-window"
    : tab.type === "page-layout" || tab.type === "page-layout-list" ? "bi-layout-wtf"
    : tab.type === "generic-definition" || tab.type === "generic-definition-list" || tab.type === "generic-definition-catalog" ? "bi-collection"
    : tab.type === "extensions" ? "bi-puzzle"
    : tab.type === "tech-stack" ? "bi-gear"
    : "bi-file-earmark";

  const handleClick = () => setActiveTab(tab.id);

  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(e);
    }
  };

  return (
    <div
      ref={setNodeRef}
      data-tab-id={tab.id}
      style={style}
      {...attributes}
      {...listeners}
      className={[
        "tabbar-tab",
        isActive ? "active" : "",
        tab.isPinned ? "pinned" : "",
        isDragging ? "tabbar-tab-drag" : "",
        tab.isDirty ? "dirty" : "",
      ].filter(Boolean).join(" ")}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      onContextMenu={onContextMenu}
      title={tab.label}
    >
      <i className={`bi ${icon} tabbar-tab-icon`} />
      <span className="tabbar-tab-label">{tab.label}</span>
      {tab.isDirty && <span className="tabbar-tab-dirty">●</span>}
      <button
        className="tabbar-tab-close"
        onClick={onClose}
        title="閉じる"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <i className="bi bi-x" />
      </button>
    </div>
  );
}

export function TabBar() {
  const { tabs, activeTabId } = useTabs();
  const { wsId } = useWorkspacePath();

  // 未保存の変更があるタブが 1 つでもあれば、ブラウザを閉じる・再読み込みする前に確認を出す
  const anyDirty = tabs.some((t) => t.isDirty);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  // ブラウザのタブ名: 開いている設計の名前 (未保存の変更があれば「●」つき)。ブラウザのタブを複数開いていても見分けられる
  useEffect(() => {
    const active = tabs.find((t) => t.id === activeTabId);
    document.title = active ? `${active.isDirty ? "● " : ""}${active.label} - Harmony` : "Harmony";
    return () => { document.title = "Harmony"; };
  }, [tabs, activeTabId]);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = tabs.findIndex((t) => t.id === active.id);
    const newIdx = tabs.findIndex((t) => t.id === over.id);
    if (oldIdx !== -1 && newIdx !== -1) {
      reorderTabs(oldIdx, newIdx);
    }
  };

  const handleClose = useCallback((tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.isDirty) {
      if (!confirm(`「${tab.label}」に未保存の変更があります。閉じますか？`)) return;
      closeTab(tabId, true);
    } else {
      closeTab(tabId);
    }
  }, [tabs]);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextMenu]);

  const updateScrollAffordance = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const maxScrollLeft = list.scrollWidth - list.clientWidth;
    setCanScrollLeft(list.scrollLeft > 1);
    setCanScrollRight(list.scrollLeft < maxScrollLeft - 1);
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    updateScrollAffordance();
    list.addEventListener("scroll", updateScrollAffordance, { passive: true });
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateScrollAffordance);
    resizeObserver?.observe(list);
    return () => {
      list.removeEventListener("scroll", updateScrollAffordance);
      resizeObserver?.disconnect();
    };
  }, [tabs.length, updateScrollAffordance]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeTabId) return;
    const active = Array.from(list.querySelectorAll<HTMLElement>(".tabbar-tab"))
      .find((el) => el.dataset.tabId === activeTabId);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
    requestAnimationFrame(updateScrollAffordance);
  }, [activeTabId, updateScrollAffordance]);

  const handleScrollTabs = (direction: "left" | "right") => {
    const list = listRef.current;
    if (!list) return;
    list.scrollBy({
      left: direction === "left" ? -Math.max(160, list.clientWidth * 0.6) : Math.max(160, list.clientWidth * 0.6),
      behavior: "smooth",
    });
  };

  if (tabs.length === 0) return null;

  const ctxTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null;

  return (
    <>
      <nav
        aria-label="開いているタブ"
        className={[
          "tabbar",
          canScrollLeft ? "tabbar-can-scroll-left" : "",
          canScrollRight ? "tabbar-can-scroll-right" : "",
        ].filter(Boolean).join(" ")}
      >
        {canScrollLeft && (
          <button
            type="button"
            className="tabbar-scroll-btn tabbar-scroll-btn-left"
            onClick={() => handleScrollTabs("left")}
            title="左のタブへスクロール"
            aria-label="左のタブへスクロール"
          >
            <i className="bi bi-chevron-left" />
          </button>
        )}
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={tabs.map((t) => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div ref={listRef} className="tabbar-list">
              {tabs.map((tab) => (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === activeTabId}
                  onClose={(e) => { e.stopPropagation(); handleClose(tab.id); }}
                  onContextMenu={(e) => handleContextMenu(e, tab.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {canScrollRight && (
          <button
            type="button"
            className="tabbar-scroll-btn tabbar-scroll-btn-right"
            onClick={() => handleScrollTabs("right")}
            title="右のタブへスクロール"
            aria-label="右のタブへスクロール"
          >
            <i className="bi bi-chevron-right" />
          </button>
        )}
      </nav>

      {contextMenu && ctxTab && (
        <div
          ref={contextMenuRef}
          className="tab-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="tab-context-item" onClick={() => { handleClose(contextMenu.tabId); setContextMenu(null); }}>
            <i className="bi bi-x" /> 閉じる
          </div>
          <div className="tab-context-item" onClick={() => { closeOtherTabs(contextMenu.tabId); setContextMenu(null); }}>
            <i className="bi bi-x-circle" /> 他を全て閉じる
          </div>
          <div className="tab-context-item" onClick={() => { closeTabsToRight(contextMenu.tabId); setContextMenu(null); }}>
            <i className="bi bi-arrow-bar-right" /> 右側を全て閉じる
          </div>
          <div className="tab-context-separator" />
          {ctxTab.type !== "workspace-list" && (
            <div className={`tab-context-item${contextMenu.tabId === activeTabId ? " disabled" : ""}`} data-testid="tab-open-split"
              title={contextMenu.tabId === activeTabId ? "いま開いているタブは、右側に並べられません。別のタブで試してください" : "このタブを、右側に並べて表示する (左は、いま開いているタブのまま)"}
              onClick={() => {
                if (contextMenu.tabId === activeTabId) return;
                const path = wsId ? tabPath("", ctxTab) : null;
                if (path && wsId) setSplit(wsId, { path, label: ctxTab.label, tabId: ctxTab.id });
                setContextMenu(null);
              }}>
              <i className="bi bi-layout-sidebar-inset-reverse" /> 右側に並べて表示
            </div>
          )}
          <div className="tab-context-item" onClick={() => { moveTabBy(contextMenu.tabId, -1); setContextMenu(null); }} data-testid="tab-move-left">
            <i className="bi bi-arrow-left" /> 左へ動かす
          </div>
          <div className="tab-context-item" onClick={() => { moveTabBy(contextMenu.tabId, 1); setContextMenu(null); }} data-testid="tab-move-right">
            <i className="bi bi-arrow-right" /> 右へ動かす
          </div>
          <div className="tab-context-item" onClick={() => { setPinned(contextMenu.tabId, !ctxTab.isPinned); setContextMenu(null); }}>
            <i className={`bi bi-pin${ctxTab.isPinned ? "-angle" : ""}`} />
            {ctxTab.isPinned ? "ピン留めを解除" : "ピン留め"}
          </div>
        </div>
      )}
    </>
  );
}
