/**
 * PageLayout 系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (6 ツール、RFC #1021 pl-6):
 * - designer__list_page_layouts
 * - designer__add_page_layout
 * - designer__update_page_layout
 * - designer__remove_page_layout
 * - designer__get_page_layout
 * - designer__save_page_layout
 *
 * harmony.json `entities.pageLayouts[]` メタと `page-layouts/<id>.json` の双方を整合 update。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import {
  readProject,
  writeProject,
  writePageLayout,
  readPageLayout,
  deletePageLayoutFile,
  listAllPageLayouts,
} from "../projectStorage.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handlePageLayoutTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__list_page_layouts": {
      const allPageLayouts = await listAllPageLayouts(root);
      if (allPageLayouts.length === 0) {
        return { content: [{ type: "text", text: "PageLayout はまだ定義されていません。" }] };
      }
      const lines = allPageLayouts.map((pl) => {
        const p = pl as Record<string, unknown>;
        return `- ${p.id}  ${p.name}${p.description ? ` — ${p.description}` : ""}`;
      });
      return { content: [{ type: "text", text: `PageLayout 一覧 (${allPageLayouts.length}件):\n${lines.join("\n")}` }] };
    }

    case "designer__add_page_layout": {
      if (typeof a.name !== "string" || typeof a.editorKind !== "string" || typeof a.cssFramework !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "name, editorKind, cssFramework は必須です");
      }
      const id = randomUUID();
      const now = new Date().toISOString();
      const def = {
        id,
        name: a.name,
        description: typeof a.description === "string" ? a.description : undefined,
        maturity: "draft",
        createdAt: now,
        updatedAt: now,
        regions: [
          { name: "header" },
          { name: "sidebar" },
          { name: "footer" },
          { name: "main" },
        ],
        assignments: {},
        design: { editorKind: a.editorKind, cssFramework: a.cssFramework },
      };
      await writePageLayout(id, def, root);
      // harmony.json の entities.pageLayouts[] 更新
      const project = (await readProject(root) ?? {}) as Record<string, unknown>;
      const entities = ((project.entities ?? {}) as Record<string, unknown>);
      const pageLayouts = ((entities.pageLayouts ?? []) as Array<Record<string, unknown>>);
      // RFC #1021 pl-6 (Codex D-4): EntryBase は createdAt を required にしないため省略
      // (PageLayoutEntry shape を schema 通りに統一)
      pageLayouts.push({
        id,
        no: pageLayouts.length + 1,
        name: a.name,
        maturity: "draft",
        updatedAt: now,
        regionCount: 4,
        assignmentCount: 0,
        hasProcessFlow: false,
        hasDesign: false,
      });
      entities.pageLayouts = pageLayouts;
      project.entities = entities;
      project.updatedAt = now;
      await writeProject(project, root);
      return { content: [{ type: "text", text: `PageLayout 「${a.name}」を追加しました（ID: ${id}）` }] };
    }

    case "designer__update_page_layout": {
      if (typeof a.pageLayoutId !== "string" || !a.definition) {
        throw new McpError(ErrorCode.InvalidParams, "pageLayoutId, definition は必須です");
      }
      const existing = await readPageLayout(a.pageLayoutId, root);
      if (!existing) {
        throw new McpError(ErrorCode.InvalidParams, `PageLayout ${a.pageLayoutId} が見つかりません`);
      }
      const def = a.definition as Record<string, unknown>;
      def.updatedAt = new Date().toISOString();
      await writePageLayout(a.pageLayoutId, def, root);
      // harmony.json メタ更新
      const project = (await readProject(root) ?? {}) as Record<string, unknown>;
      const entities = ((project.entities ?? {}) as Record<string, unknown>);
      const pageLayouts = ((entities.pageLayouts ?? []) as Array<Record<string, unknown>>);
      const idx = pageLayouts.findIndex((p) => p.id === a.pageLayoutId);
      const regions = (def.regions ?? []) as unknown[];
      const assignments = (def.assignments ?? {}) as Record<string, unknown>;
      const design = (def.design ?? {}) as Record<string, unknown>;
      // RFC #1021 pl-6 (Codex D-4): EntryBase の `no` を既存値から維持、hasDesign は designFileRef/puckDataRef 実体の有無で判定
      const existingNo = idx >= 0 ? pageLayouts[idx].no : pageLayouts.length + 1;
      const meta = {
        id: a.pageLayoutId,
        no: existingNo,
        name: def.name,
        maturity: def.maturity ?? "draft",
        updatedAt: def.updatedAt as string,
        regionCount: regions.length,
        assignmentCount: Object.keys(assignments).length,
        hasProcessFlow: Boolean(def.processFlowId),
        hasDesign: Boolean(design.designFileRef ?? design.puckDataRef),
      };
      if (idx >= 0) pageLayouts[idx] = meta; else pageLayouts.push(meta);
      entities.pageLayouts = pageLayouts;
      project.entities = entities;
      project.updatedAt = def.updatedAt as string;
      await writeProject(project, root);
      return { content: [{ type: "text", text: `PageLayout ${a.pageLayoutId} を更新しました。` }] };
    }

    case "designer__remove_page_layout": {
      if (typeof a.pageLayoutId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "pageLayoutId は必須です");
      }
      await deletePageLayoutFile(a.pageLayoutId, root);
      const project = (await readProject(root) ?? {}) as Record<string, unknown>;
      const entities = ((project.entities ?? {}) as Record<string, unknown>);
      const pageLayouts = ((entities.pageLayouts ?? []) as Array<Record<string, unknown>>).filter((p) => p.id !== a.pageLayoutId);
      entities.pageLayouts = pageLayouts;
      project.entities = entities;
      project.updatedAt = new Date().toISOString();
      await writeProject(project, root);
      return { content: [{ type: "text", text: `PageLayout ${a.pageLayoutId} を削除しました。` }] };
    }

    // RFC #1021 pl-6 (Codex D-2): get / save MCP tools (ISSUE #1023 受け入れ基準 6 種完備)
    case "designer__get_page_layout": {
      if (typeof a.pageLayoutId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "pageLayoutId は必須です");
      }
      const data = await readPageLayout(a.pageLayoutId, root);
      if (!data) {
        return { content: [{ type: "text", text: `PageLayout ${a.pageLayoutId} が見つかりません。` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    case "designer__save_page_layout": {
      if (typeof a.pageLayoutId !== "string" || !a.data) {
        throw new McpError(ErrorCode.InvalidParams, "pageLayoutId と data は必須です");
      }
      await writePageLayout(a.pageLayoutId, a.data, root);
      return { content: [{ type: "text", text: `PageLayout ${a.pageLayoutId} を保存しました。` }] };
    }

    default:
      return null;
  }
};
