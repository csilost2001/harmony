/**
 * v3 ScreenItem 型定義 (`schemas/v3/screen-item.v3.schema.json` と 1:1 対応)
 *
 * - id は Identifier (camelCase 強制)
 * - direction はデータ方向 (in / out / both)
 * - binding は Form / DTO / JSON / DB / flow への紐付け
 * - presentation は table/list 等の表示形態
 *
 * 参考: schemas/v3/screen-item.v3.schema.json
 */

import type {
  Description,
  DisplayName,
  TemplateString,
  FieldType,
  Identifier,
  LocalId,
  ProcessFlowId,
  TableColumnRef,
  ViewColumnRef,
} from "./common";
import type { ViewDefinitionId } from "./view-definition";

export type { ViewDefinitionId };

/**
 * ScreenItemEvent の UI ローカル効果 (#1065 / spec generic-definition-layer.md §3.2)。
 * kind 別の discriminated union。`handlerFlowId` は処理起動、`effects[]` は純粋な
 * UI ローカル効果。両者は概念分離し並存する。
 *
 * 参考: schemas/v3/screen-item.v3.schema.json#/$defs/ScreenItemEventEffect
 */
export type ScreenItemEventEffect =
  | { kind: "clear"; target: Identifier }
  | { kind: "setReadonly" | "setEnabled" | "setVisible"; target: Identifier; value: boolean | TemplateString }
  | { kind: "setOptions"; target: Identifier; value: string }
  | { kind: "showDialog"; target: string; value?: string }
  | { kind: "setMessage"; target: string; value?: string }
  | { kind: "refreshList"; target: Identifier }
  | { kind: "applyAjaxResult"; mapping: Record<string, Identifier> };

/**
 * 画面項目イベント (#624 / #1019) — 発火時に handlerFlowId + handlerActionId 指定の
 * 処理フロー内 action を呼び出し、argumentMapping で画面コンテキストを当該 action の
 * inputs[] に変換する。1 画面 = 1 処理フロー + 複数アクション モデルを成立させるため、
 * handlerActionId で sub-action を指定する (省略時は actions[0]、validator が単一 action 制約担保)。
 */
export interface ScreenItemEvent {
  /** イベント ID (例: `click` / `submit` / `change` / `blur`)。画面項目内ユニーク (validator 担保)。 */
  id: string;
  label?: DisplayName;
  /** 発火時に実行する処理フローの ID (backward reference)。 */
  handlerFlowId: ProcessFlowId;
  /**
   * 発火時に実行する処理フロー内 action の ID (#1019、ProcessFlow.actions[].id を参照)。
   * 省略時は処理フローが actions 配列を 1 件のみ持つ前提で actions[0] を実行する
   * (validator が単一 action 制約を担保)。複数 action を持つ処理フローでは必須。
   */
  handlerActionId?: LocalId;
  /**
   * 画面コンテキストを処理フロー引数 (handlerActionId が指す action の inputs[]) に
   * 変換するマッピング。キーは action 側 inputs[].name (Identifier 形式)、
   * 値は画面コンテキスト式 (`@screen.* / @self.* / @session.*` 等)。
   */
  argumentMapping?: Record<Identifier, TemplateString>;
  /**
   * イベント発火時に適用する UI ローカル効果リスト (#1065)。
   * `handlerFlowId` による処理起動とは概念分離。両者は並存する。
   * 参考: schemas/v3/screen-item.v3.schema.json#/$defs/ScreenItemEventEffect
   */
  effects?: ScreenItemEventEffect[];
}

/** ScreenItem.options 1 件。 */
export interface ScreenItemOption {
  value: string;
  label: DisplayName;
}

export type ScreenItemDirection = "in" | "out" | "both";

export type ScreenItemBindingKind =
  | "form"
  | "dto"
  | "json"
  | "tableColumn"
  | "viewColumn"
  | "flowVariable"
  | "catalog"
  | "expression"
  | "fragmentParam"
  | "session"
  | "routeParam"
  | "queryParam";

