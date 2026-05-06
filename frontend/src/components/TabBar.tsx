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
} from "../store/tabStore";
import "../styles/tabbar.css";

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
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  if (tabs.length === 0) return null;

  const ctxTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null;

  return (
    <>
      <div className="tabbar">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={tabs.map((t) => t.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="tabbar-list">
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
      </div>

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
          <div className="tab-context-item" onClick={() => { setPinned(contextMenu.tabId, !ctxTab.isPinned); setContextMenu(null); }}>
            <i className={`bi bi-pin${ctxTab.isPinned ? "-angle" : ""}`} />
            {ctxTab.isPinned ? "ピン留めを解除" : "ピン留め"}
          </div>
        </div>
      )}
    </>
  );
}
