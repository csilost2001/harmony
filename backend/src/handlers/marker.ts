/**
 * マーカー関連 MCP tool handler (#261)
 *
 * 対象:
 * - designer__list_markers
 * - designer__find_all_markers
 * - designer__add_marker
 * - designer__resolve_marker
 * - designer__remove_marker
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readProcessFlow, listProcessFlows as listProcessFlowFiles } from "../projectStorage.js";
import {
  listMarkers as editListMarkers,
  findAllMarkers as editFindAllMarkers,
  addMarker as editAddMarker,
  resolveMarker as editResolveMarker,
  removeMarker as editRemoveMarker,
  type ProcessFlowDoc,
} from "../processFlowEdits.js";
import { saveAndBroadcast, type ToolHandler } from "../mcpHelpers.js";

export const handleMarkerTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__list_markers": {
      if (typeof a.processFlowId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId は必須です");
      }
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      const markers = editListMarkers(ag, {
        unresolvedOnly: a.unresolvedOnly !== false, // 既定 true
        stepId: typeof a.stepId === "string" ? a.stepId : undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(markers, null, 2) }] };
    }

    case "designer__find_all_markers": {
      const unresolvedOnly = a.unresolvedOnly !== false; // 既定 true
      const kindFilter = typeof a.kind === "string"
        ? (a.kind as "chat" | "attention" | "todo" | "question")
        : undefined;
      const agList = await listProcessFlowFiles(root) as Array<{ id: string; name: string }>;
      const loaded: Array<{ id: string; name: string; ag: ProcessFlowDoc }> = [];
      for (const meta of agList) {
        const ag = await readProcessFlow(meta.id, root) as ProcessFlowDoc | null;
        if (ag) loaded.push({ id: meta.id, name: meta.name, ag });
      }
      const results = editFindAllMarkers(loaded, { unresolvedOnly, kind: kindFilter });
      return { content: [{ type: "text", text: JSON.stringify({ count: results.length, markers: results }, null, 2) }] };
    }

    case "designer__add_marker": {
      if (typeof a.processFlowId !== "string" || typeof a.kind !== "string" || typeof a.body !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, kind, body は必須です");
      }
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      const m = editAddMarker(ag, {
        kind: a.kind as "chat" | "attention" | "todo" | "question",
        body: a.body as string,
        stepId: typeof a.stepId === "string" ? a.stepId : undefined,
        fieldPath: typeof a.fieldPath === "string" ? a.fieldPath : undefined,
        author: (a.author === "human" || a.author === "ai") ? a.author : "ai",
      });
      await saveAndBroadcast(a.processFlowId, ag, root);
      return { content: [{ type: "text", text: `マーカーを追加しました (id: ${m.id})` }] };
    }

    case "designer__resolve_marker": {
      if (typeof a.processFlowId !== "string" || typeof a.markerId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, markerId は必須です");
      }
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      try {
        editResolveMarker(ag, a.markerId as string, typeof a.resolution === "string" ? a.resolution : undefined);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
      await saveAndBroadcast(a.processFlowId, ag, root);
      return { content: [{ type: "text", text: `マーカー ${a.markerId} を解決しました。` }] };
    }

    case "designer__remove_marker": {
      if (typeof a.processFlowId !== "string" || typeof a.markerId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "processFlowId, markerId は必須です");
      }
      const ag = await readProcessFlow(a.processFlowId, root) as ProcessFlowDoc | null;
      if (!ag) throw new McpError(ErrorCode.InvalidParams, `処理フロー ${a.processFlowId} が見つかりません`);
      try {
        editRemoveMarker(ag, a.markerId as string);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
      await saveAndBroadcast(a.processFlowId, ag, root);
      return { content: [{ type: "text", text: `マーカー ${a.markerId} を削除しました。` }] };
    }

    default:
      return null;
  }
};
