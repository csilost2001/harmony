// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-3 (#1145): ProcessFlowEditor.tsx から action trigger 関連の定数 / ヘルパーを抽出。
// アクション (trigger) の icon / カテゴリ / リッチヘルプ / ラベルの取得。

// #1186 Phase 2-D: constants は processFlowMetadata から
import { ACTION_TRIGGER_LABELS } from "../../../utils/processFlowMetadata";
import type { ActionDefinition, ActionTrigger, Marker } from "../../../types/v3";

export const ALL_TRIGGERS: ActionTrigger[] = [
  "click",
  "submit",
  "select",
  "change",
  "load",
  "timer",
  "other",
];

export const ACTION_TRIGGER_ICONS: Record<string, string> = {
  click: "bi-cursor",
  submit: "bi-send",
  select: "bi-list-check",
  change: "bi-pencil-square",
  load: "bi-box-arrow-in-down",
  unload: "bi-box-arrow-right",
  timer: "bi-clock",
  manual: "bi-person-check",
  other: "bi-lightning-charge",
};

export const ACTION_TRIGGER_CATEGORIES: Record<string, string> = {
  click: "画面操作",
  submit: "入力確定",
  select: "選択連動",
  change: "値変更",
  load: "初期表示",
  unload: "終了処理",
  timer: "時刻・周期",
  manual: "手動実行",
  other: "その他",
};

export interface ActionTriggerRichHelp {
  occasion: string;
  useCases: string[];
  definitionExample: string;
  stepExample: string[];
  notes: string[];
}

export const ACTION_TRIGGER_RICH_HELP: Record<string, ActionTriggerRichHelp> = {
  click: {
    occasion: "ボタンやリンクなど、利用者が明示的に押した UI 操作を契機に動きます。",
    useCases: ["詳細表示", "削除確認", "検索条件クリア", "別画面への遷移"],
    definitionExample: "trigger: click / inputs: 選択行ID・画面入力値 / responses: 完了メッセージ",
    stepExample: ["入力・選択状態を確認", "必要な DB 更新または参照", "画面更新または画面遷移"],
    notes: ["連打や二重送信を避ける制御が必要な場合は validation や workflow に明記します。"],
  },
  submit: {
    occasion: "フォーム送信や確定操作で、入力内容を業務データとして確定するときに動きます。",
    useCases: ["登録", "更新", "申請", "承認依頼"],
    definitionExample: "trigger: submit / inputs: フォーム全項目 / outputs: 登録ID / responses: 成功・入力エラー",
    stepExample: ["必須・形式チェック", "業務ルール検証", "DB 保存", "レスポンス返却"],
    notes: ["入力エラーとシステムエラーの responses を分けると、AI 実装時の分岐が明確になります。"],
  },
  select: {
    occasion: "一覧行、候補、タブなどの選択状態が変わったタイミングで動きます。",
    useCases: ["一覧行の詳細表示", "候補選択による関連情報取得", "親子リストの絞り込み"],
    definitionExample: "trigger: select / inputs: selectedId / outputs: detailModel",
    stepExample: ["選択IDの存在確認", "関連データ取得", "表示モデルへ反映"],
    notes: ["選択解除時の扱いが必要なら other response または branch に明記します。"],
  },
  change: {
    occasion: "入力値やフィルタ条件が変わった直後に、画面内の連動処理として動きます。",
    useCases: ["金額再計算", "項目の表示切替", "候補リスト更新", "入力補助"],
    definitionExample: "trigger: change / inputs: changedField・currentForm / outputs: derivedValues",
    stepExample: ["変更項目を判定", "派生値を計算", "表示状態を更新"],
    notes: ["高頻度に動くため、重い外部呼び出しは debounce や submit 側への移動を検討します。"],
  },
  load: {
    occasion: "画面表示、初期データ取得、リソース読み込みの開始時に動きます。",
    useCases: ["初期検索", "選択肢取得", "初期値設定", "権限に応じた表示制御"],
    definitionExample: "trigger: load / inputs: routeParams・sessionUser / outputs: initialViewModel",
    stepExample: ["起動条件を確認", "初期データを取得", "画面モデルを構築"],
    notes: ["表示前に必要なデータと、表示後に遅延取得できるデータを分けると実装しやすくなります。"],
  },
  unload: {
    occasion: "画面離脱、タブ終了、編集終了など、利用者が作業文脈を閉じるときに動きます。",
    useCases: ["一時保存", "ロック解放", "離脱確認", "監査ログ記録"],
    definitionExample: "trigger: unload / inputs: dirtyState・lockId / responses: 保存済み・破棄確認",
    stepExample: ["未保存状態を確認", "必要なら保存または確認", "ロックや一時資源を解放"],
    notes: ["ブラウザ終了時は非同期処理が完了しない可能性があるため、重要処理は明示保存側に寄せます。"],
  },
  timer: {
    occasion: "一定間隔、指定時刻、期限到来など時間条件を契機に動きます。",
    useCases: ["自動更新", "期限チェック", "バッチ起動", "再試行"],
    definitionExample: "trigger: timer / inputs: schedule・lastRunAt / outputs: runSummary",
    stepExample: ["実行条件を確認", "対象データを抽出", "処理を実行", "結果を記録"],
    notes: ["重複起動、タイムアウト、リトライ方針を steps または SLA に記述します。"],
  },
  manual: {
    occasion: "運用者や管理者が、通常 UI フローとは別に明示起動するときに動きます。",
    useCases: ["手動再実行", "補正処理", "管理操作", "障害復旧"],
    definitionExample: "trigger: manual / inputs: operatorId・targetId / responses: 実行結果・権限エラー",
    stepExample: ["権限を確認", "対象を検証", "処理を実行", "監査ログを残す"],
    notes: ["誰が何を起動できるかを inputs と validation に明記します。"],
  },
  other: {
    occasion: "標準 trigger に当てはまらない、プロジェクト固有の契機で動きます。",
    useCases: ["外部通知", "組み込み拡張", "特殊な業務イベント"],
    definitionExample: "trigger: other / description: 契機の発生元と実行条件を明記",
    stepExample: ["契機を説明", "入力契約を検証", "業務処理を実行", "結果を返す"],
    notes: ["比較・保守しやすいように、description で契機名と発生条件を補足します。"],
  },
};

