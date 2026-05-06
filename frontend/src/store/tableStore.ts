/**
 * tableStore.ts (v3, #556)
 * テーブル設計書の永続化ストア。
 *
 * - data/tables/<UUID>.json (per-entity ファイル)
 * - $schema 属性で v3 schema 参照を保存
 * - localStorage キー prefix: v3-table-
 * - project.json の entities.tables (互換的に project.tables[]) で v3 TableEntry を管理
 */
import type {
  Table,
  TableEntry,
  TableId,
  Column,
  Index,
  Constraint,
  TriggerDefinition,
  DefaultDefinition,
  PhysicalName,
  DisplayName,
  LocalId,
  Timestamp,
} from "../types/v3";
import { loadProject, saveProject } from "./flowStore";
import { generateUUID } from "../utils/uuid";
import { validateTable } from "../utils/tableValidation";
import type { ValidationError } from "../utils/actionValidation";
import { renumber, nextNo } from "../utils/listOrder";

// ─── ストレージバックエンド ──────────────────────────────────────────────

export interface TableStorageBackend {
  loadTable(tableId: string): Promise<unknown>;
  listAllTables?(): Promise<unknown[]>;
  saveTable(tableId: string, data: unknown): Promise<void>;
  deleteTable(tableId: string): Promise<void>;
}

let _backend: TableStorageBackend | null = null;

export function setTableStorageBackend(b: TableStorageBackend | null): void {
  _backend = b;
}

// ─── localStorage キー (v3 名前空間、#556) ───────────────────────────────

const TABLE_PREFIX = "v3-table-";

const TABLE_SCHEMA_REF = "../../schemas/v3/table.v3.schema.json";

function nowTs(): Timestamp {
  return new Date().toISOString() as Timestamp;
}

// ─── 公開 API ────────────────────────────────────────────────────────────

/** テーブル一覧を取得 (project.json の TableEntry[]) */
export async function listTables(): Promise<TableEntry[]> {
  const project = await loadProject();
  return project.tables ?? [];
}

/** テーブル定義を読み込み (columns の no を配列順で補完) */
export async function loadTable(tableId: string): Promise<Table | null> {
  const raw = await (async () => {
    if (_backend) return (await _backend.loadTable(tableId)) as Table | null;
    const s = localStorage.getItem(`${TABLE_PREFIX}${tableId}`);
    if (!s) return null;
    try { return JSON.parse(s) as Table; } catch { return null; }
  })();
  if (!raw) return null;
  // docs/spec/list-common.md §3.10: 読み込み時に no を配列順で補完
  raw.columns = renumber(raw.columns ?? []);
  return raw;
}

export async function loadAllTables(): Promise<Table[]> {
  const entries = await listTables();
  const entryIds = new Set(entries.map((entry) => entry.id));

  if (_backend?.listAllTables) {
    const all = (await _backend.listAllTables()) as Table[];
    return all.filter((table) => entryIds.has(table.id));
  }

  return (await Promise.all(entries.map((entry) => loadTable(entry.id))))
    .filter((t): t is Table => t !== null);
}

export async function loadTableValidationMap(): Promise<Map<TableId, ValidationError[]>> {
  const tables = await loadAllTables();
  const validationMap = new Map<TableId, ValidationError[]>();

  for (const table of tables) {
    validationMap.set(table.id, validateTable(table, tables));
  }

  return validationMap;
}

/** テーブル定義を保存 (project.json の TableEntry も同期) */
export async function saveTable(table: Table): Promise<void> {
  // $schema は spread 後に明示的に上書きして、旧 v1/v2 由来の $schema を必ず v3 ref に書き換える。
  const toSave: Table = { ...table, $schema: TABLE_SCHEMA_REF, updatedAt: nowTs() };

  if (_backend) {
    await _backend.saveTable(toSave.id, toSave);
  } else {
    localStorage.setItem(`${TABLE_PREFIX}${toSave.id}`, JSON.stringify(toSave));
  }

  await syncTableMeta(toSave);
}

