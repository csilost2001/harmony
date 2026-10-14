/**
 * 設計全体の検索置換の RPC。
 *
 * - designReplace.preview   探す語に合う、置換できる文言の一覧 (何も書かない)
 * - designReplace.apply     選んだものを置換する (編集中の設計は飛ばす)。取り消し用の operationId を返す
 * - designReplace.undo      直前の置換を取り消す (30 分以内。置換のあとで変えられたファイルは戻さない)
 * - designReplace.listUndo  取り消せる置換の一覧 (画面を開き直したあとの復元用)
 */
import {
  applyReplace, findReplaceUndoRoot, listReplaceUndo, previewReplace, undoReplace,
  type BlockedCheck, type ReplaceKind, type ReplaceOptions, type ReplaceSelection,
} from "../designReplace.js";
import type { DraftResourceType } from "../editSessionStore.js";
import type { WsBridge } from "../wsBridge.js";
import { assertSafeName } from "../security/idValidator.js";
import { RENAME_RELOAD_EVENTS } from "./refactor.js";
import type { RpcHandlerMap } from "./types.js";

const RESOURCE_TYPE: Record<ReplaceKind, DraftResourceType> = {
  "screen": "screen-item", "table": "table", "process-flow": "process-flow", "business-flow": "business-flow", "report": "report",
  "sequence": "sequence", "view": "view", "view-definition": "view-definition", "page-layout": "page-layout", "generic-definition": "generic-definition",
};

/** 設計が編集中 (誰かが編集モードで開いている) なら、その理由。置換は、あとの保存で巻き戻されるので、自分の編集中も含めて飛ばす */
function blockedCheck(bridge: WsBridge, wsId: string | null): BlockedCheck {
  return (kind, id) => {
    if (!wsId) return null;
    const sessions = bridge.editSessionListByResource(wsId, RESOURCE_TYPE[kind], id);
    for (const es of sessions) {
      if (es.state !== "Active") continue;
      for (const [, p] of es.participants) if (p.role === "Edit") return "編集中のため (保存か破棄をしてから置換してください)";
    }
    return null;
  };
}

/** 登録簿 (harmony.json) を、画面フローの編集セッションが持っているか。あれば、一覧に映る名前の置換は、あとの保存で巻き戻る */
function registryBlockedReason(bridge: WsBridge, wsId: string | null): string | null {
  if (!wsId) return null;
  for (const es of bridge.editSessionListByResource(wsId, "flow", "singleton")) {
    if (es.state !== "Active") continue;
    for (const [, p] of es.participants) if (p.role === "Edit") return "画面フローを編集中のため、一覧に映る名前は置換できません (保存か破棄をしてから)";
  }
  return null;
}

function readOptions(params: unknown): ReplaceOptions {
  const p = (params ?? {}) as Record<string, unknown>;
  return {
    query: typeof p.query === "string" ? p.query : "",
    replacement: typeof p.replacement === "string" ? p.replacement : "",
    caseSensitive: p.caseSensitive === true,
  };
}

const KIND_TO_EVENT: Record<ReplaceKind, string> = {
  "screen": "screenChanged", "table": "tableChanged", "process-flow": "processFlowChanged", "business-flow": "businessFlowChanged", "report": "reportChanged",
  "sequence": "sequenceChanged", "view": "viewChanged", "view-definition": "viewDefinitionChanged", "page-layout": "pageLayoutChanged", "generic-definition": "genericDefinitionChanged",
};

export const replaceHandlers: RpcHandlerMap = {
  "designReplace.preview": async ({ params, root, wsId, respond, respondError, bridge }) => {
    try { respond(await previewReplace(root(), readOptions(params), blockedCheck(bridge, wsId()))); }
    catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  "designReplace.apply": async ({ params, root, wsId, respond, respondError, bridge }) => {
    try {
      const selected = ((params ?? {}) as { selected?: unknown }).selected;
      const res = await applyReplace(root(), readOptions(params), Array.isArray(selected) ? (selected as ReplaceSelection[]) : [], blockedCheck(bridge, wsId()), registryBlockedReason(bridge, wsId()));
      respond(res);
      // 応答のあとで通知する。開いている画面が古い文言のまま保存して、置換を巻き戻さないよう、起点のクライアントにも届ける
      if (res.files > 0) {
        const kinds = new Set(res.touched.map((t) => KIND_TO_EVENT[t.kind]));
        for (const ev of RENAME_RELOAD_EVENTS) bridge.broadcast({ wsId: wsId(), event: ev, data: { reload: true } });
        bridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } }); // 一覧が読む登録簿 (harmony.json)
        for (const ev of kinds) bridge.broadcast({ wsId: wsId(), event: ev, data: { reload: true } });
      }
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  "designReplace.undo": async ({ params, root, wsId, respond, respondError, bridge }) => {
    try {
      const { operationId } = (params ?? {}) as { operationId?: unknown };
      assertSafeName(operationId, "operationId");
      // 置換したワークスペースは、サーバが覚えている記録から解く (画面から渡されたパスは使わない)
      const opRoot = findReplaceUndoRoot(operationId as string) ?? root();
      const res = await undoReplace(opRoot, operationId as string);
      respond(res);
      if (res.restored > 0) {
        for (const ev of RENAME_RELOAD_EVENTS) bridge.broadcast({ wsId: wsId(), event: ev, data: { reload: true } });
        bridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } });
      }
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  "designReplace.listUndo": async ({ root, respond, respondError }) => {
    try { respond(listReplaceUndo(root())); } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },
};
