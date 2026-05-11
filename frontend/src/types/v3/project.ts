/**
 * v3 Project 型定義 (`schemas/v3/harmony.v3.schema.json` と 1:1 対応)
 *
 * 参考: schemas/v3/harmony.v3.schema.json
 */

import type {
  Authoring,
  DisplayName,
  EntityMeta,
  ExtensionApplied,
  LocalId,
  Maturity,
  Mode,
  PhysicalName,
  ProcessFlowId,
  ProjectId,
  ScreenGroupId,
  ScreenId,
  SequenceId,
  TableId,
  Timestamp,
  Uuid,
  ViewId,
} from "./common";
import type { ViewDefinitionId } from "./view-definition";

/** entities.* 配列要素の共通プロパティ。一覧 UI 表示用最小メタ。 */
export interface EntryBase {
  id: Uuid;
  /** 物理順 (1..N)。一覧の並び替え永続化に使用。 */
  no: number;
  name: DisplayName;
  updatedAt: Timestamp;
  maturity?: Maturity;
}

export interface ScreenEntry extends EntryBase {
  id: ScreenId;
  /** ScreenKind 文字列 (login/dashboard/list/detail/form 等)。 */
  kind?: string;
  path?: string;
  groupId?: ScreenGroupId;
  hasDesign?: boolean;
}

export interface TableEntry extends EntryBase {
  id: TableId;
  physicalName?: PhysicalName;
  category?: string;
  columnCount?: number;
}

export interface ProcessFlowEntry extends EntryBase {
  id: ProcessFlowId;
  /** ProcessFlowKind (screen/batch/scheduled/system/common/other 等)。 */
  kind?: string;
  /** screen kind の場合の関連画面 ID。 */
  screenId?: ScreenId;
  actionCount?: number;
  notesCount?: number;
}

export interface ViewEntry extends EntryBase {
  id: ViewId;
  physicalName?: PhysicalName;
}

/** ViewDefinition (画面 一覧 UI viewer) entry。schemas/v3/view-definition.v3.schema.json と対応。 */
export interface ViewDefinitionEntry extends EntryBase {
  id: ViewDefinitionId;
  /** ViewDefinitionKind (list / detail / kanban / calendar、または `retail:storefront` 等の拡張参照)。 */
  kind?: string;
  /** ベースとなる source table の Uuid (一覧 UI 表示用)。 */
  sourceTableId?: TableId;
  columnCount?: number;
}

export interface SequenceEntry extends EntryBase {
  id: SequenceId;
  physicalName?: PhysicalName;
  /** `@conv.numbering.<key>` 形式の参照。 */
  conventionRef?: string;
}

export interface ScreenGroupEntry {
  id: ScreenGroupId;
  name: DisplayName;
  /** UI 表示色 (`#RRGGBB`)。 */
  color?: string;
}

/** 画面間の遷移定義。UI 座標は screen-flow-positions に分離。 */
export interface ScreenTransitionEntry {
  id: LocalId;
  sourceScreenId: ScreenId;
  targetScreenId: ScreenId;
  label?: DisplayName;
  trigger: "click" | "submit" | "select" | "cancel" | "auto" | "back" | "other";
  /**
   * 遷移種別 (#744)。
   * - `"navigation"` (default) — 純 UI 遷移、ScreenTransitionStep 不要。
   * - `"flow-driven"` — 処理を伴う遷移、対応する ScreenTransitionStep が必要。
   */
  kind?: "navigation" | "flow-driven";
}

/** プロジェクトが保持する各 entity への参照一覧。 */
export interface ProjectEntities {
  screens?: ScreenEntry[];
  tables?: TableEntry[];
  processFlows?: ProcessFlowEntry[];
  views?: ViewEntry[];
  viewDefinitions?: ViewDefinitionEntry[];
  sequences?: SequenceEntry[];
  screenGroups?: ScreenGroupEntry[];
  screenTransitions?: ScreenTransitionEntry[];
}

/** プロジェクト identity と運用設定。 */
export interface ProjectMeta extends EntityMeta {
  id: ProjectId;
  /** プロジェクト全体の上流/下流モード。 */
  mode?: Mode;
}

