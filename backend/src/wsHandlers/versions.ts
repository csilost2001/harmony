/**
 * 保存前の版 (上書きされる前のファイルの内容) と、ワークスペースの保守の RPC。
 * 仕様: docs/spec/file-backup.md / docs/spec/workspace-health.md
 */
import { listEntityVersions, locateEntityFile, readEntityVersion } from "../fileVersions.js";
import { persistDerivedUuids, repairRegistry, scanWorkspaceHealth } from "../workspaceHealth.js";
import type { RpcHandlerMap } from "./types.js";

export const versionHandlers: RpcHandlerMap = {
  /** 設計 1 件の、保存前の版の一覧 (新しい順) */
  "fileVersions.list": async ({ params, root, respond, respondError }) => {
    const { resourceType, resourceId } = (params ?? {}) as { resourceType?: string; resourceId?: string };
    try { respond({ versions: await listEntityVersions(root(), String(resourceType), String(resourceId)) }); }
    catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  /** 保存前の版の内容 (画面の編集状態へ読み込む用。読むだけで、原本は変わらない) */
  "fileVersions.get": async ({ params, root, respond, respondError }) => {
    const { resourceType, resourceId, versionId } = (params ?? {}) as { resourceType?: string; resourceId?: string; versionId?: string };
    try { respond({ snapshot: await readEntityVersion(root(), String(resourceType), String(resourceId), String(versionId)) }); }
    catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  /** 設計 1 件の原本ファイルの場所 (相対・絶対)。読むだけ */
  "fileVersions.locate": async ({ params, root, respond, respondError }) => {
    const { resourceType, resourceId } = (params ?? {}) as { resourceType?: string; resourceId?: string };
    try { respond(await locateEntityFile(root(), String(resourceType), String(resourceId))); }
    catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  /** ファイルの健全性の全件 (保守の案内を含む)。読むだけ。ダッシュボードの保守ボタンの出し分けに使う */
  "workspace.getHealth": async ({ root, respond, respondError }) => {
    try { respond({ issues: await scanWorkspaceHealth(root()) }); }
    catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  /** 一覧 (harmony.json) とファイルの食い違いを直す。apply が true のときだけ書く */
  "workspace.repairRegistry": async ({ params, root, wsId, respond, respondError, bridge }) => {
    try {
      const apply = (params as { apply?: unknown } | undefined)?.apply === true;
      const plan = await repairRegistry(root(), apply);
      if (plan.applied) bridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } });
      respond(plan);
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  /** uuid が未保存の設計に、読み出しで補っている値を書いて固定する。apply が true のときだけ書く */
  "workspace.persistUuids": async ({ params, root, wsId, respond, respondError, bridge }) => {
    try {
      const apply = (params as { apply?: unknown } | undefined)?.apply === true;
      const res = await persistDerivedUuids(root(), apply);
      if (res.applied) bridge.broadcast({ wsId: wsId(), event: "projectChanged", data: { reload: true } });
      respond(res);
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },
};
