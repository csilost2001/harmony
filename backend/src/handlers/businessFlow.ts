/**
 * 業務フロー (スイムレーン) の MCP tool handler。
 *
 * - designer__list_business_flows   一覧 (id / 名前 / レーン数 / 工程数 / 要確認の件数)
 * - designer__get_business_flow     1 件の原本 + 検証結果
 * - designer__save_business_flow    1 件の保存 (構造以外の問題は保存を妨げず、検証結果を返す)
 * - designer__delete_business_flow  1 件の削除
 *
 * 仕様: docs/spec/business-flow.md
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { validateBusinessFlow, type BusinessFlow } from "@harmony/shared";
import {
  readBusinessFlow, listBusinessFlows, writeBusinessFlow, deleteBusinessFlow,
  listExistingEntityIds, readConventions,
} from "../projectStorage.js";
import { wsBridge } from "../wsBridge.js";
import { workspaceContextManager } from "../workspaceState.js";
import { assertEntityIdMcp, type ToolHandler } from "../mcpHelpers.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 検証に使う参照先 (画面 / 処理フロー / 規約の役割)。読めないものは確認しない */
export async function businessFlowRefs(root: string) {
  const screens = await listExistingEntityIds("screen", root).then((ids) => new Set(ids)).catch(() => undefined);
  const flows = await listExistingEntityIds("processFlow", root).then((ids) => new Set(ids)).catch(() => undefined);
  const roles = await (async () => {
    try {
      const c = (await readConventions(root)) as { role?: Record<string, unknown> } | null;
      return c?.role ? new Set(Object.keys(c.role)) : undefined;
    } catch { return undefined; }
  })();
  return { screens, flows, roles };
}

export const handleBusinessFlowTool: ToolHandler = async (name, args, root, sessionId) => {
  const a = args ?? {};
  const wsId = () => workspaceContextManager.getActivePath(sessionId);

  switch (name) {
    case "designer__list_business_flows": {
      const refs = await businessFlowRefs(root);
      const flows = (await listBusinessFlows(root)) as unknown as BusinessFlow[];
      return json({
        flows: flows.map((f) => ({
          id: f.id, name: f.name, maturity: f.maturity, lanes: f.lanes?.length ?? 0, steps: f.steps?.length ?? 0,
          issues: validateBusinessFlow(f, refs).filter((i) => i.severity !== "info").length,
        })),
      });
    }

    case "designer__get_business_flow": {
      assertEntityIdMcp(a.flowId, "flowId");
      const flow = await readBusinessFlow(a.flowId, root);
      if (!flow) throw new McpError(ErrorCode.InvalidParams, `業務フロー「${a.flowId}」が見つかりません`);
      return json({ flow, issues: validateBusinessFlow(flow as unknown as BusinessFlow, await businessFlowRefs(root)) });
    }

    case "designer__save_business_flow": {
      assertEntityIdMcp(a.flowId, "flowId");
      if (!isRecord(a.flow) || !Array.isArray(a.flow.lanes) || !Array.isArray(a.flow.steps) || typeof a.flow.name !== "string") {
        throw new McpError(ErrorCode.InvalidParams, "flow は { name, lanes: [], steps: [] } の形で指定してください");
      }
      const saved = await writeBusinessFlow(a.flowId, { ...a.flow, id: a.flowId }, root);
      wsBridge.broadcast({ wsId: wsId(), event: "businessFlowChanged", data: { flowId: a.flowId } });
      const issues = validateBusinessFlow(saved as unknown as BusinessFlow, await businessFlowRefs(root));
      const counts = { error: 0, warning: 0, info: 0 };
      for (const i of issues) counts[i.severity]++;
      return json({ saved: true, flowId: a.flowId, counts, issues: issues.filter((i) => i.severity !== "info") });
    }

    case "designer__delete_business_flow": {
      assertEntityIdMcp(a.flowId, "flowId");
      const deleted = await deleteBusinessFlow(a.flowId, root);
      if (deleted) wsBridge.broadcast({ wsId: wsId(), event: "businessFlowChanged", data: { flowId: a.flowId, deleted: true } });
      return json({ deleted });
    }

    default:
      return null;
  }
};
