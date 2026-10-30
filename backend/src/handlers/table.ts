/**
 * テーブル定義系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (5 ツール):
 * - designer__list_tables
 * - designer__get_table
 * - designer__add_table
 * - designer__update_table
 * - designer__remove_table
 *
 * harmony.json の `entities.tables[]` (v3) と `tables/<id>.json` の双方を整合 update。
 * harmony.json の最上位へ `tables` / `updatedAt` を書かない (v3 スキーマは追加の項目を許さない。#1568)。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import {
  readProject,
  writeProject,
  readTable,
  writeTable,
  deleteTable as deleteTableFile,
} from "../projectStorage.js";
import { readProjectWithUnregistered } from "../registryMerge.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";
import { getHarmonyValidator } from "../workspaceInit.js";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 物理名 (common.v3 PhysicalName): 英小文字で始まる snake_case、63 文字まで */
const PHYSICAL_NAME_RE = /^[a-z][a-z0-9_]*$/;

/** harmony.json を読む。無ければ、書く前に分かりやすく止める (空の harmony.json を作らない) */
async function readProjectForWrite(root: string): Promise<Record<string, unknown>> {
  const project = await readProject(root);
  if (!isRecord(project)) {
    throw new McpError(ErrorCode.InvalidRequest, "harmony.json が見つかりません。ワークスペースを開いてからやり直してください (designer__workspace_open)");
  }
  return project;
}

interface SchemaError { instancePath?: string; keyword?: string; message?: string; params?: Record<string, unknown> }

const errorKey = (e: SchemaError): string => `${e.instancePath ?? ""}|${e.keyword ?? ""}|${e.message ?? ""}`;

/**
 * 書く前の harmony.json (before) と、書こうとしている harmony.json (after) を harmony.v3 スキーマで検証する。
 * 書こうとしたことで新しく増えた違反があれば、何も書かずにエラーにする (画面がワークスペースを開けなくなるのを防ぐ。#1568)。
 * もとから違反していた所 (旧形式の項目など) は、ここでは止めない: それは designer__repair_registry で直す。
 */
async function assertHarmonyStillValid(before: Record<string, unknown>, after: Record<string, unknown>): Promise<void> {
  const validate = await getHarmonyValidator();
  validate(before);
  const known = new Set(((Array.isArray(validate.errors) ? validate.errors : []) as SchemaError[]).map(errorKey));
  if (validate(after)) return;
  const added = ((Array.isArray(validate.errors) ? validate.errors : []) as SchemaError[]).filter((e) => !known.has(errorKey(e)));
  if (added.length === 0) return;
  const detail = added.slice(0, 5).map((e) => {
    const allowed = Array.isArray(e.params?.allowedValues) ? ` (使える値: ${(e.params!.allowedValues as unknown[]).join(" / ")})` : "";
    return `${e.instancePath || "(最上位)"}: ${e.message ?? e.keyword}${allowed}`;
  }).join("; ");
  throw new McpError(
    ErrorCode.InvalidParams,
    `harmony.json の entities.tables に書く値が harmony.v3 スキーマに合いません。何も書きませんでした: ${detail}。maturity は draft / provisional / committed のいずれか、category は文字列にしてください`,
  );
}

/** entities.tables[] (v3 の TableEntry) を差し替えて、meta.updatedAt も更新する */
function setTableEntries(project: Record<string, unknown>, tables: Array<Record<string, unknown>>, now: string): void {
  const entities = isRecord(project.entities) ? project.entities : {};
  entities.tables = tables;
  project.entities = entities;
  if (isRecord(project.meta)) project.meta.updatedAt = now;
}

function tableEntries(project: Record<string, unknown>): Array<Record<string, unknown>> {
  const entities = isRecord(project.entities) ? project.entities : {};
  return Array.isArray(entities.tables) ? (entities.tables as Array<Record<string, unknown>>) : [];
}

/** テーブル本体から TableEntry (EntryBase: id / no / name / updatedAt + physicalName / category / columnCount) を作る */
function buildTableEntry(id: string, def: Record<string, unknown>, prev: Record<string, unknown> | undefined, no: number, updatedAt: string): Record<string, unknown> {
  const name = typeof def.name === "string" && def.name ? def.name : (typeof prev?.name === "string" ? prev.name : id);
  const entry: Record<string, unknown> = { id, no, name, updatedAt };
  const physicalName = typeof def.physicalName === "string" ? def.physicalName : undefined;
  if (physicalName && PHYSICAL_NAME_RE.test(physicalName) && physicalName.length <= 63) entry.physicalName = physicalName;
  // 型や enum はスキーマが決める。合わない値もここでは写し、書く前の検証 (assertHarmonyStillValid) が断る
  if (def.category !== undefined && def.category !== null && def.category !== "") entry.category = def.category;
  if (def.maturity !== undefined && def.maturity !== null && def.maturity !== "") entry.maturity = def.maturity;
  entry.columnCount = Array.isArray(def.columns) ? def.columns.length : 0;
  return entry;
}

