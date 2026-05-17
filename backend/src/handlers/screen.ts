/**
 * 画面 (Screen) 系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (5 ツール):
 * - designer__list_screens
 * - designer__add_screen
 * - designer__update_screen
 * - designer__remove_screen
 * - designer__export_screen
 *
 * harmony.json `entities.screens[]` の参照 + ブラウザ WS への CRUD 委譲。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readProject } from "../projectStorage.js";
import { wsBridge } from "../wsBridge.js";
import { htmlToReact, toPascalCase } from "../reactExporter.js";
import type { ToolHandler } from "../mcpHelpers.js";

export const handleScreenTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__list_screens": {
      // RFC #1021 pl-6 (Codex D-6): purpose filter 対応 + v3 entities.screens を優先読み込み
      const purposeFilter = a.purpose === "page" || a.purpose === "gadget" ? a.purpose as "page" | "gadget" : undefined;

      // v3 project の entities.screens から読み込み (purpose / pageLayoutId 含む)
      const fileProject = await readProject(root) as { entities?: { screens?: Array<{ id: string; name: string; kind?: string; purpose?: string; path?: string; pageLayoutId?: string; hasDesign?: boolean }> } } | null;
      // v3 形式 (entities.screens)
      let v3Screens = fileProject?.entities?.screens;
      if (!v3Screens) {
        // 旧形式の fallback (test fixture 等)
        const legacy = fileProject as { screens?: Array<{ id: string; name: string; type?: string; kind?: string; purpose?: string; path?: string; pageLayoutId?: string; hasDesign?: boolean }> } | null;
        v3Screens = legacy?.screens;
      }
      if (!v3Screens) {
        // ブラウザ経由 fallback (purpose 情報なし)
        const result = (await wsBridge.sendCommand("listScreens")) as {
          screens: Array<{ id: string; name: string; type: string; path: string; hasDesign: boolean }>;
        };
        v3Screens = result.screens.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.type,
          path: s.path,
          hasDesign: s.hasDesign,
        }));
      }
      const filtered = purposeFilter
        ? (v3Screens ?? []).filter((s) => {
            const p = (s.purpose ?? "page");
            return p === purposeFilter;
          })
        : (v3Screens ?? []);
      const lines = filtered.map((s) => {
        const purposeBadge = s.purpose === "gadget" ? " [gadget]" : "";
        const plBadge = s.pageLayoutId ? ` [layout:${s.pageLayoutId.slice(0, 8)}]` : "";
        const designBadge = s.hasDesign ? " ✓デザイン済み" : "";
        const kindOrType = s.kind ?? (s as { type?: string }).type ?? "other";
        const pathPart = s.path ? ` [${s.path}]` : "";
        return `- ${s.id}  ${s.name} (${kindOrType})${pathPart}${purposeBadge}${plBadge}${designBadge}`;
      });
      const header = purposeFilter
        ? `画面一覧 (purpose=${purposeFilter} のみ、${filtered.length}件):`
        : `画面一覧 (${filtered.length}件):`;
      return {
        content: [{
          type: "text",
          text: lines.length > 0 ? `${header}\n${lines.join("\n")}` : "画面はまだ登録されていません。",
        }],
      };
    }

    case "designer__add_screen": {
      if (typeof a.name !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "name は必須です");
      }
      const result = (await wsBridge.sendCommand("addScreen", {
        name: a.name,
        type: typeof a.type === "string" ? a.type : undefined,
        path: typeof a.path === "string" ? a.path : undefined,
        position: a.position,
        editorKind: typeof a.editorKind === "string" ? a.editorKind : undefined,
        cssFramework: typeof a.cssFramework === "string" ? a.cssFramework : undefined,
        purpose: typeof a.purpose === "string" ? a.purpose : "page",
      })) as { screenId: string };
      return {
        content: [
          {
            type: "text",
            text: `画面「${a.name}」を追加しました（ID: ${result.screenId}）`,
          },
        ],
      };
    }

    case "designer__update_screen": {
      if (typeof a.screenId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId は必須です");
      }
      // RFC #1021 pl-6 (Codex B-2): purpose / pageLayoutId も update 可能に
      await wsBridge.sendCommand("updateScreenMeta", {
        screenId: a.screenId,
        name: a.name,
        type: a.type,
        description: a.description,
        path: a.path,
        purpose: a.purpose,
        // pageLayoutId は空文字または null で解除可能
        pageLayoutId: a.pageLayoutId === "" || a.pageLayoutId === null ? null : a.pageLayoutId,
      });
      return {
        content: [
          { type: "text", text: `画面 ${a.screenId} を更新しました。` },
        ],
      };
    }

    case "designer__remove_screen": {
      if (typeof a.screenId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId は必須です");
      }
      await wsBridge.sendCommand("removeScreenNode", { screenId: a.screenId });
      return {
        content: [
          { type: "text", text: `画面 ${a.screenId} を削除しました。` },
        ],
      };
    }

    case "designer__export_screen": {
      if (typeof a.screenId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId は必須です");
      }

      // ブラウザ側から HTML + 画面名を取得
      const result = (await wsBridge.sendCommand("exportScreen", {
        screenId: a.screenId,
      })) as { html: string; css: string; screenName: string };

      // コンポーネント名を決定
      const rawName =
        typeof a.componentName === "string" && a.componentName.trim()
          ? a.componentName.trim()
          : toPascalCase(result.screenName);

      // JSX 変換
      const { code, warnings } = htmlToReact(result.html, rawName);

      const warningText =
        warnings.length > 0
          ? `\n\n> **変換警告:**\n${warnings.map((w) => `> - ${w}`).join("\n")}`
          : "";

      return {
        content: [
          {
            type: "text",
            text: `## ${rawName}.tsx\n\n\`\`\`tsx\n${code}\n\`\`\`${warningText}`,
          },
        ],
      };
    }

    default:
      return null;
  }
};
