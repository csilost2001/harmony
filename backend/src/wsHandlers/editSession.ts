/**
 * EditSession 系 RPC handler (#1144 Phase-2 — #899 / meta #897 Phase 2)。
 *
 * 旧 wsBridge.ts `_handleBrowserRequest` switch から以下 11 RPC method を分離:
 * - editSession.create / attachAsView / detach / setRole / transferEdit
 * - editSession.update / save / discard / list / fetchPayload
 * - editSession.listHistory / restoreFromHistory
 *
 * spec docs/spec/edit-session-protocol.md §14 / §15.1 に準拠。
 * 各 handler は wsBridge の公開 API (editSession*) を adapter として呼び出す。
 *
 * #1368 Round 3: resourceType 別の resourceId 検証 (`assertResourceId`) を新設し、
 * `generic-definition` の `${kind}__${name}` composite (最大 130 chars) を decode して
 * 個別検証する分岐を追加。それ以外の resource type は従来通り `assertSafeName` 適用。
 */
import type { DraftResourceType as EditSessionResourceType } from "../editSessionStore.js";
import { assertSafeName, assertHistoryId, assertKind } from "../security/idValidator.js";
import type { RpcHandlerMap } from "./types.js";

const VALID_RESOURCE_TYPES = new Set<EditSessionResourceType>([
  "screen", "puck-data", "table", "process-flow", "view", "view-definition",
  "page-layout", "screen-item", "sequence", "extension", "convention", "flow", "er-layout",
  // #1368: GenericDefinition EditSession 統合 — frontend GenericDefinitionEditor が
  // `editSession.create` に `resourceType: "generic-definition"` を送るため allowlist に追加。
  // editSessionStore.ts DraftResourceType と同期 (#1331 で追加済)。
  "generic-definition",
]);

function assertResourceType(rt: unknown, label: string): EditSessionResourceType {
  if (typeof rt !== "string" || !VALID_RESOURCE_TYPES.has(rt as EditSessionResourceType)) {
    throw new Error(`Invalid ${label}: unknown resource type (got ${JSON.stringify(rt)})`);
  }
  return rt as EditSessionResourceType;
}

/**
 * #1368 Round 3: resourceType 別の resourceId validation。
 *
 * 多くの resource type (screen / table / process-flow / view 等) は resourceId が
 * `[A-Za-z0-9_-]{1,64}` の単体 id なので `assertSafeName` で十分。
 *
 * 一方 `generic-definition` の resourceId は frontend で `${kind}/${name}` の `/` を
 * `__` 置換した composite `${kind}__${name}` 形式 (assertSafeName が `/` を許容しないため)。
 * 合計長は最大 64 (kind) + 2 (`__`) + 64 (name) = 130 chars に達し、assertSafeName の
 * 64 char 上限を超えるため、合成 ID 全体に `assertSafeName` を掛けると schema-valid な
 * 長い name が reject される (Codex Round 3 Must-fix)。
 *
 * `generic-definition` のみ `__` で分割して decoded kind / name を個別に
 * `assertKind` / `assertSafeName` で検証する。
 */
function assertResourceId(
  resourceType: EditSessionResourceType,
  resourceId: unknown,
  label: string,
): string {
  if (typeof resourceId !== "string") {
    throw new Error(`Invalid ${label}: must be string (got ${typeof resourceId})`);
  }
  if (resourceType === "generic-definition") {
    const sep = resourceId.indexOf("__");
    if (sep < 0) {
      throw new Error(
        `Invalid ${label}: generic-definition resourceId must be '\${kind}__\${name}' (got ${JSON.stringify(resourceId)})`,
      );
    }
    assertKind(resourceId.slice(0, sep), `${label} (decoded kind)`);
    assertSafeName(resourceId.slice(sep + 2), `${label} (decoded name)`);
    return resourceId;
  }
  return assertSafeName(resourceId, label);
}

