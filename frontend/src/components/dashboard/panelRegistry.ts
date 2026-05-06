/**
 * ダッシュボードパネルレジストリ
 *
 * 新しいパネルを追加する際は、本ファイルの `dashboardPanels` 配列に項目を追加するだけで
 * ダッシュボードに表示されるようにする拡張性重視の設計。
 *
 * 各パネルは独立コンポーネントとして以下を自己完結:
 *  - データ取得
 *  - レンダリング
 *  - エラーハンドリング
 * 他パネルに影響しないこと。
 */
import type { ComponentType } from "react";
import { FunctionCountsPanel } from "./panels/FunctionCountsPanel";
import { UnsavedDraftsPanel } from "./panels/UnsavedDraftsPanel";
import { RecentEditsPanel } from "./panels/RecentEditsPanel";
import { ProcessFlowMaturityPanel } from "./panels/ProcessFlowMaturityPanel";
import { MarkersSummaryPanel } from "./panels/MarkersSummaryPanel";

/** react-grid-layout の 1 パネルのレイアウト指定 */
export interface PanelLayout {
  /** 幅（カラム数、ダッシュボードは 12 カラム想定）*/
  w: number;
  /** 高さ（行数、1 行 = `rowHeight` px）*/
  h: number;
  /** 初期 X 位置（省略時は自動配置）*/
  x?: number;
  /** 初期 Y 位置（省略時は自動配置）*/
  y?: number;
  /** 最小幅 */
  minW?: number;
  /** 最小高さ */
  minH?: number;
  /** 最大幅 */
  maxW?: number;
  /** 最大高さ */
  maxH?: number;
}

export interface DashboardPanel {
  /** ユニーク ID（localStorage キーや react-grid-layout の item key に使う）*/
  id: string;
  /** パネルタイトル（ヘッダーに表示）*/
  title: string;
  /** Bootstrap Icons クラス名（例: "bi-bar-chart"）*/
  icon?: string;
  /** 初期レイアウト指定 */
  defaultLayout: PanelLayout;
  /** パネル本体コンポーネント（props は受け取らない。データ取得は自身で行う）*/
  component: ComponentType;
}

/**
 * 登録されたダッシュボードパネル一覧。
 * 配列の順序が初期表示順を決める（y, x が未指定の場合）。
 */
export const dashboardPanels: DashboardPanel[] = [
  {
    id: "function-counts",
    title: "機能別定義数",
    icon: "bi-bar-chart-line",
    defaultLayout: { w: 6, h: 3, minW: 4, minH: 3 },
    component: FunctionCountsPanel,
  },
  {
    id: "process-flow-maturity",
    title: "処理フロー成熟度",
    icon: "bi-speedometer2",
    defaultLayout: { w: 6, h: 3, minW: 4, minH: 3 },
    component: ProcessFlowMaturityPanel,
  },
  {
    id: "markers-summary",
    title: "AI 依頼マーカー",
    icon: "bi-megaphone",
    defaultLayout: { w: 6, h: 4, minW: 4, minH: 3 },
    component: MarkersSummaryPanel,
  },
  {
    id: "unsaved-drafts",
    title: "未保存ドラフト",
    icon: "bi-hourglass-split",
    defaultLayout: { w: 6, h: 4, minW: 4, minH: 3 },
    component: UnsavedDraftsPanel,
  },
  {
    id: "recent-edits",
    title: "最近編集したもの",
    icon: "bi-clock-history",
    defaultLayout: { w: 6, h: 5, minW: 4, minH: 4 },
    component: RecentEditsPanel,
  },
];
