/**
 * v3 schema 共通型定義 (`schemas/v3/common.v3.schema.json` と 1:1 対応)
 *
 * - 業務識別子 (Uuid / LocalId / Identifier / IdentifierPath / PhysicalName / EnvVarKey / ErrorCode / EventTopic)
 * - branded types で誤代入をコンパイル時検出
 * - FieldType / StructuredField / Authoring / Marker / Note / DecisionRecord / GlossaryEntry / TestScenario
 * - ExtensionRoot / ExtensionApplied
 *
 * 参考: schemas/v3/common.v3.schema.json
 */

// ─── Branded primitives ────────────────────────────────────────────────────

declare const __brand: unique symbol;

/** Branded type: K に T のブランドを付ける (compile-time 型区別)。 */
export type Brand<K, T> = K & { readonly [__brand]: T };

/**
 * Top-level entity の永続識別子。RFC 4122 UUID v4 形式。
 * pattern: `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`
 */
export type Uuid = Brand<string, "Uuid">;

/** 各 entity 種別のブランド付き Uuid。schema レベルでは区別不可、TS でのみ強制。 */
export type ScreenId = Brand<Uuid, "ScreenId">;
export type TableId = Brand<Uuid, "TableId">;
export type ProcessFlowId = Brand<Uuid, "ProcessFlowId">;
export type ViewId = Brand<Uuid, "ViewId">;
export type SequenceId = Brand<Uuid, "SequenceId">;
export type CustomBlockId = Brand<Uuid, "CustomBlockId">;
export type ProjectId = Brand<Uuid, "ProjectId">;
export type ScreenGroupId = Brand<Uuid, "ScreenGroupId">;

/**
 * UuidLoose (deprecated): test/sample 用の擬似 UUID。a-z 含む。本番では Uuid を使う。
 * pattern: `^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$`
 * @deprecated 本番データには Uuid (RFC 4122 v4 strict) を使う
 */
export type UuidLoose = Brand<string, "UuidLoose">;

/**
 * ネスト構造 (Step / Action / Branch / Column / Index / Constraint / Trigger / Note / TestScenario / Decision / Response / Marker 等) の識別子。
 * pattern: `^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$`
 * 例: step-01, step-13b-a-01, col-u01, ADR-001, 201-created, happy-path-order-confirm
 */
export type LocalId = Brand<string, "LocalId">;

/**
 * 業務識別子 (画面項目 ID / API key / ProcessFlow 変数名 / FieldType 拡張 kind 等)。lowerCamelCase 強制。
 * pattern: `^[a-z][a-zA-Z0-9]*$`、maxLength: 64
 */
export type Identifier = Brand<string, "Identifier">;

/**
 * 識別子のドット区切りパス (#533 R3-1)。object 型変数の特定 field を参照する箇所で使用。
 * 各セグメントは camelCase または snake_case (連続/末尾 underscore 禁止)。
 * pattern: `^[a-z][a-zA-Z0-9]*(_[a-zA-Z0-9]+)*(\.[a-z][a-zA-Z0-9]*(_[a-zA-Z0-9]+)*)*$`
 * 例: userId, createdOrder.order_number, response.data.items
 */
export type IdentifierPath = Brand<string, "IdentifierPath">;

/**
 * システム物理名 (DB テーブル名 / カラム名 / シーケンス名 等)。snake_case 強制。
 * pattern: `^[a-z][a-z0-9_]*$`、maxLength: 63
 */
export type PhysicalName = Brand<string, "PhysicalName">;

/** 環境変数キー。UPPER_SNAKE_CASE。pattern: `^[A-Z][A-Z0-9_]*$` */
export type EnvVarKey = Brand<string, "EnvVarKey">;

/** エラーコード。UPPER_SNAKE。pattern: `^[A-Z][A-Z0-9_]*$` */
export type ErrorCode = Brand<string, "ErrorCode">;

/** イベント topic。dot.lowercase + underscore。pattern: `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` */
export type EventTopic = Brand<string, "EventTopic">;