/** テーブルを新規作成 */
export async function createTable(
  physicalName: PhysicalName,
  name: DisplayName,
  description?: string,
  category?: string,
): Promise<Table> {
  const ts = nowTs();
  const table: Table = {
    $schema: TABLE_SCHEMA_REF,
    id: generateUUID() as TableId,
    name,
    description,
    physicalName,
    category,
    columns: [],
    indexes: [],
    createdAt: ts,
    updatedAt: ts,
  };
  await saveTable(table);
  return table;
}

/** テーブルを削除 (per-file 削除 + project.json メタ削除) */
export async function deleteTable(tableId: string): Promise<void> {
  if (_backend) {
    await _backend.deleteTable(tableId);
  } else {
    localStorage.removeItem(`${TABLE_PREFIX}${tableId}`);
  }
}

interface CommitTablesDeps {
  loadProject: typeof loadProject;
  saveProject: typeof saveProject;
  deleteTable: typeof deleteTable;
}

export async function commitTables(
  { itemsInOrder, deletedIds }: { itemsInOrder: TableEntry[]; deletedIds: string[] },
  deps: CommitTablesDeps = { loadProject, saveProject, deleteTable },
): Promise<void> {
  const project = await deps.loadProject();
  const deletedSet = new Set(deletedIds);
  const orderMap = new Map(itemsInOrder.map((t, i) => [t.id, i]));
  project.tables = (project.tables ?? [])
    .filter((t) => !deletedSet.has(t.id))
    .sort((a, b) => (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER))
    .map((t, i) => ({ ...t, no: i + 1 }));
  await deps.saveProject(project);
  for (const id of deletedIds) {
    await deps.deleteTable(id);
  }
}

// ─── カラム操作 (Table mutate ヘルパー) ──────────────────────────────────

/** カラムを追加 (column.id は LocalId 形式で `col-NN` 採番) */
export function addColumn(
  table: Table,
  partial?: Partial<Column>,
): Column {
  const n = table.columns.length + 1;
  const col: Column = {
    id: (partial?.id ?? `col-${String(n).padStart(2, "0")}`) as LocalId,
    no: nextNo(table.columns),
    physicalName: (partial?.physicalName ?? "new_column") as PhysicalName,
    name: (partial?.name ?? "新規カラム") as DisplayName,
    dataType: partial?.dataType ?? "VARCHAR",
    length: partial?.length,
    scale: partial?.scale,
    notNull: partial?.notNull,
    primaryKey: partial?.primaryKey,
    unique: partial?.unique,
    defaultValue: partial?.defaultValue,
    autoIncrement: partial?.autoIncrement,
    comment: partial?.comment,
  };
  table.columns.push(col);
  table.columns = renumber(table.columns);
  return col;
}

/** カラムを削除 (Index / Constraint / Default の columnId 参照も連動削除) */
export function removeColumn(table: Table, columnId: string): void {
  const idx = table.columns.findIndex((c) => c.id === columnId);
  if (idx < 0) return;
  table.columns.splice(idx, 1);
  table.columns = renumber(table.columns);
  // Index の columnId 参照を削除、空 Index は削除
  table.indexes = (table.indexes ?? [])
    .map((i) => ({ ...i, columns: i.columns.filter((ic) => ic.columnId !== columnId) }))
    .filter((i) => i.columns.length > 0);
  // Constraint の columnIds 参照を削除、空 Constraint は削除
  table.constraints = (table.constraints ?? [])
    .map((c) => {
      if (c.kind === "unique" || c.kind === "foreignKey") {
        return { ...c, columnIds: c.columnIds.filter((id) => id !== columnId) };
      }
      return c;
    })
    .filter((c) => c.kind === "check" || c.columnIds.length > 0) as Constraint[];
  // Default の columnId が一致するものを削除
  table.defaults = (table.defaults ?? []).filter((d) => d.columnId !== columnId);
}

// ─── インデックス操作 ───────────────────────────────────────────────────

