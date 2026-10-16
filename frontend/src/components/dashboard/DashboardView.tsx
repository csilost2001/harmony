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
import { movePanel, panelKeyAction, resizePanel } from "./dashboardLayout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "../../styles/dashboard.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

const LAYOUT_STORAGE_KEY = "dashboard-layout-v1";
const HIDDEN_STORAGE_KEY = "dashboard-hidden-v1";
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

function loadHidden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
function storeHidden(ids: string[]): void {
  try { if (ids.length === 0) localStorage.removeItem(HIDDEN_STORAGE_KEY); else localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(ids)); } catch { /* ignore */ }
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

  // 非表示にしたパネル (このブラウザにだけ覚える)
  const [hidden, setHidden] = useState<string[]>(loadHidden);
  const [menuOpen, setMenuOpen] = useState(false);
  const setPanelHidden = (id: string, hide: boolean) => setHidden((cur) => {
    const next = hide ? [...new Set([...cur, id])] : cur.filter((x) => x !== id);
    storeHidden(next);
    return next;
  });
  const resetDashboard = () => {
    try { localStorage.removeItem(LAYOUT_STORAGE_KEY); } catch { /* ignore */ }
    storeHidden([]);
    setHidden([]);
    setLayouts({ lg: defaultLayout });
    setMenuOpen(false);
  };
  const visiblePanels = dashboardPanels.filter((p) => !hidden.includes(p.id));

  const [breakpoint, setBreakpoint] = useState<keyof typeof COLS>("lg");
  const [announce, setAnnounce] = useState("");

  /** キーボードでのパネルの移動・大きさの変更 (ドラッグ / リサイズの代わり)。いまの幅のレイアウトを書き換えて保存する */
  const handlePanelKey = useCallback((e: React.KeyboardEvent, id: string, title: string) => {
    const act = panelKeyAction(e.nativeEvent);
    if (!act) return;
    e.preventDefault();
    const cols = COLS[breakpoint];
    setLayouts((cur) => {
      const base = (cur[breakpoint] ?? cur.lg ?? []) as LayoutItem[];
      const next = act.kind === "move" ? movePanel(base, id, act.dx, act.dy, cols) : resizePanel(base, id, act.dx, act.dy, cols);
      if (next.every((p, i) => p === base[i])) return cur;
      const all = { ...cur, [breakpoint]: next };
      storeLayouts(all);
      const p = next.find((x) => x.i === id);
      if (p) setAnnounce(`${title}: ${act.kind === "move" ? "位置" : "大きさ"}を変えました (列 ${p.x + 1}、行 ${p.y + 1}、幅 ${p.w}、高さ ${p.h})`);
      return all;
    });
  }, [breakpoint]);

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
          プロジェクト全体の状況を俯瞰 <span className="dashboard-hint">（パネルはドラッグ/リサイズ可能。キーボードでは、パネルの見出しで Alt+矢印 = 移動、Alt+Shift+矢印 = 大きさ）</span>
        </p>
        <div className="dashboard-panel-menu">
          <button type="button" className="btn btn-sm btn-outline-secondary" aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)} data-testid="dashboard-panels-btn">
            <i className="bi bi-grid-3x3-gap" /> 表示するパネル{hidden.length > 0 ? ` (${hidden.length} 件を隠しています)` : ""}
          </button>
          {menuOpen && (
            <div className="dashboard-panel-menu-pop" role="group" aria-label="表示するパネル" data-testid="dashboard-panels-menu">
              {dashboardPanels.map((p) => (
                <label key={p.id}><input type="checkbox" checked={!hidden.includes(p.id)} onChange={(e) => setPanelHidden(p.id, !e.target.checked)} /> {p.title}</label>
              ))}
              <button type="button" className="btn btn-sm btn-link" onClick={resetDashboard} data-testid="dashboard-reset">初期の配置に戻す</button>
            </div>
          )}
        </div>
      </div>

      <ResponsiveGridLayout
        className="dashboard-grid"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        onLayoutChange={handleLayoutChange}
        onBreakpointChange={(bp: string) => setBreakpoint(bp as keyof typeof COLS)}
        draggableHandle=".panel-drag-handle"
      >
        {visiblePanels.map((p) => {
          const PanelComponent = p.component;
          return (
            <div key={p.id} className="dashboard-panel">
              <div className="panel-header panel-drag-handle" tabIndex={0} role="group"
                aria-label={`パネル「${p.title}」 (Alt+矢印で移動、Alt+Shift+矢印で大きさを変える)`}
                title="ドラッグで移動。キーボードでは、ここにフォーカスして Alt+矢印で移動、Alt+Shift+矢印で大きさ"
                onKeyDown={(e) => handlePanelKey(e, p.id, p.title)} data-testid={`panel-handle-${p.id}`}>
                {p.icon && <i className={`bi ${p.icon}`} />}
                <span className="panel-title">{p.title}</span>
                <button type="button" className="panel-hide-btn" onClick={() => setPanelHidden(p.id, true)} onMouseDown={(e) => e.stopPropagation()}
                  title="このパネルを隠す (「表示するパネル」から戻せます)" aria-label={`パネル「${p.title}」を隠す`} data-testid={`panel-hide-${p.id}`}><i className="bi bi-eye-slash" /></button>
              </div>
              <div className="panel-body">
                <PanelComponent />
              </div>
            </div>
          );
        })}
      </ResponsiveGridLayout>
      <div className="visually-hidden" role="status" aria-live="polite" data-testid="dashboard-announce">{announce}</div>
    </div>
  );
}
