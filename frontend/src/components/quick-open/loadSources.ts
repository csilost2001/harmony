/**
 * クイックオープン / お気に入り / コマンドパレットが使う、候補の読み込みと「開く」の共通処理。
 */
import { loadProject } from "../../store/flowStore";
import { listBusinessFlows } from "../../store/businessFlowStore";
import { listReports } from "../../store/reportStore";
import { listPageLayouts } from "../../store/pageLayoutStore";
import { DASHBOARD_ITEM, MENU_ITEMS } from "../menuItems";
import { clearActiveTab, getActiveTabId, getTabs } from "../../store/tabStore";
import { requestQuickCreate } from "../../hooks/useQuickCreate";
import { rememberQuickOpen, type QuickOpenEntry, type QuickOpenSources } from "../../utils/quickOpen";

/** /workspace/* と /ai-settings はワークスペースの外にある (HeaderMenu と同じ扱い) */
export const isWorkspaceScoped = (route: string) => !route.startsWith("/workspace/") && route !== "/ai-settings";

export async function loadQuickOpenSources(): Promise<QuickOpenSources> {
  const [project, businessFlows, reports, pageLayouts] = await Promise.allSettled([loadProject(), listBusinessFlows(), listReports(), listPageLayouts()]);
  const p = project.status === "fulfilled" ? project.value : null;
  return {
    screens: (p?.screens ?? []).filter((s) => s.purpose !== "gadget").map((s) => ({ id: s.id, name: s.name, path: s.path })),
    tables: (p?.tables ?? []).map((t) => ({ id: t.id, name: t.name, physicalName: t.physicalName })),
    processFlows: (p?.processFlows ?? []).map((f) => ({ id: f.id, name: f.name })),
    sequences: (p?.sequences ?? []).map((s) => ({ id: s.id, name: s.name, physicalName: s.physicalName })),
    views: (p?.views ?? []).map((v) => ({ id: v.id, name: v.name, physicalName: v.physicalName })),
    viewDefinitions: (p?.viewDefinitions ?? []).map((v) => ({ id: v.id, name: v.name })),
    businessFlows: businessFlows.status === "fulfilled" ? businessFlows.value.map((f) => ({ id: f.id, name: f.name })) : [],
    pageLayouts: pageLayouts.status === "fulfilled" ? pageLayouts.value.map((l) => ({ id: String(l.id), name: String(l.name ?? l.id) })) : [],
    gadgets: (p?.screens ?? []).filter((s) => s.purpose === "gadget").map((s) => ({ id: s.id, name: s.name })),
    reports: reports.status === "fulfilled" ? reports.value.map((r) => ({ id: r.id, name: r.name })) : [],
    pages: [DASHBOARD_ITEM, ...MENU_ITEMS].map((m) => ({ id: m.id, label: m.label, route: m.route })),
  };
}


/**
 * 候補を開く (クイックオープン・お気に入りの共通処理)。デザインタブがアクティブなままだと遷移先が表示されないので、先に外す。
 * 作成は「最近開いた」には載せない (一覧を開いて、追加ダイアログを出す)。
 */
export function openQuickOpenEntry(entry: QuickOpenEntry, navigate: (to: string) => void, wsPath: (suffix: string) => string): void {
  const activeId = getActiveTabId();
  if (getTabs().some((t) => t.id === activeId && t.type === "design")) clearActiveTab();
  if (entry.kind === "create") requestQuickCreate(entry.id);
  else rememberQuickOpen(entry.key);
  navigate(isWorkspaceScoped(entry.route) ? wsPath(entry.route) : entry.route);
}