export interface ScreenItemBinding {
  /** bind 先の分類。 */
  kind: ScreenItemBindingKind;
  /** bind 対象 path。例: orderForm.productCode / response.rows / customer.name。 */
  path?: string;
  /** tableColumn / viewColumn の構造化参照。 */
  ref?: TableColumnRef | ViewColumnRef;
  /** flowVariable の参照先 ProcessFlow。省略時はカレント画面に紐付く flow を解決する。 */
  processFlowId?: ProcessFlowId;
  /** 表示整形 hint。 */
  formatHint?: string;
  /** 元文書上の出典メモ。 */
  sourceNote?: string;
}

export type ScreenItemPresentationKind = "field" | "table" | "list" | "kanban" | "calendar";

export interface ScreenItemPresentationColumn {
  id: Identifier;
  label: DisplayName;
  /** 1 row 内の accessor path。React Table / TanStack Table の accessorKey 相当。 */
  path: string;
  type: FieldType;
  format?: string;
  width?: string | number;
}

export interface ScreenItemPresentation {
  kind: ScreenItemPresentationKind;
  /** 一覧・表・カレンダー等の表示設定。 */
  viewDefinitionId?: ViewDefinitionId;
  /** インライン列定義。binding.path が rows 配列、columns[].path が row 内 accessor。 */
  columns?: ScreenItemPresentationColumn[];
}

/**
 * ScreenItem (画面項目) 1 件。
 * 識別子 (Identifier) は画面内で一意、AI 実装で API key / 変数名としてそのまま使用可能。
 */
export interface ScreenItem {
  /** 画面項目識別子 (camelCase 強制、JS 識別子に直接使用可)。 */
  id: Identifier;
  label: DisplayName;
  type: FieldType;
  /**
   * 画面横断の論理同一性キー (任意、#651)。
   * `conventions.fieldKeys[<refKey>]` に宣言された値を参照する。
   * 同じ refKey を持つ ScreenItem は論理的に同一フィールド (例: customerId, orderNumber)。
   * validator (screenItemRefKeyValidator) が未宣言検出 + 画面横断整合 (type / pattern / range / length / handlerFlow) を担保。
   * id (画面内ユニーク) と独立。
   */
  refKey?: Identifier;
  /** データ方向。in = 画面→外部 / out = 外部→画面 / both = 双方向。 */
  direction?: ScreenItemDirection;
  required?: boolean;
  readonly?: boolean;
  disabled?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  /** `@conv.limit.<key>` 参照 (minLength の代替)。loader 段階で integer 値に展開される。 */
  minLengthRef?: string;
  /** `@conv.limit.<key>` 参照 (maxLength の代替)。loader 段階で integer 値に展開される。 */
  maxLengthRef?: string;
  /** `@conv.limit.<key>` 参照 (min の代替)。loader 段階で number 値に展開される。 */
  minRef?: string;
  /** `@conv.limit.<key>` 参照 (max の代替)。loader 段階で number 値に展開される。 */
  maxRef?: string;
  step?: number;
  /** 正規表現または `@conv.regex.<key>` 参照。 */
  pattern?: string;
  /** 選択肢 (select / radio / checkbox 用)。静的マスタ。 */
  options?: ScreenItemOption[];
  /** 既定値 (式可は formula 参照)。 */
  defaultValue?: string | number | boolean | null;
  placeholder?: string;
  helperText?: string;
  /** バリデーション NG 時のメッセージ。`@conv.msg.<key>` 参照推奨。 */
  errorMessages?: Record<string, string>;
  /** 表示条件式。 */
  visibleWhen?: TemplateString;
  /** 活性条件式。 */
  enabledWhen?: TemplateString;
  /** 表示書式 (out/both 項目向け)。例: `YYYY/MM/DD`, `¥#,##0`, `0.00%` */
  displayFormat?: string;
  /** Form / DTO / JSON / DB / flow 等への bind 情報。 */
  binding?: ScreenItemBinding;
  /** table/list 等の表示形態。 */
  presentation?: ScreenItemPresentation;
  /** 派生計算式 (= で始まる)。out/both 項目用。 */
  formula?: TemplateString;
  /** 本画面項目で発火するイベントと処理フロー連携 (#624)。 */
  events?: ScreenItemEvent[];
  description?: Description;
}
