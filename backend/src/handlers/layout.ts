/**
 * 画面レイアウト (業務部品の木) と プロジェクト独自部品の MCP tool handler。
 *
 * - designer__get_screen_layout      画面の layout / items / 検証結果を取得
 * - designer__set_screen_layout      画面の layout (と任意で items) を保存
 * - designer__list_layout_components 独自部品の定義一覧 (使用箇所つき)
 * - designer__save_layout_component  独自部品を 1 件追加 / 置換
 * - designer__delete_layout_component 独自部品を削除 (使用中は force が必要)
 *
 * 検証は draft-state 方針に従い、問題があっても保存は妨げず結果として返す
 * (独自部品の定義だけは、壊れた定義が他の画面を壊すため error がある間は保存しない)。
 * 仕様: docs/spec/screen-layout.md / docs/spec/layout-components.md
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  validateComponentDefs, validateLayoutWithComponents,
  type LayoutComponentDef, type ScreenLayout,
} from "@harmony/shared";
import {
  readScreenEntity, writeScreenItems, readProject,
  readLayoutComponents, upsertLayoutComponent, deleteLayoutComponent, findLayoutComponentUsages,
} from "../projectStorage.js";
import { wsBridge } from "../wsBridge.js";
import { workspaceContextManager } from "../workspaceState.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 画面 id の一覧 (遷移先の存在確認用)。読めなければ undefined (確認しない) */
async function screenIdsOf(root: string): Promise<Set<string> | undefined> {
  try {
    const project = (await readProject(root)) as { screens?: Array<{ id: string }> } | null;
    return project?.screens?.length ? new Set(project.screens.map((s) => s.id)) : undefined;
  } catch { return undefined; }
}

export const handleLayoutTool: ToolHandler = async (name, args, root, sessionId) => {
  const a = args ?? {};
  const wsId = () => workspaceContextManager.getActivePath(sessionId);

  switch (name) {
    case "designer__get_screen_layout": {
      assertEntityIdMcp(a.screenId, "screenId");
      const entity = await readScreenEntity(a.screenId, root);
      if (!isRecord(entity)) throw new McpError(ErrorCode.InvalidParams, `画面「${a.screenId}」が見つかりません`);
      const items = Array.isArray(entity.items) ? entity.items : [];
      const layout = (entity.layout ?? null) as ScreenLayout | null;
      const defs = (await readLayoutComponents(root)).components as unknown as LayoutComponentDef[];
      const issues = layout ? validateLayoutWithComponents(layout, items as Array<{ id: string }>, defs, await screenIdsOf(root)) : [];
      return json({ screenId: a.screenId, layout, items, issues });
    }

    case "designer__set_screen_layout": {
      assertEntityIdMcp(a.screenId, "screenId");
      const layout = a.layout as unknown;
      if (!isRecord(layout) || layout.version !== 1 || !Array.isArray(layout.nodes)) {
        throw new McpError(ErrorCode.InvalidParams, "layout は { version: 1, nodes: [...] } の形で指定してください");
      }
      const entity = await readScreenEntity(a.screenId, root);
      if (!isRecord(entity)) throw new McpError(ErrorCode.InvalidParams, `画面「${a.screenId}」が見つかりません`);
      const items = Array.isArray(a.items) ? a.items : (Array.isArray(entity.items) ? entity.items : []);
      await writeScreenItems(a.screenId, { screenId: a.screenId, items, layout }, root);
      wsBridge.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId: a.screenId } });
      wsBridge.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId: a.screenId } });
      const defs = (await readLayoutComponents(root)).components as unknown as LayoutComponentDef[];
      const issues = validateLayoutWithComponents(layout as unknown as ScreenLayout, items as Array<{ id: string }>, defs, await screenIdsOf(root));
      const counts = { error: 0, warning: 0, info: 0 };
      for (const i of issues) counts[i.severity]++;
      return json({ saved: true, screenId: a.screenId, counts, issues: issues.filter((i) => i.severity !== "info") });
    }

    case "designer__list_layout_components": {
      const defs = (await readLayoutComponents(root)).components as unknown as LayoutComponentDef[];
      const withUsage = await Promise.all(defs.map(async (d) => ({ ...d, usages: await findLayoutComponentUsages(d.id, root) })));
      return json({ components: withUsage, issues: validateComponentDefs(defs) });
    }

    case "designer__save_layout_component": {
      const c = a.component as unknown;
      if (!isRecord(c) || typeof c.id !== "string" || typeof c.label !== "string" || !Array.isArray(c.params) || !Array.isArray(c.nodes)) {
        throw new McpError(ErrorCode.InvalidParams, "component は { id, label, params, nodes } の形で指定してください");
      }
      assertEntityIdMcp(c.id, "component.id");
      const def = c as unknown as LayoutComponentDef;
      const others = (await readLayoutComponents(root)).components.filter((x) => x.id !== def.id) as unknown as LayoutComponentDef[];
      const issues = validateComponentDefs([...others, def]).filter((i) => i.componentId === def.id);
      const errors = issues.filter((i) => i.severity === "error");
      if (errors.length) {
        return { content: [{ type: "text", text: `エラーがあるため保存しませんでした:\n${errors.map((e) => `- ${e.message}`).join("\n")}` }], isError: true };
      }
      await upsertLayoutComponent(c as { id: string }, root);
      wsBridge.broadcast({ wsId: wsId(), event: "layoutComponentsChanged", data: { componentId: def.id } });
      return json({ saved: true, componentId: def.id, warnings: issues });
    }

    case "designer__delete_layout_component": {
      assertEntityIdMcp(a.componentId, "componentId");
      const res = await deleteLayoutComponent(a.componentId, root, a.force === true);
      if (res.deleted) wsBridge.broadcast({ wsId: wsId(), event: "layoutComponentsChanged", data: { componentId: a.componentId, deleted: true } });
      return json(res.deleted ? { deleted: true, usages: res.usages } : { deleted: false, reason: "使用中のため削除しませんでした。force: true で削除できます", usages: res.usages });
    }

    default:
      return null;
  }
};
