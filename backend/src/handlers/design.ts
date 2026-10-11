/**
 * 設計全体の点検・派生の MCP tool handler。
 *
 * - designer__check_design         設計の要確認事項 (設計書ビューと同じ検査) を返す。AI が設計を直したあとの確認用
 * - designer__get_test_viewpoints  テスト観点表 (画面入力の境界値・処理の分岐、ID つき)。テストコードを書く入力にする
 *
 * 仕様: docs/spec/design-document.md / docs/spec/test-viewpoints.md
 */
import { buildDesignDocument, deriveTestViewpointSheet, testViewpointSheetToCsv } from "@harmony/shared";
import { loadDesignInputFromRoot } from "../designInput.js";
import { findReferences } from "../references.js";
import { collectSchemaIssues } from "../schemaIssues.js";
import { assertEntityIdMcp } from "../mcpHelpers.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { RenameEntityType } from "../renameEntity.js";
import { runEntityRename, runEntityRenamePreview, runEntityUndo } from "../wsHandlers/refactor.js";
import { wsBridge } from "../wsBridge.js";
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
      const { issues } = buildDesignDocument({ ...input, extraIssues: await collectSchemaIssues(root) });
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
        issues: all.filter((i) => includeInfo || i.severity !== "info"),
      });
    }

    case "designer__get_test_viewpoints": {
      const { input } = await loadDesignInputFromRoot(root);
      const onlyScreens = asIds(a.screenIds), onlyFlows = asIds(a.flowIds);
      const pick = <T,>(items: T[], ids: string[], idOf: (x: T) => string) => (ids.length ? items.filter((x) => ids.includes(idOf(x))) : items);
      const sheet = deriveTestViewpointSheet({
        limits: input.limits, regex: input.regex, messages: input.messages,
        screens: pick(input.screens.filter((s) => s.purpose !== "gadget"), onlyScreens, (s) => s.id),
        flows: pick(input.flows, onlyFlows, (f) => f.meta.id),
      });
      if (a.format === "csv") return { content: [{ type: "text" as const, text: testViewpointSheetToCsv(sheet) }] };
      return json(sheet);
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

    case "designer__undo_rename": {
      if (typeof a.operationId !== "string" || !a.operationId) throw new McpError(ErrorCode.InvalidParams, "operationId を指定してください");
      const { result, broadcastReload } = await runEntityUndo(wsBridge, a.operationId, root, sessionId);
      broadcastReload();
      return json({ undone: true, ...result });
    }

    default:
      return null;
  }
};
