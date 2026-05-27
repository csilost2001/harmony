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
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";
import { isValidKind, isValidSafeName } from "../security/idValidator.js";
import {
  type DraftResourceType,
  VALID_RESOURCE_TYPES,
} from "../editSessionStore.js";

/**
 * #1374: resourceType allowlist 検証を WS handler と対称化する (#1372 派生)。
 *
 * 旧来 MCP handler は `typeof resourceType === "string"` だけで通過させており、tool schema
 * enum を無視する MCP client (= AI が enum 外の任意文字列を送ってくる場合) からは
 * 未知 resourceType + 非空 resourceId で invalid EditSession を作成できた。
 * WS handler 側は `VALID_RESOURCE_TYPES` allowlist + `assertResourceType` で守られていたため、
 * MCP 経路だけが抜け道になっていた。
 *
 * 本関数は WS handler (`backend/src/wsHandlers/editSession.ts:assertResourceType`) と
 * 同一の allowlist (editSessionStore.ts から共有 import) を用い、MCP convention に従って
 * `McpError(InvalidParams)` で reject する。
 */
function assertResourceTypeMcp(rt: unknown, label: string): DraftResourceType {
  if (typeof rt !== "string" || !VALID_RESOURCE_TYPES.has(rt as DraftResourceType)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `${label} は許可された resource type のいずれかである必要があります (got: ${JSON.stringify(rt)})`,
    );
  }
  return rt as DraftResourceType;
}

/**
 * #1332 Codex 10 巡目 M2: editSession__create / editSession__list の resourceId に
 * top-level entity EntityId 検証を導入する。
 *
 * resourceType 別の resourceId 検証ポリシー (editSessionService.ts:352-407 の write*
 * 経路と整合):
 * - top-level entity (`screen` / `table` / `process-flow` / `view` /
 *   `view-definition` / `page-layout` / `sequence`):
 *   → 直接 write 経路 (writeScreen / writeTable / ...) で渡されるため
 *     EntityId 検証必須 (RFC #1284 / S-002)。
 * - 副次 resource (`screen-item` / `puck-data`): resourceId は screenId 相当
 *   (EntityId)。`screen-item` は payload.screenId override 可能だが、
 *   create 時の resourceId は EntityId 規範。
 * - singleton / 別管理 (`flow` / `er-layout` / `extension` / `convention`):
 *   id は識別子相当 (singleton には fixed "default" 等が来る)。EntityId 強制を
 *   外し空文字のみ拒否。
 */
const TOP_LEVEL_RESOURCE_TYPES = new Set([
  "screen", "table", "process-flow", "view", "view-definition", "page-layout", "sequence",
]);

/** screenId 相当 (EntityId for screen) を持つ副次 resource。 */
const SCREEN_DERIVED_RESOURCE_TYPES = new Set(["screen-item", "puck-data"]);

/**
 * resourceType に応じた resourceId 検証。
 * 検証失敗時は McpError を throw する (caller は catch しない設計)。
 *
 * #1368 Codex Round 4 Should-fix: `generic-definition` は WS handler
 * (`backend/src/wsHandlers/editSession.ts:assertResourceId`) と同じ
 * `${kind}__${name}` composite 形式の decoded 検証を行い、AI/MCP 経路と
 * browser/WS 経路で validation 契約を揃える。
 */
function assertResourceIdForType(resourceType: string, resourceId: string): void {
  if (TOP_LEVEL_RESOURCE_TYPES.has(resourceType) || SCREEN_DERIVED_RESOURCE_TYPES.has(resourceType)) {
    assertEntityIdMcp(resourceId, "resourceId");
    return;
  }
  if (resourceType === "generic-definition") {
    // composite `${kind}__${name}` を decode して個別検証 (WS handler と同一契約)
    const sep = resourceId.indexOf("__");
    if (sep < 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `generic-definition resourceId は '\${kind}__\${name}' 形式である必要があります (got: ${JSON.stringify(resourceId)})`,
      );
    }
    const decodedKind = resourceId.slice(0, sep);
    const decodedName = resourceId.slice(sep + 2);
    if (!isValidKind(decodedKind)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `generic-definition resourceId の decoded kind が不正です: must match [a-z][a-z0-9:-]{0,63} (got: ${JSON.stringify(decodedKind)})`,
      );
    }
    if (!isValidSafeName(decodedName)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `generic-definition resourceId の decoded name が不正です: must match [A-Za-z0-9_-]{1,64} (got: ${JSON.stringify(decodedName)})`,
      );
    }
    return;
  }
  // singleton / 別管理 resource type は空文字のみ拒否
  if (resourceId.trim().length === 0) {
    throw new McpError(ErrorCode.InvalidParams, "resourceId は空文字にできません");
  }
}

export const handleEditSessionTool: ToolHandler = async (name, args, _root, sessionId) => {
  const a = args ?? {};

  switch (name) {
    case "editSession__create": {
      // #1374: resourceType allowlist 検証 (WS handler 対称化)。
      // 未知 resourceType を許すと invalid EditSession を作成できる抜け道になる。
      const validatedRt = assertResourceTypeMcp(a.resourceType, "resourceType");
      if (typeof a.resourceId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "resourceId は必須です");
      }
      // #1332 Codex 10 巡目 M2: resourceType に応じた resourceId 検証
      assertResourceIdForType(validatedRt, a.resourceId);
      const result = wsBridge.editSessionCreate(
        sessionId,
        validatedRt,
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
      // #1374: resourceType allowlist 検証 (WS handler 対称化)。
      // filter 用なので resourceType 未指定 (undefined) は許容、指定時は allowlist 必須。
      let validatedListRt: DraftResourceType | undefined;
      if (a.resourceType !== undefined) {
        validatedListRt = assertResourceTypeMcp(a.resourceType, "resourceType");
      }
      // #1332 Codex 10 巡目 M2: filter として resourceId が指定された場合は
      // resourceType と整合する検証を行う (create と同じポリシー)。
      // filter 用なので空文字は空 filter として弾かず undefined 化のみ。
      if (typeof a.resourceId === "string" && a.resourceId.length > 0) {
        if (validatedListRt !== undefined) {
          assertResourceIdForType(validatedListRt, a.resourceId);
        } else {
          // resourceType 未指定で resourceId のみ filter は通常用法ではないが許容、空文字のみ拒否
          // (resourceType 不明だと検証分岐できないため明示エラー)
          throw new McpError(
            ErrorCode.InvalidParams,
            "resourceId filter を使う場合は resourceType も指定してください",
          );
        }
      }
      const result = wsBridge.editSessionList(sessionId, {
        resourceType: validatedListRt,
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