export function addIndex(table: Table, partial?: Partial<Index>): Index {
  const n = (table.indexes ?? []).length + 1;
  const idx: Index = {
    id: (partial?.id ?? `idx-${String(n).padStart(2, "0")}`) as LocalId,
    physicalName: (partial?.physicalName ?? `idx_${table.physicalName}_${n}`) as PhysicalName,
    columns: partial?.columns ?? [],
    unique: partial?.unique,
    method: partial?.method,
    where: partial?.where,
    description: partial?.description,
  };
  table.indexes = [...(table.indexes ?? []), idx];
  return idx;
}

export function removeIndex(table: Table, indexId: string): void {
  table.indexes = (table.indexes ?? []).filter((i) => i.id !== indexId);
}

// ─── 制約操作 ───────────────────────────────────────────────────────────

export function addConstraint(
  table: Table,
  constraint: Omit<Constraint, "id">,
): Constraint {
  const n = (table.constraints ?? []).length + 1;
  const c = { id: `con-${String(n).padStart(2, "0")}` as LocalId, ...constraint } as Constraint;
  table.constraints = [...(table.constraints ?? []), c];
  return c;
}

export function removeConstraint(table: Table, constraintId: string): void {
  table.constraints = (table.constraints ?? []).filter((c) => c.id !== constraintId);
}

// ─── DEFAULT 値操作 ─────────────────────────────────────────────────────

export function addDefault(table: Table, def: DefaultDefinition): void {
  table.defaults = [...(table.defaults ?? []), def];
}

export function removeDefault(table: Table, columnId: string): void {
  table.defaults = (table.defaults ?? []).filter((d) => d.columnId !== columnId);
}

// ─── トリガー操作 ───────────────────────────────────────────────────────

export function addTrigger(
  table: Table,
  partial?: Partial<TriggerDefinition>,
): TriggerDefinition {
  const n = (table.triggers ?? []).length + 1;
  const t: TriggerDefinition = {
    id: (partial?.id ?? `trg-${String(n).padStart(2, "0")}`) as LocalId,
    physicalName: (partial?.physicalName ?? `trg_${table.physicalName}_${n}`) as PhysicalName,
    timing: partial?.timing ?? "BEFORE",
    events: partial?.events ?? ["INSERT"],
    whenCondition: partial?.whenCondition,
    body: partial?.body ?? "",
    description: partial?.description,
  };
  table.triggers = [...(table.triggers ?? []), t];
  return t;
}

export function removeTrigger(table: Table, triggerId: string): void {
  table.triggers = (table.triggers ?? []).filter((t) => t.id !== triggerId);
}

// ─── 並び替え ───────────────────────────────────────────────────────────

/** テーブル一覧の並び順を変更 (project.tables の物理順) */
export async function reorderTables(fromIndex: number, toIndex: number): Promise<void> {
  const project = await loadProject();
  if (!project.tables) return;
  if (fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= project.tables.length || toIndex >= project.tables.length) return;
  if (fromIndex === toIndex) return;
  const [moved] = project.tables.splice(fromIndex, 1);
  project.tables.splice(toIndex, 0, moved);
  project.tables = renumber(project.tables);
  await saveProject(project);
}

// ─── 内部 ────────────────────────────────────────────────────────────────

/** project.json の TableEntry を同期 */
async function syncTableMeta(table: Table): Promise<void> {
  const project = await loadProject();
  if (!project.tables) project.tables = [];

  const idx = project.tables.findIndex((t) => t.id === table.id);
  const meta: TableEntry = {
    id: table.id,
    no: idx >= 0 ? project.tables[idx].no : nextNo(project.tables),
    name: table.name,
    physicalName: table.physicalName,
    category: table.category,
    columnCount: table.columns.length,
    updatedAt: table.updatedAt,
    maturity: table.maturity,
  };

  if (idx >= 0) {
    project.tables[idx] = meta;
  } else {
    project.tables.push(meta);
  }
  project.tables = renumber(project.tables);
  await saveProject(project);
}