/** ISO 8601 / RFC 3339 UTC タイムスタンプ。Z 終端必須。例: `2026-04-27T00:00:00.000Z` */
export type Timestamp = Brand<string, "Timestamp">;

/** Semantic Versioning 2.0 文字列。例: `1.0.0`, `2.3.4-beta.1` */
export type SemVer = Brand<string, "SemVer">;

/** SemVer 範囲式 (npm 互換)。例: `>=3.0.0`, `~3.1`, `^3.0.0` */
export type SemVerRange = Brand<string, "SemVerRange">;

/** 自由記述説明文 (Markdown 改行可)。 */
export type Description = string;

/** 人間向け表示名 (多言語前提、文字種制限なし)。 */
export type DisplayName = string;

/** 拡張機構 namespace 識別子。pattern: `^[a-z0-9_-]*$` */
export type Namespace = Brand<string, "Namespace">;

/**
 * 式言語 (js-subset) の文字列表現。文法は `docs/spec/process-flow-expression-language.md`。
 * `@conv.* / @secret.* / @env.* / @fn.* / @<var> / Arazzo $ 記法 (Criterion 内のみ)` を許容。
 * datetime 算術は `duration('PnDTnHnMnS')` 形式推奨 (#539 R5-3)。
 */
export type ExpressionString = string;

// ─── 共通 enum ───────────────────────────────────────────────────────────

/** 成熟度 3 値。 */
export type Maturity = "draft" | "provisional" | "committed";

/** ProcessFlow / Project の上流・下流モード。 */
export type Mode = "upstream" | "downstream";

// ─── EntityMeta (全 top-level entity が allOf でマージ) ─────────────────

/**
 * 全 top-level entity (Project / Screen / Table / ProcessFlow / View / Sequence 等) の共通 meta。
 * CustomBlock のような特殊形式 entity は EntityMeta を採用しない (個別型で定義)。
 */
