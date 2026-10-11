/**
 * Project / Screen / プロジェクト独自部品 系 RPC handler (#1144 Phase-2)。
 *
 * - loadProject / saveProject
 * - loadScreen (旧形式デザインの読み取り専用) / loadScreenEntity / saveScreenEntity / deleteScreen
 * - loadLayoutComponents / saveLayoutComponent / deleteLayoutComponent / findLayoutComponentUsages
 * - listBusinessFlows / loadBusinessFlow / saveBusinessFlow / deleteBusinessFlow
 * - listReports / loadReport / saveReport / deleteReport
 *
 * 旧エディタ (GrapesJS / Puck) の廃止に伴い、デザイン本体・Puck データ・カスタムブロックの
 * 書き込み系は無い (docs/plans/redesign-2026-10.md)。
 */
import { collectSchemaIssues } from "../schemaIssues.js";
import {
  writeProject,
  listExistingEntityIds,
  readScreen,
  readScreenEntity,
  writeScreenEntity,
  deleteScreen as deleteScreenFile,
  readLayoutComponents,
  upsertLayoutComponent,
  deleteLayoutComponent,
  findLayoutComponentUsages,
  readBusinessFlow,
  listBusinessFlowsDetailed,
  writeBusinessFlow,
  deleteBusinessFlow,
  readReport,
  listReportsDetailed,
  writeReport,
  deleteReport,
} from "../projectStorage.js";
import { assertEntityId } from "../security/idValidator.js";
import { readProjectWithUnregistered } from "../registryMerge.js";
import { searchDesign } from "../designSearch.js";
import { recentEdits } from "../recentEdits.js";
import { loadDesignInputFromRoot } from "../designInput.js";
import type { RpcHandlerMap } from "./types.js";

