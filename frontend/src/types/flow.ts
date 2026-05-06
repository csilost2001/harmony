/**
 * 画面フロー UI で使う合成型 (Phase 3-β、#561)
 *
 * v3 では Screen (業務情報) と ScreenLayout.positions[id] (UI 座標) を分離保存する。
 * UI 側 (FlowEditor / ScreenListView 等) では両者を合成した shape を扱うほうが扱いやすいため、
 * 永続化は別系統だが React state として `ScreenNode` / `ScreenEdge` / `ScreenGroup` を保持する。
 *
 * 永続化境界 (flowStore / screenLayoutStore) で合成・分解する。
 */
import type {
  LocalId,
  ProcessFlowEntry,
  ScreenGroupId,
  ScreenId,
  ScreenKind,
  ScreenTransitionEntry,
  Timestamp,
} from "./v3";

/** UI 用 ScreenNode: v3 Screen 業務情報 + UI 座標 (ScreenLayout.positions[id])。 */
export interface ScreenNode {
  id: ScreenId;
  /** 物理順 (1..N 連番)。詳細は docs/spec/list-common.md §3.10 */
  no: number;
  name: string;
  kind: ScreenKind;
  description: string;
  path: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  hasDesign: boolean;
  /** 所属グループ ID (Screen.groupId)。 */
  groupId?: ScreenGroupId;
  /** デザインのサムネイル (data:image/jpeg;base64,...、Position.thumbnail に格納)。 */
  thumbnail?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** UI 用 ScreenGroup: ScreenGroupEntry + UI 座標 (ScreenLayout.positions[id])。 */
export interface ScreenGroup {
  id: ScreenGroupId;
  name: string;
  color?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** UI 用 ScreenEdge: ScreenTransitionEntry + UI handle (ScreenLayout.transitions[id])。 */
export interface ScreenEdge {
  id: LocalId;
  source: ScreenId;
  target: ScreenId;
  sourceHandle?: string;
  targetHandle?: string;
  label: string;
  trigger: ScreenTransitionEntry["trigger"];
}

/** Screen 種別の表示ラベル (12 種、v3 BuiltinScreenKind に対応)。 */
export const SCREEN_KIND_LABELS: Record<string, string> = {
  login: "ログイン",
  dashboard: "ダッシュボード",
  list: "一覧",
  detail: "詳細",
  form: "入力フォーム",
  search: "検索",
  confirm: "確認",
  complete: "完了",
  error: "エラー",
  modal: "モーダル",
  wizard: "ウィザード",
  other: "その他",
};

/** Screen 種別アイコン (Bootstrap Icons)。 */
export const SCREEN_KIND_ICONS: Record<string, string> = {
  login: "bi-box-arrow-in-right",
  dashboard: "bi-speedometer2",
  list: "bi-list-ul",
  detail: "bi-file-earmark-text",
  form: "bi-pencil-square",
  search: "bi-search",
  confirm: "bi-check-circle",
  complete: "bi-check2-all",
  error: "bi-exclamation-triangle",
  modal: "bi-window-stack",
  wizard: "bi-magic",
  other: "bi-circle",
};

/** 遷移トリガーの表示ラベル (v3 ScreenTransitionEntry.trigger と同 union)。 */
export const TRIGGER_LABELS: Record<ScreenTransitionEntry["trigger"], string> = {
  click: "クリック",
  submit: "フォーム送信",
  select: "行選択",
  cancel: "キャンセル",
  auto: "自動遷移",
  back: "戻る",
  other: "その他",
};

/**
 * UI で扱う集約型 (FlowEditor などで使う)。
 *
 * 永続化は project.json + data/screen-layout.json + data/screens/<id>.json に分離するが、
 * UI 上は 1 つの React state として保持する。flowStore.loadProject() / saveProject() が境界で合成・分解する。
 */
export interface FlowProject {
  /** UI 集約型のバージョン (Phase 3-β = 1)。 */
  version: 1;
  name: string;
  screens: ScreenNode[];
  groups: ScreenGroup[];
  edges: ScreenEdge[];
  tables?: import("./v3").TableEntry[];
  processFlows?: ProcessFlowMeta[];
  sequences?: import("./v3").SequenceEntry[];
  views?: import("./v3").ViewEntry[];
  updatedAt: Timestamp;
}

/**
 * 処理フローメタ情報 (project.json 管理用、Phase 4 で v3 ProcessFlowEntry に統合予定)。
 */
export type ProcessFlowMeta = ProcessFlowEntry;


// ─── 後方互換 alias (Phase 4 で削除) ─────────────────────────────────
//
// Phase 3-α 以前は kind を `type` で参照していた箇所がある。Phase 3-β で名称統一するが、
// 移行期間中は alias を提供する。

/** @deprecated Phase 3-β で `ScreenKind` に統合。 */
export type ScreenType = ScreenKind;
/** @deprecated Phase 3-β で `SCREEN_KIND_LABELS` に rename。 */
export const SCREEN_TYPE_LABELS = SCREEN_KIND_LABELS;
/** @deprecated Phase 3-β で `SCREEN_KIND_ICONS` に rename。 */
export const SCREEN_TYPE_ICONS = SCREEN_KIND_ICONS;
/** @deprecated Phase 3-β で `ScreenTransitionEntry["trigger"]` に統合。 */
export type TransitionTrigger = ScreenTransitionEntry["trigger"];
