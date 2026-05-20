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
 * 機能不変 — case body は一字一句変更なし。
 */
import type { DraftResourceType as EditSessionResourceType } from "../editSessionStore.js";
import { assertSafeName, assertHistoryId } from "../security/idValidator.js";
import type { RpcHandlerMap } from "./types.js";

const VALID_RESOURCE_TYPES = new Set<EditSessionResourceType>([
  "screen", "puck-data", "table", "process-flow", "view", "view-definition",
  "page-layout", "screen-item", "sequence", "extension", "convention", "flow", "er-layout",
]);

function assertResourceType(rt: unknown, label: string): EditSessionResourceType {
  if (typeof rt !== "string" || !VALID_RESOURCE_TYPES.has(rt as EditSessionResourceType)) {
    throw new Error(`Invalid ${label}: unknown resource type (got ${JSON.stringify(rt)})`);
  }
  return rt as EditSessionResourceType;
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
      assertSafeName(esRid, "resourceId");
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
      if (esLstRt !== undefined) assertResourceType(esLstRt, "resourceType");
      if (esLstRid !== undefined) assertSafeName(esLstRid, "resourceId");
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
      assertResourceType(esLhRt, "resourceType");
      assertSafeName(esLhRid, "resourceId");
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