export const handleTableTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__list_tables": {
      // 一覧 (entities.tables) に載っていないファイルも、読み出しでは足して見せる
      const { project } = await readProjectWithUnregistered(root);
      const tables = isRecord(project) ? tableEntries(project) : [];
      if (tables.length === 0) {
        return { content: [{ type: "text", text: "テーブルはまだ定義されていません。" }] };
      }
      const lines = tables.map(
        (t) => `- ${t.id}  ${t.physicalName ?? "(物理名なし)"}（${t.name}）${t.category ? ` [${t.category}]` : ""} カラム:${t.columnCount ?? 0}`
      );
      return { content: [{ type: "text", text: `テーブル一覧 (${tables.length}件):\n${lines.join("\n")}` }] };
    }

    case "designer__get_table": {
      if (typeof a.tableId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "tableId は必須です");
      }
      // S-002: ID validation
      assertEntityIdMcp(a.tableId, "tableId");
      const tableData = await readTable(a.tableId, root);
      if (!tableData) {
        throw new McpError(ErrorCode.InvalidParams, `テーブル ${a.tableId} が見つかりません`);
      }
      return { content: [{ type: "text", text: JSON.stringify(tableData, null, 2) }] };
    }

    case "designer__add_table": {
      if (a.logicalName !== undefined) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "logicalName は使えません。v3 のテーブルは physicalName (物理名。英小文字の snake_case) と name (表示名。論理名はここ) を指定します。例: { physicalName: \"expenses\", name: \"経費\" }",
        );
      }
      if (typeof a.physicalName !== "string" || typeof a.name !== "string" || !a.name) {
        throw new McpError(ErrorCode.InvalidParams, "physicalName (物理名) と name (表示名) は必須です");
      }
      if (!PHYSICAL_NAME_RE.test(a.physicalName) || a.physicalName.length > 63) {
        throw new McpError(ErrorCode.InvalidParams, `physicalName は英小文字で始まる snake_case (英小文字・数字・_、63 文字まで) で指定してください: ${a.physicalName}`);
      }
      const project = await readProjectForWrite(root);
      // 同じ物理名のテーブルがすでにあれば、断る (一覧に載っていないファイルも見る)
      const existing = tableEntries((await readProjectWithUnregistered(root)).project as Record<string, unknown>).find((t) => t.physicalName === a.physicalName);
      if (existing) {
        throw new McpError(ErrorCode.InvalidParams, `物理名 ${a.physicalName} のテーブルはすでにあります（ID: ${String(existing.id)}、${String(existing.name)}）。別の物理名にするか、designer__update_table で直してください`);
      }
      // #1294 I-2: id は kebab-case EntityId (RFC #1284)、uuid は別途 randomUUID で採番
      // 暫定採番形式 (I-5 で UI 創成ダイアログから人間入力 / AI 提案に置き換え)
      const id = `table-${randomUUID().slice(0, 8)}`;
      const uuid = randomUUID();
      const now = new Date().toISOString();
      const tableDef: Record<string, unknown> = {
        id,
        uuid,
        physicalName: a.physicalName,
        name: a.name,
        ...(typeof a.description === "string" && a.description ? { description: a.description } : {}),
        ...(typeof a.category === "string" && a.category ? { category: a.category } : {}),
        columns: [],
        indexes: [],
        createdAt: now,
        updatedAt: now,
      };
      // harmony.json の entities.tables[] (v3) も更新。スキーマに合うと確かめてから、テーブルのファイルと harmony.json を書く
      const next = structuredClone(project);
      const tables = [...tableEntries(next)];
      const no = tables.reduce((m, e) => Math.max(m, typeof e.no === "number" ? e.no : 0), 0) + 1;
      tables.push(buildTableEntry(id, tableDef, undefined, no, now));
      setTableEntries(next, tables, now);
      await assertHarmonyStillValid(project, next);
      await writeTable(id, tableDef, root);
      await writeProject(next, root);
      return { content: [{ type: "text", text: `テーブル「${a.name}」(${a.physicalName}) を追加しました（ID: ${id}）` }] };
    }

    case "designer__update_table": {
      if (typeof a.tableId !== "string" || !a.definition) {
        throw new McpError(ErrorCode.InvalidParams, "tableId, definition は必須です");
      }
      // S-002: ID validation
      assertEntityIdMcp(a.tableId, "tableId");
      const project = await readProjectForWrite(root);
      const def = a.definition as Record<string, unknown>;
      const now = new Date().toISOString();
      def.updatedAt = now;
      // harmony.json の entities.tables[] (v3) を更新 (並び順 no は維持)。スキーマに合うと確かめてから書く
      const next = structuredClone(project);
      const tables = [...tableEntries(next)];
      const idx = tables.findIndex((t) => t.id === a.tableId);
      if (idx >= 0) {
        tables[idx] = buildTableEntry(a.tableId, def, tables[idx], typeof tables[idx].no === "number" ? tables[idx].no as number : idx + 1, now);
      } else {
        const no = tables.reduce((m, e) => Math.max(m, typeof e.no === "number" ? e.no : 0), 0) + 1;
        tables.push(buildTableEntry(a.tableId, def, undefined, no, now));
      }
      setTableEntries(next, tables, now);
      await assertHarmonyStillValid(project, next);
      await writeTable(a.tableId, def, root);
      await writeProject(next, root);
      return { content: [{ type: "text", text: `テーブル ${a.tableId} を更新しました。` }] };
    }

    case "designer__remove_table": {
      if (typeof a.tableId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "tableId は必須です");
      }
      // S-002: ID validation
      assertEntityIdMcp(a.tableId, "tableId");
      const project = await readProjectForWrite(root);
      await deleteTableFile(a.tableId, root);
      const tables = tableEntries(project).filter((t) => t.id !== a.tableId);
      setTableEntries(project, tables, new Date().toISOString());
      await writeProject(project, root);
      return { content: [{ type: "text", text: `テーブル ${a.tableId} を削除しました。` }] };
    }

    default:
      return null;
  }
};
