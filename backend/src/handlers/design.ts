/**
 * 設計全体の点検・派生の MCP tool handler。
 *
 * - designer__check_design         設計の要確認事項 (設計書ビューと同じ検査) を返す。AI が設計を直したあとの確認用
 * - designer__get_test_viewpoints  テスト観点表 (画面入力の境界値・処理の分岐、ID つき)。テストコードを書く入力にする
 *
 * 仕様: docs/spec/design-document.md / docs/spec/test-viewpoints.md
 */
import {
  analyzeImpact, analyzeMessages, deriveSqlCatalog, findDuplicateSql, sqlCatalogToCsv, applySuppressions, buildDesignDocument, buildDesignGraph, buildOpenApi, localDate, checkExternalContracts, columnMapToCsv, deriveColumnMap, deriveJobs,
  deriveOperationMatrix, deriveSla, deriveTestViewpointSheet, deriveTraceability, findTermInconsistencies, findUnused, generateTestData, operationMatrixToCsv, overallTrend,
  scaffoldTests, slaToCsv, summarizeProgress, testDataTableToCsv, testDataToInsertSql, testViewpointSheetToCsv, traceabilityToCsv, usesPermissionModel,
  type NodeKind, type SqlQuote, type TestFramework,
} from "@harmony/shared";
import { loadDesignInputFromRoot, loadDesignInputFull } from "../designInput.js";
import { buildProjectContext } from "../projectContext.js";
import { changedFilesSince } from "./designInsight.js";
import { readProgressHistory } from "../progressStore.js";
import { findReferences } from "../references.js";
import { collectExtraIssues } from "../schemaIssues.js";
import { listEntityVersions, restoreEntityVersionToFile } from "../fileVersions.js";
import { persistDerivedUuids, repairRegistry } from "../workspaceHealth.js";
import { migrateWorkspace } from "../schemaMigration.js";
import { assertEntityIdMcp } from "../mcpHelpers.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { RenameEntityType } from "../renameEntity.js";
import { runEntityRename, runEntityRenamePreview, runEntityUndo, runReplace, runReplacePreview, runReplaceUndo } from "../wsHandlers/refactor.js";
import { wsBridge } from "../wsBridge.js";
import { addComment, emitNotify, generationStatus, recordGeneration, regenerationDiff } from "../ops/service.js";
import { commentsStore } from "../ops/stores.js";
import { OPS_ENTITY_KINDS } from "@harmony/shared";
import { workspaceContextManager } from "../workspaceState.js";
import type { ToolHandler } from "../mcpHelpers.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);

const RENAMEABLE: RenameEntityType[] = ["screen", "table", "processFlow", "sequence", "view", "viewDefinition", "pageLayout"];

