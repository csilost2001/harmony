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
 * harmony.json `tables[]` メタと `tables/<id>.json` の双方を整合 update。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  readProject,
  writeProject,
  readTable,
  writeTable,
  deleteTable as deleteTableFile,
} from "../projectStorage.js";
import type { ToolHandler } from "../mcpHelpers.js";
import { assertSafeName } from "../security/idValidator.js";

export const handleTableTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__list_tables": {
      const fileProject = await readProject(root) as { tables?: Array<{ id: string; name: string; logicalName: string; category?: string; columnCount: number; updatedAt: string }> } | null;
      const tables = fileProject?.tables ?? [];
      if (tables.length === 0) {
        return { content: [{ type: "text", text: "テーブルはまだ定義されていません。" }] };
      }
      const lines = tables.map(
        (t) => `- ${t.id}  ${t.name}（${t.logicalName}）${t.category ? ` [${t.category}]` : ""} カラム:${t.columnCount}`
      );
      return { content: [{ type: "text", text: `テーブル一覧 (${tables.length}件):\n${lines.join("\n")}` }] };
    }

    case "designer__get_table": {
      if (typeof a.tableId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "tableId は必須です");
      }
      // S-002: ID validation
      try { assertSafeName(a.tableId, "tableId"); } catch (e) { throw new McpError(ErrorCode.InvalidParams, (e as Error).message); }
      const tableData = await readTable(a.tableId, root);
      if (!tableData) {
        throw new McpError(ErrorCode.InvalidParams, `テーブル ${a.tableId} が見つかりません`);
      }
      return { content: [{ type: "text", text: JSON.stringify(tableData, null, 2) }] };
    }

    case "designer__add_table": {
      if (typeof a.name !== "string" || typeof a.logicalName !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "name, logicalName は必須です");
      }
      const id = `table-${Date.now()}`;
      const now = new Date().toISOString();
      const tableDef = {
        id,
        name: a.name,
        logicalName: a.logicalName,
        description: typeof a.description === "string" ? a.description : "",
        category: typeof a.category === "string" ? a.category : undefined,
        columns: [],
        indexes: [],
        createdAt: now,
        updatedAt: now,
      };
      await writeTable(id, tableDef, root);
      // harmony.json のテーブルメタも更新
      const project = (await readProject(root) ?? {}) as Record<string, unknown>;
      const tables = (project.tables ?? []) as Array<Record<string, unknown>>;
      tables.push({ id, name: a.name, logicalName: a.logicalName, category: a.category, columnCount: 0, updatedAt: now });
      project.tables = tables;
      project.updatedAt = now;
      await writeProject(project, root);
      return { content: [{ type: "text", text: `テーブル「${a.logicalName}」(${a.name}) を追加しました（ID: ${id}）` }] };
    }

    case "designer__update_table": {
      if (typeof a.tableId !== "string" || !a.definition) {
        throw new McpError(ErrorCode.InvalidParams, "tableId, definition は必須です");
      }
      // S-002: ID validation
      try { assertSafeName(a.tableId, "tableId"); } catch (e) { throw new McpError(ErrorCode.InvalidParams, (e as Error).message); }
      const def = a.definition as Record<string, unknown>;
      def.updatedAt = new Date().toISOString();
      await writeTable(a.tableId, def, root);
      // harmony.json メタ更新
      const project = (await readProject(root) ?? {}) as Record<string, unknown>;
      const tables = (project.tables ?? []) as Array<Record<string, unknown>>;
      const idx = tables.findIndex((t) => t.id === a.tableId);
      const columns = (def.columns ?? []) as unknown[];
      const meta = { id: a.tableId, name: def.name, logicalName: def.logicalName, category: def.category, columnCount: columns.length, updatedAt: def.updatedAt };
      if (idx >= 0) tables[idx] = meta; else tables.push(meta);
      project.tables = tables;
      project.updatedAt = def.updatedAt as string;
      await writeProject(project, root);
      return { content: [{ type: "text", text: `テーブル ${a.tableId} を更新しました。` }] };
    }

    case "designer__remove_table": {
      if (typeof a.tableId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "tableId は必須です");
      }
      // S-002: ID validation
      try { assertSafeName(a.tableId, "tableId"); } catch (e) { throw new McpError(ErrorCode.InvalidParams, (e as Error).message); }
      await deleteTableFile(a.tableId, root);
      const project = (await readProject(root) ?? {}) as Record<string, unknown>;
      const tables = ((project.tables ?? []) as Array<Record<string, unknown>>).filter((t) => t.id !== a.tableId);
      project.tables = tables;
      project.updatedAt = new Date().toISOString();
      await writeProject(project, root);
      return { content: [{ type: "text", text: `テーブル ${a.tableId} を削除しました。` }] };
    }

    default:
      return null;
  }
};
