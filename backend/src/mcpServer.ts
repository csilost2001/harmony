/**
 * MCP サーバーの組み立て (tool / resource / prompt のハンドラ)。index.ts の起動処理から分けてあり、試験が実際のプロトコルで接続できる。
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { wsBridge } from "./wsBridge.js";
import { logInfo } from "./serverLog.js";
import { ensureRecovered } from "./operationJournal.js";
import { assertToolAllowed, filterTools, isReadOnlyTool } from "./security/mcpAccess.js";
import { filterToolsByProfile, isInProfile, profileRefusal } from "./security/mcpProfiles.js";
import { briefTool, toolAnnotations, withHint, type DetailMode } from "./mcpToolMeta.js";
import { SERVER_INSTRUCTIONS, getPrompt, listPrompts, listResources, listResourceTemplates, readResource } from "./mcpKnowledge.js";
import { recordAudit } from "./ops/audit.js";
import { describeAiTool, isAiDryRun, isAiNoWrite } from "./ops/auditMap.js";
import { scheduleIssueCheck } from "./ops/issuesWatch.js";
import { tools } from "./tools.js";
import {
  WorkspaceUnsetError,
  workspaceContextManager,
} from "./workspaceState.js";

/** ログに残す失敗の要約 (先頭 120 文字。接頭辞・id や数字の違いで別の失敗にならないよう、集計側で正規化する) */
function errorSummary(v: unknown): string {
  return String(v ?? "").replace(/^MCP error -?\d+: /, "").replace(/^エラー: /, "").replace(/\s+/g, " ").slice(0, 120);
}

// 機能領域別 MCP tool handler (#1144 Phase-1: index.ts 1830 → ~200 LOC に分離)。
// 各 handler は ToolHandler signature (name/args/root/sessionId) を実装し、該当 tool は処理し、
// それ以外は null を返して dispatcher に次の handler を試させる。
import { handleMarkerTool } from "./handlers/marker.js";
import { handleProcessFlowTool } from "./handlers/processFlow.js";
import { handleScreenTool } from "./handlers/screen.js";
import { handleEdgeTool } from "./handlers/edge.js";
import { handleTableTool } from "./handlers/table.js";
import { handlePageLayoutTool } from "./handlers/pageLayout.js";
import { handleExportTool } from "./handlers/export.js";
import { handleTabTool } from "./handlers/tab.js";
import { handleScreenItemTool } from "./handlers/screenItem.js";
import { handleLayoutTool } from "./handlers/layout.js";
import { handleBusinessFlowTool } from "./handlers/businessFlow.js";
import { handleDesignTool } from "./handlers/design.js";
import { handleDesignKindsTool } from "./handlers/designKinds.js";
import { handleDesignInsightTool, toolGuide } from "./handlers/designInsight.js";
import { handleFlowBatchTool } from "./handlers/flowBatch.js";
import { handleReportTool } from "./handlers/report.js";
import { handleWorkspaceTool } from "./handlers/workspace.js";
import { checkForUpdateCached } from "./ops/versionInfo.js";
import { handleEditSessionTool } from "./handlers/editSession.js";


// MCPサーバーのファクトリ (#302, #700 R-2): HTTP リクエスト毎に fresh な Server インスタンスを
// 作成することで、複数クライアントが同時接続しても互いの initialize 状態と干渉しない
// (Server.connect(transport) は 1:1 関係、1 Server を複数 transport に share はできないため)
// sessionId を受け取り、workspaceContextManager に connect して per-session active を解決する。
export interface McpServerOptions {
  /** 環境変数に関わらず、読み取り専用にする (`/mcp-readonly` の入口。顧客のレビュー用など、書き込みが絶対にできない接続) */
  forceReadonly?: boolean;
}

