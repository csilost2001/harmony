/**
 * v3 Extensions 型定義 (`schemas/v3/extensions.v3.schema.json` と 1:1 対応)
 *
 * - 1 namespace = 1 ファイルで全種類の拡張を集約 (loader は複数ファイル分割も許容)
 * - 12 種の拡張タイプ
 *
 * 参考: schemas/v3/extensions.v3.schema.json
 */

import type {
  Description,
  DisplayName,
  ExtensionRoot,
  FieldType,
  Identifier,
  LocalId,
} from "./common";

/** 動的フォーム生成用 JSON Schema subset。 */
export interface DynamicFormSchema {
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "object"
    | "array"
    | ("string" | "number" | "integer" | "boolean" | "object" | "array")[];
  enum?: unknown[];
  properties?: Record<string, DynamicFormSchema>;
  items?: DynamicFormSchema;
  required?: string[];
  description?: string;
  default?: unknown;
  additionalProperties?: boolean;
}

/** 拡張 fieldType。FieldType.kind='extension' で参照される。 */
export interface CustomFieldType {
  /** 拡張 fieldType の識別子 (camelCase)。 */
  kind: Identifier;
  label: DisplayName;
  /** 底になるプリミティブ型 (実装の型 mapping ヒント)。 */
  baseType?: "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "json";
  /** 拡張 fieldType に紐付く既定制約 (validation 等)。 */
  constraints?: Record<string, unknown>[];
  description?: Description;
}

/** 拡張 DataType (DB)。namespace:UPPER 形式で参照される。 */
export interface CustomDataType {
  /** UPPER_SNAKE。例: `VARCHAR2`, `JSONB` */
  physicalKind: string;
  label: DisplayName;
  lengthRequired?: boolean;
  scaleSupported?: boolean;
  description?: Description;
}

/** 拡張 ScreenKind。Screen.kind の `<ns>:<kind>` で参照される。 */
export interface CustomScreenKind {
  /** camelCase。 */
  kind: Identifier;
  label: DisplayName;
  /** Bootstrap Icons クラス名 (例: `bi-shop`)。 */
  icon?: string;
  description?: Description;
}

/** 拡張 ProcessFlowKind。 */
export interface CustomProcessFlowKind {
  kind: Identifier;
  label: DisplayName;
  icon?: string;
  description?: Description;
}

/** Action.trigger の拡張。 */
export interface CustomActionTrigger {
  value: Identifier;
  label: DisplayName;
  description?: Description;
}

/** DbAccessStep.operation の拡張。 */
export interface CustomDbOperation {
  /** UPPER_SNAKE。例: `UPSERT`, `TRUNCATE` */
  value: string;
  label: DisplayName;
  description?: Description;
}

/**
 * 拡張 Step 種別。process-flow.v3 ExtensionStep に namespace:StepName で参照される。
 * schema フィールドで動的フォーム生成 (subset JSON Schema)、ExtensionStep.config の構造を縛る。
 */
export interface CustomStepKind {
  label: DisplayName;
  /** アイコン (Bootstrap Icons / Lucide 名)。 */
  icon: string;
  description: Description;
  /** ExtensionStep.config の構造を縛る subset schema。 */
  schema: DynamicFormSchema;
  /** 拡張 step の outputBinding 結果型 (型推論用)。 */
  outputType?: FieldType;
}

/** Response 型の拡張。HttpResponseSpec.bodySchema={typeRef} で参照。 */
export interface CustomResponseType {
  description?: Description;
  /** JSON Schema draft 2020-12 (response body 構造)。 */
  schema: Record<string, unknown>;
}

/**
 * 拡張 ValueSource。ScreenItem.valueFrom の `namespace:kindName` で参照される。
 * schema は ValueSource.config の構造を縛る。
 */
export interface CustomValueSourceKind {
  kind: Identifier;
  label: DisplayName;
  schema: DynamicFormSchema;
  description?: Description;
}

/** Table.columns 用カラム雛形 (一括追加用)。 */
export interface CustomColumnTemplate {
  id: LocalId;
  label: DisplayName;
  icon?: string;
  category: string;
  /** カラム雛形 (Column の id/no を除いたサブセット)。 */
  column: Record<string, unknown>;
  description?: Description;
}

/** Table.constraints の典型パターン雛形。 */
export interface CustomConstraintPattern {
  id: LocalId;
  label: DisplayName;
  kind: "unique" | "check" | "foreignKey";
  description?: Description;
  /** 制約雛形 (Constraint の subset)。 */
  template?: Record<string, unknown>;
}

/** Conventions の業界拡張カテゴリ。 */
export interface CustomConventionCategory {
  /** `@conv.<categoryName>.<key>` の categoryName (camelCase)。 */
  categoryName: Identifier;
  label: DisplayName;
  description?: Description;
  /** 本カテゴリの 1 entry の動的フォーム schema。 */
  entrySchema: DynamicFormSchema;
}

/**
 * 統合拡張定義。1 namespace = 1 ファイルで全種類の拡張を集約。
 * `data/extensions/<namespace>.v3.json` に対応。
 * core schema は本拡張を loader で動的にマージして合成 schema を作る。
 */
export interface ExtensionDefinition extends ExtensionRoot {
  fieldTypes?: CustomFieldType[];
  dataTypes?: CustomDataType[];
  screenKinds?: CustomScreenKind[];
  processFlowKinds?: CustomProcessFlowKind[];
  actionTriggers?: CustomActionTrigger[];
  dbOperations?: CustomDbOperation[];
  /** Step.kind の拡張定義。キー = StepName (PascalCase)。 */
  stepKinds?: Record<string, CustomStepKind>;
  /** Response 型の拡張。キー = TypeName (PascalCase)。 */
  responseTypes?: Record<string, CustomResponseType>;
  valueSourceKinds?: CustomValueSourceKind[];
  columnTemplates?: CustomColumnTemplate[];
  constraintPatterns?: CustomConstraintPattern[];
  conventionCategories?: CustomConventionCategory[];
}
