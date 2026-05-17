/**
 * エクスポート / ER 図 / DDL 生成系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (4 ツール):
 * - designer__generate_ddl
 * - designer__export_spec
 * - designer__get_er_diagram (full ER)
 * - designer__generate_er_mermaid (mermaid のみ)
 *
 * harmony.json + tables/*.json + er-layout.json を読んで派生物を返す。
 * DDL 生成ヘルパーは handlers/ddl.ts に分離。
 */
import {
  readProject,
  readTable,
  readErLayout,
} from "../projectStorage.js";
import { mcpTableToSpecEntry } from "../specExport.js";
import { generateDdl } from "./ddl.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handleExportTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__generate_ddl": {
      const dialect = (typeof a.dialect === "string" ? a.dialect : "standard") as string;
      const project = (await readProject(root) ?? {}) as Record<string, unknown>;
      const tableMetas = ((project.tables ?? []) as Array<{ id: string; name: string }>);
      const tableIds = typeof a.tableId === "string" ? [a.tableId] : tableMetas.map((t) => t.id);

      const ddlParts: string[] = [];
      for (const tid of tableIds) {
        const td = await readTable(tid, root) as Record<string, unknown> | null;
        if (!td) continue;
        ddlParts.push(generateDdl(td, dialect));
      }
      if (ddlParts.length === 0) {
        return { content: [{ type: "text", text: "DDL生成対象のテーブルが見つかりません。" }] };
      }
      return { content: [{ type: "text", text: `\`\`\`sql\n${ddlParts.join("\n\n")}\n\`\`\`` }] };
    }

    case "designer__export_spec": {
      const specProject = (await readProject(root) ?? {}) as Record<string, unknown>;
      const specTableMetas = ((specProject.tables ?? []) as Array<{ id: string }>);
      const specTables: Array<Record<string, unknown>> = [];
      for (const tm of specTableMetas) {
        const td = await readTable(tm.id, root);
        if (td) specTables.push(td as Record<string, unknown>);
      }
      const specErLayout = await readErLayout(root) as Record<string, unknown> | null;

      // Build spec
      const spec: Record<string, unknown> = {
        projectName: specProject.name,
        generatedAt: new Date().toISOString(),
        tables: specTables.map((t) => mcpTableToSpecEntry(t)),
        relations: [] as Array<Record<string, unknown>>,
        screens: ((specProject.screens ?? []) as Array<Record<string, unknown>>).map((s) => ({
          name: s.name, type: s.type, path: s.path, description: s.description, hasDesign: s.hasDesign,
        })),
        transitions: ((specProject.edges ?? []) as Array<Record<string, unknown>>).map((e) => {
          const screens = (specProject.screens ?? []) as Array<Record<string, unknown>>;
          const src = screens.find((s) => s.id === e.source);
          const tgt = screens.find((s) => s.id === e.target);
          return { from: src?.name ?? e.source, to: tgt?.name ?? e.target, label: e.label, trigger: e.trigger };
        }),
      };

      // Build relations from FK + logical
      const rels: Array<Record<string, unknown>> = [];
      for (const table of specTables) {
        for (const col of (table.columns ?? []) as Array<Record<string, unknown>>) {
          const fk = col.foreignKey as { tableId: string; columnName: string; noConstraint?: boolean } | undefined;
          if (!fk) continue;
          rels.push({
            from: `${table.name}.${col.name}`, to: `${fk.tableId}.${fk.columnName}`,
            cardinality: "one-to-many", constraintType: fk.noConstraint ? "logical" : "physical",
          });
        }
      }
      for (const lr of ((specErLayout?.logicalRelations ?? []) as Array<Record<string, unknown>>)) {
        const srcT = specTables.find((t) => t.id === lr.sourceTableId);
        const tgtT = specTables.find((t) => t.id === lr.targetTableId);
        if (!srcT || !tgtT) continue;
        const hasCol = lr.sourceColumnName && lr.targetColumnName;
        rels.push({
          from: hasCol ? `${srcT.name}.${lr.sourceColumnName}` : srcT.name,
          to: hasCol ? `${tgtT.name}.${lr.targetColumnName}` : tgtT.name,
          cardinality: lr.cardinality ?? "one-to-many",
          constraintType: hasCol ? "logical" : "conceptual",
          memo: lr.label,
        });
      }
      spec.relations = rels;

      return { content: [{ type: "text", text: JSON.stringify(spec, null, 2) }] };
    }

    case "designer__get_er_diagram":
    case "designer__generate_er_mermaid": {
      const project = (await readProject(root) ?? {}) as Record<string, unknown>;
      const tableMetas = ((project.tables ?? []) as Array<{ id: string; name: string }>);
      const allTables: Array<Record<string, unknown>> = [];
      for (const tm of tableMetas) {
        const td = await readTable(tm.id, root);
        if (td) allTables.push(td as Record<string, unknown>);
      }
      const erLayout = await readErLayout(root) as { logicalRelations?: Array<Record<string, unknown>> } | null;

      // Derive relations from FK
      const relations: Array<{ source: string; sourceCol: string; target: string; targetCol: string; physical: boolean }> = [];
      const tableNameMap = new Map(allTables.map((t) => [t.name as string, t]));
      for (const table of allTables) {
        const cols = (table.columns ?? []) as Array<Record<string, unknown>>;
        for (const col of cols) {
          const fk = col.foreignKey as { tableId: string; columnName: string } | undefined;
          if (!fk) continue;
          const target = tableNameMap.get(fk.tableId);
          if (!target) continue;
          relations.push({
            source: table.name as string,
            sourceCol: col.name as string,
            target: target.name as string,
            targetCol: fk.columnName,
            physical: true,
          });
        }
      }
      // Add logical relations
      for (const lr of erLayout?.logicalRelations ?? []) {
        const srcTable = allTables.find((t) => t.id === lr.sourceTableId);
        const tgtTable = allTables.find((t) => t.id === lr.targetTableId);
        if (srcTable && tgtTable) {
          relations.push({
            source: srcTable.name as string,
            sourceCol: lr.sourceColumnName as string,
            target: tgtTable.name as string,
            targetCol: lr.targetColumnName as string,
            physical: false,
          });
        }
      }

      // Build Mermaid
      const mLines = ["erDiagram"];
      for (const table of allTables) {
        mLines.push(`    ${table.name} {`);
        for (const col of (table.columns ?? []) as Array<Record<string, unknown>>) {
          const markers: string[] = [];
          if (col.primaryKey) markers.push("PK");
          if (col.foreignKey) markers.push("FK");
          const m = markers.length > 0 ? ` ${markers.join(",")}` : "";
          mLines.push(`        ${col.dataType} ${col.name}${m}`);
        }
        mLines.push("    }");
      }
      for (const rel of relations) {
        const card = rel.physical ? "||--o{" : "..o{";
        mLines.push(`    ${rel.target} ${card} ${rel.source} : "${rel.sourceCol}"`);
      }
      const mermaid = mLines.join("\n");

      if (name === "designer__generate_er_mermaid") {
        return { content: [{ type: "text", text: `\`\`\`mermaid\n${mermaid}\n\`\`\`` }] };
      }

      // Full ER data
      const relLines = relations.map(
        (r) => `  - ${r.source}.${r.sourceCol} → ${r.target}.${r.targetCol}${r.physical ? "" : " (論理)"}`
      );
      const tableLines = allTables.map(
        (t) => `  - ${t.name}（${t.logicalName}）${(t.columns as unknown[]).length}カラム`
      );
      return {
        content: [{
          type: "text",
          text: [
            `# ER図`,
            `\n## テーブル (${allTables.length}件)`,
            ...tableLines,
            `\n## リレーション (${relations.length}件)`,
            ...relLines,
            `\n## Mermaid`,
            "```mermaid",
            mermaid,
            "```",
          ].join("\n"),
        }],
      };
    }

    default:
      return null;
  }
};
