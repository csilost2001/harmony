/**
 * MCP tool handler 群で共有する helper (#302 以降のリファクタで切り出し)。
 *
 * backend のツール実装がファイルに分散した時 (handlers/*.ts) にも
 * 同じロジックを呼べるよう、クロスカッティングな補助関数をここに集約。
 *
 * #700 R-2: root (per-session active path) と sessionId を引数に追加。
 * LEGACY_CLIENT_ID / no-arg wrapper は削除済み。
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { wsBridge } from "./wsBridge.js";
import { writeProcessFlow } from "./projectStorage.js";
import { assertEntityIdOrUuid } from "./security/idValidator.js";
import type { ProcessFlowDoc } from "./processFlowEdits.js";

/**
 * MCP handler 用の `assertEntityIdOrUuid` ラッパ — validator が投げる Error を
 * `McpError(InvalidParams)` に rethrow する。各 handler の try/catch boilerplate を
 * 1 行化するために導入 (#1294 I-2 review Nit #1)。
 *
 * 用途は handler 入口の id 検証のみ。WebSocket handler 等 McpError を返したくない
 * 経路では従来通り `assertEntityIdOrUuid` を直接使う。
 */
export function assertEntityIdOrUuidMcp(value: unknown, label: string): asserts value is string {
  try {
    assertEntityIdOrUuid(value, label);
  } catch (e) {
    throw new McpError(ErrorCode.InvalidParams, (e as Error).message);
  }
}

/** ProcessFlow を保存してブラウザに変更通知 (#700 R-2: root 必須, #703 R-5: wsId=root で scope) */
export async function saveAndBroadcast(agId: string, ag: ProcessFlowDoc, root: string): Promise<void> {
  ag.updatedAt = new Date().toISOString();
  await writeProcessFlow(agId, ag, root);
  // root が wsId = per-workspace scoping (#703 R-5 A-1)
  wsBridge.broadcast({ wsId: root, event: "processFlowChanged", data: { id: agId } });
}

/**
 * Tool call の戻り値の共通形。MCP SDK の実際の型は複雑なため、
 * dispatcher との接続を容易にする loose な定義にする。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolResult = any;

/**
 * 各 handler モジュールの共通 signature: 該当しなければ null を返して dispatcher に次を試させる。
 * #700 R-2: root (per-session active path) と sessionId を追加。
 */
export type ToolHandler = (
  name: string,
  args: Record<string, unknown>,
  root: string,
  sessionId: string,
) => Promise<ToolResult | null>;
