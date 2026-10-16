/**
 * パンくず (UI 改善提案 続編 第 6 弾 #108): いま開いているタブが「どの区分の、どの一覧の、どの設計」かを、
 * タブバーの下の 1 行に出すための組み立て (画面に依存しない純関数)。一覧は、押すと一覧のタブへ移る。
 */
import type { TabItem, TabType } from "../store/tabStore";

export interface Crumb {
  label: string;
  /** 押すと開く (一覧のタブ)。無ければ区分名・いま開いている設計で、押せない */
  open?: { type: TabType; resourceId: string; label: string };
}

/** パンくずの 1 行の高さ (px)。タブバーと合わせて --tabbar-h に入れる */
export const BREADCRUMB_HEIGHT = 22;

const list = (type: TabType, label: string): Crumb => ({ label, open: { type, resourceId: "main", label } });

/** 設計 1 件を開くタブ: [区分, 一覧, その設計] */
const RESOURCE: Partial<Record<TabType, [string, Crumb]>> = {
  "design": ["画面", list("screen-list", "画面一覧")],
  "screen-items": ["画面", list("screen-list", "画面一覧")],
  "page-layout": ["画面", list("page-layout-list", "ページレイアウト一覧")],
  "process-flow": ["処理", list("process-flow-list", "処理フロー一覧")],
  "business-flow": ["処理", list("business-flow-list", "業務フロー")],
  "report": ["処理", list("report-list", "帳票")],
  "table": ["データ", list("table-list", "テーブル一覧")],
  "sequence": ["データ", list("sequence-list", "シーケンス一覧")],
  "view": ["データ", list("view-list", "ビュー一覧")],
  "view-definition": ["データ", list("view-definition-list", "ビュー定義一覧")],
  "generic-definition": ["規約・定義", list("generic-definition-list", "汎用定義一覧")],
};

/** 一覧・図・設定の画面: [区分, 画面名] */
const PAGE: Partial<Record<TabType, [string, string]>> = {
  "screen-flow": ["画面", "画面フロー"],
  "screen-list": ["画面", "画面一覧"],
  "page-layout-list": ["画面", "ページレイアウト一覧"],
  "gadget-list": ["画面", "ガジェット一覧"],
  "process-flow-list": ["処理", "処理フロー一覧"],
  "business-flow-list": ["処理", "業務フロー"],
  "report-list": ["処理", "帳票"],
  "table-list": ["データ", "テーブル一覧"],
  "er": ["データ", "ER 図"],
  "sequence-list": ["データ", "シーケンス一覧"],
  "view-list": ["データ", "ビュー一覧"],
  "view-definition-list": ["データ", "ビュー定義一覧"],
  "generic-definition-list": ["規約・定義", "汎用定義一覧"],
  "generic-definition-catalog": ["規約・定義", "汎用定義カタログ"],
  "conventions-catalog": ["規約・定義", "規約カタログ"],
  "design-document": ["出力", "設計書"],
  "design-analysis": ["出力", "設計の分析"],
  "operations": ["出力", "連携と運用"],
  "markers": ["出力", "マーカー"],
  "extensions": ["設定", "拡張"],
  "tech-stack": ["設定", "技術スタック"],
};

/** タブのパンくず。出さないタブ (ダッシュボード・ワークスペース) は null */
export function breadcrumbFor(tab: Pick<TabItem, "type" | "label"> | null | undefined): Crumb[] | null {
  if (!tab) return null;
  const res = RESOURCE[tab.type];
  if (res) return [{ label: res[0] }, res[1], { label: tab.label }];
  const page = PAGE[tab.type];
  if (page) return [{ label: page[0] }, { label: page[1] }];
  return null;
}
