/**
 * 画面項目 ID リネーム系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (4 ツール):
 * - designer__rename_screen_item
 * - designer__check_screen_item_refs
 * - designer__get_rename_context
 * - designer__apply_rename_mapping
 *
 * renameScreenItem.ts / renameContext.ts のラッパ + processFlow / screen broadcast。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import {
  renameScreenItemId,
  checkScreenItemRefs,
  updateProcessFlowRefs,
} from "../renameScreenItem.js";
import {
  getRenameContext,
  applyRenameMapping,
} from "../renameContext.js";
import { wsBridge } from "../wsBridge.js";
import { workspaceContextManager } from "../workspaceState.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handleScreenItemTool: ToolHandler = async (name, args, root, sessionId) => {
  const a = args ?? {};

  switch (name) {
    case "designer__rename_screen_item": {
      if (typeof a.screenId !== "string" || typeof a.oldId !== "string" || typeof a.newId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId, oldId, newId は必須です");
      }
      const renameRes = await renameScreenItemId(a.screenId, a.oldId, a.newId, root);
      wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "screenItemsChanged", data: { screenId: a.screenId } });
      for (const agId of renameRes.processFlowsUpdated) {
        wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "processFlowChanged", data: { id: agId } });
      }
      if (renameRes.screenHtmlUpdated) {
        wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "screenChanged", data: { screenId: a.screenId } });
      }
      const lines = [
        `"${a.oldId}" → "${a.newId}" のリネームが完了しました。`,
        `  - screen-items: 更新済み`,
        `  - 画面 HTML: ${renameRes.screenHtmlUpdated ? "更新済み" : "変更なし"}`,
        `  - 処理フロー: ${renameRes.processFlowsUpdated.length} 件更新 (参照 ${renameRes.refsRenamed} 箇所)`,
      ];
      if (renameRes.warnings.length > 0) {
        lines.push(...renameRes.warnings.map((w) => `  ⚠ ${w}`));
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "designer__check_screen_item_refs": {
      if (typeof a.screenId !== "string" || typeof a.itemId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId, itemId は必須です");
      }
      const checkRes = await checkScreenItemRefs(a.screenId, a.itemId, root);
      if (checkRes.totalRefs === 0) {
        return { content: [{ type: "text", text: `"${a.itemId}" を参照する処理フローはありません。` }] };
      }
      const lines = [
        `"${a.itemId}" を参照する処理フロー: ${checkRes.affectedProcessFlows.length} 件 (合計 ${checkRes.totalRefs} 箇所)`,
        ...checkRes.affectedProcessFlows.map((ag) => `  - ${ag.name} (${ag.id}): ${ag.refCount} 箇所`),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    case "designer__get_rename_context": {
      if (typeof a.screenId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId は必須です");
      }
      const ctx = await getRenameContext(a.screenId, root);
      const summary = [
        `画面 ${a.screenId} の未命名項目: ${ctx.unnamedItems.length} 件 (命名済み: ${ctx.namedCount} 件)`,
      ];
      return {
        content: [{
          type: "text",
          text: summary.join("\n") + "\n\n" + JSON.stringify(ctx, null, 2),
        }],
      };
    }

    case "designer__apply_rename_mapping": {
      if (typeof a.screenId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId は必須です");
      }
      if (!a.mapping || typeof a.mapping !== "object" || Array.isArray(a.mapping)) {
        throw new McpError(ErrorCode.InvalidParams, "mapping は {oldId: newId} オブジェクトが必須です");
      }
      const mapping = a.mapping as Record<string, string>;

      // browser-first: ブラウザで in-memory 適用を試みる
      const browserResult = await wsBridge.tryCommand("applyRenameInBrowser", {
        screenId: a.screenId,
        mapping,
      }) as { succeeded: string[]; failed: Array<{ oldId: string; error: string }> } | null;

      if (browserResult) {
        // ブラウザ側で適用済み → process flow refs のみファイル更新
        const { processFlowsUpdated } = await updateProcessFlowRefs(a.screenId, mapping, root);
        for (const agId of processFlowsUpdated) {
          wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "processFlowChanged", data: { id: agId } });
        }
        // screenChanged / screenItemsChanged は broadcast しない (browser dirty、ファイルは古いまま)

        const lines: string[] = [
          `リネーム完了 (browser): 成功 ${browserResult.succeeded.length} 件 / 失敗 ${browserResult.failed.length} 件`,
          `処理フロー参照更新: ${processFlowsUpdated.length} 件`,
        ];
        for (const oldId of browserResult.succeeded) {
          lines.push(`  ✓ "${oldId}" → "${mapping[oldId]}"`);
        }
        for (const f of browserResult.failed) {
          lines.push(`  ✗ "${f.oldId}": ${f.error}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // fallback: 従来のファイル全書き
      const result = await applyRenameMapping(a.screenId, mapping, root);

      if (result.succeeded.length > 0) {
        wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "screenItemsChanged", data: { screenId: a.screenId } });
        const allAgs = new Set(result.succeeded.flatMap((s) => s.processFlowsUpdated));
        for (const agId of allAgs) {
          wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "processFlowChanged", data: { id: agId } });
        }
        if (result.succeeded.some((s) => s.screenHtmlUpdated)) {
          wsBridge.broadcast({ wsId: workspaceContextManager.getActivePath(sessionId), event: "screenChanged", data: { screenId: a.screenId } });
        }
      }

      const lines: string[] = [
        `リネーム完了: 成功 ${result.succeeded.length} 件 / 失敗 ${result.failed.length} 件`,
      ];
      for (const s of result.succeeded) {
        const warn = s.warnings.length > 0 ? ` ⚠ ${s.warnings.join(" ")}` : "";
        lines.push(`  ✓ "${s.oldId}" → "${s.newId}" (処理フロー参照 ${s.refsRenamed} 箇所)${warn}`);
      }
      for (const f of result.failed) {
        lines.push(`  ✗ "${f.oldId}" → "${f.newId}": ${f.error}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    default:
      return null;
  }
};
