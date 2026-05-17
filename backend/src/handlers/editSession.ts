/**
 * EditSession 系 MCP tool handler (#1144 Phase-1、#906 機能の MCP 露出)。
 *
 * 対象 (10 ツール):
 * - editSession__create
 * - editSession__attach_as_view
 * - editSession__detach
 * - editSession__set_role
 * - editSession__transfer_edit
 * - editSession__update
 * - editSession__save
 * - editSession__discard
 * - editSession__list
 * - editSession__fetch_payload
 *
 * すべて wsBridge の公開 API への薄い adapter (WS handler と同一実装を共有)。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { wsBridge } from "../wsBridge.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handleEditSessionTool: ToolHandler = async (name, args, _root, sessionId) => {
  const a = args ?? {};

  switch (name) {
    case "editSession__create": {
      if (typeof a.resourceType !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "resourceType は必須です");
      }
      if (typeof a.resourceId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "resourceId は必須です");
      }
      const result = wsBridge.editSessionCreate(
        sessionId,
        a.resourceType as Parameters<typeof wsBridge.editSessionCreate>[1],
        a.resourceId,
        typeof a.displayLabel === "string" ? a.displayLabel : undefined,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__attach_as_view": {
      if (typeof a.editSessionId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "editSessionId は必須です");
      }
      const result = wsBridge.editSessionAttachAsView(
        sessionId,
        a.editSessionId,
        typeof a.displayLabel === "string" ? a.displayLabel : undefined,
        typeof a.parentHumanSessionId === "string" ? a.parentHumanSessionId : undefined,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__detach": {
      if (typeof a.editSessionId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "editSessionId は必須です");
      }
      const result = wsBridge.editSessionDetach(sessionId, a.editSessionId);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__set_role": {
      if (typeof a.editSessionId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "editSessionId は必須です");
      }
      if (a.role !== "Edit" && a.role !== "View") {
        throw new McpError(ErrorCode.InvalidParams, "role は \"Edit\" または \"View\" である必要があります");
      }
      const result = wsBridge.editSessionSetRole(sessionId, a.editSessionId, a.role);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__transfer_edit": {
      if (typeof a.editSessionId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "editSessionId は必須です");
      }
      const result = wsBridge.editSessionTransferEdit(sessionId, a.editSessionId);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__update": {
      if (typeof a.editSessionId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "editSessionId は必須です");
      }
      if (!("payload" in a)) {
        throw new McpError(ErrorCode.InvalidParams, "payload は必須です");
      }
      const result = wsBridge.editSessionUpdate(sessionId, a.editSessionId, a.payload);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__save": {
      if (typeof a.editSessionId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "editSessionId は必須です");
      }
      const stage = a.stage;
      if (stage !== undefined && stage !== "checkOnly" && stage !== "commit") {
        throw new McpError(ErrorCode.InvalidParams, "stage は \"checkOnly\" または \"commit\" である必要があります");
      }
      const result = await wsBridge.editSessionSave(sessionId, a.editSessionId, {
        force: typeof a.force === "boolean" ? a.force : undefined,
        stage,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__discard": {
      if (typeof a.editSessionId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "editSessionId は必須です");
      }
      const result = await wsBridge.editSessionDiscard(sessionId, a.editSessionId);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__list": {
      const result = wsBridge.editSessionList(sessionId, {
        resourceType: typeof a.resourceType === "string"
          ? (a.resourceType as Parameters<typeof wsBridge.editSessionList>[1] extends { resourceType?: infer R } ? R : never)
          : undefined,
        resourceId: typeof a.resourceId === "string" ? a.resourceId : undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    case "editSession__fetch_payload": {
      if (typeof a.editSessionId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "editSessionId は必須です");
      }
      const result = wsBridge.editSessionFetchPayload(sessionId, a.editSessionId);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    default:
      return null;
  }
};