export interface EntityMeta {
  id: Uuid;
  name: DisplayName;
  description?: Description;
  /** entity 単独のリビジョン。 */
  version?: SemVer;
  maturity?: Maturity;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ─── FieldType (discriminated union) ─────────────────────────────────────

/**
 * プリミティブ型。
 * - `json`: 任意の構造化データ (オブジェクトを厳密表現したい場合は kind=object + fields)
 */
export type FieldTypePrimitive =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "json";

/** 配列型。 */
export interface FieldTypeArray {
  kind: "array";
  itemType: FieldType;
}

/** オブジェクト型。fields[] で構造を表現。 */
export interface FieldTypeObject {
  kind: "object";
  fields: StructuredField[];
}

/** テーブル 1 行型。 */
export interface FieldTypeTableRow {
  kind: "tableRow";
  tableId: TableId;
}

/** テーブル配列型。 */
export interface FieldTypeTableList {
  kind: "tableList";
  tableId: TableId;
}

/** 画面入力セット型。 */
export interface FieldTypeScreenInput {
  kind: "screenInput";
  screenId: ScreenId;
}

/** ドメイン参照型。domainsCatalog から型・制約・UI ヒントを継承。 */
export interface FieldTypeDomain {
  kind: "domain";
  /** PascalCase。例: `EmailAddress`, `Quantity` */
  domainKey: string;
}

/** ファイル型 (バッチ I/O 等)。 */
export interface FieldTypeFile {
  kind: "file";
  /** csv / tsv / zip / pdf 等。 */
  format?: string;
}

/** 拡張型。業界別 namespace の fieldType 拡張を参照。 */
export interface FieldTypeExtension {
  kind: "extension";
  /** namespace:fieldTypeKey 形式。例: `retail:productCode`, `finance:accountNumber` */
  extensionRef: string;
}

/** 全領域 (StructuredField / ScreenItem / DomainEntry / TableColumn 派生型) で共有するフィールド型。 */
export type FieldType =
  | FieldTypePrimitive
  | FieldTypeArray
  | FieldTypeObject
  | FieldTypeTableRow
  | FieldTypeTableList
  | FieldTypeScreenInput
  | FieldTypeDomain
  | FieldTypeFile
  | FieldTypeExtension;

// ─── StructuredField ────────────────────────────────────────────────────

/** 構造化フィールド定義。ProcessFlow.inputs/outputs / FieldType.object.fields 等で使用。 */
export interface StructuredField {
  /** Identifier (camelCase) */
  name: Identifier;
  label?: DisplayName;
  type: FieldType;
  required?: boolean;
  description?: Description;
  /** 採番形式 / 正規表現 / 自由ヒント。`@conv.numbering.*` 参照可。 */
  format?: string;
  /** 既定値 (式可)。 */
  defaultValue?: string;
  screenItemRef?: ScreenItemRef;
  /** 派生属性の計算式。`= ` で始まる (例: `= @quantity * @unitPrice`)。 */
  formula?: ExpressionString;
}

// ─── 複合参照型 (Pattern B) ─────────────────────────────────────────────

/** Screen 内の画面項目への複合参照。 */
export interface ScreenItemRef {
  screenId: ScreenId;
  itemId: Identifier;
}

/** Table 内のカラムへの複合参照。 */
export interface TableColumnRef {
  tableId: TableId;
  columnId: LocalId;
}

/** View 内のカラムへの複合参照 (View カラムは LocalId ではなく物理名で識別)。 */
export interface ViewColumnRef {
  viewId: ViewId;
  columnPhysicalName: PhysicalName;
}

/** ProcessFlow 内のアクションへの複合参照。 */
export interface ActionRef {
  processFlowId: ProcessFlowId;
  actionId: LocalId;
}

/** ProcessFlow 内のステップへの複合参照。 */
export interface StepRef {
  processFlowId: ProcessFlowId;
  actionId: LocalId;
  stepId: LocalId;
}

/** Action.responses[] への複合参照。 */
export interface ResponseRef {
  processFlowId: ProcessFlowId;
  actionId: LocalId;
  responseId: LocalId;
}

// ─── Marker / Note / DecisionRecord / GlossaryEntry / Authoring ──────────

/** マーカー shape (SVG path)。anchor 指定時は entity の DOM bbox 相対 % 座標。 */
export interface MarkerShape {
  kind: "path";
  /** SVG path d 属性 (0-100 % 座標) */
  d: string;
  /** 描画色 (`#ef4444` 既定) */
  color?: string;
  strokeWidth?: number;
}

/** Marker の anchor (entity 内の位置)。 */
export interface MarkerAnchor {
  stepId?: LocalId;
  /** JSON path 風 (例: `$.actions[0].steps[2].sql`) */
  fieldPath?: string;
  shape?: MarkerShape;
}

export type MarkerKind = "chat" | "attention" | "todo" | "question" | "validator";

/**
 * 人間↔AI のメッセージマーカー。指示・質問・TODO・チャット・validator 警告。
 * `kind = "validator"` の場合 `validatorCode` / `validatorPath` 必須。
 */
export interface Marker {
  id: Uuid;
  kind: MarkerKind;
  body: string;
  anchor?: MarkerAnchor;
  author: "human" | "ai";
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
  resolution?: string;
  /** kind='validator' 時の警告コード (UNKNOWN_IDENTIFIER 等)。 */
  validatorCode?: string;
  /** kind='validator' 時の対象 JSON path。 */
  validatorPath?: string;
}

/** MADR 形式のアーキテクチャ決定記録。 */
export interface DecisionRecord {
  /** ADR-NNN 形式推奨。 */
  id: LocalId;
  title: DisplayName;
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  /** 決定の背景・問題の説明。 */
  context: string;
  /** 採択した決定内容。 */
  decision: string;
  /** 結果・影響・トレードオフ。 */
  consequences?: string;
  /** ISO date (YYYY-MM-DD)。 */
  date?: string;
}

/** ドメイン用語集の 1 エントリ。キーは用語名 (日本語可)。 */
export interface GlossaryEntry {
  definition: string;
  aliases?: string[];
  /** ドメインモデルやテーブル等への参照文字列 (例: `orders.order_number`)。 */
  domainRef?: string;
}

/** Step / Action / Field レベルの付箋。 */
export interface Note {
  id: LocalId;
  kind: "assumption" | "prerequisite" | "todo" | "deferred" | "question";
  body: string;
  createdAt: Timestamp;
}

/** 設計プロセス用情報 (実行に不要)。各 entity が任意で持つ。 */
export interface Authoring {
  markers?: Marker[];
  decisions?: DecisionRecord[];
  /**
   * ドメイン用語集。キー: 用語名 (日本語を**正本**とし、英語別名は GlossaryEntry.aliases に格納)。
   */
  glossary?: Record<string, GlossaryEntry>;
  notes?: Note[];
  testScenarios?: TestScenario[];
}

// ─── TestScenario (Given-When-Then) ─────────────────────────────────────

/** テスト前提条件 (discriminated union)。 */
export type TestPrecondition =
  | { kind: "dbState"; tableId: TableId; rows: Array<Record<string, unknown>> }
  | { kind: "sessionContext"; context: Record<string, unknown> }
  | { kind: "externalStub"; externalRef: Identifier; responseMock: unknown }
  | { kind: "clock"; now: Timestamp }
  | { kind: "screenInput"; screenId: ScreenId; items: Record<string, unknown> };

/** テスト起動点。 */
export interface TestInvocation {
  /** 省略時は同 ProcessFlow 内の actionId として解決。 */
  processFlowId?: ProcessFlowId;
  actionId: LocalId;
  input: Record<string, unknown>;
}

/** テスト期待結果 (discriminated union)。 */
export type TestAssertion =
  | { kind: "outcome"; expected: LocalId }
  | { kind: "dbRow"; tableId: TableId; match: Record<string, unknown>; count?: number }
  | { kind: "output"; path: string; equals?: unknown; matches?: string }
  | {
      kind: "externalCall";
      externalRef: Identifier;
      method?: string;
      bodyMatch?: Record<string, unknown>;
    }
  | { kind: "auditLog"; action: string; result?: "success" | "failure" }
  | { kind: "errorMessage"; msgKey: string }
  | { kind: "screenItemValue"; screenId: ScreenId; items: Record<string, unknown> };

/**
 * Given-When-Then 形式のテストシナリオ 1 件。
 * schema (common.v3#/$defs/TestScenario) の required: ["id","name","given","when","then"] に従い
 * given も required (空配列許容)。
 */
export interface TestScenario {
  id: LocalId;
  name: DisplayName;
  description?: Description;
  given: TestPrecondition[];
  when: TestInvocation;
  then: TestAssertion[];
  tags?: string[];
}

// ─── Extension root ───────────────────────────────────────────────────────

/**
 * プロジェクトが適用する拡張 namespace の宣言。
 */
export interface ExtensionApplied {
  namespace: Namespace;
  /** 拡張定義のバージョン制約 (例: `>=2.0.0`)。 */
  version?: SemVerRange;
}

/**
 * 拡張定義 root の共通プロパティ (extensions.v3 で allOf マージ)。
 * namespace 単位 1 ファイル = 全種類の拡張集約 (`data/extensions/<ns>.v3.json`)。
 * loader は複数ファイル分割運用も許容 (`data/extensions/<ns>/*.v3.json`)。
 */
export interface ExtensionRoot {
  $schema?: string;
  namespace: Namespace;
  /** 拡張定義のバージョン (SemVer)。互換性追跡のため必須。 */
  version: SemVer;
  /** 互換 core schema のバージョン範囲式。例: `>=3.0.0`, `~3.1` */
  requiresCoreSchema?: SemVerRange;
  /** true で本拡張全体を廃止予定とマーク。 */
  deprecated?: boolean;
  description?: Description;
}