export function createMcpServer(sessionId: string, profiles: readonly string[] = [], detail: DetailMode = "full", options: McpServerOptions = {}): Server {
  // 読み取り専用の入口は、環境変数が full でも、読み取り専用として振る舞う (プロファイルや環境変数で緩められない)
  // 加えて、ワークスペースの切り替え (workspace_open / workspace_close) も使わせない: 設計は変えないが、最近開いた一覧・ほかの画面への通知という共有の状態を変えるため。
  // 作業するワークスペースは、接続の側 (固定モード DESIGNER_DATA_DIR か、画面で開いているもの) で決まる
  const mcpEnv: NodeJS.ProcessEnv = options.forceReadonly
    ? { ...process.env, HARMONY_MCP_MODE: "readonly", HARMONY_MCP_DENY: [process.env.HARMONY_MCP_DENY, "workspace_open", "workspace_close"].filter(Boolean).join(",") }
    : process.env;
  const server = new Server(
    { name: "harmony-mcp", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS }
  );

  // ツール一覧 (権限で使えないもの・選んだプロファイルに入らないものは出さない)
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // 注釈 (読み取り専用・破壊的・冪等) を付ける。brief のときは説明を短くする (詳細は designer__get_tool_guide)
    const visible = filterToolsByProfile(filterTools(tools, mcpEnv), profiles).map((t) => ({ ...t, annotations: toolAnnotations(t.name) }));
    return { tools: detail === "brief" ? visible.map(briefTool) : visible };
  });

  // 資料 (Resources) と手順 (Prompts): 読み取り専用。仕様: docs/spec/server-security.md
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: listResources() }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: listResourceTemplates() }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    let root: string | null = null;
    try { root = workspaceContextManager.requireActivePath(sessionId); } catch { /* ワークスペース未選択。project/context だけが使う */ }
    // 設計全体の要約は tool (designer__get_project_context) と同じ内容なので、tool と同じ権限・プロファイルで守る
    if (request.params.uri === "harmony://project/context") {
      assertToolAllowed("designer__get_project_context", mcpEnv);
      if (!isInProfile("designer__get_project_context", profiles)) throw new McpError(ErrorCode.InvalidRequest, "この接続のプロファイルでは、設計全体の要約は読めません");
    }
    return readResource(request.params.uri, root);
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: listPrompts() }));
  server.setRequestHandler(GetPromptRequestSchema, async (request) => getPrompt(request.params.name, request.params.arguments));

  // ツール呼び出し (#1144 Phase-1: ハンドラ群を機能領域別に handlers/*.ts へ分離。
  // index.ts はディスパッチャと共通エラーハンドリングのみを担う)。
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const startedAt = Date.now();
    const argRecord = (args ?? {}) as Record<string, unknown>;
    // MCP tool 内で resolveRoot を呼ぶために sessionId を使う (#700 R-2)
    const mcpRoot = (): string => workspaceContextManager.requireActivePath(sessionId);

    try {
      // 読み取り専用・拒否リストの設定 (HARMONY_MCP_MODE / HARMONY_MCP_DENY) で使えない tool は、ここで拒否する (断った呼び出しも、集計に残る)
      assertToolAllowed(name, mcpEnv, argRecord);
      const refusal = profileRefusal(name, argRecord, profiles);
      if (refusal) throw new McpError(ErrorCode.InvalidRequest, refusal);
      if (!isInProfile(name, profiles)) {
        throw new McpError(ErrorCode.InvalidRequest, `${name} は、この接続のプロファイル (${profiles.join(", ")}) では使えません。全部使うには、接続の URL の ?profile= を外してください`);
      }
      // tool の詳細は、この接続で使える tool (拒否・読み取り専用の入口で使えないものを除く) だけを出す。ワークスペースがなくても使える
      if (name === "designer__get_tool_guide") {
        const res = toolGuide(argRecord, mcpEnv);
        logInfo("mcp", "tool", { tool: name, ok: true, ms: Date.now() - startedAt });
        return res;
      }
      // この Harmony 自身の更新の確認 (GitHub への読み取りの問い合わせ)。ワークスペースがなくても使える
      if (name === "designer__check_harmony_update") {
        const res = { content: [{ type: "text" as const, text: JSON.stringify(await checkForUpdateCached(), null, 2) }] };
        logInfo("mcp", "tool", { tool: name, ok: true, ms: Date.now() - startedAt });
        return res;
      }
      // ワークスペースの管理 tool (一覧・状態・開く・調べる・閉じる・外す) は、ワークスペースが選ばれていなくても使える
      // (未選択の状態から開くための tool なので、下の「ワークスペースのパスを先に求める」処理の前で返す)
      if (name.startsWith("designer__workspace_")) {
        const res = await handleWorkspaceTool(name, argRecord, "", sessionId);
        if (res !== null && res !== undefined) {
          // 開いたワークスペースで、前回、複数ファイルの操作の途中で止まっていれば元へ戻す (下の通常の経路と同じ)
          if (name === "designer__workspace_open" && !(res as { isError?: boolean }).isError) {
            const opened = workspaceContextManager.getActivePath(sessionId);
            if (opened) await ensureRecovered(opened);
          }
          // 監査の記録と opsChanged は、ここでは出さない: ワークスペースの切り替え・一覧・状態は設計の変更ではなく、
          // 下の経路の記録は「作業先のワークスペースの設計への書き込み」を残すためのもの (切り替え前の作業先に記録されてしまう)。
          // 切り替え自体は workspace.changed の broadcast で画面へ知らせる。
          const failed = !!(res as { isError?: boolean }).isError;
          logInfo("mcp", "tool", { tool: name.slice(0, 80), ok: !failed, ms: Date.now() - startedAt, ...(failed ? { error: errorSummary((res as { content?: Array<{ text?: unknown }> }).content?.[0]?.text) } : {}) });
          return res;
        }
      }
      // 各 handler は該当しなければ null を返し、次の handler に委譲される。
      // 並び順は元 index.ts の switch 文と一致 (機能領域順、editSession は最後)。
      // #700 R-2: root と sessionId を pass-through する。
      // root は eager に解決される (workspace 未選択時は WorkspaceUnsetError、
      // 下の catch で McpError に変換)。
      const root = mcpRoot();
      await ensureRecovered(root); // 前回、複数ファイルの操作の途中で止まっていれば、元へ戻す
      const dispatchers = [
        handleMarkerTool,
        handleProcessFlowTool,
        handleScreenTool,
        handleEdgeTool,
        handleTableTool,
        handlePageLayoutTool,
        handleExportTool,
        handleTabTool,
        handleScreenItemTool,
        handleLayoutTool,
        handleBusinessFlowTool,
        handleDesignTool,
        handleDesignKindsTool,
        handleDesignInsightTool,
        handleFlowBatchTool,
        handleReportTool,
        handleWorkspaceTool,
        handleEditSessionTool,
      ];
      // 編集セッションの tool は、引数が編集セッションの id だけ。実行の前に (保存で閉じる前に)、どの設計の編集かを引いておく
      const sessionTarget = /^editSession__/.test(name) && typeof argRecord.editSessionId === "string" ? wsBridge.describeEditSession(sessionId, argRecord.editSessionId) : undefined;
      for (const handler of dispatchers) {
        const result = await handler(name, argRecord, root, sessionId);
        if (result !== null && result !== undefined) {
          // AI の書き込みの tool は、監査ログに残す (失敗した呼び出しは、残さない。isError の結果も除く)
          if (!isReadOnlyTool(name) && !(result as { isError?: boolean }).isError && !/^(editSession__(list|fetch)|designer__(list|get|find|check|export|generate|analyze)_|designer__report_confusion$)/.test(name)) {
            const resultText = (result as { content?: Array<{ text?: unknown }> }).content?.map((x) => (typeof x.text === "string" ? x.text : "")).join("\n") ?? "";
            const toolDef = tools.find((t) => t.name === name);
            const hasApply = !!(toolDef?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties && "apply" in ((toolDef!.inputSchema as { properties: Record<string, unknown> }).properties);
            if (!isAiDryRun(argRecord, hasApply) && !isAiNoWrite(name, argRecord, resultText)) {
              const d = describeAiTool(name, argRecord, resultText, sessionTarget);
              void recordAudit(root, { actor: "AI", action: `AI が ${name.replace(/^designer__/, "")} を実行した`, ...d, via: "ai" });
              scheduleIssueCheck(root);
              wsBridge.broadcast({ wsId: root, event: "opsChanged", data: { scope: "ai" } });
            }
          }
          // どの tool がよく失敗するか・遅いかを後で集計できるよう、呼び出しを 1 行残す (引数・結果は残さない。npm run mcp:report)
          const failed = !!(result as { isError?: boolean }).isError;
          logInfo("mcp", "tool", { tool: name.slice(0, 80), ok: !failed, ms: Date.now() - startedAt, ...(failed ? { error: errorSummary((result as { content?: Array<{ text?: unknown }> }).content?.[0]?.text) } : {}) });
          return result;
        }
      }
      throw new McpError(ErrorCode.MethodNotFound, `未知のツール: ${name}`);
    } catch (err) {
      logInfo("mcp", "tool", { tool: name.slice(0, 80), ok: false, ms: Date.now() - startedAt, error: errorSummary(err instanceof Error ? err.message : err) });
      if (err instanceof WorkspaceUnsetError) {
        throw new McpError(ErrorCode.InvalidParams, `${err.message} (designer__workspace_list で探し、designer__workspace_open で開いてください)`);
      }
      if (err instanceof McpError) {
        // 「直し方」を添えて投げ直す (McpError の文には "MCP error -32602: " が付くので、外してから)
        const plain = err.message.replace(/^MCP error -?\d+: /, "");
        const hinted = withHint(plain);
        throw hinted === plain ? err : new McpError(err.code, hinted, err.data);
      }
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `エラー: ${withHint(message)}` }],
        isError: true,
      };
    }
  });

  return server;
}

