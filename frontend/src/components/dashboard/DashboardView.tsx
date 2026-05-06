/**
 * ダッシュボード画面
 *
 * react-grid-layout でパネルをドラッグ/リサイズ可能に配置し、
 * レイアウト状態を localStorage に永続化する。
 *
 * パネルの定義は `panelRegistry.ts` に集約。新規パネル追加時は
 * 本ファイルの変更は不要。
 */
import { useCallback, useMemo, useState } from "react";
import { Responsive, WidthProvider, type Layout, type LayoutItem } from "react-grid-layout/legacy";
import { dashboardPanels } from "./panelRegistry";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "../../styles/dashboard.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

const LAYOUT_STORAGE_KEY = "dashboard-layout-v1";
const ROW_HEIGHT = 80;
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

// react-grid-layout v2: Layout = LayoutItem[]（breakpoint 毎の layout を保持する map）
type StoredLayouts = Partial<Record<string, Layout>>;

function loadStoredLayouts(): StoredLayouts | null {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredLayouts) : null;
  } catch {
    return null;
  }
}

/**
 * 既存の保存済みレイアウトに対し、panelRegistry の最新 min/max 制約を反映する。
 * - 既存 item の w/h が minW/minH を下回っていれば引き上げる (過去の小さすぎる保存値の救済)
 * - 未登録の新パネルがあれば default を末尾追加
 */
function reconcileLayouts(stored: StoredLayouts, defaults: LayoutItem[]): StoredLayouts {
  const reconciled: StoredLayouts = {};
  const defaultById = new Map(defaults.map((d) => [d.i, d]));
  for (const [bp, layout] of Object.entries(stored)) {
    if (!layout) continue;
    const seen = new Set<string>();
    const merged: LayoutItem[] = layout.map((item) => {
      seen.add(item.i);
      const def = defaultById.get(item.i);
      if (!def) return item;
      const minW = def.minW ?? item.minW;
      const minH = def.minH ?? item.minH;
      return {
        ...item,
        w: minW != null ? Math.max(item.w, minW) : item.w,
        h: minH != null ? Math.max(item.h, minH) : item.h,
        minW,
        minH,
        maxW: def.maxW ?? item.maxW,
        maxH: def.maxH ?? item.maxH,
      };
    });
    for (const def of defaults) {
      if (!seen.has(def.i)) merged.push(def);
    }
    reconciled[bp] = merged;
  }
  return reconciled;
}

function storeLayouts(layouts: StoredLayouts): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch { /* ignore */ }
}

/** 登録済みパネルから初期レイアウトを生成 */
function buildDefaultLayout(): LayoutItem[] {
  let cursorY = 0;
  return dashboardPanels.map((p, i) => {
    const x = p.defaultLayout.x ?? (i * p.defaultLayout.w) % COLS.lg;
    const y = p.defaultLayout.y ?? cursorY;
    cursorY = y + p.defaultLayout.h;
    return {
      i: p.id,
      x,
      y,
      w: p.defaultLayout.w,
      h: p.defaultLayout.h,
      minW: p.defaultLayout.minW,
      minH: p.defaultLayout.minH,
      maxW: p.defaultLayout.maxW,
      maxH: p.defaultLayout.maxH,
    };
  });
}

export function DashboardView() {
  const defaultLayout = useMemo(() => buildDefaultLayout(), []);
  const [layouts, setLayouts] = useState<StoredLayouts>(() => {
    const stored = loadStoredLayouts();
    if (stored) return reconcileLayouts(stored, defaultLayout);
    return { lg: defaultLayout };
  });

  const handleLayoutChange = useCallback(
    (_current: Layout, allLayouts: StoredLayouts) => {
      setLayouts(allLayouts);
      storeLayouts(allLayouts);
    },
    [],
  );

  if (dashboardPanels.length === 0) {
    return (
      <div className="dashboard-view">
        <div className="dashboard-header">
          <h1 className="dashboard-title">
            <i className="bi bi-speedometer2" /> ダッシュボード
          </h1>
          <p className="dashboard-subtitle">プロジェクト全体の状況を俯瞰</p>
        </div>
        <div className="dashboard-placeholder">
          <i className="bi bi-grid-3x3-gap" />
          <p>パネルが未登録です（Issue #86 PR-5 以降で追加予定）</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-view">
      <div className="dashboard-header">
        <h1 className="dashboard-title">
          <i className="bi bi-speedometer2" /> ダッシュボード
        </h1>
        <p className="dashboard-subtitle">
          プロジェクト全体の状況を俯瞰 <span className="dashboard-hint">（パネルはドラッグ/リサイズ可能）</span>
        </p>
      </div>

      <ResponsiveGridLayout
        className="dashboard-grid"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".panel-drag-handle"
      >
        {dashboardPanels.map((p) => {
          const PanelComponent = p.component;
          return (
            <div key={p.id} className="dashboard-panel">
              <div className="panel-header panel-drag-handle">
                {p.icon && <i className={`bi ${p.icon}`} />}
                <span className="panel-title">{p.title}</span>
              </div>
              <div className="panel-body">
                <PanelComponent />
              </div>
            </div>
          );
        })}
      </ResponsiveGridLayout>
    </div>
  );
}
