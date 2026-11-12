/**
 * 処理フローのアクション・本体 (meta) の部分更新と、重複した工程の id の振り直し (#1603)。
 *
 * - designer__update_action     アクションに patch を合わせる (id・steps は変えない)
 * - designer__remove_action     アクションを消す
 * - designer__update_flow_meta  処理フロー本体 (meta) に patch を合わせる (id は変えない)
 * - designer__renumber_step_ids 重複した工程の id を振り直す (アクションの中の参照も付け替える)
 *
 * どれも edit_steps と同じく、既定は予行 (apply: true で保存)。保存済みのファイルだけを対象にし、画面で開いている処理フローは断る。
 * この編集で増えたスキーマ違反を返す。処理フロー全体を送り直さずに済むようにするためのもの。
 * 仕様: docs/spec/mcp-design-access.md
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { readProcessFlow } from "../projectStorage.js";
import { assertEntityIdMcp, assertLocalIdMcp, saveAndBroadcast, type ToolHandler } from "../mcpHelpers.js";
import { removeAction, renumberDuplicateStepIds, updateAction, updateFlowMeta, type ProcessFlowDoc } from "../processFlowEdits.js";
import { schemaMessages } from "./flowBatch.js";
import { collectAllLocalIds, nextLocalId, syncProcessFlowEntry } from "./processFlow.js";
import { wsBridge } from "../wsBridge.js";

const bad = (m: string) => new McpError(ErrorCode.InvalidParams, m);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

const TOOLS = new Set(["designer__update_action", "designer__remove_action", "designer__update_flow_meta", "designer__renumber_step_ids"]);

export const handleFlowEditTool: ToolHandler = async (name, args, root) => {
  if (!TOOLS.has(name)) return null;
  const a = args ?? {};
  assertEntityIdMcp(a.processFlowId, "processFlowId");
  if (a.apply !== undefined && typeof a.apply !== "boolean") throw bad("apply は true / false で指定してください (true で保存。既定は予行)");
  if (await wsBridge.tryCommand("getProcessFlow", { id: a.processFlowId })) {
    throw bad("この処理フローは画面で開かれています。未保存の内容を壊さないよう、保存済みのファイルだけを対象にするこの tool は断ります。画面で保存して閉じてから呼んでください");
  }
  const stored = await readProcessFlow(a.processFlowId as string, root);
  if (!isRecord(stored)) throw bad(`処理フロー ${a.processFlowId} が見つかりません (designer__list_process_flows で一覧)`);
  const before = await schemaMessages(stored);
  const doc = structuredClone(stored) as unknown as ProcessFlowDoc;
  if (!Array.isArray(doc.actions)) doc.actions = [];

  let result: Record<string, unknown>;
  try {
    switch (name) {
      case "designer__update_action": {
        assertLocalIdMcp(a.actionId, "actionId");
        if (!isRecord(a.patch)) throw new Error("patch が必要です (JSON のオブジェクト。値を null にした項目は消します)");
        updateAction(doc, a.actionId as string, a.patch);
        result = { actionId: a.actionId, changed: Object.keys(a.patch) };
        break;
      }
      case "designer__remove_action": {
        assertLocalIdMcp(a.actionId, "actionId");
        const act = doc.actions.find((x) => x.id === a.actionId);
        removeAction(doc, a.actionId as string);
        result = { actionId: a.actionId, removedSteps: Array.isArray(act?.steps) ? act.steps.length : 0 };
        break;
      }
      case "designer__update_flow_meta": {
        if (!isRecord(a.patch)) throw new Error("patch が必要です (JSON のオブジェクト。値を null にした項目は消します)");
        updateFlowMeta(doc, a.patch);
        result = { changed: Object.keys(a.patch) };
        break;
      }
      default: {
        const ids = collectAllLocalIds(doc);
        const renamed = renumberDuplicateStepIds(doc, () => { const id = nextLocalId(ids, "step", 2); ids.add(id); return id; });
        result = { renamed };
        if (renamed.length === 0) return json({ applied: false, processFlowId: a.processFlowId, renamed, note: "重複した工程の id はありません (何も変えていません)" });
        break;
      }
    }
  } catch (err) {
    throw bad(`${(err as Error).message.replace(/^MCP error -?\d+: /, "")}。何も保存していません`);
  }

  const apply = a.apply === true;
  const toSave = structuredClone(doc);
  if (apply) {
    await saveAndBroadcast(a.processFlowId as string, toSave, root);
    // 名前・アクションの数などを harmony.json の一覧に写す
    if (name !== "designer__renumber_step_ids") await syncProcessFlowEntry(a.processFlowId as string, toSave as unknown as Record<string, unknown>, root);
  }
  const was = new Set(before);
  const introduced = (await schemaMessages(toSave)).filter((m) => !was.has(m));
  return json({
    applied: apply, processFlowId: a.processFlowId, ...result,
    ...(introduced.length ? { newSchemaIssues: introduced.slice(0, 10), ...(introduced.length > 10 ? { moreSchemaIssues: introduced.length - 10 } : {}) } : {}),
    note: apply ? "保存しました。設計の確認は designer__check_design で" : "予行です (何も保存していません)。保存するには apply: true",
  });
};
