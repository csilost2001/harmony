/**
 * 画面 (Screen) 系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (5 ツール):
 * - designer__list_screens
 * - designer__add_screen
 * - designer__update_screen
 * - designer__remove_screen
 *
 * harmony.json `entities.screens[]` の参照 + ブラウザ WS への CRUD 委譲。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readProject } from "../projectStorage.js";
import { wsBridge } from "../wsBridge.js";
import {
  addScreenToFiles, updateScreenInFiles, removeScreenFromFiles, isValidScreenKind, SCREEN_KINDS,
} from "../screenFlowFiles.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";

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
        // ブラウザ経由 fallback (purpose 情報なし)。ブラウザが無ければ、画面は無いものとして扱う (ファイルに画面の一覧が無い = 登録なし。#1591)
        const result = (wsBridge.hasActiveBrowser() ? await wsBridge.sendCommand("listScreens") : null) as {
          screens: Array<{ id: string; name: string; type: string; path: string; hasDesign: boolean }>;
        } | null;
        v3Screens = (result?.screens ?? []).map((s) => ({
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
      if (typeof a.name !== "string" || !a.name.trim()) {
        throw new McpError(ErrorCode.InvalidParams, "name は必須です");
      }
      if (a.type !== undefined && !isValidScreenKind(a.type)) {
        throw new McpError(ErrorCode.InvalidParams, `type は ${SCREEN_KINDS.join(" / ")} のいずれか (または 名前空間:種別) にしてください: ${JSON.stringify(a.type)}`);
      }
      if (a.purpose !== undefined && a.purpose !== "page" && a.purpose !== "gadget") {
        throw new McpError(ErrorCode.InvalidParams, `purpose は page / gadget のいずれかにしてください: ${JSON.stringify(a.purpose)}`);
      }
      if (a.path !== undefined && typeof a.path !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "path は文字列で指定してください");
      }
      if (a.id !== undefined && a.id !== "") assertEntityIdMcp(a.id, "id");
      let position: { x: number; y: number } | undefined;
      if (a.position !== undefined) {
        const p = a.position as { x?: unknown; y?: unknown } | null;
        if (!p || typeof p !== "object" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          throw new McpError(ErrorCode.InvalidParams, "position は { x: 数値, y: 数値 } の形で指定してください");
        }
        position = { x: p.x as number, y: p.y as number };
      }
      const purpose = a.purpose === "gadget" ? "gadget" : "page";
      const reqId = typeof a.id === "string" && a.id !== "" ? a.id : undefined;
      // ブラウザが無いときは、ブラウザと同じ結果になるようにファイルへ直接書く (#1591)
      const result = !wsBridge.hasActiveBrowser()
        ? await addScreenToFiles(root, { id: reqId, name: a.name, kind: typeof a.type === "string" ? a.type : undefined, path: typeof a.path === "string" ? a.path : undefined, position, purpose })
        : (await wsBridge.sendCommand("addScreen", {
          id: reqId,
          name: a.name,
          type: typeof a.type === "string" ? a.type : undefined,
          path: typeof a.path === "string" ? a.path : undefined,
          position,
          purpose,
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
      // S-002: ID validation
      assertEntityIdMcp(a.screenId, "screenId");
      // #1332 Codex 9 巡目 M2: pageLayoutId は top-level EntityId (schema: harmony.v3 ScreenEntry.pageLayoutId)。
      // 解除値 (空文字 / null) はそのまま許容、それ以外は EntityId 検証する。
      // 指定が無い (undefined) ときは触らない: null (解除) にすると、名前だけ直した画面のレイアウト指定まで消える (#1591 で気づいた不具合)
      const normalizedPageLayoutId =
        a.pageLayoutId === undefined
          ? undefined
          : a.pageLayoutId === "" || a.pageLayoutId === null
            ? null
            : a.pageLayoutId;
      if (normalizedPageLayoutId !== null && normalizedPageLayoutId !== undefined) {
        assertEntityIdMcp(normalizedPageLayoutId, "pageLayoutId");
      }
      // ブラウザが無いときは、ファイルへ直接書く (#1591)
      if (!wsBridge.hasActiveBrowser()) {
        if (a.type !== undefined && !isValidScreenKind(a.type)) {
          throw new McpError(ErrorCode.InvalidParams, `type は ${SCREEN_KINDS.join(" / ")} のいずれか (または 名前空間:種別) にしてください: ${JSON.stringify(a.type)}`);
        }
        await updateScreenInFiles(root, a.screenId, {
          name: typeof a.name === "string" ? a.name : undefined,
          kind: typeof a.type === "string" ? a.type : undefined,
          description: typeof a.description === "string" ? a.description : undefined,
          path: typeof a.path === "string" ? a.path : undefined,
          purpose: typeof a.purpose === "string" ? a.purpose : undefined,
          pageLayoutId: normalizedPageLayoutId as string | null | undefined,
        });
        return { content: [{ type: "text", text: `画面 ${a.screenId} を更新しました。` }] };
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
        pageLayoutId: normalizedPageLayoutId,
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
      // S-002: ID validation
      assertEntityIdMcp(a.screenId, "screenId");
      // ブラウザが無いときは、ファイルへ直接書く (#1591)
      if (wsBridge.hasActiveBrowser()) await wsBridge.sendCommand("removeScreenNode", { screenId: a.screenId });
      else await removeScreenFromFiles(root, a.screenId);
      return {
        content: [
          { type: "text", text: `画面 ${a.screenId} を削除しました。` },
        ],
      };
    }

    default:
      return null;
  }
};