export const getActionTriggerLabel = (trigger: string): string =>
  ACTION_TRIGGER_LABELS[trigger] ?? trigger;
export const getActionTriggerIcon = (trigger: string): string =>
  ACTION_TRIGGER_ICONS[trigger] ?? ACTION_TRIGGER_ICONS.other;
export const getActionTriggerCategory = (trigger: string): string =>
  ACTION_TRIGGER_CATEGORIES[trigger] ?? ACTION_TRIGGER_CATEGORIES.other;
export const getActionTriggerRichHelp = (trigger: string): ActionTriggerRichHelp =>
  ACTION_TRIGGER_RICH_HELP[trigger] ?? ACTION_TRIGGER_RICH_HELP.other;

// ── アクションのメタ要約用ヘルパー ─────────────────────────────────────
// #1186 Phase 2-D: constants は processFlowMetadata から
import { STEP_TYPE_LABELS } from "../../../utils/processFlowMetadata";

export function countActionFields(fields: unknown): number {
  if (Array.isArray(fields)) return fields.length;
  if (typeof fields === "string" && fields.trim()) return 1;
  return 0;
}

export function summarizeActionFields(fields: unknown, fallback: string): string {
  if (Array.isArray(fields) && fields.length > 0) {
    return (
      fields
        .slice(0, 3)
        .map((field) => {
          if (typeof field === "string") return field;
          return field?.name ?? field?.id ?? "名称未設定";
        })
        .join("、") + (fields.length > 3 ? ` ほか ${fields.length - 3} 件` : "")
    );
  }
  if (typeof fields === "string" && fields.trim()) return fields.trim().slice(0, 80);
  return fallback;
}

export function summarizeActionStepTypes(action: ActionDefinition): string {
  const counts = new Map<string, number>();
  for (const step of action.steps ?? []) {
    const key = step.kind ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return "ステップ未定義";
  return [...counts.entries()]
    .slice(0, 4)
    .map(([type, count]) => `${STEP_TYPE_LABELS[type] ?? type} ${count}`)
    .join(" / ");
}

export function getActionOpenMarkers(
  action: ActionDefinition,
  actionIndex: number,
  markers: Marker[],
): Marker[] {
  const stepIds = new Set((action.steps ?? []).map((step: { id: string }) => step.id));
  const actionPathById = `actions[${action.id}]`;
  const actionPathByIndex = actionIndex >= 0 ? `actions[${actionIndex}]` : null;
  return markers.filter((marker) => {
    if (marker.resolvedAt) return false;
    if (marker.actionId === action.id) return true;
    const markerStepId = marker.stepId ?? marker.anchor?.stepId;
    if (markerStepId && stepIds.has(markerStepId)) return true;
    const markerPath = marker.path ?? marker.validatorPath ?? marker.anchor?.fieldPath ?? "";
    return (
      typeof markerPath === "string" &&
      (markerPath.includes(actionPathById) ||
        (!!actionPathByIndex && markerPath.includes(actionPathByIndex)))
    );
  });
}

export function summarizeActionMarkers(markers: Marker[]): string {
  if (markers.length === 0) return "なし";
  const counts = new Map<string, number>();
  for (const marker of markers) {
    const kind = marker.kind ?? "marker";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => `${kind} ${count}`).join(" / ");
}
