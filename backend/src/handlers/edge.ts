/**
 * 画面フロー (Edge) 系 MCP tool handler (#1144 Phase-1)。
 *
 * 対象 (4 ツール):
 * - designer__add_edge
 * - designer__remove_edge
 * - designer__get_flow (Mermaid + project summary)
 * - designer__navigate_screen
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readProject } from "../projectStorage.js";
import { addEdgeToFiles, removeEdgeFromFiles, flowSnapshotOf } from "../screenFlowFiles.js";
import { wsBridge } from "../wsBridge.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";

export const handleEdgeTool: ToolHandler = async (name, args, root) => {
  const a = args ?? {};

  switch (name) {
    case "designer__add_edge": {
      if (typeof a.source !== "string" || typeof a.target !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "source と target は必須です");
      }
      // #1332 Codex 9 巡目 M2: source / target は Screen EntityId (画面フロー edge の端点)。
      assertEntityIdMcp(a.source, "source");
      assertEntityIdMcp(a.target, "target");
      const edgeTrigger = typeof a.trigger === "string" ? a.trigger : undefined;
      const edgeLabel = typeof a.label === "string" ? a.label : "";
      // ブラウザが無いときは、ファイルへ直接書く (#1591)
      const result = !wsBridge.hasActiveBrowser()
        ? await addEdgeToFiles(root, { source: a.source, target: a.target, label: edgeLabel, trigger: edgeTrigger })
        : (await wsBridge.sendCommand("addFlowEdge", {
          source: a.source,
          target: a.target,
          label: edgeLabel,
          trigger: edgeTrigger,
        })) as { edgeId: string };
      return {
        content: [
          {
            type: "text",
            text: `遷移エッジを追加しました（ID: ${result.edgeId}）`,
          },
        ],
      };
    }

    case "designer__remove_edge": {
      if (typeof a.edgeId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "edgeId は必須です");
      }
      if (wsBridge.hasActiveBrowser()) await wsBridge.sendCommand("removeFlowEdge", { edgeId: a.edgeId });
      else await removeEdgeFromFiles(root, a.edgeId); // ブラウザが無いときは、ファイルへ直接書く (#1591)
      return {
        content: [
          { type: "text", text: `エッジ ${a.edgeId} を削除しました。` },
        ],
      };
    }

    case "designer__get_flow": {
      // ファイルから直接読み込み（ブラウザ不要）。ファイルがない場合はブラウザ経由
      type FlowResult = {
        project: {
          name: string;
          screens: Array<{ id: string; name: string; type: string; path: string; hasDesign: boolean }>;
          edges: Array<{ id: string; source: string; target: string; label: string; trigger: string }>;
        };
        mermaid: string;
      };
      let result: FlowResult;
      // v3 の harmony.json (entities.screens / entities.screenTransitions) から作る。旧形式 (最上位の screens) は、そのまま使う (#1591)
      const rawProject = await readProject(root);
      const legacyData = rawProject as FlowResult["project"] | null;
      const fileData = legacyData?.screens ? legacyData : (wsBridge.hasActiveBrowser() ? null : flowSnapshotOf(rawProject));
      if (fileData?.screens) {
        // ファイルから読んで Mermaid を生成
        const p = fileData;
        const idMap = new Map<string, string>();
        (p.screens ?? []).forEach((s, i) => idMap.set(s.id, `S${i}`));
        const mLines = ["flowchart TD"];
        for (const s of (p.screens ?? [])) {
          const sid = idMap.get(s.id)!;
          mLines.push(`    ${sid}["${s.name}"]`);
        }
        for (const e of (p.edges ?? [])) {
          const src = idMap.get(e.source);
          const tgt = idMap.get(e.target);
          if (src && tgt) {
            mLines.push(e.label ? `    ${src} -->|${e.label}| ${tgt}` : `    ${src} --> ${tgt}`);
          }
        }
        result = { project: p, mermaid: mLines.join("\n") };
      } else {
        result = (await wsBridge.sendCommand("getFlow")) as FlowResult;
      }
      const p = result.project;
      const screenLines = p.screens.map(
        (s) => `  - ${s.id}  ${s.name} (${s.type})${s.path ? ` [${s.path}]` : ""}`
      );
      const edgeLines = p.edges.map((e) => {
        const src = p.screens.find((s) => s.id === e.source)?.name ?? e.source;
        const tgt = p.screens.find((s) => s.id === e.target)?.name ?? e.target;
        return `  - ${e.id}  ${src} → ${tgt}${e.label ? ` "${e.label}"` : ""} (${e.trigger})`;
      });
      return {
        content: [
          {
            type: "text",
            text: [
              `# プロジェクト: ${p.name}`,
              `\n## 画面 (${p.screens.length}件)`,
              ...screenLines,
              `\n## 遷移 (${p.edges.length}件)`,
              ...edgeLines,
              `\n## Mermaid`,
              "```mermaid",
              result.mermaid,
              "```",
            ].join("\n"),
          },
        ],
      };
    }

    case "designer__navigate_screen": {
      if (typeof a.screenId !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "screenId は必須です");
      }
      // #1332 Codex 9 巡目 M2: URL 側では UUID reject 実装、MCP 経路も Screen EntityId を強制する。
      assertEntityIdMcp(a.screenId, "screenId");
      await wsBridge.sendCommand("navigateScreen", { screenId: a.screenId }, "画面の表示を切り替える操作です");
      return {
        content: [
          {
            type: "text",
            text: `画面 ${a.screenId} のデザイナーへ遷移しました。`,
          },
        ],
      };
    }

    default:
      return null;
  }
};