export const projectHandlers: RpcHandlerMap = {
  loadProject: async ({ root, respond }) => {
    // 一覧に載っていない設計 (手で置いたファイル等) も、一覧に出す (書き込まない。次に保存したときに一覧へ書かれる)
    respond((await readProjectWithUnregistered(root())).project);
  },

  saveProject: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { project } = (params ?? {}) as { project: unknown };
    await writeProject(project, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "projectChanged", data: {}, excludeClientId: clientId });
  },

  /** 旧形式 (廃止した GrapesJS) の画面デザインを読む。旧デザインからの自動変換の入力に使う (書き込みは無い) */
  loadScreen: async ({ params, root, respond }) => {
    const { screenId } = (params ?? {}) as { screenId: string };
    assertEntityId(screenId, "screenId");
    const data = await readScreen(screenId, root());
    respond(data);
  },

  /** 全画面の実体を、まとめて返す (一覧画面の検査用。1 件ずつ尋ねると、件数だけ往復する)。読めなかったものは含めない */
  loadAllScreenEntities: async ({ root, respond }) => {
    const r = root();
    const out: unknown[] = [];
    for (const id of (await listExistingEntityIds("screen", r)).sort()) {
      const e = await readScreenEntity(id, r).catch(() => null);
      if (e) out.push(e);
    }
    respond(out);
  },

  /** 最近編集した設計 (画面・テーブル・処理フロー) を、更新時刻の新しい順に返す (ダッシュボード用。1 回の問い合わせで済ませる) */
  recentEdits: async ({ params, root, respond, respondError }) => {
    const { limit } = (params ?? {}) as { limit?: number };
    try { respond({ items: await recentEdits(root(), typeof limit === "number" ? Math.min(Math.max(limit, 1), 50) : 10) }); }
    catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  /** 設計書・検査の入力を、まとめて読んで返す (設計ごとの問い合わせの往復をなくす)。スキーマ違反の要確認も含める */
  loadDesignInput: async ({ root, respond, respondError }) => {
    try {
      const { input, skipped } = await loadDesignInputFromRoot(root());
      respond({ input: { ...input, extraIssues: await collectSchemaIssues(root()) }, skipped });
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  /** 設計の本文検索 (クイックオープン用)。説明・カラム名・項目のラベル・工程の説明などから探す。書き込まない */
  searchDesign: async ({ params, root, respond, respondError }) => {
    const { query, limit } = (params ?? {}) as { query?: string; limit?: number };
    try { respond({ hits: await searchDesign(root(), typeof query === "string" ? query.slice(0, 200) : "", typeof limit === "number" ? Math.min(limit, 100) : 30) }); }
    catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  /** 設計の原本のスキーマ違反 (要確認)。読み込み時に計算して返す。原本は書き換えない */
  getSchemaIssues: async ({ root, respond, respondError }) => {
    try { respond(await collectSchemaIssues(root())); } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  loadScreenEntity: async ({ params, root, respond }) => {
    const { screenId } = (params ?? {}) as { screenId: string };
    assertEntityId(screenId, "screenId");
    const data = await readScreenEntity(screenId, root());
    respond(data);
  },

  saveScreenEntity: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { screenId, data } = (params ?? {}) as { screenId: string; data: unknown };
    assertEntityId(screenId, "screenId");
    await writeScreenEntity(screenId, data, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "screenEntityChanged", data: { screenId }, excludeClientId: clientId });
    bridge.broadcast({ wsId: wsId(), event: "screenItemsChanged", data: { screenId }, excludeClientId: clientId });
  },

  deleteScreen: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { screenId } = (params ?? {}) as { screenId: string };
    assertEntityId(screenId, "screenId");
    await deleteScreenFile(screenId, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "screenChanged", data: { screenId, deleted: true }, excludeClientId: clientId });
  },

  loadLayoutComponents: async ({ root, respond }) => {
    respond(await readLayoutComponents(root()));
  },

  saveLayoutComponent: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { component } = (params ?? {}) as { component?: { id?: unknown } };
    if (!component || typeof component !== "object") throw new Error("component が指定されていません");
    assertEntityId(component.id, "component.id");
    await upsertLayoutComponent(component as { id: string }, root());
    respond({ success: true });
    bridge.broadcast({ wsId: wsId(), event: "layoutComponentsChanged", data: { componentId: component.id }, excludeClientId: clientId });
  },

  deleteLayoutComponent: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { componentId, force } = (params ?? {}) as { componentId: string; force?: boolean };
    assertEntityId(componentId, "componentId");
    const result = await deleteLayoutComponent(componentId, root(), force === true);
    respond(result);
    if (result.deleted) bridge.broadcast({ wsId: wsId(), event: "layoutComponentsChanged", data: { componentId, deleted: true }, excludeClientId: clientId });
  },

  findLayoutComponentUsages: async ({ params, root, respond }) => {
    const { componentId } = (params ?? {}) as { componentId: string };
    assertEntityId(componentId, "componentId");
    respond(await findLayoutComponentUsages(componentId, root()));
  },

  listBusinessFlows: async ({ root, respond }) => {
    respond(await listBusinessFlowsDetailed(root()));
  },

  loadBusinessFlow: async ({ params, root, respond }) => {
    const { flowId } = (params ?? {}) as { flowId: string };
    assertEntityId(flowId, "flowId");
    respond(await readBusinessFlow(flowId, root()));
  },

  saveBusinessFlow: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { flowId, data, expectedUpdatedAt, createOnly } = (params ?? {}) as { flowId: string; data: unknown; expectedUpdatedAt?: string; createOnly?: boolean };
    assertEntityId(flowId, "flowId");
    const saved = await writeBusinessFlow(flowId, data, root(), { expectedUpdatedAt, createOnly });
    respond(saved);
    bridge.broadcast({ wsId: wsId(), event: "businessFlowChanged", data: { flowId }, excludeClientId: clientId });
  },

  deleteBusinessFlow: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { flowId } = (params ?? {}) as { flowId: string };
    assertEntityId(flowId, "flowId");
    const deleted = await deleteBusinessFlow(flowId, root());
    respond({ success: deleted });
    if (deleted) bridge.broadcast({ wsId: wsId(), event: "businessFlowChanged", data: { flowId, deleted: true }, excludeClientId: clientId });
  },

  listReports: async ({ root, respond }) => {
    respond(await listReportsDetailed(root()));
  },

  loadReport: async ({ params, root, respond }) => {
    const { reportId } = (params ?? {}) as { reportId: string };
    assertEntityId(reportId, "reportId");
    respond(await readReport(reportId, root()));
  },

  saveReport: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { reportId, data, expectedUpdatedAt, createOnly } = (params ?? {}) as { reportId: string; data: unknown; expectedUpdatedAt?: string; createOnly?: boolean };
    assertEntityId(reportId, "reportId");
    const saved = await writeReport(reportId, data, root(), { expectedUpdatedAt, createOnly });
    respond(saved);
    bridge.broadcast({ wsId: wsId(), event: "reportChanged", data: { reportId }, excludeClientId: clientId });
  },

  deleteReport: async ({ params, root, wsId, clientId, respond, bridge }) => {
    const { reportId } = (params ?? {}) as { reportId: string };
    assertEntityId(reportId, "reportId");
    const deleted = await deleteReport(reportId, root());
    respond({ success: deleted });
    if (deleted) bridge.broadcast({ wsId: wsId(), event: "reportChanged", data: { reportId, deleted: true }, excludeClientId: clientId });
  },
};
