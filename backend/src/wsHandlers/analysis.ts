/**
 * 設計の分析・点検の設定の RPC。
 *
 * - designCheck.*   要確認の抑制 / 独自ルール (design-check.json)
 * - design.progress 完成度 (成熟度) の集計と、日ごとの記録の推移
 *
 * 分析そのもの (影響分析・対応表など) は、画面が `loadDesignInput` の結果から shared の関数で計算する。
 */
import { summarizeProgress } from "@harmony/shared";
import { loadDesignInputFromRoot } from "../designInput.js";
import { readCheckSettings, removeSuppressions, saveRules, suppressIssue, unsuppressIssue, type SuppressInput } from "../designCheckSettings.js";
import { readProgressHistory, recordProgress } from "../progressStore.js";
import { readLogTail } from "../serverLog.js";
import type { RpcHandlerMap } from "./types.js";

export const analysisHandlers: RpcHandlerMap = {
  /** 不具合の報告に添える、サーバのログの末尾 (書くときにマスク済み。画面のエラー画面から「状況をまとめてコピー」に含める) */
  "diagnostics.serverLogTail": async ({ params, respond, respondError }) => {
    try {
      const n = (params as { lines?: unknown } | null)?.lines;
      respond({ lines: readLogTail(typeof n === "number" && Number.isFinite(n) ? n : 100) });
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  "designCheck.load": async ({ root, respond, respondError }) => {
    try { respond(await readCheckSettings(root())); } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  "designCheck.suppress": async ({ params, root, wsId, clientId, respond, respondError, bridge }) => {
    try {
      const res = await suppressIssue(root(), (params ?? {}) as SuppressInput);
      respond(res);
      bridge.broadcast({ wsId: wsId(), event: "designCheckChanged", data: {}, excludeClientId: clientId });
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  "designCheck.unsuppress": async ({ params, root, wsId, clientId, respond, respondError, bridge }) => {
    try {
      const { key, keys } = (params ?? {}) as { key?: string; keys?: string[] };
      const res = Array.isArray(keys) ? await removeSuppressions(root(), keys.filter((k): k is string => typeof k === "string")) : await unsuppressIssue(root(), key as string);
      respond(res);
      bridge.broadcast({ wsId: wsId(), event: "designCheckChanged", data: {}, excludeClientId: clientId });
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  "designCheck.saveRules": async ({ params, root, wsId, clientId, respond, respondError, bridge }) => {
    try {
      const p = (params ?? {}) as { rules?: unknown; discardUnreadable?: unknown };
      const res = await saveRules(root(), p.rules, p.discardUnreadable === true);
      respond(res);
      bridge.broadcast({ wsId: wsId(), event: "designCheckChanged", data: {}, excludeClientId: clientId });
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },

  "design.progress": async ({ params, root, respond, respondError }) => {
    try {
      const { input } = await loadDesignInputFromRoot(root());
      const summary = summarizeProgress(input);
      // 記録は求められたときだけ (ダッシュボードのパネル・進捗の表示)。MCP の読み取りでは書かない
      const record = (params as { record?: boolean } | undefined)?.record !== false;
      const history = record ? await recordProgress(root(), summary) : await readProgressHistory(root());
      respond({ summary, history });
    } catch (e) { respondError(e instanceof Error ? e.message : String(e)); }
  },
};