/**
 * CSS フレームワーク選択 (#793)。
 * 画面作成時に固定し、途中切替は非サポート。
 * - `"bootstrap"` — Bootstrap 5 を canvas iframe に読み込み (既存サンプル既定)。
 * - `"tailwind"` — Tailwind ベースの theme CSS を canvas iframe に読み込み (semantic class を @apply で utility にマップ)。
 *
 * 詳細仕様: docs/spec/css-framework-switching.md
 */
export type CssFramework = "bootstrap" | "tailwind";

/** デザイナー動作設定 (techStack.designer サブオブジェクト)。 */
export interface TechStackDesigner {
  /** プロジェクト全画面の default エディタ種別。画面側 (screen.design.editorKind) で override 可能。省略時は 'grapesjs' 相当。 */
  editorKind?: "grapesjs" | "puck";
  /** プロジェクト全画面の default CSS フレームワーク。画面側 (screen.design.cssFramework) で override 可能。省略時は 'bootstrap' 相当。 */
  cssFramework?: CssFramework;
}

/** バックエンド技術スタック (techStack.backend サブオブジェクト)。 */
export interface TechStackBackend {
  /** バックエンド実装言語。 */
  language?: "java" | "typescript" | "python" | "go" | "kotlin";
  /** バックエンドフレームワーク。language との組合せ制約あり (techStackConstraints.ts 参照)。 */
  framework?: "spring-boot" | "nestjs" | "express" | "fastapi" | "gin";
}

/** データベース技術スタック (techStack.database サブオブジェクト)。 */
export interface TechStackDatabase {
  /** データベース種別。 */
  type?: "postgresql" | "mysql" | "sqlite" | "oracle" | "sqlserver";
  /** データベースバージョン文字列 (例: '16', '8.0')。省略可。 */
  version?: string;
}

/** フロントエンド技術スタック (techStack.frontend サブオブジェクト)。 */
export interface TechStackFrontend {
  /** フロントエンドライブラリ / テンプレートエンジン。 */
  library?: "react" | "vue" | "thymeleaf" | "blade" | "none";
  /** フロントエンドフレームワーク。library との組合せ制約あり (techStackConstraints.ts 参照)。省略可。 */
  framework?: "next" | "nuxt" | "vite" | "none";
}

/** 認証方式 (techStack.auth サブオブジェクト)。 */
export interface TechStackAuth {
  /** 認証方式。 */
  method?: "jwt" | "session" | "oauth2" | "saml" | "none";
}

/** デプロイターゲット (techStack.deployment サブオブジェクト)。 */
export interface TechStackDeployment {
  /** デプロイターゲット環境。 */
  target?: "docker" | "vm" | "lambda" | "cloud-run" | "kubernetes";
}

/**
 * プロジェクトの技術スタック定義 (#826)。
 * AI コード生成時のターゲット環境とデザイナー動作設定を統合する。
 */
export interface ProjectTechStack {
  /** デザイナー動作設定。editorKind / cssFramework のプロジェクト default を保持。 */
  designer?: TechStackDesigner;
  /** バックエンド技術スタック。 */
  backend?: TechStackBackend;
  /** データベース技術スタック。 */
  database?: TechStackDatabase;
  /** フロントエンド技術スタック。 */
  frontend?: TechStackFrontend;
  /** 認証方式。 */
  auth?: TechStackAuth;
  /** デプロイターゲット。 */
  deployment?: TechStackDeployment;
}

/** 業務システム 1 案件の root 定義。ワークスペースルートの `harmony.json` に対応。 */
export interface Project {
  $schema?: string;
  /** 本プロジェクトが使う schema バージョン。 */
  schemaVersion: "v3";
  /**
   * 設計データ格納サブディレクトリ (ワークスペースルートからの相対パス)。
   * 推奨慣習は `"harmony"`。
   * 絶対パス・path traversal (`..` セグメント)・空文字・`"."` 単独は禁止。
   */
  dataDir: string;
  meta: ProjectMeta;
  /**
   * 本プロジェクトが適用する拡張 namespace 一覧 (version 制約付き)。
   * 例: `[{ namespace: 'retail', version: '>=2.0.0' }]`
   */
  extensionsApplied?: ExtensionApplied[];
  entities?: ProjectEntities;
  /** プロジェクト全体の authoring 情報 (entity 横断で共有される ADR や用語集)。 */
  authoring?: Authoring;
  /** プロジェクトの技術スタック定義 (AI コード生成ターゲット + デザイナー動作設定)。 */
  techStack?: ProjectTechStack;
}
