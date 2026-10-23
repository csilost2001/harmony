/**
 * 処理フローの工程を、複数まとめて編集する MCP tool handler。
 *
 * - designer__edit_steps   工程の追加・更新・削除・移動・入れ子の移動を 1 回の呼び出しで適用する。
 *                          **全部成功するか、何も保存しない** (途中で止まって中途半端な状態が残らない)。既定は予行 (apply: true で保存)
 *
 * 1 工程ずつの tool (add_step / update_step / remove_step / move_step / nest_step) は、画面で開いている内容に適用する (保存で確定)。
 * まとめて直すこの tool は、保存済みのファイルだけを対象にする。画面で開いている処理フローは、未保存の内容を壊さないよう断る。
 * 仕様: docs/spec/mcp-design-access.md
 */
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { describeAjvError } from "../ajvMessages.js";
import { readProcessFlow, validateEntitySchema } from "../projectStorage.js";
import { assertEntityIdMcp, assertLocalIdMcp, saveAndBroadcast, type ToolHandler } from "../mcpHelpers.js";
import {
  insertStepAt, moveStep as editMoveStep, nestStep as editNestStep, removeStep as editRemoveStep, updateStep as editUpdateStep,
  type ProcessFlowDoc,
} from "../processFlowEdits.js";
import { collectAllLocalIds, nextLocalId } from "./processFlow.js";
import { wsBridge } from "../wsBridge.js";

const bad = (m: string) => new McpError(ErrorCode.InvalidParams, m);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

export const MAX_BATCH_EDITS = 100;

/** スキーマ違反の文言の集合 (編集の前後で比べ、この編集で増えたものだけを知らせる) */
async function schemaMessages(doc: unknown): Promise<string[]> {
  return (await validateEntitySchema("processFlow", doc)).map((e) => `${describeAjvError(e)}${e.instancePath ? ` (${e.instancePath})` : ""}`);
}

export const handleFlowBatchTool: ToolHandler = async (name, args, root) => {
  if (name !== "designer__edit_steps") return null;
  const a = args ?? {};
  assertEntityIdMcp(a.processFlowId, "processFlowId");
  if (!Array.isArray(a.edits) || a.edits.length === 0) throw bad("edits は 1 件以上の配列で指定してください");
  if (a.edits.length > MAX_BATCH_EDITS) throw bad(`edits は ${MAX_BATCH_EDITS} 件までです (${a.edits.length} 件)。分けて呼んでください`);

  // 画面で開いている (未保存かもしれない) 処理フローには、まとめて適用しない
  if (await wsBridge.tryCommand("getProcessFlow", { id: a.processFlowId })) {
    throw bad("この処理フローは画面で開かれています。まとめての編集は保存済みのファイルだけを対象にするため、未保存の内容を壊さないよう断ります。画面で保存して閉じるか、1 工程ずつの tool (add_step / update_step など) を使ってください");
  }
  const stored = await readProcessFlow(a.processFlowId, root);
  if (!isRecord(stored)) throw bad(`処理フロー ${a.processFlowId} が見つかりません (designer__list_process_flows で一覧)`);
  const before = await schemaMessages(stored);
  const doc = structuredClone(stored) as unknown as ProcessFlowDoc;
  const ids = collectAllLocalIds(doc);

  const results: Array<Record<string, unknown>> = [];
  for (let i = 0; i < a.edits.length; i++) {
    const e = a.edits[i];
    const where = `edits[${i}]`;
    try {
      if (!isRecord(e) || typeof e.op !== "string") throw new Error("op が必要です (add / update / remove / move / nest)");
      switch (e.op) {
        case "add": {
          assertLocalIdMcp(e.actionId, "actionId");
          if (typeof e.kind !== "string" || !e.kind) throw new Error("kind が必要です");
          if (e.parentStepId !== undefined) assertLocalIdMcp(e.parentStepId, "parentStepId");
          let id: string;
          if (e.id !== undefined) { assertLocalIdMcp(e.id, "id"); id = e.id as string; if (ids.has(id)) throw new Error(`id「${id}」はすでに使われています`); }
          else id = nextLocalId(ids, "step", 2);
          ids.add(id);
          const detail = isRecord(e.detail) ? e.detail : {};
          const step = { ...detail, id, kind: e.kind, description: typeof e.description === "string" ? e.description : typeof detail.description === "string" ? detail.description : "" } as never;
          insertStepAt(doc, e.actionId as string, step, typeof e.position === "number" ? e.position : undefined, typeof e.parentStepId === "string" ? e.parentStepId : undefined);
          results.push({ index: i, op: "add", stepId: id });
          break;
        }
        case "update": {
          assertLocalIdMcp(e.stepId, "stepId");
          if (!isRecord(e.patch)) throw new Error("patch が必要です (JSON のオブジェクト)");
          if ("id" in e.patch) throw new Error("patch で id は変えられません");
          editUpdateStep(doc, e.stepId as string, e.patch);
          results.push({ index: i, op: "update", stepId: e.stepId });
          break;
        }
        case "remove": {
          assertLocalIdMcp(e.stepId, "stepId");
          editRemoveStep(doc, e.stepId as string);
          results.push({ index: i, op: "remove", stepId: e.stepId });
          break;
        }
        case "move": {
          assertLocalIdMcp(e.stepId, "stepId");
          if (typeof e.newIndex !== "number" || !Number.isInteger(e.newIndex)) throw new Error("newIndex が必要です (整数。0 が先頭)");
          editMoveStep(doc, e.stepId as string, e.newIndex);
          results.push({ index: i, op: "move", stepId: e.stepId });
          break;
        }
        case "nest": {
          assertLocalIdMcp(e.stepId, "stepId");
          if (e.direction !== "indent" && e.direction !== "outdent") throw new Error("direction は indent / outdent のどちらかです");
          editNestStep(doc, e.stepId as string, e.direction);
          results.push({ index: i, op: "nest", stepId: e.stepId });
          break;
        }
        default:
          throw new Error(`op「${String(e.op)}」は使えません (add / update / remove / move / nest)`);
      }
    } catch (err) {
      throw bad(`${where}: ${(err as Error).message}。何も保存していません (${i} 件目までの編集は破棄しました)`);
    }
  }

  // この編集で増えたスキーマ違反だけを知らせる (もとからあった違反は、ここでは言わない)
  const was = new Set(before);
  const introduced = (await schemaMessages(doc)).filter((m) => !was.has(m));
  const apply = a.apply === true;
  if (apply) await saveAndBroadcast(a.processFlowId, doc, root);
  return json({
    applied: apply, processFlowId: a.processFlowId, edits: results.length, results,
    ...(introduced.length ? { newSchemaIssues: introduced.slice(0, 20), ...(introduced.length > 20 ? { moreSchemaIssues: introduced.length - 20 } : {}) } : {}),
    note: apply ? "保存しました。設計の確認は designer__check_design で" : "予行です (何も保存していません)。保存するには apply: true",
  });
};
