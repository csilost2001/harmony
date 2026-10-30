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
  readTable,
  readErLayout,
} from "../projectStorage.js";
import { readProjectWithUnregistered } from "../registryMerge.js";
import { mcpTableToSpecEntry } from "../specExport.js";
import { generateDdlForSpec } from "./ddl.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";

/** 一覧 (harmony.json の entities.tables。v3) にあるテーブルの id と名前。一覧に載っていないファイルも足す */
async function listTableMetas(root: string): Promise<Array<{ id: string; name: string }>> {
  const { project } = await readProjectWithUnregistered(root);
  const entities = project && typeof project === "object" ? (project as { entities?: { tables?: unknown } }).entities : undefined;
  const tables = Array.isArray(entities?.tables) ? entities.tables as Array<{ id: string; name: string }> : [];
  return tables.filter((t) => t && typeof t.id === "string");
}

export const handleExportTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__generate_ddl": {
      const dialect = (typeof a.dialect === "string" ? a.dialect : "standard") as string;
      // #1332 Codex 10 巡目 M2: tableId が指定された場合は EntityId 検証 (top-level entity)。
      // RFC #1284 / #1299 I-7: top-level entity (Table) は kebab-case EntityId 規範。
      if (typeof a.tableId === "string") {
        assertEntityIdMcp(a.tableId, "tableId");
      }
      const tableMetas = await listTableMetas(root);
      // 外部キーの参照先 (物理名) を引くため、対象が 1 つでも全テーブルを読む
      const allTables: Array<Record<string, unknown>> = [];
      for (const tm of tableMetas) {
        const td = await readTable(tm.id, root) as Record<string, unknown> | null;
        if (td) allTables.push({ id: tm.id, ...td });
      }
      const targets = typeof a.tableId === "string" ? allTables.filter((t) => t.id === a.tableId) : allTables;
      // 目録 (harmony.json) に無くファイルだけあるテーブルも、tableId 指定なら読む (従来どおり)
      if (typeof a.tableId === "string" && targets.length === 0) {
        const td = await readTable(a.tableId, root) as Record<string, unknown> | null;
        if (td) targets.push(td);
      }

      const ddlParts: string[] = [];
      for (const td of targets) {
        ddlParts.push(generateDdlForSpec(td, dialect, allTables));
      }
      if (ddlParts.length === 0) {
        return { content: [{ type: "text", text: "DDL生成対象のテーブルが見つかりません。" }] };
      }
      return { content: [{ type: "text", text: `\`\`\`sql\n${ddlParts.join("\n\n")}\n\`\`\`` }] };
    }

    case "designer__export_spec": {
      // harmony.json は v3 (名前は meta.name、画面は entities.screens、遷移は entities.screenTransitions)
      const { project: rawSpecProject } = await readProjectWithUnregistered(root);
      const specProject = (rawSpecProject ?? {}) as { meta?: { name?: string }; entities?: { screens?: Array<Record<string, unknown>>; screenTransitions?: Array<Record<string, unknown>> } };
      const specTableMetas = await listTableMetas(root);
      const specTables: Array<Record<string, unknown>> = [];
      for (const tm of specTableMetas) {
        const td = await readTable(tm.id, root);
        if (td) specTables.push(td as Record<string, unknown>);
      }
      const specErLayout = await readErLayout(root) as Record<string, unknown> | null;

      // Build spec
      const spec: Record<string, unknown> = {
        projectName: specProject.meta?.name,
        generatedAt: new Date().toISOString(),
        tables: specTables.map((t) => mcpTableToSpecEntry(t)),
        relations: [] as Array<Record<string, unknown>>,
        screens: (specProject.entities?.screens ?? []).map((s) => ({
          name: s.name, type: s.kind, path: s.path, description: s.description, hasDesign: s.hasDesign,
        })),
        transitions: (specProject.entities?.screenTransitions ?? []).map((e) => {
          const screens = specProject.entities?.screens ?? [];
          const src = screens.find((s) => s.id === e.sourceScreenId);
          const tgt = screens.find((s) => s.id === e.targetScreenId);
          return { from: src?.name ?? e.sourceScreenId, to: tgt?.name ?? e.targetScreenId, label: e.label, trigger: e.trigger };
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
      const tableMetas = await listTableMetas(root);
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
