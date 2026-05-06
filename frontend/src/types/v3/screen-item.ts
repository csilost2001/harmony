/**
 * v3 ScreenItem 型定義 (`schemas/v3/screen-item.v3.schema.json` と 1:1 対応)
 *
 * - id は Identifier (camelCase 強制)
 * - ValueSource は discriminated union (組み込み 4 種 + 拡張)
 * - flowVariable.variableName は IdentifierPath (#533 R3-1) で object field 参照可
 *
 * 参考: schemas/v3/screen-item.v3.schema.json
 */

import type {
  Description,
  DisplayName,
  ExpressionString,
  FieldType,
  Identifier,
  IdentifierPath,
  ProcessFlowId,
  TableColumnRef,
  ViewColumnRef,
} from "./common";
import type { ViewDefinitionId } from "./view-definition";

export type { ViewDefinitionId };

/**
 * 画面項目イベント (#624) — 発火時に handlerFlowId 指定の処理フローを呼び出し、
 * argumentMapping で画面コンテキストを処理フロー inputs[] に変換する。
 * 1 処理フロー × N イベント (再利用) を自然に表現する backward reference。
 */
export interface ScreenItemEvent {
  /** イベント ID (例: `click` / `submit` / `change` / `blur`)。画面項目内ユニーク (validator 担保)。 */
  id: string;
  label?: DisplayName;
  /** 発火時に実行する処理フローの ID (backward reference)。 */
  handlerFlowId: ProcessFlowId;
  /**
   * 画面コンテキストを処理フロー引数 (inputs[]) に変換するマッピング。
   * キーは処理フロー側 inputs[].name (Identifier 形式)、値は画面コンテキスト式
   * (`@screen.* / @self.* / @session.*` 等)。
   */
  argumentMapping?: Record<Identifier, ExpressionString>;
}

/** ScreenItem.options 1 件。 */
export interface ScreenItemOption {
  value: string;
  label: DisplayName;
}

/**
 * output 項目のバインド元。discriminated union (kind)。
 * 組み込み 4 種 + 拡張 (extensions.v3.valueSourceKinds で定義)。
 */
export type ValueSource =
  | {
      kind: "flowVariable";
      /** 省略時はカレント画面に紐付く ProcessFlow を解決する。 */
      processFlowId?: ProcessFlowId;
      /**
       * ProcessFlow 変数名。Identifier 単独 (例: `inventoryRows`) または
       * IdentifierPath (#533 R3-1) で object field 参照可能 (例: `createdOrder.order_number`)。
       */
      variableName: IdentifierPath;
    }
  | { kind: "tableColumn"; ref: TableColumnRef }
  | { kind: "viewColumn"; ref: ViewColumnRef }
  | { kind: "expression"; expression: ExpressionString }
  | {
      /** 拡張 ValueSource。kind は `namespace:identifier` 形式。例: `retail:cartCalculation` */
      kind: string;
      config?: Record<string, unknown>;
      ref?: never;
      expression?: never;
      variableName?: never;
      processFlowId?: never;
    };

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
  /**
   * input = フォーム入力項目 (既定) / output = 表示専用項目 (スカラー) /
   * viewer = ViewDefinition の列定義を参照し、`valueFrom` で flow 変数から配列データを bind する
   * 配列データ表示項目 (#762)。
   */
  direction?: "input" | "output" | "viewer";
  /**
   * viewer 項目が参照する ViewDefinition の ID (#762)。
   * `direction='viewer'` の場合のみ使用し、列定義・ソート・kind 等の viewer 設定を提供する。
   * `valueFrom` で flow 変数から配列データを bind する。
   * `valueFrom` 省略時は ViewDefinition の query を画面 mount 時に自動発行する (静的マスター一覧)。
   * `direction='viewer'` の時のみ required。
   */
  viewDefinitionId?: ViewDefinitionId;
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
  visibleWhen?: ExpressionString;
  /** 活性条件式。 */
  enabledWhen?: ExpressionString;
  /** 表示書式 (output 専用)。例: `YYYY/MM/DD`, `¥#,##0`, `0.00%` */
  displayFormat?: string;
  valueFrom?: ValueSource;
  /** 派生計算式 (= で始まる)。output 項目用。 */
  formula?: ExpressionString;
  /** 本画面項目で発火するイベントと処理フロー連携 (#624)。 */
  events?: ScreenItemEvent[];
  description?: Description;
}
