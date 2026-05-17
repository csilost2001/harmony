/**
 * カスタムブロック系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (3 ツール):
 * - designer__define_block
 * - designer__remove_custom_block
 * - designer__list_custom_blocks
 *
 * ブラウザ側 store にも反映されるため WS 経由が basic、list はファイル優先 fallback あり。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readCustomBlocks } from "../projectStorage.js";
import { wsBridge } from "../wsBridge.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handleCustomBlockTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__define_block": {
      if (
        typeof a.id !== "string" ||
        typeof a.label !== "string" ||
        typeof a.content !== "string"
      ) {
        throw new McpError(ErrorCode.InvalidParams, "id, label, content は必須です");
      }
      await wsBridge.sendCommand("defineBlock", {
        id: a.id,
        label: a.label,
        category: typeof a.category === "string" ? a.category : "カスタム",
        content: a.content,
        styles: typeof a.styles === "string" ? a.styles : undefined,
        media: typeof a.media === "string" ? a.media : undefined,
      });
      return {
        content: [
          {
            type: "text",
            text: `カスタムブロック「${a.label}」(${a.id}) を登録しました。`,
          },
        ],
      };
    }

    case "designer__remove_custom_block": {
      if (typeof a.id !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "id は必須です");
      }
      await wsBridge.sendCommand("removeCustomBlock", { id: a.id });
      return {
        content: [
          { type: "text", text: `カスタムブロック ${a.id} を削除しました。` },
        ],
      };
    }

    case "designer__list_custom_blocks": {
      // ファイルから直接読み込み。ファイルがない場合はブラウザ経由
      type BlockEntry = { id: string; label: string; category: string; styles?: string; hasStyles?: boolean };
      let blocks: BlockEntry[];
      const fileBlocks = (await readCustomBlocks(root)) as BlockEntry[];
      if (fileBlocks.length > 0) {
        blocks = fileBlocks.map((b) => ({ ...b, hasStyles: !!b.styles }));
      } else {
        const result = (await wsBridge.sendCommand("listCustomBlocks")) as {
          blocks: BlockEntry[];
        };
        blocks = result.blocks;
      }
      if (blocks.length === 0) {
        return {
          content: [
            { type: "text", text: "カスタムブロックはまだ定義されていません。" },
          ],
        };
      }
      const lines = blocks.map(
        (b) =>
          `- ${b.id} — ${b.label} [${b.category}]${b.hasStyles ? " (CSS付き)" : ""}`
      );
      return {
        content: [
          {
            type: "text",
            text: `カスタムブロック (${blocks.length}件):\n${lines.join("\n")}`,
          },
        ],
      };
    }

    default:
      return null;
  }
};
