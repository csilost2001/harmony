/**
 * タブ管理 + 保存系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (6 ツール):
 * - designer__open_tab
 * - designer__close_tab
 * - designer__list_tabs
 * - designer__switch_tab
 * - designer__save_screen
 * - designer__save_all
 *
 * すべてブラウザ側 store へ WS コマンド転送。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { wsBridge } from "../wsBridge.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handleTabTool: ToolHandler = async (name, args) => {
  const a = args ?? {};

  switch (name) {
    case "designer__open_tab": {
      if (!a.screenId && !a.tableId) {
        throw new McpError(ErrorCode.InvalidParams, "screenId または tableId が必要です");
      }
      await wsBridge.sendCommand("openTab", {
        screenId: a.screenId,
        tableId: a.tableId,
      }) as { success: boolean };
      const target = a.screenId ? `画面 ${a.screenId}` : `テーブル ${a.tableId}`;
      return { content: [{ type: "text", text: `${target} をタブで開きました。` }] };
    }

    case "designer__close_tab": {
      if (typeof a.tabId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "tabId は必須です");
      }
      await wsBridge.sendCommand("closeTab", { tabId: a.tabId, force: a.force ?? false });
      return { content: [{ type: "text", text: `タブ ${a.tabId} を閉じました。` }] };
    }

    case "designer__list_tabs": {
      const result = await wsBridge.sendCommand("listTabs") as {
        tabs: Array<{ id: string; type: string; label: string; isDirty: boolean; isPinned: boolean; isActive: boolean }>;
        activeTabId: string;
      };
      const lines = result.tabs.map((t) =>
        `- [${t.isActive ? "●" : " "}] ${t.id} (${t.type}) — ${t.label}${t.isDirty ? " [未保存]" : ""}${t.isPinned ? " [ピン]" : ""}`
      );
      return {
        content: [{
          type: "text",
          text: lines.length > 0
            ? `開いているタブ (${lines.length}件):\n${lines.join("\n")}`
            : "開いているタブはありません。",
        }],
      };
    }

    case "designer__switch_tab": {
      if (typeof a.tabId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "tabId は必須です");
      }
      await wsBridge.sendCommand("switchTab", { tabId: a.tabId });
      return { content: [{ type: "text", text: `タブ ${a.tabId} に切り替えました。` }] };
    }

    case "designer__save_screen": {
      if (typeof a.screenId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId は必須です");
      }
      await wsBridge.sendCommand("saveScreen", { screenId: a.screenId });
      return { content: [{ type: "text", text: `画面 ${a.screenId} を保存しました。` }] };
    }

    case "designer__save_all": {
      const result = await wsBridge.sendCommand("saveAll") as {
        saved: number;
        total: number;
        results: Array<{ screenId: string; success: boolean; error?: string }>;
      };
      return {
        content: [{
          type: "text",
          text: `${result.total}件中${result.saved}件を保存しました。${
            result.results.filter((r) => !r.success).map((r) => `\nエラー(${r.screenId}): ${r.error}`).join("")
          }`,
        }],
      };
    }

    default:
      return null;
  }
};
