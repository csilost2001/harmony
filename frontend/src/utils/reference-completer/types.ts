/**
 * reference-completer 基盤型定義 (Phase 1 / #1255)
 *
 * ProcessFlow エディタ / ScreenItemsView 等の入力フィールドで
 * @conv.* / @stepResult.* / @inputs.* / screenId / tableId 等の各種 reference を
 * 補完する統合 API の型定義。
 */

import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import type { LoadedExtensions } from "../../schemas/loadExtensions";
import type { ProcessFlow } from "../../types/v3";

/** 補完候補 1 件。 */
export interface Candidate {
  /** 補完で入力される文字列。 */
  value: string;
  /** 表示テキスト（省略時 value）。 */
  label?: string;
  /** サブテキスト (title / maturity 等)。 */
  hint?: string;
  /** 確定時の suffix (例: category → ".")。 */
  trailing?: string;
}

/** 補完状態。 */
export type CompletionState =
  | { phase: "idle" }
  | {
      phase: "active";
      /** どの Resolver が生成したかの識別子。 */
      resolverId: string;
      /** 入力済み prefix (置換対象)。 */
      prefix: string;
      /** 補完候補一覧。 */
      candidates: Candidate[];
      /** 置換する文字数 (通常 prefix.length)。 */
      replaceLen: number;
    };

/** workspace 全体の参照情報。useWorkspaceReferences の返却型。 */
export interface WorkspaceRefs {
  screens: { id: string; name: string; maturity?: string }[];
  tables: { id: string; physicalName: string; name: string; maturity?: string }[];
  viewDefinitions: { id: string; name: string; maturity?: string }[];
  processFlows: {
    id: string;
    name: string;
    kind: string;
    maturity?: string;
    actions?: { id: string; name?: string }[];
  }[];
  fragments: { name: string }[];
  components: { name: string }[];
  exceptionTypes: { name: string }[];
  modelEndpoints: { id: string; name?: string }[];
  secrets: { id: string; name?: string }[];
  events: { topic: string; description?: string }[];
}

/** 補完計算に必要なコンテキスト情報。 */
export interface CompletionContext {
  /** フィールド種別 (field-level resolver の起動判定用)。 */
  fieldKind?: string;
  /** 規約カタログ (@conv.* resolver 用)。 */
  conventions?: ConventionsCatalog | null;
  /** ワークスペース全参照情報 (cross-resource ID resolver 用)。 */
  workspace?: WorkspaceRefs;
  /** 現在編集中の ProcessFlow (scoped expression resolver 用)。 */
  flow?: ProcessFlow;
  /** 拡張定義 (extensionRef resolver 用)。 */
  extensions?: LoadedExtensions;
  /** handlerActionId resolver: 対象 flow の id。 */
  handlerFlowId?: string;
}

/** 補完 Resolver インターフェース。 */
export interface Resolver {
  /** 識別子。 */
  id: string;
  /**
   * 入力値・カーソル位置・コンテキストから補完状態を計算する。
   * 補完対象外なら null または { phase: "idle" } を返す。
   */
  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null;
}
