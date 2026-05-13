/**
 * Generic Definition Catalog 型定義 (v3 schema 準拠)
 *
 * schema: schemas/v3/generic-definition.v3.schema.json
 * 8 kind: data-contract / domain-type / exception-type / application-rule /
 *         ui-behavior / runtime-policy / component-definition / ui-fragment
 */

export type GenericDefinitionKind =
  | "data-contract"
  | "domain-type"
  | "exception-type"
  | "application-rule"
  | "ui-behavior"
  | "runtime-policy"
  | "component-definition"
  | "ui-fragment";

export type GenericDefinitionTarget = "backend" | "frontend" | "shared" | "runtime";

export type GenericRelationKind =
  | "extends"
  | "implements"
  | "uses"
  | "transformsFrom"
  | "transformsTo"
  | "appliesTo";

export interface GenericField {
  name: string;
  type: string;
  constraints?: string[];
  description?: string;
}

export interface GenericOperation {
  name: string;
  inputs?: GenericField[];
  outputs?: GenericField[];
  description?: string;
}

export interface GenericRelation {
  kind: GenericRelationKind;
  ref: string;
  description?: string;
}

export interface GenericDefinition {
  $schema?: string;
  kind: GenericDefinitionKind;
  name: string;
  purpose: string;
  responsibilities: string[];
  targets: GenericDefinitionTarget[];
  fields?: GenericField[];
  operations?: GenericOperation[];
  relations?: GenericRelation[];
  constraints?: string[];
  mappingHints?: Record<string, unknown>;
}

export interface DataContractDefinition extends GenericDefinition {
  kind: "data-contract";
}

export interface ExceptionTypeDefinition extends GenericDefinition {
  kind: "exception-type";
}

export const GENERIC_DEFINITION_KINDS: GenericDefinitionKind[] = [
  "data-contract",
  "domain-type",
  "exception-type",
  "application-rule",
  "ui-behavior",
  "runtime-policy",
  "component-definition",
  "ui-fragment",
];

export const GENERIC_DEFINITION_KIND_LABELS: Record<GenericDefinitionKind, string> = {
  "data-contract": "データ契約",
  "domain-type": "ドメイン型",
  "exception-type": "例外型",
  "application-rule": "アプリケーションルール",
  "ui-behavior": "UI ビヘイビア",
  "runtime-policy": "ランタイムポリシー",
  "component-definition": "コンポーネント定義",
  "ui-fragment": "UI フラグメント",
};

export const GENERIC_DEFINITION_TARGETS: GenericDefinitionTarget[] = [
  "backend",
  "frontend",
  "shared",
  "runtime",
];

export const GENERIC_DEFINITION_TARGET_LABELS: Record<GenericDefinitionTarget, string> = {
  backend: "バックエンド",
  frontend: "フロントエンド",
  shared: "共有",
  runtime: "ランタイム",
};

export const GENERIC_DEFINITION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface GenericDefinitionSummary {
  kind: GenericDefinitionKind;
  name: string;
  purpose: string;
  targets: GenericDefinitionTarget[];
  fieldCount: number;
}