export const editSessionHandlers: RpcHandlerMap = {
  "editSession.create": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionCreate を adapter として呼ぶ (MCP tool と共有)
    const {
      resourceType: esRt,
      resourceId: esRid,
      displayLabel: esLabel,
    } = (params ?? {}) as {
      resourceType: EditSessionResourceType;
      resourceId: string;
      displayLabel?: string;
    };
    try {
      const validatedRt = assertResourceType(esRt, "resourceType");
      assertResourceId(validatedRt, esRid, "resourceId");
      const result = bridge.editSessionCreate(clientId, validatedRt, esRid, esLabel);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.attachAsView": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionAttachAsView を adapter として呼ぶ
    const {
      editSessionId: esAvId,
      displayLabel: esAvLabel,
      parentHumanSessionId: esAvParent,
    } = (params ?? {}) as {
      editSessionId: string;
      displayLabel?: string;
      parentHumanSessionId?: string;
    };
    try {
      assertSafeName(esAvId, "editSessionId");
      const result = bridge.editSessionAttachAsView(clientId, esAvId, esAvLabel, esAvParent);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.detach": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionDetach を adapter として呼ぶ
    const { editSessionId: esDtId } = (params ?? {}) as { editSessionId: string };
    try {
      assertSafeName(esDtId, "editSessionId");
      const result = bridge.editSessionDetach(clientId, esDtId);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.setRole": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionSetRole を adapter として呼ぶ
    const {
      editSessionId: esRoleId,
      role: esNewRole,
    } = (params ?? {}) as { editSessionId: string; role: "Edit" | "View" };
    try {
      assertSafeName(esRoleId, "editSessionId");
      const result = bridge.editSessionSetRole(clientId, esRoleId, esNewRole);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.transferEdit": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionTransferEdit を adapter として呼ぶ
    // (caller = take-over 実行者 = new Edit holder; fromSessionId は participants から自動検索)
    const { editSessionId: esTrId } = (params ?? {}) as { editSessionId: string; toSessionId?: string };
    try {
      assertSafeName(esTrId, "editSessionId");
      const result = bridge.editSessionTransferEdit(clientId, esTrId);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.update": async ({ params, clientId, respond, respondError, bridge }) => {
    // opaque envelope: payload は server で解釈しない (Forward-Compat 原則 ①)
    // #906: 公開 API editSessionUpdate を adapter として呼ぶ
    const {
      editSessionId: esUpId,
      payload: esUpPayload,
    } = (params ?? {}) as { editSessionId: string; payload: unknown };
    try {
      assertSafeName(esUpId, "editSessionId");
      const result = bridge.editSessionUpdate(clientId, esUpId, esUpPayload);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.save": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionSave を adapter として呼ぶ (#912 stage パラメータ含む)
    const { editSessionId: esSvId, force, stage } = (params ?? {}) as {
      editSessionId: string;
      force?: boolean;
      stage?: "checkOnly" | "commit";
    };
    try {
      assertSafeName(esSvId, "editSessionId");
      const result = await bridge.editSessionSave(clientId, esSvId, { force, stage });
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.discard": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionDiscard を adapter として呼ぶ
    const { editSessionId: esDiscId } = (params ?? {}) as { editSessionId: string };
    try {
      assertSafeName(esDiscId, "editSessionId");
      const result = await bridge.editSessionDiscard(clientId, esDiscId);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.list": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionList を adapter として呼ぶ
    const {
      resourceType: esLstRt,
      resourceId: esLstRid,
    } = (params ?? {}) as { resourceType?: EditSessionResourceType; resourceId?: string };
    try {
      let validatedRt: EditSessionResourceType | undefined;
      if (esLstRt !== undefined) validatedRt = assertResourceType(esLstRt, "resourceType");
      if (esLstRid !== undefined) {
        // #1368 Round 3: rt 既知なら resource-specific validation、未知なら safe-name fallback
        if (validatedRt !== undefined) {
          assertResourceId(validatedRt, esLstRid, "resourceId");
        } else {
          assertSafeName(esLstRid, "resourceId");
        }
      }
      const result = bridge.editSessionList(clientId, { resourceType: esLstRt, resourceId: esLstRid });
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.fetchPayload": async ({ params, clientId, respond, respondError, bridge }) => {
    // #906: 公開 API editSessionFetchPayload を adapter として呼ぶ
    const { editSessionId: esFpId } = (params ?? {}) as { editSessionId: string };
    try {
      assertSafeName(esFpId, "editSessionId");
      const result = bridge.editSessionFetchPayload(clientId, esFpId);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.listHistory": async ({ params, clientId, respond, respondError, bridge }) => {
    // #893: DraftHistory 一覧を返す
    const {
      resourceType: esLhRt,
      resourceId: esLhRid,
    } = (params ?? {}) as { resourceType: string; resourceId: string };
    try {
      const validatedLhRt = assertResourceType(esLhRt, "resourceType");
      // #1368 Round 3: resource-specific validation で long composite generic-definition も accept
      assertResourceId(validatedLhRt, esLhRid, "resourceId");
      const result = await bridge.editSessionListHistory(clientId, esLhRt, esLhRid);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },

  "editSession.restoreFromHistory": async ({ params, clientId, respond, respondError, bridge }) => {
    // #893: 履歴から新規 EditSession を作成して返す
    const {
      historyId: esRhId,
      displayLabel: esRhLabel,
    } = (params ?? {}) as { historyId: string; displayLabel?: string };
    try {
      // SH-ITER2-001: historyId は "<ISO-timestamp>--<sessionId-prefix>-<rand>" 形式。
      // assertHistoryId で path separator / ".." を含む文字列を早期 reject する。
      assertHistoryId(esRhId, "historyId");
      const result = await bridge.editSessionRestoreFromHistory(clientId, esRhId, esRhLabel);
      respond(result);
    } catch (e) {
      respondError(e instanceof Error ? e.message : String(e));
    }
  },
};
