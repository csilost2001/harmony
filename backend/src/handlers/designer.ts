/**
 * デザイナーキャンバス系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (8 ツール):
 * - designer__get_html
 * - designer__set_components
 * - designer__screenshot
 * - designer__list_blocks
 * - designer__add_block
 * - designer__remove_element
 * - designer__update_element
 * - designer__set_theme
 *
 * すべてブラウザ側 GrapesJS への WS コマンド転送 (副作用 / fs IO なし)。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { wsBridge } from "../wsBridge.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handleDesignerTool: ToolHandler = async (name, args) => {
  const a = args ?? {};

  switch (name) {
    case "designer__get_html": {
      const result = (await wsBridge.sendCommand("getHtml")) as {
        html: string;
        css: string;
      };
      return {
        content: [
          {
            type: "text",
            text: `## HTML\n\`\`\`html\n${result.html}\n\`\`\`\n\n## CSS\n\`\`\`css\n${result.css}\n\`\`\``,
          },
        ],
      };
    }

    case "designer__set_components": {
      if (typeof a.html !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "html パラメータが必要です");
      }
      const html = a.html;
      await wsBridge.sendCommand("setComponents", { html });
      return {
        content: [
          {
            type: "text",
            text: "デザイナーのコンテンツを更新しました。",
          },
        ],
      };
    }

    case "designer__screenshot": {
      const result = (await wsBridge.sendCommand("screenshot")) as {
        png: string;
      };
      return {
        content: [
          {
            type: "image",
            data: result.png,
            mimeType: "image/png",
          },
        ],
      };
    }

    case "designer__list_blocks": {
      const result = (await wsBridge.sendCommand("listBlocks")) as {
        blocks: Array<{ id: string; label: string; category: string }>;
      };
      const lines = result.blocks.map(
        (b) => `- [${b.category}] ${b.id} — ${b.label}`
      );
      return {
        content: [
          {
            type: "text",
            text: `利用可能ブロック (${result.blocks.length}件):\n${lines.join("\n")}`,
          },
        ],
      };
    }

    case "designer__add_block": {
      if (typeof a.blockId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "blockId は必須です");
      }
      const result = (await wsBridge.sendCommand("addBlock", {
        blockId: a.blockId,
        targetId: typeof a.targetId === "string" ? a.targetId : undefined,
        position: typeof a.position === "string" ? a.position : undefined,
      })) as { addedId: string };
      return {
        content: [
          {
            type: "text",
            text: `ブロック ${a.blockId} を追加しました（新要素ID: ${result.addedId}）`,
          },
        ],
      };
    }

    case "designer__remove_element": {
      if (typeof a.id !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "id は必須です");
      }
      await wsBridge.sendCommand("removeElement", { id: a.id });
      return {
        content: [
          { type: "text", text: `要素 ${a.id} を削除しました。` },
        ],
      };
    }

    case "designer__update_element": {
      if (typeof a.id !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "id は必須です");
      }
      await wsBridge.sendCommand("updateElement", {
        id: a.id,
        attributes: a.attributes,
        style: a.style,
        text: a.text,
        classes: a.classes,
      });
      return {
        content: [
          { type: "text", text: `要素 ${a.id} を更新しました。` },
        ],
      };
    }

    case "designer__set_theme": {
      if (typeof a.theme !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "theme は必須です");
      }
      await wsBridge.sendCommand("setTheme", { theme: a.theme });
      return {
        content: [
          { type: "text", text: `テーマを ${a.theme} に切り替えました。` },
        ],
      };
    }

    default:
      return null;
  }
};
