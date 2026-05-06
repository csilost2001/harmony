// @ts-nocheck
/**
 * specExporter.ts (v3, #556)
 * AI エージェント向け統合 JSON 仕様書の生成。
 *
 * v3 schema 整合:
 * - Table: physicalName / name (display) を使用
 * - Column: physicalName / name (display) を使用
 * - FK は Constraint.foreignKey から導出 (Column.foreignKey は廃止)
 * - referencedTableId (Uuid) は allTables から physicalName へ逆引き
 * - Index は IndexColumn.columnId → physicalName 解決
 *
 * 出力 JSON の SpecXXX 型は下流 (PG 工程 AI) との contract のためフィールド名は維持。
 * 値の意味は v3 source から正しくマッピングする (e.g. SpecColumn.name = Column.physicalName)。
 */
import type {
  Table,
  Constraint,
  ForeignKeyConstraint,
  DefaultDefinition,
  TriggerDefinition,
} from "../types/v3";
import type { ErLayout } from "../types/v3";
import type { FlowProject } from "../types/flow";
import type { ProcessFlow, Step } from "../types/action";
import { getAllRelations, type ErRelation } from "./erUtils";
import { getStepLabel } from "./actionUtils";
import { fieldsToText } from "./actionFields";

export interface SpecJson {
  /** プロジェクト名 */
  projectName: string;
  /** 生成日時 */
  generatedAt: string;
  /** テーブル定義 */
  tables: SpecTable[];
  /** リレーション一覧（物理 FK + 論理 FK） */
  relations: SpecRelation[];
  /** 画面一覧（フロー図の情報） */
  screens: SpecScreen[];
  /** 画面遷移 */
  transitions: SpecTransition[];
  /** 処理フロー定義 */
  processFlows?: SpecProcessFlow[];
  /** 共通処理定義 */
  commonProcesses?: SpecCommonProcess[];
}

export interface SpecTable {
  /** DB 物理名 (snake_case)。v3 Table.physicalName に対応。 */
  name: string;
  /** 表示名。v3 Table.name (DisplayName) に対応。 */
  logicalName: string;
  description: string;
  category?: string;
  columns: SpecColumn[];
  indexes: SpecIndex[];
  constraints?: Constraint[];
  defaults?: DefaultDefinition[];
  triggers?: TriggerDefinition[];
}

export interface SpecColumn {
  /** カラム物理名 (snake_case)。v3 Column.physicalName。 */
  name: string;
  /** カラム表示名。v3 Column.name (DisplayName)。 */
  logicalName: string;
  dataType: string;
  length?: number;
  scale?: number;
  notNull: boolean;
  primaryKey: boolean;
  unique: boolean;
  autoIncrement?: boolean;
  defaultValue?: string;
  comment?: string;
  /** FK 参照情報 (物理 / 論理どちらも含む) */
  reference?: {
    /** 参照先テーブル物理名 */
    table: string;
    /** 参照先カラム物理名 */
    column: string;
    /** "physical" = DDL に FOREIGN KEY 出力, "logical" = アプリ層で制御 */
    type: "physical" | "logical";
    memo?: string;
  };
}

export interface SpecIndex {
  /** インデックス物理名 */
  name: string;
  /** カラム物理名の配列 */
  columns: string[];
  unique: boolean;
}

export interface SpecRelation {
  /** "orders.customer_id → customers.id" 形式の出力用、from は ".table" or "table.column" */
  from: string;
  to: string;
  cardinality: string;
  /** "physical" = DB 制約あり, "logical" = アプリ層で制御, "conceptual" = カラム未定 */
  constraintType: "physical" | "logical" | "conceptual";
  memo?: string;
}

export interface SpecScreen {
  name: string;
  type: string;
  path: string;
  description: string;
  hasDesign: boolean;
}

export interface SpecTransition {
  from: string;
  to: string;
  label: string;
  trigger: string;
}

export interface SpecProcessFlow {
  name: string;
  type: string;
  screenName?: string;
  description: string;
  actions: SpecAction[];
}

export interface SpecAction {
  name: string;
  trigger: string;
  inputs?: string;
  outputs?: string;
  steps: SpecStep[];
}

export interface SpecStep {
  number: string;
  type: string;
  description: string;
  detail: Record<string, unknown>;
}

export interface SpecCommonProcess {
  id: string;
  name: string;
  description: string;
  steps: SpecStep[];
}

