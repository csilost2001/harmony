
/**
 * マーカー関連 MCP tool handler (#261 / #1509)
 *
 * 対象:
 * - designer__list_markers
 * - designer__find_all_markers
 * - designer__add_marker
 * - designer__resolve_marker
 * - designer__remove_marker
 *
 * どの設計 (処理フロー・画面・テーブル・ビュー・ビュー定義・シーケンス・ページレイアウト) にも、同じ形で付けられる。
 * 対象は `entityType` + `entityId` (処理フローは、従来どおり `processFlowId` だけでもよい)。
 * マーカーは、画面と同じ場所 (`authoring.markers`) を読み書きする。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  MARKER_ADDABLE_KINDS, MARKER_ENTITY_TYPES, addMarker, listMarkers, removeMarker, resolveMarker, type MarkerKind,
} from "@harmony/shared";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";
import { isMarkerEntityType, listMarkerDocs, readMarkerDoc, writeMarkerDoc, type MarkerEntityType } from "../markerStore.js";

/** 対象 (種類と id) を引数から読む。processFlowId だけなら処理フロー */
function targetOf(a: Record<string, unknown>): { type: MarkerEntityType; id: string } {
  if (a.entityType !== undefined && !isMarkerEntityType(a.entityType)) {
    throw new McpError(ErrorCode.InvalidParams, `entityType は ${MARKER_ENTITY_TYPES.join(" / ")} のどれかです`);
  }
  const type: MarkerEntityType = (a.entityType as MarkerEntityType | undefined) ?? "processFlow";
  const id = typeof a.entityId === "string" ? a.entityId : typeof a.processFlowId === "string" && type === "processFlow" ? a.processFlowId : undefined;
  if (id === undefined) {
    throw new McpError(ErrorCode.InvalidParams, type === "processFlow" ? "processFlowId (または entityId) は必須です" : "entityId は必須です");
  }
  // 設計の id は top-level EntityId (kebab-case)
  assertEntityIdMcp(id, type === "processFlow" && a.entityId === undefined ? "processFlowId" : "entityId");
  return { type, id };
}

async function loadDoc(type: MarkerEntityType, id: string, root: string) {
  const doc = await readMarkerDoc(type, id, root);
  if (!doc) throw new McpError(ErrorCode.InvalidParams, `${type} ${id} が見つかりません`);
  return doc;
}

export const handleMarkerTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__list_markers": {
      const { type, id } = targetOf(a);
      const doc = await loadDoc(type, id, root);
      const markers = listMarkers(doc, {
        unresolvedOnly: a.unresolvedOnly !== false, // 既定 true
        stepId: typeof a.stepId === "string" ? a.stepId : undefined,
        fieldPathPrefix: typeof a.fieldPathPrefix === "string" ? a.fieldPathPrefix : undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(markers, null, 2) }] };
    }

    case "designer__find_all_markers": {
      const unresolvedOnly = a.unresolvedOnly !== false; // 既定 true
      if (a.entityType !== undefined && !isMarkerEntityType(a.entityType)) {
        throw new McpError(ErrorCode.InvalidParams, `entityType は ${MARKER_ENTITY_TYPES.join(" / ")} のどれかです`);
      }
      const kind = typeof a.kind === "string" && (MARKER_ADDABLE_KINDS as readonly string[]).includes(a.kind) ? (a.kind as MarkerKind) : undefined;
      const results: Array<Record<string, unknown>> = [];
      for (const t of await listMarkerDocs(root, a.entityType as MarkerEntityType | undefined)) {
        for (const m of listMarkers(t.doc, { unresolvedOnly, kind })) {
          results.push({
            entityType: t.entityType, entityId: t.entityId, entityName: t.entityName,
            // 従来の呼び出し (処理フローだけ) との互換
            ...(t.entityType === "processFlow" ? { processFlowId: t.entityId, processFlowName: t.entityName } : {}),
            ...m,
          });
        }
      }
      return { content: [{ type: "text", text: JSON.stringify({ count: results.length, markers: results }, null, 2) }] };
    }

    case "designer__add_marker": {
      if (typeof a.kind !== "string" || typeof a.body !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "kind, body は必須です");
      }
      if (!(MARKER_ADDABLE_KINDS as readonly string[]).includes(a.kind)) {
        throw new McpError(ErrorCode.InvalidParams, `kind は ${MARKER_ADDABLE_KINDS.join(" / ")} のどれかです`);
      }
      const { type, id } = targetOf(a);
      const doc = await loadDoc(type, id, root);
      const m = addMarker(doc, {
        kind: a.kind as MarkerKind,
        body: a.body,
        stepId: typeof a.stepId === "string" ? a.stepId : undefined,
        fieldPath: typeof a.fieldPath === "string" ? a.fieldPath : undefined,
        author: (a.author === "human" || a.author === "ai") ? a.author : "ai",
      });
      await writeMarkerDoc(type, id, doc, root);
      return { content: [{ type: "text", text: `マーカーを追加しました (id: ${m.id})` }] };
    }

    case "designer__resolve_marker": {
      if (typeof a.markerId !== "string") throw new McpError(ErrorCode.InvalidParams, "markerId は必須です");
      const { type, id } = targetOf(a);
      const doc = await loadDoc(type, id, root);
      try {
        resolveMarker(doc, a.markerId, typeof a.resolution === "string" ? a.resolution : undefined);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
      await writeMarkerDoc(type, id, doc, root);
      return { content: [{ type: "text", text: `マーカー ${a.markerId} を解決しました。` }] };
    }

    case "designer__remove_marker": {
      if (typeof a.markerId !== "string") throw new McpError(ErrorCode.InvalidParams, "markerId は必須です");
      const { type, id } = targetOf(a);
      const doc = await loadDoc(type, id, root);
      try {
        removeMarker(doc, a.markerId);
      } catch (e) {
        throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
      }
      await writeMarkerDoc(type, id, doc, root);
      return { content: [{ type: "text", text: `マーカー ${a.markerId} を削除しました。` }] };
    }

    default:
      return null;
  }
};