export const handleDesignTool: ToolHandler = async (name, args, root, sessionId) => {
  const a = args ?? {};
  switch (name) {
    case "designer__check_design": {
      const { input, skipped, counts } = await loadDesignInputFromRoot(root);
      const { issues, suppression } = buildDesignDocument({ ...input, extraIssues: await collectExtraIssues(root) });
      const all = [
        ...skipped.map((s) => ({ severity: "error" as const, section: "読み込み", message: `${s} を読めない (または見つからない) ため、検査に含まれていません` })),
        ...issues,
      ];
      const sum = { error: 0, warning: 0, info: 0 };
      for (const i of all) sum[i.severity]++;
      const includeInfo = a.includeInfo === true;
      return json({
        project: input.project.name,
        counts,
        summary: sum,
        ok: sum.error === 0 && sum.warning === 0,
        // 理由つきで抑制している要確認の数 (抑制は設計の分析の画面か design-check.json で行う。AI が黙らせるための tool は無い)
        suppressed: suppression?.suppressed.length ?? 0,
        issues: all.filter((i) => includeInfo || i.severity !== "info"),
      });
    }

    case "designer__get_project_context": return json(await buildProjectContext(root, { limit: typeof a.limit === "number" ? a.limit : undefined }));

    case "designer__get_test_viewpoints": {
      const { input } = await loadDesignInputFromRoot(root);
      let onlyScreens = asIds(a.screenIds), onlyFlows = asIds(a.flowIds);
      // since: ある時刻より後に変わった画面・処理フローだけに絞る (変更の影響を受けるテスト観点だけを作り直すため)
      if (a.since !== undefined) {
        const ms = typeof a.since === "string" ? Date.parse(a.since) : NaN;
        if (!Number.isFinite(ms)) throw new McpError(ErrorCode.InvalidParams, "since は ISO の日時で指定してください (例: 2026-10-24T09:00:00+09:00)");
        const changed = await changedFilesSince(root, ms);
        const cs = new Set(changed.filter((c) => c.kind === "screen" || c.kind === "screenItems").map((c) => c.id.replace(/\.design$/, "")));
        const cf = new Set(changed.filter((c) => c.kind === "processFlow").map((c) => c.id));
        // 指定と変更の積。空になったら「該当なし」(空の配列は、下流で『絞らない』になるので、存在しない id を入れる)
        const none = ["\u0000none"];
        const inter = (given: string[], changedSet: Set<string>) => { const r = given.length ? given.filter((x) => changedSet.has(x)) : [...changedSet]; return r.length ? r : none; };
        onlyScreens = inter(onlyScreens, cs);
        onlyFlows = inter(onlyFlows, cf);
      }
      const pick = <T,>(items: T[], ids: string[], idOf: (x: T) => string) => (ids.length ? items.filter((x) => ids.includes(idOf(x))) : items);
      const sheet = deriveTestViewpointSheet({
        limits: input.limits, regex: input.regex, messages: input.messages,
        screens: pick(input.screens.filter((s) => s.purpose !== "gadget"), onlyScreens, (s) => s.id),
        flows: pick(input.flows, onlyFlows, (f) => f.meta.id),
      });
      if (a.format === "csv") return { content: [{ type: "text" as const, text: testViewpointSheetToCsv(sheet) }] };
      if (typeof a.scaffold === "string") {
        if (!["vitest", "jest", "playwright"].includes(a.scaffold)) throw new McpError(ErrorCode.InvalidParams, "scaffold は vitest / jest / playwright のどれかです");
        return json({ files: scaffoldTests(sheet, a.scaffold as TestFramework) });
      }
      return json(sheet);
    }

    case "designer__record_generation": return json(await recordGeneration(root, { outputs: Array.isArray(a.outputs) ? (a.outputs as never) : [] }));

    case "designer__check_generation_drift": {
      const { rows, problems } = await generationStatus(root);
      const stale = rows.filter((r) => r.state !== "current");
      return json({ ok: stale.length === 0 && problems.length === 0, total: rows.length, needsAttention: stale.length, problems, rows });
    }

    case "designer__get_regeneration_diff": return json({ diffs: await regenerationDiff(root, typeof a.path === "string" ? a.path : undefined) });

    case "designer__add_review_findings": {
      const list = Array.isArray(a.findings) ? (a.findings as Array<Record<string, unknown>>) : [];
      if (!list.length) throw new McpError(ErrorCode.InvalidParams, "findings (指摘の一覧) を指定してください");
      if (list.length > 50) throw new McpError(ErrorCode.InvalidParams, "一度に残せる指摘は 50 件までです");
      const existing = (await commentsStore.read(root)).value.threads.filter((t) => t.status === "open");
      const added: string[] = [], skipped: string[] = [];
      for (const f of list) {
        if (typeof f.message !== "string" || !f.message.trim()) throw new McpError(ErrorCode.InvalidParams, "指摘の message を書いてください");
        if (!OPS_ENTITY_KINDS.includes(f.kind as never) || typeof f.id !== "string") throw new McpError(ErrorCode.InvalidParams, `指摘の対象が正しくありません (kind: ${OPS_ENTITY_KINDS.join(" / ")})`);
        const path = typeof f.path === "string" ? f.path.trim() : "";
        // 同じ箇所に同じ内容の未解決の指摘があれば、重ねない
        if (existing.some((t) => t.target.kind === f.kind && t.target.id === f.id && (t.target.path ?? "") === path && t.messages[0]?.text === f.message)) { skipped.push(`${String(f.kind)} ${f.id}`); continue; }
        const r = await addComment(root, "AI", { target: { kind: f.kind, id: f.id, ...(path ? { path } : {}) }, text: f.message, ai: true, source: "ai-review", severity: f.severity, notify: false });
        added.push(r.threadId);
      }
      // 通知は、指摘ごとではなく、件数だけの 1 通 (登録済みの「コメント」の通知先へ。コメントの文は送らない)
      if (added.length) emitNotify(root, { event: "comment", title: `AI レビューの指摘が ${added.length} 件ありました`, lines: ["「連携と運用」の「レビューと承認」で確認してください"] });
      return json({ added: added.length, skippedDuplicates: skipped.length, threadIds: added });
    }

    case "designer__list_review_comments": {
      const status = a.status === "resolved" || a.status === "all" ? a.status : "open";
      const threads = (await commentsStore.read(root)).value.threads.filter((t) => (status === "all" || t.status === status) && (typeof a.kind !== "string" || t.target.kind === a.kind) && (typeof a.id !== "string" || t.target.id === a.id));
      return json({ total: threads.length, threads });
    }

    case "designer__analyze_design": return analyzeDesign(a, root);

    case "designer__export_openapi": {
      const { input } = await loadDesignInputFromRoot(root);
      return json(buildOpenApi(input, { ...(typeof a.title === "string" ? { title: a.title } : {}), ...(typeof a.version === "string" ? { version: a.version } : {}) }));
    }

    case "designer__generate_test_data": {
      const { input } = await loadDesignInputFromRoot(root);
      const tableIds = asIds(a.tableIds);
      const unknown = tableIds.filter((id) => !input.tables.some((t) => t.id === id));
      if (unknown.length) throw new McpError(ErrorCode.InvalidParams, `見つからないテーブル: ${unknown.join(", ")}`);
      const res = generateTestData(input, {
        ...(tableIds.length ? { tableIds } : {}), ...(typeof a.rowsPerTable === "number" ? { rowsPerTable: a.rowsPerTable } : {}),
        ...(typeof a.seed === "number" ? { seed: a.seed } : {}), nulls: a.nulls === true,
      });
      if (a.format === "sql") return { content: [{ type: "text" as const, text: testDataToInsertSql(res, (["mysql", "sqlserver"].includes(String(a.dialect)) ? a.dialect : "standard") as SqlQuote) }] };
      if (a.format === "csv") {
        if (res.tables.length !== 1) throw new McpError(ErrorCode.InvalidParams, "csv は tableIds でテーブルを 1 つに絞ってください");
        return { content: [{ type: "text" as const, text: testDataTableToCsv(res.tables[0]) }] };
      }
      return json(res);
    }

    case "designer__find_references": {
      const types: RenameEntityType[] = ["screen", "table", "processFlow", "sequence", "view", "viewDefinition", "pageLayout"];
      if (!types.includes(a.entityType as RenameEntityType)) {
        throw new McpError(ErrorCode.InvalidParams, `entityType は ${types.join(" / ")} のどれかです`);
      }
      assertEntityIdMcp(a.id, "id");
      return json(await findReferences(a.entityType as RenameEntityType, a.id as string, root));
    }

    case "designer__rename_entity": {
      const et = a.entityType as RenameEntityType;
      if (!RENAMEABLE.includes(et)) throw new McpError(ErrorCode.InvalidParams, `entityType は ${RENAMEABLE.join(" / ")} のどれかです`);
      assertEntityIdMcp(a.oldId, "oldId");
      assertEntityIdMcp(a.newId, "newId");
      const wsId = workspaceContextManager.getActivePath(sessionId);
      const preview = await runEntityRenamePreview(wsBridge, wsId, et, a.oldId as string, a.newId as string, root, sessionId);
      const blockers = [
        ...(!preview.oldExists ? [`${a.oldId} が見つかりません`] : []),
        ...(!preview.uniqueOk ? [`${a.newId} は既に使われています`] : []),
        ...(preview.lockedByOther ? ["ほかの人・AI がこの設計を編集中です"] : []),
        ...(preview.concurrentEditRefs.length ? [`参照している設計を編集中のセッションがあります: ${preview.concurrentEditRefs.map((c) => `${c.entityKind}:${c.entityId}`).join(", ")}`] : []),
        ...(preview.ambiguousDependencies.length ? ["同名の別の設計が参照されていて、どちらを指すか決められません"] : []),
        ...(preview.positionsCollisions.length ? [`図の座標に旧 ID と新 ID が両方あります: ${preview.positionsCollisions.join(", ")}`] : []),
      ];
      const summary = {
        entityType: et, oldId: a.oldId, newId: a.newId,
        fileRenames: preview.fileRenames, totalRefs: preview.totalRefs,
        // 参照している設計 (業務フロー・帳票・画面フローを含む)
        references: (await findReferences(et, a.oldId as string, root)).referrers.map((r) => `${r.kind}:${r.id}`),
        warnings: preview.warnings, blockers,
      };
      if (a.apply !== true) return json({ applied: false, ...summary, note: "予行です。実行するには apply: true を付けて、もう一度呼んでください" });
      if (blockers.length) return json({ applied: false, ...summary, note: "止める理由があるため実行しませんでした" });
      const { result, broadcastReload } = await runEntityRename(wsBridge, wsId, et, a.oldId as string, a.newId as string, root, sessionId);
      broadcastReload();
      return json({
        applied: true, ...summary,
        operation: { operationId: result.operation.operationId, undoTtlMs: result.operation.undoTtlMs },
        undo: "戻す場合は designer__undo_rename に operation.operationId を渡す (一定時間のみ)",
      });
    }

    case "designer__replace_references": {
      const et = a.entityType as RenameEntityType;
      if (!RENAMEABLE.includes(et)) throw new McpError(ErrorCode.InvalidParams, `entityType は ${RENAMEABLE.join(" / ")} のどれかです`);
      assertEntityIdMcp(a.fromId, "fromId");
      assertEntityIdMcp(a.toId, "toId");
      const only = Array.isArray(a.referrers) ? (a.referrers as unknown[]).filter((x): x is string => typeof x === "string") : undefined;
      if (only && only.some((p) => p.includes("..") || p.startsWith("/"))) throw new McpError(ErrorCode.InvalidParams, "referrers は、dataRoot からの相対パスで指定してください");
      const wsId = workspaceContextManager.getActivePath(sessionId);
      const preview = await runReplacePreview(wsBridge, wsId, et, a.fromId as string, a.toId as string, root, sessionId, only);
      const blockers = [
        ...(!preview.fromExists ? [`${a.fromId} が見つかりません`] : []),
        ...(!preview.toExists ? [`付け替え先の ${a.toId} が見つかりません`] : []),
        ...(a.fromId === a.toId ? ["付け替え元と付け替え先が同じです"] : []),
        ...(preview.concurrentEditRefs.length ? [`参照元を編集中のセッションがあります: ${preview.concurrentEditRefs.map((c) => `${c.entityKind}:${c.entityId}`).join(", ")}`] : []),
        ...(preview.files.length === 0 ? ["付け替える参照が見つかりません"] : []),
      ];
      const summary = { entityType: et, fromId: a.fromId, toId: a.toId, files: preview.files, totalRefs: preview.totalRefs, warnings: preview.warnings, blockers };
      if (a.apply !== true) return json({ applied: false, ...summary, note: "予行です。実行するには、referrers で参照元を選び、apply: true を付けて、もう一度呼んでください" });
      if (!only || only.length === 0) return json({ applied: false, ...summary, note: "apply: true のときは、付け替える参照元を referrers で選んでください" });
      if (blockers.length) return json({ applied: false, ...summary, note: "止める理由があるため実行しませんでした" });
      const { result, broadcastReload } = await runReplace(wsBridge, wsId, et, a.fromId as string, a.toId as string, root, sessionId, only);
      broadcastReload();
      return json({ applied: true, ...summary, operationId: result.operationId, undoTtlMs: result.undoTtlMs, undo: "戻す場合は designer__undo_replace_references に operationId を渡す (5 分以内)" });
    }

    case "designer__undo_replace_references": {
      if (typeof a.operationId !== "string" || !a.operationId) throw new McpError(ErrorCode.InvalidParams, "operationId を指定してください");
      const wsId = workspaceContextManager.getActivePath(sessionId);
      const { result, broadcastReload } = await runReplaceUndo(wsBridge, wsId, a.operationId, root);
      broadcastReload();
      return json({ undone: true, ...result });
    }

    case "designer__undo_rename": {
      if (typeof a.operationId !== "string" || !a.operationId) throw new McpError(ErrorCode.InvalidParams, "operationId を指定してください");
      const { result, broadcastReload } = await runEntityUndo(wsBridge, a.operationId, root, sessionId);
      broadcastReload();
      return json({ undone: true, ...result });
    }

    case "designer__list_versions": {
      assertEntityIdMcp(a.id, "id");
      return json({ versions: await listEntityVersions(root, String(a.resourceType), a.id as string) });
    }

    case "designer__restore_version": {
      assertEntityIdMcp(a.id, "id");
      if (typeof a.versionId !== "string" || !a.versionId) throw new McpError(ErrorCode.InvalidParams, "versionId を指定してください");
      const wsId = workspaceContextManager.getActivePath(sessionId);
      // ほかの人・AI が編集中の設計に書き戻すと、その人の保存で巻き戻される。編集セッションがあるあいだは書き戻さない
      if (wsId) {
        const sessions = wsBridge.editSessionListByResource(wsId, String(a.resourceType) as never, a.id as string);
        if (sessions.some((s) => s.state === "Active")) {
          throw new McpError(ErrorCode.InvalidRequest, `${a.id} は編集中のセッションがあるため、書き戻せません。編集を保存または破棄してからにしてください`);
        }
      }
      const res = await restoreEntityVersionToFile(root, String(a.resourceType), a.id as string, a.versionId);
      const ev = ({ "table": "tableChanged", "process-flow": "processFlowChanged", "view": "viewChanged", "view-definition": "viewDefinitionChanged", "sequence": "sequenceChanged", "business-flow": "businessFlowChanged", "report": "reportChanged", "page-layout": "pageLayoutChanged" } as Record<string, string>)[String(a.resourceType)];
      const idField = ({ "table": "tableId", "process-flow": "processFlowId", "view": "viewId", "view-definition": "viewDefinitionId", "sequence": "sequenceId", "business-flow": "flowId", "report": "reportId", "page-layout": "pageLayoutId" } as Record<string, string>)[String(a.resourceType)];
      if (ev) wsBridge.broadcast({ wsId, event: ev, data: { [idField]: a.id } });
      return json({ restored: true, ...res, note: "書き戻す前の内容も版として残しています (designer__list_versions)" });
    }

    case "designer__repair_registry": {
      const plan = await repairRegistry(root, a.apply === true);
      if (plan.applied) wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "projectChanged", data: { reload: true } });
      return json({ ...plan, note: plan.applied ? "一覧を直しました" : "予行です。実行するには apply: true を付けて、もう一度呼んでください" });
    }

    case "designer__migrate_schema": {
      const apply = a.apply === true;
      if (apply) {
        // 移行は複数の設計を書き換える。編集中の画面が古い内容で上書き保存して、移行を巻き戻さないようにする
        const active = (wsBridge.editSessionList(sessionId).sessions as Array<{ state?: string }>).filter((s) => s.state === "Active");
        if (active.length) throw new McpError(ErrorCode.InvalidRequest, `編集中のセッションが ${active.length} 件あるため、移行を実行できません。編集を保存または破棄してからにしてください`);
      }
      const report = await migrateWorkspace(root, { apply });
      if (report.applied) wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "projectChanged", data: { reload: true } });
      return json({ ...report, note: report.migrations.length === 0 ? "移行は不要です (スキーマの版は最新です)" : report.applied ? "移行しました" : "予行です。実行するには apply: true を付けて、もう一度呼んでください" });
    }

    case "designer__persist_uuids": {
      const res = await persistDerivedUuids(root, a.apply === true);
      if (res.applied) wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "projectChanged", data: { reload: true } });
      return json({ ...res, note: res.applied ? "uuid を固定しました" : "予行です。実行するには apply: true を付けて、もう一度呼んでください" });
    }

    default:
      return null;
  }
};