/** 統合 JSON 仕様書を生成 */
export function generateSpecJson(
  project: FlowProject,
  tables: Table[],
  erLayout: ErLayout | null,
  processFlows?: ProcessFlow[],
): SpecJson {
  const relations = getAllRelations(tables, erLayout);

  const commonGroups = (processFlows ?? []).filter((g) => g.type === "common");
  const nonCommonGroups = (processFlows ?? []).filter((g) => g.type !== "common");

  const result: SpecJson = {
    projectName: project.name,
    generatedAt: new Date().toISOString(),
    tables: tables.map((t) => toSpecTable(t, tables)),
    relations: relations.map((r) => toSpecRelation(r)),
    screens: project.screens.map((s) => ({
      name: s.name,
      type: s.kind,
      path: s.path,
      description: s.description,
      hasDesign: s.hasDesign,
    })),
    transitions: project.edges.map((e) => {
      const src = project.screens.find((s) => s.id === e.source);
      const tgt = project.screens.find((s) => s.id === e.target);
      return {
        from: src?.name ?? e.source,
        to: tgt?.name ?? e.target,
        label: e.label,
        trigger: e.trigger,
      };
    }),
  };

  if (processFlows && processFlows.length > 0) {
    result.processFlows = nonCommonGroups.map((g) => {
      const screenName = g.screenId
        ? project.screens.find((s) => s.id === g.screenId)?.name
        : undefined;
      return {
        name: g.name,
        type: g.type,
        screenName,
        description: g.description,
        actions: g.actions.map((a) => ({
          name: a.name,
          trigger: a.trigger,
          inputs: fieldsToText(a.inputs) || undefined,
          outputs: fieldsToText(a.outputs) || undefined,
          steps: a.steps.map((s, i) => toSpecStep(s, i)),
        })),
      };
    });

    if (commonGroups.length > 0) {
      result.commonProcesses = commonGroups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        steps: g.actions.length > 0
          ? g.actions[0].steps.map((s, i) => toSpecStep(s, i))
          : [],
      }));
    }
  }

  return result;
}

function resolveColumnPhysical(table: Table, columnId: string): string {
  return table.columns.find((c) => c.id === columnId)?.physicalName ?? columnId;
}

function findFkForColumn(table: Table, columnId: string): ForeignKeyConstraint | undefined {
  return (table.constraints ?? []).find(
    (c) => c.kind === "foreignKey" && (c.columnIds as readonly string[]).includes(columnId),
  ) as ForeignKeyConstraint | undefined;
}

function toSpecTable(t: Table, allTables: Table[]): SpecTable {
  const tableIdMap = new Map(allTables.map((tbl) => [tbl.id, tbl]));
  return {
    name: t.physicalName,
    logicalName: t.name,
    description: t.description ?? "",
    category: t.category,
    columns: t.columns.map((c) => {
      const col: SpecColumn = {
        name: c.physicalName,
        logicalName: c.name,
        dataType: c.dataType,
        length: c.length,
        scale: c.scale,
        notNull: c.notNull ?? false,
        primaryKey: c.primaryKey ?? false,
        unique: c.unique ?? false,
        autoIncrement: c.autoIncrement || undefined,
        defaultValue: c.defaultValue,
        comment: c.comment,
      };
      // FK は Constraint.foreignKey から探索 (Column.foreignKey は v3 で廃止)
      const fk = findFkForColumn(t, c.id);
      if (fk) {
        const refTable = tableIdMap.get(fk.referencedTableId);
        const refColIdx = (fk.columnIds as readonly string[]).indexOf(c.id);
        const refColId = fk.referencedColumnIds[refColIdx >= 0 ? refColIdx : 0];
        col.reference = {
          table: refTable?.physicalName ?? `<unknown:${String(fk.referencedTableId).slice(0, 8)}>`,
          column: refTable && refColId
            ? resolveColumnPhysical(refTable, refColId)
            : (refColId ?? ""),
          type: fk.noConstraint ? "logical" : "physical",
        };
      }
      return col;
    }),
    indexes: (t.indexes ?? []).map((idx) => ({
      name: idx.physicalName,
      columns: idx.columns.map((ic) => resolveColumnPhysical(t, ic.columnId)),
      unique: idx.unique ?? false,
    })),
    ...(t.constraints && t.constraints.length > 0 ? { constraints: t.constraints } : {}),
    ...(t.defaults && t.defaults.length > 0 ? { defaults: t.defaults } : {}),
    ...(t.triggers && t.triggers.length > 0 ? { triggers: t.triggers } : {}),
  };
}

