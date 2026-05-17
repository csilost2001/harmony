/**
 * Puck カスタムコンポーネント系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (3 ツール):
 * - designer__add_custom_puck_component
 * - designer__list_custom_puck_components
 * - designer__remove_custom_puck_component
 *
 * ファイル永続化 + puckComponentsChanged broadcast。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readPuckComponents, writePuckComponents } from "../projectStorage.js";
import { wsBridge } from "../wsBridge.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handlePuckComponentTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__add_custom_puck_component": {
      if (typeof a.id !== "string" || typeof a.label !== "string" || typeof a.primitive !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "id, label, primitive は必須です");
      }
      const components = (await readPuckComponents(root)) as Array<{ id: string }>;
      if (components.some((c) => c.id === a.id)) {
        throw new McpError(ErrorCode.InvalidParams, `id "${a.id}" は既に登録されています`);
      }
      const newDef = {
        id: a.id,
        label: a.label,
        primitive: a.primitive,
        propsSchema: (typeof a.propsSchema === "object" && a.propsSchema !== null) ? a.propsSchema : {},
      };
      components.push(newDef);
      await writePuckComponents(components, root);
      // puckComponentsChanged broadcast
      wsBridge.broadcast({ wsId: null, event: "puckComponentsChanged", data: {} });
      return {
        content: [
          {
            type: "text",
            text: `Puck カスタムコンポーネント「${a.label}」(${a.id}) を登録しました。`,
          },
        ],
      };
    }

    case "designer__list_custom_puck_components": {
      type PuckComponentEntry = { id: string; label: string; primitive: string; propsSchema?: Record<string, unknown> };
      const components = (await readPuckComponents(root)) as PuckComponentEntry[];
      if (components.length === 0) {
        return {
          content: [
            { type: "text", text: "Puck カスタムコンポーネントはまだ登録されていません。" },
          ],
        };
      }
      const lines = components.map(
        (c) =>
          `- ${c.id} — ${c.label} [primitive: ${c.primitive}]` +
          (c.propsSchema ? ` (${Object.keys(c.propsSchema).length} props)` : "")
      );
      return {
        content: [
          {
            type: "text",
            text: `Puck カスタムコンポーネント (${components.length}件):\n${lines.join("\n")}`,
          },
        ],
      };
    }

    case "designer__remove_custom_puck_component": {
      if (typeof a.id !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "id は必須です");
      }
      const allComponents = (await readPuckComponents(root)) as Array<{ id: string }>;
      const filtered = allComponents.filter((c) => c.id !== a.id);
      if (filtered.length === allComponents.length) {
        throw new McpError(ErrorCode.InvalidParams, `id "${a.id}" のコンポーネントが見つかりません`);
      }
      await writePuckComponents(filtered, root);
      wsBridge.broadcast({ wsId: null, event: "puckComponentsChanged", data: {} });
      return {
        content: [
          { type: "text", text: `Puck カスタムコンポーネント ${a.id} を削除しました。` },
        ],
      };
    }

    default:
      return null;
  }
};