const NODE_KINDS = ["screen", "processFlow", "table", "businessFlow", "report", "component", "message", "regex", "limit", "genericDefinition"];

/** 設計の分析 (読み取りのみ)。画面と同じ shared の関数で計算する */
async function analyzeDesign(a: Record<string, unknown>, root: string) {
  const { input } = await loadDesignInputFull(root);
  const csv = a.format === "csv";
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  switch (a.kind) {
    case "impact": {
      if (!NODE_KINDS.includes(String(a.entityType))) throw new McpError(ErrorCode.InvalidParams, `entityType は ${NODE_KINDS.join(" / ")} のどれかです`);
      // 設計 (画面・テーブルなど) は kebab-case の ID。メッセージ・正規表現・上限値の鍵と、汎用定義 (種類/名前) は、安全な文字だけ
      if (["screen", "processFlow", "table", "businessFlow", "report", "component"].includes(String(a.entityType))) assertEntityIdMcp(a.id, "id");
      else if (typeof a.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.\-/]{0,127}$/.test(a.id) || a.id.includes("..")) throw new McpError(ErrorCode.InvalidParams, "id は、英数字・_ . - / だけの 128 文字までで指定してください");
      return json(analyzeImpact(input, a.entityType as NodeKind, a.id as string, typeof a.column === "string" ? { column: a.column } : {}));
    }
    case "traceability": { const r = deriveTraceability(input); return csv ? text(traceabilityToCsv(r)) : json(r); }
    case "unused": return json({ items: findUnused(input) });
    case "terms": return json({ issues: findTermInconsistencies(input) });
    case "column-map": { const r = deriveColumnMap(input); return csv ? text(columnMapToCsv(r)) : json(r); }
    case "messages": return json(analyzeMessages(input));
    case "sql": { const entries = deriveSqlCatalog(input); return csv ? text(sqlCatalogToCsv(entries)) : json({ entries, duplicates: findDuplicateSql(entries).map((d) => ({ sql: d.sql, count: d.entries.length, crossFlow: d.crossFlow, at: d.entries.map((e) => ({ flow: e.flow.id, action: e.action.id, stepId: e.stepId })) })) }); }
    case "operations": {
      const m = deriveOperationMatrix(input);
      return csv ? text(operationMatrixToCsv(m, (id) => input.roles?.[id]?.name ?? id)) : json({ ...m, permissionModel: usesPermissionModel(input) });
    }
    case "sla": { const rows = deriveSla(input); return csv ? text(slaToCsv(rows)) : json({ rows }); }
    case "jobs": return json({ jobs: deriveJobs(input) });
    case "external": return json({ systems: checkExternalContracts(input) });
    case "progress": {
      const summary = summarizeProgress(input);
      const history = await readProgressHistory(root); // 読み取りでは記録しない (記録は画面を開いたとき)
      return json({ summary, history, trend: overallTrend(history) });
    }
    case "suppressions": {
      const { issues } = buildDesignDocument({ ...input, extraIssues: await collectExtraIssues(root), checkSettings: { version: 1, rules: input.checkSettings?.rules ?? [], suppressions: [] } });
      const { status } = applySuppressions(issues, input.checkSettings?.suppressions ?? [], localDate());
      return json(status);
    }
    default: throw new McpError(ErrorCode.InvalidParams, "kind が正しくありません");
  }
}