function toSpecRelation(r: ErRelation): SpecRelation {
  const hasColumns = r.sourceColumnName && r.targetColumnName;
  const from = hasColumns
    ? `${r.sourceTableName}.${r.sourceColumnName}`
    : r.sourceTableName;
  const to = hasColumns
    ? `${r.targetTableName}.${r.targetColumnName}`
    : r.targetTableName;

  let constraintType: "physical" | "logical" | "conceptual";
  if (r.physical) {
    constraintType = "physical";
  } else if (hasColumns) {
    constraintType = "logical";
  } else {
    constraintType = "conceptual";
  }

  return {
    from,
    to,
    cardinality: r.cardinality,
    constraintType,
    memo: r.label,
  };
}

function toSpecStep(s: Step, index: number): SpecStep {
  const detail: Record<string, unknown> = {};
  switch (s.kind) {
    case "validation":
      detail.conditions = s.conditions;
      if (s.inlineBranch) detail.inlineBranch = s.inlineBranch;
      break;
    case "dbAccess":
      detail.tableId = s.tableId;
      detail.operation = s.operation;
      if (s.fields) detail.fields = s.fields;
      break;
    case "externalSystem":
      detail.systemRef = s.systemRef;
      if (s.operationRef) detail.operationRef = s.operationRef;
      break;
    case "commonProcess":
      detail.refId = s.refId;
      break;
    case "screenTransition":
      detail.targetScreenId = s.targetScreenId;
      break;
    case "displayUpdate":
      detail.target = s.target;
      break;
    case "branch":
      detail.branches = s.branches;
      if (s.elseBranch) detail.elseBranch = s.elseBranch;
      break;
    case "loop":
      detail.loopKind = s.loopKind;
      if (s.countExpression) detail.countExpression = s.countExpression;
      if (s.conditionMode) detail.conditionMode = s.conditionMode;
      if (s.conditionExpression) detail.conditionExpression = s.conditionExpression;
      if (s.collectionSource) detail.collectionSource = s.collectionSource;
      if (s.collectionItemName) detail.collectionItemName = s.collectionItemName;
      detail.steps = s.steps;
      break;
    case "loopBreak":
    case "loopContinue":
      break;
    case "jump":
      detail.jumpTo = s.jumpTo;
      break;
    case "compute":
      detail.expression = s.expression;
      if (s.outputBinding) detail.outputBinding = s.outputBinding;
      break;
    case "return":
      if (s.value) detail.value = s.value;
      break;
    case "log":
      detail.level = s.level;
      detail.message = s.message;
      break;
    case "audit":
      detail.action = s.action;
      break;
    case "workflow":
      detail.pattern = s.pattern;
      detail.approvers = s.approvers;
      detail.quorum = s.quorum;
      break;
    case "transactionScope":
      if (s.isolationLevel) detail.isolationLevel = s.isolationLevel;
      if (s.propagation) detail.propagation = s.propagation;
      if (s.timeoutMs !== undefined) detail.timeoutMs = s.timeoutMs;
      if (s.rollbackOn && s.rollbackOn.length > 0) detail.rollbackOn = s.rollbackOn;
      detail.steps = s.steps;
      if (s.onCommit) detail.onCommit = s.onCommit;
      if (s.onRollback) detail.onRollback = s.onRollback;
      break;
    case "closing":
      detail.period = s.period;
      if (s.customCron) detail.customCron = s.customCron;
      if (s.cutoffAt) detail.cutoffAt = s.cutoffAt;
      if (s.idempotencyKey) detail.idempotencyKey = s.idempotencyKey;
      if (s.rollbackOnFailure !== undefined) detail.rollbackOnFailure = s.rollbackOnFailure;
      break;
    case "cdc":
      detail.tableIds = s.tableIds;
      detail.captureMode = s.captureMode;
      detail.destination = s.destination;
      if (s.includeColumns && s.includeColumns.length > 0) detail.includeColumns = s.includeColumns;
      if (s.excludeColumns && s.excludeColumns.length > 0) detail.excludeColumns = s.excludeColumns;
      break;
    case "eventPublish":
      detail.topic = s.topic;
      if (s.eventRef) detail.eventRef = s.eventRef;
      if (s.payload) detail.payload = s.payload;
      break;
    case "eventSubscribe":
      detail.topic = s.topic;
      if (s.eventRef) detail.eventRef = s.eventRef;
      if (s.filter) detail.filter = s.filter;
      break;
  }
  return {
    number: getStepLabel(index),
    type: s.kind,
    description: s.description,
    detail,
  };
}
